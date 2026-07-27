import { test, expect, _electron as electron } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('boots to read-only Project ID and key entry', async () => {
  const app = await electron.launch({ args: ['.'] });
  try {
    const page = await app.firstWindow();
    await expect(page.getByText(/Read-only on every boot/i)).toBeVisible();
    await expect(page.getByLabel(/Project ID/i)).toBeVisible();
    await expect(page.getByLabel(/Credential value/i)).toBeVisible();
    // Axe's default Playwright runner opens a temporary page to merge cross-frame
    // results. ElectronApplication browser contexts cannot create arbitrary pages,
    // and this boot screen contains no iframes, so use Axe's documented single-page
    // compatibility mode instead.
    await expect(page.locator('iframe')).toHaveCount(0);
    const results = await new AxeBuilder({ page })
      .setLegacyMode()
      .analyze();
    expect(results.violations).toEqual([]);
  } finally {
    await app.close();
  }
});
