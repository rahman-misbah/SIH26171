// §4.3.5: "Live status is shown by a content-script overlay (closed shadow
// root, excluded from extraction) -- identical on all browsers." Mounted on
// `document.documentElement` rather than inside `document.body` -- Phase A's
// walk (src/dom/skeleton.ts) starts at `doc.body`, so the overlay is outside
// its traversal entirely, in addition to the closed shadow root already
// hiding its content from any DOM API a page script could use.

export interface OverlayStatus {
  step?: number;
  thought?: string;
  running: boolean;
}

export interface Overlay {
  setStatus(status: OverlayStatus): void;
  onStop(handler: () => void): void;
  destroy(): void;
}

const HOST_ID = 'edward-overlay-host';

export function createOverlay(): Overlay {
  document.getElementById(HOST_ID)?.remove(); // a stale overlay from a previous session, if any

  const host = document.createElement('div');
  host.id = HOST_ID;
  Object.assign(host.style, { all: 'initial', position: 'fixed', bottom: '16px', right: '16px', zIndex: '2147483647' });
  const shadow = host.attachShadow({ mode: 'closed' });

  const style = document.createElement('style');
  style.textContent = `
    .panel { font: 13px/1.4 -apple-system, system-ui, sans-serif; background: #111; color: #fff;
             padding: 10px 12px; border-radius: 8px; max-width: 280px; box-shadow: 0 2px 10px rgba(0,0,0,.35); }
    .thought { margin: 0 0 8px; white-space: pre-wrap; }
    button { font: inherit; background: #e5484d; color: #fff; border: none; border-radius: 4px; padding: 4px 10px; cursor: pointer; }
    button:hover { background: #c93b40; }
  `;
  const panel = document.createElement('div');
  panel.className = 'panel';
  const thoughtEl = document.createElement('p');
  thoughtEl.className = 'thought';
  const stopButton = document.createElement('button');
  stopButton.type = 'button';
  stopButton.textContent = 'Stop';
  panel.append(thoughtEl, stopButton);
  shadow.append(style, panel);
  document.documentElement.append(host);

  let stopHandler: (() => void) | undefined;
  stopButton.addEventListener('click', () => stopHandler?.());

  return {
    setStatus({ step, thought, running }) {
      thoughtEl.textContent = [step !== undefined ? `Step ${step}` : undefined, thought].filter(Boolean).join(': ');
      stopButton.hidden = !running;
    },
    onStop(handler) {
      stopHandler = handler;
    },
    destroy() {
      host.remove();
    },
  };
}
