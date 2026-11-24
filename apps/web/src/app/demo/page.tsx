import { DemoFeed } from "./demo-feed";
import { demoFeed } from "./demo-data";

export const metadata = { title: "Démo du lecteur · Skema" };

/**
 * Démo du feed vertical sans compte ni base : faux schéma, trois capsules,
 * voix-off muette (horodatage simulé). Sert aussi à tester le son sur iPhone (S.4).
 */
export default function DemoPage() {
  return <DemoFeed items={demoFeed()} />;
}
