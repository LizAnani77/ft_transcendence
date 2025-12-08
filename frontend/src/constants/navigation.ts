// frontend/src/constants/navigation.ts

import { NavigationItem, AppView } from '../types';
import { i18n } from '../core/I18n';

/* Routes de navigation principales (générées dynamiquement selon la langue) */
export function getNavigationItems(): NavigationItem[] {
  return [
    { path: '/welcome',   label: i18n.t('nav.home'),       requiresAuth: false },
    { path: '/profile',   label: i18n.t('nav.profile'),    requiresAuth: true  },
    { path: '/dashboard', label: i18n.t('nav.dashboard'),  requiresAuth: true  },
    { path: '/friends',   label: i18n.t('nav.friends'),    requiresAuth: true  },
    { path: '/chat',      label: i18n.t('nav.chat'),       requiresAuth: true  },
    { path: '/tournament',label: i18n.t('nav.tournament'), requiresAuth: false },
    { path: '/game',      label: i18n.t('nav.play'),       requiresAuth: false },
  ];
}

/* Vues de l'application (titres localisés à la volée) */
export function getAppViews(): AppView[] {
  return [
    { name: 'home',       path: '/',          title: i18n.t('app.name'),            requiresAuth: false },
    { name: 'welcome',    path: '/welcome',   title: i18n.t('welcome.title'),       requiresAuth: false },
    { name: 'auth',       path: '/auth',      title: i18n.t('auth.title'),          requiresAuth: false },
    { name: 'game',       path: '/game',      title: i18n.t('nav.play'),            requiresAuth: false },
    { name: 'tournament', path: '/tournament',title: i18n.t('nav.tournament'),      requiresAuth: false },
    { name: 'profile',    path: '/profile',   title: i18n.t('nav.profile'),         requiresAuth: true  },
    { name: 'dashboard',  path: '/dashboard', title: i18n.t('nav.dashboard'),       requiresAuth: true  },
    { name: 'friends',    path: '/friends',   title: i18n.t('nav.friends'),         requiresAuth: true  },
    { name: 'chat',       path: '/chat',      title: i18n.t('nav.chat'),            requiresAuth: true  },
    { name: '404',        path: '/404',       title: i18n.t('errors.404.title'),     requiresAuth: false }
  ];
}

/* Routes protégées */
export const PROTECTED_ROUTES = ['/profile', '/dashboard', '/friends', '/chat'];

/* Routes publiques */
export const PUBLIC_ROUTES = ['/', '/welcome', '/auth', '/game', '/tournament'];

/* Route par défaut après connexion */
export const DEFAULT_AUTHENTICATED_ROUTE = '/welcome';

/* Route par défaut pour utilisateur non connecté */
export const DEFAULT_UNAUTHENTICATED_ROUTE = '/welcome';

/* Constantes représentant les routes de l'application */
export const ROUTES = {
  HOME: '/', 
  WELCOME: '/welcome', 
  AUTH: '/auth', 
  GAME: '/game', 
  TOURNAMENT: '/tournament', 
  PROFILE: '/profile', 
  DASHBOARD: '/dashboard',
  CHAT: '/chat'
} as const;

/* Thème global : couleurs et effets visuels */
export const THEME = {
  colors: { 
    primary: '#040011ff', 
    secondary: '#ffffff', 
    success: '#064c48ff', 
    error: '#c6209d', 
    warning: '#f59e0b', 
    info: '#4e23f8' 
  },
  effects: { 
    textShadow: '0 0 5px #ffffff, 0 0 10px #ffffff', 
    glowStrong: '0 0 10px #ffffff, 0 0 20px #ffffff, 0 0 30px #ffffff', 
    boxShadow: '0 4px 15px rgba(255, 255, 255, 0.3)' 
  }
} as const;
