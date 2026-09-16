export type * from './types';
export type * from './messages';

// chromium.ts/gecko.ts implementations arrive in M3 (SPEC §4).
// This is the ONLY folder allowed to import `browser`/`chrome` (SPEC §4.2, CLAUDE.md boundaries).
