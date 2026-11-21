import { getSession } from "@/lib/auth";

/** Vérification rapide de la connexion : renvoie l'utilisateur courant. */
export async function GET() {
  const session = await getSession();
  if (!session) return Response.json({ user: null }, { status: 401 });
  const { id, email, name } = session.user;
  return Response.json({ user: { id, email, name } });
}
