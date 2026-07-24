import 'fake-indexeddb/auto';
import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

Object.defineProperty(window, 'keenDesktop', {
  configurable: true,
  writable: true,
  value: {
    getVersion: vi.fn(async () => 'test'),
    approveHosts: vi.fn(async () => undefined),
    request: vi.fn(async () => ({ ok: false, error: { kind: 'network', message: 'No test transport configured.', retryable: false } })),
    cancel: vi.fn(),
    saveText: vi.fn(async () => ({ saved: false })),
    saveBinary: vi.fn(async () => ({ saved: false })),
    openText: vi.fn(async () => ({ opened: false })),
    openExternal: vi.fn(async () => undefined)
  }
});

afterEach(() => cleanup());
