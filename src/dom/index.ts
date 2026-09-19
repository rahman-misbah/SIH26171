export type * from './types';

export { isSecretField } from './secret';
export { semanticClassFlags } from './classFlags';
export {
  classifyVisibility,
  computeVisibilitySnapshot,
  hasInteractiveDescendant,
  isLiveToggleTarget,
  type VisibilityResult,
  type VisibilitySnapshot,
} from './visibility';
export { findTrimmedLandmarkRoot, isTrimmedLandmarkRoot } from './landmark';
export { resolveAccessibleName } from './accessibleName';
export { ElementRegistry } from './registry';
export { createIdGenerator } from './ids';
export { runPhaseA, type PhaseAResult } from './skeleton';
export { buildContentUnits, mergeWindows, windowText, TEXT_WINDOW_OVERLAP, TEXT_WINDOW_SIZE } from './contentUnits';
export { observePage } from './observe';

// Action executor, status overlay arrive in M6 (SPEC §13).
