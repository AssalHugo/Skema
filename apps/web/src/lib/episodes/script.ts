/**
 * Scénarisation d'une capsule générée (moteur 2, modèle QUALITY) :
 * 150 à 210 mots, accroche en moins de 5 s, 4 à 7 scènes reliées aux schémas,
 * quiz à 4 choix. La narration est annotée `[affiché|prononcé]` pour chaque
 * sigle, nombre, unité et exposant (converti en SSML `<sub alias>`, cf. S.3).
 */
import { z } from "zod";
import {
  DIAGRAM_LABEL_MAX,
  DIAGRAM_NODES,
  DiagramSpecInput,
  MAX_GENERATED_DIAGRAMS,
  diagramSpecIssues,
  normalizeRef,
} from "@/lib/diagrams/spec";
import { countWords } from "@/lib/tts/ssml";

export const SCRIPT_WORDS = { min: 150, max: 210 } as const;
/** Au-delà de cette tolérance, la sortie est refusée et Gemini relancé. */
export const SCRIPT_WORDS_HARD = { min: 135, max: 230 } as const;
export const SCENES = { min: 4, max: 7 } as const;

const Scene = z.object({
  narration: z
    .string()
    .describe(
      "Texte dit pendant la scène, annoté [affiché|prononcé] pour chaque sigle, nombre, unité, symbole ou exposant",
    ),
  visualType: z.enum(["diagram", "generated_diagram", "kinetic_text", "comparison_card"]),
  diagramRef: z.string().nullable().describe("Référence S1, S2… si visualType = diagram, sinon null"),
  generatedDiagramRef: z
    .string()
    .nullish()
    .describe("Référence G1, G2… d'un schéma de generatedDiagrams si visualType = generated_diagram, sinon null"),
  focusNodeId: z
    .string()
    .nullish()
    .describe("id du nœud du schéma généré commenté pendant la scène (cadrage), ou null pour la vue d'ensemble"),
  camera: z
    .object({
      fromScale: z.number().describe("Zoom de départ, 1 à 1,3"),
      toScale: z.number().describe("Zoom d'arrivée, 1 à 2,5"),
      focusX: z.number().describe("Centre de la zone commentée, % de la largeur du schéma (0 = bord gauche)"),
      focusY: z.number().describe("Centre de la zone commentée, % de la hauteur du schéma (0 = haut)"),
    })
    .nullable()
    .describe("Mouvement de caméra sur le schéma (visualType = diagram), sinon null"),
  calloutLabel: z.string().nullable().describe("Étiquette courte à l'écran (40 caractères max), ou null"),
  highlightText: z
    .string()
    .nullable()
    .describe("Mot-clé ou formule affiché en grand (kinetic_text), écriture exacte sans crochets, ou null"),
  comparison: z
    .object({
      leftTitle: z.string(),
      leftItems: z.array(z.string()).max(4),
      rightTitle: z.string(),
      rightItems: z.array(z.string()).max(4),
    })
    .nullable()
    .describe("Deux colonnes à comparer (visualType = comparison_card), sinon null"),
});

export const EpisodeScript = z
  .object({
    title: z.string().describe("Titre de la capsule (70 caractères max)"),
    hookTitle: z.string().describe("Accroche affichée à l'écran pendant la première scène (60 caractères max)"),
    generatedDiagrams: z
      .array(DiagramSpecInput)
      .max(MAX_GENERATED_DIAGRAMS)
      .optional()
      .describe("Schémas à générer, UNIQUEMENT pour des scènes qu'aucun schéma du cours (S1, S2…) n'illustre ; [] sinon"),
    scenes: z.array(Scene).min(SCENES.min).max(SCENES.max),
    quiz: z.object({
      question: z.string(),
      choices: z.array(z.string()).length(4).describe("4 choix : 1 correct, 3 distracteurs plausibles"),
      correctIndex: z.number().int().describe("Index (0 à 3) du choix correct"),
      explanation: z.string().describe("Pourquoi c'est la bonne réponse, 1 à 2 phrases"),
    }),
  })
  .superRefine((s, ctx) => {
    const words = scriptWordCount(s.scenes);
    if (words < SCRIPT_WORDS_HARD.min || words > SCRIPT_WORDS_HARD.max) {
      ctx.addIssue({
        code: "custom",
        path: ["scenes"],
        message: `${words} mots au total, ${SCRIPT_WORDS.min} à ${SCRIPT_WORDS.max} attendus`,
      });
    }
    if (s.scenes.some((sc) => countWords(sc.narration) === 0)) {
      ctx.addIssue({ code: "custom", path: ["scenes"], message: "scène sans narration" });
    }
    if (s.quiz.correctIndex < 0 || s.quiz.correctIndex > 3) {
      ctx.addIssue({ code: "custom", path: ["quiz", "correctIndex"], message: "index hors de 0..3" });
    }
    // Schémas générés : cohérence interne et références des scènes.
    const declared = new Map<string, DiagramSpecInput>();
    (s.generatedDiagrams ?? []).forEach((d, i) => {
      const ref = normalizeRef(d.ref);
      if (declared.has(ref)) ctx.addIssue({ code: "custom", path: ["generatedDiagrams", i, "ref"], message: `ref en double : ${ref}` });
      declared.set(ref, d);
      for (const message of diagramSpecIssues(d)) ctx.addIssue({ code: "custom", path: ["generatedDiagrams", i], message });
    });
    s.scenes.forEach((sc, i) => {
      if (sc.visualType !== "generated_diagram") return;
      const d = sc.generatedDiagramRef ? declared.get(normalizeRef(sc.generatedDiagramRef)) : undefined;
      if (!d) {
        ctx.addIssue({ code: "custom", path: ["scenes", i, "generatedDiagramRef"], message: "schéma généré non déclaré" });
      } else if (sc.focusNodeId && !d.nodes.some((n) => n.id === sc.focusNodeId)) {
        ctx.addIssue({ code: "custom", path: ["scenes", i, "focusNodeId"], message: `nœud inconnu : ${sc.focusNodeId}` });
      }
    });
  });
export type EpisodeScript = z.infer<typeof EpisodeScript>;

export function scriptWordCount(scenes: { narration: string }[]): number {
  return scenes.reduce((n, s) => n + countWords(s.narration), 0);
}

/** Script complet (scènes jointes par une espace : les mots restent alignés scène par scène). */
export function annotatedScript(scenes: { narration: string }[]): string {
  return scenes.map((s) => s.narration.trim()).join(" ");
}

export interface PromptDiagram {
  ref: string;
  pageNumber: number;
  caption: string | null;
  aiDescription: string;
  /** L'image est jointe (sinon, description seule). */
  attached: boolean;
}

export interface ScriptPromptInput {
  discipline: string;
  chapterTitle: string;
  conceptTitle: string;
  summary: string | null;
  keywords: string[];
  sourcePages: number[];
  sourceText: { page: number; text: string }[];
  diagrams: PromptDiagram[];
}

export const SCRIPT_SYSTEM = `Tu es scénariste de capsules vidéo verticales (format TikTok, 60 à 90 secondes) qui aident des étudiants à réviser leurs cours universitaires. Tu écris en français, pour l'oral, avec exactitude scientifique. Tu ne t'appuies que sur le cours fourni : aucune notion, valeur ou exemple qui n'y figure pas.`;

export function scriptPrompt(p: ScriptPromptInput): string {
  const diagrams = p.diagrams.length
    ? p.diagrams
        .map(
          (d) =>
            `- ${d.ref} (p. ${d.pageNumber}${d.attached ? ", image jointe" : ""})${d.caption ? ` « ${d.caption} »` : ""} : ${d.aiDescription}`,
        )
        .join("\n")
    : "(aucun schéma du cours : utiliser generated_diagram, kinetic_text et comparison_card)";
  const source = p.sourceText.length
    ? p.sourceText.map((s) => `[page ${s.page}]\n${s.text}`).join("\n\n")
    : "(texte du cours indisponible : s'en tenir strictement au résumé ci-dessus)";

  return `Cours (${p.discipline}) — chapitre « ${p.chapterTitle} »
Concept : « ${p.conceptTitle} »
Résumé : ${p.summary ?? "(aucun)"}
Mots-clés : ${p.keywords.join(", ") || "(aucun)"}
Pages du cours : ${p.sourcePages.join(", ") || "(inconnues)"}

Texte du cours (extraits des pages ci-dessus) :
"""
${source}
"""

Schémas disponibles (images jointes, chacune précédée de sa référence) :
${diagrams}

Écris le script d'UNE capsule sur ce concept.

Narration :
- ${SCRIPT_WORDS.min} à ${SCRIPT_WORDS.max} mots AU TOTAL (environ 65 à 85 secondes), répartis en ${SCENES.min} à ${SCENES.max} scènes ;
- scène 1 = accroche : sa PREMIÈRE PHRASE fait 12 mots au plus (dite en moins de 5 secondes) et pose une question ou un fait marquant ;
- phrases courtes, style oral, tutoiement ; une idée par scène ; terminer par la phrase-clé à retenir ;
- texte brut uniquement : pas de SSML, de markdown, d'émoji ni de parenthèses explicatives.

Annotation de prononciation OBLIGATOIRE dans la narration — syntaxe [affiché|prononcé] :
- pour CHAQUE sigle, nombre, unité, symbole, exposant, indice, formule chimique, chiffre romain ou abréviation ;
- « affiché » = écriture scientifique exacte (sous-titres) ; « prononcé » = tout en toutes lettres, comme le dirait un enseignant ;
- sigles épelés : [ADN|a dé ène], [ATP|a té pé] ; sigles dits comme un mot : [SIDA|sida] ; mélanges : [NADPH|ène a dé pé ache] ;
- nombres et unités : [7,4|sept virgule quatre], [37 °C|trente-sept degrés Celsius], [10⁻⁶ mol/L|dix puissance moins six mole par litre], [Ca²⁺|calcium deux plus], [5'|cinq prime], [III|trois] ;
- la ponctuation reste HORS des crochets : « vers [3'|trois prime]. » ;
- l'élision reste collée DEVANT les crochets, sans la répéter dans « prononcé » : « l'[ATP|a té pé] », « d'[ADN|a dé ène] » ;
- les mots courants ne sont pas annotés.

Visuels de chaque scène :
- diagram : diagramRef = une référence de la liste ; camera pointe la zone du schéma commentée à ce moment (focusX/focusY en % depuis le coin haut gauche, fromScale 1 à 1,3, toScale 1 à 2,5) ; calloutLabel nomme l'élément montré ;
- kinetic_text : highlightText = le mot-clé, la valeur ou la formule à retenir (40 caractères max) ;
- generated_diagram : schéma 2D construit à partir de la STRUCTURE que tu décris dans generatedDiagrams (voir ci-dessous) ; generatedDiagramRef = sa référence (G1, G2) ; focusNodeId = l'id du nœud commenté à ce moment, ou null pour la vue d'ensemble ;
- kinetic_text : highlightText = le mot-clé, la valeur ou la formule à retenir (40 caractères max) ;
- comparison_card : comparison avec 2 colonnes de 2 à 4 éléments courts (ex. procaryote / eucaryote) ;
- priorité : un schéma du cours (diagram) s'il illustre la scène, sinon un schéma généré si le concept a une structure (voie, cycle, étapes), sinon kinetic_text ou comparison_card ;
- utiliser au moins un schéma du cours s'il y en a ; mettre null dans les champs qui ne concernent pas le visuel choisi.

Schémas générés (generatedDiagrams, ${MAX_GENERATED_DIAGRAMS} au plus, [] si inutile) — tu décris une structure, le dessin est automatique :
- à réserver aux concepts qui ont une structure claire ET qu'aucun schéma du cours n'illustre ;
- template : pathway (flux orienté : glycolyse, cascade de signalisation, transcription → traduction), cycle (boucle fermée : cycle de Krebs, cycle cellulaire ; nœuds dans l'ordre du cycle, liens du nœud i vers le suivant), stages (étapes successives : phases de la mitose, développement) ;
- ${DIAGRAM_NODES.min} à ${DIAGRAM_NODES.max} nœuds ; id court sans espace ; label = terme EXACT du cours, ${DIAGRAM_LABEL_MAX} caractères au plus, écriture affichée sans crochets (ex. « ATP », « Ca²⁺ ») ;
- liens (from → to) uniquement entre id déclarés, dans le sens décrit par le cours ; label du lien facultatif (enzyme, réactif), très court ;
- uniquement des éléments et des relations présents dans le texte du cours : chaque nœud et chaque lien sera vérifié, un seul élément non attesté fait abandonner le schéma ;
- la narration des scènes qui montrent le schéma doit PRONONCER chaque libellé tel quel, dans l'ordre où il doit apparaître à l'écran ;
- plusieurs scènes consécutives peuvent montrer le même schéma avec un focusNodeId différent (la caméra glisse d'un nœud à l'autre).

Quiz final (texte simple, sans crochets) : une question sur le point essentiel, 4 choix dont 1 seul correct, distracteurs plausibles et de même longueur, explication en 1 à 2 phrases.`;
}
