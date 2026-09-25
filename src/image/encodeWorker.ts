// M10 (§15 latency): JPEG encoding for already-redacted pixels, in a Worker.
// Chromium runs OffscreenCanvas.convertToBlob() in a *document* as an idle
// task with a 1 s fallback deadline; the Chromium compute host is a hidden
// offscreen document that is never idle in that sense, so every encode there
// took a constant ~1000 ms (M9 Noticed 1). In a Worker it runs straight away.
//
// Only redacted pixels ever reach this worker (render.ts draws the boxes
// first), and it loads no library and makes no network request, so it
// doesn't need the model workers' egress guard.

interface EncodeRequest {
  id: number;
  bitmap: ImageBitmap;
  quality: number;
}

self.addEventListener('message', (event: MessageEvent<EncodeRequest>) => {
  const { id, bitmap, quality } = event.data;
  void (async () => {
    try {
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('2d context unavailable');
      ctx.drawImage(bitmap, 0, 0);
      const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality });
      self.postMessage({ id, blob });
    } catch {
      // No library message crosses back (CLAUDE.md: no error text in logs).
      self.postMessage({ id, error: true });
    } finally {
      bitmap.close();
    }
  })();
});
