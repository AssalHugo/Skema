#!/usr/bin/env bash
# Déploie services/gcp-worker sur Cloud Run avec le compte de service attaché
# (ADC pour Google TTS : aucune clé JSON en production).
#
#   PROJECT_ID=skema-prod ./infra/gcp/deploy-worker.sh
set -euo pipefail

: "${PROJECT_ID:?PROJECT_ID requis}"
REGION="${REGION:-europe-west1}"
SERVICE="${SERVICE:-gcp-worker}"
TTS_VOICE="${TTS_VOICE:-fr-FR-Neural2-F}"
# Hôtes autorisés pour les URL pré-signées (lecture/écriture R2), un seul suffixe
# ou plusieurs séparés par « ; » (ex. "r2.cloudflarestorage.com;files.exemple.fr").
ALLOWED_URL_HOSTS="${ALLOWED_URL_HOSTS:-r2.cloudflarestorage.com}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

# Mémoire : /tmp est en RAM sur Cloud Run. Un polycopié de 120 Mo + un lot de
# 40 Mo par requête : 4 requêtes simultanées tiennent dans 2 Gio.
gcloud run deploy "$SERVICE" \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --source="$ROOT/services/gcp-worker" \
  --service-account="gcp-worker@${PROJECT_ID}.iam.gserviceaccount.com" \
  --set-secrets="GCP_WORKER_SECRET=gcp-worker-secret:latest" \
  --set-env-vars="^|^GOOGLE_CLOUD_PROJECT=${PROJECT_ID}|TTS_VOICE=${TTS_VOICE}|ALLOWED_URL_HOSTS=${ALLOWED_URL_HOSTS//;/,}" \
  --port=8080 \
  --cpu=1 --memory=2Gi \
  --concurrency=4 --timeout=600 \
  --min-instances=0 --max-instances=3 \
  --allow-unauthenticated   # protégé par l'en-tête X-Worker-Secret

URL="$(gcloud run services describe "$SERVICE" --project="$PROJECT_ID" --region="$REGION" --format='value(status.url)')"
echo "✔ $SERVICE déployé : $URL  (→ GCP_WORKER_URL)"
curl -fsS "$URL/healthz" && echo
