// §12.3 demo scope: "a tiny mock server used only in tests". Speaks the
// Edward wire protocol (docs/WIRE_PROTOCOL.md) on localhost and does its own
// (trivial) planning, the way a real custom agent server would: on the first
// /v1/decide it types the task's email token into the field named "email";
// after that it reports done. Every request is recorded for the test to
// inspect.

import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { WireAgentResponse, WireCapabilities, WireObservation } from '../../src/backend/http/wire';

export interface RecordedRequest {
  method: string;
  path: string;
  headers: http.IncomingHttpHeaders;
  body: string;
}

export interface MockAgentServer {
  endpoint: string; // e.g. http://127.0.0.1:43210
  requests: RecordedRequest[];
  close: () => Promise<void>;
}

const CAPABILITIES: WireCapabilities = { maxImagesPerRequest: 2, maxImageBytes: 2 * 1024 * 1024, maxContextTokens: 8192 };

function plan(obs: WireObservation): WireAgentResponse {
  const email = obs.dom.find((n) => n.attrs?.name === 'email');
  const token = /\[PII_EMAIL_\d+\]/.exec(obs.task)?.[0];
  if (obs.history.length === 0 && email && token) {
    return { thought: 'typing the email from the task', done: false, actions: [{ type: 'type', node_id: email.node_id, text: token }] };
  }
  return { thought: 'finished', done: true, actions: [] };
}

export async function startMockAgentServer(options: { schemaVersions?: string[] } = {}): Promise<MockAgentServer> {
  const supported = options.schemaVersions ?? ['1'];
  const requests: RecordedRequest[] = [];

  const server = http.createServer((req, res) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => (body += chunk));
    req.on('end', () => {
      requests.push({ method: req.method ?? '', path: req.url ?? '', headers: req.headers, body });
      const send = (status: number, payload?: unknown) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(payload === undefined ? '' : JSON.stringify(payload));
      };

      if (!supported.includes(String(req.headers['edward-schema-version']))) return send(426, {});
      if (req.method === 'GET' && req.url === '/v1/capabilities') return send(200, CAPABILITIES);
      if (req.method === 'POST' && req.url === '/v1/decide') return send(200, plan(JSON.parse(body) as WireObservation));
      send(404, {});
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    endpoint: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
