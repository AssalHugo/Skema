/**
 * Appel minimal à generateStructured() pour valider la clé, le modèle et la
 * journalisation dans ai_usage (~0,001 $).
 *
 * pnpm --filter web check:gemini [quality|bulk|lite]
 */
import { config } from "dotenv";
import { z } from "zod";

config({ path: [".env.local", ".env"] });

async function main() {
  const { generateStructured } = await import("../src/lib/ai/gemini");
  const tier = (process.argv[2] ?? "lite") as "quality" | "bulk" | "lite";
  const Answer = z.object({
    sigle: z.string(),
    prononciation: z.string().describe("Prononciation française, ex. « a té pé »"),
  });
  const res = await generateStructured(Answer, {
    task: "check.gemini",
    tier,
    contents: "Donne la prononciation française du sigle ATP.",
  });
  console.log(res.model, res.data, `${res.costUsd.toFixed(6)} $`, res.tokens);
}

main().catch((err) => {
  console.error("✘", err);
  process.exit(1);
});
