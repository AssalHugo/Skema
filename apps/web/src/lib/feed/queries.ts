/** Feed vertical d'un utilisateur : capsules prêtes, dans l'ordre du cours. */
import "server-only";
import { and, asc, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import type { GeneratedStoryboard } from "@/lib/storyboard/types";
import type { FeedItem } from "./types";

const { episodes, concepts, chapters, courses, userProgress } = schema;

/** Plafond par chargement : ~15 Ko de storyboard par capsule. */
export const FEED_LIMIT = 60;

export async function getFeedForUser(
  userId: string,
  filter: { courseId?: string; chapterId?: string } = {},
): Promise<FeedItem[]> {
  const rows = await getDb()
    .select({
      episodeId: episodes.id,
      title: episodes.title,
      courseTitle: courses.title,
      chapterTitle: concepts.chapterTitle,
      storyboard: episodes.storyboardJson,
      watchedPct: userProgress.watchedPct,
      quizCorrect: userProgress.quizCorrect,
      seen: sql<boolean>`${userProgress.episodeId} is not null`,
    })
    .from(episodes)
    .innerJoin(courses, eq(episodes.courseId, courses.id))
    .innerJoin(concepts, eq(episodes.conceptId, concepts.id))
    .leftJoin(chapters, eq(concepts.chapterId, chapters.id))
    .leftJoin(userProgress, and(eq(userProgress.episodeId, episodes.id), eq(userProgress.userId, userId)))
    .where(
      and(
        eq(courses.userId, userId),
        eq(episodes.engineType, "generated"),
        eq(episodes.status, "ready"),
        filter.courseId ? eq(episodes.courseId, filter.courseId) : undefined,
        filter.chapterId ? eq(concepts.chapterId, filter.chapterId) : undefined,
      ),
    )
    // Capsules jamais terminées d'abord, puis l'ordre pédagogique du cours.
    .orderBy(
      sql`coalesce(${userProgress.watchedPct}, 0) >= 90`,
      asc(courses.createdAt),
      asc(chapters.orderIndex),
      asc(concepts.orderIndex),
    )
    .limit(FEED_LIMIT);

  return rows
    .filter((r) => r.storyboard)
    .map((r) => ({
      episodeId: r.episodeId,
      title: r.title,
      courseTitle: r.courseTitle,
      chapterTitle: r.chapterTitle,
      storyboard: r.storyboard as GeneratedStoryboard,
      progress: r.seen ? { watchedPct: r.watchedPct ?? 0, quizCorrect: r.quizCorrect } : null,
    }));
}
