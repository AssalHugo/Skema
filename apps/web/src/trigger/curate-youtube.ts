/**
 * Moteur 1 — curation YouTube (phase 4).
 *
 * Phase 1 : point d'entrée seulement, pour que `ingest-chapter` puisse déjà
 * déclencher le fan-out. La recherche et la découpe agentique arrivent en phase 4.
 */
import { logger, schemaTask } from "@trigger.dev/sdk";
import { z } from "zod";

export const curateYoutube = schemaTask({
  id: "curate-youtube",
  schema: z.object({ conceptId: z.uuid() }),
  queue: { name: "curate-youtube", concurrencyLimit: 3 },
  run: async ({ conceptId }) => {
    logger.info("curate-youtube : implémenté en phase 4", { conceptId });
    return { conceptId, skipped: true as const, reason: "phase 4" };
  },
});
