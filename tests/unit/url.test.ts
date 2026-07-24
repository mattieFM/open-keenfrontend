import { describe, expect, it } from 'vitest';
import { buildSafeCurl, normalizeBaseUrl, safeDisplayUrl, serializeDeleteEventsScope, validateApprovedTarget } from '@shared/url';

describe('URL and destructive-scope safety', () => {
  it('normalizes Analytics and Dashboard bases without duplicating 3.0', () => {
    expect(normalizeBaseUrl('https://api.keen.io', 'analytics')).toBe('https://api.keen.io/3.0');
    expect(normalizeBaseUrl('https://api.keen.io/3.0/', 'analytics')).toBe('https://api.keen.io/3.0');
    expect(normalizeBaseUrl('https://dashboard-service.k-n.io/', 'dashboard')).toBe('https://dashboard-service.k-n.io');
  });

  it('preserves the Analytics base path and redacts key path values', () => {
    expect(safeDisplayUrl('https://api.keen.io/3.0', '/projects/p/queries/count')).toBe('https://api.keen.io/3.0/projects/p/queries/count');
    const redacted = safeDisplayUrl('https://api.keen.io/3.0', '/projects/p/keys/super-secret/revoke');
    expect(redacted).toContain('/keys/%3Credacted-key%3E/revoke');
    expect(redacted).not.toContain('super-secret');
  });

  it('rejects an empty filtered-delete scope and encodes Unicode/nested OR', () => {
    expect(() => serializeDeleteEventsScope({})).toThrow(/separate operation/i);
    const query = serializeDeleteEventsScope({ filters: [{ operator: 'or', operands: [{ property_name: 'city', operator: 'eq', property_value: 'Montréal & 東京' }, { property_name: 'tags', operator: 'in', property_value: ['a/b', 'x+y'] }] }], timeframe: { start: '2026-01-01T00:00:00Z', end: '2026-02-01T00:00:00Z' }, timezone: 'America/Toronto' });
    const parsed = new URLSearchParams(query);
    expect(JSON.parse(parsed.get('filters') ?? '[]')).toHaveLength(1);
    expect(parsed.get('timezone')).toBe('America/Toronto');
  });

  it('keeps secrets out of copied cURL', () => {
    const curl = buildSafeCurl({ method: 'POST', url: 'https://api.keen.io/3.0/projects/p/queries/count', body: { event_collection: "o'hare" } });
    expect(curl).toContain('Authorization: ${KEEN_KEY}');
    expect(curl).not.toContain('actual-secret');
  });

  it('enforces approved origins and origin-relative paths', () => {
    const approved = new Set(['https://api.keen.io/3.0']);
    expect(validateApprovedTarget('https://api.keen.io/3.0', '/projects/p/events', false, approved).toString()).toBe('https://api.keen.io/3.0/projects/p/events');
    expect(() => validateApprovedTarget('https://evil.example/3.0', '/projects/p', false, approved)).toThrow(/approved/);
    expect(() => validateApprovedTarget('https://api.keen.io/3.0', '//evil.example', false, approved)).toThrow(/origin-relative/);
    expect(() => validateApprovedTarget('https://api.keen.io/3.0', '/../admin', false, approved)).toThrow(/traversal/);
    expect(() => validateApprovedTarget('https://api.keen.io/custom/3.0', '/projects/p', false, approved)).toThrow(/base path/);
  });
});
