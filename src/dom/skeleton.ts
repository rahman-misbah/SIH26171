// §5.1 Phase A: structural skeleton. Reads no text, runs no sanitization --
// only presence checks (is there a non-empty accessible name? a non-empty
// href?) to decide what Phase B (§5.2) needs to fan out. Time-sliced per
// §5.7: yields every ~8ms via `scheduler.yield()` (falls back to
// `setTimeout(0)`, since neither Node nor every browser has it yet).
//
// Closed shadow roots (`shadow_closed_skipped`, §5.1) are NOT detected here:
// `Element.shadowRoot` is null for both "no shadow root" and "closed shadow
// root" by design (that's what "closed" means), so telling them apart needs
// monkey-patching `Element.prototype.attachShadow` before the page runs
// (`document_start`), which is a bigger content-script lifecycle change than
// this milestone's scope. No fixture exercises it. Noted in the M5 Log.

import { resolveAccessibleName } from './accessibleName';
import { semanticClassFlags } from './classFlags';
import { extractCssUrl } from './imageCandidates';
import { computeContextHints } from './contextHints';
import { createIdGenerator } from './ids';
import { findTrimmedLandmarkRoot } from './landmark';
import { ElementRegistry } from './registry';
import { isSecretField } from './secret';
import { ALWAYS_STRIPPED_TAGS, classifyVisibility, computeVisibilitySnapshot } from './visibility';
import type { BBox, ContentField, ExclusionMarker, ImageKind, NodeState, SkeletonNode } from './types';

const MARKER_TAGS: Record<string, ExclusionMarker> = {
  iframe: 'iframe_skipped',
  canvas: 'canvas_skipped',
  svg: 'svg_skipped',
  video: 'video_skipped',
};

const INTERACTIVE_TAGS = new Set(['a', 'button', 'input', 'select', 'textarea', 'summary', 'details']);
const INTERACTIVE_ROLES = new Set(['button', 'link', 'checkbox', 'radio', 'menuitem', 'tab', 'switch']);

function isInteractiveElement(el: Element): boolean {
  if (INTERACTIVE_TAGS.has(el.tagName.toLowerCase())) return true;
  const role = el.getAttribute('role');
  return role !== null && INTERACTIVE_ROLES.has(role);
}

const NATIVE_ROLE: Record<string, string> = {
  a: 'link',
  button: 'button',
  nav: 'navigation',
  header: 'banner',
  footer: 'contentinfo',
  main: 'main',
  img: 'img',
  textarea: 'textbox',
};

function computeRole(el: Element): string | undefined {
  const explicit = el.getAttribute('role');
  if (explicit) return explicit;
  const tag = el.tagName.toLowerCase();
  if (tag === 'input') {
    const type = el.getAttribute('type') ?? 'text';
    if (type === 'checkbox' || type === 'radio') return type;
    if (type === 'button' || type === 'submit') return 'button';
    return 'textbox';
  }
  return NATIVE_ROLE[tag];
}

function computeState(el: Element): NodeState | undefined {
  const state: NodeState = {};
  if (el instanceof HTMLInputElement) {
    if (el.disabled) state.disabled = true;
    if (el.type === 'checkbox' || el.type === 'radio') state.checked = el.checked;
    if (el.readOnly) state.readonly = true;
    if (el.required) state.required = true;
  } else if (el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) {
    if (el.disabled) state.disabled = true;
    if (el.required) state.required = true;
  } else if (el instanceof HTMLButtonElement) {
    if (el.disabled) state.disabled = true;
  } else if (el instanceof HTMLOptionElement) {
    if (el.selected) state.selected = true;
  }
  const ariaExpanded = el.getAttribute('aria-expanded');
  if (ariaExpanded === 'true' || ariaExpanded === 'false') state.expanded = ariaExpanded === 'true';
  return Object.keys(state).length > 0 ? state : undefined;
}

// §13.4 rule 4: the enclosing form's resolved action origin, if this element
// is form-associated. `HTMLFormElement.action` is always resolved to an
// absolute URL by the browser (defaulting to the page's own URL when the
// `action` attribute is absent), so this only differs from the page origin
// when the form genuinely posts cross-origin.
function formActionOrigin(el: Element): string | undefined {
  const form =
    el instanceof HTMLInputElement ||
    el instanceof HTMLSelectElement ||
    el instanceof HTMLTextAreaElement ||
    el instanceof HTMLButtonElement
      ? el.form
      : null;
  if (!form) return undefined;
  try {
    return new URL(form.action).origin;
  } catch {
    return undefined;
  }
}

// §6.1: <img> (incl. srcset/<picture>) or a CSS `background-image: url(...)`
// -- a structural flag only; the URL itself is read later, content-side,
// by imageCandidates.ts. Computed style is already resolved for this
// element by the visibility snapshot, so the extra lookup is cheap.
function imageKindOf(el: Element, doc: Document): ImageKind | undefined {
  if (el.tagName.toLowerCase() === 'img') return 'img';
  const bg = doc.defaultView?.getComputedStyle(el).backgroundImage ?? '';
  return bg !== '' && bg !== 'none' && extractCssUrl(bg) !== undefined ? 'background' : undefined;
}

function isScrollable(el: Element, doc: Document): boolean {
  const style = doc.defaultView?.getComputedStyle(el);
  if (!style) return false;
  const overflowY = style.overflowY;
  const overflowX = style.overflowX;
  const scrollsY = (overflowY === 'auto' || overflowY === 'scroll') && el.scrollHeight > el.clientHeight;
  const scrollsX = (overflowX === 'auto' || overflowX === 'scroll') && el.scrollWidth > el.clientWidth;
  return scrollsY || scrollsX;
}

function roundBBox(rect: DOMRect): BBox {
  return { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) };
}

function intersectsViewport(bbox: BBox, doc: Document): boolean {
  const w = doc.defaultView?.innerWidth ?? 0;
  const h = doc.defaultView?.innerHeight ?? 0;
  return bbox.x < w && bbox.x + bbox.w > 0 && bbox.y < h && bbox.y + bbox.h > 0;
}

interface StackEntry {
  node: Node;
  parentId: string | null;
}

async function yieldToMainThread(): Promise<void> {
  const anyGlobal = globalThis as { scheduler?: { yield?: () => Promise<void> } };
  if (typeof anyGlobal.scheduler?.yield === 'function') {
    await anyGlobal.scheduler.yield();
  } else {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
}

export interface PhaseAResult {
  skeleton: SkeletonNode[];
  registry: ElementRegistry;
  // Bridges Phase A's text-node discovery to Phase B's content read (§5.2) --
  // not the §5.6 Element Registry (that's Element-only, for action
  // resolution); text nodes are never action targets. Content-script-local,
  // discarded once Phase B has read from it.
  textNodes: Map<string, Text>;
}

export async function runPhaseA(doc: Document): Promise<PhaseAResult> {
  const registry = new ElementRegistry();
  const skeleton: SkeletonNode[] = [];
  const textNodes = new Map<string, Text>();
  const nodeId = createIdGenerator('n');
  const elementToId = new WeakMap<Element, string>();

  const root = doc.body;
  if (!root) return { skeleton, registry, textNodes };

  const stack: StackEntry[] = [{ node: root, parentId: null }];
  let lastYield = performance.now();

  while (stack.length > 0) {
    if (performance.now() - lastYield > 8) {
      await yieldToMainThread();
      lastYield = performance.now();
    }

    const { node, parentId } = stack.pop()!;

    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? '';
      if (text.trim() === '') continue;

      const parentEl = node.parentElement;
      if (parentEl) {
        const landmarkRoot = findTrimmedLandmarkRoot(parentEl);
        if (landmarkRoot && !isInteractiveElement(parentEl)) continue;
      }

      let bbox: BBox = { x: 0, y: 0, w: 0, h: 0 };
      try {
        const range = doc.createRange();
        range.selectNodeContents(node);
        bbox = roundBBox(range.getBoundingClientRect());
      } catch {
        // Range geometry isn't available in every test environment; real
        // browsers (verified in the e2e suite) always support it.
      }
      const style = parentEl ? doc.defaultView?.getComputedStyle(parentEl) : undefined;
      const visibility = classifyVisibility({
        displayNone: style?.display === 'none',
        visibilityHidden: style?.visibility === 'hidden',
        zeroSize: bbox.w === 0 && bbox.h === 0,
        offDocument: !(parentEl?.isConnected ?? false),
        isInteractive: false,
        hasInteractiveDescendant: false,
        isLiveToggleTarget: false,
        isAriaLive: false,
        isVisuallyHiddenLabelled: false,
      });
      if (visibility.kind === 'strip') continue;

      const id = nodeId();
      textNodes.set(id, node as Text);
      skeleton.push({
        node_id: id,
        tag: '#text',
        node_type: 'text',
        parent_id: parentId,
        bbox,
        visible: visibility.visible,
        in_viewport: intersectsViewport(bbox, doc),
        context_hints: parentEl ? computeContextHints(parentEl) : undefined,
        pending_content: ['text'],
      });
      continue;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) continue;
    const el = node as Element;
    const tag = el.tagName.toLowerCase();

    if (tag === 'head' || ALWAYS_STRIPPED_TAGS.has(tag)) continue;

    const marker = MARKER_TAGS[tag];
    if (marker) {
      const bbox = roundBBox(el.getBoundingClientRect());
      skeleton.push({
        node_id: nodeId(),
        tag,
        node_type: 'element',
        parent_id: parentId,
        bbox,
        visible: el.isConnected,
        in_viewport: intersectsViewport(bbox, doc),
        marker,
        pending_content: [],
      });
      continue; // never descend into an excluded subtree
    }

    const snapshot = computeVisibilitySnapshot(el, doc);
    const visibility = classifyVisibility(snapshot);
    if (visibility.kind === 'strip') continue;

    const landmarkRoot = findTrimmedLandmarkRoot(el);
    const dropForLandmark = landmarkRoot !== null && !snapshot.isInteractive;

    let effectiveParentId = parentId;

    if (!dropForLandmark) {
      const id = nodeId();
      elementToId.set(el, id);
      effectiveParentId = id;

      const secret = isSecretField(el);
      const pending: ContentField[] = [];
      if (!secret) {
        const value = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement ? el.value : '';
        if (value.trim() !== '') pending.push('value');
      }
      const placeholder = el.getAttribute('placeholder');
      if (placeholder && placeholder.trim() !== '') pending.push('placeholder');
      const href = el.getAttribute('href');
      if (href && href.trim() !== '') pending.push('href');
      const src = el.getAttribute('src');
      if (src && src.trim() !== '') pending.push('src');
      if (resolveAccessibleName(el, doc) !== '') pending.push('accessible_name');

      const type = el.getAttribute('type');
      const name = el.getAttribute('name');

      let scrollParentId: string | undefined;
      for (let ancestor = el.parentElement; ancestor; ancestor = ancestor.parentElement) {
        if (isScrollable(ancestor, doc)) {
          scrollParentId = elementToId.get(ancestor);
          break;
        }
      }

      const bbox = roundBBox(el.getBoundingClientRect());

      skeleton.push({
        node_id: id,
        tag,
        node_type: 'element',
        parent_id: parentId,
        role: computeRole(el),
        bbox,
        visible: visibility.visible,
        in_viewport: intersectsViewport(bbox, doc),
        state: computeState(el),
        scroll_parent: scrollParentId,
        attrs: type || name ? { type: type ?? undefined, name: name ?? undefined } : undefined,
        flags: semanticClassFlags(el).length > 0 ? semanticClassFlags(el) : undefined,
        secret: secret || undefined,
        image: imageKindOf(el, doc),
        form_action_origin: formActionOrigin(el),
        context_hints: pending.length > 0 ? computeContextHints(el) : undefined,
        pending_content: pending,
      });
      registry.register(id, el);
    }

    const children = el.shadowRoot ? el.shadowRoot.childNodes : el.childNodes;
    for (let i = children.length - 1; i >= 0; i--) {
      const child = children[i];
      if (child) stack.push({ node: child, parentId: effectiveParentId });
    }
  }

  return { skeleton, registry, textNodes };
}
