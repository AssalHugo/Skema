import Link from "next/link";
import { Suspense } from "react";
import { getSession } from "@/lib/auth";
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
  return (
    <div className="flex flex-col gap-3">
      <p>
        Connecté en tant que <strong>{session.user.email}</strong>
      </p>
      <SignOutButton />
    </div>
  );
}
