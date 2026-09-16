import { describe, expect, it } from 'vitest';

// Proves the §17 folder layout is importable end-to-end before any real logic exists.
// Real unit tests (regex tier, token map, egress policy, ...) arrive with M5+.
describe('scaffold folder layout', () => {
  const modules = [
    () => import('@/platform'),
    () => import('@/core'),
    () => import('@/dom'),
    () => import('@/sanitize'),
    () => import('@/image'),
    () => import('@/models'),
    () => import('@/backend'),
    () => import('@/backend/llm'),
    () => import('@/agent'),
    () => import('@/logging'),
    () => import('@/hw'),
  ];

  it.each(modules)('imports without throwing', async (load) => {
    await expect(load()).resolves.toBeDefined();
  });
});
