import { redirect } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";
import { VerticalFeed } from "@/components/player/VerticalFeed";
import { getSession } from "@/lib/auth";
import { getFeedForUser } from "@/lib/feed/queries";

export const metadata = { title: "Session · Skema" };

const Params = z.object({ course: z.uuid().optional(), chapter: z.uuid().optional() });

/** Feed vertical de révision : `/feed`, `/feed?course=<id>`, `/feed?chapter=<id>`. */
export default function FeedPage({ searchParams }: PageProps<"/feed">) {
  return (
    <Suspense fallback={<div className="h-[100dvh] bg-background" />}>
      <FeedSection searchParams={searchParams} />
    </Suspense>
  );
}

async function FeedSection({ searchParams }: { searchParams: PageProps<"/feed">["searchParams"] }) {
  const session = await getSession();
  if (!session) redirect("/login");
  const raw = await searchParams;
  const parsed = Params.safeParse({
    course: typeof raw.course === "string" ? raw.course : undefined,
    chapter: typeof raw.chapter === "string" ? raw.chapter : undefined,
  });
  const filter = parsed.success ? { courseId: parsed.data.course, chapterId: parsed.data.chapter } : {};
  const items = await getFeedForUser(session.user.id, filter);
  const title = filter.chapterId
    ? (items[0]?.chapterTitle ?? "Chapitre")
    : filter.courseId
      ? (items[0]?.courseTitle ?? "Cours")
      : "Toutes mes capsules";
  const exitHref = filter.courseId ? `/courses/${filter.courseId}` : "/";
  return <VerticalFeed items={items} title={title} exitHref={exitHref} />;
}
