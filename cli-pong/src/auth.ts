// cli-pong/src/auth.ts

import axios from 'axios';
import https from 'https';
import fs from 'fs';
import path from 'path';
import { homedir } from 'os';

const CONFIG_DIR = path.join(homedir(), '.pong-cli');
const TOKEN_FILE = path.join(CONFIG_DIR, 'token.json');

// Configuration pour accepter les certificats auto-signés
const httpsAgent = new https.Agent({
  rejectUnauthorized: false
});

interface AuthTokens {
  token: string;
  userId: number;
  username: string;
}

export class AuthService {
  private baseUrl: string;

  constructor(baseUrl: string = 'http://127.0.0.1:8080') {
    this.baseUrl = baseUrl;
  }

  /* Authentifie l'utilisateur avec ses identifiants et retourne les tokens d'authentification. */
  async login(username: string, password: string): Promise<AuthTokens> {
    try {
      const response = await axios.post(`${this.baseUrl}/api/auth/login`, {
        username,
        password
      }, { httpsAgent });

      if (response.data.requires_2fa) {
        throw {
          requires2FA: true,
          tempToken: response.data.temp_token
        };
      }

      if (!response.data.success || !response.data.token) {
        throw new Error(response.data.message || 'Login failed');
      }

      const tokens: AuthTokens = {
        token: response.data.token,
        userId: response.data.user.id,
        username: response.data.user.username
      };

      this.saveTokens(tokens);
      return tokens;
    } catch (error: any) {
      if (error.requires2FA) {
        throw error;
      }
      if (error.response?.data?.message) {
        throw new Error(error.response.data.message);
      }
      throw error;
    }
  }

  /* Vérifie le code 2FA et retourne les tokens d'authentification finaux. */
  async verify2FA(tempToken: string, code: string): Promise<AuthTokens> {
    try {
      const response = await axios.post(`${this.baseUrl}/api/auth/login/2fa`, {
        temp_token: tempToken,
        code: code
      }, { httpsAgent });

      if (!response.data.success || !response.data.token) {
        throw new Error(response.data.message || '2FA verification failed');
      }

      const tokens: AuthTokens = {
        token: response.data.token,
        userId: response.data.user.id,
        username: response.data.user.username
      };

      this.saveTokens(tokens);
      return tokens;
    } catch (error: any) {
      if (error.response?.data?.message) {
        throw new Error(error.response.data.message);
      }
      throw error;
    }
  }

  /* Crée un nouveau compte utilisateur et retourne les tokens d'authentification. */
  async register(username: string, password: string): Promise<AuthTokens> {
    try {
      const response = await axios.post(`${this.baseUrl}/api/auth/register`, {
        username,
        password
      }, { httpsAgent });

      if (!response.data.success || !response.data.token) {
        throw new Error(response.data.message || 'Registration failed');
      }

      const tokens: AuthTokens = {
        token: response.data.token,
        userId: response.data.user.id,
        username: response.data.user.username
      };

      this.saveTokens(tokens);
      return tokens;
    } catch (error: any) {
      if (error.response?.data?.message) {
        throw new Error(error.response.data.message);
      }
      throw error;
    }
  }

  /* Récupère les tokens d'authentification sauvegardés localement. */
  getStoredTokens(): AuthTokens | null {
    try {
      if (!fs.existsSync(TOKEN_FILE)) {
        return null;
      }
      const data = fs.readFileSync(TOKEN_FILE, 'utf-8');
      return JSON.parse(data);
    } catch {
      return null;
    }
  }

  /* Sauvegarde les tokens d'authentification dans un fichier local. */
  saveTokens(tokens: AuthTokens): void {
    if (!fs.existsSync(CONFIG_DIR)) {
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
    }
    fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokens, null, 2));
  }

  /* Supprime les tokens d'authentification sauvegardés localement. */
  clearTokens(): void {
    if (fs.existsSync(TOKEN_FILE)) {
      fs.unlinkSync(TOKEN_FILE);
    }
  }

  /* Vérifie si l'utilisateur possède des tokens d'authentification valides. */
  isAuthenticated(): boolean {
    return this.getStoredTokens() !== null;
  }
}