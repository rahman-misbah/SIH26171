// §7.8: URL sanitization, applied to the page URL and every href/src.

import { sanitizeText, tokenizeOpaque, type SanitizeTextContext } from './sanitizeText';

// Query keys redacted regardless of content (§7.8). 'id' is only redacted
// when "long" (§7.8's own wording) -- short numeric ids like `?page=3` are
// noise, not PII; this threshold is an implementer choice, documented here.
const SENSITIVE_QUERY_KEYS = new Set(['token', 'auth', 'session', 'sid', 'key', 'code', 'email', 'phone', 'user', 'uid', 'id']);
const LONG_ID_MIN_LENGTH = 8;

// "Short in-page anchor" (§7.8) cutoff: long enough for real slugs
// ("section-2", "faq"), short enough to exclude opaque tracking blobs.
const MAX_ANCHOR_FRAGMENT_LENGTH = 24;
const ANCHOR_FRAGMENT_RE = /^#[\w-]+$/;

function isSensitiveQueryKey(key: string, value: string): boolean {
  const lower = key.toLowerCase();
  if (lower === 'id') return value.length > LONG_ID_MIN_LENGTH;
  return SENSITIVE_QUERY_KEYS.has(lower);
}

async function sanitizePath(pathname: string, ctx: SanitizeTextContext): Promise<string> {
  const segments = pathname.split('/');
  const sanitized = await Promise.all(
    segments.map(async (segment) => {
      if (segment === '') return segment;
      const decoded = decodeURIComponent(segment);
      const result = await sanitizeText(decoded, ctx);
      return encodeURIComponent(result);
    }),
  );
  return sanitized.join('/');
}

async function sanitizeQuery(search: string, ctx: SanitizeTextContext): Promise<string> {
  const params = new URLSearchParams(search);
  const out = new URLSearchParams();
  for (const [key, value] of params) {
    if (isSensitiveQueryKey(key, value)) {
      out.set(key, value === '' ? value : tokenizeOpaque(value, 'OTHER', ctx));
    } else {
      out.set(key, await sanitizeText(value, ctx));
    }
  }
  const query = out.toString();
  return query === '' ? '' : `?${query}`;
}

function sanitizeFragment(hash: string): string {
  if (hash === '') return '';
  if (hash.length - 1 <= MAX_ANCHOR_FRAGMENT_LENGTH && ANCHOR_FRAGMENT_RE.test(hash)) return hash;
  return '';
}

export async function sanitizeUrl(raw: string, ctx: SanitizeTextContext): Promise<string> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    try {
      // Relative href/src (no scheme/host) -- parse against a throwaway base
      // just to split it into path/query/fragment; the base is never emitted.
      url = new URL(raw, 'http://edward-relative.invalid/');
      const path = await sanitizePath(url.pathname, ctx);
      const query = await sanitizeQuery(url.search, ctx);
      const fragment = sanitizeFragment(url.hash);
      return `${path}${query}${fragment}`;
    } catch {
      // Not URL-shaped at all -- treat the whole value as opaque text.
      return sanitizeText(raw, ctx);
    }
  }

  const path = await sanitizePath(url.pathname, ctx);
  const query = await sanitizeQuery(url.search, ctx);
  const fragment = sanitizeFragment(url.hash);
  return `${url.protocol}//${url.host}${path}${query}${fragment}`;
}
