import { describe, expect, it } from 'vitest';
import { SendableImageStore } from '@/image/sendable';

const img = (id: string) => ({ img_id: id, blob: new Blob([id]) });

describe('SendableImageStore', () => {
  it('keeps each session\'s images separate', () => {
    const store = new SendableImageStore();
    store.put('s1', 'n1', img('a'));
    store.put('s2', 'n1', img('b'));
    expect(store.forSession('s1').get('n1')?.img_id).toBe('a');
    expect(store.forSession('s2').get('n1')?.img_id).toBe('b');
  });

  it('a new observation starts empty (images never leak into a later step)', () => {
    const store = new SendableImageStore();
    store.put('s1', 'n1', img('a'));
    store.beginObservation('s1');
    expect(store.forSession('s1').size).toBe(0);
  });

  it('clear() drops the session', () => {
    const store = new SendableImageStore();
    store.put('s1', 'n1', img('a'));
    store.clear('s1');
    expect(store.forSession('s1').size).toBe(0);
  });

  it('evicts the oldest session beyond the cap', () => {
    const store = new SendableImageStore();
    for (let i = 0; i < 9; i++) {
      store.beginObservation(`s${i}`);
      store.put(`s${i}`, 'n', img(`${i}`));
    }
    expect(store.forSession('s0').size).toBe(0);
    expect(store.forSession('s8').size).toBe(1);
  });
});
