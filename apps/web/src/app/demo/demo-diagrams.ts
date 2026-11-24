import "server-only";
import { layoutDiagram } from "@/lib/diagrams/layout";
import type { PreparedDiagram } from "@/lib/episodes/storyboard";
import { DEMO_GENERATED_SPECS } from "./demo-data";

/** Mise en page (elkjs) des schémas générés de la démo, au rendu serveur. */
export async function demoGeneratedDiagrams(): Promise<Map<string, PreparedDiagram>> {
  const entries = await Promise.all(
    DEMO_GENERATED_SPECS.map(async ({ ref, spec }) => [ref, { spec, layout: await layoutDiagram(spec) }] as const),
  );
  return new Map(entries);
}
