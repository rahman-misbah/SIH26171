// §13.3: Action Executor. Runs in the content script, resolving `node_id`
// through the Element Registry built by this step's Phase A run. Only ever
// called with an action that has already passed §13.4's policy check and
// had its tokens resolved (src/agent/loop.ts) -- this file trusts its input
// and only reports execution-level outcomes (stale/not-interactable).

import type { ElementRegistry } from './registry';
import type { Action, ActionResult } from '@/agent/schema';

function dispatchClick(el: Element): void {
  const opts = { bubbles: true, cancelable: true } as const;
  // PointerEvent isn't implemented in every test DOM (happy-dom); real
  // browsers (exercised by the e2e suite) always support it.
  const PointerEventCtor = typeof PointerEvent === 'function' ? PointerEvent : MouseEvent;
  el.dispatchEvent(new PointerEventCtor('pointerdown', opts));
  el.dispatchEvent(new MouseEvent('mousedown', opts));
  el.dispatchEvent(new PointerEventCtor('pointerup', opts));
  el.dispatchEvent(new MouseEvent('mouseup', opts));
  el.dispatchEvent(new MouseEvent('click', opts));
}

// Sets through the native value setter (not the element's own, possibly
// framework-overridden, `value` property) so React/Vue-controlled inputs
// see the change via their `input` listener, per §13.3.
function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter) setter.call(el, value);
  else el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

function submitField(el: HTMLInputElement | HTMLTextAreaElement): void {
  const form = el.form;
  if (form && typeof form.requestSubmit === 'function') form.requestSubmit();
  else el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }));
}

function typeIntoField(el: Element, text: string, submit: boolean | undefined): ActionResult {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    if (el.disabled || el.readOnly) return 'not_interactable';
    el.focus();
    setNativeValue(el, text);
    if (submit) submitField(el);
    return 'ok';
  }
  if (el instanceof HTMLElement && el.isContentEditable) {
    el.focus();
    const proceed = el.dispatchEvent(
      new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertText', data: text }),
    );
    if (proceed && typeof document.execCommand === 'function') document.execCommand('insertText', false, text);
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
    return 'ok';
  }
  return 'not_interactable';
}

export function executeAction(registry: ElementRegistry, action: Action): ActionResult {
  switch (action.type) {
    case 'click': {
      const el = registry.resolve(action.node_id);
      if (!el) return 'stale_node';
      if (!el.isConnected) return 'not_interactable';
      el.scrollIntoView({ block: 'center' });
      if (el instanceof HTMLElement) el.focus();
      dispatchClick(el);
      return 'ok';
    }

    case 'type': {
      const el = registry.resolve(action.node_id);
      if (!el) return 'stale_node';
      if (!el.isConnected) return 'not_interactable';
      return typeIntoField(el, action.text, action.submit);
    }

    case 'select': {
      const el = registry.resolve(action.node_id);
      if (!el) return 'stale_node';
      if (!(el instanceof HTMLSelectElement) || el.disabled) return 'not_interactable';
      el.value = action.value;
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return 'ok';
    }

    case 'scroll': {
      const delta = window.innerHeight * 0.8;
      window.scrollBy({ top: action.direction === 'down' ? delta : -delta });
      return 'ok';
    }

    case 'scroll_to': {
      const el = registry.resolve(action.node_id);
      if (!el) return 'stale_node';
      el.scrollIntoView({ block: 'center' });
      return 'ok';
    }

    case 'navigate': {
      let url: URL;
      try {
        url = new URL(action.url, location.href);
      } catch {
        return 'not_interactable';
      }
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return 'not_interactable';
      location.assign(url.href);
      return 'ok';
    }

    // Timing is orchestrated by the content-side driver (src/dom/agentSession
    // .ts), which awaits the delay itself; this case exists only so the
    // switch stays exhaustive over Action['type'].
    case 'wait':
      return 'ok';
  }
}
