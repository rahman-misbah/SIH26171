// §4.2: message shapes for `Transport`'s request/response calls and long-lived
// ports. Empty in M2 by design — concrete entries (ping in M3, DOM chunks in
// M5, actions in M6, image acquisition in M8) are added here directly as each
// milestone lands; this file is not meant to be built out ahead of need.
// `Record<never, ...>` (rather than an empty interface) keeps these indexable
// placeholder types without tripping the no-empty-object-type lint rule.

export type RequestMessageMap = Record<never, { request: unknown; response: unknown }>;
export type PortMessageMap = Record<never, unknown>;

export interface MessageMap {
  request: RequestMessageMap;
  port: PortMessageMap;
}
