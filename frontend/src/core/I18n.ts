// I18n.ts — service i18n minimal, sans dépendance externe

type Dict = Record<string, string>;

type Lang = 'en' | 'fr' | 'es';

const SUPPORTED: Lang[] = ['en', 'fr', 'es'];
const STORAGE_KEY = 'lang';

// Helpers auth minimes (pas d'import pour éviter les cycles)
const getToken = (): string | null => {
  try { return sessionStorage.getItem('token') || null; } catch { return null; }
};

const getAuthHeaders = (): HeadersInit => {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  const t = getToken();
  if (t) h['Authorization'] = `Bearer ${t}`;
  return h;
};

export class I18n {
  private static _instance: I18n;
  private dict: Dict = {};
  private current: Lang = 'en';
  private listeners: Array<(lang: Lang) => void> = [];

  static get instance(): I18n {
    if (!I18n._instance) I18n._instance = new I18n();
    return I18n._instance;
  }

  get lang(): Lang { return this.current; }

  /* Détecte la langue via ?lang=, localStorage, navigator */
  detect(): Lang {
    // 1) query ?lang=xx
    try {
      const params = new URLSearchParams(window.location.search);
      const q = (params.get('lang') || '').toLowerCase();
      if (SUPPORTED.includes(q as Lang)) return q as Lang;
    } catch {}

    // 2) localStorage
    const stored = (localStorage.getItem(STORAGE_KEY) || '').toLowerCase();
    if (SUPPORTED.includes(stored as Lang)) return stored as Lang;

    // 3) navigateur
    const nav = (navigator.language || 'en').slice(0, 2).toLowerCase();
    if (SUPPORTED.includes(nav as Lang)) return nav as Lang;

    return 'en';
  }

    /*
   * Charge la langue initiale :
   * - Si user connecté -> GET /api/auth/language
   * - Sinon (ou si pas de langue en BDD) -> détection locale
   * - Si user connecté et pas de langue en BDD -> on pousse la détection locale côté serveur (PUT)
   */
  async loadInitialLanguage(): Promise<Lang> {
    const localDetected = this.detect(); // garde le détecteur existant
    const token = getToken();

    // Pas connecté -> on applique la détection locale et basta
    if (!token) {
      await this.setLang(localDetected);
      return this.current;
    }

    // Connecté : on essaie de lire la préférence serveur
    try {
      const r = await fetch('/api/auth/language', { method: 'GET', headers: getAuthHeaders(), cache: 'no-store' });
      if (r.ok) {
        const j = await r.json().catch(() => ({}));
        const srv = (j?.language || '').toLowerCase();
        if (SUPPORTED.includes(srv as Lang)) {
          await this.setLang(srv as Lang);
          return this.current;
        }
      }
    } catch { /* ignore et fallback */ }

    // Si on arrive ici : pas de langue serveur -> on applique la locale puis on la persiste côté backend
    await this.setLang(localDetected);

    return this.current;
  }

  /* Charge le dictionnaire de la langue demandée */
  async setLang(lang: Lang): Promise<void> {
    if (!SUPPORTED.includes(lang)) lang = 'en';
    if (this.current === lang && Object.keys(this.dict).length > 0) return;

    const tryLoad = async (l: Lang): Promise<Dict | null> => {
      try {
        const res = await fetch(`/locales/${l}.json`, { cache: 'no-store' });
        if (!res.ok) return null;
        return (await res.json()) as Dict;
      } catch {
        return null;
      }
    };

    let used: Lang = lang;
    let dict = await tryLoad(lang);
    if (!dict) {
      console.warn(`[i18n] Failed to load ${lang}, falling back to en`);
      dict = await tryLoad('en');
      used = 'en';
    }
    if (!dict) {
      console.error('[i18n] Failed to load any locale (en fallback failed). Keeping previous dict.');
      return;
    }

    this.dict = dict;
    this.current = used;

    try { localStorage.setItem(STORAGE_KEY, this.current); } catch {}
    document.documentElement.setAttribute('lang', this.current);

    this.listeners.forEach(cb => cb(this.current));

        // Si connecté, on persiste côté serveur (fire-and-forget)
    try {
      const token = getToken();
      if (token) {
        await fetch('/api/auth/language', {
          method: 'PUT',
          headers: getAuthHeaders(),
          body: JSON.stringify({ language: this.current })
        });
      }
    } catch { /* silencieux */ }
  }

  /* Raccourci de traduction */
  t(key: string): string {
    return this.dict[key] ?? key;
  }

  /* Écouteurs pour réagir aux changements de langue */
  onChange(cb: (lang: Lang) => void): () => void {
    this.listeners.push(cb);
    return () => { this.listeners = this.listeners.filter(f => f !== cb); };
  }
}

// Petit helper global si besoin à l'usage
export const i18n = I18n.instance;
