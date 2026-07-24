import { describe, expect, it } from 'vitest';

const projectId = process.env.KEEN_TEST_PROJECT_ID;
const accessKey = process.env.KEEN_TEST_ACCESS_KEY || process.env.KEEN_TEST_READ_KEY;
const dashboardHost = (process.env.KEEN_TEST_DASHBOARD_HOST || 'https://dashboard-service.k-n.io').replace(/\/$/, '');
const enabled = Boolean(projectId && accessKey);

describe.skipIf(!enabled)('source-observed Dashboard service read contract', () => {
  it('records the current status and safe shape without mutations', async () => {
    const response = await fetch(`${dashboardHost}/projects/${encodeURIComponent(projectId!)}/dashboards/metadata`, { headers: { Authorization: accessKey!, Accept: 'application/json' } });
    expect([200, 401, 403, 404]).toContain(response.status);
    if (response.ok) {
      const value = await response.json();
      expect(Array.isArray(value) || (value && typeof value === 'object')).toBe(true);
    }
  });
});
