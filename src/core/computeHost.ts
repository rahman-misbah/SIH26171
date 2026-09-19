// §10/§11: one-time compute-host bootstrap. Called once by whichever
// entrypoint is the compute host for this browser -- the offscreen document
// on Chromium (src/entrypoints/offscreen/main.ts), the background page on
// Firefox/Safari (src/entrypoints/background.ts) -- never by the background
// router on Chromium, which only relays (§3 architecture).

import { assembleObservation } from '@/agent';
import { detectDevice } from '@/hw';
import { createLogger, IdbSink } from '@/logging';
import type { LogRecord, RuntimeLogger, SessionRecord } from '@/logging';
import { onComputeHostRequest } from '@/platform';
import type { MessageMap, Platform } from '@/platform';
import { sanitizeUnit, TokenMapImpl } from '@/sanitize';

// §7.6: one token map per agent session, created lazily, living only in
// compute-host memory. Session cleanup (tab close / session end) is an M6
// concern -- no real agent sessions exist until then.
const tokenMaps = new Map<string, TokenMapImpl>();
function getTokenMap(sessionId: string): TokenMapImpl {
  let map = tokenMaps.get(sessionId);
  if (!map) {
    map = new TokenMapImpl();
    tokenMaps.set(sessionId, map);
  }
  return map;
}

function createDispatch(logger: RuntimeLogger) {
  return async function dispatch(type: string, payload: unknown): Promise<unknown> {
    switch (type) {
      case 'ping': {
        const { echo } = payload as MessageMap['request']['ping']['request'];
        return { echo, respondedAt: Date.now() };
      }

      case 'sanitizeChunk': {
        const req = payload as MessageMap['request']['sanitizeChunk']['request'];
        return logger.timed(
          'sanitize.regex',
          { session_id: req.session_id, counts: { units: req.units.length } },
          async () => {
            const tokenMap = getTokenMap(req.session_id);
            const results = await Promise.all(
              req.units.map(async (unit) => ({
                unit_id: unit.unit_id,
                text: await sanitizeUnit(unit, { origin: req.origin, tokenMap }),
              })),
            );
            return { results };
          },
        );
      }

      case 'assembleObservation': {
        const req = payload as MessageMap['request']['assembleObservation']['request'];
        const t_start = performance.timeOrigin + performance.now();
        const result = assembleObservation(req);
        const t_end = performance.timeOrigin + performance.now();
        logger.record({
          session_id: req.session_id,
          step: req.step,
          op: 'context.assemble',
          t_start,
          t_end,
          duration_ms: t_end - t_start,
          outcome: result.status === 'ok' ? 'ok' : 'fail_closed',
          reason: result.status === 'blocked' ? 'guard_triggered' : undefined,
        });
        return result;
      }

      case 'logRecord': {
        logger.record(payload as LogRecord);
        return {};
      }

      default:
        throw new Error(`unknown request type: ${type}`);
    }
  };
}

export async function bootstrapComputeHost(platform: Platform): Promise<void> {
  const logger = createLogger(new IdbSink());

  // Registered first, synchronously: on Chromium, `ensureComputeHost()` resolves
  // as soon as the offscreen document is *created*, not once its module has
  // finished evaluating, so background's first forwarded request can arrive
  // before anything past this line would have run (§4.3.1).
  onComputeHostRequest(createDispatch(logger));

  const device = await detectDevice(platform.name);

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
