# Accessibility Statement

## Target

The project targets WCAG 2.2 AA for the Electron console and the isolated public viewer.

## Implemented foundations

- semantic buttons, labels, tables, headings, and dialogs;
- visible keyboard focus and no color-only permission states;
- chart titles, text summaries, and table/JSON fallbacks;
- keyboard buttons for dashboard widget move and resize in addition to pointer drag/resize;
- reduced-motion rules in the application stylesheet;
- field-linked validation text and explicit permission language;
- required image alt text unless a widget is deliberately decorative;
- external links opened without giving the renderer arbitrary navigation;
- tabular result captions and machine-safe exported values;
- distinct loading, empty, denied/error, paused, and read-only states.

## Automated coverage present

- Testing Library boot-screen semantics test;
- Playwright Electron startup flow;
- Axe scan of the boot connection page.

The complete dependency-backed test run has not been executed in this build environment because npm dependency installation timed out before creating `node_modules`. See `REVALIDATION_2026-07-23.md`.

## Known accessibility gaps

- Large result tables cap rendered rows rather than using a fully ARIA-reviewed semantic virtualizer.
- ECharts canvas/SVG output relies on the adjacent textual summary and table; individual graphical marks are not separately keyboard navigable.
- Dashboard drag behavior needs broader screen-reader and switch-device testing on each packaged platform.
- Localization strings are not yet externalized into translation catalogs, and RTL layout is not covered by an automated suite.
- Every theme and imported dashboard combination still requires contrast regression testing.

These items prevent claiming independently audited WCAG conformance. They do not remove the built-in nonvisual table/JSON paths.
