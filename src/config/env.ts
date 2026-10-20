/** Toda EXPO_PUBLIC_* es visible en el bundle. Solo contiene la URL propia. */
export const API_URL = (process.env.EXPO_PUBLIC_API_URL ||
  'https://biblioteca-api-2026.vercel.app').replace(/\/+$/, '');
export const REQUEST_TIMEOUT_MS = 15_000;
