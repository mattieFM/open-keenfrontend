import { test, expect, _electron as electron } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('boots to read-only Project ID and key entry', async () => {
  const app = await electron.launch({ args: ['.'] });
  try {
    const page = await app.firstWindow();
    await expect(page.getByText(/Read-only on every boot/i)).toBeVisible();
    await expect(page.getByLabel(/Project ID/i)).toBeVisible();
    await expect(page.getByLabel(/Credential value/i)).toBeVisible();
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  } finally {
    await app.close();
  }
});
