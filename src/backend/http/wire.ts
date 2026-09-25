// §12.3: the Edward wire protocol's JSON shapes. The request body is a
// SanitizedObservation with each image's bytes as base64 -- nothing else is
// added or removed, so the privacy boundary object is exactly what the
// server sees. docs/wire/*.schema.json are generated from the types in this
// file (`npm run wire-schema`), so a server in any language can be built
// against them.

import type { AgentResponse } from '@/agent/schema';
import type { BackendCapabilities, ObservationImage, SanitizedObservation } from '../types';

// Sent as the `Edward-Schema-Version` header on every request, so a server
// can refuse with 426 before reading any body (GET /v1/capabilities has none).
export const WIRE_SCHEMA_VERSION: SanitizedObservation['schema_version'] = '1';

export interface WireImage extends Omit<ObservationImage, 'data'> {
  data: string; // base64 (RFC 4648, with padding) of the redacted image bytes
}

export interface WireObservation extends Omit<SanitizedObservation, 'images'> {
  images: WireImage[];
}

// Response of POST /v1/decide (§13.1) and GET /v1/capabilities, re-exported
// under wire names so the schema generator has one entry point per message.
export type WireAgentResponse = AgentResponse;
export type WireCapabilities = BackendCapabilities;

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  // Chunked: spreading a whole image into String.fromCharCode would
  // overflow the call stack.
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

export function toWireObservation(obs: SanitizedObservation): WireObservation {
  return { ...obs, images: obs.images.map((img) => ({ ...img, data: toBase64(img.data) })) };
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

// The server's limits are used as given (every image sent is already
// redacted and selected, §14), but malformed values would break image
// selection, so the whole backend refuses to start on them. 0 images is
// valid: a text-only server.
export function isBackendCapabilities(value: unknown): value is BackendCapabilities {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    isNonNegativeInteger(v.maxImagesPerRequest) &&
    isNonNegativeInteger(v.maxImageBytes) &&
    v.maxImageBytes > 0 &&
    isNonNegativeInteger(v.maxContextTokens) &&
    v.maxContextTokens > 0
  );
}
