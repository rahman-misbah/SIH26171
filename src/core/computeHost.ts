// §10/§11: one-time compute-host bootstrap. Called once by whichever
// entrypoint is the compute host for this browser -- the offscreen document
// on Chromium (src/entrypoints/offscreen/main.ts), the background page on
// Firefox/Safari (src/entrypoints/background.ts) -- never by the background
// router on Chromium, which only relays (§3 architecture).

import { detectDevice } from '@/hw';
import { createLogger, IdbSink } from '@/logging';
import type { SessionRecord } from '@/logging';
import { onComputeHostRequest } from '@/platform';
import type { Platform } from '@/platform';

async function dispatch(type: string, payload: unknown): Promise<unknown> {
  if (type === 'ping') {
    const { echo } = payload as { echo?: ArrayBuffer };
    return { echo, respondedAt: Date.now() };
  }
  throw new Error(`unknown request type: ${type}`);
}

export async function bootstrapComputeHost(platform: Platform): Promise<void> {
  // Registered first, synchronously: on Chromium, `ensureComputeHost()` resolves
  // as soon as the offscreen document is *created*, not once its module has
  // finished evaluating, so background's first forwarded request can arrive
  // before anything past this line would have run (§4.3.1).
  onComputeHostRequest(dispatch);

  const device = await detectDevice(platform.name);
  const logger = createLogger(new IdbSink());

  const session: SessionRecord = {
    session_id: crypto.randomUUID(),
    started_at: Date.now(),
    device,
    // Backend/model registries don't exist until M6/M7 -- placeholders until then.
    models: [],
    backend_id: 'unassigned',
  };
  logger.recordSession(session);
  await logger.flush();
}
