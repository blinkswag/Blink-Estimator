import { GoogleGenAI, Type, ThinkingLevel } from "@google/genai";
import { jsonrepair } from "jsonrepair";
import { EstimationResult, SignScope, ArtworkContext, PricingRecord, ExtractedDetails, DEFAULT_SHEET_ID, SignType } from "../types";

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
      const poId = record.sku || record.id || record.record_id || record.purchase_order_id || record.po_id || '';
      const poDisplay = record.purchase_order_number || record.po_number || record.po || poId || '';

      records.push({
        id: String(poId || `GS-${i}`),
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
You are “Blink Estimator”, a pricing estimator agent for commercial signage.

NON-NEGOTIABLE RULES
1) You must estimate COST using ONLY the company’s internal pricing dataset provided to you as a tool (PRICING KNOWLEDGE BASE section below). Do NOT use internet knowledge, general market rates, or assumptions not supported by the dataset.
2) If the database does not contain enough information to price the request, you must still return an estimate but:
   - clearly label it as “LOW CONFIDENCE”
   - explain exactly which inputs are missing
   - choose the closest-matching records and show how you interpolated/extrapolated (height bands, area bands, complexity bands, mounting method).
3) Always separate “Manufacture Cost” from “Install/Other” and default to Manufacture Cost ONLY unless the user explicitly asks for install or other.
4) Always return a structured JSON response exactly matching the schema below, plus a short human-readable summary.

YOU WILL RECIEVE ONE OR MORE OF THE FOLLOWING INPUTS.
A) sign_scope (user provided): text + optional structured fields (sign type, dimensions, mounting, materials, illumination, depth, raceway/backer length/area, face treatment, number of letters, logo count, etc.)
B) artwork_context (optional): details extracted by the app (letter count, letter height estimate, complexity score, logo shapes count, stroke thickness flags, etc.)

YOUR TASK
Given sign_scope + artwork_context + pricing_database:
1) Identify sign_type and normalize the scope into a standard feature set (height bands, area bands, mounting type, illumination type, finishes, etc.).
2) Retrieve the closest matching historical records from pricing_database:
   - Use a weighted similarity approach:
     - sign_type match is mandatory
     - illumination/mounting/depth/material are high weight
     - dimensions (height/area/length) are high weight
     - finish/print/complexity are medium weight
3) Build an estimate using one of these methods (in priority order):
   a) Direct match median: if you have 3+ close matches within tight tolerances, use the median cost.
   b) Rate-card decomposition: calculate cost using base rate + adders (raceway/PSU/photocell/print/etc.) derived from database medians.
   c) Interpolation/extrapolation: use nearest bands and scale with rules learned from the database (e.g., per-letter-equivalent, per-sqft, per-ft raceway).
4) Output:
   - Low / MostLikely / High range (manufacture cost)
   - Line-item breakdown with formulas
   - Data lineage: the record IDs used, their costs, and why selected. Include 3-8 relevant records in the "matched_records" list to provide pricing context.
   - Confidence score 0–100 and explanation
   - Flags: missing inputs, out-of-distribution, inconsistent scope

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

++++++++++++++++++++++++++++++++++++++
PRICING KNOWLEDGE BASE (Showing ${limitedDatabase.length} relevant records):
${JSON.stringify(limitedDatabase, null, 2)}
`;
}

// Helper to normalize extracted sign types to internal enums
function normalizeSignType(type: string | undefined | null): SignType {
  if (!type) return 'Other';
  const t = type.toLowerCase();
  if (t.includes('channel') || t.includes('letter') || t.includes('illuminated letters')) return 'ChannelLetters';
  if (t.includes('ada') || t.includes('braille') || t.includes('tactile')) return 'ADASign';
  if (t.includes('lexan')) return 'LexanPanel';
  if (t.includes('acm')) return 'ACMPanel';
  if (t.includes('acrylic')) return 'AcrylicPanel';
  if (t.includes('blade') || t.includes('projecting')) return 'BladeSign';
  if (t.includes('pylon')) return 'PylonSign';
  if (t.includes('monument')) return 'MonumentSign';
  if (t.includes('cabinet') || t.includes('box') || t.includes('canister')) return 'CabinetSign';
  return 'Other';
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
       - Letter Count: Count the total number of individual letters/characters.
       - SKU/Record ID: Look for any specific alphanumeric identifiers (e.g., #SIGN021-WS, PO-35263). This is CRITICAL for matching.
    4. Composite Sign Detection:
       - If the drawing shows a mix of elements (e.g., a "Bullseye Logo" AND "target letters"), analyze them as a COMPOSITE SET. 
       - Total Area: Pay attention to "SIGN AREA" or "SQ. FT." in tables. For the Target example, it is 537.36 SF.
       - Component Breakdown: List the components in the description (e.g., "6' Logo + 5' Letters").
    
    Important: 
    1. Convert all dimensions to INCHES.
    2. Keep the "description" and "notes" fields extremely concise (under 200 characters) but include SKUs here.
    3. DO NOT include any image data or base64 strings.
    4. If you are unsure about a field, leave it as null.
  `;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3.1-pro-preview-customtools",
      contents: {
        parts: [
          { inlineData: { data: fileBase64, mimeType } },
          { text: prompt }
        ]
      },
      config: {
        responseMimeType: "application/json",
        maxOutputTokens: 4096,
        thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH },
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            scope: {
              type: Type.OBJECT,
              properties: {
                sign_type: { type: Type.STRING },
                sku: { type: Type.STRING, description: "Extract any SKU starting with # or including ID strings like 'SIGN021-WS'" },
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
    
    // Clean up potential markdown blocks, thinking blocks, and whitespace
    text = text.replace(/<thought>[\s\S]*?<\/thought>/g, ""); // Remove thinking blocks
    text = text.replace(/```json\s?/g, "").replace(/```/g, "").trim();
    
    // Find absolute start/end of JSON to strip any surrounding chatter
    const startIdx1 = text.indexOf('{');
    const endIdx1 = text.lastIndexOf('}');
    if (startIdx1 !== -1 && endIdx1 !== -1 && endIdx1 > startIdx1) {
      text = text.substring(startIdx1, endIdx1 + 1);
    }
    
    try {
      const parsed = JSON.parse(text) as ExtractedDetails;
      // Normalize sign_type immediately to ensure consistency
      if (parsed.scope) {
        parsed.scope.sign_type = normalizeSignType(parsed.scope.sign_type as string);
      }
      return parsed;
    } catch (e) {
      console.warn("Extraction JSON parse failed, attempting repair...");
      try {
        const repaired = jsonrepair(text);
        return JSON.parse(repaired) as ExtractedDetails;
      } catch (repairError) {
        console.error("CRITICAL: Failed to parse extraction response. Raw text snippet:", text.substring(0, 500));
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
  // Ensure the target sign_type is normalized before scoring
  const normalizedTargetType = normalizeSignType(scope.sign_type as string);
  const targetType = normalizedTargetType.toLowerCase();
  const targetSku = (scope.sku || '').toLowerCase();
  const targetDesc = (scope.description || additionalNotes || '').toLowerCase();
  const targetMounting = (scope.mounting || '').toLowerCase();
  const targetIllum = (scope.illumination || '').toLowerCase();
  
  // Materials keywords for prioritized matching
  const targetMaterialsJson = scope.materials ? JSON.stringify(scope.materials).toLowerCase() : '';
  const targetMaterialsKeywords = (targetDesc + " " + targetMaterialsJson).toLowerCase();
  
  // Extract potential SKUs/IDs from the target description (e.g., #SIGN021-WS, PO-34487)
  const skuRegex = /(?:sku|id|po|#)\s*[:#-]?\s*([a-z0-9_-]+)/gi;
  const matches = [...targetDesc.matchAll(skuRegex)];
  const extractedIds = matches.map(m => m[1].toLowerCase());
  if (targetSku) extractedIds.push(targetSku.toLowerCase());
  
  // Also look for specific brand keywords that might indicate a brand-standard exact match
  const isTargetBrand = targetDesc.includes('target') || targetDesc.includes('bullseye');
  
  console.log(`RAG Debug: SKU=${targetSku}, Type=${targetType}, ExtractedIDs=[${extractedIds.join(',')}]`);
  
  let scoredRecords = currentPricingDatabase.map(record => {
    let score = 0;
    const recordId = String(record.id).toLowerCase();
    const recordPO = String(record.po_number || '').toLowerCase();
    const recordType = record.sign_type.toLowerCase();
    const recordDesc = (record.description || '').toLowerCase();
    const recordMounting = (record.mounting || '').toLowerCase();
    const recordIllum = (record.illumination || '').toLowerCase();
    const recordMaterials = (record.materials || '').toLowerCase();
    
    // 0. PO ID / SKU Match (Absolute Priority)
    const isIdMatch = recordId === targetSku ||
                      recordPO === targetSku ||
                      extractedIds.some(id => 
                        recordId === id || 
                        recordPO === id || 
                        recordId.includes(id) || 
                        recordPO.includes(id) ||
                        id.includes(recordId) ||
                        (recordPO && id.includes(recordPO))
                      );

    if (isIdMatch) {
      score += 3000; // Even greater boost for definitive ID/PO match
    }

    // 0.1 Brand Match (Target specifically mentioned in user instructions)
    if (isTargetBrand && (recordDesc.includes('target') || recordDesc.includes('bullseye') || recordId.includes('target'))) {
      score += 500; // Significant boost for matching brand standards
    }

    // 0.2 Composite Components Match (Logo + Letters)
    const isCompositeTarget = targetDesc.includes('logo') && (targetDesc.includes('letter') || targetDesc.includes('copy'));
    const isCompositeRecord = recordDesc.includes('logo') && (recordDesc.includes('letter') || recordDesc.includes('copy'));
    if (isCompositeTarget && isCompositeRecord) score += 300; // Reward for matching composite structure

    // 1. Sign Type Match (Highest Weight)
    // Exact match is king
    if (recordType === targetType) {
      score += 700; // Increased to prioritize core type
    }
    // Substring match
    else if (recordType.includes(targetType) || targetType.includes(recordType)) {
      score += 350; 
    } else {
      // PENALTY: Significant penalty if sign types are completely different (no common substring)
      // This prevents "Blade Sign" from matching "Pylon Sign" just via generic keywords
      score -= 300;
    }
    
    // 2. Mounting & Illumination Match (Low Weight - "Not construction method")
    // Only match if they aren't 'n/a' or empty
    if (targetMounting && targetMounting !== 'n/a' && (recordMounting.includes(targetMounting) || targetMounting.includes(recordMounting))) score += 20;
    if (targetIllum && targetIllum !== 'n/a' && (recordIllum.includes(targetIllum) || targetIllum.includes(recordIllum))) score += 45;

    // 2.5 Material Match (High Weight - New Priority)
    if (targetMaterialsKeywords && recordMaterials) {
       const stopWords = new Set(['sign', 'signs', 'with', 'and', 'the', 'item', 'details']);
       const matKeywords = targetMaterialsKeywords.split(/[\s,.-]+/)
          .filter(k => k.length > 3 && !stopWords.has(k));
       
       matKeywords.forEach(mw => {
          if (recordMaterials.includes(mw)) score += 50;
       });
    }
    
    // 3. Description Keyword Match (Filtered)
    if (targetDesc || targetType) {
      // Split composite words and filter out common generic terms
      const stopWords = new Set(['sign', 'signs', 'type', 'mounting', 'fabrication', 'manufacture', 'included', 'item', 'details', 'notes', 'other']);
      const targetKeywords = `${targetDesc} ${targetType}`
        .split(/[\s,.-]+|(?=[A-Z])/) // Split by space, punctuation, or camelCase
        .map(k => k.toLowerCase())
        .filter(k => k.length > 2 && !stopWords.has(k));
      
      targetKeywords.forEach(k => {
        // High reward for matching specific fabrication keywords
        if (recordDesc.includes(k)) score += 40; 
        if (recordType.includes(k)) score += 50; 
      });
    }
    
    // 4. Dimension Similarity (Medium Weight)
    if (scope.dimensions && record.dimensions) {
      const targetH = scope.dimensions.height || 0;
      const targetW = scope.dimensions.width || 0;
      const targetArea = (scope.dimensions as any).area_sqft || 0;
      
      const recH = record.dimensions.height || 0;
      const recW = record.dimensions.width || 0;
      
      // Calculate area if not provided (approximate)
      const recArea = (recH * recW) / 144;
      
      // Ignore 0x0 placeholder matches if they dominate the results
      if (targetH > 0 && targetW > 0 && recH > 0 && recW > 0) {
        const hDiff = Math.abs(targetH - recH);
        const wDiff = Math.abs(targetW - recW);
        const hDiffRev = Math.abs(targetH - recW);
        const wDiffRev = Math.abs(targetW - recH);
        
        if ((hDiff < 1 && wDiff < 1) || (hDiffRev < 1 && wDiffRev < 1)) score += 200;
        else if ((hDiff < 3 && wDiff < 3) || (hDiffRev < 3 && wDiffRev < 3)) score += 120;
        
        // Area Match (very high precision for cabinets/pylons)
        if (targetArea > 0 && recArea > 0) {
          const areaDiff = Math.abs(targetArea - recArea);
          if (areaDiff < 2) score += 250; // High reward for matching square footage
          else if (areaDiff < 10) score += 100;
        }
      } else if (targetH === 0 && targetW === 0 && recH === 0 && recW === 0) {
        // Low priority match for "data-less" records
        score += 10;
      }
    }
    
    return { record, score };
  });

  // Filter and sort by score
  // Added ID as secondary sort key to ensure 100% determinism on tied scores
  let scoredItems = scoredRecords
    .filter(item => item.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return String(b.record.id).localeCompare(String(a.record.id));
    });

  console.log("Top RAG Scores:", scoredItems.slice(0, 5).map(i => ({ 
    id: i.record.id, 
    score: i.score, 
    type: i.record.sign_type,
    dim: `${i.record.dimensions.height}" x ${i.record.dimensions.width}"`
  })));

  let relevantRecords = scoredItems.map(item => item.record);

  // If no matches, fallback to a general sample
  if (relevantRecords.length === 0) {
    relevantRecords = currentPricingDatabase.slice(0, 25);
  } else if (relevantRecords.length > 25) {
    // Limit context size for better focus
    relevantRecords = relevantRecords.slice(0, 25);
  }

  console.log(`RAG: Retrieved ${relevantRecords.length} relevant pricing records for type: "${scope.sign_type}" (Top Score: ${scoredItems[0]?.score || 0})`);

  const topExactMatch = scoredItems[0]?.score >= 1000 ? scoredItems[0].record : null;

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
    5. You MUST include the most relevant records from the PRICING KNOWLEDGE BASE in the "matched_records" field.
    6. **CRITICAL: EXACT SKU MATCH**: If a record in the database has an ID that matches the SKU in the Scope (e.g. #SIGN021-WS), you MUST use that record's cost as your primary basis and set it as the Mid estimate.
    7. **IMPORTANT**: If manufacture is included, the "manufacture_cost" MUST NOT be $0.

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
      model: "gemini-3.1-pro-preview-customtools",
      contents: prompt,
      config: {
        systemInstruction: getSystemInstruction(relevantRecords),
        responseMimeType: "application/json",
        maxOutputTokens: 4096,
        thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH },
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            sign_type: { 
              type: Type.STRING, 
              enum: ["ChannelLetters", "ADASign", "LexanPanel", "ACMPanel", "BladeSign", "CabinetSign", "PylonSign", "MonumentSign", "Other"] 
            },
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
                copy: { type: Type.STRING, nullable: true },
                qty_sets: { type: Type.NUMBER },
                dimensions: {
                  type: Type.OBJECT,
                  properties: {
                    width_ft: { type: Type.NUMBER, nullable: true },
                    height_ft: { type: Type.NUMBER, nullable: true },
                    area_sqft: { type: Type.NUMBER, nullable: true },
                  },
                  required: ["width_ft", "height_ft", "area_sqft"],
                },
                letter_height_in: { type: Type.NUMBER, nullable: true },
                depth_in: { type: Type.NUMBER, nullable: true },
                mounting: { type: Type.STRING, nullable: true },
                illumination: { type: Type.STRING, nullable: true },
                raceway_length_ft: { type: Type.NUMBER, nullable: true },
                backer_area_sqft: { type: Type.NUMBER, nullable: true },
                materials: { type: Type.OBJECT },
                finishes: { type: Type.OBJECT },
                adders: {
                  type: Type.OBJECT,
                  properties: {
                    remote_psu: { type: Type.BOOLEAN },
                    photocell: { type: Type.BOOLEAN },
                    timer: { type: Type.BOOLEAN },
                    print_or_vinyl: { type: Type.STRING, nullable: true },
                  },
                  required: ["remote_psu", "photocell", "timer", "print_or_vinyl"],
                },
                complexity: {
                  type: Type.OBJECT,
                  properties: {
                    font_style: { type: Type.STRING, nullable: true },
                    logo_count: { type: Type.NUMBER },
                    complexity_score: { type: Type.NUMBER, nullable: true },
                  },
                  required: ["font_style", "logo_count", "complexity_score"],
                },
              },
              required: [
                "copy", "qty_sets", "dimensions", "letter_height_in", "depth_in",
                "mounting", "illumination", "raceway_length_ft", "backer_area_sqft",
                "materials", "finishes", "adders", "complexity"
              ],
            },
            pricing_method: { 
              type: Type.STRING, 
              enum: ["direct_match_median", "ratecard_decomposition", "interpolation_extrapolation"] 
            },
            matched_records: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  record_id: { type: Type.STRING },
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
            flags: { 
              type: Type.ARRAY, 
              items: { 
                type: Type.STRING,
                enum: ["OUT_OF_DISTRIBUTION", "LOW_DATA", "MIXED_SOURCING", "NEEDS_ARTWORK_CONFIRMATION"]
              } 
            },
            confidence: {
              type: Type.OBJECT,
              properties: {
                score: { type: Type.NUMBER },
                rationale: { type: Type.STRING },
              },
              required: ["score", "rationale"],
            },
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
    
    // Clean up potential markdown blocks, thinking blocks, and whitespace
    text = text.replace(/<thought>[\s\S]*?<\/thought>/g, ""); // Remove thinking blocks
    text = text.replace(/```json\s?/g, "").replace(/```/g, "").trim();
    
    // Replace non-standard JSON values that Gemini sometimes outputs
    text = text.replace(/:\s?NaN/g, ": null")
               .replace(/:\s?Infinity/g, ": 999999")
               .replace(/:\s?undefined/g, ": null"); // Also handle undefined
    
    // Find absolute start/end of JSON to strip any surrounding chatter
    // If there are multiple objects, we try to take the one that seems most complete (estimate field)
    const jsonObjects: string[] = [];
    let searchIdx = 0;
    while (true) {
      const start = text.indexOf('{', searchIdx);
      if (start === -1) break;
      
      // Basic brace counting to find end of object
      let braceCount = 0;
      let end = -1;
      for (let i = start; i < text.length; i++) {
        if (text[i] === '{') braceCount++;
        else if (text[i] === '}') braceCount--;
        
        if (braceCount === 0) {
          end = i;
          break;
        }
      }
      
      if (end !== -1) {
        jsonObjects.push(text.substring(start, end + 1));
        searchIdx = end + 1;
      } else {
        break;
      }
    }
    
    if (jsonObjects.length > 0) {
      // Pick the object that contains "estimate" or is just the longest
      const bestObject = jsonObjects.sort((a, b) => {
        const aHasEst = a.includes('"estimate"') ? 1 : 0;
        const bHasEst = b.includes('"estimate"') ? 1 : 0;
        if (aHasEst !== bHasEst) return bHasEst - aHasEst;
        return b.length - a.length;
      })[0];
      text = bestObject;
    }

    try {
      let result: EstimationResult;
      try {
        result = JSON.parse(text) as EstimationResult;
      } catch (e) {
        console.warn("Standard JSON parse failed, attempting repair with jsonrepair...");
        try {
          const repaired = jsonrepair(text);
          result = JSON.parse(repaired) as EstimationResult;
        } catch (repairError) {
          console.error("CRITICAL: Failed to parse estimation response. Raw text snippet:", text.substring(0, 500));
          throw e;
        }
      }

      // NORMALIZE: Ensure the structure has all required fields to prevent "undefined" property access
      if (!result.estimate) result.estimate = { currency: 'USD', manufacture_cost: { low: 0, mid: 0, high: 0 }, line_items: [] };
      if (!result.estimate.manufacture_cost) result.estimate.manufacture_cost = { low: 0, mid: 0, high: 0 };
      if (!result.estimate.line_items) result.estimate.line_items = [];
      if (!result.confidence) result.confidence = { score: 0, rationale: "" };
      if (!result.matched_records) result.matched_records = [];
      if (!result.flags) result.flags = [];
      if (!result.missing_inputs) result.missing_inputs = [];
      if (!result.assumptions) result.assumptions = [];

      // Ensure all matched_records have accurate cost and po_number data from the local database
      if (Array.isArray(result.matched_records)) {
        result.matched_records = result.matched_records.map(r => {
          // Fuzzier matching: check ID, PO Number, and sign type + dimensions fingerprint
          const full = currentPricingDatabase.find(f => {
            const fId = String(f.id).toLowerCase();
            const rId = String(r.record_id || '').toLowerCase();
            const fPO = String(f.po_number || '').toLowerCase();
            const rPO = String(r.po_number || '').toLowerCase();
            
            return fId === rId || (fPO && fPO === rId) || (fPO === rPO && fPO !== '');
          });
          
          return {
            ...r,
            po_number: full?.po_number || r.po_number || '',
            vendor_location: full?.vendor_location || r.vendor_location,
            cost: {
              amount: full?.manufacture_cost || r.cost?.amount || 0,
              currency: r.cost?.currency || 'USD'
            }
          };
        });
      }

      // SUPPLEMENTAL: If AI returns very few records, supplement with our top RAG results for context
      const recordsCount = Array.isArray(result.matched_records) ? result.matched_records.length : 0;
      if (recordsCount < 5 && relevantRecords.length > 0) {
        if (!result.matched_records) result.matched_records = [];
        
        const existingIds = new Set(result.matched_records.map(r => r.record_id));
        const needed = 5 - recordsCount;
        let added = 0;
        
        for (const r of relevantRecords) {
          if (added >= needed) break;
          if (!existingIds.has(r.id)) {
            result.matched_records.push({
              record_id: r.id,
              po_number: r.po_number || '',
              why_match: `Supplemental context: Historical record for ${r.sign_type} with similar specifications.`,
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
            });
            added++;
          }
        }
      }

      // CORRECTION LAYER: If AI returns 0 or missing costs, force a calculation from matched records
      let midCostValue = result.estimate?.manufacture_cost?.mid;
      const isZeroOrMissing = midCostValue === 0 || midCostValue === undefined || midCostValue === null || isNaN(midCostValue as number);
      
      // Modified check: run even if estimate object is missing entirely
      if ((!result.estimate || isZeroOrMissing) && Array.isArray(result.matched_records) && result.matched_records.length > 0) {
        if (!result.estimate) {
          result.estimate = {
            currency: 'USD',
            manufacture_cost: { low: 0, mid: 0, high: 0 },
            line_items: []
          };
        }
        
        const costs = result.matched_records
          .map(r => r.cost?.amount)
          .filter((c): c is number => typeof c === 'number' && c > 0)
          .sort((a, b) => a - b);
        
        if (costs.length > 0) {
          const mid = costs[Math.floor(costs.length / 2)];
          const min = costs[0];
          const max = costs[costs.length - 1];
          
          console.log(`CORRECTION: Calculated median $${mid} (min: $${min}, max: $${max}) from ${costs.length} matched records.`);
          
          result.estimate.manufacture_cost = {
            low: min < mid ? min : Math.round(mid * 0.9),
            mid: Math.round(mid),
            high: max > mid ? max : Math.round(mid * 1.1)
          };
          
          // Force a summary update if it was saying $0 or missing a valid number
          if (result.summary?.includes('$0') || result.summary?.includes('most likely $0')) {
             result.summary = `Historical median estimate: $${mid.toLocaleString()}. Calculated from ${costs.length} relevant historical records.`;
          }
          
          // Also fix line items if empty or zeroed
          const hasValidLineItems = Array.isArray(result.estimate.line_items) && 
                                   result.estimate.line_items.length > 0 && 
                                   result.estimate.line_items.some(i => (i.extended_cost || 0) > 0);
          
          if (!hasValidLineItems) {
            result.estimate.line_items = [{
              name: `Base ${result.sign_type || 'Sign'} Manufacture`,
              qty: (result.normalized_inputs?.qty_sets || 1) || 1,
              unit_cost: mid,
              extended_cost: mid * ((result.normalized_inputs?.qty_sets || 1) || 1),
              basis: 'Derived from matched historical records (Median fallback)'
            }];
          }
          
          result.pricing_method = 'direct_match_median';
          result.summary = (result.summary || "") + " (Note: Cost corrected via historical median as AI returned zero or invalid cost)";
          if (Array.isArray(result.flags)) {
            if (!result.flags.includes('LOW_DATA')) result.flags.push('LOW_DATA');
          }
          
          if (!result.confidence) {
            result.confidence = { score: 0, rationale: "" };
          }
          
          if (!result.confidence.rationale || result.confidence.rationale.toLowerCase().includes('no rationale')) {
            result.confidence.rationale = "Estimate calculated based on the median of the most relevant historical pricing records found in the database for similar sign types and dimensions.";
            result.confidence.score = Math.max(result.confidence.score || 0, 60);
          }
        }
      }

      // FINAL SYNC: Align low/high range with actual matched records to ensure UI consistency
      if (result.matched_records && result.matched_records.length > 0 && result.estimate?.manufacture_cost) {
        const availableCosts = result.matched_records
          .map(r => r.cost?.amount)
          .filter((c): c is number => typeof c === 'number' && c > 0)
          .sort((a, b) => a - b);
        
        if (availableCosts.length > 0) {
          const minCost = availableCosts[0];
          const maxCost = availableCosts[availableCosts.length - 1];
          
          // Ensure the estimate range at least covers the range of records shown to the user
          if (result.estimate.manufacture_cost.low > minCost) {
            result.estimate.manufacture_cost.low = minCost;
          }
          if (result.estimate.manufacture_cost.high < maxCost) {
            result.estimate.manufacture_cost.high = maxCost;
          }
        }
      }

      // Fix math inconsistencies from AI response
      if (result.estimate && Array.isArray(result.estimate.line_items)) {
        let totalExtended = 0;
        result.estimate.line_items = result.estimate.line_items.map(item => {
          const qty = item.qty || 1;
          const unit = item.unit_cost || 0;
          const extended = Math.round(unit * qty);
          totalExtended += extended;
          return {
            ...item,
            qty,
            unit_cost: unit,
            extended_cost: extended
          };
        });

        // Ensure the summary mid estimate matches the line items sum to avoid UI confusion
        if (result.estimate.manufacture_cost) {
          // Only overwrite mid with line item sum if the sum is greater than 0
          // This prevents $0 values if line items happen to be empty/invalid
          if (totalExtended > 0) {
            result.estimate.manufacture_cost.mid = totalExtended;
            // Re-adjust low/high if they were zeroed or inconsistent
            if (result.estimate.manufacture_cost.low === 0 || result.estimate.manufacture_cost.low > totalExtended) {
              result.estimate.manufacture_cost.low = Math.round(totalExtended * 0.9);
            }
            if (result.estimate.manufacture_cost.high === 0 || result.estimate.manufacture_cost.high < totalExtended) {
              result.estimate.manufacture_cost.high = Math.round(totalExtended * 1.1);
            }
          }
        }
      }

      // Determine pricing source from matched records, prioritizing the records closest to the Mid Estimate cost
      const matchedRecords = Array.isArray(result.matched_records) ? result.matched_records : [];
      
      // Check for exact match from our RAG step
      if (topExactMatch) {
         const exactFull = currentPricingDatabase.find(f => f.id === topExactMatch.id);
         if (exactFull) {
            result.is_exact_match = true;
            if (result.estimate && result.estimate.manufacture_cost) {
               result.estimate.manufacture_cost.mid = exactFull.manufacture_cost;
               // For EXACT matches, we tighten the range to +/- 5% to show high confidence
               result.estimate.manufacture_cost.low = Math.round(exactFull.manufacture_cost * 0.95);
               result.estimate.manufacture_cost.high = Math.round(exactFull.manufacture_cost * 1.05);
            }
            
            // Update line items to match the exact cost
            if (Array.isArray(result.estimate.line_items) && result.estimate.line_items.length > 0) {
              const currentTotal = result.estimate.line_items.reduce((sum, item) => sum + (item.extended_cost || 0), 0);
              if (currentTotal > 0) {
                 const scaleFactor = exactFull.manufacture_cost / currentTotal;
                 result.estimate.line_items = result.estimate.line_items.map(item => ({
                   ...item,
                   unit_cost: Math.round(item.unit_cost * scaleFactor),
                   extended_cost: Math.round(item.extended_cost * scaleFactor),
                   basis: `Adjusted to match exact SKU ${exactFull.id} pricing`
                 }));
              }
            } else {
              // Create a dummy line item if none exist
              result.estimate.line_items = [{
                name: `Exact Match: ${exactFull.sign_type || 'Sign'}`,
                qty: 1,
                unit_cost: exactFull.manufacture_cost,
                extended_cost: exactFull.manufacture_cost,
                basis: `Direct pricing from historical record SKU ${exactFull.id}`
              }];
            }
            
            // Add a summary mention
            result.summary = `EXACT MATCH FOUND: SKU ${exactFull.id}. ${result.summary}`;
            
            // Ensure this record is at the top of matched_records if not already
            const topIndex = matchedRecords.findIndex(r => r.record_id === topExactMatch.id);
            if (topIndex > 0) {
              const [exactRec] = matchedRecords.splice(topIndex, 1);
              matchedRecords.unshift(exactRec);
            }

            // Force 100% confidence for exact SKU match
            result.confidence = {
              score: 100,
              rationale: `Exact brand-standard match found (SKU: ${exactFull.id}). Pricing used directly from historical database to ensure consistency.`
            };
          }
      }

      const midEstimateValue = result.estimate?.manufacture_cost?.mid || 0;
      
      // Add vendor_location to matched_records and find full records
      const updatedMatchedRecords = matchedRecords.map(r => {
        const full = currentPricingDatabase.find(f => f.id === r.record_id);
        return {
          ...r,
          vendor_location: full?.vendor_location || r.vendor_location
        };
      });
      result.matched_records = updatedMatchedRecords;

      const matchedIds = updatedMatchedRecords.map(r => r.record_id);
      const matchedFullRecords = currentPricingDatabase.filter(r => matchedIds.includes(r.id));

      // Find the record closest to our Mid estimate to determine the primary source
      let closestRecord = null;
      let minDiff = Infinity;
      
      for (const r of matchedFullRecords) {
        const diff = Math.abs(r.manufacture_cost - midEstimateValue);
        if (diff < minDiff) {
          minDiff = diff;
          closestRecord = r;
        }
      }

      // Determine pricing source based on the closest records to the Mid Estimate to avoid labeling USA mid-prices as Overseas
      let topLocation = (closestRecord?.vendor_location || 'USA').toUpperCase();
      
      // If we have an exact match result.is_exact_match, force the top location to that match's location
      if (result.is_exact_match && topExactMatch) {
         topLocation = (topExactMatch.vendor_location || 'USA').toUpperCase();
      }

      // Robust Overseas detection: If it's not USA or Canada, it's likely Overseas
      const isUSA = topLocation.includes('USA') || topLocation.includes('UNITED STATES') || topLocation.includes('DOMESTIC');
      const isCanada = topLocation.includes('CANADA');
      const isKnownOS = topLocation.includes('CHINA') || topLocation.includes('THAILAND') || 
                        topLocation.includes('MEXICO') || topLocation.includes('VIETNAM') || 
                        topLocation.includes('OVERSEAS') || topLocation.includes('OVERSEES');
      
      const isOSValue = isKnownOS || (!isUSA && !isCanada && topLocation !== 'UNKNOWN' && topLocation !== '');

      if (isOSValue) {
        result.pricing_source = 'Overseas';
      } else if (isCanada) {
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

        const totalManufactureMid = result.estimate.manufacture_cost.mid || 0;
        
        // Final margin double-check for safety
        if (projectType === 'Government') {
          margin = isOS ? 0.5 : 0;
        } else {
          margin = isOS ? 0.5 : 0.3;
        }

        result.selling_price = {
          mid: Math.round(totalManufactureMid * (1 + margin)),
          line_items: (Array.isArray(result.estimate.line_items) ? result.estimate.line_items : []).map(item => {
            const unitPrice = Math.round((item.unit_cost || 0) * (1 + margin) * 100) / 100;
            const qty = item.qty || 0;
            return {
              name: item.name || 'Unknown Item',
              qty: qty,
              unit_price: unitPrice,
              extended_price: Math.round(unitPrice * qty * 100) / 100
            };
          })
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