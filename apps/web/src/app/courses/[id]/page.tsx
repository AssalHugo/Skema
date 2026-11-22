import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { getCourseOverview } from "@/lib/courses";
import { CourseView } from "./course-view";

export const metadata = { title: "Cours · Skema" };

export default function CoursePage({ params }: PageProps<"/courses/[id]">) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-6 py-12">
      <Suspense fallback={<p className="text-muted">Chargement…</p>}>
        <CourseSection params={params} />
      </Suspense>
    </main>
  );
}

async function CourseSection({ params }: { params: PageProps<"/courses/[id]">["params"] }) {
  const { id } = await params;
  const session = await getSession();
  if (!session) redirect("/login");
  if (!z.uuid().safeParse(id).success) notFound();
  const overview = await getCourseOverview(session.user.id, id);
  if (!overview) notFound();
  return <CourseView initial={overview} />;
}
