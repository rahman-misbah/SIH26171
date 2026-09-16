import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import wxtAutoImports from './.wxt/eslint-auto-imports.mjs';

// CLAUDE.md "Boundaries (enforced by ESLint)". Only the two mechanically-enforceable
// rules are implemented in M1 — the other two boundary bullets (orchestrator/assembler
// depending only on AgentBackend/SanitizedObservation; consumers using getModel()/
// getBackend()) have no concrete modules to restrict yet and are deferred to M3/M6
// (see docs/MILESTONES.md Log).
const extensionApiRestriction = {
  message:
    'Extension/browser APIs are only allowed in src/platform/ (SPEC §4.2, CLAUDE.md boundaries).',
};

const modelLibraryAndVendorRestriction = [
  { name: 'webextension-polyfill', ...extensionApiRestriction },
  { name: 'wxt/browser', ...extensionApiRestriction },
  {
    name: 'onnxruntime-web',
    message: 'Model libraries are only allowed in src/models/providers/ (SPEC §9.1).',
  },
  {
    name: '@huggingface/transformers',
    message: 'Model libraries are only allowed in src/models/providers/ (SPEC §9.1).',
  },
  {
    name: 'tesseract.js',
    message: 'Model libraries are only allowed in src/models/providers/ (SPEC §9.1).',
  },
  {
    name: 'zxing-wasm',
    message: 'Model libraries are only allowed in src/models/providers/ (SPEC §9.1).',
  },
  {
    name: 'groq-sdk',
    message: 'Vendor names/APIs are only allowed in src/backend/llm/clients/ (SPEC §12.5).',
  },
  {
    name: 'openai',
    message: 'Vendor names/APIs are only allowed in src/backend/llm/clients/ (SPEC §12.5).',
  },
];

export default tseslint.config(
  {
    ignores: ['.output/**', '.wxt/**', 'node_modules/**', 'reference/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  wxtAutoImports,
  {
    // Boundary A: `browser`/`chrome` restricted to src/platform/ (SPEC §4.2).
    files: ['src/**/*.ts', 'src/**/*.tsx'],
    ignores: ['src/platform/**'],
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'browser', message: extensionApiRestriction.message },
        { name: 'chrome', message: extensionApiRestriction.message },
      ],
    },
  },
  {
    // Boundary B: model-library and vendor-SDK imports restricted to their own folders
    // (SPEC §9.1, §12.5). One shared exception list per the M1 plan's noted simplification.
    files: ['src/**/*.ts', 'src/**/*.tsx'],
    ignores: ['src/platform/**', 'src/models/providers/**', 'src/backend/llm/clients/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: modelLibraryAndVendorRestriction,
          patterns: [
            {
              group: ['@mediapipe/*'],
              message: 'Model libraries are only allowed in src/models/providers/ (SPEC §9.1).',
            },
          ],
        },
      ],
    },
  },
);
