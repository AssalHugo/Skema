import { tasks } from "@trigger.dev/sdk";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { HttpError, parseJson, withUser } from "@/lib/api/http";
import { getDb, schema } from "@/lib/db";
import { MAX_UPLOAD_BYTES, titleFromFilename, uploadExtension } from "@/lib/ingest/uploads";
import { headObject, userObjectPrefix } from "@/lib/storage/r2";
import type { ingestCourse } from "@/trigger/ingest-course";

const Body = z.object({
  key: z.string().min(1).max(1024),
  title: z.string().trim().max(160).optional(),
  discipline: z.string().trim().min(1).max(60).optional(),
});

/**
 * Enregistre le cours uploadé et lance l'ingestion légère (`ingest-course` :
 * structure et chapitres, sans génération de capsules).
 */
export async function POST(request: Request) {
  return withUser(async (user) => {
    const { key, title, discipline } = await parseJson(request, Body);
    const prefix = userObjectPrefix("uploads", user.id);
    if (!key.startsWith(prefix) || key.includes("..")) throw new HttpError(403, "Fichier d'un autre utilisateur");
    if (!uploadExtension(key)) throw new HttpError(415, "Formats acceptés : PDF, PPTX, PPT, ODP");

    const db = getDb();
    // Double clic ou nouvel essai : on renvoie le cours déjà créé pour ce fichier.
    const existing = await db.query.courses.findFirst({
      where: and(eq(schema.courses.userId, user.id), eq(schema.courses.sourceR2Key, key)),
    });
    if (existing) return Response.json({ courseId: existing.id, status: existing.status, existing: true });

    const head = await headObject(key);
    if (!head) throw new HttpError(404, "Fichier introuvable sur R2 : l'upload est-il terminé ?");
    if ((head.ContentLength ?? 0) > MAX_UPLOAD_BYTES) throw new HttpError(413, "Fichier trop volumineux");

    const filename = key.slice(prefix.length).replace(/^[0-9a-f-]{36}-/, "");
    const [course] = await db
      .insert(schema.courses)
      .values({
        userId: user.id,
        title: title || titleFromFilename(filename),
        ...(discipline ? { discipline } : {}),
        sourceR2Key: key,
      })
      .returning({ id: schema.courses.id });

    try {
      const handle = await tasks.trigger<typeof ingestCourse>(
        "ingest-course",
        { courseId: course.id },
        { idempotencyKey: `ingest-course:${course.id}`, tags: [`course:${course.id}`, `user:${user.id}`] },
      );
      return Response.json(
        { courseId: course.id, status: "processing", runId: handle.id, publicAccessToken: handle.publicAccessToken },
        { status: 202 },
      );
    } catch (err) {
      console.error("[ingest] déclenchement Trigger.dev impossible", err);
      await db
        .update(schema.courses)
        .set({ status: "failed", error: "Déclenchement de l'ingestion impossible" })
        .where(eq(schema.courses.id, course.id));
      throw new HttpError(502, "Ingestion non lancée (Trigger.dev indisponible)");
    }
  });
}
