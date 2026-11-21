# Résultats de la phase S — stack « quasi tout Google »

## Question de décision

> **Le tout-Google (Gemini Vision + YouTube + Google Neural2 + SSML `<mark>`) est-il suffisant en qualité et fiabilité, ou faut-il réintroduire Scribe / Mistral ?**

Réponse provisoire (13/11/2026) : **tout-Google suffisant pour S.1 et S.3 → Scribe n'est PAS réintroduit.** Mistral : en attente de S.2 (PDF à fournir). S.4 : en attente du test sur iPhone.

Règle : un repli n'est réintroduit **que** si un critère d'échec ci-dessous est atteint sur au moins 2 essais.

---

## S.1 — Gemini, vidéo agentique YouTube ✅

Essai : cours FR « La chaîne respiratoire » (D. Garcia), `Ul9W-CvCRYA`.

| Mesure | Hydrogen | 3.8 Flash | Seuil d'échec |
|---|---|---|---|
| `media_processing="AGENTIC"` accepté | ✅ (voir les 2 contraintes ci-dessous) | ✅ | erreur API = échec |
| Tokens en entrée (dont `tool_use_prompt_tokens`) | 18 k – 34 k | 34 k | > 100 000 |
| Segment trouvé (concept : pompage de protons par les complexes I, III, IV) | 742 → 824 s (3 essais : 742-824, 742-824, 742-825) | 742 → 825 s | 2 essais sur 3 faux |
| Concept absent (ATP synthase, traitée dans la vidéo suivante) | `found=false` correct | `found=false` correct | faux positif = échec |
| Latence | 12 – 17 s | 17 – 38 s | > 5 min |
| Coût par vidéo | 0,04 – 0,07 $ | 0,03 – 0,04 $ (promo) | — |

**Contraintes découvertes (à reporter dans le code de production) :**
1. Le mode agentique exige l'API **`v1beta`** (`HttpOptions(api_version="v1beta")`) : erreur 400 en `v1`.
2. `mime_type` est **obligatoire** dès que `media_processing` est renseigné (`video/*` suffit pour une URL YouTube).
3. Les tokens vidéo sont comptés dans `tool_use_prompt_token_count`, pas dans `prompt_token_count` : à additionner dans `ai_usage`.
4. La réflexion (`thoughts`) pèse jusqu'à 6 000 tokens de sortie en `medium` : c'est le premier poste de coût. Essayer `thinking_level: "low"` en phase 4.

À vérifier à la main : ouvrir https://www.youtube.com/watch?v=Ul9W-CvCRYA&t=742s et confirmer que l'extrait est autonome.
**Décision** : Hydrogen (plus rapide, plus stable) ; 3.8 Flash acceptable jusqu'au 31/12/2026.

## S.2 — Gemini Vision + découpe PyMuPDF (sans Mistral) ⏳ PDF à fournir
| Mesure (`metrics.json`) | Valeur | Seuil d'échec → repli Mistral OCR |
|---|---|---|
| `cut_text_ratio` (découpes coupant un texte) | | > 0,10 |
| `missed_visual_ratio` (zones visuelles non couvertes) | | > 0,15 (à confirmer à l'œil) |
| `invalid_box_ratio` | | > 0,05 |
| Contrôle visuel `review.html` : schémas nets, légendes entières | | > 1 schéma inutilisable sur 10 |
| `cost_per_1000_pages_usd` | | > 4 $ (au-delà, Mistral Batch à 2 $ devient moins cher) |

À essayer avant le repli : `--margin 0.06`, ou `--model gemini-3.8-flash`.
**Décision** : `PDF_EXTRACTOR=gemini` ☐ / `mistral` ☐

## S.3 — Google Cloud TTS Neural2 + `<mark>` (v1beta1) ✅

| Mesure (`report.json`) | Neural2-F | Neural2-G | Seuil d'échec |
|---|---|---|---|
| Authentification | compte de service ✅ (clé API non testée) | idem | — |
| `mark_coverage_pct` (6 synthèses) | 100 % | 100 % | < 98 % |
| `monotonic` | ✅ | ✅ | false |
| `duration_delta_pct` (avec vs sans marks) | −1,3 à +0,9 % | −1,3 à +0,9 % | > 3 % |
| `words_under_50ms` | 0 | 1 | > 2 |
| Latence par requête (environ 25 s d'audio) | ~1,3 s | ~1,3 s | — |
| Prononciation, variante `raw` (texte brut) | 7 à 10 / 11 | 7 à 9 / 11 | → texte brut **insuffisant** (5', 3', °C, 10⁻⁶ mol/L) |
| Prononciation, variante `spoken` | **11/11** | **11/11** | — |
| Prononciation, variante `sub` (`<sub alias>`) | **11/11** (×3 contrôles) | **11/11** | — |
| `mark_every_4.mae_ms` (interpolation) | 100 – 257 ms | 94 – 246 ms | > 60 ms → **échec : une mark par mot obligatoire** |
| Octets SSML pour ~55 mots (`sub` avec marks / sans) | 1 665 / 774 | idem | contrôler la facturation réelle dans *Billing → Reports* |

Prononciation contrôlée automatiquement par Gemini (`s3b_pronunciation_check.py`, ~0,01 $). Ce juge est un peu bruité sur `raw` (7 à 10/11 selon les passes) mais stable sur `spoken` et `sub`. **À confirmer à l'oreille** dans `out/s3/player.html`, y compris le calage à 1,25x.

**Règles SSML `<sub>` découvertes (indispensables) :**
1. Ponctuation finale **hors** de l'alias : `<sub alias="trois prime">3'</sub>.` (sinon Neural2 épelle l'alias lettre par lettre).
2. Élision **dans** l'alias : `<sub alias="l'a té pé">l'ATP</sub>` (sinon la voix dit « l apostrophe »).

**Décision** : Neural2 (F ou G au choix à l'oreille) + **variante `sub`** + **une mark par mot affiché**.
- Le LLM produit directement du texte annoté `[ATP|a té pé]`, converti en SSML `<sub>` : les timestamps tombent sur les mots affichés, donc `mapSpokenTimingsToDisplayWords()` devient inutile.
- Scribe : non réintroduit.
- Coût à surveiller : les marks doublent environ les octets SSML ; il faut vérifier si elles sont facturées.

## S.4 — Audio iOS ⏳ test sur iPhone à faire
- Appareil / version d'iOS :
- `<audio>` partagé après swipe : ☐
- YouTube avec le son après swipe, sans tap : ☐ (sinon le bouton de repli fonctionne : ☐)
- Pas de plein écran forcé : ☐   En mode PWA installée : ☐
- **Décision** :

### Déjà observé sur ordinateur (Chrome, 13/11/2026)
- Déverrouillage, `<audio>` après swipe et YouTube avec le son (`état=1`, `muet=false`) : OK. Cela ne dit rien d'iOS.
