#!/usr/bin/env node

/*
  CLI pour interagir avec l'API du serveur Pong
  Usage: node pong-cli.js <commande> [options]
 */

// Pour le développement : ignorer les certificats SSL auto-signés
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

// Essayer plusieurs URLs possibles
const POSSIBLE_URLS = [
  process.env.API_URL,
  'https://localhost:3443/api/games',  // HTTPS pour le port 3443
  'http://localhost:3000/api/games',
  'https://127.0.0.1:3443/api/games',
  'http://127.0.0.1:3000/api/games'
].filter(Boolean);

let API_BASE_URL = POSSIBLE_URLS[0];

// Couleurs pour le terminal
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

const log = {
  success: (msg) => console.log(`${colors.green}✓${colors.reset} ${msg}`),
  error: (msg) => console.log(`${colors.red}✗${colors.reset} ${msg}`),
  info: (msg) => console.log(`${colors.blue}ℹ${colors.reset} ${msg}`),
  warn: (msg) => console.log(`${colors.yellow}⚠${colors.reset} ${msg}`)
};

// Helper pour faire des requêtes HTTP
async function apiRequest(endpoint, method = 'GET', body = null) {
  const url = `${API_BASE_URL}${endpoint}`;
  const options = {
    method,
    headers: { 'Content-Type': 'application/json' }
  };
  
  if (body) {
    options.body = JSON.stringify(body);
  }

  try {
    const response = await fetch(url, options);
    const contentType = response.headers.get('content-type');
    
    // Vérifier si on reçoit bien du JSON
    if (!contentType || !contentType.includes('application/json')) {
      throw new Error(`Server returned ${contentType || 'non-JSON'} instead of JSON. Is the server running?`);
    }
    
    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.error || `HTTP ${response.status}`);
    }
    
    return data;
  } catch (error) {
    if (error.message.includes('fetch failed') || error.message.includes('ECONNREFUSED')) {
      log.error(`Cannot connect to server at ${API_BASE_URL}`);
      log.info('Make sure your backend server is running (npm run dev)');
      log.info('Or set the correct URL: API_URL=http://localhost:PORT/api/games node pong-cli.js status');
    } else {
      log.error(`Request failed: ${error.message}`);
    }
    process.exit(1);
  }
}

// Tester la connexion au serveur
async function testConnection() {
  for (const url of POSSIBLE_URLS) {
    try {
      API_BASE_URL = url;
      const response = await fetch(`${url}/status`, { method: 'GET' });
      if (response.ok) {
        return true; // Connexion réussie
      }
    } catch (e) {
      continue; // Essayer l'URL suivante
    }
  }
  
  log.error('Cannot connect to game server on any known port');
  log.info('Tried URLs:');
  POSSIBLE_URLS.forEach(url => console.log(`  • ${url}`));
  log.info('\nMake sure your backend server is running:');
  console.log('  cd backend && npm run dev');
  log.info('\nOr specify the URL manually:');
  console.log('  API_URL=http://localhost:YOUR_PORT/api/games node pong-cli.js status');
  process.exit(1);
}

// ============ COMMANDES ============

async function cmdStatus() {
  log.info('Checking game server status...\n');
  const data = await apiRequest('/status');
  
  log.success(`Status: ${data.status}`);
  console.log(`${colors.cyan}Timestamp:${colors.reset} ${data.timestamp}`);
  console.log(`\n${colors.cyan}Available endpoints:${colors.reset}`);
  data.endpoints.forEach(ep => console.log(`  • ${ep}`));
}

async function cmdMatchInfo(tournamentId, matchId) {
  if (!tournamentId || !matchId) {
    log.error('Usage: match-info <tournamentId> <matchId>');
    process.exit(1);
  }

  log.info(`Fetching match info for tournament ${tournamentId}, match ${matchId}...\n`);
  const data = await apiRequest(`/tournament-match/${tournamentId}/${matchId}`);
  
  const match = data.match;
  
  console.log(`${colors.cyan}Tournament:${colors.reset} ${match.tournamentName || 'N/A'} (ID: ${match.tournamentId})`);
  console.log(`${colors.cyan}Match ID:${colors.reset} ${match.id}`);
  console.log(`${colors.cyan}Round:${colors.reset} ${match.round}`);
  console.log(`${colors.cyan}Status:${colors.reset} ${match.status}`);
  console.log();
  
  console.log(`${colors.cyan}Players:${colors.reset}`);
  console.log(`  Player 1: ${match.player1.name} (ID: ${match.player1.id})`);
  console.log(`  Player 2: ${match.player2.name} (ID: ${match.player2.id})`);
  
  if (match.status === 'finished') {
    console.log();
    console.log(`${colors.cyan}Result:${colors.reset}`);
    console.log(`  Score: ${match.score1} - ${match.score2}`);
    if (match.winner) {
      log.success(`Winner: ${match.winner.name} (ID: ${match.winner.id})`);
    }
  }
}

async function cmdStartMatch(tournamentId, matchId) {
  if (!tournamentId || !matchId) {
    log.error('Usage: start-match <tournamentId> <matchId>');
    process.exit(1);
  }

  log.info(`Starting match ${matchId} in tournament ${tournamentId}...\n`);
  const data = await apiRequest('/tournament-match/start', 'POST', {
    tournamentId: parseInt(tournamentId),
    matchId: parseInt(matchId)
  });
  
  if (data.success) {
    log.success(data.message);
    const match = data.match;
    console.log(`\n${colors.cyan}Match Details:${colors.reset}`);
    console.log(`  ${match.player1.name} vs ${match.player2.name}`);
    console.log(`  Round: ${match.round}`);
    console.log(`  Status: ${match.status}`);
  }
}

async function cmdReportResult(tournamentId, matchId, winnerId, score1, score2) {
  if (!tournamentId || !matchId || !winnerId || score1 === undefined || score2 === undefined) {
    log.error('Usage: report-result <tournamentId> <matchId> <winnerId> <score1> <score2>');
    process.exit(1);
  }

  log.info(`Reporting result for match ${matchId}...\n`);
  const data = await apiRequest('/tournament-match/report', 'POST', {
    tournamentId: parseInt(tournamentId),
    matchId: parseInt(matchId),
    winnerId: parseInt(winnerId),
    score1: parseInt(score1),
    score2: parseInt(score2)
  });
  
  if (data.success) {
    log.success(data.message);
    console.log(`\n${colors.cyan}Result:${colors.reset} ${score1} - ${score2}`);
    console.log(`${colors.cyan}Winner ID:${colors.reset} ${winnerId}`);
  }
}

async function cmdCleanup() {
  log.info('Running server cleanup...\n');
  const data = await apiRequest('/cleanup', 'POST');
  
  if (data.success) {
    log.success(data.message);
  }
}

// ============ HELP ============

function showHelp() {
  console.log(`
${colors.cyan}Pong Game CLI${colors.reset}
Command-line interface for the Pong game server API

${colors.yellow}USAGE:${colors.reset}
  node pong-cli.js <command> [options]

${colors.yellow}COMMANDS:${colors.reset}
  ${colors.green}status${colors.reset}
    Check game server status and available endpoints

  ${colors.green}match-info${colors.reset} <tournamentId> <matchId>
    Get detailed information about a specific match
    Example: node pong-cli.js match-info 5 12

  ${colors.green}start-match${colors.reset} <tournamentId> <matchId>
    Start a tournament match
    Example: node pong-cli.js start-match 5 12

  ${colors.green}report-result${colors.reset} <tournamentId> <matchId> <winnerId> <score1> <score2>
    Report the result of a finished match
    Example: node pong-cli.js report-result 5 12 42 5 3

  ${colors.green}cleanup${colors.reset}
    Clean up old/abandoned tournaments and matches

  ${colors.green}help${colors.reset}
    Show this help message

${colors.yellow}ENVIRONMENT:${colors.reset}
  API_URL    Base URL for the API (default: http://localhost:3443/api/games)
  
${colors.yellow}EXAMPLES:${colors.reset}
  # Check server status
  node pong-cli.js status

  # Get match information
  node pong-cli.js match-info 5 12

  # Start a match
  node pong-cli.js start-match 5 12

  # Report match result (winner ID 42, score 5-3)
  node pong-cli.js report-result 5 12 42 5 3

  # Use custom API URL
  API_URL=http://production-server:3443/api/games node pong-cli.js status
`);
}

// ============ MAIN ============

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === 'help' || command === '--help' || command === '-h') {
    showHelp();
    return;
  }

  // Tester la connexion au serveur avant d'exécuter les commandes
  await testConnection();

  try {
    switch (command) {
      case 'status':
        await cmdStatus();
        break;
      
      case 'match-info':
        await cmdMatchInfo(args[1], args[2]);
        break;
      
      case 'start-match':
        await cmdStartMatch(args[1], args[2]);
        break;
      
      case 'report-result':
        await cmdReportResult(args[1], args[2], args[3], args[4], args[5]);
        break;
      
      case 'cleanup':
        await cmdCleanup();
        break;
      
      default:
        log.error(`Unknown command: ${command}`);
        console.log('Run "node pong-cli.js help" for usage information');
        process.exit(1);
    }
  } catch (error) {
    log.error(`Command failed: ${error.message}`);
    process.exit(1);
  }
}

main();