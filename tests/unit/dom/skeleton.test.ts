// @vitest-environment happy-dom

import { beforeAll, describe, expect, it } from 'vitest';
import { runPhaseA } from '@/dom/skeleton';
import { installFakeLayout } from './testLayout';

beforeAll(() => {
  installFakeLayout();
});

function setBody(html: string): void {
  document.body.innerHTML = html;
}

describe('runPhaseA', () => {
  it('emits an iframe_skipped marker and does not descend into it', async () => {
    setBody('<iframe title="embedded"><p data-canary="leak">should never appear</p></iframe>');
    const { skeleton } = await runPhaseA(document);
    const markerNode = skeleton.find((n) => n.marker === 'iframe_skipped');
    expect(markerNode).toBeDefined();
    expect(skeleton.some((n) => n.tag === 'p')).toBe(false);
  });

  it('emits a canvas_skipped marker', async () => {
    setBody('<canvas id="c"></canvas>');
    const { skeleton } = await runPhaseA(document);
    expect(skeleton.some((n) => n.marker === 'canvas_skipped')).toBe(true);
  });

  it('emits an svg_skipped marker and does not descend into its children', async () => {
    setBody('<svg><text>hidden svg text</text></svg>');
    const { skeleton } = await runPhaseA(document);
    expect(skeleton.some((n) => n.marker === 'svg_skipped')).toBe(true);
    expect(skeleton.some((n) => n.tag === 'text')).toBe(false);
  });

  it('emits a video_skipped marker', async () => {
    setBody('<video src="movie.mp4"></video>');
    const { skeleton } = await runPhaseA(document);
    expect(skeleton.some((n) => n.marker === 'video_skipped')).toBe(true);
  });

  it('never queues "value" for a secret password field', async () => {
    setBody('<input type="password" name="password" value="Sup3rSecretCanary!" />');
    const { skeleton } = await runPhaseA(document);
    const input = skeleton.find((n) => n.tag === 'input');
    expect(input?.secret).toBe(true);
    expect(input?.pending_content).not.toContain('value');
  });

  it('never queues "value" for a name-pattern CVV field', async () => {
    setBody('<input type="text" name="cvv" value="482913" />');
    const { skeleton } = await runPhaseA(document);
    const input = skeleton.find((n) => n.tag === 'input');
    expect(input?.secret).toBe(true);
    expect(input?.pending_content).not.toContain('value');
  });

  it('queues "value" for an ordinary non-secret input', async () => {
    setBody('<input type="text" name="upi" value="priya.sharma@okaxis" />');
    const { skeleton } = await runPhaseA(document);
    const input = skeleton.find((n) => n.tag === 'input');
    expect(input?.secret).toBeUndefined();
    expect(input?.pending_content).toContain('value');
  });

  it('builds parent_id links matching the DOM structure', async () => {
    setBody('<div id="outer"><p id="inner">hello</p></div>');
    const { skeleton } = await runPhaseA(document);
    const outer = skeleton.find((n) => n.tag === 'div');
    const inner = skeleton.find((n) => n.tag === 'p');
    const text = skeleton.find((n) => n.node_type === 'text');
    expect(inner?.parent_id).toBe(outer?.node_id);
    expect(text?.parent_id).toBe(inner?.node_id);
  });

  it('strips display:none content with no interactive descendant, no marker', async () => {
    setBody('<div id="hidden" style="display:none">just some text</div>');
    const { skeleton } = await runPhaseA(document);
    expect(skeleton.some((n) => n.tag === 'div')).toBe(false);
  });

  it('keeps a display:none node with an interactive descendant, marked not visible', async () => {
    setBody('<div id="menu" style="display:none"><button>Open</button></div>');
    const { skeleton } = await runPhaseA(document);
    const menu = skeleton.find((n) => n.tag === 'div');
    expect(menu?.visible).toBe(false);
    expect(skeleton.some((n) => n.tag === 'button')).toBe(true);
  });

  it('strips script/style/noscript/template unconditionally', async () => {
    setBody('<script>window.x=1</script><style>.a{color:red}</style><template><p>tpl</p></template>');
    const { skeleton } = await runPhaseA(document);
    expect(skeleton.some((n) => ['script', 'style', 'template', 'p'].includes(n.tag))).toBe(false);
  });

  it('does not walk into <head>', async () => {
    setBody('<p>body content</p>');
    const { skeleton } = await runPhaseA(document);
    expect(skeleton.some((n) => n.tag === 'title' || n.tag === 'meta')).toBe(false);
  });

  it('queues href for a link and drops non-interactive text inside a footer landmark', async () => {
    setBody(
      '<footer><p>Copyright text should be dropped</p><a href="/privacy">Privacy</a></footer>',
    );
    const { skeleton } = await runPhaseA(document);
    expect(skeleton.some((n) => n.tag === 'p')).toBe(false);
    const link = skeleton.find((n) => n.tag === 'a');
    expect(link).toBeDefined();
    expect(link?.pending_content).toContain('href');
  });

  it('registers every emitted element in the Element Registry', async () => {
    setBody('<button id="btn">Click</button>');
    const { skeleton, registry } = await runPhaseA(document);
    const btn = skeleton.find((n) => n.tag === 'button');
    expect(registry.resolve(btn!.node_id)?.id).toBe('btn');
  });

  it('flags a secret field even without emitting its value, and registers it so its node_id still resolves', async () => {
    setBody('<input id="pw" type="password" value="secret" />');
    const { skeleton, registry } = await runPhaseA(document);
    const input = skeleton.find((n) => n.tag === 'input');
    expect(registry.resolve(input!.node_id)?.id).toBe('pw');
  });
});
