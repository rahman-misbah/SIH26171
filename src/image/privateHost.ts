// M9 (M8 Noticed #1): the §6.2.2 fetch fallback fetches a *page-supplied*
// URL with the extension's host access (SPEC §4.3 item 16), and from M9 on
// its redacted result can reach the backend. A page could therefore point
// an <img> at the user's router, an intranet wiki or a cloud metadata
// endpoint and have the extension read it. So the fallback refuses hosts
// that are private by address or by name; those images are withheld as
// `unreadable` (logged with reason `private_host`). The canvas read (§6.2.1)
// is unaffected -- it only sees what the page itself already rendered.
//
// Limit (documented, not solved): this checks the URL's host *as written*.
// A public-looking name whose DNS resolves to a private address still
// passes -- extensions have no portable DNS API to check that first.

function ipv4Octets(host: string): number[] | undefined {
  const parts = host.split('.');
  if (parts.length !== 4) return undefined;
  const octets = parts.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : NaN));
  return octets.every((o) => o >= 0 && o <= 255) ? octets : undefined;
}

// Ranges that never belong to a public internet host.
function isPrivateIpv4([a, b]: number[]): boolean {
  if (a === undefined || b === undefined) return true;
  return (
    a === 0 || // "this network", incl. 0.0.0.0
    a === 10 || // RFC1918
    a === 127 || // loopback
    (a === 100 && b >= 64 && b <= 127) || // RFC6598 carrier-grade NAT
    (a === 169 && b === 254) || // link-local, incl. cloud metadata
    (a === 172 && b >= 16 && b <= 31) || // RFC1918
    (a === 192 && b === 168) // RFC1918
  );
}

function isPrivateIpv6(host: string): boolean {
  const h = host.toLowerCase();
  if (h === '::' || h === '::1') return true;
  // IPv4-mapped (::ffff:a.b.c.d) -- the URL parser writes it as hex groups.
  const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(h);
  if (mapped) {
    const hi = parseInt(mapped[1]!, 16);
    const lo = parseInt(mapped[2]!, 16);
    return isPrivateIpv4([hi >> 8, hi & 0xff, lo >> 8, lo & 0xff]);
  }
  const first = parseInt(h.split(':')[0] || '0', 16);
  return (
    (first & 0xfe00) === 0xfc00 || // fc00::/7 unique local
    (first & 0xffc0) === 0xfe80 // fe80::/10 link-local
  );
}

// Name suffixes reserved for local networks (RFC 6761/6762/8375, and the
// widely used `.internal`/`.lan`).
const PRIVATE_SUFFIXES = ['localhost', 'local', 'internal', 'lan', 'intranet', 'home.arpa'];

export function isPrivateHostUrl(src: string): boolean {
  let url: URL;
  try {
    url = new URL(src);
  } catch {
    return true; // fail closed
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false; // data: has no host

  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (host.startsWith('[')) return isPrivateIpv6(host.slice(1, -1));

  const v4 = ipv4Octets(host);
  if (v4) return isPrivateIpv4(v4);

  // A single-label name ("intranet") is resolved through the local search
  // domain, so it names a local machine.
  if (!host.includes('.')) return true;
  return PRIVATE_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}
