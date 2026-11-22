import { tasks } from "@trigger.dev/sdk";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { HttpError, withUser } from "@/lib/api/http";
import { getDb, schema } from "@/lib/db";
import { getEpisodeForUser } from "@/lib/episodes/queries";
import type { generateEpisode } from "@/trigger/generate-episode";

const { episodes } = schema;

/** Régénère une capsule du moteur 2 (script, voix-off, storyboard). */
export async function POST(_request: Request, ctx: RouteContext<"/api/episodes/[id]/regenerate">) {
  return withUser(async (user) => {
    const { id } = await ctx.params;
    if (!z.uuid().safeParse(id).success) throw new HttpError(404, "Capsule introuvable");
    const episode = await getEpisodeForUser(user.id, id);
    if (!episode || !episode.conceptId) throw new HttpError(404, "Capsule introuvable");
    if (episode.engineType !== "generated") throw new HttpError(409, "Seules les capsules générées se régénèrent");

    // Passage atomique en « pending » : deux clics ne lancent qu'une génération.
    const [claimed] = await getDb()
      .update(episodes)
      .set({ status: "pending", error: null })
      .where(and(eq(episodes.id, id), inArray(episodes.status, ["ready", "failed"])))
      .returning({ id: episodes.id });
    if (!claimed) throw new HttpError(409, "Génération déjà en cours");

    try {
      const handle = await tasks.trigger<typeof generateEpisode>(
        "generate-episode",
        { conceptId: episode.conceptId, force: true },
        { tags: [`episode:${id}`, `user:${user.id}`] },
      );
      return Response.json({ episodeId: id, status: "pending", runId: handle.id }, { status: 202 });
    } catch (err) {
      console.error("[regenerate] déclenchement Trigger.dev impossible", err);
      await getDb().update(episodes).set({ status: episode.status }).where(eq(episodes.id, id));
      throw new HttpError(502, "Régénération non lancée (Trigger.dev indisponible)");
    }
  });
}
