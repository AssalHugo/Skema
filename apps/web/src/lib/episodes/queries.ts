/** Lecture d'une capsule par son propriétaire (pages et API). */
import "server-only";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import type { GeneratedStoryboard } from "@/lib/storyboard/types";

const { episodes, courses } = schema;

export async function getEpisodeForUser(userId: string, episodeId: string) {
  const [row] = await getDb()
    .select({
      id: episodes.id,
      conceptId: episodes.conceptId,
      courseId: episodes.courseId,
      courseTitle: courses.title,
      engineType: episodes.engineType,
      status: episodes.status,
      title: episodes.title,
      durationSec: episodes.durationSec,
      storyboard: episodes.storyboardJson,
      metrics: episodes.metrics,
      error: episodes.error,
      modelUsed: episodes.modelUsed,
      ttsVoice: episodes.ttsVoice,
      costUsd: episodes.costUsd,
    })
    .from(episodes)
    .innerJoin(courses, eq(episodes.courseId, courses.id))
    .where(and(eq(episodes.id, episodeId), eq(courses.userId, userId)));
  if (!row) return null;
  return { ...row, storyboard: (row.storyboard ?? null) as GeneratedStoryboard | null };
}

export type EpisodeForUser = NonNullable<Awaited<ReturnType<typeof getEpisodeForUser>>>;
