import { defineConfig } from "@trigger.dev/sdk";

export default defineConfig({
  project: process.env.TRIGGER_PROJECT_REF ?? "proj_a_renseigner",
  dirs: ["./src/trigger"],
  runtime: "node",
  build: {
    // Les modules de src/lib importent "server-only" : condition React Server,
    // comme pour les scripts tsx (--conditions=react-server).
    conditions: ["react-server"],
  },
  // Analyse vidéo agentique et longs PDF : plusieurs minutes (cf. plan, latence).
  maxDuration: 900,
  retries: {
    enabledInDev: false,
    default: {
      maxAttempts: 3,
      minTimeoutInMs: 2_000,
      maxTimeoutInMs: 30_000,
      factor: 2,
      randomize: true,
    },
  },
});
