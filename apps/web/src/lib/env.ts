/**
 * Lecture validée des variables d'environnement côté serveur.
 * Chaque groupe est validé à la première utilisation, pour qu'une variable
 * manquante (ex. R2) n'empêche pas les autres modules de fonctionner.
 */
import "server-only";
import { z } from "zod";

function lazy<T extends z.ZodType>(schema: T) {
  let cached: z.infer<T> | undefined;
  return (): z.infer<T> => {
    if (cached === undefined) {
      const parsed = schema.safeParse(process.env);
      if (!parsed.success) {
        const names = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
        throw new Error(`Variables d'environnement manquantes ou invalides : ${names}`);
      }
      cached = parsed.data;
    }
    return cached as z.infer<T>;
  };
}

const emptyToUndefined = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (v === "" ? undefined : v), schema);

export const dbEnv = lazy(z.object({ DATABASE_URL: z.url() }));

export const r2Env = lazy(
  z.object({
    R2_ACCOUNT_ID: z.string().min(1),
    R2_ACCESS_KEY_ID: z.string().min(1),
    R2_SECRET_ACCESS_KEY: z.string().min(1),
    R2_BUCKET: z.string().min(1),
    R2_PUBLIC_BASE_URL: z.url(),
    // Facultatif : par défaut https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com
    R2_ENDPOINT: emptyToUndefined(z.url().optional()),
  }),
);

export const geminiEnv = lazy(
  z.object({
    GEMINI_API_KEY: z.string().min(1),
    GEMINI_MODEL_QUALITY: emptyToUndefined(z.string().min(1).default("gemini-4-hydrogen")),
    GEMINI_MODEL_BULK: emptyToUndefined(z.string().min(1).default("gemini-3.8-flash")),
    GEMINI_MODEL_LITE: emptyToUndefined(z.string().min(1).default("gemini-3.5-flash-lite")),
  }),
);

export const authEnv = lazy(
  z.object({
    BETTER_AUTH_SECRET: z.string().min(32),
    BETTER_AUTH_URL: emptyToUndefined(z.url().optional()),
    GOOGLE_OAUTH_CLIENT_ID: emptyToUndefined(z.string().min(1).optional()),
    GOOGLE_OAUTH_CLIENT_SECRET: emptyToUndefined(z.string().min(1).optional()),
  }),
);

export const workerEnv = lazy(
  z.object({
    GCP_WORKER_URL: z.url(),
    GCP_WORKER_SECRET: z.string().min(32),
  }),
);

export const ingestEnv = lazy(
  z.object({
    // gemini (défaut, validé en S.2) | mistral (repli si les seuils de S.2 échouent)
    PDF_EXTRACTOR: emptyToUndefined(z.enum(["gemini", "mistral"]).default("gemini")),
    MISTRAL_API_KEY: emptyToUndefined(z.string().min(1).optional()),
  }),
);
