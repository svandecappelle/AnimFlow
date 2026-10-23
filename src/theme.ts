/**
 * Thème de l'interface : clair, sombre, ou celui du système. Réglage propre au navigateur (pas au schéma).
 * Appliqué via `data-theme` sur <html> ; en sombre, le schéma est affiché inversé (voir styles.css).
 */
export type ThemePref = 'light' | 'dark' | 'system';

const KEY = 'animflow:theme';
const media = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

export function loadThemePref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'light' || v === 'dark' || v === 'system') return v;
  } catch {
    // stockage indisponible
  }
  return 'system';
}

export const resolveTheme = (pref: ThemePref): 'light' | 'dark' => (pref === 'system' ? (media?.matches ? 'dark' : 'light') : pref);

/** Applique le thème à un document (la fenêtre principale, ou la vue présentateur). */
export function applyTheme(pref: ThemePref, doc: Document = document) {
  doc.documentElement.dataset.theme = resolveTheme(pref);
}

export function saveThemePref(pref: ThemePref) {
  try {
    localStorage.setItem(KEY, pref);
  } catch {
    // sans importance
  }
}

/** Suit les changements du réglage système (utile en mode « Système »). */
export function onSystemThemeChange(cb: () => void): () => void {
  media?.addEventListener('change', cb);
  return () => media?.removeEventListener('change', cb);
}
