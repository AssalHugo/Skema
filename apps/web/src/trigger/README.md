Tâches Trigger.dev :

| Fichier | Tâche(s) | Rôle |
|---|---|---|
| `ingest-course.ts` | `ingest-course` | À l'upload : diaporama → PDF, chapitres et lots de pages (gcp-worker), table `chapters` |
| `ingest-chapter.ts` | `ingest-chapter`, `extract-batch-figures` | À la demande : lots sur R2, schémas (Gemini Vision + `/crop-bboxes`), concepts, fan-out des moteurs |
| `generate-episode.ts` | `generate-episode` | Moteur 2 (phase 2) — point d'entrée seulement pour l'instant |
| `curate-youtube.ts` | `curate-youtube` | Moteur 1 (phase 4) — point d'entrée seulement pour l'instant |

Files : `gemini-vision` (4 lots en parallèle), `ingest-chapter` (2), `ingest-course` (5).
Les erreurs définitives du worker (PDF corrompu ou protégé : HTTP 4xx) arrêtent la tâche sans nouvel essai.

Lancement local : `pnpm dlx trigger.dev@4.8.8 dev` depuis `apps/web` (lit `.env.local`).
