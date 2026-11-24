import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { HttpError, parseJson, withUser } from "@/lib/api/http";
import { getDb, schema } from "@/lib/db";

const { episodes, courses, userProgress } = schema;

const Body = z
  .object({
    episodeId: z.uuid(),
    watchedPct: z.number().min(0).max(100).optional(),
    quizCorrect: z.boolean().optional(),
  })
  .refine((b) => b.watchedPct !== undefined || b.quizCorrect !== undefined);

/**
 * Progression d'une capsule du feed (phase 3) : pourcentage regardé (on garde
 * le maximum) et dernière réponse au quiz. La répétition espacée
 * (`next_review_at`, SM-2) arrive en phase 5.
 */
export async function POST(request: Request) {
  return withUser(async (user) => {
    const body = await parseJson(request, Body);
    const db = getDb();
    const [owned] = await db
      .select({ id: episodes.id })
      .from(episodes)
      .innerJoin(courses, eq(episodes.courseId, courses.id))
      .where(and(eq(episodes.id, body.episodeId), eq(courses.userId, user.id)));
    if (!owned) throw new HttpError(404, "Capsule introuvable");

    const pct = body.watchedPct ?? 0;
    const [row] = await db
      .insert(userProgress)
      .values({ userId: user.id, episodeId: body.episodeId, watchedPct: pct, quizCorrect: body.quizCorrect ?? null })
      .onConflictDoUpdate({
        target: [userProgress.userId, userProgress.episodeId],
        set: {
          watchedPct: sql`greatest(coalesce(${userProgress.watchedPct}, 0), excluded.watched_pct)`,
          ...(body.quizCorrect !== undefined ? { quizCorrect: body.quizCorrect } : {}),
          updatedAt: new Date(),
        },
      })
      .returning({ watchedPct: userProgress.watchedPct, quizCorrect: userProgress.quizCorrect });
    return Response.json(row);
  });
}
