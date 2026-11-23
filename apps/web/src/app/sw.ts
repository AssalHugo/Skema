/**
 * Service worker (Serwist, mode « configurator » compatible Turbopack) :
 * construit par `serwist build` après `next build` → `public/sw.js`.
 */
import { defaultCache } from "@serwist/next/worker";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { CacheFirst, ExpirationPlugin, Serwist } from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [
    // Schémas WebP des capsules (R2, immuables par clé ; CORS 200 via crossOrigin="anonymous").
    {
      matcher: ({ request, sameOrigin }) => !sameOrigin && request.destination === "image",
      handler: new CacheFirst({
        cacheName: "skema-diagrams",
        plugins: [new ExpirationPlugin({ maxEntries: 400, maxAgeSeconds: 30 * 24 * 3600 })],
      }),
    },
    ...defaultCache,
  ],
});

serwist.addEventListeners();
