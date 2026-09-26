# Edward wire protocol (v1)

This is the contract between Edward and a **custom agent server**: a server that does its own planning
and prompting, in any language (SPEC §12.3). Edward talks to it through `HttpAgentBackend`
(`src/backend/http/`). To use one, open the extension's settings, choose **Custom agent server** as
the backend, and enter the endpoint (plus an optional token).

The JSON Schemas in [`docs/wire/`](wire/) are generated from the TypeScript types
(`npm run wire-schema`). A unit test fails if the committed schemas stop matching those types.

| Message | Schema |
|---|---|
| `POST /v1/decide` request body | [`observation.schema.json`](wire/observation.schema.json) |
| `POST /v1/decide` response body | [`agent-response.schema.json`](wire/agent-response.schema.json) |
| `GET /v1/capabilities` response body | [`capabilities.schema.json`](wire/capabilities.schema.json) |

## What the server receives

The request body is the `SanitizedObservation`. This is the same privacy boundary object every
Edward backend gets, including the LLM backends. The only change is that image bytes are base64. A
self-hosted server gets no relaxed redaction. It never sees the token map, raw page text, raw images
or logs.

- PII in text arrives as opaque placeholders such as `[PII_EMAIL_1]`. To use one, put it in a
  `type.text` or `select.value`. Edward resolves it locally, only on the page's own origin (§13.4).
- Faces, QR codes and PII text in images are already covered with solid fills.
- Iframes, canvases, images that couldn't be read and other exclusions appear as markers, so you
  can see where content was removed.
- Page text is budgeted (SPEC §14.2, M12): in-viewport content first, then content nearest the
  viewport. When anything was left out, the observation has `truncated: true` and the nodes
  where text was dropped carry `trimmed: true`. Scrolling brings that content into the viewport
  for the next step. The budget is 40% of your `maxContextTokens` (at ~4 characters per token),
  capped at 12,000 characters.

## Endpoint rules

- The endpoint is a base URL, such as `https://agent.example.com/edward`. Edward appends
  `/v1/capabilities` and `/v1/decide` to it.
- It must use **HTTPS**. Plain `http://` is accepted only for `localhost` and `127.0.0.1`, for
  development. URLs with credentials, a query string or a fragment are refused.
- Saving the endpoint asks the browser for host permission on its origin. Edward won't use the
  backend until that permission is granted.
- Redirects are **not** followed. An observation only ever goes to the configured endpoint.
- CORS headers are not needed, at least on Chromium: an extension with host permission for the
  origin isn't subject to CORS. This was verified by the e2e test against a server that sends
  none. It hasn't been checked on Firefox yet.

## Headers (every request)

| Header | Value |
|---|---|
| `Edward-Schema-Version` | `1`: the `schema_version` of the body |
| `Authorization` | `Bearer <token>`, only if a token is configured |
| `Content-Type` | `application/json` (on `POST` only) |

The token is sent only in this header, only to this endpoint, and it's never logged (§12.7).

## `GET /v1/capabilities`

Edward calls this once, when the backend starts (`init()`). Respond `200` with:

```json
{ "maxImagesPerRequest": 2, "maxImageBytes": 2097152, "maxContextTokens": 8192 }
```

| Field | Meaning |
|---|---|
| `maxImagesPerRequest` | Maximum number of images in one `/v1/decide` request. Integer ≥ 0; `0` means text only. |
| `maxImageBytes` | Maximum size of a single image in bytes. Edward re-encodes larger images to fit. Integer > 0. |
| `maxContextTokens` | The server's context budget. Integer > 0. |

Edward refuses to start the backend if these values are missing or malformed. Until this call
succeeds, Edward sends no images.

## `POST /v1/decide`

Edward sends this once per agent step. Respond `200` with the next actions:

```json
{
  "thought": "typing the email from the task",
  "done": false,
  "actions": [{ "type": "type", "node_id": "n12", "text": "[PII_EMAIL_1]" }]
}
```

The response is checked by the same validator every backend uses (SPEC §13.1):

- `thought` has at most 200 characters.
- `actions` has at most 3 entries.
- A `wait` action lasts at most 3000 ms.
- `answer` (optional) is the final answer when `done` is true.

Edward does not retry an invalid response. It fails the session with `backend_invalid_response`,
because the server owns its own prompting and asking again the same way wouldn't help.

Each action then goes through Edward's token egress policy (§13.4) before it runs. For example, a
`navigate` whose URL contains a placeholder is blocked. The next request's `history` reports every
action's result (`ok`, `stale_node`, `not_interactable`, `blocked` or `not_run`), so the server can
re-plan.

### Images

Each entry of `images` is `{ img_id, node_id, mime, data }`. `data` holds the redacted image bytes
as standard base64 with padding, and `node_id` links the image to its node in `dom`.

## Status codes

| Status | What Edward does |
|---|---|
| `200` | Validates the body |
| `426 Upgrade Required` | The server doesn't support this `Edward-Schema-Version`. The backend refuses to start (`backend_version_unsupported`). If this happens during a session, Edward checks the version again on the next step. |
| `429` | Fails the step as `backend_rate_limited` (no retry) |
| Anything else, a network error, or no response within 30 s | Fails the step as `backend_error` |

Edward never reads or logs the body of an error response.

## Versioning

`schema_version` is `"1"`. A change to any wire type that an existing server would notice gets a
new version number, and a server that can't handle it answers `426`.

## Reference mock server

`tests/e2e/mockAgentServer.ts` is a complete (if trivial) v1 server in about 60 lines of Node. It
answers `426` to unknown versions, serves its capabilities, and on the first step types the
task's email placeholder into the field named `email`. `tests/e2e/httpBackend.spec.ts` uses it to
drive a real agent step end to end.
