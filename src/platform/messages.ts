// §4.2: message shapes for `Transport`'s request/response calls and long-lived
// ports. Concrete entries (ping in M3, DOM chunks in M5, actions in M6, image
// acquisition in M8) are added here directly as each milestone needs them;
// this file is not meant to be built out ahead of need.

export interface RequestMessageMap {
  // M3 infrastructure smoke test (§4.3.1 round trip) and, via the optional
  // `echo` payload, the §4.3.7 binary-transport-over-Chromium-messaging
  // benchmark -- no separate message type needed for either.
  ping: {
    request: { echo?: ArrayBuffer };
    response: { echo?: ArrayBuffer; respondedAt: number };
  };
}

// `Record<never, ...>` (rather than an empty interface) keeps this an
// indexable placeholder without tripping the no-empty-object-type lint rule.
// No port-based message exists yet -- §4.3.9's keep-alive ping is an M6
// concern (agent sessions don't exist until then).
export type PortMessageMap = Record<never, unknown>;

export interface MessageMap {
  request: RequestMessageMap;
  port: PortMessageMap;
}
