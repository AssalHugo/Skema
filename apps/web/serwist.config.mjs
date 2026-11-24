// @ts-check
// Serwist en mode « configurator » (Turbopack) : `serwist build` après `next build`.
import { serwist } from "@serwist/next/config";

export default serwist({
  swSrc: "src/app/sw.ts",
  swDest: "public/sw.js",
  // Les pages dépendent de la session : seules les ressources statiques sont pré-cachées.
  precachePrerendered: false,
});
