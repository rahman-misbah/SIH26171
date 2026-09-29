// Demo tooling (M12): renders what an Edward backend received as a readable
// page -- placeholders highlighted, redacted images shown as sent, every
// exclusion marker visible. Input is pasted or dropped by the presenter; the
// page makes no network requests and uses no extension APIs. Text is only
// ever set through textContent, never parsed as HTML.

import type { SanitizedNode } from '@/dom/types';
import { parseInput, type ViewImage, type ViewObservation } from '@/viewer/parseInput';
import { countPlaceholders, splitPlaceholders } from '@/viewer/segments';
import { buildTree, type TreeNode } from '@/viewer/tree';

const inputPanel = document.getElementById('input-panel') as HTMLElement;
const input = document.getElementById('input') as HTMLTextAreaElement;
const errorBox = document.getElementById('error') as HTMLElement;
const output = document.getElementById('output') as HTMLElement;
const prevButton = document.getElementById('prev') as HTMLButtonElement;
const nextButton = document.getElementById('next') as HTMLButtonElement;
const editButton = document.getElementById('edit') as HTMLButtonElement;
const stepLabel = document.getElementById('step-label') as HTMLElement;

let steps: ViewObservation[] = [];
let current = 0;

const HEADINGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
const CONTROLS = new Set(['input', 'textarea', 'select']);
const INLINE = new Set(['span', 'strong', 'em', 'b', 'i', 'code', 'small', 'label', 'abbr', 'time', 'sup', 'sub']);

const MARKER_TEXT: Record<string, string> = {
  iframe_skipped: 'iframe: not read',
  shadow_closed_skipped: 'closed shadow root: not read',
  canvas_skipped: 'canvas: not read',
  svg_skipped: 'inline SVG: not read',
  video_skipped: 'video: not read',
};
const OMITTED_TEXT: Record<string, string> = {
  too_small: 'image not sent: too small (under 32×32)',
  unreadable: 'image not sent: couldn’t be read, so it was withheld',
  detector_failed: 'image not sent: a detector failed, so it was withheld',
  request_limit: 'image not sent: over this backend’s per-request image limit',
};

function el(tag: string, className?: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// Sanitized text with each placeholder as a highlighted chip.
function appendText(parent: HTMLElement, text: string): void {
  for (const seg of splitPlaceholders(text)) {
    if (seg.kind === 'text') parent.append(seg.text);
    else parent.append(el('span', seg.kind, seg.text));
  }
}

function textOf(node: SanitizedNode): string | undefined {
  return node.content.text ?? node.content.accessible_name;
}

function renderImage(node: SanitizedNode, sent: Map<string, ViewImage>): HTMLElement {
  const image = sent.get(node.node_id);
  if (image) {
    const figure = el('figure', 'sent');
    const img = document.createElement('img');
    img.src = image.src;
    img.alt = node.content.accessible_name ?? 'redacted image';
    figure.append(img, el('figcaption', undefined, 'sent to the backend (redacted on-device)'));
    return figure;
  }
  const reason = node.image_omitted;
  return el('div', 'omitted', reason ? (OMITTED_TEXT[reason] ?? `image not sent: ${reason}`) : 'image not sent');
}

function renderControl(node: SanitizedNode): HTMLElement {
  const box = el('span', 'control');
  box.append(el('span', 'kind', node.attrs?.type ?? node.tag));
  const label = node.content.accessible_name;
  if (label) {
    appendText(box, label);
    box.append(': ');
  }
  const value = node.secret ? '[SECRET]' : node.content.value;
  if (value) appendText(box, value);
  else if (node.content.placeholder) {
    const ph = el('span', 'placeholder');
    appendText(ph, node.content.placeholder);
    box.append(ph);
  }
  return box;
}

// One node and its subtree, or null when it would render nothing (empty
// layout containers), so the page stays readable.
function renderNode(tree: TreeNode, sent: Map<string, ViewImage>): HTMLElement | null {
  const { node } = tree;
  if (node.marker) return el('div', 'marker', MARKER_TEXT[node.marker] ?? node.marker);
  if (node.image) return renderImage(node, sent);

  const tag = node.tag.toLowerCase();
  let self: HTMLElement;
  if (node.node_type === 'text') {
    self = el('span', 'node inline');
    appendText(self, node.content.text ?? '');
  } else if (CONTROLS.has(tag)) {
    self = renderControl(node);
  } else if (tag === 'button' || node.role === 'button') {
    self = el('span', 'button');
    const text = textOf(node);
    if (text && tree.children.length === 0) appendText(self, text);
  } else if (tag === 'a') {
    self = el('span', 'node inline link');
    if (node.content.href) self.title = node.content.href;
    const text = textOf(node);
    if (text && tree.children.length === 0) appendText(self, text);
  } else {
    const cls = HEADINGS.has(tag) ? `node h ${tag}` : tag === 'li' ? 'node list-item' : INLINE.has(tag) ? 'node inline' : 'node';
    self = el(INLINE.has(tag) ? 'span' : 'div', cls);
    const text = node.content.text;
    if (text) appendText(self, text);
  }
  if (!node.visible) self.classList.add('invisible');

  for (const child of tree.children) {
    const rendered = renderNode(child, sent);
    if (rendered) {
      self.append(rendered);
      if (rendered.classList.contains('inline')) self.append(' ');
    }
  }
  if (node.trimmed) self.append(el('div', 'trimmed', 'content here was left out (text budget) and never sent'));

  const empty = self.childNodes.length === 0 && self.textContent === '';
  return empty && node.node_type !== 'text' && !CONTROLS.has(tag) ? null : self;
}

function tally(values: (string | undefined)[]): string {
  const counts: Record<string, number> = {};
  for (const v of values) if (v) counts[v] = (counts[v] ?? 0) + 1;
  const entries = Object.entries(counts);
  return entries.length === 0 ? 'none' : entries.map(([k, n]) => `${k} ${n}`).join(', ');
}

function row(dl: HTMLElement, label: string, value: string | HTMLElement): void {
  const dd = el('dd');
  if (typeof value === 'string') appendText(dd, value);
  else dd.append(value);
  dl.append(el('dt', undefined, label), dd);
}

function renderSummary(obs: ViewObservation): HTMLElement {
  const box = el('section', 'summary');
  const dl = el('dl');
  row(dl, 'Task', obs.task);
  row(dl, 'Page', obs.page.title || '(no title)');
  row(dl, 'URL', obs.page.url);

  // Secret fields already carry value '[SECRET]' (src/agent/assemble.ts).
  const texts = obs.dom.flatMap((n) => Object.values(n.content)).concat(obs.task, obs.page.title, obs.page.url);
  const chips = el('span', 'chips');
  const counts = Object.entries(countPlaceholders(texts));
  if (counts.length === 0) chips.textContent = 'none';
  for (const [type, n] of counts) chips.append(el('span', type === 'SECRET' ? 'secret' : 'token', `${type} × ${n}`));
  row(dl, 'Placeholders', chips);

  const imageNodes = obs.dom.filter((n) => n.image);
  row(dl, 'Images', `${obs.images.length} sent (redacted) of ${imageNodes.length} on the page · not sent: ${tally(imageNodes.map((n) => n.image_omitted))}`);
  row(dl, 'Not read', tally(obs.dom.map((n) => n.marker)));
  row(dl, 'Nodes', `${obs.dom.length}${obs.truncated ? ' · page text truncated to the budget; the agent scrolls for more' : ''}`);
  box.append(dl);
  return box;
}

function renderHistory(obs: ViewObservation): HTMLElement | null {
  if (obs.history.length === 0) return null;
  const box = el('section', 'summary history');
  box.append(el('strong', undefined, 'Earlier steps (the model’s own notes, as sent back to it)'));
  const list = el('ol');
  for (const h of obs.history) {
    const li = el('li');
    appendText(li, `Step ${h.step}: ${h.thought}`);
    list.append(li);
  }
  box.append(list);
  return box;
}

function show(): void {
  const obs = steps[current];
  if (!obs) return;
  const sent = new Map(obs.images.map((img) => [img.node_id, img]));
  const page = el('div', 'page');
  for (const tree of buildTree(obs.dom)) {
    const rendered = renderNode(tree, sent);
    if (rendered) page.append(rendered);
  }
  output.replaceChildren(renderSummary(obs), ...[renderHistory(obs)].filter((x): x is HTMLElement => x !== null), el('div', 'page-caption', 'The page, as the backend saw it'), page);

  stepLabel.textContent = steps.length > 1 ? `request ${current + 1} of ${steps.length} · step ${obs.step}` : `step ${obs.step}`;
  prevButton.hidden = nextButton.hidden = steps.length < 2;
  prevButton.disabled = current === 0;
  nextButton.disabled = current === steps.length - 1;
}

function load(raw: string): void {
  try {
    steps = parseInput(raw);
  } catch (error) {
    errorBox.textContent = error instanceof Error ? error.message : 'Couldn’t read that input.';
    return;
  }
  errorBox.textContent = '';
  current = steps.length - 1; // the latest request is usually the interesting one
  inputPanel.hidden = true;
  output.hidden = false;
  editButton.hidden = false;
  show();
}

document.getElementById('render')?.addEventListener('click', () => load(input.value));
prevButton.addEventListener('click', () => {
  current = Math.max(0, current - 1);
  show();
});
nextButton.addEventListener('click', () => {
  current = Math.min(steps.length - 1, current + 1);
  show();
});
editButton.addEventListener('click', () => {
  inputPanel.hidden = false;
  output.hidden = true;
  editButton.hidden = true;
  prevButton.hidden = nextButton.hidden = true;
  stepLabel.textContent = '';
});

// Drag-and-drop a .json/.har file anywhere on the page.
window.addEventListener('dragover', (event) => {
  event.preventDefault();
  inputPanel.classList.add('dragging');
});
window.addEventListener('dragleave', () => inputPanel.classList.remove('dragging'));
window.addEventListener('drop', (event) => {
  event.preventDefault();
  inputPanel.classList.remove('dragging');
  const file = event.dataTransfer?.files[0];
  if (file) void file.text().then(load);
});
