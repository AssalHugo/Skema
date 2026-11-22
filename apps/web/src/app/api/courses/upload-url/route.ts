import { z } from "zod";
import { HttpError, parseJson, withUser } from "@/lib/api/http";
import { MAX_UPLOAD_BYTES, UPLOAD_TYPES, uploadExtension } from "@/lib/ingest/uploads";
import { buildObjectKey, getPresignedUploadUrl } from "@/lib/storage/r2";

const Body = z.object({
  filename: z.string().trim().min(1).max(255),
  size: z.number().int().positive().max(MAX_UPLOAD_BYTES),
});

/**
 * URL PUT pré-signée : le navigateur envoie le PDF ou le diaporama directement
 * sur R2 (120+ Mo possibles, sans passer par Vercel).
 */
export async function POST(request: Request) {
  return withUser(async (user) => {
    const { filename, size } = await parseJson(request, Body);
    const ext = uploadExtension(filename);
    if (!ext) throw new HttpError(415, "Formats acceptés : PDF, PPTX, PPT, ODP");
    const key = buildObjectKey("uploads", user.id, filename);
    const upload = await getPresignedUploadUrl({
      key,
      contentType: UPLOAD_TYPES[ext],
      contentLength: size,
      expiresInSec: 3600,
    });
    return Response.json(upload);
  });
}
