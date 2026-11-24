import { DemoFeed } from "./demo-feed";
import { demoFeed } from "./demo-data";
import { demoGeneratedDiagrams } from "./demo-diagrams";

export const metadata = { title: "Démo du lecteur · Skema" };

/**
 * Démo du feed vertical sans compte ni base : faux schéma, schéma généré (phase 3.5), quatre capsules,
 * voix-off muette (horodatage simulé). Sert aussi à tester le son sur iPhone (S.4).
 */
export default async function DemoPage() {
  return <DemoFeed items={demoFeed(await demoGeneratedDiagrams())} />;
}
