# Skema

PWA de micro-learning vertical pour les cours universitaires. Architecture : `Architecture PWA Révision Vidéo IA.md`, plan : `PLAN_IMPLEMENTATION.md`, vérifications préalables : `spikes/`.

## Structure

| Dossier | Rôle |
|---|---|
| `apps/web` | Next.js 16 (App Router, TS strict, Tailwind 4), Drizzle/Neon, Better Auth, R2, Gemini, Trigger.dev |
| `services/gcp-worker` | FastAPI sur Cloud Run (PyMuPDF, Pillow, LibreOffice, ffmpeg) : `/split-and-inspect`, `/crop-bboxes`, `/pptx-to-pdf`, `/page-text`, `/tts` (Google TTS v1beta1 via le compte de service attaché). Aucun identifiant R2 : lecture/écriture par URL pré-signées, limitées aux hôtes `ALLOWED_URL_HOSTS` (défaut `r2.cloudflarestorage.com`) |
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
5. **Trigger.dev** : créer le projet, renseigner `TRIGGER_PROJECT_REF` et `TRIGGER_SECRET_KEY`. Dans les variables d'environnement du projet Trigger.dev, recopier `DATABASE_URL`, `R2_*`, `GEMINI_*`, `GCP_WORKER_URL`, `GCP_WORKER_SECRET`, `PDF_EXTRACTOR` et `TTS_*` (les tâches tournent chez Trigger.dev, pas sur Vercel).

## Phase 3.5 — schémas 2D générés

```
generate-episode (script Gemini QUALITY)
    ├─ generatedDiagrams : G1, G2 (≤ 2) = STRUCTURE seulement (template pathway | cycle | stages, 2–12 nœuds, liens)
    │  scènes generated_diagram → generatedDiagramRef + focusNodeId   (priorité : schéma du cours > généré > texte)
    ├─ prepareGeneratedDiagrams()
    │    ├─ fidélité (modèle LITE, un appel, ai_usage « episode.diagram-fidelity ») : chaque nœud et lien attesté par le cours
    │    │  └─ un seul élément non attesté → schéma abandonné, ses scènes passent en kinetic_text
    │    └─ mise en page elkjs côté serveur (layered pour pathway/stages, cercle fixe pour cycle) → DiagramLayout
    └─ buildStoryboard() : storyboard 1.2 si un schéma est montré (1.1 sinon)
         ├─ reveal : chaque nœud apparaît quand son libellé est prononcé (wordTimings), repli uniforme et monotone
         └─ focusNodeId → cameraMotion (focusX/focusY du nœud) : mêmes cameraPlans / cameraFrameAt que les WebP
lecteur : GeneratedDiagram({ diagram, frame, tMs }) → <svg>, caméra = viewBox (cameraViewBox), fondu de 250 ms
```

- **Contrat** : `GeneratedStoryboard` 1.2 (`generatedDiagrams`, scènes `generated_diagram` avec `generatedDiagramId` / `focusNodeId`), rétrocompatible : les capsules 1.1 en base restent lisibles, sans migration.
- **Modules** : `src/lib/diagrams/` — `spec.ts` (Zod et bornes), `text.ts` (découpe des libellés, partagée serveur/client), `layout.ts` (elkjs, `server-only`, hors bundle PWA), `reveal.ts`, `fidelity.ts`, `prepare.ts` ; composant pur `src/components/player/GeneratedDiagram.tsx`.
- **Démo** : `/demo`, 4ᵉ capsule « Le cycle de Krebs » (gabarit `cycle`, mise en page au rendu serveur).
- **Contrôle** : `/episodes/<id>` affiche les schémas générés et le verdict de fidélité (`episodes.metrics.generatedDiagrams`).
- Exclus : génération d'images, SVG écrit par le LLM, Remotion en lecture.

### Phase 3.5 — critères de fin

- [ ] Sur un chapitre réel, ≥ 80 % des schémas générés passent la vérification de fidélité (`/episodes/<id>`, ligne « schémas générés »)
- [ ] Aucun chevauchement de libellés à 390 px de large (testé automatiquement sur les trois gabarits ; à confirmer à l'œil sur des cas réels)
- [ ] Apparitions calées sur la voix-off à 1x et 1,25x

## Phase 3 — lecteur PWA

```
/feed[?course=<id>][&chapter=<id>]  (capsules prêtes : non terminées d'abord, puis ordre du cours, 60 max)
  VerticalFeed     100dvh + scroll-snap, 3 cartes montées (active ± 1), un seul <audio> pour la session
  ├─ « Lancer la session » : 1re lecture dans le geste utilisateur → audio déverrouillé (iOS)
  ├─ LiveCapsulePlayer : rAF sur audio.currentTime → scène, caméra (zoom + recentrage focusX/focusY), accroche
  │    vitesse 1 / 1,25 / 1,5 (mémorisée), tap = pause, « Activer le son » si la lecture est refusée
  ├─ DynamicCaptions : ligne displaySegments, mot courant surligné (wordTimings)
  └─ QuizOverlay (fin de capsule) ──▶ POST /api/progress { episodeId, watchedPct (max conservé), quizCorrect }
```

- **Démo sans compte ni base** : `/demo` (faux schéma, 3 capsules passées dans le vrai `buildStoryboard()`, voix-off muette à horodatage simulé). Sert aussi au test iPhone de S.4.
- **PWA** : `app/manifest.ts` (`standalone`, `portrait`, icônes `public/icons/`), Serwist en mode *configurator* (compatible Turbopack) : `pnpm build` = `next build && serwist build` → `public/sw.js` (non versionné). Service worker désactivé en `next dev`.
- **Caméra fluide** : un seul travelling continu entre scènes consécutives sur le même schéma (sans fondu ni retour au plan large), durée proportionnelle à la distance, puis dérive lente ; cadrage borné au contenu réel du schéma (jamais les bandes blanches). L'image est chargée ×2 puis réduite (nette au zoom, sans re-rastérisation), et la caméra comme la barre de progression sont peintes à chaque image hors React ; React ne re-rend qu'au changement de mot. `SmoothClock` lisse `currentTime`, qui n'avance que par paliers sur Safari iOS et Firefox.
- **Calculs purs** : `src/lib/player/timeline.ts` (caméra, horloge lissée, karaoké, virtualisation), testés dans `player.test.ts`.
- Pas de migration : `user_progress` existe depuis la phase 0 ; `next_review_at` (SM-2) reste pour la phase 5.

### Phase 3 — critères de fin

- [ ] `/demo` sur iPhone (Safari puis PWA installée) : son après « Lancer la session » et après chaque swipe → reporter dans `spikes/RESULTS.md` (S.4)
- [ ] Lecture de bout en bout sur Android d'un cours importé en phase 1 (`/courses/<id>` → « Réviser ce chapitre »)
- [ ] Idem sur iPhone

## Phase 2 — capsules générées (moteur 2)

```
ingest-chapter ──batchTrigger──▶ generate-episode (un concept, file generate-episode, 5 en parallèle)
    ├─ contexte : résumé du concept, texte natif de ses pages (/page-text sur les lots), ≤ 6 schémas (WebP joints)
    ├─ script Gemini QUALITY (Zod) : 150–210 mots annotés [affiché|prononcé], accroche ≤ 12 mots,
    │  4 à 7 scènes (diagram + caméra focusX/focusY, kinetic_text, comparison_card), quiz à 4 choix
    ├─ toSsmlUnits() : un mot affiché = un fragment SSML (<sub alias> selon les règles de S.3)
    ├─ gcp-worker /tts : <mark> par mot, requêtes ≤ 4 500 octets coupées en fin de phrase,
    │  v1beta1 LINEAR16 + SSML_MARK, PCM concaténé et timepoints décalés, MP3 mono 64 kbps (ffmpeg)
    │  └─ seuils de S.3 recalculés (marks ≥ 98 %, monotonie, ≤ 2 mots < 50 ms) → repli TTS_FALLBACK si échec
    ├─ MP3 → R2 courses/<id>/episodes/<ep>/<version>.mp3, caractères TTS → ai_usage (palier gratuit déduit)
    └─ storyboard_json v1.1 (scènes calées sur les mots, displaySegments, wordTimings, quiz mélangé) → episodes ready
```

- **Contrat** : `apps/web/src/lib/storyboard/types.ts` (`GeneratedStoryboard` v1.1, importable côté client pour la phase 3).
- **Prononciation** : `apps/web/src/lib/tts/ssml.ts` (`toSsmlUnits`, `toSsml`, `findUnannotatedTerms`), tests sur les cas de S.3 (ATP, 5', 7,8, 37 °C, 10⁻⁶ mol/L). Les termes non annotés (sigles, nombres, unités) sont signalés dans `episodes.metrics`.
- **TTS** : `apps/web/src/lib/tts/adapter.ts` — `GoogleNeural2Provider` (défaut), `GoogleWavenetProvider` (`TTS_FALLBACK=wavenet`) ; `ScribeAlignedProvider` et `ElevenLabsV4TurboProvider` restent désactivés (S.3 validé). L'authentification Google ne quitte pas Cloud Run.
- **Relance** : une seule capsule générée par concept (index unique partiel) ; `POST /api/episodes/<id>/regenerate` la régénère.
- **Contrôle** : `/courses/<id>` liste les capsules ; `/episodes/<id>` les lit (sous-titres karaoké, 1x / 1,25x / 1,5x, visuels, quiz) et affiche les contrôles : mots, accroche < 5 s, seuils de S.3, termes non annotés, coût.
- Migration : `pnpm db:migrate` applique `0003_episodes_generation.sql` (`episodes.metrics`, `episodes.error`, index unique `episodes_generated_concept_uq`).

### Phase 2 — critères de fin

- [ ] Worker redéployé avec `/tts` et `/page-text` (`PROJECT_ID=skema-prod ./infra/gcp/deploy-worker.sh`), variables `TTS_*` recopiées dans Trigger.dev
- [ ] 5 capsules réelles générées : seuils de S.3 ✅ dans `/episodes/<id>`
- [ ] Prononciation correcte à l'écoute, sous-titres calés à 1x et 1,25x
- [ ] Facturation des marks vérifiée dans *Billing → Reports* (`ai_usage.metadata.charsWithoutMarks` donne l'écart)

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
