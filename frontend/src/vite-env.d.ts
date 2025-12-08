
/// <reference types="vite/client" />

/* Définition du type des variables d'environnement accessibles via import.meta.env */
interface ImportMetaEnv {
  readonly VITE_APP_TITLE: string
  readonly VITE_API_URL: string
  readonly VITE_WS_URL: string
  readonly VITE_DEBUG: boolean
  // Ajoutez d'autres variables d'environnement ici
}

/* Définition de l'interface ImportMeta pour inclure ImportMetaEnv */
interface ImportMeta {
  readonly env: ImportMetaEnv
}

/* Déclarations globales pour l'application */
declare global {
  interface Window {
    pongApp: any;
  }
  
  /* Variables définies automatiquement par Vite */
  const __APP_VERSION__: string;
  const __BUILD_TIME__: string;
}
