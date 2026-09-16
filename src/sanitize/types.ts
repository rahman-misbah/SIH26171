// §7: PII taxonomy and the token map. The token map itself lives only in
// compute-host memory (§7.6) — this file defines its entry shape, not storage.

import type { Box } from '@/models/capabilities';

// Regex tier (§7.1) plus NER-derived types (§7.2: e.g. LOCATION -> ADDRESS,
// unknown label -> OTHER, treated as PII per the fail-closed decision rule §7.4).
export type PiiType =
  | 'EMAIL'
  | 'UPI'
  | 'PHONE'
  | 'AADHAAR'
  | 'PAN'
  | 'CARD'
  | 'IFSC'
  | 'PASSPORT'
  | 'VOTER_ID'
  | 'GSTIN'
  | 'VEHICLE_REG'
  | 'DOB'
  | 'NAME'
  | 'ADDRESS'
  | 'OTHER';

export type TokenSource =
  | { node_id: string; field: string; offset: number }
  | { img_id: string; bbox: Box };

export interface TokenMapEntry {
  token: string; // `[PII_<TYPE>_<n>]`
  type: PiiType;
  value: string;
  origin: string;
  sources: TokenSource[];
  created_at: number;
}
