import { z } from "zod";
import { HttpError, withUser } from "@/lib/api/http";
import { getCourseOverview } from "@/lib/courses";

/** État d'un cours et de ses chapitres (suivi de l'ingestion par l'interface). */
export async function GET(_request: Request, ctx: RouteContext<"/api/courses/[id]">) {
  return withUser(async (user) => {
    const { id } = await ctx.params;
    if (!z.uuid().safeParse(id).success) throw new HttpError(404, "Cours introuvable");
    const overview = await getCourseOverview(user.id, id);
    if (!overview) throw new HttpError(404, "Cours introuvable");
    return Response.json(overview);
  });
}
