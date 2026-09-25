// Serves tests/fixtures/ over a real http:// origin, the same reason
// ping.spec.ts runs its own tiny server: `<all_urls>` content scripts (and,
// here, plain page navigation for the canary test) don't behave the same on
// data:/file: URLs as they do on a real origin.

import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';

const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.png': 'image/png',
  '.json': 'application/json',
};

export interface StaticServer {
  url: string;
  close: () => Promise<void>;
}

// `port` 0 (the default) picks a free one; scripts/serve-fixtures.ts passes
// fixed ports so the manual browser checklist can use stable URLs.
export async function startStaticServer(root: string, port = 0): Promise<StaticServer> {
  const server = http.createServer((req, res) => {
    void (async () => {
      try {
        const reqPath = decodeURIComponent((req.url ?? '/').split('?')[0] ?? '/');
        const filePath = path.join(root, reqPath);
        if (!filePath.startsWith(root)) {
          res.writeHead(403);
          res.end();
          return;
        }
        await stat(filePath);
        res.writeHead(200, { 'content-type': MIME[path.extname(filePath)] ?? 'application/octet-stream' });
        createReadStream(filePath).pipe(res);
      } catch {
        res.writeHead(404);
        res.end();
      }
    })();
  });
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${address.port}/`,
    close: () => {
      // The browser keeps its keep-alive socket open, so a plain close()
      // would hang waiting for a connection nothing is going to end.
      server.closeAllConnections();
      return new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
