import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import wxtAutoImports from './.wxt/eslint-auto-imports.mjs';

// CLAUDE.md "Boundaries (enforced by ESLint)". Boundaries A/B shipped in M1.
// Boundary C (consumers use getBackend(), never import a backend
// implementation directly) ships in M6, once src/backend/llm/ and
// src/backend/mock.ts exist as things to restrict (see docs/MILESTONES.md
// M2 Log). The remaining bullet -- orchestrator/assembler depending only on
// AgentBackend/SanitizedObservation -- has no separate module to restrict:
// src/agent/loop.ts *is* the orchestrator and already only imports
// @/backend/types (type-only) plus getBackend()'s callers pass it an
// already-resolved AgentBackend instance.
const backendConsumerRestriction = {
  message: 'Backend implementations are only allowed in src/backend/ -- consumers use getBackend() (SPEC §12.4, CLAUDE.md boundaries).',
};
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
    // public/models and public/ort are vendored model weights / ONNX Runtime
    // Web runtime files (fetch-models.ts / copy-ort-assets.ts), not project
    // source -- CLAUDE.md's "vendored runtime files in public/" exception.
    ignores: ['.output/**', '.wxt/**', 'node_modules/**', 'reference/**', 'public/models/**', 'public/ort/**'],
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
  {
    // Boundary C: backend implementations restricted to src/backend/ itself
    // (SPEC §12.4).
    files: ['src/**/*.ts', 'src/**/*.tsx'],
    ignores: ['src/backend/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['@/backend/llm', '@/backend/llm/*'], ...backendConsumerRestriction },
            { group: ['@/backend/mock'], ...backendConsumerRestriction },
          ],
        },
      ],
    },
  },
);
