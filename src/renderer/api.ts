import type { DiterApi } from './types';
import { createMock } from './mock';

declare global {
  interface Window {
    diter?: DiterApi;
    __DITER_MOCK__?: boolean;
  }
}

let cached: DiterApi | null = null;

export function api(): DiterApi {
  if (cached) return cached;
  if (window.diter && !window.__DITER_MOCK__) {
    cached = window.diter;
  } else {
    cached = createMock();
  }
  return cached;
}

export const isMock = () => !window.diter || !!window.__DITER_MOCK__;
