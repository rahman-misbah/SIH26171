import { describe, expect, it } from 'vitest';
import { summarizeObservation } from '../../realsites/summarize';

const ORIGIN = 'https://example.org';

function hook(dom: unknown[], images: unknown[] = []): string {
  return JSON.stringify({
    status: 'ok',
    observation: { schema_version: '1', session_id: 's', step: 0, task: 't', page: { url: `${ORIGIN}/`, title: 'x' }, dom, images, history: [] },
  });
}

describe('summarizeObservation', () => {
  it('counts nodes, fields, distinct tokens, markers and images', () => {
    const raw = hook(
      [
        { node_id: 'n1', content: { text: 'Call [PII_PHONE_1] or [PII_PHONE_1]', accessible_name: 'x' } },
        { node_id: 'n2', content: { text: 'Plate [PII_VEHICLE_REG_1], [PII_NAME_2]' } },
        { node_id: 'n3', marker: 'iframe_skipped', content: {} },
        { node_id: 'n4', image: 'img', content: {} },
        { node_id: 'n5', image: 'img', image_omitted: 'request_limit', content: {} },
      ],
      [{ img_id: 'i1', node_id: 'n4', mime: 'image/jpeg', data: { base64: 'AAAA' } }],
    );
    const { outcome, summary } = summarizeObservation(raw, ORIGIN);
    expect(outcome).toBe('ok');
    expect(summary).toMatchObject({
      nodes: 5,
      content_fields: 3,
      tokens: { PHONE: 1, VEHICLE_REG: 1, NAME: 1 },
      markers: { iframe_skipped: 1 },
      image_nodes: 2,
      images_sent: 1,
      images_omitted: { request_limit: 1 },
      truncated: false,
      trimmed_nodes: 0,
      residual: {},
    });
  });

  it('reports residual PII as counts only', () => {
    const { summary } = summarizeObservation(hook([{ node_id: 'n1', content: { text: 'ring +91 98765 43210' } }]), ORIGIN);
    expect(summary?.residual).toEqual({ PHONE: 1 });
    expect(JSON.stringify(summary)).not.toContain('98765');
  });

  it('maps the hook statuses to outcomes', () => {
    expect(summarizeObservation(JSON.stringify({ status: 'blocked' }), ORIGIN).outcome).toBe('blocked');
    expect(summarizeObservation(JSON.stringify({ status: 'error', message: 'x' }), ORIGIN).outcome).toBe('error');
  });
});
