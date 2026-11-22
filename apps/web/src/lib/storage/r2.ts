/**
 * Client Cloudflare R2 (API compatible S3).
 * - Les uploads de l'utilisateur passent par une URL pré-signée (le fichier ne
 *   transite jamais par une route Vercel, limitée à 4,5 Mo).
 * - Les assets publics (WebP, MP3) sont servis par le domaine personnalisé
 *   `R2_PUBLIC_BASE_URL` (egress gratuit).
 */
import "server-only";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  NotFound,
  PutObjectCommand,
  S3Client,
  type HeadObjectCommandOutput,
} from "@aws-sdk/client-s3";
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

/**
 * URL PUT pré-signée pour un écrivain de confiance (gcp-worker) dont la taille
 * de sortie n'est pas connue d'avance (lots PDF, conversion PPTX → PDF).
 */
export async function getPresignedPutUrl(params: {
  key: string;
  contentType: string;
  expiresInSec?: number;
}): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: r2Env().R2_BUCKET,
    Key: params.key,
    ContentType: params.contentType,
  });
  return getSignedUrl(getClient(), command, {
    expiresIn: params.expiresInSec ?? 3600,
    signableHeaders: new Set(["content-type"]),
  });
}

/** URL GET pré-signée (lecture d'un objet privé par gcp-worker ou Mistral OCR). */
export async function getPresignedDownloadUrl(key: string, expiresInSec = 3600): Promise<string> {
  const command = new GetObjectCommand({ Bucket: r2Env().R2_BUCKET, Key: key });
  return getSignedUrl(getClient(), command, { expiresIn: expiresInSec });
}

/** Métadonnées d'un objet, ou `null` s'il n'existe pas. */
export async function headObject(key: string): Promise<HeadObjectCommandOutput | null> {
  try {
    return await getClient().send(new HeadObjectCommand({ Bucket: r2Env().R2_BUCKET, Key: key }));
  } catch (err) {
    if (err instanceof NotFound || (err as { name?: string }).name === "NotFound") return null;
    throw err;
  }
}

/** Contenu complet d'un objet (lots PDF ≤ 40 Mo envoyés à Gemini). */
export async function getObjectBytes(key: string): Promise<Uint8Array> {
  const res = await getClient().send(new GetObjectCommand({ Bucket: r2Env().R2_BUCKET, Key: key }));
  if (!res.Body) throw new Error(`Objet R2 vide : ${key}`);
  return res.Body.transformToByteArray();
}

/**
 * Suppression d'objets (clé par clé : la suppression groupée S3 exige des
 * sommes de contrôle que R2 et le SDK ne négocient pas toujours bien).
 */
export async function deleteObjects(keys: string[], concurrency = 8): Promise<void> {
  for (let i = 0; i < keys.length; i += concurrency) {
    await Promise.all(
      keys
        .slice(i, i + concurrency)
        .map((Key) => getClient().send(new DeleteObjectCommand({ Bucket: r2Env().R2_BUCKET, Key }))),
    );
  }
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

function sanitizeSegment(segment: string, fallback: string): string {
  return (
    segment
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/\.{2,}/g, ".")
      .replace(/^-+|-+$/g, "")
      .slice(0, 120) || fallback
  );
}

/** Préfixe normalisé des objets d'un utilisateur : `<préfixe>/<userId>/`. */
export function userObjectPrefix(prefix: string, userId: string): string {
  return `${sanitizeSegment(prefix, "assets")}/${sanitizeSegment(userId, "anon")}/`;
}

/** Clé R2 normalisée : `<préfixe>/<userId>/<uuid>-<nom-assaini>`. */
export function buildObjectKey(prefix: string, userId: string, filename: string): string {
  const safeFile = sanitizeSegment(filename, "fichier");
  return `${userObjectPrefix(prefix, userId)}${crypto.randomUUID()}-${safeFile}`;
}
