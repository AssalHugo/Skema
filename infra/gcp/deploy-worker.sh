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
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

gcloud run deploy "$SERVICE" \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --source="$ROOT/services/gcp-worker" \
  --service-account="gcp-worker@${PROJECT_ID}.iam.gserviceaccount.com" \
  --set-secrets="GCP_WORKER_SECRET=gcp-worker-secret:latest" \
  --set-env-vars="GOOGLE_CLOUD_PROJECT=${PROJECT_ID},TTS_VOICE=${TTS_VOICE}" \
  --port=8080 \
  --cpu=1 --memory=2Gi \
  --concurrency=4 --timeout=600 \
  --min-instances=0 --max-instances=3 \
  --allow-unauthenticated   # protégé par l'en-tête X-Worker-Secret

URL="$(gcloud run services describe "$SERVICE" --project="$PROJECT_ID" --region="$REGION" --format='value(status.url)')"
echo "✔ $SERVICE déployé : $URL  (→ GCP_WORKER_URL)"
curl -fsS "$URL/healthz" && echo
