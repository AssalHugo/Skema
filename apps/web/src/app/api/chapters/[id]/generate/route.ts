import { tasks } from "@trigger.dev/sdk";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { HttpError, withUser } from "@/lib/api/http";
import { getDb, schema } from "@/lib/db";
import type { ingestChapter } from "@/trigger/ingest-chapter";

const { chapters, courses } = schema;

/**
 * Lance, à la demande, la génération d'un chapitre (`ingest-chapter` :
 * schémas, concepts, puis moteurs 2 et 1). `?force=1` régénère un chapitre prêt.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/chapters/[id]/generate">) {
  return withUser(async (user) => {
    const { id } = await ctx.params;
    if (!z.uuid().safeParse(id).success) throw new HttpError(404, "Chapitre introuvable");
    const force = new URL(request.url).searchParams.get("force") === "1";

    const db = getDb();
    const [row] = await db
      .select({ status: chapters.status, courseStatus: courses.status })
      .from(chapters)
      .innerJoin(courses, eq(chapters.courseId, courses.id))
      .where(and(eq(chapters.id, id), eq(courses.userId, user.id)));
    if (!row) throw new HttpError(404, "Chapitre introuvable");
    if (row.courseStatus !== "ready") throw new HttpError(409, "Le cours est encore en cours d'analyse");

    // Passage atomique en « processing » : deux clics ne lancent qu'une tâche.
    const allowed: (typeof row.status)[] = force ? ["pending", "failed", "ready"] : ["pending", "failed"];
    const [claimed] = await db
      .update(chapters)
      .set({ status: "processing", error: null })
      .where(and(eq(chapters.id, id), inArray(chapters.status, allowed)))
      .returning({ id: chapters.id });
    if (!claimed) {
      throw new HttpError(
        409,
        row.status === "processing" ? "Génération déjà en cours" : "Chapitre déjà généré (?force=1 pour régénérer)",
      );
    }

    try {
      const handle = await tasks.trigger<typeof ingestChapter>(
        "ingest-chapter",
        { chapterId: id },
        { tags: [`chapter:${id}`, `user:${user.id}`] },
      );
      return Response.json(
        { chapterId: id, status: "processing", runId: handle.id, publicAccessToken: handle.publicAccessToken },
        { status: 202 },
      );
    } catch (err) {
      console.error("[generate] déclenchement Trigger.dev impossible", err);
      await db.update(chapters).set({ status: row.status }).where(eq(chapters.id, id));
      throw new HttpError(502, "Génération non lancée (Trigger.dev indisponible)");
    }
  });
}
