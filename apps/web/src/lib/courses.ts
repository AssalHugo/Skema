/** Lectures des cours d'un utilisateur (pages et API). */
import "server-only";
import { and, asc, count, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";

const { courses, chapters, concepts, courseDiagrams } = schema;

export type ChapterMetrics = {
  figures?: number;
  cropped?: number;
  cutTextRatio?: number;
  invalidBoxRatio?: number;
  concepts?: number;
  costUsd?: number;
  verdict?: { ok: boolean; fails: string[] };
};

export async function listCourses(userId: string) {
  return getDb()
    .select({
      id: courses.id,
      title: courses.title,
      status: courses.status,
      pageCount: courses.pageCount,
      createdAt: courses.createdAt,
    })
    .from(courses)
    .where(eq(courses.userId, userId))
    .orderBy(desc(courses.createdAt))
    .limit(50);
}

export async function getCourseOverview(userId: string, courseId: string) {
  const db = getDb();
  const course = await db.query.courses.findFirst({
    where: and(eq(courses.id, courseId), eq(courses.userId, userId)),
    columns: {
      id: true,
      title: true,
      discipline: true,
      status: true,
      error: true,
      pageCount: true,
      structureSource: true,
    },
  });
  if (!course) return null;

  const [rows, conceptCounts, diagramCounts] = await Promise.all([
    db
      .select({
        id: chapters.id,
        title: chapters.title,
        orderIndex: chapters.orderIndex,
        pageStart: chapters.pageStart,
        pageEnd: chapters.pageEnd,
        status: chapters.status,
        error: chapters.error,
        metrics: chapters.metrics,
        batches: chapters.batches,
      })
      .from(chapters)
      .where(eq(chapters.courseId, courseId))
      .orderBy(asc(chapters.orderIndex)),
    db
      .select({ chapterId: concepts.chapterId, n: count() })
      .from(concepts)
      .where(eq(concepts.courseId, courseId))
      .groupBy(concepts.chapterId),
    db
      .select({ chapterId: courseDiagrams.chapterId, n: count() })
      .from(courseDiagrams)
      .where(eq(courseDiagrams.courseId, courseId))
      .groupBy(courseDiagrams.chapterId),
  ]);
  const byChapter = (list: { chapterId: string | null; n: number }[]) =>
    new Map(list.map((r) => [r.chapterId, Number(r.n)]));
  const nConcepts = byChapter(conceptCounts);
  const nDiagrams = byChapter(diagramCounts);

  return {
    course,
    chapters: rows.map(({ batches, metrics, ...c }) => ({
      ...c,
      pages: c.pageEnd - c.pageStart + 1,
      batches: batches.length,
      concepts: nConcepts.get(c.id) ?? 0,
      diagrams: nDiagrams.get(c.id) ?? 0,
      metrics: (metrics ?? null) as ChapterMetrics | null,
    })),
  };
}

export type CourseOverview = NonNullable<Awaited<ReturnType<typeof getCourseOverview>>>;
