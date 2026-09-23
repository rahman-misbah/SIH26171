// §9.4: providers per capability, in preference order (highest tier first --
// the registry picks the first whose `requires` the hardware profile
// satisfies). Face/OCR/QR arrive in M8/M9 (docs/MILESTONES.md); NER tier-2
// (`openai/privacy-filter`, §9.5) is an explicitly-out-of-scope extension
// point for this prototype ("only one tier-2 provider needs to ship" -- that's
// face, M11), so 'ner' lists only its one tier-1 provider.

import { graviteeBertSmallPii } from './providers/ner/graviteeBertSmallPii';
import type { Capability } from './capabilities';
import type { ModelProvider } from './provider';

export const modelProviders: { [C in Capability]: ModelProvider<C>[] } = {
  face: [],
  ocr: [],
  qr: [],
  ner: [graviteeBertSmallPii],
};
