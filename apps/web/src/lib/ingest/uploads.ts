/** Règles d'upload des supports de cours (partagées par l'API et l'interface). */

/** Polycopiés de 120+ Mo : le navigateur envoie directement sur R2. */
export const MAX_UPLOAD_BYTES = 300 * 1024 * 1024;

export const UPLOAD_TYPES = {
  pdf: "application/pdf",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ppt: "application/vnd.ms-powerpoint",
  odp: "application/vnd.oasis.opendocument.presentation",
} as const;

export type UploadExtension = keyof typeof UPLOAD_TYPES;

export const ACCEPT_ATTRIBUTE = Object.entries(UPLOAD_TYPES)
  .flatMap(([ext, type]) => [`.${ext}`, type])
  .join(",");

export function uploadExtension(filename: string): UploadExtension | null {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  return ext in UPLOAD_TYPES ? (ext as UploadExtension) : null;
}

/** Titre lisible à partir d'un nom de fichier (« UE 6 Anapath.pdf » → « UE 6 Anapath »). */
export function titleFromFilename(filename: string): string {
  return (
    filename
      .replace(/\.[^.]+$/, "")
      .replace(/[_]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 160) || "Cours sans titre"
  );
}
