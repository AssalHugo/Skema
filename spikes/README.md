# Phase S — Vérifications techniques préalables, stack « quasi tout Google »

Scripts jetables pour valider, avant de construire, les briques réellement retenues :
Gemini (texte, vision, vidéo agentique), YouTube (Data API + iframe), Google Cloud TTS Neural2 + SSML `<mark>`.
Scribe et Mistral OCR ne sont **pas** testés par défaut : ils ne reviennent que si un critère d'échec objectif est atteint (voir `RESULTS.md`).

L'environnement Python est déjà installé dans `spikes/.venv` (google-genai, google-auth, PyMuPDF, Pillow, requests).

## 1. Préparer le projet Google Cloud (une seule fois)

1. Console Google Cloud → créer (ou choisir) **un** projet, avec la facturation activée sur le compte qui porte tes crédits.
2. *APIs & Services* → activer : **Generative Language API** (Gemini), **Cloud Text-to-Speech API**, **YouTube Data API v3** (utile en phase 4, pas pour la phase S).
3. *Billing → Budgets & alerts* : créer un budget (par exemple 10 €) avec des alertes à 50, 90 et 100 %. **Une alerte ne plafonne pas les dépenses** : c'est le garde-fou applicatif de la phase 5 qui coupera les tâches.
4. Gemini : aistudio.google.com/apikey → créer une clé **dans ce projet** → `GEMINI_API_KEY`.
5. TTS, méthode officielle : *IAM → Service accounts* → créer `tts-spike` avec le rôle **Cloud Text-to-Speech User** (s'il n'apparaît pas, aucun rôle n'est nécessaire au-delà de l'activation de l'API) → *Keys → Add key → JSON*. Enregistrer le fichier **en dehors** du dossier du projet (par exemple `C:\Users\<toi>\gcp\tts-spike.json`) et mettre son chemin dans `GOOGLE_APPLICATION_CREDENTIALS`.
   - Méthode B, à tester : *Credentials → Create API key* restreinte à « Cloud Text-to-Speech API » → `GOOGLE_TTS_API_KEY`. Si elle est refusée (401/403), c'est une information utile pour le plan : on gardera le compte de service.

Copier `.env.example` en `.env` et remplir. **Ne colle jamais les clés dans le chat.**

## 2. Lancer les tests (depuis `spikes/`)

```bash
# S.1 — segment YouTube via vidéo agentique (vidéo de biologie publique d'environ 12 min)
.venv/Scripts/python s1_video_agentic.py --url "https://www.youtube.com/watch?v=XXXX" --concept "La phosphorylation oxydative"
```

```bash
# S.2 — schémas d'un PDF de cours (déposer le PDF dans spikes/inputs/)
.venv/Scripts/python s2_figures.py inputs/cours.pdf
```

```bash
# S.3 — Google TTS Neural2 + <mark> (voix F et G, variantes raw/spoken/sub, test « 1 mark tous les 4 mots »)
.venv/Scripts/python s3_tts_align.py
```

```bash
# S.3 — contrôle automatique de la prononciation (Gemini transcrit les WAV, ~0,01 $)
.venv/Scripts/python s3b_pronunciation_check.py
```

```bash
# S.3 bis — repli 100 % Google si Neural2 est indisponible ou décevant
.venv/Scripts/python s3_tts_align.py --voices fr-FR-Wavenet-F fr-FR-Standard-F
```

Coût total estimé de la phase S : moins de 0,20 $ (Gemini) et 0 € de TTS (palier gratuit).

Résultats dans `out/` :
- `out/s1_*.json` : segment trouvé + lien `check_link` à ouvrir pour vérifier.
- `out/s2_<nom>/review.html` et `metrics.json` : découpes et indicateurs (texte coupé, zones non couvertes).
- `out/s3/player.html` et `report.json` : écoute avec et sans marks, karaoké à 1x et 1,25x, verdict automatique.

## 3. S.4 — test sur iPhone

1. Depuis la racine du projet : `python -m http.server 8765 --bind 0.0.0.0 --directory spikes/s4_ios`
2. iPhone sur le même Wi-Fi → Safari → `http://192.168.1.26:8765` (adresse IP du PC ; autoriser Python dans le pare-feu Windows pour les réseaux **privés**).
3. « Lancer la session », puis swiper carte par carte et lire le journal en bas : `état=1` et `muet=false` attendus sur les cartes YouTube.
4. Refaire le test après « Ajouter à l'écran d'accueil » (PWA), puis sur Android Chrome si possible.

## 4. Consigner

Remplir `RESULTS.md`, y compris la décision finale tout-Google ou repli.
