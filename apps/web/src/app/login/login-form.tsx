"use client";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { signIn, signUp } from "@/lib/auth/client";

export function LoginForm({ googleEnabled }: { googleEnabled: boolean }) {
  const router = useRouter();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const form = new FormData(e.currentTarget);
      const email = String(form.get("email"));
      const password = String(form.get("password"));
      const { error } =
        mode === "signin"
          ? await signIn.email({ email, password })
          : await signUp.email({ email, password, name: String(form.get("name") || email) });
      if (error) {
        setError(error.message ?? "Échec de la connexion");
        return;
      }
      router.push("/");
      router.refresh();
    } catch {
      setError("Erreur réseau, réessaie dans un instant.");
    } finally {
      setPending(false);
    }
  }

  async function onGoogleSignIn() {
    setError(null);
    setPending(true);
    try {
      const { error } = await signIn.social({ provider: "google", callbackURL: "/" });
      if (error) {
        setError(error.message ?? "Échec de la connexion Google");
        setPending(false);
      }
    } catch {
      setError("Erreur réseau, réessaie dans un instant.");
      setPending(false);
    }
  }

  const input = "rounded-lg border border-white/20 bg-transparent px-4 py-3";

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        {mode === "signup" && (
          <input
            name="name"
            aria-label="Prénom"
            placeholder="Prénom"
            autoComplete="given-name"
            className={input}
          />
        )}
        <input
          name="email"
          type="email"
          required
          aria-label="E-mail"
          placeholder="E-mail"
          autoComplete="email"
          className={input}
        />
        <input
          name="password"
          type="password"
          required
          minLength={10}
          aria-label="Mot de passe"
          placeholder="Mot de passe (10 caractères min.)"
          autoComplete={mode === "signin" ? "current-password" : "new-password"}
          className={input}
        />
        {error && (
          <p role="alert" className="text-sm text-red-400">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-accent px-4 py-3 font-semibold text-black disabled:opacity-50"
        >
          {mode === "signin" ? "Se connecter" : "Créer un compte"}
        </button>
      </form>

      {googleEnabled && (
        <button
          type="button"
          disabled={pending}
          onClick={onGoogleSignIn}
          className="rounded-lg border border-white/20 px-4 py-3 font-semibold disabled:opacity-50"
        >
          Continuer avec Google
        </button>
      )}

      <button
        type="button"
        onClick={() => {
          setError(null);
          setMode(mode === "signin" ? "signup" : "signin");
        }}
        className="text-sm text-muted underline"
      >
        {mode === "signin" ? "Pas encore de compte ? S'inscrire" : "Déjà inscrit ? Se connecter"}
      </button>
    </div>
  );
}
