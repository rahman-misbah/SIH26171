// §10/§11: one-time compute-host bootstrap. Called once by whichever
// entrypoint is the compute host for this browser -- the offscreen document
// on Chromium (src/entrypoints/offscreen/main.ts), the background page on
// Firefox/Safari (src/entrypoints/background.ts) -- never by the background
// router on Chromium, which only relays (§3 architecture).

import { assembleObservation, createAgentLoop, prepareObservationImages } from '@/agent';
import { configureBackendDeps, getBackend, getBackendSettings } from '@/backend';
import { detectDevice } from '@/hw';
import { createImagePipeline, decodeImage, fetchImage, hashPixels, IdbImageCache, redactAndEncode, reencodeJpeg, SendableImageStore } from '@/image';
import type { ImagePipeline } from '@/image';
import { createLogger, IdbSink, ReasonCodeError } from '@/logging';
import type { LogRecord, RuntimeLogger, SessionRecord } from '@/logging';
import { configureModelDeps, getActiveModelId, getModel } from '@/models';
import { onComputeHostRequest } from '@/platform';
import type { MessageMap, Platform } from '@/platform';
import type { SkeletonNode } from '@/dom/types';
import { sanitizeUnit } from '@/sanitize';

// §13.2: one agent-loop instance for the lifetime of this compute host --
// owns every session's token map, abort controller and history (§7.6).
// sanitizeChunk also reads its per-session token map (Phase B tokenizes PII
// before an agent-loop step ever runs), so it's the single owner of that
// state rather than computeHost.ts keeping a second, separate map.
const agentLoop = createAgentLoop();

// §6: one image pipeline per compute host, sharing the one IndexedDB cache
// and the per-session store of this step's sendable images (§14.3).
const sendableImages = new SendableImageStore();

function createHostImagePipeline(logger: RuntimeLogger): ImagePipeline {
  return createImagePipeline({
    cache: new IdbImageCache(),
    sendable: sendableImages,
    logger,
    now: () => Date.now(),
    faceDetector: () => getModel('face'),
    ocrEngine: () => getModel('ocr'),
    qrDetector: () => getModel('qr'),
    ner: () => getModel('ner'),
    // §6.5: OCR PII goes into the same per-session token map as DOM text.
    tokenMap: (session_id) => agentLoop.getOrCreateTokenMap(session_id),
    // §6.6: changes whenever any active detector changes, so a record made
    // by an older or weaker detector set (including M8's face-only one) is
    // a miss. Undefined while any stage runs on its fail-closed fallback.
    detectorSetVersion: async () => {
      const [face, ocr, qr] = await Promise.all([getActiveModelId('face'), getActiveModelId('ocr'), getActiveModelId('qr')]);
      return face && ocr && qr ? `face=${face};ocr=${ocr};qr=${qr}` : undefined;
    },
    fetchImage,
    decode: decodeImage,
    hashPixels,
    redactAndEncode,
  });
}

// §14.3: this step's sendable images, selected and sized for `backend_id`.
function imagesForStep(session_id: string, backend_id: string, skeleton: SkeletonNode[]) {
  return prepareObservationImages(skeleton, sendableImages.forSession(session_id), getBackend(backend_id).capabilities, reencodeJpeg);
}

function createDispatch(logger: RuntimeLogger) {
  const images = createHostImagePipeline(logger);

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
            const tokenMap = agentLoop.getOrCreateTokenMap(req.session_id);
            const memo = agentLoop.getOrCreateMemo(req.session_id);
            const ner = await getModel('ner');
            const results = await Promise.all(
              req.units.map(async (unit) => ({
                unit_id: unit.unit_id,
                text: await sanitizeUnit(unit, {
                  origin: req.origin,
                  tokenMap,
                  memo,
                  ner,
                  logger,
                  session_id: req.session_id,
                }),
              })),
            );
            return { results };
          },
        );
      }

      case 'assembleObservation': {
        const req = payload as MessageMap['request']['assembleObservation']['request'];
        const t_start = performance.timeOrigin + performance.now();
        const prepared = await imagesForStep(req.session_id, req.backend_id, req.skeleton);
        const result = assembleObservation({ ...req, skeleton: prepared.skeleton, images: prepared.images });
        const t_end = performance.timeOrigin + performance.now();
        logger.record({
          session_id: req.session_id,
          step: req.step,
          op: 'context.assemble',
          t_start,
          t_end,
          duration_ms: t_end - t_start,
          outcome: result.status === 'ok' ? 'ok' : 'fail_closed',
          counts: { images: prepared.images.length },
          reason: result.status === 'blocked' ? 'guard_triggered' : undefined,
        });
        return result;
      }

      // §13.2/§12: assemble -> backend.decide() -> §13.4 policy -> token
      // resolution, one round trip per agent-loop step.
      case 'agentDecide': {
        const req = payload as MessageMap['request']['agentDecide']['request'];
        const backend = getBackend(req.backend_id);
        try {
          await backend.init();
        } catch (error) {
          return { status: 'fail', reason: error instanceof ReasonCodeError ? error.reason : 'backend_error' };
        }
        const prepared = await imagesForStep(req.session_id, req.backend_id, req.skeleton);
        return agentLoop.decideStep({ ...req, skeleton: prepared.skeleton, images: prepared.images }, backend, logger);
      }

      case 'agentReportResults': {
        const req = payload as MessageMap['request']['agentReportResults']['request'];
        agentLoop.recordStepResults(req.session_id, req.results);
        return {};
      }

      case 'agentStop': {
        const req = payload as MessageMap['request']['agentStop']['request'];
        agentLoop.stopSession(req.session_id);
        sendableImages.clear(req.session_id);
        return {};
      }

      case 'imageLookup': {
        const req = payload as MessageMap['request']['imageLookup']['request'];
        // One lookup per observation: this step's sendable set starts empty.
        sendableImages.beginObservation(req.session_id);
        const results = await images.lookup({ session_id: req.session_id, origin: req.origin }, req.images);
        return { results, send_budget: getBackend(req.backend_id).capabilities.maxImagesPerRequest };
      }

      case 'imageProcess': {
        const req = payload as MessageMap['request']['imageProcess']['request'];
        return images.process({ session_id: req.session_id, origin: req.origin }, req.image, req.pixels);
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

  // getBackend('llm:*')'s factories (backends.config.ts) need these but
  // can't receive them synchronously through getBackend(id) itself (§12.4).
  configureBackendDeps({ settings: platform.settings, logger, assetUrl: platform.assetUrl });

  const device = await detectDevice(platform.name);
  const backendSettings = await getBackendSettings(platform.settings);

  const session_id = crypto.randomUUID();
  const session: SessionRecord = {
    session_id,
    started_at: Date.now(),
    device,
    // Populated as getModel() lazily loads providers during the session
    // (§9.4) -- see logger.recordModelLoad(), called from the registry.
    models: [],
    backend_id: backendSettings.selectedBackendId,
  };
  logger.recordSession(session);

  // getModel()'s factories (models.config.ts) need these but can't receive
  // them synchronously through getModel(capability) itself (§9.4), same
  // reasoning as configureBackendDeps.
  configureModelDeps({ compute: device.compute, assetUrl: platform.assetUrl, logger, session_id });

  await logger.flush();
}
