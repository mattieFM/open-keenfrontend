import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

// Vitest 2.x runs on its own Vite 5 dependency while the Electron renderer
// builds with Vite 6. React Fast Refresh/Babel transforms are not needed in
// jsdom unit tests, so keep the test config on Vitest's built-in TSX transform
// instead of importing a plugin typed against the renderer's Vite instance.
export default defineConfig({
  resolve: { alias: { '@': resolve('src/renderer/src'), '@shared': resolve('src/shared') } },
  test: {
    environment: 'jsdom',
    setupFiles: ['tests/setup.ts'],
    include: ['tests/unit/**/*.test.{ts,tsx}', 'tests/live/**/*.test.ts'],
    exclude: ['tests/e2e/**'],
    restoreMocks: true,
    clearMocks: true,
    testTimeout: 15_000
  }
});
