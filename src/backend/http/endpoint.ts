// §12.4: a custom agent server's endpoint must be HTTPS, except plain http on
// the local machine for development. Anything else is refused before a
// request is ever made -- a sanitized observation still shouldn't cross a
// network in clear text. Returns the normalised base URL (no trailing slash)
// or undefined.

// Must match the http entries in wxt.config.ts's optional_host_permissions,
// or the settings page couldn't get permission for them.
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1']);

export function parseHttpEndpoint(raw: string): string | undefined {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return undefined;
  }

  const allowedScheme = url.protocol === 'https:' || (url.protocol === 'http:' && LOCAL_HOSTS.has(url.hostname));
  if (!allowedScheme) return undefined;
  // The token belongs in the Authorization header (§12.7), never in the URL;
  // a query or fragment would be sent on every request, so neither is allowed.
  if (url.username || url.password || url.search || url.hash) return undefined;

  return `${url.origin}${url.pathname}`.replace(/\/+$/, '');
}
