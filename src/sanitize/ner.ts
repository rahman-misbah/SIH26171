// §7.2 Tier 2 (NER) is a pass-through stub in M5 -- no on-device NER model
// exists until M7 (docs/MILESTONES.md). Sanitize code depends only on the
// `PiiNer` capability shape (src/models/capabilities.ts), so swapping this
// for `getModel('ner')` in M7 is a one-line change at the call site, not a
// pipeline rewrite.

import type { PiiNer } from '@/models/capabilities';

export const passthroughNer: PiiNer = {
  async tag(texts: string[]) {
    return texts.map(() => []);
  },
};
