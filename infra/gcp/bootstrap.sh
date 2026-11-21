#!/usr/bin/env bash
# Prépare les projets GCP de Skema (prod + dev) sur UN compte de facturation.
# Idempotent : peut être relancé sans dommage.
#
#   BILLING_ACCOUNT=XXXXXX-XXXXXX-XXXXXX PROJECT_ID=skema-prod ./infra/gcp/bootstrap.sh
#
# Prérequis : gcloud authentifié (gcloud auth login) avec les droits
# « Billing Account User » sur le compte de facturation.
set -euo pipefail

: "${BILLING_ACCOUNT:?BILLING_ACCOUNT requis (gcloud billing accounts list)}"
: "${PROJECT_ID:?PROJECT_ID requis (ex. skema-prod)}"
DEV_PROJECT_ID="${DEV_PROJECT_ID:-${PROJECT_ID%-prod}-dev}"
REGION="${REGION:-europe-west1}"
BUDGET_EUR="${BUDGET_EUR:-10}"
SA_NAME="gcp-worker"

APIS=(
  generativelanguage.googleapis.com # Gemini API
  texttospeech.googleapis.com       # Cloud TTS (Neural2 + marks, v1beta1)
  youtube.googleapis.com            # YouTube Data API v3
  run.googleapis.com                # Cloud Run (gcp-worker)
  artifactregistry.googleapis.com   # images du worker
  cloudbuild.googleapis.com         # gcloud run deploy --source
  secretmanager.googleapis.com      # GCP_WORKER_SECRET
  billingbudgets.googleapis.com     # budgets et alertes
)

ensure_project() {
  local id="$1"
  if ! gcloud projects describe "$id" >/dev/null 2>&1; then
    echo "→ création du projet $id"
    gcloud projects create "$id" --name="$id"
  fi
  echo "→ facturation de $id → $BILLING_ACCOUNT"
  gcloud billing projects link "$id" --billing-account="$BILLING_ACCOUNT" >/dev/null
  echo "→ activation des APIs sur $id"
  gcloud services enable "${APIS[@]}" --project="$id"
}

ensure_budget() {
  local id="$1" amount="$2"
  local name="skema-${id}"
  if gcloud billing budgets list --billing-account="$BILLING_ACCOUNT" \
      --format="value(displayName)" | grep -qx "$name"; then
    echo "→ budget $name déjà présent"
    return
  fi
  echo "→ budget $name : ${amount} EUR, alertes 50/90/100 % (n'arrête PAS les dépenses)"
  gcloud billing budgets create \
    --billing-account="$BILLING_ACCOUNT" \
    --display-name="$name" \
    --budget-amount="${amount}EUR" \
    --filter-projects="projects/$id" \
    --threshold-rule=percent=0.5 \
    --threshold-rule=percent=0.9 \
    --threshold-rule=percent=1.0 \
    --threshold-rule=percent=1.0,basis=forecasted-spend
}

ensure_worker_sa() {
  local id="$1"
  local email="${SA_NAME}@${id}.iam.gserviceaccount.com"
  if ! gcloud iam service-accounts describe "$email" --project="$id" >/dev/null 2>&1; then
    echo "→ compte de service $email"
    gcloud iam service-accounts create "$SA_NAME" --project="$id" \
      --display-name="Skema gcp-worker (Cloud Run, TTS)"
  fi
  # Cloud TTS n'a pas de rôle dédié : l'appelant doit seulement pouvoir
  # consommer les APIs activées du projet.
  gcloud projects add-iam-policy-binding "$id" --condition=None --quiet \
    --member="serviceAccount:$email" --role="roles/serviceusage.serviceUsageConsumer" >/dev/null
  gcloud projects add-iam-policy-binding "$id" --condition=None --quiet \
    --member="serviceAccount:$email" --role="roles/logging.logWriter" >/dev/null
}

ensure_worker_secret() {
  local id="$1"
  local email="${SA_NAME}@${id}.iam.gserviceaccount.com"
  if ! gcloud secrets describe gcp-worker-secret --project="$id" >/dev/null 2>&1; then
    echo "→ secret gcp-worker-secret (aléatoire, à recopier dans GCP_WORKER_SECRET côté web)"
    openssl rand -hex 32 | tr -d '\n' | gcloud secrets create gcp-worker-secret \
      --project="$id" --replication-policy=automatic --data-file=-
  fi
  gcloud secrets add-iam-policy-binding gcp-worker-secret --project="$id" --quiet \
    --member="serviceAccount:$email" --role="roles/secretmanager.secretAccessor" >/dev/null
}

for id in "$PROJECT_ID" "$DEV_PROJECT_ID"; do
  ensure_project "$id"
  ensure_worker_sa "$id"
  ensure_worker_secret "$id"
done
ensure_budget "$PROJECT_ID" "$BUDGET_EUR"
ensure_budget "$DEV_PROJECT_ID" "${DEV_BUDGET_EUR:-5}"

cat <<MSG

✔ Projets prêts : $PROJECT_ID (prod) et $DEV_PROJECT_ID (dev), région $REGION.

À faire à la main :
  1. Clé Gemini liée à $PROJECT_ID (paid tier) : https://aistudio.google.com/apikey
  2. Clé YouTube restreinte à « YouTube Data API v3 » : console → APIs & Services → Credentials
  3. Récupérer le secret du worker :
       gcloud secrets versions access latest --secret=gcp-worker-secret --project=$PROJECT_ID
  4. Déployer le worker : PROJECT_ID=$PROJECT_ID ./infra/gcp/deploy-worker.sh
MSG
