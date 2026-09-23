// §14.3 needs the redacted images at assembly time, but the pipeline runs
// per image as the content script dispatches them (§15 parallel
// observation). This holds, per session, the current step's images that
// passed every §6.4 stage: node_id -> {img_id, redacted JPEG}.
//
// In compute-host memory only, never persisted. It holds only
// already-redacted output (the same bytes the cache may keep and the
// backend may receive), never raw pixels (§2.8). Reset at the start of each
// observation (imageLookup), cleared when the session stops.

export interface SendableImage {
  img_id: string;
  blob: Blob; // redacted, JPEG, longest side <= 1024 (§6.4.7)
}

// Observe-only sessions (the e2e hook, one random session per observation)
// never send agentStop, so the oldest session is evicted past this many.
// Nothing is lost by it: a session only ever reads its *current* step's
// images, and 8 concurrent agent sessions is far beyond one browser's use.
const MAX_SESSIONS = 8;

export class SendableImageStore {
  private readonly sessions = new Map<string, Map<string, SendableImage>>();

  beginObservation(session_id: string): void {
    this.sessions.delete(session_id); // re-insert -> newest in iteration order
    this.sessions.set(session_id, new Map());
    while (this.sessions.size > MAX_SESSIONS) {
      const oldest = this.sessions.keys().next().value;
      if (oldest === undefined) break;
      this.sessions.delete(oldest);
    }
  }

  put(session_id: string, node_id: string, image: SendableImage): void {
    let images = this.sessions.get(session_id);
    if (!images) {
      images = new Map();
      this.sessions.set(session_id, images);
    }
    images.set(node_id, image);
  }

  forSession(session_id: string): ReadonlyMap<string, SendableImage> {
    return this.sessions.get(session_id) ?? new Map();
  }

  clear(session_id: string): void {
    this.sessions.delete(session_id);
  }
}
