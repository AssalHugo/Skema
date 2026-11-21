/**
 * Better Auth sur Neon (tables `user`, `session`, `account`, `verification`).
 * E-mail + mot de passe toujours actif ; Google OAuth si les identifiants
 * `GOOGLE_OAUTH_CLIENT_ID/SECRET` sont renseignés.
 */
import "server-only";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { headers } from "next/headers";
import { getDb, schema } from "@/lib/db";
import { authEnv } from "@/lib/env";

function createAuth() {
  const env = authEnv();
  const google =
    env.GOOGLE_OAUTH_CLIENT_ID && env.GOOGLE_OAUTH_CLIENT_SECRET
      ? { clientId: env.GOOGLE_OAUTH_CLIENT_ID, clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET }
      : undefined;

  return betterAuth({
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    database: drizzleAdapter(getDb(), {
      provider: "pg",
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
      },
    }),
    emailAndPassword: { enabled: true, minPasswordLength: 10 },
    socialProviders: google ? { google } : {},
    // nextCookies doit rester le dernier plugin (cookies posés depuis les Server Actions).
    plugins: [nextCookies()],
  });
}

export type Auth = ReturnType<typeof createAuth>;

let instance: Auth | undefined;

/** Instance créée à la demande : le build ne requiert pas les secrets. */
export function getAuth(): Auth {
  instance ??= createAuth();
  return instance;
}

/** Session courante (Server Components, Route Handlers), ou `null`. */
export async function getSession() {
  // headers() d'abord : marque la route comme dynamique avant toute lecture de secret.
  const requestHeaders = await headers();
  return getAuth().api.getSession({ headers: requestHeaders });
}

/** Utilisateur courant, ou exception `UnauthorizedError`. */
export async function requireUser() {
  const session = await getSession();
  if (!session) throw new UnauthorizedError();
  return session.user;
}

export class UnauthorizedError extends Error {
  constructor() {
    super("Authentification requise");
    this.name = "UnauthorizedError";
  }
}
