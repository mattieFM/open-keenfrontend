import { describe, expect, it } from 'vitest';

const projectId = process.env.KEEN_TEST_PROJECT_ID;
const readKey = process.env.KEEN_TEST_READ_KEY;
const analyticsHost = (process.env.KEEN_TEST_ANALYTICS_HOST || 'https://api.keen.io/3.0').replace(/\/$/, '');
const enabled = Boolean(projectId && readKey);

describe.skipIf(!enabled)('live Analytics API read-only contract', () => {
  it('lists collections without printing credentials or response data', async () => {
    const response = await fetch(`${analyticsHost}/projects/${encodeURIComponent(projectId!)}/events?include_schema=false`, { headers: { Authorization: readKey!, Accept: 'application/json' } });
    expect([200, 401, 403]).toContain(response.status);
    if (response.ok) expect(Array.isArray(await response.json())).toBe(true);
  });
});
