# Plan d'implémentation — Skema (révisé le 13/11/2026, stack « quasi tout Google »)

Ce plan reprend l'architecture de `Architecture PWA Révision Vidéo IA.md`, avec les corrections issues de la vérification et le passage à Google partout où c'est pertinent.

---

## 0. Décisions d'architecture

| Sujet | Choix | Pourquoi / garde-fou |
|---|---|---|
| Compte et facturation | **Un seul projet Google Cloud** (facturation + crédits) pour Gemini, TTS, Cloud Run et YouTube | Une seule facture, des crédits mutualisés. Vérifier que les crédits couvrent bien les SKU Gemini API et TTS |
| Rendu | Live Web Rendering (storyboard JSON + audio + WebP) | 0 € de calcul, ~1,5 Mo par épisode |
| LLM « qualité » (scénarisation, concepts, segments YouTube) | **`gemini-4-hydrogen`**, `thinking_level: "medium"` | Même prix que 3.8 Flash à partir du 01/01/2027 et plus fiable. Fixer `thinking_level` explicitement (par défaut `high`) |
| LLM « volume » jusqu'au 31/12/2026 | `gemini-3.8-flash` (promo −50 %) | Bascule sur Hydrogen au 01/01/2027 par variable d'environnement |
| LLM « tri » | `gemini-3.5-flash-lite` | 5× moins cher en entrée |
| Extraction PDF | **Gemini Vision + PyMuPDF sur Cloud Run** (`PDF_EXTRACTOR=gemini`) | Mistral OCR 4.1 = **repli uniquement** si les seuils de S.2 échouent |
| TTS | **Google Cloud TTS `fr-FR-Neural2-F` / `-G`**, API **v1beta1**, SSML avec `<mark>` et `enableTimePointing: ["SSML_MARK"]` | Palier gratuit d'1 M caractères/mois, puis 16 $/1 M. Timestamps natifs, sans Scribe |
| Replis TTS (dans l'ordre) | (1) `fr-FR-Wavenet-*` / `Standard-*` + marks, (2) Neural2 sans marks + ElevenLabs Scribe | Déclenchés uniquement par les seuils de S.3 |
| Prononciation scientifique | **Validé en S.3 (11/11)** : le LLM annote `[ATP|a té pé]`, converti en SSML `<sub alias>`, avec une mark par mot **affiché** | `mapSpokenTimingsToDisplayWords()` supprimée. Règles : ponctuation hors de l'alias, élision « l' » dans l'alias |
| Auth TTS | **Compte de service attaché au service Cloud Run** (ADC, aucune clé JSON en production) | La doc officielle ne prévoit que l'ADC ou un compte de service. **Tous les appels TTS passent par le worker Cloud Run** |
| Vidéo | YouTube Data API v3 + iframe YouTube | — |
| Base de données | Neon (pas Cloud SQL) | Cloud SQL n'a pas d'offre gratuite |
| Stockage | Cloudflare R2 (pas GCS) | Egress gratuit (GCS facture la sortie internet) |
| Auth utilisateurs | Better Auth sur Neon (pas Firebase Auth) | Tout reste dans Postgres, sans dépendance supplémentaire |
| Orchestration | Trigger.dev | Pipelines durables. Cloud Tasks/Workflows serait plus complexe à coder |
| Hébergement web | Vercel Hobby, **prototype personnel uniquement** | Hobby = usage non commercial → Pro ou Cloud Run avant toute ouverture publique |

Tous les identifiants de modèles et de voix sont des variables d'environnement : `GEMINI_MODEL_QUALITY`, `GEMINI_MODEL_BULK`, `GEMINI_MODEL_LITE`, `TTS_VOICE`, `TTS_MARK_EVERY`.

### Angles morts du « tout-Google » et garde-fous

| Risque | Garde-fou |
|---|---|
| **Point de défaillance unique côté facturation** : carte refusée, crédits épuisés ou compte suspendu, et Gemini + TTS + Cloud Run s'arrêtent ensemble | Budget et alertes GCP (qui **ne plafonnent pas** les dépenses), garde-fou applicatif `MONTHLY_BUDGET_EUR`, et les capsules déjà générées restent lisibles puisqu'elles sont servies depuis R2/Neon, hors Google |
| **Trois briques en preview / beta** : URL YouTube dans Gemini, `media_processing: "AGENTIC"`, TTS `v1beta1` (timepoints absents de la v1) | Adaptateurs isolés (`lib/ai`, `lib/tts`), repli `STATIC` pour la vidéo, repli WaveNet ou Scribe pour le TTS, tests de non-régression sur une capsule de référence |
| **Avenir de Neural2 incertain** : un relevé de console d'août 2026 ne trouvait pas de SKU Neural2, alors que la page officielle des tarifs le liste encore | `TTS_VOICE` configurable. S.3 teste aussi WaveNet et Standard (4 M caractères gratuits pour Standard) |
| **Limite de 5 000 octets par requête TTS** : une capsule de 190 mots avec une mark par mot fait ~4,5 à 5 Ko | Découpe automatique en fin de phrase, concaténation PCM, décalage des timepoints (déjà implémenté dans `spikes/s3_tts_align.py`) |
| **Coût des marks** : avec `<sub>` et une mark par mot, ~×2,2 en octets SSML (mesuré). Si elles sont facturées, un semestre passe de ~375 k à ~0,8 M caractères, encore sous le palier gratuit d'1 M | L'interpolation « 1 mark tous les 4 mots » a **échoué** en S.3 (erreur de 100 à 250 ms) : une mark par mot est obligatoire. Vérifier dans *Billing → Reports* |
| **Quotas par projet** : Gemini (rate limits par palier), TTS Neural2 (1 000 requêtes/min), YouTube (`search.list` 100/jour) | Batch Gemini pour les ingestions, `concurrencyLimit` Trigger.dev par file, cache YouTube. Un projet séparé « dev » sur le même compte de facturation évite que les tests ne consomment les quotas de prod |
| **Confidentialité** : sur le palier **gratuit** de Gemini, les contenus peuvent servir à améliorer les produits Google | Utiliser uniquement une clé liée au projet avec facturation (paid tier) pour les PDF de cours |
| **Latence** : l'analyse vidéo agentique et les longs PDF prennent plusieurs minutes | Toujours en tâche asynchrone Trigger.dev, jamais dans une route Vercel |

---

## Phase S — Vérifications techniques préalables (½ à 1 jour, scripts dans `spikes/`)

Ne sont testées **que** les briques de la stack retenue. Chaque test a des seuils d'échec objectifs (dans `spikes/RESULTS.md`) qui, seuls, peuvent réintroduire Scribe ou Mistral.

1. **S.1 Gemini + YouTube agentique** (`s1_video_agentic.py`) : `media_processing="AGENTIC"` sur Hydrogen et 3.8 Flash. Mesure des tokens pour ~12 min (budget : 46 800), de la justesse de `startSec`/`endSec` et de la latence.
2. **S.2 Gemini Vision + PyMuPDF** (`s2_figures.py`), sans Mistral : métriques automatiques `cut_text_ratio` (légende coupée), `missed_visual_ratio` (zone vectorielle ou image non couverte), `invalid_box_ratio`, coût pour 1 000 pages, plus une planche visuelle.
3. **S.3 Google TTS Neural2 + `<mark>`** (`s3_tts_align.py`) : voix F et G, variantes `raw` / `spoken` / `sub`. Mesures :
   - couverture des marks et monotonie ;
   - Δ de durée avec ou sans marks (impact sur la prosodie) ;
   - mots de moins de 50 ms ;
   - précision de l'interpolation « 1 mark tous les 4 mots » ;
   - octets facturables ;
   - authentification par clé API ou par compte de service.

   Écoute à 1x et 1,25x. Comparaison avec Scribe **uniquement si** `ELEVENLABS_API_KEY` est renseignée.
4. **S.4 iOS** (`s4_ios/index.html`) : `<audio>` partagé et iframe YouTube `playsinline=1` après un swipe, avec bouton de repli « Activer le son ».

**Sortie** : `spikes/RESULTS.md` qui répond à « Le tout-Google (Gemini Vision + YouTube + Google Neural2 + SSML `<mark>`) est-il suffisant en qualité et fiabilité, ou faut-il réintroduire Scribe / Mistral ? »

---

## Phase 0 — Socle

1. Monorepo pnpm : `apps/web` (Next.js App Router, TS strict, Tailwind) et `services/gcp-worker` (Python, Cloud Run).
2. Dépendances web : `drizzle-orm`, `@neondatabase/serverless`, `drizzle-kit`, `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`, `zod`, `framer-motion`, `@trigger.dev/sdk`, `@serwist/next`, `@google/genai`, `better-auth`.
3. `apps/web/src/lib/db/schema.ts` : les 6 tables d'origine, avec :
   - `concepts.diagram_ids UUID[]` ;
   - `episodes.youtube_video_id` **sans** clé étrangère vers le cache, pour que la purge à 30 jours soit possible ;
   - `episodes.status`, `episodes.model_used`, `episodes.tts_voice`, `episodes.cost_usd` ;
   - tables Better Auth, avec `courses.user_id` qui y fait référence ;
   - table `ai_usage` (date, tâche, modèle, tokens / caractères, coût).
4. `lib/storage/r2.ts` : `getPresignedUploadUrl()`, `uploadBufferToR2()`, `getPublicAssetUrl()` (domaine personnalisé).
5. `lib/ai/gemini.ts` : `generateStructured<T>(zodSchema, …)`, `thinking_level` explicite, journalisation de `usageMetadata` dans `ai_usage`, **en additionnant `toolUsePromptTokenCount`** (tokens vidéo du mode agentique, constaté en S.1).
6. GCP : un projet (et un projet « dev » sur la même facturation), APIs activées (Generative Language, Cloud Text-to-Speech, YouTube Data v3, Cloud Run), budget et alertes, compte de service `gcp-worker` (rôle TTS) attaché au service Cloud Run.
7. `.env.example` : `DATABASE_URL`, `R2_*`, `GEMINI_API_KEY`, `GEMINI_MODEL_QUALITY/BULK/LITE`, `YOUTUBE_API_KEY`, `GOOGLE_CLOUD_PROJECT`, `GCP_WORKER_URL`, `GCP_WORKER_SECRET`, `TTS_VOICE=fr-FR-Neural2-F`, `TTS_MARK_EVERY=1`, `TTS_FALLBACK=none|wavenet|scribe`, `PDF_EXTRACTOR=gemini`, `TRIGGER_SECRET_KEY`, `BETTER_AUTH_SECRET`, `MONTHLY_BUDGET_EUR`. Variables facultatives des replis : `MISTRAL_API_KEY`, `ELEVENLABS_API_KEY`.

**Terminé quand** : migration Neon appliquée, upload R2 pré-signé fonctionnel, connexion fonctionnelle.

---

## Phase 1 — Worker Cloud Run et ingestion

1. `services/gcp-worker/main.py` (FastAPI + PyMuPDF + Pillow + ffmpeg dans l'image, en-tête `X-Worker-Secret`, port 8080, compte de service attaché) :
   - `POST /split-and-inspect` : découpe au-delà de 50 Mo ou 1 000 pages ;
   - `POST /crop-bboxes` : rendu 200 DPI, marge de 4 %, WebP de moins de 100 Ko, avec les métriques `cut_text` de S.2 renvoyées pour signaler une légende coupée ;
   - `POST /pptx-to-pdf` (LibreOffice headless) ;
   - `POST /tts` : voir phase 2 (l'auth Google TTS reste dans Cloud Run).
2. Routes `POST /api/courses/upload-url` et `POST /api/courses/ingest`.
3. `trigger/ingest-course.ts` : PDF → Gemini Vision (boîtes 0..1000) → `/crop-bboxes` → WebP sur R2 → `course_diagrams`. Branche `PDF_EXTRACTOR=mistral` gardée comme repli.
4. Découpage en 8 à 25 concepts (modèle QUALITY, sortie Zod) avec `diagram_ids`, puis `batchTrigger` des moteurs 2 et 1.

**Terminé quand** : PDF de 20 à 40 diapositives → WebP nets, `cut_text_ratio` sous le seuil de S.2.

---

## Phase 2 — Moteur 2 : capsules générées

1. Contrat `GeneratedStoryboard` complété : `displaySegments`, `spokenText` (ou `ssmlWithSub` si S.3 valide `<sub>`), `quiz`.
2. `trigger/generate-episode.ts` : script de 150 à 210 mots, accroche en moins de 5 s, 4 à 7 scènes, quiz à 4 choix (modèle QUALITY).
3. `lib/tts/adapter.ts` : `TTSProvider → { audioBuffer, mimeType, durationMs, wordTimings }`.
   - **`GoogleNeural2Provider`** (par défaut) : appelle `gcp-worker /tts`, qui fait les étapes suivantes :
     1. construit le SSML avec `<mark name="i"/>` tous les `TTS_MARK_EVERY` mots ;
     2. découpe en requêtes de 4 500 octets maximum, en fin de phrase ;
     3. appelle `v1beta1/text:synthesize` en `LINEAR16` avec `enableTimePointing: ["SSML_MARK"]` ;
     4. concatène le PCM, décale les timepoints et interpole les mots sans mark ;
     5. encode en MP3 (ffmpeg, 64 à 96 kbps mono).
   - `GoogleWavenetProvider` : même code, autre voix (repli 1).
   - `ScribeAlignedProvider` (repli 2, désactivé par défaut) et `ElevenLabsV4TurboProvider` (premium, désactivé).
4. `toSsml(annotatedText)` : convertit `[affiché|prononcé]` en `<sub alias>` selon les règles de S.3 (ponctuation hors de l'alias, élision dans l'alias), avec une mark par mot affiché. Tests unitaires sur les cas de `spikes/s3_tts_align.py` (ATP, 5', 7,8, 37 °C, 10⁻⁶ mol/L). Le prompt de scénarisation impose cette annotation pour chaque sigle, nombre, unité et exposant.
5. MP3 sur R2, épisode passé en `ready`, caractères TTS journalisés dans `ai_usage`.

**Terminé quand** : prononciation correcte, sous-titres calés à 1x et 1,25x, seuils de S.3 respectés sur 5 capsules réelles.

---

## Phase 3 — Lecteur PWA

1. Manifest (`Skema`, `standalone`, `portrait`), Serwist, `VerticalFeed.tsx` (`h-[100dvh]` scroll-snap, virtualisation sur 3 cartes).
2. Écran « Lancer la session » qui déverrouille l'audio sur iOS.
3. `LiveCapsulePlayer.tsx` (boucle rAF sur `currentTime`, caméra focusX/focusY, zoom du schéma, vitesse 1 / 1,25 / 1,5).
4. `DynamicCaptions.tsx` (karaoké sur `wordTimings`).
5. `QuizOverlay.tsx` → `POST /api/progress`.

**Terminé quand** : lecture de bout en bout sur iPhone et sur Android d'un cours importé en phase 1.

---

## Phase 4 — Moteur 1 : curation YouTube

1. `lib/youtube/channels.json` (~20 chaînes FR/EN avec `uploadsPlaylistId`).
2. `curator.ts` : `playlistItems.list` + `videos.list` par lots de 50 → cache avec `expires_at` à +30 jours, et tâche planifiée de purge ou de rafraîchissement.
3. `search.list` en dernier recours. Quota de 100/jour à confirmer dans la console GCP.
4. `trigger/curate-youtube.ts` : modèle QUALITY + `media_processing: "AGENTIC"`, sortie `{ found, startSec, endSec, summaryTitle, relevanceScore, quiz }`. Contraintes validées en S.1 :
   - client Gemini en **`apiVersion: "v1beta"`** ;
   - `fileData.mimeType: "video/*"` obligatoire ;
   - `found=false` respecté quand le concept est absent ;
   - ~15 s et 0,04 à 0,07 $ par vidéo d'environ 15 min ;
   - tester `thinking_level: "low"`, car la réflexion représente l'essentiel des tokens de sortie.
5. `YouTubeSegmentPlayer.tsx` (`playsinline:1`, `rel:0`, `start`/`end`, IntersectionObserver à 0,75, `onError` → carte masquée), avec la stratégie de son retenue en S.4.
6. Mélange dans le feed (ratio 2:1 configurable).

**Terminé quand** : 2 à 3 `search.list` au maximum pour 10 concepts, pas de superposition audio ni de plein écran forcé.

---

## Phase 5 — Budget, robustesse, finitions

1. Garde-fou budgétaire : avant chaque tâche IA ou TTS, comparer la somme de `ai_usage` du mois à `MONTHLY_BUDGET_EUR` et suspendre les tâches en cas de dépassement. Doublé par les alertes de budget GCP.
2. Gemini Batch pour les ingestions non urgentes (−50 %).
3. Suivi du palier gratuit TTS (caractères/mois, par famille de voix) et alerte à 80 %.
4. Répétition espacée : `next_review_at` (SM-2 simplifié).
5. Au 01/01/2027 : `GEMINI_MODEL_BULK=gemini-4-hydrogen`.

**Terminé quand** : aucune ressource fixe payante, coûts journalisés, alertes testées.

---

## Corrections apportées au document d'origine

1. **Vidéo agentique** : la syntaxe correcte est `media_processing: "AGENTIC"` sur la partie vidéo.
2. **Vercel Hobby** : usage personnel et non commercial uniquement.
3. **Profil « Zéro coût fixe »** : avec Gemini pour l'extraction et Google TTS + marks, le cash hors crédits Gemini tombe à ~0 €, contre 1,81 € / 9,03 € annoncés avec Mistral + Scribe.
4. **Google TTS** (page officielle) : Standard et WaveNet à 4 M caractères gratuits/mois, Neural2 et Chirp 3 HD à 1 M. Neural2 coûte 16 $/1 M, Chirp 3 HD 30 $/1 M. La réutilisation de l'audio généré est autorisée dans le respect des conditions GCP : la mise en garde du document sur le cache semble non fondée pour les voix standard (la notion d'usage « REALTIME » concerne les voix personnalisées).
5. **Schéma SQL** : la clé étrangère vers le cache YouTube empêche la purge, et le lien concept → schémas manquait.
6. **Contrat TypeScript** : `displaySegments`, `spokenText` et `quiz` manquaient.
7. **Auth** : aucune phase n'était prévue.
8. **Seuil de découpe PDF** : incohérence entre 200 et 1 000 pages.
9. **Source [11]** : lien cassé, mais calculs vérifiés.
10. **iOS** : le déverrouillage du `<audio>` ne couvre pas l'iframe YouTube.
11. **Google TTS** : l'authentification par clé API n'est pas documentée (doc officielle : ADC ou compte de service), d'où l'appel TTS déplacé dans Cloud Run.
