/**
 * Vérifie la chaîne d'upload R2 de bout en bout :
 *   1. URL pré-signée → PUT depuis un « client » (fetch, comme le navigateur)
 *   2. upload serveur (uploadBufferToR2)
 *   3. lecture via le domaine public (getPublicAssetUrl)
 *
 * pnpm --filter web check:r2
 */
import { config } from "dotenv";

config({ path: [".env.local", ".env"] });

async function main() {
  const { getPresignedUploadUrl, uploadBufferToR2, getPublicAssetUrl } = await import(
    "../src/lib/storage/r2"
  );
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const body = new TextEncoder().encode(`skema check-r2 ${stamp}\n`);

  const presigned = await getPresignedUploadUrl({
    key: `_checks/presigned-${stamp}.txt`,
    contentType: "text/plain",
    contentLength: body.byteLength,
  });
  const put = await fetch(presigned.url, { method: "PUT", headers: presigned.headers, body });
  if (!put.ok) throw new Error(`PUT pré-signé refusé : ${put.status} ${await put.text()}`);
  console.log("✔ PUT pré-signé", presigned.key);

  const server = await uploadBufferToR2({
    key: `_checks/server-${stamp}.txt`,
    body,
    contentType: "text/plain",
    cacheControl: "no-store",
  });
  console.log("✔ upload serveur", server.key);

  for (const key of [presigned.key, server.key]) {
    const url = getPublicAssetUrl(key);
    const res = await fetch(url);
    const text = await res.text();
    if (!res.ok || text !== new TextDecoder().decode(body)) {
      throw new Error(`Lecture publique incorrecte (${res.status}) : ${url}`);
    }
    console.log("✔ lecture publique", url);
  }
  console.log("\nR2 OK. Les objets de test sont sous _checks/ (règle de cycle de vie conseillée).");
}

main().catch((err) => {
  console.error("✘", err instanceof Error ? err.message : err);
  process.exit(1);
});
