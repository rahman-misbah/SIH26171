// §7.2, §9.3: "providers own their raw-score -> bucket mapping (§8) and label
// maps (§7.2)" -- this file is where gravitee-io/bert-small-pii-detection's
// specific label vocabulary is allowed to leak into the codebase; nothing
// outside src/models/providers/ner/ should ever see a raw model label.
//
// The model's raw id2label (public/models/ner/config.json) is BIO-tagged
// over 25 categories (B-<X>/I-<X> + O); graviteeBertSmallPii.ts runs the
// pipeline with `aggregation_strategy: 'simple'`, which merges adjacent B-/I-
// tokens into one span per entity and reports `entity_group` with the prefix
// already stripped -- this map only ever sees the 25 bare category names.

import type { PiiType } from '@/sanitize/types';
import type { Bucket } from '@/models/capabilities';

// null = "not PII, drop the span" (the spec's own worked example: "ORG -> not
// PII", §7.2) -- distinct from an unmapped/unknown label, which falls back
// to OTHER (still PII, fail-closed) both here and again in sanitize/decide.ts's
// own runtime guard (defense in depth, not redundant: this file is the one
// place allowed to know *why* a label maps where it does).
const RAW_LABEL_TO_PII_TYPE: Record<string, PiiType | null> = {
  PERSON: 'NAME',
  LOCATION: 'ADDRESS',
  EMAIL_ADDRESS: 'EMAIL',
  PHONE_NUMBER: 'PHONE',
  CREDIT_CARD: 'CARD',
  US_PASSPORT: 'PASSPORT',
  ORGANIZATION: null,
  // DATE_TIME is broader than a birthdate (e.g. "meeting on 3 June" is not a
  // DOB) -- still redacted (fail-closed), just not over-claimed as DOB.
  DATE_TIME: 'OTHER',
  // The remaining categories have no closer PiiType match; still redacted,
  // typed OTHER, same fail-closed treatment an unrecognized label would get.
  AGE: 'OTHER',
  COORDINATE: 'OTHER',
  FINANCIAL: 'OTHER',
  HONORIFIC: 'OTHER',
  IBAN_CODE: 'OTHER',
  IMEI: 'OTHER',
  IP_ADDRESS: 'OTHER',
  MAC_ADDRESS: 'OTHER',
  NRP: 'OTHER',
  PASSWORD: 'OTHER',
  TITLE: 'OTHER',
  URL: 'OTHER',
  US_BANK_NUMBER: 'OTHER',
  US_DRIVER_LICENSE: 'OTHER',
  US_ITIN: 'OTHER',
  US_LICENSE_PLATE: 'OTHER',
  US_SSN: 'OTHER',
};

export function mapRawLabel(label: string): PiiType | null {
  if (label in RAW_LABEL_TO_PII_TYPE) return RAW_LABEL_TO_PII_TYPE[label] ?? null;
  return 'OTHER'; // genuinely unknown label (future checkpoint) -- fail-closed
}

// §8: raw score -> confidence bucket. Prototype defaults, favoring recall
// per §8.4 ("default thresholds are set low"); not yet tuned against a real
// inference run on the fixture set (no on-device run happened while writing
// this file) -- revisit once §18 item 4's recall numbers exist.
const HIGH_THRESHOLD = 0.85;
const MEDIUM_THRESHOLD = 0.6;

export function bucketConfidence(score: number): Bucket {
  if (score >= HIGH_THRESHOLD) return 'high';
  if (score >= MEDIUM_THRESHOLD) return 'medium';
  return 'low';
}
