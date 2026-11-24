/**
 * Métriques de texte des schémas générés, partagées par la mise en page
 * (serveur, elkjs) et le rendu SVG (client) : le découpage en lignes est
 * recalculé à l'identique des deux côtés, sans mesure DOM.
 */

/** Taille de police des libellés de nœuds, en unités du viewBox. */
export const NODE_FONT = 15;
export const NODE_LINE_HEIGHT = 19;
/** Largeur moyenne d'un caractère (≈ 0,56 em en sans-serif gras), avec marge. */
export const CHAR_WIDTH = 8.6;
export const NODE_PAD_X = 14;
export const NODE_PAD_Y = 10;
export const NODE_MIN_WIDTH = 84;
/** Caractères par ligne au plus dans un nœud (40 caractères = 3 lignes). */
export const NODE_MAX_CHARS = 16;

export const EDGE_FONT = 12;
export const EDGE_CHAR_WIDTH = 6.9;
export const EDGE_LABEL_HEIGHT = 18;
export const EDGE_LABEL_PAD_X = 6;

export const TITLE_FONT = 17;
export const TITLE_HEIGHT = 30;

/**
 * Découpe un libellé en lignes d'au plus `maxChars` caractères, aux espaces
 * (un mot plus long est coupé net). Déterministe et sans dépendance.
 */
export function wrapLabel(label: string, maxChars = NODE_MAX_CHARS): string[] {
  const lines: string[] = [];
  let line = "";
  for (const raw of label.trim().split(/\s+/).filter(Boolean)) {
    let word = raw;
    while (word.length > maxChars) {
      if (line) {
        lines.push(line);
        line = "";
      }
      lines.push(word.slice(0, maxChars));
      word = word.slice(maxChars);
    }
    if (!word) continue;
    if (!line) line = word;
    else if (line.length + 1 + word.length <= maxChars) line += ` ${word}`;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

/** Dimensions de la boîte d'un nœud (unités du viewBox). */
export function nodeSize(label: string): { w: number; h: number } {
  const lines = wrapLabel(label);
  const longest = Math.max(...lines.map((l) => l.length));
  return {
    w: Math.max(NODE_MIN_WIDTH, Math.ceil(longest * CHAR_WIDTH + 2 * NODE_PAD_X)),
    h: lines.length * NODE_LINE_HEIGHT + 2 * NODE_PAD_Y,
  };
}

/** Dimensions de l'étiquette d'un lien (une ligne). */
export function edgeLabelSize(label: string): { w: number; h: number } {
  return { w: Math.ceil(label.length * EDGE_CHAR_WIDTH + 2 * EDGE_LABEL_PAD_X), h: EDGE_LABEL_HEIGHT };
}

export const edgeKey = (from: string, to: string) => `${from}->${to}`;
