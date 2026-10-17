import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import type { DashboardDocument } from '../../src/shared/types';
import { launchTestApp } from './electronHarness';

async function resizeWindow(app: ElectronApplication, page: Page, width: number) {
  await app.evaluate(({ BrowserWindow }, nextWidth) => {
    BrowserWindow.getAllWindows()[0].setContentSize(nextWidth, 1000);
  }, width);
  await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(width);
}

async function readDashboard(page: Page, id: string): Promise<DashboardDocument> {
  return page.evaluate((dashboardId) => new Promise<DashboardDocument>((resolve, reject) => {
    const opened = indexedDB.open('keen-key-console');
    opened.onerror = () => reject(opened.error);
    opened.onsuccess = () => {
      const database = opened.result;
      const transaction = database.transaction('dashboards', 'readonly');
      const request = transaction.objectStore('dashboards').get(dashboardId);
      request.onsuccess = () => resolve(request.result as DashboardDocument);
      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => database.close();
      transaction.onabort = () => { database.close(); reject(transaction.error); };
    };
  }), id);
}

async function openDemoDashboard(app: ElectronApplication, width = 1500) {
  const page = await app.firstWindow();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await resizeWindow(app, page, width);
  await page.getByRole('button', { name: 'Demo', exact: true }).click();
  const card = page.locator('.dashboard-card').filter({ hasText: 'Session overview' });
  await expect(card).toHaveCount(1);
  const edit = card.getByRole('link', { name: 'Edit visually' });
  const id = (await edit.getAttribute('href'))?.match(/\/dashboards\/([^/]+)\/edit$/)?.[1];
  if (!id) throw new Error('The synthetic session dashboard has no editor link.');
  const original = await readDashboard(page, id);
  await edit.click();
  await expect(page.getByText('Saved locally', { exact: true })).toBeVisible();
  await expect(page.locator('.dashboard-widget')).toHaveCount(original.widgets.length);
  return { page, id, original };
}

async function layoutViolations(page: Page) {
  return page.locator('.dashboard-grid').evaluate((grid) => {
    const bounds = grid.getBoundingClientRect();
    const widgets = [...grid.querySelectorAll('.dashboard-widget')].map((widget) => ({
      title: widget.getAttribute('aria-label'),
      box: widget.getBoundingClientRect()
    }));
    const violations: string[] = [];
    for (const [index, widget] of widgets.entries()) {
      const box = widget.box;
      if (box.width <= 0 || box.height <= 0 || box.left < bounds.left - 1 || box.right > bounds.right + 1
        || box.top < bounds.top - 1 || box.bottom > bounds.bottom + 1) violations.push(`Out of bounds: ${widget.title}`);
      for (const other of widgets.slice(index + 1)) {
        if (box.left < other.box.right - 1 && box.right > other.box.left + 1
          && box.top < other.box.bottom - 1 && box.bottom > other.box.top + 1) {
          violations.push(`Overlap: ${widget.title} / ${other.title}`);
        }
      }
    }
    return violations;
  });
}

async function expectAlignedEditorFields(page: Page) {
  const controls = page.locator('.dashboard-title-fields input, .dashboard-title-fields select');
  await expect(controls).toHaveCount(3);
  await expect.poll(() => controls.evaluateAll((elements) => {
    const boxes = elements.map((element) => element.getBoundingClientRect());
    return Math.max(
      Math.max(...boxes.map((box) => box.top)) - Math.min(...boxes.map((box) => box.top)),
      Math.max(...boxes.map((box) => box.bottom)) - Math.min(...boxes.map((box) => box.bottom))
    );
  })).toBeLessThanOrEqual(1);
}

async function expectAlignedMetricRow(page: Page, document: DashboardDocument) {
  const rows = new Map<number, string[]>();
  for (const widget of document.widgets) {
    if (widget.type !== 'chart' || widget.chartType !== 'metric') continue;
    const position = document.layout.find((item) => item.i === widget.id);
    if (position) rows.set(position.y, [...rows.get(position.y) ?? [], widget.title]);
  }
  const titles = [...rows.values()].find((row) => row.length > 1);
  if (!titles) throw new Error('The synthetic dashboard needs multiple metrics in one saved row.');
  await expect.poll(() => page.locator('.dashboard-widget').evaluateAll((elements, names) => {
    const tops = elements.filter((element) => names.includes(element.getAttribute('aria-label') ?? ''))
      .map((element) => element.getBoundingClientRect().top);
    return tops.length === names.length ? Math.max(...tops) - Math.min(...tops) : Infinity;
  }, titles)).toBeLessThanOrEqual(1);
}

test('keeps dashboard rows aligned without saving responsive reflows', async () => {
  const { app, close } = await launchTestApp();
  try {
    const { page, id, original } = await openDemoDashboard(app);
    const undo = page.getByRole('button', { name: 'Undo', exact: true });

    for (const width of [1500, 1100, 1500]) {
      await resizeWindow(app, page, width);
      await expect.poll(() => layoutViolations(page)).toEqual([]);
      await expectAlignedEditorFields(page);
      await expectAlignedMetricRow(page, original);
      await expect(undo).toBeDisabled();
      expect(await readDashboard(page, id)).toEqual(original);
    }

    const previousWidth = await page.locator('.dashboard-grid').evaluate((element) => element.clientWidth);
    await page.getByRole('button', { name: 'Collapse', exact: true }).click();
    await expect.poll(() => page.locator('.dashboard-grid').evaluate((element) => element.clientWidth)).toBeGreaterThan(previousWidth);
    await expect.poll(() => layoutViolations(page)).toEqual([]);
    await expectAlignedEditorFields(page);
    await expectAlignedMetricRow(page, original);
    // Outlast the editor's debounce so a measurement-triggered write cannot hide.
    await page.waitForTimeout(1100);
    await expect(undo).toBeDisabled();
    expect(await readDashboard(page, id)).toEqual(original);
  } finally {
    await close();
  }
});

test('persists keyboard layout edits and Undo through immediate previews', async () => {
  const { app, close } = await launchTestApp();
  try {
    const { page, id, original } = await openDemoDashboard(app);
    const widget = page.getByRole('region', { name: 'Sessions started', exact: true });
    await widget.getByRole('button', { name: 'Move down', exact: true }).press('Enter');
    await expect(page.getByText('Saving…', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Preview', exact: true }).click();
    await expect(page).toHaveURL(/\/view$/);

    const moved = await readDashboard(page, id);
    expect(moved.layout).not.toEqual(original.layout);
    await expect.poll(() => layoutViolations(page)).toEqual([]);
    await page.getByRole('link', { name: 'Edit', exact: true }).click();
    await expect(page.getByText('Saved locally', { exact: true })).toBeVisible();
    expect((await readDashboard(page, id)).layout).toEqual(moved.layout);
    await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();

    await widget.getByRole('button', { name: 'Move down', exact: true }).press('Enter');
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await page.getByRole('button', { name: 'Preview', exact: true }).click();
    await expect(page).toHaveURL(/\/view$/);
    await page.waitForTimeout(1100);
    expect((await readDashboard(page, id)).layout).toEqual(moved.layout);
    await expect.poll(() => layoutViolations(page)).toEqual([]);
  } finally {
    await close();
  }
});

test('saves a pointer resize at the initial medium width without replacing desktop positions', async () => {
  const { app, close } = await launchTestApp();
  try {
    const { page, id, original } = await openDemoDashboard(app, 1100);
    const widget = page.getByRole('region', { name: 'Sessions started', exact: true });
    const handle = widget.locator('.react-resizable-handle-se');
    await handle.scrollIntoViewIfNeeded();
    const handleBox = await handle.boundingBox();
    const gridBox = await page.locator('.dashboard-grid').boundingBox();
    if (!handleBox || !gridBox) throw new Error('The medium-width dashboard resize handle is missing.');
    expect(gridBox.width).toBeGreaterThanOrEqual(760);
    expect(gridBox.width).toBeLessThan(1100);

    const step = (gridBox.width - original.settings.gridGap) / 8;
    const x = handleBox.x + handleBox.width / 2;
    const y = handleBox.y + handleBox.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + step, y, { steps: 8 });
    await page.mouse.up();
    await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Preview', exact: true }).click();
    await expect(page).toHaveURL(/\/view$/);

    const resized = await readDashboard(page, id);
    const target = original.widgets.find((item) => item.type === 'chart' && item.title === 'Sessions started');
    expect(target).toBeDefined();
    expect(resized.layout).toEqual(original.layout);
    expect(resized.responsiveLayouts?.md?.find((item) => item.i === target?.id)?.w).toBe(3);
    await expect.poll(() => layoutViolations(page)).toEqual([]);

    await page.getByRole('link', { name: 'Edit', exact: true }).click();
    await expect(page.getByText('Saved locally', { exact: true })).toBeVisible();
    expect((await readDashboard(page, id)).responsiveLayouts).toEqual(resized.responsiveLayouts);
    await resizeWindow(app, page, 1500);
    await expectAlignedMetricRow(page, original);
    await expect.poll(() => layoutViolations(page)).toEqual([]);
    await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
    expect((await readDashboard(page, id)).layout).toEqual(original.layout);
    expect((await readDashboard(page, id)).responsiveLayouts).toEqual(resized.responsiveLayouts);
  } finally {
    await close();
  }
});
