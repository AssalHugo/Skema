# Skema

PWA de micro-learning vertical pour les cours universitaires. Architecture : `Architecture PWA Révision Vidéo IA.md`, plan : `PLAN_IMPLEMENTATION.md`, vérifications préalables : `spikes/`.

## Structure

| Dossier | Rôle |
|---|---|
| `apps/web` | Next.js 16 (App Router, TS strict, Tailwind 4), Drizzle/Neon, Better Auth, R2, Gemini, Trigger.dev |
| `services/gcp-worker` | FastAPI sur Cloud Run (PyMuPDF, Pillow, LibreOffice, ffmpeg) : `/split-and-inspect`, `/crop-bboxes`, `/pptx-to-pdf` ; TTS Google (phase 2) via le compte de service attaché. Aucun identifiant R2 : lecture/écriture par URL pré-signées, limitées aux hôtes `ALLOWED_URL_HOSTS` (défaut `r2.cloudflarestorage.com`) |
| `infra/gcp` | Scripts `gcloud` : projets prod + dev, APIs, budgets, compte de service, déploiement du worker |
| `spikes` | Phase S (validée) |

## Démarrage local

```bash
pnpm install
```

```bash
cp apps/web/.env.example apps/web/.env.local   # puis remplir
```

```bash
pnpm db:migrate        # applique apps/web/drizzle/*.sql sur Neon
```

```bash
pnpm dev               # http://localhost:3000 → /login
```

Commandes utiles (depuis la racine) :

| Commande | Effet |
|---|---|
| `pnpm typecheck` / `pnpm lint` / `pnpm build` | Vérifications de l'app web |
| `pnpm db:generate --name <nom>` | Nouvelle migration après modification de `schema.ts` |
| `pnpm --filter web check:r2` | Upload pré-signé + upload serveur + lecture publique sur R2 |
| `pnpm --filter web check:gemini [quality\|bulk\|lite]` | Appel `generateStructured()` et ligne `ai_usage` (~0,001 $) |
| `pnpm --filter web test` | Tests unitaires TypeScript (`node:test` via tsx) |
| `pnpm dlx trigger.dev@4.8.8 dev` (depuis `apps/web`) | Exécute les tâches Trigger.dev en local |

Worker :

```bash
cd services/gcp-worker && python -m venv .venv && .venv/bin/pip install -r requirements-dev.txt && .venv/bin/pytest
```

## Mise en place des services (une fois)

1. **GCP** : `BILLING_ACCOUNT=… PROJECT_ID=skema-prod ./infra/gcp/bootstrap.sh` crée `skema-prod` et `skema-dev` sur la même facturation, active Generative Language, Cloud TTS, YouTube Data v3, Cloud Run (+ Artifact Registry, Cloud Build, Secret Manager), crée les budgets avec alertes (qui **ne plafonnent pas** les dépenses), le compte de service `gcp-worker` et le secret `gcp-worker-secret`. Puis `PROJECT_ID=skema-prod ./infra/gcp/deploy-worker.sh`.
2. **Neon** : créer le projet (région `eu-central-1`), copier la chaîne *pooled* dans `DATABASE_URL`, puis `pnpm db:migrate`.
3. **Cloudflare R2** : bucket `skema`, domaine personnalisé → `R2_PUBLIC_BASE_URL`, jeton API « Object Read & Write » limité au bucket → `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY`. Règle CORS du bucket (uploads pré-signés depuis le navigateur) :
   ```json
   [{ "AllowedOrigins": ["http://localhost:3000", "https://<domaine-app>"],
      "AllowedMethods": ["PUT", "GET"], "AllowedHeaders": ["content-type"], "MaxAgeSeconds": 3600 }]
   ```
   Conseillé : règle de cycle de vie qui supprime `_checks/` après 1 jour.
4. **Better Auth** : `BETTER_AUTH_SECRET=$(openssl rand -base64 32)`. Google OAuth facultatif (redirect URI `<BETTER_AUTH_URL>/api/auth/callback/google`).
5. **Trigger.dev** : créer le projet, renseigner `TRIGGER_PROJECT_REF` et `TRIGGER_SECRET_KEY`. Dans les variables d'environnement du projet Trigger.dev, recopier `DATABASE_URL`, `R2_*`, `GEMINI_*`, `GCP_WORKER_URL`, `GCP_WORKER_SECRET` et `PDF_EXTRACTOR` (les tâches tournent chez Trigger.dev, pas sur Vercel).

## Phase 1 — ingestion

```
navigateur ──PUT pré-signé──▶ R2 uploads/<user>/…            (120+ Mo, sans passer par Vercel)
POST /api/courses/ingest ──▶ ingest-course
    ├─ /pptx-to-pdf (diaporamas)                            → courses/<id>/source.pdf
    └─ /split-and-inspect : chapitres + lots de 25–30 p.   → table chapters (status pending)
POST /api/chapters/<id>/generate ──▶ ingest-chapter          (à la demande, un chapitre)
    ├─ /split-and-inspect (uploads) : PDF de chaque lot     → courses/<id>/chapters/<ch>/batch-p…pdf
    ├─ extract-batch-figures × lots (file gemini-vision, 4 en parallèle)
    │     Gemini Vision (boîtes 0..1000) → /crop-bboxes → WebP sur R2 → course_diagrams
    ├─ 8 à 20 concepts (modèle QUALITY, Zod) avec diagram_ids → concepts
    └─ batchTrigger generate-episode + curate-youtube        (points d'entrée des phases 2 et 4)
```

- **Chapitres** : signets du PDF (en descendant d'un niveau si un chapitre dépasse 60 pages), sinon titres « Chapitre 2 », « Partie III »… en grande police, sinon tranches de ~25 pages. Les chapitres de moins de 3 pages sont fusionnés avec leur voisin ; les plus longs sans sous-signets sont coupés en parties de ≤ 30 pages.
- **Lots** : tout chapitre de plus de 30 pages est découpé en lots de ≤ 30 pages (< 40 Mo, mesurés à l'upload). Un document entier de ≤ 30 pages sert directement de lot.
- **Qualité** : `chapters.metrics` reprend les indicateurs de S.2 (`cutTextRatio`, `invalidBoxRatio`, seuils 0,10 / 0,05) ; un dépassement est signalé dans les logs Trigger.dev et dans l'interface.
- **Repli** : `PDF_EXTRACTOR=mistral` (+ `MISTRAL_API_KEY`) remplace la détection Gemini par Mistral OCR (non testé en phase S : à valider avant usage).
- **Interface minimale** : `/upload` (import), `/courses/<id>` (chapitres, bouton « Générer les capsules », suivi de l'état).
- Migration : `pnpm db:migrate` applique `0002_ingestion.sql` (colonnes `courses.pdf_r2_key`, `structure_source`, `error`, `chapters.batches`, `metrics`, `error`, `concepts.summary`).

### Phase 1 — critères de fin

- [ ] Worker redéployé avec LibreOffice (`PROJECT_ID=skema-prod ./infra/gcp/deploy-worker.sh`)
- [ ] Un polycopié de 300+ pages est découpé en chapitres à l'upload (`/upload`, puis `/courses/<id>`)
- [ ] La génération d'un chapitre de 20 à 35 pages produit des WebP nets (`cut_text_ratio` < 0,10) et ses concepts en base

## Phase 0 — critères de fin

- [ ] Migration Neon appliquée (`pnpm db:migrate`)
- [ ] Upload R2 pré-signé fonctionnel (`pnpm --filter web check:r2`)
- [ ] Connexion fonctionnelle (inscription sur `/login`, puis `GET /api/me` → 200)
