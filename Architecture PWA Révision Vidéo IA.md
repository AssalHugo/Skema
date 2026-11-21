# **Architecture technique et plan d'implémentation de Skema (PWA de micro-learning vertical pour les cours universitaires)**

Pour concevoir **Skema**, un « TikTok des cours » en biologie et sciences de la vie à coût d'infrastructure quasi nul en novembre 2026, le choix architectural déterminant consiste à écarter le rendu vidéo serveur au profit d'un **Live Web Rendering** piloté par un storyboard JSON, synchronisé à la milliseconde sur une piste audio MP3 et des schémas WebP recadrés. Par rapport à des fichiers MP4 1080p d'une minute pesant autour de 60 Mo à 8 Mbps selon les estimations de Wireflow sur Remotion1, la diffusion directe d'un flux audio à 128 kbps2 (environ 1,2 Mo pour 75 secondes) accompagné d'un JSON léger et d'images compressées divise la bande passante par environ trente à quarante, supprime tout serveur d'encodage, permet le zoom interactif sur les schémas cellulaires et maintient l'hébergement dans les offres gratuites de Vercel, Neon, Cloudflare R2, Trigger.dev et Google Cloud Run3.  
Votre enveloppe Gemini existante (30 € de crédit initial et 10 €/mois) couvre largement le cœur cognitif des deux moteurs grâce à gemini-3.8-flash : l'analyse d'un semestre universitaire complet (2 000 diapositives PDF, 250 micro-épisodes scénarisés et 150 vidéos YouTube inspectées en mode agentique) revient à environ **8,88 \$ (\~8,17 € au taux indicatif de 1 USD \= 0,92 EUR)** en mode standard et **4,44 \$ (\~4,08 €)** via l'API Batch jusqu'au 31 décembre 20268. Deux échéances tarifaires de début 2027 doivent toutefois guider vos choix dès maintenant : les tarifs promotionnels de gemini-3.8-flash doublent au 1er janvier 2027 (passant de 0,75 \$/3,75 \$ à 1,50 \$/7,50 \$ par million de tokens)8, tandis que gpt-4o-mini-tts d'OpenAI s'arrête le 6 janvier 2027 et doit être écarté15.  
Pour l'extraction des schémas et la voix-off scientifique française, l'architecture s'articule en deux profils selon votre tolérance au coût marginal. Le profil **« Zéro coût fixe »** associe PyMuPDF (sur Cloud Run), gemini-3.8-flash et une synthèse vocale gratuite Azure AI Speech (500 000 caractères/mois gratuits en F0) ou Google Cloud Neural2 (1 million de caractères/mois gratuits) complétée d'un alignement forcé léger11. Le profil **« Précision scientifique premium »** associe **Mistral OCR 4.1** (extraction native des figures en Base64 et coordonnées exactes à 2–4 \$/1 000 pages19) et **ElevenLabs eleven\_v4\_turbo** (seule gamme ElevenLabs supportant les dictionnaires phonétiques IPA en français21) dès l'abonnement API Starter à 6 \$/mois22.

## **Comparatif technique et choix recommandés**

### **Extraction PDF et diaporamas : texte structuré et découpage des schémas**

Les supports universitaires de biologie posent deux contraintes particulières. D'une part, les schémas issus de PowerPoint ou Keynote exportés en PDF sont souvent constitués de formes vectorielles et de légendes superposées plutôt que d'une unique image matricielle intégrée : extraire naïvement les objets images internes échoue à capturer les flèches et annotations, ce qui impose une détection par boîte englobante (*bounding box*) sur rendu de page. D'autre part, les fichiers **PPTX** bruts soumis directement à Gemini sont convertis en texte seul (ce qui supprime le contexte visuel des schémas), alors que les PDF et anciens fichiers PPT sont bien rendus comme images de page24 ; tout diaporama PPTX doit donc passer soit par Mistral OCR (qui accepte PDF, PPTX et DOCX20), soit par une conversion préalable en PDF.

| Solution (état nov. 2026\) | Extraction texte & mise en page | Extraction schémas & figures | Tarif public | Forces et limites sur supports de biologie |
| :---- | :---- | :---- | :---- | :---- |
| Mistral OCR 4.1 (mistral-ocr-latest, GA août 202625) | Markdown par page, 13 types de blocs, scores de confiance20 | Natif via include\_image\_base64=True, boîtes englobantes et bbox\_annotation20 | 4 \$/1 000 p. std ; 2 \$/1 000 p. Batch ; 5 \$/1 000 p. annoté19 | Score de fidélité de contenu de 89,55 et d'ancrage visuel de 71,17 sur ParseBench (mesuré sur OCR 4 selon Anyformat), 85,20 sur OlmOCRBench selon Mistral ; coût prévisible à la page ; moins fort sur l'écriture manuscrite27 |
| Gemini 3.8 Flash Vision \+ découpe PyMuPDF | Compréhension multimodale native jusqu'à 1 000 pages / 50 Mo24 | Prédiction de coordonnées par prompt vision puis découpe locale31 | 258 tokens/page (\~0,19 \$/1 000 p. en 2026 ; texte natif non facturé)8 | Coût quasi nul avec vos crédits Gemini ; risque occasionnel de rognage imprécis des légendes périphériques sans marge de sécurité |
| PyMuPDF / PyMuPDF4LLM (Artifex, local sans GPU) | Export Markdown/JSON structuré, plugins auto-OCR16 | Extraction d'objets images natifs \+ rendu raster de page16 | 0 \$ (open source sur Cloud Run)7 | Score plus bas sur mises en page complexes (50,47 sur ParseBench33) ; idéal comme pré-processeur et outil de découpe |
| LlamaParse (v2 parse API) | Markdown orienté chunks RAG16 | Extraction variable selon le mode choisi25 | 1,25 \$ à 37,50 \$/1 000 p. (mode économique \~3,80 \$/1 000 p.)25 | Moins adapté à l'extraction brute d'illustrations que Mistral OCR 4.120 |
| Google Document AI Layout Parser (v1.6) | Parser layout propulsé par Gemini25 | Détection de mise en page36 | 10 \$/1 000 p. (OCR de base 1,50 \$/1 000 p., 1 000 p./mois gratuites)25 | 2,5 à 5 fois plus cher que Mistral OCR 4.1 à fonctionnalité équivalente25 |
| Cohere Parse (parse-v5.0) | Markdown ou blocs simples, tableaux HTML25 | Limité aux tableaux, sans typage en-têtes/pieds de page25 | 1,50 \$/1 000 pages25 | Limité à 9 langues commerciales ; absent des trois benchmarks publics vérifiés en sept. 202625 |

Le tarif calculé pour Gemini 3.8 Flash Vision sur PDF provient directement du barème officiel : 1 000 pages représentent 258 000 tokens image (le texte natif intégré n'étant pas facturé sur Gemini 3+)24, soit 0,1935 \$ au tarif promotionnel 2026 de 0,75 \$/1M en entrée (et environ 0,39 \$/1 000 pages dès janvier 2027\)8. La stratégie optimale consiste à déployer un micro-service **PyMuPDF sur Google Cloud Run** qui inspecte et découpe les fichiers dépassant 50 Mo ou 1 000 pages32, puis confie l'extraction texte \+ figures à **Mistral OCR 4.1** (include\_blocks=True, include\_image\_base64=True) pour 0,80 \$ à 1,60 \$ les 400 pages11. Pour rester à 0 € hors crédits Gemini dès le lancement, un interrupteur d'environnement peut basculer l'extraction vers le mode 100 % Gemini \+ découpe locale PyMuPDF avec une marge de rognage de 3 à 5 % autour des boîtes prédites.

### **Synthèse vocale (TTS) en français scientifique et word-level timestamps**

La biologie universitaire confronte les moteurs TTS à trois pièges : les sigles (ADN, ARNm, ATP, NADPH), les composés gréco-latins (phosphorylation oxydative, réticulum endoplasmique) et les notations chiffrées (pH 7,4, 37 °C, 10⁻⁶ mol/L). Aucun benchmark indépendant public de 2026 consulté ne mesure spécifiquement la prononciation biomédicale française à travers l'ensemble de ces API (le test comparatif d'août 2026 publié par Gradium évalue ses propres cas difficiles avant la sortie d'ElevenLabs v4 en septembre 202637). En revanche, les mécanismes de contrôle phonétique, la disponibilité des timestamps et les tarifs sont documentés.

| API TTS (état nov. 2026\) | Qualité & naturel en français | Contrôle termes scientifiques (IPA / SSML) | Word-level timestamps | Free tier & tarif public |
| :---- | :---- | :---- | :---- | :---- |
| ElevenLabs eleven\_v4\_turbo / eleven\_v4 | Référence du marché (Arena Elo 1334 et 1321 selon eesel.ai) ; 90+ langues22 | Dictionnaires de prononciation alias \+ règles phonétiques IPA/CMU en français sur v4 / v4\_turbo21 | Endpoints timestamps disponibles (notamment Dialogue with timestamps sur l'API Text-to-Dialogue ; support à valider sur le SDK cible car certains wrappers rejettent l'option)38 | Free 10k crédits/mois (\~10–20 min, usage non commercial avec attribution) ; API Starter 6 \$/mois (75k car. v4 ou 150k v4\_turbo, licence comm.) ; liste 40 \$/1M (v4\_turbo) et 80 \$/1M (v4)22 |
| ElevenLabs eleven\_flash\_v2\_5 | Bon naturel, 32 langues38 | Normalisation des nombres désactivée par défaut ; pas d'IPA non-anglais21 | Oui via /convert-with-timestamps46 | 40 \$/1M car. (50 % moins cher que v4), limite 40k car./requête23 |
| Azure AI Speech (Neural TTS) | Très fluide (fr-FR), 150+ langues et variantes47 | SSML complet (débit, hauteur, pauses, prononciation)47 | Support exact de l'événement WordBoundary sur les voix françaises non vérifié dans les extraits officiels consultés | **500 000 car./mois gratuits (F0)** puis \~15 \$/1M en Neural standard18 |
| Google Cloud TTS (Neural2 / Chirp 3: HD) | Chirp 3: HD très expressif ; Neural2 neutre et régulier17 | Neural2 compatible SSML ; la documentation des types de voix précise que Chirp 3 HD ne supporte pas le SSML ni les réglages pitch/vitesse (et l'API streaming exclut le SSML)49 | Pas de timestamps automatiques par mot ; enableTimePointing (v1beta1) repose sur des balises SSML \<mark\> manuelles51 | **1M car./mois gratuits permanents** par famille (WaveNet 4 \$/1M, Neural2 16 \$/1M, Chirp 3 HD 30 \$/1M)17 |
| Gemini 3.8 Flash TTS (Preview) | Bon naturel (Arena Elo 1275 selon eesel.ai)22 | Pilotable par instructions de style, sans dictionnaire IPA dédié documenté | Non natif (nécessite une passe d'alignement STT) | \~16,50 \$/1M car. normalisés selon eesel.ai (18 \$/1M jetons audio sur 3.8 Flash-Lite TTS ; \~0,91–1,81 \$/h sur versions 2.5/3.1)22 |
| Cartesia Sonic 3.6 | 44 langues ; retours utilisateurs mitigés hors anglais54 | 75,1 % sur le benchmark interne publié par son concurrent Gradium (contre 81 % pour Gradium)37 | Timestamps mots et phonèmes natifs en WebSocket15 | Free 20k crédits (\~27 min) ; Pro 4–5 \$/mois ; \~38–49 \$/1M car. normalisés15 |
| OpenAI gpt-4o-mini-tts | Correct mais facturation en tokens peu prévisible15 | Pilotable par prompt (vibe)54 | Non natif | Aucun free tier ; **arrêt programmé le 6 janvier 2027**15 |

Trois principes techniques permettent d'obtenir une diction irréprochable tout en maîtrisant les coûts :

> 1. **Double rédaction par le LLM (displayText vs spokenText) :** Le prompt de scénarisation génère simultanément un texte visuel fidèle à la biologie (pH 7,4, ATP, µm, 37 °C) et un texte parlé phonétiquement développé (pé ache sept virgule quatre, a té pé, micromètres, trente-sept degrés Celsius). Cette couche neutralise les erreurs sur les nombres et sigles des modèles rapides comme eleven\_flash\_v2\_539.  
> 2. **Dictionnaire phonétique IPA français sur ElevenLabs :** Si vous choisissez ElevenLabs pour la qualité vocale commerciale, utilisez eleven\_v4\_turbo (ou eleven\_v4), car la documentation officielle impose la gamme v4 pour appliquer des règles phonétiques IPA/CMU dans une autre langue que l'anglais21.  
> 3. **Architecture découplée TTS gratuit \+ alignement forcé :** Pour un MVP à coût quasi nul, vous pouvez générer l'audio via **Azure AI Speech F0** (500 000 car./mois gratuits) ou **Google Cloud Neural2** (1M car./mois gratuits), puis obtenir des timestamps mot-à-mot précis en passant le MP3 dans **ElevenLabs Scribe** (0,20 à 0,22 \$/heure audio, soit \~0,004 \$ par capsule de 75 s, avec un WER de 3,1 % revendiqué par ElevenLabs)11. Notez toutefois qu'un comparatif tiers signale que les conditions d'utilisation de Google Cloud TTS encadrent plus strictement la mise en cache persistante d'audio que celles d'Amazon Polly17 ; vérifiez ce point juridique avant de passer d'un usage personnel/prototype à une plateforme publique utilisant Google TTS.

### **Live Web Rendering vs Rendu vidéo serveur (Remotion / FFmpeg)**

| Critère | Live Web Rendering (React \+ Storyboard JSON \+ MP3 \+ WebP) | Rendu serveur (Remotion Lambda \+ S3 \+ FFmpeg) |
| :---- | :---- | :---- |
| Coût de calcul (1 000 vidéos d'1 min) | **0,00 €** (animations CSS/GPU exécutées sur le téléphone)11 | \~17 à 21 \$ AWS Lambda (dont \~390 rendus/mois couverts par les 400k GB-s gratuits AWS) \+ licence 0,01 \$/rendu (min. 100 \$/mois) si équipe de 4+ personnes1 |
| Poids réseau par épisode (75 s) | \~1,2 Mo d'audio MP3 (128 kbps2) \+ JSON léger et WebP compressés (\~1,5 Mo indicatif) | **\~60 Mo** pour 1 min en MP4 1080p à 8 Mbps1 (fichiers intermédiaires Remotion souvent \> 200 Mo avant compression FFmpeg59) |
| Stockage et transfert (250 épisodes) | Quelques centaines de Mo (très en dessous des 10 Go gratuits R2, avec **0 \$ de bande passante sortante**5) | \~15 Go MP4 sur S3 (0,35 \$/mois à 0,023 \$/Go) \+ egress S3 à 0,09 \$/Go au-delà des 100 Go gratuits1 |
| Délai après génération | **Instantané** (\< 1 s après réception du TTS) | **15 à 30 s** d'encodage distribué par vidéo60 \+ étape de post-compression FFmpeg59 |
| Pédagogie mobile | Pinch-to-zoom sur schéma, vitesse 1,25x/1,5x sans artefact, texte vectoriel net | Flux vidéo passif ; ré-encodage requis à la moindre correction de texte |
| Complexité d'infrastructure | Faible (boucle requestAnimationFrame \+ gestion audio iOS Safari) | Élevée (buckets S3, rôles IAM, gestion cold starts Lambda, compression FFmpeg1) |

Le **Live Web Rendering** s'impose nettement. Il supprime la quasi-totalité des frais de stockage, de calcul serveur et de bande passante1, réduit le temps d'attente étudiant à zéro et autorise une interaction directe sur les schémas anatomiques ou biochimiques. Le contrat JSON strict décrit plus loin préserve en outre la possibilité d'ajouter plus tard un bouton d'export MP4 à la demande via Remotion (gratuit jusqu'à 3 personnes)58.

### **Moteur 1 : Stratégie optimale pour l'API YouTube et l'extraction de segments**

L'architecture de curation vidéo doit intégrer la refonte des quotas YouTube Data API v3 en vigueur depuis le **1er juin 2026** ainsi que ses contraintes structurelles61 :

> 1. **Trois enveloppes de quotas distinctes :** Chaque projet Google Cloud dispose par défaut de **100 appels search.list par jour** (dans un bucket dédié), 100 appels videos.insert par jour et **10 000 unités par jour** pour toutes les autres requêtes de lecture (videos.list, channels.list et playlistItems.list coûtent chacune **1 unité par appel** jusqu'à 50 éléments)61. Les compteurs se réinitialisent à minuit heure du Pacifique (\~9h00 à Paris)62.  
> 2. **Absence de filtre natif Shorts et de transcriptions publiques :** Sur search.list, le filtre videoDuration ne segmente qu'à moins de 4 minutes (short), 4–20 minutes (medium) et plus de 20 minutes (long)63. En outre, search.list ne renvoie ni la durée exacte ni le nombre de vues : il faut enchaîner un appel videos.list (1 unité pour 50 IDs) pour isoler les Shorts (≤ 60–90 s) et vérifier le statut d'intégration64. L'endpoint officiel captions.download est bloqué pour toute vidéo dont vous n'êtes pas propriétaire62, et les bibliothèques open source d'extraction de sous-titres sont fréquemment bloquées par YouTube depuis des adresses IP cloud67.  
> 3. **Règle de fraîcheur à 30 jours :** Selon une synthèse des règles développeurs YouTube mise à jour en novembre 2026, les métadonnées stockées via l'API doivent être rafraîchies ou purgées tous les 30 jours calendaires et tout scraping direct est proscrit64.

Pour contourner ces blocages à coût quasi nul, combinez quatre mécanismes :

> 1. **Catalogue préalable de chaînes de biologie (1 unité pour 50 vidéos) :** Maintenez une liste blanche de chaînes universitaires et de vulgarisation scientifique fiables (FR/EN) dont vous stockez la playlist uploads. Utilisez playlistItems.list (1 unité du pool de 10 000\) plutôt que search.list pour collecter leurs vidéos, suivie d'un appel groupé videos.list (1 unité pour 50 vidéos) pour récupérer durée, vues et statut61.  
> 2. **Appels search.list réservés aux concepts manquants avec cache Postgres TTL 30 jours :** N'appelez search.list (avec videoSyndicated ou filtrage post-requête sur les métadonnées) que lorsqu'aucune vidéo pertinente du catalogue local n'atteint le seuil de correspondance, et stockez les résultats avec un champ expires\_at à \+30 jours63.  
> 3. **Extraction exacte des timestamps par Gemini Agentic Video Understanding :** L'API Gemini accepte nativement les **URL YouTube publiques** (fonctionnalité actuellement en *preview* sans frais supplémentaires annoncés au-delà des tokens consommés, limitée à 8 heures/jour sur le tier gratuit et sans limite de durée sur le tier payant)9. En activant "processing": "agentic" sur gemini-3.8-flash (ou gemini-3.5-flash-lite), le modèle inspecte d'abord la transcription puis ne charge visuellement que les segments pertinents, réduisant jusqu'à **88 %** les tokens vidéo et jusqu'à **66 %** le coût selon Google tout en gagnant \~7 % de précision sur les vidéos longues9. Si vous souhaitez pré-filtrer beaucoup de candidats textuellement avant d'appeler Gemini sur la vidéo, un service géré comme **TranscriptAPI** (5 \$/mois pour 1 000 crédits) ou **Supadata** (100 crédits gratuits) contourne les blocages d'IP cloud67.  
> 4. **Lecture mobile iOS Safari sans bascule plein écran :** Dans le lecteur frontend, configurez l'API **YouTube IFrame Player** avec playsinline=1 et rel=0 (sans playsinline=1, l'iPhone force l'ouverture du lecteur natif plein écran et casse l'expérience scroll-snap)69, puis bouclez programmatiquement entre yt\_start\_sec et yt\_end\_sec.

## **Architecture et stack complète**

### **Stack technique « Zéro coût fixe »**

| Couche | Service recommandé (2026) | Free tier et limites documentées | Rôle dans le projet |
| :---- | :---- | :---- | :---- |
| Frontend PWA | Next.js (App Router) \+ React \+ Tailwind \+ Framer Motion \+ Serwist sur **Vercel Hobby** | 4 CPU-h, 360 GB-h RAM, 1M invocations, **durée max fonction 300 s** ; suspension 30 jours si dépassement3 | PWA installable (supportée en UE sur iOS depuis iOS 17.4+71), feed scroll-snap, lecteur Web Live |
| Base de données | **Neon Serverless Postgres** (+ Drizzle ORM) | 0,5 Go, 100 h compute/mois, scale-to-zero après 5 min sans pause hebdomadaire4 | Cours, schémas, concepts, storyboards JSON, cache YouTube TTL 30j, progression |
| Alternative Auth / DB | **Better Auth / Auth.js** sur Neon (vs Supabase) | Supabase offre 50k MAU Auth gratuits, mais **met les projets en pause après 7 jours d'inactivité**4 | Évite qu'un prototype ou compte étudiant ne se fige entre deux périodes d'examens4 |
| Stockage média | **Cloudflare R2** (avec domaine personnalisé) | **10 Go-mois**, 1M ops Classe A, 10M ops Classe B, **egress internet gratuit** (éviter r2.dev bridé en prod)5 | PDF sources, schémas WebP recadrés, MP3 voix-off (vérifier à la création si certaines intégrations Workers exigent le palier à 5 \$/mois75) |
| Orchestration async | **Trigger.dev** | **5 \$/mois de crédits gratuits** (\~2 435 runs de 60 s en Small 1x), 20 runs concurrents, pas de timeout d'étape6 | Pipelines durables TypeScript78 : ingestion, OCR, génération épisodes, curation YouTube |
| Worker PDF Python | **Google Cloud Run** (FastAPI \+ PyMuPDF \+ Pillow) | **Always Free** : 180k vCPU-s, 360k GiB-s, 2M req/mois (crédits basés sur us-central1)7 | Découpe PDF \> 50 Mo, conversion PPTX \-\> PDF si besoin, rendu 200 DPI et crop WebP |
| Cerveau IA & Vidéo | **Google Gemini API** (gemini-3.8-flash & 3.5-flash-lite) | Contexte 1M tokens ; Batch à \-50 % ; Agentic Video Understanding8 | Segmentation concepts, scénarisation JSON, normalisation phonétique, timestamps YouTube |
| OCR & TTS | **Mistral OCR 4.1** \+ **Azure F0 / Google TTS** (ou **ElevenLabs v4\_turbo**) | Mistral Batch 2 \$/1k p. ; Azure 500k/m ; Google 1M/m17 | Extraction déterministe de schémas et synthèse vocale scientifique synchronisée |

### **Flux de données bout en bout**

Le pipeline sépare strictement le traitement asynchrone (Trigger.dev \+ Cloud Run) de la lecture instantanée (Next.js \+ CDN R2) :

> 1. **Upload direct :** La PWA demande à Next.js une URL pré-signée **Cloudflare R2** et y dépose directement le PDF ou diaporama, sans saturer la bande passante ni le timeout des fonctions Vercel. Le client déclenche ensuite la tâche **Trigger.dev** ingest-course.  
> 2. **Inspection et extraction de schémas :** Trigger.dev sollicite le worker **Cloud Run (PyMuPDF)** pour compter les pages et découper tout PDF excédant 50 Mo ou 1 000 pages32, puis appelle **Mistral OCR 4.1** (include\_blocks=True, include\_image\_base64=True) — ou bascule sur l'extracteur Gemini Vision \+ découpe PyMuPDF. Chaque figure extraite est convertie en WebP optimisé, stockée sur R2 et indexée dans course\_diagrams.  
> 3. **Découpage pédagogique :** gemini-3.8-flash analyse le Markdown du cours accompagné des légendes et descriptions des schémas pour produire une liste ordonnée de **concepts atomiques** ciblant chacun 60 à 90 secondes d'explication, puis lance en parallèle (batchTrigger) les deux moteurs de contenu.  
> 4. **Exécution du Moteur 2 (Génération programmatique) :** Une tâche dédiée rédige le storyboard JSON (displaySegments \+ spokenText normalisé \+ appels aux diagramIds), génère l'audio MP3 et les wordTimings via l'adaptateur TTS (Azure/Google \+ Scribe ou ElevenLabs v4\_turbo), dépose le MP3 sur R2 et enregistre l'épisode dans Neon.  
> 5. **Exécution du Moteur 1 (Curation YouTube) :** Une tâche parallèle interroge le cache Postgres (expires\_at \> now()) puis le catalogue de chaînes biologiques (playlistItems.list \+ videos.list), recourt à search.list uniquement en l'absence de candidat, et soumet l'URL publique des 1 à 2 meilleures vidéos longues à gemini-3.8-flash avec "processing": "agentic" pour isoler un extrait autonome \[yt\_start\_sec, yt\_end\_sec\]9.  
> 6. **Streaming sur la PWA :** Le feed vertical ne charge que les métadonnées JSON paginées et précharge une fenêtre glissante de trois cartes (index \- 1, index, index \+ 1\) pour maintenir une lecture fluide sur iOS Safari et Android Chrome.

### **Schéma de base de données (PostgreSQL) et contrat Storyboard JSON**

SQL  
\-- 1\. Cours et supports PDF / diaporamas importés  
CREATE TABLE courses (  
  id UUID PRIMARY KEY DEFAULT gen\_random\_uuid(),  
  user\_id TEXT NOT NULL,  
  title TEXT NOT NULL,  
  discipline TEXT DEFAULT 'biologie',  
  source\_r2\_key TEXT NOT NULL,  
  page\_count INT NOT NULL,  
  status TEXT NOT NULL DEFAULT 'processing', \-- processing \| ready \| failed  
  created\_at TIMESTAMPTZ DEFAULT now()  
);

\-- 2\. Schémas et figures extraits du cours  
CREATE TABLE course\_diagrams (  
  id UUID PRIMARY KEY DEFAULT gen\_random\_uuid(),  
  course\_id UUID REFERENCES courses(id) ON DELETE CASCADE,  
  page\_number INT NOT NULL,  
  r2\_image\_key TEXT NOT NULL,  
  width INT NOT NULL,  
  height INT NOT NULL,  
  caption TEXT,  
  ai\_description TEXT NOT NULL,  
  bbox\_json JSONB \-- Coordonnées normalisées 0..1000  
);

\-- 3\. Concepts atomiques extraits  
CREATE TABLE concepts (  
  id UUID PRIMARY KEY DEFAULT gen\_random\_uuid(),  
  course\_id UUID REFERENCES courses(id) ON DELETE CASCADE,  
  chapter\_title TEXT NOT NULL,  
  title TEXT NOT NULL,  
  keywords TEXT\[\] NOT NULL,  
  source\_pages INT\[\] NOT NULL,  
  order\_index INT NOT NULL  
);

\-- 4\. Cache métadonnées YouTube (TTL 30 jours)  
CREATE TABLE youtube\_videos\_cache (  
  video\_id TEXT PRIMARY KEY,  
  channel\_id TEXT NOT NULL,  
  title TEXT NOT NULL,  
  language TEXT NOT NULL, \-- fr \| en  
  duration\_sec INT NOT NULL,  
  is\_short BOOLEAN NOT NULL,  
  is\_embeddable BOOLEAN NOT NULL,  
  view\_count BIGINT DEFAULT 0,  
  fetched\_at TIMESTAMPTZ NOT NULL DEFAULT now(),  
  expires\_at TIMESTAMPTZ NOT NULL \-- now() \+ interval '30 days'  
);

\-- 5\. Capsules unifiées du feed vertical (Moteurs 1 et 2\)  
CREATE TABLE episodes (  
  id UUID PRIMARY KEY DEFAULT gen\_random\_uuid(),  
  concept\_id UUID REFERENCES concepts(id) ON DELETE CASCADE,  
  course\_id UUID REFERENCES courses(id) ON DELETE CASCADE,  
  engine\_type TEXT NOT NULL, \-- 'generated' \| 'youtube\_short' \| 'youtube\_clip'  
  title TEXT NOT NULL,  
  duration\_sec REAL NOT NULL,  
  audio\_r2\_key TEXT,  
  storyboard\_json JSONB,  
  youtube\_video\_id TEXT REFERENCES youtube\_videos\_cache(video\_id),  
  yt\_start\_sec INT DEFAULT 0,  
  yt\_end\_sec INT,  
  relevance\_score REAL,  
  quiz\_json JSONB,  
  created\_at TIMESTAMPTZ DEFAULT now()  
);

\-- 6\. Progression et répétition espacée  
CREATE TABLE user\_progress (  
  user\_id TEXT NOT NULL,  
  episode\_id UUID REFERENCES episodes(id) ON DELETE CASCADE,  
  watched\_pct REAL DEFAULT 0,  
  quiz\_correct BOOLEAN,  
  liked BOOLEAN DEFAULT false,  
  next\_review\_at TIMESTAMPTZ,  
  updated\_at TIMESTAMPTZ DEFAULT now(),  
  PRIMARY KEY (user\_id, episode\_id)  
);

Contrat TypeScript/JSON du champ storyboard\_json consommé par le lecteur React :

TypeScript  
export interface WordTimestamp {  
  word: string;     // Terme affiché (ex: "ATP", "pH 7,4")  
  startMs: number;  
  endMs: number;  
}

export interface StoryboardScene {  
  id: string;  
  startMs: number;  
  endMs: number;  
  visualType: "diagram" \| "kinetic\_text" \| "comparison\_card";  
  diagramId?: string;  
  diagramUrl?: string;  
  cameraMotion?: {  
    fromScale: number;  
    toScale: number;  
    focusX: number; // Pourcentage 0..100  
    focusY: number; // Pourcentage 0..100  
  };  
  calloutLabel?: string;  
  highlightText?: string;  
}

export interface GeneratedStoryboard {  
  version: "1.0";  
  totalDurationMs: number;  
  hookTitle: string;  
  scenes: StoryboardScene\[\];  
  wordTimings: WordTimestamp\[\];  
}

## **Estimation des coûts : 50 micro-vidéos et semestre complet**

### **Hypothèses explicites de calcul**

Les estimations ci-dessous utilisent un taux de change indicatif assumé de **1 USD \= 0,92 EUR**11 et modélisent deux volumes représentatifs d'un cursus de biologie :

> 1. **Lot de 50 micro-vidéos (MVP) :** 2 cours totalisant **400 diapositives PDF** (\~80 schémas), générant **50 capsules programmées** de 75 s (\~190 mots français et \~1 250 caractères par script, soit **75 000 caractères TTS** avec une marge de \+20 % pour régénérations/tests, et 75 minutes d'audio) ainsi que l'analyse de **30 vidéos YouTube** de 12 minutes en moyenne pour le Moteur 111.  
> 2. **Semestre universitaire complet :** 5 unités d'enseignement totalisant **2 000 diapositives PDF** (\~400 schémas), générant **250 capsules programmées** (**375 000 caractères TTS** avec marge de \+20 %, soit 375 minutes / 6h15 d'audio) et analysant **150 vidéos YouTube** de 12 minutes11.  
> 3. **Modélisation tokens Gemini :** Chaque page PDF consomme exactement **258 tokens image** (texte natif gratuit sur Gemini 3+) plus \~100 tokens/page d'instructions et découpage11 ; chaque épisode scénarisé consomme \~3 000 tokens en entrée et \~1 800 tokens en sortie (*thinking tokens* compris8) ; chaque vidéo YouTube de 12 minutes en mode **Agentic** retient une réduction prudente de 75 % (contre jusqu'à 88 % annoncés par Google9), soit \~46 800 tokens par vidéo inspectée. Cela représente **1,70M tokens en entrée et 0,13M en sortie** pour 50 vidéos, et **8,49M en entrée / 0,67M en sortie** pour un semestre complet11.

### **Tableau comparatif des coûts réels**

| Poste de dépense | Choix technologique | 50 micro-vidéos (400 p., 30 YT) | Semestre complet (2 000 p., 150 YT) |
| :---- | :---- | :---- | :---- |
| Extraction PDF & schémas (Option A) | PyMuPDF \+ Gemini Vision (Cloud Run) | **0,00 €** *(inclus dans tokens Gemini)*11 | **0,00 €** *(inclus dans tokens Gemini)*11 |
| Extraction PDF & schémas (Option B) | Mistral OCR 4.1 Batch (2 \$/1k p.) / Std (4 \$/1k p.)19 | **0,74 €** Batch / **1,47 €** Std11 | **3,68 €** Batch / **7,36 €** Std11 |
| LLM \+ Curation YT (gemini-3.8-flash 2026\) | Tarif promo jusqu'au 31/12/2026 (Batch \-50 % / Std)8 | **0,82 €** Batch / **1,63 €** Std11 | **4,08 €** Batch / **8,17 €** Std11 |
| LLM \+ Curation YT (dès 01/01/2027) | gemini-3.8-flash standard ou gemini-4-hydrogen (Batch / Std)8 | **1,63 €** Batch / **3,27 €** Std11 | **8,17 €** Batch / **16,33 €** Std11 |
| LLM économique (filtrage / tri) | gemini-3.5-flash-lite (Batch / Std)8 | **0,39 €** Batch / **0,78 €** Std11 | **1,94 €** Batch / **3,88 €** Std11 |
| Voix-off \+ Timestamps (Profil A éco) | Azure F0 (500k/m gratuits) ou Google Neural2 (1M/m gratuits) \+ Scribe (0,22 \$/h)17 | **0,00 €** TTS \+ **0,25 €** Scribe11 | **0,00 €** TTS \+ **1,27 €** Scribe11 |
| Voix-off \+ Timestamps (Profil B premium) | ElevenLabs eleven\_v4\_turbo (40 \$/1M liste ; ou API Starter 6 \$/m \= 150k car.)22 | **2,76 €** prorata (ou 5,52 € plan Starter)11 | **13,80 €** prorata (ou \~16,56–20,24 € en plans mensuels11) |
| Rendu vidéo & Infrastructure | Live Web Rendering \+ Vercel \+ Neon \+ R2 \+ Trigger.dev \+ Cloud Run | **0,00 €** *(vs \~1,15 € / 5,75 € compute Remotion avant free tier AWS)*3 | **0,00 €** *(vs \~5,75 € compute Remotion \+ S3)*3 |
| **Total — Profil Optimal Zéro Coût Fixe** | Mistral OCR Batch \+ Gemini Batch (2026) \+ Azure/Google Free TTS \+ Scribe | **\~1,81 €** *(0,82 € sur crédit Gemini ; \~0,99 € cash)*11 | **\~9,03 €** *(4,08 € sur crédit Gemini ; \~4,95 € cash)*11 |
| **Total — Profil Premium Scientifique** | Mistral OCR Std \+ Gemini Std (2026) \+ ElevenLabs v4\_turbo (prorata) | **\~5,86 €** *(1,63 € sur crédit Gemini ; \~4,23 € cash)*11 | **\~29,33 €** *(8,17 € sur crédit Gemini ; \~21,16 € cash)*11 |

### **Adéquation avec votre budget Gemini (30 € acquis \+ 10 €/mois)**

Même après le doublement tarifaire de gemini-3.8-flash au 1er janvier 20278, le traitement d'un semestre entier en mode standard (16,33 € de tokens Gemini11) reste intégralement absorbé par vos **30 € de crédits existants**, tandis que votre enveloppe récurrente de **10 €/mois** couvre un semestre complet par mois en mode Batch (8,17 €11). Pour maximiser cette marge, confiez les tâches de pré-filtrage et de classification à gemini-3.5-flash-lite (5× moins coûteux en entrée que 3.8-flash en 20278) et conservez gemini-3.8-flash pour la scénarisation JSON et l'analyse vidéo agentique9.

## **Plan d'implémentation MVP pour Claude Code**

Ce cahier des charges peut être transmis directement à **Claude Code** pour initialiser le monorepo et développer les quatre modules par phases incrémentales.

### **Arborescence cible des fichiers clés**

| Chemin | Rôle architectural |
| :---- | :---- |
| apps/web/src/app/layout.tsx & manifest.ts | Configuration PWA mobile (viewport-fit=cover, thème sombre, icônes, service worker Serwist) |
| apps/web/src/app/(feed)/page.tsx | Route principale : feed vertical plein écran (scroll-snap) unifiant Moteurs 1 et 2 |
| apps/web/src/app/(upload)/upload/page.tsx | Upload direct PDF/diaporama vers URL pré-signée R2 \+ suivi temps réel Trigger.dev |
| apps/web/src/components/feed/VerticalFeed.tsx | Virtualisation à 3 cartes (prev, active, next), déverrouillage audio iOS Safari |
| apps/web/src/components/feed/LiveCapsulePlayer.tsx | Moteur Live Web Rendering : sync \<audio\> \+ requestAnimationFrame sur storyboard\_json |
| apps/web/src/components/feed/DynamicCaptions.tsx | Sous-titres karaoké mot-à-mot pilotés par wordTimings |
| apps/web/src/components/feed/YouTubeSegmentPlayer.tsx | Lecteur YouTube IFrame API (playsinline=1) avec bouclage strict \[yt\_start\_sec, yt\_end\_sec\] |
| apps/web/src/components/feed/QuizOverlay.tsx | Micro-QCM interactif en fin de capsule |
| apps/web/src/lib/db/schema.ts | Schéma Drizzle ORM reflétant les 6 tables PostgreSQL Neon |
| apps/web/src/lib/storage/r2.ts | Client S3 SDK configuré pour Cloudflare R2 (URL pré-signées et lecture CDN) |
| apps/web/src/lib/tts/adapter.ts | Interface abstraite TTSProvider (azure-scribe / google-scribe / elevenlabs-v4-turbo) |
| apps/web/src/lib/youtube/curator.ts | Client YouTube Data API v3 (playlistItems.list, videos.list, search.list \+ cache 30j) |
| apps/web/src/trigger/ingest-course.ts | Workflow Trigger.dev : PDF \-\> OCR/Images \-\> Concepts \-\> Fan-out Moteur 1 & 2 |
| apps/web/src/trigger/generate-episode.ts | Tâche Trigger.dev : Gemini Storyboard JSON \-\> TTS \+ Timestamps \-\> Upload R2 \-\> DB |
| apps/web/src/trigger/curate-youtube.ts | Tâche Trigger.dev : Recherche YT \-\> Gemini Agentic Video URL \-\> Validation segments |
| services/pdf-worker/main.py | Micro-service FastAPI (Docker/Cloud Run) : split PDF \> 50 Mo, conversion & crop WebP |

### **Phase 0 : Initialisation, base Neon et stockage Cloudflare R2**

> 1. Initialiser une application Next.js (App Router, TypeScript strict, Tailwind CSS) dans apps/web avec drizzle-orm, @neondatabase/serverless, @aws-sdk/client-s3, @aws-sdk/s3-request-presigner, zod, framer-motion, @trigger.dev/sdk et @serwist/next.  
> 2. Traduire les 6 tables SQL dans apps/web/src/lib/db/schema.ts et exécuter la migration initiale vers Neon via drizzle-kit.  
> 3. Créer apps/web/src/lib/storage/r2.ts exposant getPresignedUploadUrl(), uploadBufferToR2() et getPublicAssetUrl() pointant vers le domaine R2 configuré dans R2\_PUBLIC\_BASE\_URL.  
> 4. Documenter toutes les variables requises dans .env.example (DATABASE\_URL, R2\_ENDPOINT, R2\_ACCESS\_KEY\_ID, R2\_SECRET\_ACCESS\_KEY, R2\_BUCKET, R2\_PUBLIC\_BASE\_URL, GEMINI\_API\_KEY, MISTRAL\_API\_KEY, YOUTUBE\_API\_KEY, TTS\_PROVIDER, ELEVENLABS\_API\_KEY, AZURE\_SPEECH\_KEY, AZURE\_SPEECH\_REGION, PDF\_WORKER\_URL, PDF\_WORKER\_SECRET, TRIGGER\_SECRET\_KEY).

### **Phase 1 : Worker PDF Python et ingestion des cours**

> 1. Créer services/pdf-worker/main.py avec FastAPI, pymupdf (fitz) et Pillow, sécurisé par en-tête X-Worker-Secret, et écrire un Dockerfile léger prêt pour Cloud Run (port 8080).  
> 2. Implémenter deux endpoints dans pdf-worker : POST /split-and-inspect (compte les pages, scinde tout PDF dépassant 50 Mo ou 200 pages en tronçons propres) et POST /crop-bboxes (rend la page demandée à 200 DPI, applique une marge de sécurité de 3 % sur la boîte englobante et exporte l'image en WebP optimisé sous 100 Ko).  
> 3. Créer les routes Next.js POST /api/courses/upload-url (génère l'URL pré-signée R2) et POST /api/courses/ingest (insère la ligne courses et déclenche ingest-course sur Trigger.dev).  
> 4. Dans apps/web/src/trigger/ingest-course.ts, appeler **Mistral OCR 4.1** (model: "mistral-ocr-latest", include\_blocks: true, include\_image\_base64: true)20 — avec un mode alternatif PDF\_EXTRACTOR=gemini utilisant gemini-3.8-flash sur le PDF uploadé via Gemini Files API pour détecter les figures puis pdf-worker /crop-bboxes — et enregistrer chaque schéma WebP dans R2 et course\_diagrams.  
> 5. Demander à gemini-3.8-flash (sortie JSON typée via Zod) de segmenter le cours en 8 à 25 concepts atomiques reliés à leurs diagram\_ids pertinents, puis déclencher en parallèle (batchTrigger) les tâches Moteur 2 et Moteur 1\.

### **Phase 2 : Moteur 2 — Scénarisation JSON et voix-off synchronisée**

> 1. Implémenter apps/web/src/trigger/generate-episode.ts avec gemini-3.8-flash en sortie structurée stricte : imposer un script de 150 à 210 mots (\~65–85 s), une accroche dans les 5 premières secondes, les deux chaînes parallèles (displaySegments avec écriture biologique exacte et spokenText normalisé phonétiquement pour le français), 4 à 7 scenes liant les diagramIds avec coordonnées focusX/focusY, et un quiz de 4 choix.  
> 2. Implémenter l'adaptateur TTSProvider dans apps/web/src/lib/tts/adapter.ts retournant { audioBuffer, mimeType, durationMs, wordTimings }.  
> 3. Écrire les implémentations concrètes : ElevenLabsV4TurboProvider (utilisant eleven\_v4\_turbo, l'ID optionnel de dictionnaire IPA biologie21 et la récupération des timestamps, avec bascule automatique sur Scribe si l'endpoint ne renvoie pas l'alignement attendu) et AzureOrGoogleWithScribeProvider (synthèse via Azure Neural F0 ou Google Neural2, suivie d'un alignement sur ElevenLabs Scribe).  
> 4. Ajouter une fonction déterministe mapSpokenTimingsToDisplayWords() qui rattache la plage temporelle des mots prononcés (a té pé) aux jetons visuels (ATP) afin d'afficher des sous-titres scientifiquement irréprochables.  
> 5. Uploader le fichier MP3 sur R2, finaliser le storyboard\_json et insérer l'épisode (engine\_type \= 'generated') dans episodes.

### **Phase 3 : Moteur 1 — Curation YouTube et découpe par Agentic Video Understanding**

> 1. Créer apps/web/src/lib/youtube/channels.json répertoriant environ 20 chaînes universitaires et de vulgarisation biologique fiables (FR et EN) avec leur channelId et uploadsPlaylistId.  
> 2. Implémenter apps/web/src/lib/youtube/curator.ts : synchroniser les métadonnées des chaînes via playlistItems.list (1 unité) \+ videos.list par lots de 50 (1 unité), identifier les Shorts (≤ 90 s) et enregistrer dans youtube\_videos\_cache avec expires\_at \= now() \+ 30 days61.  
> 3. Implémenter la recherche hybride par concept : interroger d'abord youtube\_videos\_cache sur les fiches non expirées ; n'appeler search.list (maxResults=15) suivi de videos.list (1 unité) qu'en l'absence de résultat pertinent64.  
> 4. Dans apps/web/src/trigger/curate-youtube.ts, transmettre l'URL YouTube publique des 2 meilleures vidéos longues candidates à gemini-3.8-flash avec "processing": "agentic"9 pour extraire au format JSON un segment autonome de 45 à 90 secondes { found, startSec, endSec, summaryTitle, relevanceScore, quiz }.  
> 5. Insérer les capsules retenues (youtube\_short ou youtube\_clip) dans episodes pour les entrelacer dans le feed avec les capsules du Moteur 2 (ratio par défaut configurable : 2 capsules générées pour 1 capsule YouTube).

### **Phase 4 : Lecteur PWA vertical et Live Web Renderer**

> 1. Configurer le manifeste PWA (display: "standalone", orientation: "portrait") et bâtir VerticalFeed.tsx autour d'un conteneur h-\[100dvh\] w-full overflow-y-scroll snap-y snap-mandatory overscroll-y-contain, avec des cartes h-\[100dvh\] snap-start snap-always.  
> 2. Afficher un écran d'amorçage léger (« Lancer la session ») au premier chargement du feed afin que le clic utilisateur débloque un élément \<audio\> partagé sur iOS Safari et autorise l'enchaînement sonore automatique lors des swipes suivants.  
> 3. Coder LiveCapsulePlayer.tsx sur une boucle requestAnimationFrame lisant audioRef.current.currentTime \* 1000, animant le schéma WebP actif via CSS/Framer Motion (scale et translation vers focusX/focusY), affichant le calloutLabel, synchronisant DynamicCaptions.tsx, et offrant un bouton « Zoom schéma » ainsi qu'un sélecteur de vitesse (1x, 1,25x, 1,5x).  
> 4. Coder YouTubeSegmentPlayer.tsx via l'IFrame API avec playsinline: 1, controls: 0, rel: 0, start: ytStartSec, end: ytEndSec69, piloté par IntersectionObserver (threshold: 0.75) pour mettre en pause instantanément les cartes inactives et boucler proprement à ytStartSec dès que getCurrentTime() \>= ytEndSec (avec gestion de secours onError pour masquer une vidéo dont l'auteur aurait bloqué l'intégration).  
> 5. Connecter QuizOverlay.tsx en fin de capsule vers POST /api/progress (user\_progress) pour enregistrer la maîtrise des concepts.

### **Critères de validation du MVP**

> 1. **Test d'ingestion réelle :** L'import d'un PDF de biologie cellulaire (20–40 diapositives comportant schémas vectoriels et légendes) produit des images WebP nettes et non rognées sur R2 sans dépassement de délai Vercel ou Trigger.dev.  
> 2. **Test d'alignement scientifique :** Sur une capsule contenant ADN polymérase, ATP et pH 7,4, la voix-off prononce chaque sigle et valeur numérale correctement et les sous-titres restent calés sur la voix à vitesse 1x et 1,25x.  
> 3. **Test de sobriété sur le quota YouTube :** La curation de 10 concepts consomme au plus 2 à 3 appels search.list grâce à l'indexation préalable par playlistItems.list, et toute entrée de cache dépassant 30 jours est automatiquement rafraîchie ou ignorée61.  
> 4. **Test mobile iOS Safari et Android Chrome :** Le feed PWA installé défile sur au moins 10 capsules mixtes (Live Web Renderer \+ YouTube IFrame playsinline) sans superposition audio lors d'un swipe rapide ni bascule plein écran forcée sur iPhone69.  
> 5. **Contrôle budgétaire :** Aucune ressource fixe payante (GPU, base managée payante ou worker d'encodage MP4) n'est active, et chaque tâche Trigger.dev journalise le décompte de tokens/caractères afin de rester sous la limite mensuelle de 10 € de l'API Gemini.

#### **Sources des citations**

> 1. Remotion Pricing in 2026: License, Lambda and AWS in ... \- Wireflow, [https\://www\.wireflow.ai/blog/remotion-pricing](https://www.wireflow.ai/blog/remotion-pricing)  
> 2. ElevenLabs Pricing for Creators & Businesses of All Sizes, [https\://elevenlabs.io/pricing](https://elevenlabs.io/pricing)  
> 3. Vercel Hobby Plan, [https\://vercel.com/docs/plans/hobby](https://vercel.com/docs/plans/hobby)  
> 4. Best Free Database Hosting Platforms in 2026: 6 Free Tiers, [https\://www\.sadiqalam.com/insights/best-free-database-hosting-platforms-in-2026-6-free-tiers-compared](https://www.sadiqalam.com/insights/best-free-database-hosting-platforms-in-2026-6-free-tiers-compared)  
> 5. R2 pricing \- Cloudflare Docs, [https\://developers.cloudflare.com/r2/pricing/](https://developers.cloudflare.com/r2/pricing/)  
> 6. Cloud Pricing \| Trigger.dev, [https\://trigger.dev/pricing](https://trigger.dev/pricing)  
> 7. Cloud Run pricing \| Google Cloud, [https\://cloud.google.com/run/pricing](https://cloud.google.com/run/pricing)  
> 8. Gemini API Pricing 2026: Every Model per Million Tokens, and the, [https\://www\.maximem.ai/blog/gemini-api-pricing-2026](https://www.maximem.ai/blog/gemini-api-pricing-2026)  
> 9. Video understanding \- Gemini API \- Google AI Studio, [https\://aistudio.google.com/docs/video-understanding](https://aistudio.google.com/docs/video-understanding)  
> 10. Gemini Agentic Video Understanding: 88% Fewer Tokens (2026), [https\://explainx.ai/blog/gemini-agentic-video-understanding-google-ai-studio-2026](https://explainx.ai/blog/gemini-agentic-video-understanding-google-ai-studio-2026)  
> 11. [unknown\_url](http://docs.google.com/unknown_url)  
> 12. Gemini API Pricing (November 2026): Gemini 4 Argon, 3.8 Flash, [https\://www\.morphllm.com/gemini-api-pricing](https://www.morphllm.com/gemini-api-pricing)  
> 13. Gemini API Pricing (November 2026\) \- BenchLM, [https\://benchlm.ai/google/api-pricing](https://benchlm.ai/google/api-pricing)  
> 14. Agent Platform Pricing \| Google Cloud, [https\://cloud.google.com/model-garden/pricing](https://cloud.google.com/model-garden/pricing)  
> 15. Best Low Latency TTS APIs for Voice Agents 2026 \- Omid Saffari, [https\://omidsaffari.com/blog/best-low-latency-text-to-speech-apis-for-voice-agents-2026](https://omidsaffari.com/blog/best-low-latency-text-to-speech-apis-for-voice-agents-2026)  
> 16. Best Table Parsing AI for Complex Docs \- LlamaIndex, [https\://www\.llamaindex.ai/insights/best-table-parsing-ai](https://www.llamaindex.ai/insights/best-table-parsing-ai)  
> 17. Google Cloud TTS Pricing (2026): 4M Free, Then \$4/1M \| TextToLab, [https\://texttolab.com/blog/google-cloud-tts-pricing](https://texttolab.com/blog/google-cloud-tts-pricing)  
> 18. Azure Speech: Pricing & Alternatives (2026) \- AurionX AI, [https\://aurionx.ai/ai/text-to-speech/azure-speech/](https://aurionx.ai/ai/text-to-speech/azure-speech/)  
> 19. Mistral OCR Pricing 2026: Cost Per 1,000 Pages \- Activepieces, [https\://www\.activepieces.com/blog/mistral-ocr-pricing-2026-cost-per-1000-pages](https://www.activepieces.com/blog/mistral-ocr-pricing-2026-cost-per-1000-pages)  
> 20. OCR Processor \| Mistral Docs \- Mistral AI Documentation, [https\://docs.mistral.ai/studio/document-processing/basic\_ocr](https://docs.mistral.ai/studio/document-processing/basic_ocr)  
> 21. Utiliser des dictionnaires de prononciation \- ElevenLabs, [https\://elevenlabs.io/docs/fr/eleven-api/guides/how-to/text-to-speech/pronunciation-dictionaries](https://elevenlabs.io/docs/fr/eleven-api/guides/how-to/text-to-speech/pronunciation-dictionaries)  
> 22. Eleven v4 pricing 2026: API rates, credits, Turbo, and agent costs, [https\://www\.eesel.ai/blog/eleven-v4-pricing](https://www.eesel.ai/blog/eleven-v4-pricing)  
> 23. ElevenLabs API Pricing: Plans for Creators & Businesses of All Sizes, [https\://elevenlabs.io/pricing/api](https://elevenlabs.io/pricing/api)  
> 24. Document understanding \- Gemini API \- Google AI Studio, [https\://aistudio.google.com/docs/document-processing](https://aistudio.google.com/docs/document-processing)  
> 25. Mistral OCR 4.1 vs Cohere Parse: Extraction Accuracy Compared, [https\://intuitionlabs.ai/articles/mistral-ocr-vs-cohere-parse](https://intuitionlabs.ai/articles/mistral-ocr-vs-cohere-parse)  
> 26. Extract Data from Documents via Annotations \- Mistral AI Cookbook, [https\://docs.mistral.ai/fr/resources/cookbooks/mistral-ocr-data\_extraction](https://docs.mistral.ai/fr/resources/cookbooks/mistral-ocr-data_extraction)  
> 27. Mistral OCR 4 & 4.1: Bounding Boxes, Document AI, and the OCR API, [https\://explainx.ai/blog/mistral-ocr-4-bounding-boxes-document-ai-api-2026](https://explainx.ai/blog/mistral-ocr-4-bounding-boxes-document-ai-api-2026)  
> 28. anyformat vs Mistral OCR: Best Alternative Comparison \[2026\], [https\://anyformat.ai/vs/anyformat-vs-mistral-ocr](https://anyformat.ai/vs/anyformat-vs-mistral-ocr)  
> 29. Mistral OCR: Your Version Gates Features \| Zentor Blog, [https\://zentor.ai/blog/mistral-ocr-version-gating](https://zentor.ai/blog/mistral-ocr-version-gating)  
> 30. Automate PDF processing with the Gemini API \- Google AI Studio, [https\://aistudio.google.com/learn/automate-pdf-with-the-gemini-api](https://aistudio.google.com/learn/automate-pdf-with-the-gemini-api)  
> 31. Advanced Document Extraction in Python with Gemini \- YouTube, [https\://www\.youtube.com/watch?v=ir5X7DeahRM](https://www.youtube.com/watch?v=ir5X7DeahRM)  
> 32. Gemini PDF Limit: File Size, Page Caps, and OCR Parsing \- Fastio, [https\://fast.io/resources/gemini-pdf-limit/](https://fast.io/resources/gemini-pdf-limit/)  
> 33. ParseBench Leaderboard & Scores — November 2026 \| BenchLM.ai, [https\://benchlm.ai/benchmarks/parsebench](https://benchlm.ai/benchmarks/parsebench)  
> 34. genieincodebottle/parsemypdf: Collection of PDF parsing ... \- GitHub, [https\://github.com/genieincodebottle/parsemypdf](https://github.com/genieincodebottle/parsemypdf)  
> 35. PDF Parsing Benchmark 2026: Speed, Table and OCR Statistics for, [https\://parsebridge.com/pdf-parsing-benchmark/](https://parsebridge.com/pdf-parsing-benchmark/)  
> 36. Mistral OCR 4 vs Top Document Parsing APIs \- Eden AI, [https\://www\.edenai.co/post/mistral-ocr-4-vs-top-document-parsing-apis-features-benchmarks-and-integration-guide](https://www.edenai.co/post/mistral-ocr-4-vs-top-document-parsing-apis-features-benchmarks-and-integration-guide)  
> 37. Best Text-to-Speech APIs 2026: The Full Ranking \- Gradium, [https\://gradium.ai/content/best-text-to-speech-apis-2026](https://gradium.ai/content/best-text-to-speech-apis-2026)  
> 38. ElevenLabs v4 vs v3 vs Flash v2.5: Which Model in 2026? \- Haass, [https\://haass.io/blog/elevenlabs-v4-vs-v3-vs-flash](https://haass.io/blog/elevenlabs-v4-vs-v3-vs-flash)  
> 39. Models \| ElevenLabs Documentation, [https\://elevenlabs.io/docs/overview/models](https://elevenlabs.io/docs/overview/models)  
> 40. How to use a pronunciation dictionary for TTS models \- ElevenLabs, [https\://elevenlabs.io/blog/pronunciation-dictionary-guide](https://elevenlabs.io/blog/pronunciation-dictionary-guide)  
> 41. Journal des modifications \| ElevenLabs Documentation, [https\://elevenlabs.io/docs/fr/changelog](https://elevenlabs.io/docs/fr/changelog)  
> 42. Create project \| ElevenLabs Documentation, [https\://elevenlabs.io/docs/api-reference/dubbing/create-project](https://elevenlabs.io/docs/api-reference/dubbing/create-project)  
> 43. Eleven v4 API: Streaming TTS and Cost Checks \| WaveSpeed Blog, [https\://wavespeed.ai/blog/audio-and-voice-models/eleven-v4-api-guide/](https://wavespeed.ai/blog/audio-and-voice-models/eleven-v4-api-guide/)  
> 44. ElevenLabs Eleven v4 API, ElevenLabs Music, Sound Effects v3, [https\://www\.pixazo.ai/models/elevenlabs](https://www.pixazo.ai/models/elevenlabs)  
> 45. ElevenLabs Pricing 2026: Plans, Credits & Real Cost Per Minute, [https\://felloai.com/elevenlabs-pricing/](https://felloai.com/elevenlabs-pricing/)  
> 46. Create speech with timing \| ElevenLabs Documentation, [https\://elevenlabs.io/docs/api-reference/text-to-speech/convert-with-timestamps](https://elevenlabs.io/docs/api-reference/text-to-speech/convert-with-timestamps)  
> 47. Azure-Speech-Text-to-speech \| Model Catalog \- Microsoft Foundry, [https\://ai.azure.com/catalog/models/Azure-Speech-Text-to-speech](https://ai.azure.com/catalog/models/Azure-Speech-Text-to-speech)  
> 48. Google Cloud Text-to-Speech Pricing 2026: Voice Models ... \- DIY AI, [https\://diyai.io/ai-tools/audio-generation/google-cloud-text-to-speech-pricing/](https://diyai.io/ai-tools/audio-generation/google-cloud-text-to-speech-pricing/)  
> 49. Chirp 3 : voix HD \| Cloud Text-to-Speech, [https\://docs.cloud.google.com/text-to-speech/docs/chirp3-hd?hl=fr](https://docs.cloud.google.com/text-to-speech/docs/chirp3-hd?hl=fr)  
> 50. Voix et langues compatibles \| Cloud Text-to-Speech, [https\://docs.cloud.google.com/text-to-speech/docs/list-voices-and-types?hl=fr](https://docs.cloud.google.com/text-to-speech/docs/list-voices-and-types?hl=fr)  
> 51. Google Cloud text-to-speech pricing and migration \- Cartesia, [https\://www\.cartesia.ai/migrate/google-cloud-tts](https://www.cartesia.ai/migrate/google-cloud-tts)  
> 52. Review pricing for Text-to-Speech \| Google Cloud, [https\://cloud.google.com/text-to-speech/pricing](https://cloud.google.com/text-to-speech/pricing)  
> 53. Consulter les tarifs de Text-to-Speech \- Google Cloud, [https\://cloud.google.com/text-to-speech/pricing?hl=fr](https://cloud.google.com/text-to-speech/pricing?hl=fr)  
> 54. The 6 best Deepgram alternatives for developers, tested July 2026, [https\://speechify.ai/alternatives/deepgram](https://speechify.ai/alternatives/deepgram)  
> 55. 10 Best TTS for AI Voice Agents That Hold Up in 2026, [https\://www\.cekura.ai/blogs/best-tts-for-ai-voice-agents](https://www.cekura.ai/blogs/best-tts-for-ai-voice-agents)  
> 56. French speech to text transcription API \- Speechmatics, [https\://www\.speechmatics.com/speech-to-text/french](https://www.speechmatics.com/speech-to-text/french)  
> 57. Speech to Text Online: STT Transcription with Scribe \- ElevenLabs, [https\://elevenlabs.io/speech-to-text](https://elevenlabs.io/speech-to-text)  
> 58. License & Pricing \- Remotion, [https\://www\.remotion.dev/docs/license/pricing](https://www.remotion.dev/docs/license/pricing)  
> 59. Remotion \+ FFmpeg Micro: Programmatic Video, No Lambda Bill, [https\://www\.ffmpeg-micro.com/blog/remotion-ffmpeg-micro-serverless-video](https://www.ffmpeg-micro.com/blog/remotion-ffmpeg-micro-serverless-video)  
> 60. How much does Remotion Lambda cost?, [https\://www\.remotion.dev/docs/lambda/cost-example](https://www.remotion.dev/docs/lambda/cost-example)  
> 61. YouTube API Pricing 2026: Quota, Upload Limits, Real Costs, [https\://www\.outstand.so/blog/youtube-api-pricing-quota](https://www.outstand.so/blog/youtube-api-pricing-quota)  
> 62. YouTube Data API Quota in 2026: Search Now Has Its Own 100-a, [https\://sociavault.com/blog/youtube-data-api-quota-2026](https://sociavault.com/blog/youtube-data-api-quota-2026)  
> 63. Search: list \| YouTube Data API \- Google for Developers, [https\://developers.google.com/youtube/data/reference/rest/v3/search/list](https://developers.google.com/youtube/data/reference/rest/v3/search/list)  
> 64. YouTube Data API for AI agents: quota, limits and scrapers, [https\://www\.shortsintel.com/guides/youtube-data-api-for-agents](https://www.shortsintel.com/guides/youtube-data-api-for-agents)  
> 65. Gérer les quotas de l'API YouTube Data v3 \- Code and Cortex, [https\://www\.codeandcortex.fr/quotas-api-youtube-data-v3/](https://www.codeandcortex.fr/quotas-api-youtube-data-v3/)  
> 66. YouTube Search API: How search.list Works, What It Costs, [https\://outlierkit.com/resources/youtube-search-api/](https://outlierkit.com/resources/youtube-search-api/)  
> 67. Best Video Summarizer & YouTube Transcript MCP Servers for AI, [https\://bibigpt.co/zh/blog/posts/video-summarizer-mcp-servers-for-ai-agents](https://bibigpt.co/zh/blog/posts/video-summarizer-mcp-servers-for-ai-agents)  
> 68. What I learned squeezing the YouTube Data API v3 quota for a side, [https\://dev.to/qcrao/what-i-learned-squeezing-the-youtube-data-api-v3-quota-for-a-side-project-3304](https://dev.to/qcrao/what-i-learned-squeezing-the-youtube-data-api-v3-quota-for-a-side-project-3304)  
> 69. Delivering Video Content for Safari \| Apple Developer Documentation, [https\://developer.apple.com/documentation/webkit/delivering-video-content-for-safari](https://developer.apple.com/documentation/webkit/delivering-video-content-for-safari)  
> 70. Youtube Playback Issue on Mobile Safari \- Tenten AI, [https\://university.tenten.co/t/youtube-playback-issue-on-mobile-safari/1473](https://university.tenten.co/t/youtube-playback-issue-on-mobile-safari/1473)  
> 71. Progressive web apps on iPhone in 2026: what is true and what is, [https\://synthetixis.com/writing/pwa-ios-2026](https://synthetixis.com/writing/pwa-ios-2026)  
> 72. Cloudflare R2 Pricing in 2026: Storage, Operations, and Real, [https\://upstash.com/kb/cloudflare-r2-pricing-in-2026-storage-operations-and-real-monthly-bills](https://upstash.com/kb/cloudflare-r2-pricing-in-2026-storage-operations-and-real-monthly-bills)  
> 73. Cloudflare R2 free tier: 10 GB, limits, pricing 2026 \- Nubbo, [https\://nubbo.app/articles/cloudflare-r2-free-tier/](https://nubbo.app/articles/cloudflare-r2-free-tier/)  
> 74. Limits · Cloudflare R2 docs, [https\://developers.cloudflare.com/r2/platform/limits/](https://developers.cloudflare.com/r2/platform/limits/)  
> 75. Cloudflare R2 Pricing 2026: Free Tier Limits, Egress Costs & When, [https\://nayankyada.com/blog/cloudflare-r2-pricing-2026-free-tier-limits-egress-costs-when-to-upgrade](https://nayankyada.com/blog/cloudflare-r2-pricing-2026-free-tier-limits-egress-costs-when-to-upgrade)  
> 76. Limits \- Trigger.dev, [https\://trigger.dev/docs/limits](https://trigger.dev/docs/limits)  
> 77. Trigger.dev Pricing Guide: How Much Do You Actually Pay? \- ZenML, [https\://www\.zenml.io/blog/trigger-dev-pricing](https://www.zenml.io/blog/trigger-dev-pricing)  
> 78. Trigger.dev vs Inngest, [https\://trigger.dev/vs/inngest](https://trigger.dev/vs/inngest)  
> 79. Google Cloud Run Pricing in 2025: A Comprehensive Guide, [https\://cloudchipr.com/blog/cloud-run-pricing](https://cloudchipr.com/blog/cloud-run-pricing)  
> 80. Gemini API Pricing 2026: Models, Tokens, and Costs \- Mem0, [https\://mem0.ai/library/llms-and-models/gemini-api-pricing](https://mem0.ai/library/llms-and-models/gemini-api-pricing)