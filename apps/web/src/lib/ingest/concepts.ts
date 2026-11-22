/**
 * Découpage d'un chapitre en 8 à 20 concepts atomiques (modèle QUALITY),
 * reliés aux schémas extraits du chapitre.
 */
import "server-only";
import { z } from "zod";
import { filePart, generateStructured, type GeminiFileRef } from "@/lib/ai/gemini";

export const MAX_CONCEPTS = 20;

const ConceptsOutput = z.object({
  concepts: z
    .array(
      z.object({
        title: z.string().describe("Titre court et explicite du concept (80 caractères max)"),
        summary: z
          .string()
          .describe("Objectif et points clés à retenir, 2 à 4 phrases fidèles au cours"),
        keywords: z
          .array(z.string())
          .describe("3 à 6 mots-clés précis (français), utiles pour chercher une vidéo"),
        sourcePages: z
          .array(z.number().int())
          .describe("Pages du polycopié complet (numérotation absolue indiquée) où le concept est traité"),
        diagramRefs: z
          .array(z.string())
          .describe("Références (S1, S2…) des schémas qui illustrent ce concept, [] si aucun"),
      }),
    )
    .min(1),
});

export interface ChapterFile {
  file: GeminiFileRef;
  pageStart: number;
  pageEnd: number;
}

export interface DiagramForPrompt {
  id: string;
  pageNumber: number;
  caption: string | null;
  aiDescription: string;
}

export interface ExtractedConcept {
  title: string;
  summary: string;
  keywords: string[];
  sourcePages: number[];
  diagramIds: string[];
}

export function targetConceptCount(pages: number): string {
  if (pages < 8) return `entre ${Math.max(1, Math.ceil(pages / 2))} et ${Math.max(2, pages)}`;
  return "entre 8 et 20 (environ un concept pour 2 à 3 pages, selon la densité)";
}

export function conceptsPrompt(params: {
  chapterTitle: string;
  pageStart: number;
  pageEnd: number;
  files: { pageStart: number; pageEnd: number }[];
  diagrams: { ref: string; pageNumber: number; caption: string | null; aiDescription: string }[];
  discipline: string;
}): string {
  const files = params.files
    .map((f, i) => `- Fichier ${i + 1} : pages ${f.pageStart} à ${f.pageEnd} (sa page 1 = page ${f.pageStart})`)
    .join("\n");
  const diagrams = params.diagrams.length
    ? params.diagrams
        .map((d) => `- ${d.ref} (p. ${d.pageNumber})${d.caption ? ` « ${d.caption} »` : ""} : ${d.aiDescription}`)
        .join("\n")
    : "(aucun schéma extrait)";
  return `Tu prépares des capsules vidéo verticales de 60 à 90 secondes pour réviser un cours universitaire (${params.discipline}).

Chapitre : « ${params.chapterTitle} », pages ${params.pageStart} à ${params.pageEnd} du polycopié.
Les fichiers joints contiennent ce chapitre :
${files}

Découpe ce chapitre en concepts atomiques, ${targetConceptCount(params.pageEnd - params.pageStart + 1)}.
Règles :
- un concept = une idée que l'on peut expliquer seule en 60 à 90 secondes (mécanisme, définition, structure, expérience, régulation…) ;
- dans l'ordre du cours, sans doublon ni chevauchement, sans concept « introduction » ou « conclusion » vide ;
- ignorer les pages administratives (sommaire, bibliographie, consignes d'examen, publicité du tutorat) ;
- sourcePages en numérotation ABSOLUE du polycopié (entre ${params.pageStart} et ${params.pageEnd}) ;
- diagramRefs : uniquement des références de la liste ci-dessous, quand le schéma aide vraiment à expliquer le concept.

Schémas extraits du chapitre :
${diagrams}`;
}

/**
 * Concepts validés et nettoyés : pages bornées au chapitre, références de
 * schémas inconnues ignorées, 20 concepts au plus.
 */
export async function extractConcepts(params: {
  courseId: string;
  chapterId: string;
  chapterTitle: string;
  pageStart: number;
  pageEnd: number;
  discipline: string;
  files: ChapterFile[];
  diagrams: DiagramForPrompt[];
}): Promise<{ concepts: ExtractedConcept[]; model: string; costUsd: number }> {
  const refs = new Map(params.diagrams.map((d, i) => [`S${i + 1}`, d]));
  const prompt = conceptsPrompt({
    ...params,
    files: params.files.map(({ pageStart, pageEnd }) => ({ pageStart, pageEnd })),
    diagrams: [...refs].map(([ref, d]) => ({ ref, ...d })),
  });
  const res = await generateStructured(ConceptsOutput, {
    task: "ingest.concepts",
    tier: "quality",
    contents: [...params.files.map((f) => filePart(f.file)), prompt],
    courseId: params.courseId,
    chapterId: params.chapterId,
    metadata: { pages: params.pageEnd - params.pageStart + 1, diagrams: params.diagrams.length },
  });

  const concepts = res.data.concepts
    .map((c) => ({
      title: c.title.trim().slice(0, 160),
      summary: c.summary.trim(),
      keywords: [...new Set(c.keywords.map((k) => k.trim()).filter(Boolean))].slice(0, 8),
      sourcePages: [...new Set(c.sourcePages)]
        .filter((p) => p >= params.pageStart && p <= params.pageEnd)
        .sort((a, b) => a - b),
      diagramIds: [
        ...new Set(c.diagramRefs.map((r) => refs.get(r.trim().toUpperCase())?.id).filter((id) => id !== undefined)),
      ],
    }))
    .filter((c) => c.title.length > 0);
  if (concepts.length > MAX_CONCEPTS) {
    console.warn(`[ingest.concepts] ${concepts.length} concepts proposés, ${MAX_CONCEPTS} conservés`);
  }
  return { concepts: concepts.slice(0, MAX_CONCEPTS), model: res.model, costUsd: res.costUsd };
}
