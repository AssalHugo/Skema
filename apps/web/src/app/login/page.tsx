import { LoginForm } from "./login-form";

export const metadata = { title: "Connexion · Skema" };

export default function LoginPage() {
  const googleEnabled = Boolean(
    process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET,
  );
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-6 px-6 py-16">
      <h1 className="text-3xl font-bold">Connexion</h1>
      <LoginForm googleEnabled={googleEnabled} />
    </main>
  );
}
