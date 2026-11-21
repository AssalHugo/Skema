# Skema

PWA de micro-learning vertical pour les cours universitaires. Architecture : `Architecture PWA Révision Vidéo IA.md`, plan : `PLAN_IMPLEMENTATION.md`, vérifications préalables : `spikes/`.

## Structure

| Dossier | Rôle |
|---|---|
| `apps/web` | Next.js 16 (App Router, TS strict, Tailwind 4), Drizzle/Neon, Better Auth, R2, Gemini, Trigger.dev |
| `services/gcp-worker` | FastAPI sur Cloud Run (PyMuPDF, Pillow, ffmpeg ; TTS Google via le compte de service attaché) |
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
5. **Trigger.dev** : créer le projet, renseigner `TRIGGER_PROJECT_REF` et `TRIGGER_SECRET_KEY` (tâches en phase 1).

## Phase 0 — critères de fin

- [ ] Migration Neon appliquée (`pnpm db:migrate`)
- [ ] Upload R2 pré-signé fonctionnel (`pnpm --filter web check:r2`)
- [ ] Connexion fonctionnelle (inscription sur `/login`, puis `GET /api/me` → 200)
