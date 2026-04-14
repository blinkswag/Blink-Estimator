import { GoogleGenAI, Type, ThinkingLevel } from "@google/genai";
import { jsonrepair } from "jsonrepair";
import { EstimationResult, SignScope, ArtworkContext, PricingRecord, ExtractedDetails, DEFAULT_SHEET_ID } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

/**
 * Normalizes Google Sheet headers to a standard format.
 * Removes parentheses and non-alphanumeric characters.
 */
function normalizeHeader(h: string): string {
  return h.trim().toLowerCase()
    .replace(/\([^)]*\)/g, '') // Remove anything in parentheses like (in) or (Sign Type)
    .replace(/[^a-z0-9]/g, '_') // Replace non-alphanumeric with underscore
    .replace(/_+/g, '_') // Replace multiple underscores with one
    .replace(/^_|_$/g, ''); // Trim underscores from ends
}

/**
 * Parses dimension strings like 2'-11" or 19'-10 1/4" into total inches.
 */
function parseDimension(val: any): number {
  if (typeof val === 'number') return val;
  if (!val || typeof val !== 'string') return 0;
  
  const cleanVal = val.trim();
  
  // Handle feet and inches format: 2'-11" or 2' 11"
  const ftMatch = cleanVal.match(/(\d+)'/);
  const inMatch = cleanVal.match(/(\d+(?:\s+\d+\/\d+)?|(?:\d+\/\d+)|(?:\d+\.\d+)|\d+)"/);
  
  let totalInches = 0;
  if (ftMatch) totalInches += parseInt(ftMatch[1]) * 12;
  
  if (inMatch) {
    const inStr = inMatch[1];
    if (inStr.includes('/')) {
      // Handle fractions like 10 1/4
      const parts = inStr.split(/\s+/);
      if (parts.length === 2) {
        totalInches += parseFloat(parts[0]);
        const fracParts = parts[1].split('/');
        totalInches += parseInt(fracParts[0]) / parseInt(fracParts[1]);
      } else {
        const fracParts = parts[0].split('/');
        totalInches += parseInt(fracParts[0]) / parseInt(fracParts[1]);
      }
    } else {
      totalInches += parseFloat(inStr);
    }
  }
  
  if (totalInches > 0) return totalInches;
  
  // Fallback to simple number extraction
  const num = parseFloat(cleanVal.replace(/[^0-9.]/g, ''));
  return isNaN(num) ? 0 : num;
}

// Global database state (populated from Google Sheet)
let currentPricingDatabase: PricingRecord[] = [];

export async function fetchPricingFromGoogleSheet(urlOrId: string): Promise<void> {
  try {
    let sheetId = urlOrId;
    if (urlOrId.includes('spreadsheets/d/')) {
      sheetId = urlOrId.split('spreadsheets/d/')[1].split('/')[0];
    }

    const apiKey = process.env.GOOGLE_SHEETS_API_KEY;
    if (!apiKey) {
      throw new Error("GOOGLE_SHEETS_API_KEY is not configured.");
    }

    const range = "A:Z"; 
    const apiUrl = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${range}?key=${apiKey}`;
    
    const response = await fetch(apiUrl);
    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.error?.message || `Failed to fetch Google Sheet: ${response.status}`);
    }
    
    const data = await response.json();
    const rows = data.values;
    if (!rows || rows.length === 0) throw new Error('No data found in sheet');

    const headers = rows[0].map((h: string) => normalizeHeader(h));
    console.log("Normalized Headers:", headers);
    
    const records: PricingRecord[] = [];
    for (let i = 1; i < rows.length; i++) {
      const values = rows[i];
      if (!values || values.length === 0) continue;
      
      const record: any = {};
      headers.forEach((header: string, index: number) => {
        let val: any = values[index]?.trim();
        record[header] = val;
      });
      
      // Map to standard PricingRecord structure with robust field detection
      const signType = record.item_name || record.sign_type || record.type || record.item || 'Unknown';
      const desc = String(record.item_description || record.description || '');
      
      let height = parseDimension(record.height || record.h || record.item_height);
      let width = parseDimension(record.width || record.w || record.item_width);
      let depth = parseDimension(record.depth || record.d || record.item_depth || record.return_depth);

      // Fallback: Try to extract dimensions from description if missing
      if (height === 0 || width === 0) {
        const dimMatch = desc.match(/(\d+(?:\.\d+)?)\s*[x*]\s*(\d+(?:\.\d+)?)/i);
        if (dimMatch) {
          if (width === 0) width = parseFloat(dimMatch[1]);
          if (height === 0) height = parseFloat(dimMatch[2]);
        }
      }

      const cost = Number(String(record.item_rate || record.manufacture_cost || record.cost || record.rate || 0).replace(/[^0-9.]/g, ''));
      const poId = record.purchase_order_id || record.po_id || '';
      const poDisplay = record.purchase_order_number || record.po_number || record.po || '';

      records.push({
        id: String(poId || record.id || `GS-${i}`),
        po_number: String(poDisplay),
        sign_type: String(signType),
        dimensions: { height, width, depth },
        mounting: String(record.mounting || 'Unknown'),
        illumination: String(record.illumination || 'None'),
        materials: String(record.materials || 'Unknown'),
        manufacture_cost: cost,
        install_cost: Number(String(record.install_cost || 0).replace(/[^0-9.]/g, '')),
        features: record.features ? String(record.features).split(';') : [],
        letter_count: Number(record.letter_count) || undefined,
        quantity: Number(record.quantity) || 1,
        description: String(record.item_description || record.description || ''),
        vendor_location: String(record.vendor_location || record.location || record.vendor_country || 'Unknown')
      });
    }
    
    if (records.length > 0) {
      currentPricingDatabase = records;
      console.log(`Loaded ${records.length} pricing records from Google Sheet.`);
      console.log("Sample Records:", records.slice(0, 3).map(r => ({
        id: r.id,
        type: r.sign_type,
        dim: `${r.dimensions.height}" x ${r.dimensions.width}"`,
        cost: r.manufacture_cost
      })));
    }
  } catch (error) {
    console.error('Error fetching Google Sheet:', error);
    throw error;
  }
}

function getSystemInstruction(records: PricingRecord[]) {
  const limitedDatabase = records.slice(0, 500);
  return `
You are "Blink Estimator", a pricing estimator agent for commercial signage.

NON-NEGOTIABLE RULES
1) You must estimate COST using ONLY the company’s internal pricing dataset provided to you as a tool (PRICING KNOWLEDGE BASE section below). Do NOT use internet knowledge, general market rates, or assumptions not supported by the dataset.
2) If the database does not contain enough information to price the request, you must still return an estimate but:
   - clearly label it as “LOW CONFIDENCE”
   - explain exactly which inputs are missing
   - choose the closest-matching records and show how you interpolated/extrapolated (height bands, area bands, complexity bands, mounting method).
3) Always separate “Manufacture Cost” from “Install/Other” and default to Manufacture Cost ONLY unless the user explicitly asks for install or other.
4) Always return a structured JSON response exactly matching the schema below, plus a short human-readable summary.
5) DO NOT HALLUCINATE FEATURES. If the input scope says "Illumination: None" or null, do not assume it has illumination. If it's an ADA sign, it is almost never illuminated unless explicitly stated.
6) DO NOT GUESS DIMENSIONS. Use the dimensions provided in the scope.
7) If the input scope is missing data, list it in "missing_inputs" and do not invent values for "normalized_inputs".

ESTIMATION LOGIC:
1) Identify sign_type and normalize the scope into a standard feature set (height bands, area bands, mounting type, illumination type, finishes, etc.).
2) Retrieve the closest matching historical records from PRICING KNOWLEDGE BASE:
   - Use a weighted similarity approach:
     - sign_type match is mandatory
     - illumination/mounting/depth/material are high weight
     - dimensions (height/area/length) are high weight
     - finish/print/complexity are medium weight
3) Build an estimate using one of these methods (in priority order):
   a) Direct match median: if you have 3+ close matches within tight tolerances, use the median cost.
   b) Rate-card decomposition: calculate cost using base rate + adders (raceway/PSU/photocell/print/etc.) derived from database medians.
   c) Interpolation/extrapolation: use nearest bands and scale with rules learned from the database (e.g., per-letter-equivalent, per-sqft, per-ft raceway).

IMPORTANT ESTIMATION GUIDELINES (DATABASE-DRIVEN)
Channel Letters:
  - Prefer per “letter-equivalent” or per height band derived from your records.
  - Treat raceway and backer panels as separate components (per-ft or per-sqft) based on database medians.
  - Hardware adders (photocell, timer, remote PSU) must come from database-derived adders; if absent, use closest analog and mark low confidence.
  - Complexity (script/logo/gradient/perf/print) should adjust only if the database supports it (derive multipliers from similar records).
ADA Signs / Panels / Cabinets / Monuments:
  - Use per-sqft, per-unit, or component BOM-style decomposition depending on what the database provides.
  - For structures (pylon/monument), separate: cabinet faces, extrusion/frame, illumination, base/footing (if included), trim, paint, engineering allowances — but ONLY if database contains these patterns. Otherwise, estimate using closest complete historical totals.

QUALITY BAR
Prefer transparency over certainty.
Never fabricate a “standard price” that is not supported by the provided database.
Always show the math and the records used.

Return a structured JSON response matching this schema:
{
  "sign_type": "ChannelLetters" | "ADASign" | "LexanPanel" | "ACMPanel" | "BladeSign" | "CabinetSign" | "PylonSign" | "MonumentSign" | "Other",
  "estimate_scope": {
    "manufacture_included": boolean,
    "install_included": boolean,
    "notes": string[]
  },
  "normalized_inputs": {
    "copy": string | null,
    "qty_sets": number,
    "dimensions": { "width_ft": number | null, "height_ft": number | null, "area_sqft": number | null },
    "letter_height_in": number | null,
    "depth_in": number | null,
    "mounting": string | null,
    "illumination": string | null,
    "raceway_length_ft": number | null,
    "backer_area_sqft": number | null,
    "materials": {},
    "finishes": {},
    "adders": { "remote_psu": boolean, "photocell": boolean, "timer": boolean, "print_or_vinyl": string | null },
    "complexity": { "font_style": string | null, "logo_count": number, "complexity_score": number | null }
  },
  "pricing_method": "direct_match_median" | "ratecard_decomposition" | "interpolation_extrapolation",
  "matched_records": [{ "record_id": string, "why_match": string, "key_fields": { "sign_type": string, "mounting": string, "dimensions": string }, "vendor_location": string, "cost": { "amount": number, "currency": string } }],
  "estimate": {
    "currency": string,
    "manufacture_cost": { "low": number, "mid": number, "high": number },
    "line_items": [{ "name": string, "qty": number, "unit_cost": number, "extended_cost": number, "basis": string }]
  },
  "assumptions": string[],
  "missing_inputs": string[],
  "flags": ["OUT_OF_DISTRIBUTION" | "LOW_DATA" | "MIXED_SOURCING" | "NEEDS_ARTWORK_CONFIRMATION"],
  "confidence": { "score": number, "rationale": string },
  "summary": string
}

PRICING KNOWLEDGE BASE (Showing ${limitedDatabase.length} relevant records):
${JSON.stringify(limitedDatabase, null, 2)}
`;
}

export async function extractSignDetails(
  fileBase64: string,
  mimeType: string
): Promise<ExtractedDetails> {
  const prompt = `
    Analyze this signage design specification sheet and extract all relevant technical details for pricing.
    
    STRICT RULES:
    1. DO NOT GUESS. If a detail (like Illumination, Mounting, or Depth) is not explicitly stated or clearly visible in the design, set it to null or "None".
    2. DO NOT assume "Front-Lit" or any illumination for ADA signs unless explicitly specified.
    3. Focus on:
       - Sign Type (Must be one of: ChannelLetters, ADASign, LexanPanel, ACMPanel, BladeSign, CabinetSign, PylonSign, MonumentSign, Other)
       - Dimensions (INCHES), Mounting, Illumination, Materials.
       - Copy: Read the exact characters/letters/text shown on the sign design.
       - Letter Count: Count the total number of individual letters/characters in the design.
       - Look for any Purchase Order (PO) IDs or Record IDs (e.g., PO-35263) and include them in the description.
    
    Important: 
    1. Convert all dimensions to INCHES.
    2. Keep the "description" and "notes" fields extremely concise (under 200 characters).
    3. DO NOT include any image data or base64 strings.
    4. If you are unsure about a field, leave it as null.
  `;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3.1-pro-preview",
      contents: {
        parts: [
          { inlineData: { data: fileBase64, mimeType } },
          { text: prompt }
        ]
      },
      config: {
        responseMimeType: "application/json",
        maxOutputTokens: 4096,
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            scope: {
              type: Type.OBJECT,
              properties: {
                sign_type: { type: Type.STRING },
                dimensions: {
                  type: Type.OBJECT,
                  properties: {
                    height: { type: Type.NUMBER },
                    width: { type: Type.NUMBER },
                    depth: { type: Type.NUMBER },
                    backer_height: { type: Type.NUMBER },
                    backer_width: { type: Type.NUMBER },
                  }
                },
                mounting: { type: Type.STRING },
                illumination: { type: Type.STRING },
                materials: { type: Type.STRING },
                copy: { type: Type.STRING },
                letter_count: { type: Type.NUMBER },
                return_depth: { type: Type.NUMBER },
                face_material: { type: Type.STRING },
                description: { type: Type.STRING },
              }
            },
            confidence: { type: Type.NUMBER },
            notes: { type: Type.STRING }
          },
          required: ["scope", "confidence", "notes"]
        }
      }
    });

    let text = response.text;
    if (!text) throw new Error("No response from extraction model");
    
    // Clean up potential markdown blocks and whitespace
    text = text.replace(/^```json\n?/, "").replace(/\n?```$/, "").trim();
    
    try {
      return JSON.parse(text) as ExtractedDetails;
    } catch (e) {
      console.warn("Extraction JSON parse failed, attempting repair...");
      try {
        const repaired = jsonrepair(text);
        return JSON.parse(repaired) as ExtractedDetails;
      } catch (repairError) {
        console.error("Failed to parse Gemini response. Length:", text.length, "Start:", text.substring(0, 100));
        throw e;
      }
    }
  } catch (error) {
    console.error("Extraction error:", error);
    throw error;
  }
}

export async function estimatePricing(
  scope: SignScope,
  artwork?: ArtworkContext,
  additionalNotes?: string,
  projectType: 'Government' | 'Standard' = 'Standard',
  hasProgramPricing: boolean = false
): Promise<EstimationResult> {
  // RAG Step: Scoring-based semantic retrieval
  const targetType = (scope.sign_type || '').toLowerCase();
  const targetDesc = (scope.description || additionalNotes || '').toLowerCase();
  const targetMounting = (scope.mounting || '').toLowerCase();
  const targetIllum = (scope.illumination || '').toLowerCase();
  
  let scoredRecords = currentPricingDatabase.map(record => {
    let score = 0;
    const recordId = record.id.toLowerCase();
    const recordType = record.sign_type.toLowerCase();
    const recordDesc = (record.description || '').toLowerCase();
    const recordMounting = (record.mounting || '').toLowerCase();
    const recordIllum = (record.illumination || '').toLowerCase();
    
    // 0. PO ID Match (Absolute Priority)
    // Check if the PO ID is mentioned anywhere in the target description or sign type
    if (targetDesc.includes(recordId) || recordId.includes(targetDesc) || targetType.includes(recordId)) {
      score += 2000; // Massive boost for exact ID match
    }

    // 1. Sign Type Match (Highest Weight)
    if (recordType === targetType) score += 100;
    else if (recordType.includes(targetType) || targetType.includes(recordType)) score += 60;
    
    // 2. Mounting & Illumination Match (High Weight)
    if (targetMounting && (recordMounting.includes(targetMounting) || targetMounting.includes(recordMounting))) score += 45;
    if (targetIllum && (recordIllum.includes(targetIllum) || targetIllum.includes(recordIllum))) score += 45;
    
    // 3. Description Keyword Match (High Weight)
    if (targetDesc || targetType) {
      const targetKeywords = `${targetDesc} ${targetType}`.split(/[\s,.-]+/).filter(k => k.length > 2);
      targetKeywords.forEach(k => {
        if (recordDesc.includes(k)) score += 30;
        if (recordType.includes(k)) score += 30;
      });
    }
    
    // 4. Dimension Similarity (Medium Weight)
    if (scope.dimensions && record.dimensions) {
      const targetH = scope.dimensions.height || 0;
      const targetW = scope.dimensions.width || 0;
      const hDiff = Math.abs(targetH - record.dimensions.height);
      const wDiff = Math.abs(targetW - record.dimensions.width);
      
      if (hDiff < 1 && wDiff < 1) score += 100; // Exact or near-exact dimensions
      else if (hDiff < 3 && wDiff < 3) score += 60; 
      else if (hDiff < 6 && wDiff < 6) score += 40; 
      else if (hDiff < 12 && wDiff < 12) score += 20;
    }
    
    return { record, score };
  });

  // Filter and sort by score
  let scoredItems = scoredRecords
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score);

  console.log("Top RAG Scores:", scoredItems.slice(0, 5).map(i => ({ 
    id: i.record.id, 
    score: i.score, 
    type: i.record.sign_type,
    dim: `${i.record.dimensions.height}" x ${i.record.dimensions.width}"`
  })));

  let relevantRecords = scoredItems.map(item => item.record);

  // If no matches, fallback to a general sample
  if (relevantRecords.length === 0) {
    relevantRecords = currentPricingDatabase.slice(0, 100);
  } else if (relevantRecords.length > 100) {
    // Limit context size for better focus
    relevantRecords = relevantRecords.slice(0, 100);
  }

  console.log(`RAG: Retrieved ${relevantRecords.length} relevant pricing vectors for ${scope.sign_type}`);

  const prompt = `
    Estimate the cost for the following sign scope:
    Scope: ${JSON.stringify(scope, null, 2)}
    Artwork Context: ${JSON.stringify(artwork || {}, null, 2)}
    Additional Context/Notes: ${additionalNotes || 'None'}

    STRICT RULES:
    1. DO NOT HALLUCINATE FEATURES. If the Scope says "illumination": null or "None", the "normalized_inputs" MUST reflect that.
    2. DO NOT assume an ADA sign is illuminated unless explicitly stated in the Scope.
    3. If a parameter is missing from the Scope, list it in "missing_inputs" and do not guess its value in "normalized_inputs".
    4. Use the provided Scope as the absolute source of truth for the sign's physical characteristics.
    5. You MUST include the most relevant records from the PRICING KNOWLEDGE BASE in the "matched_records" field. These records are the foundation of your estimate. Do not leave this array empty if records were provided in the system instruction.

    Provide the response in the following JSON format:
    {
      "sign_type": string,
      "estimate_scope": { "manufacture_included": boolean, "install_included": boolean, "notes": string[] },
      "normalized_inputs": { ... },
      "pricing_method": string,
      "matched_records": [{ "record_id": string, "po_number": string, "why_match": string, "key_fields": { "sign_type": string, "mounting": string, "dimensions": string }, "vendor_location": string, "cost": { "amount": number, "currency": string } }],
      "estimate": { "currency": string, "manufacture_cost": { "low": number, "mid": number, "high": number }, "line_items": [{ "name": string, "qty": number, "unit_cost": number, "extended_cost": number, "basis": string }] },
      "assumptions": string[],
      "missing_inputs": string[],
      "flags": string[],
      "confidence": { "score": number, "rationale": string }
    }
  `;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3.1-pro-preview",
      contents: prompt,
      config: {
        systemInstruction: getSystemInstruction(relevantRecords),
        responseMimeType: "application/json",
        maxOutputTokens: 4096,
        thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH },
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            sign_type: { type: Type.STRING },
            estimate_scope: {
              type: Type.OBJECT,
              properties: {
                manufacture_included: { type: Type.BOOLEAN },
                install_included: { type: Type.BOOLEAN },
                notes: { type: Type.ARRAY, items: { type: Type.STRING } },
              },
              required: ["manufacture_included", "install_included", "notes"],
            },
            normalized_inputs: {
              type: Type.OBJECT,
              properties: {
                sign_type: { type: Type.STRING },
                copy: { type: Type.STRING },
                letter_count: { type: Type.NUMBER },
                qty_sets: { type: Type.NUMBER },
                dimensions: {
                  type: Type.OBJECT,
                  properties: {
                    width_ft: { type: Type.NUMBER },
                    height_ft: { type: Type.NUMBER },
                    area_sqft: { type: Type.NUMBER },
                  },
                  required: ["width_ft", "height_ft", "area_sqft"],
                },
                letter_height_in: { type: Type.NUMBER },
                depth_in: { type: Type.NUMBER },
                mounting: { type: Type.STRING },
                illumination: { type: Type.STRING },
                raceway_length_ft: { type: Type.NUMBER },
                backer_area_sqft: { type: Type.NUMBER },
                materials: { type: Type.OBJECT },
                finishes: { type: Type.OBJECT },
                adders: {
                  type: Type.OBJECT,
                  properties: {
                    remote_psu: { type: Type.BOOLEAN },
                    photocell: { type: Type.BOOLEAN },
                    timer: { type: Type.BOOLEAN },
                    print_or_vinyl: { type: Type.STRING },
                  },
                  required: ["remote_psu", "photocell", "timer", "print_or_vinyl"],
                },
                complexity: {
                  type: Type.OBJECT,
                  properties: {
                    font_style: { type: Type.STRING },
                    logo_count: { type: Type.NUMBER },
                    complexity_score: { type: Type.NUMBER },
                  },
                  required: ["font_style", "logo_count", "complexity_score"],
                },
              },
              required: [
                "copy", "letter_count", "qty_sets", "dimensions", "letter_height_in", "depth_in",
                "mounting", "illumination", "raceway_length_ft", "backer_area_sqft",
                "materials", "finishes", "adders", "complexity"
              ],
            },
            pricing_method: { type: Type.STRING },
            matched_records: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  record_id: { type: Type.STRING },
                  po_number: { type: Type.STRING },
                  why_match: { type: Type.STRING },
                  key_fields: {
                    type: Type.OBJECT,
                    properties: {
                      sign_type: { type: Type.STRING },
                      mounting: { type: Type.STRING },
                      dimensions: { type: Type.STRING },
                    },
                    required: ["sign_type", "mounting", "dimensions"],
                  },
                  vendor_location: { type: Type.STRING },
                  cost: {
                    type: Type.OBJECT,
                    properties: {
                      amount: { type: Type.NUMBER },
                      currency: { type: Type.STRING },
                    },
                    required: ["amount", "currency"],
                  },
                },
                required: ["record_id", "why_match", "key_fields", "cost"],
              },
            },
            estimate: {
              type: Type.OBJECT,
              properties: {
                currency: { type: Type.STRING },
                manufacture_cost: {
                  type: Type.OBJECT,
                  properties: {
                    low: { type: Type.NUMBER },
                    mid: { type: Type.NUMBER },
                    high: { type: Type.NUMBER },
                  },
                  required: ["low", "mid", "high"],
                },
                line_items: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      name: { type: Type.STRING },
                      qty: { type: Type.NUMBER },
                      unit_cost: { type: Type.NUMBER },
                      extended_cost: { type: Type.NUMBER },
                      basis: { type: Type.STRING },
                    },
                    required: ["name", "qty", "unit_cost", "extended_cost", "basis"],
                  },
                },
              },
              required: ["currency", "manufacture_cost", "line_items"],
            },
            assumptions: { type: Type.ARRAY, items: { type: Type.STRING } },
            missing_inputs: { type: Type.ARRAY, items: { type: Type.STRING } },
            flags: { type: Type.ARRAY, items: { type: Type.STRING } },
            confidence: {
              type: Type.OBJECT,
              properties: {
                score: { type: Type.NUMBER },
                rationale: { type: Type.STRING },
              },
              required: ["score", "rationale"],
            },
            summary: { type: Type.STRING },
          },
          required: [
            "sign_type",
            "estimate_scope",
            "normalized_inputs",
            "pricing_method",
            "matched_records",
            "estimate",
            "assumptions",
            "missing_inputs",
            "flags",
            "confidence",
            "summary",
          ],
        },
      },
    });

    if (!response.text) {
      throw new Error("No response from Gemini");
    }
    
    let text = response.text;
    if (!text) {
      throw new Error("No response from Gemini");
    }
    
    // Clean up potential markdown blocks and whitespace
    text = text.replace(/^```json\n?/, "").replace(/\n?```$/, "").trim();

    try {
      let result: EstimationResult;
      try {
        result = JSON.parse(text) as EstimationResult;
      } catch (e) {
        console.warn("Standard JSON parse failed, attempting repair with jsonrepair...");
        const repaired = jsonrepair(text);
        result = JSON.parse(repaired) as EstimationResult;
      }

      // CORRECTION LAYER: If AI returns 0 but has matches, force a median calculation
      if (result.estimate && (result.estimate.manufacture_cost?.mid === 0 || !result.estimate.manufacture_cost) && Array.isArray(result.matched_records) && result.matched_records.length > 0) {
        const costs = result.matched_records
          .map(r => r.cost?.amount)
          .filter((c): c is number => typeof c === 'number' && c > 0)
          .sort((a, b) => a - b);
        
        if (costs.length > 0) {
          const mid = costs[Math.floor(costs.length / 2)];
          result.estimate.manufacture_cost = {
            low: Math.round(mid * 0.9),
            mid: Math.round(mid),
            high: Math.round(mid * 1.1)
          };
          
          // Also fix line items if empty or zeroed
          const hasValidLineItems = Array.isArray(result.estimate.line_items) && 
                                   result.estimate.line_items.length > 0 && 
                                   result.estimate.line_items.some(i => (i.extended_cost || 0) > 0);
          
          if (!hasValidLineItems) {
            result.estimate.line_items = [{
              name: `Base ${result.sign_type || 'Sign'} Manufacture`,
              qty: result.normalized_inputs?.qty_sets || 1,
              unit_cost: mid,
              extended_cost: mid * (result.normalized_inputs?.qty_sets || 1),
              basis: 'Derived from matched historical records (Median)'
            }];
          }
          
          result.pricing_method = 'direct_match_median';
          result.summary += " (Note: Estimate corrected using median of matched records as AI returned zero cost)";
          if (Array.isArray(result.flags)) {
            result.flags.push('NEEDS_ARTWORK_CONFIRMATION');
          }
        }
      }

      // FALLBACK: If matched_records is empty but we have relevant records, populate with top 3
      if ((!Array.isArray(result.matched_records) || result.matched_records.length === 0) && relevantRecords.length > 0) {
        result.matched_records = relevantRecords.slice(0, 3).map(r => ({
          record_id: r.id,
          po_number: r.po_number || '',
          why_match: `Highly relevant historical record for ${r.sign_type} based on semantic similarity.`,
          key_fields: {
            sign_type: r.sign_type,
            mounting: r.mounting,
            dimensions: `${r.dimensions.height}" x ${r.dimensions.width}"`
          },
          vendor_location: r.vendor_location,
          cost: {
            amount: r.manufacture_cost,
            currency: 'USD'
          }
        }));
        result.summary += " (Note: Matched records populated from historical database search)";
      }

      // Determine pricing source from matched records
      const matchedRecords = Array.isArray(result.matched_records) ? result.matched_records : [];
      const matchedIds = matchedRecords.map(r => r.record_id);
      const matchedFullRecords = currentPricingDatabase.filter(r => matchedIds.includes(r.id));
      
      // Add vendor_location to matched_records
      if (Array.isArray(result.matched_records)) {
        result.matched_records = result.matched_records.map(r => {
          const full = currentPricingDatabase.find(f => f.id === r.record_id);
          return {
            ...r,
            vendor_location: full?.vendor_location
          };
        });
      }

      const locations = matchedFullRecords.map(r => (r.vendor_location || 'USA').toUpperCase());
      const hasOverseas = locations.some(l => l.includes('CHINA') || l.includes('OVERSEAS') || l.includes('OVERSEES'));
      const hasCanada = locations.some(l => l.includes('CANADA'));
      
      if (hasOverseas) {
        result.pricing_source = 'Overseas';
      } else if (hasCanada) {
        result.pricing_source = 'Canada';
      } else {
        result.pricing_source = 'USA';
      }

      // Calculate overseas estimate if source is USA
      if (result.pricing_source === 'USA' && result.estimate?.manufacture_cost) {
        const mid = result.estimate.manufacture_cost.mid;
        result.overseas_estimate = {
          mid: Math.round(mid * 0.6), // 40% reduction
          savings: Math.round(mid * 0.4)
        };
      }

      // Calculate Selling Price
      const shouldCalculateSellingPrice = projectType === 'Government' || !hasProgramPricing;
      if (shouldCalculateSellingPrice && result.estimate?.manufacture_cost && result.estimate?.line_items) {
        let margin = 0;
        const isOS = result.pricing_source === 'Overseas';
        
        if (projectType === 'Government') {
          margin = isOS ? 0.5 : 0;
        } else {
          margin = isOS ? 0.5 : 0.3;
        }

        result.selling_price = {
          mid: Math.round((result.estimate.manufacture_cost.mid || 0) * (1 + margin)),
          line_items: (Array.isArray(result.estimate.line_items) ? result.estimate.line_items : []).map(item => ({
            name: item.name || 'Unknown Item',
            qty: item.qty || 0,
            unit_price: Math.round((item.unit_cost || 0) * (1 + margin) * 100) / 100,
            extended_price: Math.round((item.extended_cost || 0) * (1 + margin) * 100) / 100
          }))
        };
      }

      return result;
    } catch (e) {
      console.error("Failed to parse or process Estimation response. Length:", text.length, "Start:", text.substring(0, 100));
      throw e;
    }
  } catch (error) {
    console.error("Estimation error:", error);
    throw error;
  }
}
