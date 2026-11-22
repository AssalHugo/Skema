/**
 * Moteur 2 — capsule générée (phase 2).
 *
 * Phase 1 : point d'entrée seulement, pour que `ingest-chapter` puisse déjà
 * déclencher le fan-out. Le script, le TTS et l'upload arrivent en phase 2.
 */
import { logger, schemaTask } from "@trigger.dev/sdk";
import { z } from "zod";

export const generateEpisode = schemaTask({
  id: "generate-episode",
  schema: z.object({ conceptId: z.uuid() }),
  queue: { name: "generate-episode", concurrencyLimit: 5 },
  run: async ({ conceptId }) => {
    logger.info("generate-episode : implémenté en phase 2", { conceptId });
    return { conceptId, skipped: true as const, reason: "phase 2" };
  },
});
