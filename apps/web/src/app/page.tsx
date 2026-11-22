import Link from "next/link";
import { Suspense } from "react";
import { getSession } from "@/lib/auth";
import { listCourses } from "@/lib/courses";
import { SignOutButton } from "./sign-out-button";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-6 px-6 py-16">
      <h1 className="text-4xl font-bold tracking-tight">Skema</h1>
      <p className="text-muted">Tes cours, en capsules verticales de 60 secondes.</p>
      <Suspense fallback={<p className="text-muted">Chargement…</p>}>
        <UserStatus />
      </Suspense>
    </main>
  );
}

const COURSE_STATUS: Record<string, string> = { processing: "analyse…", ready: "", failed: "échec" };

async function UserStatus() {
  const session = await getSession();
  if (!session) {
    return (
      <Link
        href="/login"
        className="rounded-lg bg-accent px-4 py-3 text-center font-semibold text-black"
      >
        Se connecter
      </Link>
    );
  }
  const courses = await listCourses(session.user.id);
  return (
    <div className="flex flex-col gap-3">
      <p>
        Connecté en tant que <strong>{session.user.email}</strong>
      </p>
      <Link href="/upload" className="rounded-lg bg-accent px-4 py-3 text-center font-semibold text-black">
        Importer un cours
      </Link>
      {courses.length > 0 && (
        <ul className="flex flex-col gap-2">
          {courses.map((c) => (
            <li key={c.id}>
              <Link href={`/courses/${c.id}`} className="flex justify-between rounded-lg border border-white/10 px-4 py-3">
                <span className="truncate">{c.title}</span>
                <span className="shrink-0 text-sm text-muted">
                  {COURSE_STATUS[c.status] || `${c.pageCount} p.`}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <SignOutButton />
    </div>
  );
}
