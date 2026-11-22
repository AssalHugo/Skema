"use client";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { ACCEPT_ATTRIBUTE, MAX_UPLOAD_BYTES, titleFromFilename, uploadExtension } from "@/lib/ingest/uploads";

type Phase = "idle" | "uploading" | "registering";

/** PUT direct vers R2 avec suivi de progression (fetch ne l'expose pas). */
function putWithProgress(url: string, headers: Record<string, string>, file: File, onProgress: (pct: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(`Envoi refusé par le stockage (${xhr.status})`));
    xhr.onerror = () => reject(new Error("Envoi interrompu (réseau ou CORS du bucket R2)"));
    xhr.send(file);
  });
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `Erreur ${res.status}`);
  return data;
}

export function UploadForm() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [fileError, setFileError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  function onFile(f: File | null) {
    setFileError(null);
    setSubmitError(null);
    setFile(f);
    if (f && !title) setTitle(titleFromFilename(f.name));
    if (f && !uploadExtension(f.name)) setFileError("Formats acceptés : PDF, PPTX, PPT, ODP");
    else if (f && f.size === 0) setFileError("Le fichier est vide");
    else if (f && f.size > MAX_UPLOAD_BYTES) setFileError("Fichier trop volumineux (300 Mo maximum)");
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!file || fileError) return;
    setSubmitError(null);
    try {
      setPhase("uploading");
      const upload = await postJson<{ url: string; key: string; headers: Record<string, string> }>(
        "/api/courses/upload-url",
        { filename: file.name, size: file.size },
      );
      await putWithProgress(upload.url, upload.headers, file, setProgress);
      setPhase("registering");
      const { courseId } = await postJson<{ courseId: string }>("/api/courses/ingest", {
        key: upload.key,
        title: title.trim() || undefined,
      });
      router.push(`/courses/${courseId}`);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Erreur inattendue");
      setPhase("idle");
    }
  }

  const error = fileError ?? submitError;
  const busy = phase !== "idle";
  const input = "rounded-lg border border-white/20 bg-transparent px-4 py-3";
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <input
        type="file"
        accept={ACCEPT_ATTRIBUTE}
        aria-label="Support de cours"
        disabled={busy}
        onChange={(e) => onFile(e.target.files?.[0] ?? null)}
        className={input}
      />
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Titre du cours"
        aria-label="Titre du cours"
        maxLength={160}
        disabled={busy}
        className={input}
      />
      {file && (
        <p className="text-sm text-muted">
          {file.name} — {(file.size / 1e6).toFixed(1)} Mo
        </p>
      )}
      {phase === "uploading" && (
        <div className="h-2 overflow-hidden rounded-full bg-white/10" role="progressbar" aria-valuenow={progress}>
          <div className="h-full bg-accent transition-all" style={{ width: `${progress}%` }} />
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={!file || busy || Boolean(fileError)}
        className="rounded-lg bg-accent px-4 py-3 font-semibold text-black disabled:opacity-50"
      >
        {phase === "uploading" ? `Envoi… ${progress} %` : phase === "registering" ? "Analyse…" : "Importer"}
      </button>
    </form>
  );
}
