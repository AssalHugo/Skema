/** Petits utilitaires communs aux Route Handlers de l'API. */
import "server-only";
import { z } from "zod";
import { requireUser, UnauthorizedError } from "@/lib/auth";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export function jsonError(status: number, error: string): Response {
  return Response.json({ error }, { status });
}

/** Corps JSON validé, ou HttpError 400 avec la liste des champs fautifs. */
export async function parseJson<S extends z.ZodType>(request: Request, schema: S): Promise<z.infer<S>> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new HttpError(400, "Corps JSON attendu");
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((i) => i.path.join(".") || "(corps)").join(", ");
    throw new HttpError(400, `Requête invalide : ${fields}`);
  }
  return parsed.data;
}

type User = Awaited<ReturnType<typeof requireUser>>;

/** Exige une session et convertit les erreurs connues en réponses JSON. */
export async function withUser(handler: (user: User) => Promise<Response>): Promise<Response> {
  try {
    return await handler(await requireUser());
  } catch (err) {
    if (err instanceof UnauthorizedError) return jsonError(401, err.message);
    if (err instanceof HttpError) return jsonError(err.status, err.message);
    console.error("[api]", err);
    return jsonError(500, "Erreur interne");
  }
}
