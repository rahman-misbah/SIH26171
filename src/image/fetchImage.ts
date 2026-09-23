// §6.2 step 2: the pixel-acquisition fallback -- fetch in the compute host,
// whose fetch isn't bound by the page's CORS the way the content script's is
// *when* the extension holds a host permission for that origin. Per the M8
// plan, no extra host permission is requested for this: without one, a
// cross-origin image with no CORS headers fails here and is withheld as
// `unreadable` (fail-closed). Also the §6.6 conditional revalidation request.

import { ReasonCodeError } from '@/logging';

export type FetchResult =
  | { notModified: true }
  | { notModified: false; blob: Blob; etag?: string; last_modified?: string };

export interface Validators {
  etag?: string;
  last_modified?: string;
}

// Only schemes the compute host can meaningfully fetch. blob: URLs belong to
// the page's origin (unreachable from here); anything else (chrome-extension:,
// file:, javascript:...) is never fetched on a page's say-so.
const FETCHABLE = new Set(['http:', 'https:', 'data:']);

export async function fetchImage(src: string, validators?: Validators): Promise<FetchResult> {
  let url: URL;
  try {
    url = new URL(src);
  } catch {
    throw new ReasonCodeError('unreadable');
  }
  if (!FETCHABLE.has(url.protocol)) throw new ReasonCodeError('unreadable');

  const headers: Record<string, string> = {};
  if (validators?.etag) headers['If-None-Match'] = validators.etag;
  if (validators?.last_modified) headers['If-Modified-Since'] = validators.last_modified;
  const conditional = Object.keys(headers).length > 0;

  let response: Response;
  try {
    response = await fetch(url, {
      headers,
      // Never send the user's cookies/auth for a page-supplied URL, and never
      // tell the image host which extension is asking.
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      // A conditional request must actually reach the server, not be answered
      // from the browser's HTTP cache.
      cache: conditional ? 'no-store' : 'default',
    });
  } catch {
    // Network error, or CORS refusal (fetch can't tell us which).
    throw new ReasonCodeError('unreadable');
  }

  if (response.status === 304) return { notModified: true };
  if (!response.ok) throw new ReasonCodeError('unreadable');

  return {
    notModified: false,
    blob: await response.blob(),
    etag: response.headers.get('ETag') ?? undefined,
    last_modified: response.headers.get('Last-Modified') ?? undefined,
  };
}
