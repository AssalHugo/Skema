/** Clés R2 des objets dérivés d'un cours (toutes sous `courses/<courseId>/`). */

export const courseKeys = {
  /** PDF issu de la conversion d'un diaporama. */
  convertedPdf: (courseId: string) => `courses/${courseId}/source.pdf`,
  /** Lot de pages envoyé à Gemini Vision (pages du document complet). */
  batch: (courseId: string, chapterId: string, pageStart: number, pageEnd: number) =>
    `courses/${courseId}/chapters/${chapterId}/batch-p${pageStart}-${pageEnd}.pdf`,
  /** Schéma découpé (identifiant unique : immuable, cache long). */
  diagram: (courseId: string, diagramId: string) => `courses/${courseId}/diagrams/${diagramId}.webp`,
  /** Voix-off d'une capsule générée (une clé par génération : immuable, cache long). */
  episodeAudio: (courseId: string, episodeId: string, version: string) =>
    `courses/${courseId}/episodes/${episodeId}/${version}.mp3`,
};

export const SLIDE_EXTENSIONS = ["pptx", "ppt", "odp"] as const;
export type SlideExtension = (typeof SLIDE_EXTENSIONS)[number];

/** Extension de diaporama d'une clé, ou `null` pour un PDF. */
export function slideExtension(key: string): SlideExtension | null {
  const dot = key.lastIndexOf(".");
  if (dot < 0) return null;
  const ext = key.slice(dot + 1).toLowerCase();
  return (SLIDE_EXTENSIONS as readonly string[]).includes(ext) ? (ext as SlideExtension) : null;
}
