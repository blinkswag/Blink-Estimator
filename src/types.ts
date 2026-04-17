export type SignType = 'ChannelLetters' | 'ADASign' | 'LexanPanel' | 'ACMPanel' | 'AcrylicPanel' | 'BladeSign' | 'CabinetSign' | 'PylonSign' | 'MonumentSign' | 'Other';

export interface SignScope {
  sign_type: SignType | string;
  dimensions?: {
    height?: number;
    width?: number;
    depth?: number;
    backer_height?: number;
    backer_width?: number;
    area_sqft?: number;
    width_ft?: number;
    height_ft?: number;
  };
  mounting?: string;
  materials?: string;
  illumination?: string;
  letter_count?: number;
  logo_count?: number;
  raceway_length?: number;
  backer_area?: number;
  face_treatment?: string;
  description?: string;
  return_depth?: number;
  face_material?: string;
  qty_sets?: number;
  copy?: string;
  finishes?: string;
  adders?: {
    remote_psu?: boolean;
    photocell?: boolean;
    timer?: boolean;
    print_or_vinyl?: string;
  };
}

export const DEFAULT_SHEET_ID = process.env.GOOGLE_SHEET_ID || '1UWeF1lpr1jURwwQF7AWuim8L98Hh1NnPcOgP8QmKSaQ';

export interface ExtractedDetails {
  scope: Partial<SignScope>;
  confidence: number;
  notes: string;
}

export interface ArtworkContext {
  letter_count?: number;
  letter_height_estimate?: number;
  complexity_score?: number;
  logo_shapes_count?: number;
  stroke_thickness_flags?: string[];
}

export interface EstimationResult {
  sign_type: SignType;
  estimate_scope: {
    manufacture_included: boolean;
    install_included: boolean;
    notes: string[];
  };
  normalized_inputs: {
    sign_type: string | null;
    copy: string | null;
    letter_count: number | null;
    qty_sets: number;
    dimensions: {
      width_ft: number | null;
      height_ft: number | null;
      area_sqft: number | null;
    };
    letter_height_in: number | null;
    depth_in: number | null;
    mounting: string | null;
    illumination: string | null;
    raceway_length_ft: number | null;
    backer_area_sqft: number | null;
    materials: Record<string, any>;
    finishes: Record<string, any>;
    adders: {
      remote_psu: boolean;
      photocell: boolean;
      timer: boolean;
      print_or_vinyl: string | null;
    };
    complexity: {
      font_style: string | null;
      logo_count: number;
      complexity_score: number | null;
    };
  };
  pricing_method: 'direct_match_median' | 'ratecard_decomposition' | 'interpolation_extrapolation';
  matched_records: Array<{
    record_id: string;
    po_number?: string;
    why_match: string;
    key_fields: {
      sign_type: string;
      mounting: string;
      dimensions: string;
    };
    vendor_location?: string;
    cost: {
      amount: number;
      currency: string;
    };
  }>;
  estimate: {
    currency: string;
    manufacture_cost: {
      low: number;
      mid: number;
      high: number;
    };
    line_items: Array<{
      name: string;
      qty: number;
      unit_cost: number;
      extended_cost: number;
      basis: string;
    }>;
  };
  assumptions: string[];
  missing_inputs: string[];
  flags: Array<'OUT_OF_DISTRIBUTION' | 'LOW_DATA' | 'MIXED_SOURCING' | 'NEEDS_ARTWORK_CONFIRMATION'>;
  confidence: {
    score: number;
    rationale: string;
  };
  summary: string;
  pricing_source?: string;
  overseas_estimate?: {
    mid: number;
    savings: number;
  };
  selling_price?: {
    mid: number;
    line_items: Array<{
      name: string;
      qty: number;
      unit_price: number;
      extended_price: number;
    }>;
  };
}

export interface PricingRecord {
  id: string;
  po_number?: string;
  sign_type: string;
  dimensions: { height: number; width: number; depth?: number };
  mounting: string;
  illumination: string;
  materials: string;
  manufacture_cost: number;
  install_cost: number;
  features: string[];
  letter_count?: number;
  quantity?: number;
  description?: string;
  vendor_location?: string;
}
