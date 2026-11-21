import { connection } from "next/server";
import { Suspense } from "react";
import { LoginForm } from "./login-form";

export const metadata = { title: "Connexion · Skema" };

export default function LoginPage() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-6 px-6 py-16">
      <h1 className="text-3xl font-bold">Connexion</h1>
      <Suspense fallback={<p className="text-muted">Chargement…</p>}>
        <LoginFormSection />
      </Suspense>
    </main>
  );
}

async function LoginFormSection() {
  await connection();
  const googleEnabled = Boolean(
    process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET,
  );
  return <LoginForm googleEnabled={googleEnabled} />;
}
