import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { getEpisodeForUser } from "@/lib/episodes/queries";
import { EpisodePreview } from "./episode-preview";

export const metadata = { title: "Capsule · Skema" };

/**
 * Aperçu de contrôle d'une capsule générée (phase 2) : prononciation, calage
 * des sous-titres à 1x / 1,25x / 1,5x, visuels et métriques. Le lecteur du
 * feed vertical arrive en phase 3.
 */
export default function EpisodePage({ params }: PageProps<"/episodes/[id]">) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-6 py-12">
      <Suspense fallback={<p className="text-muted">Chargement…</p>}>
        <EpisodeSection params={params} />
      </Suspense>
    </main>
  );
}

async function EpisodeSection({ params }: { params: PageProps<"/episodes/[id]">["params"] }) {
  const { id } = await params;
  const session = await getSession();
  if (!session) redirect("/login");
  if (!z.uuid().safeParse(id).success) notFound();
  const episode = await getEpisodeForUser(session.user.id, id);
  if (!episode) notFound();
  return <EpisodePreview episode={episode} />;
}
