#!/usr/bin/env node
// cli-pong/src/cli.ts

import { AuthService } from './auth.js';
import { WebSocketService } from './websocket.js';
import { PongGame } from './game.js';
import * as readline from 'readline';

// Utiliser le WAF sur le port 3443 au lieu du backend directement
const API_URL = process.env.API_URL || 'https://localhost:3443';
const WS_URL = process.env.WS_URL || 'wss://localhost:3443/ws';

const authService = new AuthService(API_URL);

/* Affiche une question à l'utilisateur et retourne sa réponse. */
function askQuestion(query: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise(resolve => {
    rl.question(query, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

/* Demande un mot de passe à l'utilisateur en masquant la saisie avec des astérisques. */
async function askPassword(query: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise(resolve => {
    process.stdout.write(query);
    process.stdin.setRawMode(true);
    let password = '';
    
    process.stdin.on('data', (char) => {
      const str = char.toString('utf8');
      
      if (str === '\r' || str === '\n') {
        process.stdin.setRawMode(false);
        process.stdout.write('\n');
        rl.close();
        resolve(password);
      } else if (str === '\u0003') {
        process.exit();
      } else if (str === '\u007f') {
        password = password.slice(0, -1);
        process.stdout.write('\b \b');
      } else {
        password += str;
        process.stdout.write('*');
      }
    });
  });
}


/* Authentifie l'utilisateur avec ses identifiants et sauvegarde la session. */
async function login(): Promise<void> {
  console.log('\n=== Login to Pong CLI ===\n');
  
  const username = await askQuestion('Username: ');
  const password = await askPassword('Password: ');

  try {
    const tokens = await authService.login(username, password);
    console.log(`\n✓ Successfully logged in as ${tokens.username}!`);
    console.log('You can now use: pong-cli list, pong-cli challenge <user>, pong-cli play\n');
  } catch (error: any) {
    if (error.requires2FA) {
      const code = await askQuestion('Enter your 2FA code: ');
      try {
        const tokens = await authService.verify2FA(error.tempToken, code);
        console.log(`\n✓ Successfully logged in as ${tokens.username}!`);
        console.log('You can now use: pong-cli list, pong-cli challenge <user>, pong-cli play\n');
      } catch (verifyError: any) {
        console.error(`\n✗ 2FA verification failed: ${verifyError.message}\n`);
        process.exit(1);
      }
    } else {
      console.error(`\n✗ Login failed: ${error.message}\n`);
      process.exit(1);
    }
  }
}

/* Crée un nouveau compte utilisateur et sauvegarde la session. */
async function register(): Promise<void> {
  console.log('\n=== Register for Pong CLI ===\n');
  
  const username = await askQuestion('Username: ');
  const password = await askPassword('Password: ');

  try {
    const tokens = await authService.register(username, password);
    console.log(`\n✓ Successfully registered as ${tokens.username}!`);
    console.log('You can now use: pong-cli list, pong-cli challenge <user>, pong-cli play\n');
  } catch (error: any) {
    console.error(`\n✗ Registration failed: ${error.message}\n`);
    process.exit(1);
  }
}

/* Affiche la liste des joueurs actuellement en ligne sur le serveur. */
async function listOnlinePlayers(): Promise<void> {
  const tokens = authService.getStoredTokens();
  
  if (!tokens) {
    console.error('✗ Not logged in. Please use: pong-cli login\n');
    process.exit(1);
  }

  console.log(`\n👥 Fetching online players...\n`);

  try {
    const ws = new WebSocketService(WS_URL, tokens.token);
    await ws.connect();

    ws.on('presence:list', (type, data) => {
      const users = data.users || [];
      console.log('\n=== Online Players ===\n');
      
      if (users.length === 0) {
        console.log('No other players online.');
      } else {
        users.forEach((user: any, index: number) => {
          if (user.id !== tokens.userId) {
            console.log(`${index + 1}. ${user.username} (ID: ${user.id})`);
          }
        });
      }
      
      console.log('\nUse: pong-cli challenge <username> to invite someone\n');
      ws.disconnect();
      process.exit(0);
    });

    // Timeout après 5 secondes
    setTimeout(() => {
      console.log('\n✗ Timeout: No response from server\n');
      ws.disconnect();
      process.exit(1);
    }, 5000);

  } catch (error: any) {
    console.error(`✗ Connection failed: ${error.message}\n`);
    process.exit(1);
  }
}

/* Envoie un défi de jeu à un joueur spécifique par son nom d'utilisateur. */
async function challengePlayer(targetUsername?: string): Promise<void> {
  const tokens = authService.getStoredTokens();
  
  if (!tokens) {
    console.error('✗ Not logged in. Please use: pong-cli login\n');
    process.exit(1);
  }

  if (!targetUsername) {
    console.error('✗ Usage: pong-cli challenge <username>\n');
    process.exit(1);
  }

  console.log(`\n🎮 Connecting to game server as ${tokens.username}...\n`);

  try {
    const ws = new WebSocketService(WS_URL, tokens.token);
    await ws.connect();

    const game = new PongGame(ws, tokens.userId, tokens.username);
    
    // Attendre la liste des joueurs avant d'envoyer le challenge
    await game.waitForPlayerList();
    game.challengeByUsername(targetUsername);

    // Handle Ctrl+C gracefully
    process.on('SIGINT', () => {
      game.cleanup();
      process.exit(0);
    });

  } catch (error: any) {
    console.error(`✗ Connection failed: ${error.message}\n`);
    process.exit(1);
  }
}

/* Met le joueur en mode attente pour recevoir des défis d'autres joueurs. */
async function play(): Promise<void> {
  const tokens = authService.getStoredTokens();
  
  if (!tokens) {
    console.error('✗ Not logged in. Please use: pong-cli login\n');
    process.exit(1);
  }

  console.log(`\n🎮 Connecting to game server as ${tokens.username}...\n`);

  try {
    const ws = new WebSocketService(WS_URL, tokens.token);
    await ws.connect();

    const game = new PongGame(ws, tokens.userId, tokens.username);
    game.waitForChallenge();

    // Handle Ctrl+C gracefully
    process.on('SIGINT', () => {
      game.cleanup();
      process.exit(0);
    });

  } catch (error: any) {
    console.error(`✗ Connection failed: ${error.message}\n`);
    process.exit(1);
  }
}

/* Déconnecte l'utilisateur et supprime ses tokens d'authentification. */
function logout(): void {
  authService.clearTokens();
  console.log('✓ Logged out successfully\n');
}

/* Affiche le menu d'aide avec toutes les commandes disponibles. */
function showHelp(): void {
  console.log(`
╔════════════════════════════════════════════════════════╗
║              PONG CLI - Command Line Pong              ║
╚════════════════════════════════════════════════════════╝

Commands:
  ./scripts/pong-cli.sh login                - Login to your account
  ./scripts/pong-cli.sh register             - Create a new account
  ./scripts/pong-cli.sh list                 - List online players
  ./scripts/pong-cli.sh challenge <username> - Challenge a player
  ./scripts/pong-cli.sh play                 - Wait for challenges
  ./scripts/pong-cli.sh logout               - Logout from your account
  ./scripts/pong-cli.sh help                 - Show this help message

Game Controls:
  ↑ / ↓               - Move paddle up/down
  ESC or Q            - Quit game
  Y                   - Accept challenge
  N                   - Decline challenge
  P                   - Rematch (after game ends)

Typical workflow:
  1. ./scripts/pong-cli.sh login
  2. ./scripts/pong-cli.sh list             # See who's online
  3. ./scripts/pong-cli.sh challenge bob    # Challenge bob
  OR
  3. ./scripts/pong-cli.sh play             # Wait for challenges

Note: You can play against web users in real-time!
`);
}

/* Point d'entrée principal de l'application qui analyse les arguments et exécute la commande appropriée. */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case 'login':
      await login();
      break;
    case 'register':
      await register();
      break;
    case 'list':
      await listOnlinePlayers();
      break;
    case 'challenge':
      await challengePlayer(args[1]);
      break;
    case 'play':
      await play();
      break;
    case 'logout':
      logout();
      break;
    case 'help':
    case undefined:
      showHelp();
      break;
    default:
      console.error(`Unknown command: ${command}`);
      showHelp();
      process.exit(1);
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
