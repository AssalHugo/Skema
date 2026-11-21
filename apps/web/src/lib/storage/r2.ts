/**
 * Client Cloudflare R2 (API compatible S3).
 * - Les uploads de l'utilisateur passent par une URL pré-signée (le fichier ne
 *   transite jamais par une route Vercel, limitée à 4,5 Mo).
 * - Les assets publics (WebP, MP3) sont servis par le domaine personnalisé
 *   `R2_PUBLIC_BASE_URL` (egress gratuit).
 */
import "server-only";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { r2Env } from "@/lib/env";

let client: S3Client | undefined;

function getClient(): S3Client {
  if (!client) {
    const env = r2Env();
    client = new S3Client({
      region: "auto",
      endpoint: env.R2_ENDPOINT ?? `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: env.R2_ACCESS_KEY_ID,
        secretAccessKey: env.R2_SECRET_ACCESS_KEY,
      },
      // R2 ne gère pas les checksums CRC32 ajoutés par défaut aux URL pré-signées.
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    });
  }
  return client;
}

export interface PresignedUpload {
  url: string;
  key: string;
  /** En-têtes que le client DOIT renvoyer tels quels avec le PUT. */
  headers: Record<string, string>;
  expiresAt: Date;
}

/**
 * URL pré-signée pour un PUT direct depuis le navigateur.
 * La taille est signée (`Content-Length`) : un fichier différent est refusé.
 */
export async function getPresignedUploadUrl(params: {
  key: string;
  contentType: string;
  contentLength: number;
  expiresInSec?: number;
}): Promise<PresignedUpload> {
  const expiresIn = params.expiresInSec ?? 600;
  const command = new PutObjectCommand({
    Bucket: r2Env().R2_BUCKET,
    Key: params.key,
    ContentType: params.contentType,
    ContentLength: params.contentLength,
  });
  const url = await getSignedUrl(getClient(), command, {
    expiresIn,
    signableHeaders: new Set(["content-type", "content-length"]),
  });
  return {
    url,
    key: params.key,
    headers: { "Content-Type": params.contentType },
    expiresAt: new Date(Date.now() + expiresIn * 1000),
  };
}

/** Upload côté serveur (WebP des schémas, MP3 des capsules…). */
export async function uploadBufferToR2(params: {
  key: string;
  body: Uint8Array | Buffer;
  contentType: string;
  cacheControl?: string;
}): Promise<{ key: string; url: string }> {
  await getClient().send(
    new PutObjectCommand({
      Bucket: r2Env().R2_BUCKET,
      Key: params.key,
      Body: params.body,
      ContentType: params.contentType,
      // Les assets générés sont immuables (clé unique par version).
      CacheControl: params.cacheControl ?? "public, max-age=31536000, immutable",
    }),
  );
  return { key: params.key, url: getPublicAssetUrl(params.key) };
}

/** URL publique d'un objet via le domaine personnalisé R2. */
export function getPublicAssetUrl(key: string): string {
  const base = r2Env().R2_PUBLIC_BASE_URL.replace(/\/+$/, "");
  const path = key.replace(/^\/+/, "").split("/").map(encodeURIComponent).join("/");
  return `${base}/${path}`;
}

/** Clé R2 normalisée : `<préfixe>/<userId>/<uuid>-<nom-assaini>`. */
export function buildObjectKey(prefix: string, userId: string, filename: string): string {
  const safe = filename
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || "fichier";
  return `${prefix}/${userId}/${crypto.randomUUID()}-${safe}`;
}
