// @vitest-environment happy-dom
// §13.3: Action Executor.

import { beforeEach, describe, expect, it } from 'vitest';
import { executeAction } from '@/dom/executor';
import { ElementRegistry } from '@/dom/registry';

function setBody(html: string): void {
  document.body.innerHTML = html;
}

function registryFor(selector: string, nodeId = 'n1'): ElementRegistry {
  const registry = new ElementRegistry();
  const el = document.querySelector(selector);
  if (!el) throw new Error(`no element matching ${selector}`);
  registry.register(nodeId, el);
  return registry;
}

describe('executeAction', () => {
  beforeEach(() => {
    setBody('');
  });

  it('returns stale_node when the node_id is not in the registry', () => {
    const registry = new ElementRegistry();
    expect(executeAction(registry, { type: 'click', node_id: 'ghost' })).toBe('stale_node');
  });

  it('dispatches a click event sequence and returns ok', () => {
    setBody('<button id="b">Go</button>');
    const registry = registryFor('#b');
    const seen: string[] = [];
    document.querySelector('#b')!.addEventListener('click', () => seen.push('click'));
    const result = executeAction(registry, { type: 'click', node_id: 'n1' });
    expect(result).toBe('ok');
    expect(seen).toEqual(['click']);
  });

  it('returns not_interactable when clicking a disconnected element', () => {
    const el = document.createElement('button');
    const registry = new ElementRegistry();
    registry.register('n1', el);
    expect(executeAction(registry, { type: 'click', node_id: 'n1' })).toBe('not_interactable');
  });

  it('sets an input value through the native setter and fires input/change', () => {
    setBody('<input id="i" />');
    const registry = registryFor('#i');
    const events: string[] = [];
    const input = document.querySelector('#i') as HTMLInputElement;
    input.addEventListener('input', () => events.push('input'));
    input.addEventListener('change', () => events.push('change'));

    const result = executeAction(registry, { type: 'type', node_id: 'n1', text: 'hello@example.com' });
    expect(result).toBe('ok');
    expect(input.value).toBe('hello@example.com');
    expect(events).toEqual(['input', 'change']);
  });

  it('returns not_interactable when typing into a disabled input', () => {
    setBody('<input id="i" disabled />');
    const registry = registryFor('#i');
    expect(executeAction(registry, { type: 'type', node_id: 'n1', text: 'x' })).toBe('not_interactable');
  });

  it('never reads/reports a secret field value -- typing only sets it', () => {
    setBody('<input id="i" type="password" />');
    const registry = registryFor('#i');
    const result = executeAction(registry, { type: 'type', node_id: 'n1', text: 'S3cret!' });
    expect(result).toBe('ok');
    expect((document.querySelector('#i') as HTMLInputElement).value).toBe('S3cret!');
  });

  it('sets a select value and fires change', () => {
    setBody('<select id="s"><option value="a">A</option><option value="b">B</option></select>');
    const registry = registryFor('#s');
    let changed = false;
    document.querySelector('#s')!.addEventListener('change', () => (changed = true));
    const result = executeAction(registry, { type: 'select', node_id: 'n1', value: 'b' });
    expect(result).toBe('ok');
    expect((document.querySelector('#s') as HTMLSelectElement).value).toBe('b');
    expect(changed).toBe(true);
  });

  it('returns not_interactable for select on a non-select element', () => {
    setBody('<div id="d"></div>');
    const registry = registryFor('#d');
    expect(executeAction(registry, { type: 'select', node_id: 'n1', value: 'x' })).toBe('not_interactable');
  });

  it('blocks a non-http(s) navigate at the executor level too', () => {
    setBody('');
    const registry = new ElementRegistry();
    expect(executeAction(registry, { type: 'navigate', url: 'javascript:alert(1)' })).toBe('not_interactable');
  });

  it('returns ok for scroll/scroll_to/wait without throwing', () => {
    setBody('<div id="d">x</div>');
    const registry = registryFor('#d');
    expect(executeAction(registry, { type: 'scroll', direction: 'down' })).toBe('ok');
    expect(executeAction(registry, { type: 'scroll_to', node_id: 'n1' })).toBe('ok');
    expect(executeAction(registry, { type: 'wait', ms: 100 })).toBe('ok');
  });
});
