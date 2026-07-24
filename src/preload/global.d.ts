import type { DesktopBridge } from '../shared/types';

declare global {
  interface Window {
    keenDesktop: DesktopBridge;
  }
}

export {};
