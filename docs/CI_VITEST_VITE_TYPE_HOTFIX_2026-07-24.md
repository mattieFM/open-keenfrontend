# CI hotfix: Vitest/Vite plugin type collision

Date: 2026-07-24

## Failure

`tsc --noEmit` failed in `vitest.config.ts` because the React Vite plugin was
resolved against the application's Vite 6 installation while Vitest 2.1.9
resolved its own Vite 5 installation. Vite plugin types are structurally tied
to their originating Vite package, so TypeScript correctly rejected the plugin
array passed across the two package instances.

## Fix

The Vitest configuration no longer imports `@vitejs/plugin-react`. The unit and
live-contract suites run in jsdom and do not need Fast Refresh or Babel plugin
transforms. Vitest/Vite's built-in TypeScript/TSX transform is sufficient for
these tests and keeps the test configuration entirely within Vitest's Vite type
universe.

The renderer production build continues to use `@vitejs/plugin-react` in
`electron.vite.config.ts`.

A static invariant now rejects reintroducing the renderer React plugin into the
Vitest configuration before the semantic TypeScript stage.

## Expected CI progression

The following stages had already passed in the reported run:

- release workflow validation;
- release fixture tests;
- ESLint;
- dependency-light core tests;
- Vitest;
- static audit.

After this change, `typecheck:ci` should no longer emit TS2769 at
`vitest.config.ts:6`. The next hosted gates are the Electron bundle build,
bundle verification, startup smoke test, accessibility test, and native package
matrix.
