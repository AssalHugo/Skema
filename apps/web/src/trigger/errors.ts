import { AbortTaskRunError } from "@trigger.dev/sdk";
import { WorkerError } from "@/lib/worker/client";

/** Erreur définitive du worker (PDF corrompu, protégé…) : pas de nouvel essai. */
export async function abortIfPermanent<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof WorkerError && err.isPermanent) throw new AbortTaskRunError(err.message);
    throw err;
  }
}

/** Message court et lisible pour les colonnes `error` (affiché dans l'UI). */
export function errorMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.slice(0, 500);
}
