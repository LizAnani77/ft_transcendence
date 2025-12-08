# Pong CLI — Jouer contre des utilisateurs web

Cette CLI vous permet de vous connecter, voir qui est en ligne, défier des joueurs web et jouer à Pong en temps réel depuis votre terminal.

## Glossaire

- **CLI (Command Line Interface)** : Une interface en ligne de commande qui permet d'interagir avec un programme via du texte dans un terminal, sans interface graphique
- **Terminal** : Une application qui permet d'exécuter des commandes textuelles pour contrôler l'ordinateur ou lancer des programmes
- **Script** : Un fichier contenant une série de commandes qui s'exécutent automatiquement (ici `pong-cli.sh`)

```bash

              P O N G

╔══════════════════════════════════╗
║                                  ║
║  █           ●                   ║
║  █                               ║
║                                  ║
║                                  ║
║                                  ║
║                               █  ║
║                               █  ║
╚══════════════════════════════════╝

```

## Commandes

```bash
./scripts/pong-cli.sh help						# affiche l’aide
./scripts/pong-cli.sh login					# connexion (demande identifiant/mot de passe)
./scripts/pong-cli.sh register					# créer un nouveau compte
./scripts/pong-cli.sh list						# lister les joueurs en ligne
./scripts/pong-cli.sh challenge <username>		# envoyer un défi à un utilisateur
./scripts/pong-cli.sh play						# attendre les défis entrants
./scripts/pong-cli.sh logout					# effacer la session locale
```

Commandes de jeu :
- Flèches Haut/Bas pour se déplacer
- ESC ou Q pour quitter
- Y / N pour accepter ou refuser une invitation
- P pour demander une revanche après la fin d’une partie

### Versions de commandes utilisables

**Avec le script fourni:**
```bash
./scripts/pong-cli.sh help
```

**ou**

**Avec docker compose**:
```bash
docker compose exec -it cli-pong pong-cli help
```

## Configuration

La CLI communique avec le site via le WAF par défaut :
- API : https://localhost:3443
- WebSocket : wss://localhost:3443/ws

```bash
API_URL=https://localhost:3443 WS_URL=wss://localhost:3443/ws pong-cli list
```

### Définitions de configuration

- **WAF (Web Application Firewall)** : Un pare-feu applicatif qui filtre et surveille les requêtes HTTP/WebSocket pour protéger le serveur contre les attaques
- **localhost** : Adresse spéciale (127.0.0.1) qui désigne votre propre machine, utilisée pour le développement local
- **Port** : Un numéro (ici 3443) qui identifie un service spécifique sur un serveur (comme un canal de communication)
- **https/wss** : Versions sécurisées (chiffrées) des protocoles HTTP et WebSocket, avec le "s" pour "secure"
- **Variable d'environnement** : Une valeur (comme `API_URL`) que vous pouvez définir temporairement pour modifier le comportement d'un programme

## Notes

- Jeu multiplateforme : la CLI interopère avec le client web via les mêmes événements WebSocket (presence, challenge, create/join, input, mises à jour d’état).
- Les tokens sont persistés dans un volume nommé `pong_cli_home` (fichier `~/.pong-cli/token.json` dans le conteneur).
- Les jetons d'authentification sont stockés dans ~/.pong-cli/token.json.

### Définitions techniques

- **Interopérabilité** : Capacité de systèmes différents (ici CLI et web) à communiquer et fonctionner ensemble en utilisant les mêmes protocoles
- **Événements WebSocket** : Messages structurés envoyés entre client et serveur via WebSocket (ex: "presence" pour signaler qu'on est en ligne)
- **Token/Jeton** : Une chaîne de caractères sécurisée qui prouve votre identité au serveur sans avoir à renvoyer votre mot de passe à chaque requête
- **Persister** : Sauvegarder des données de manière permanente pour qu'elles survivent après la fermeture du programme
- **Volume (Docker)** : Un espace de stockage géré par Docker qui conserve les données même quand le conteneur est supprimé
- **Conteneur** : Un environnement isolé qui fait tourner une application avec toutes ses dépendances, comme une mini-machine virtuelle légère

## Sécurité de la CLI et du script

- Emplacement du script: conservé dans le dépôt sous `scripts/` et exécuté via `./scripts/pong-cli.sh` — cela évite d'ajouter un binaire global au PATH système et limite la surface d'attaque.
- Permissions recommandées: `chmod 750 scripts/pong-cli.sh` (ou `700` si usage strictement individuel). Assurez‑vous que le dossier `scripts/` n'est pas world‑writable.
- Droits dans le conteneur: le service `cli-pong` tourne sous l'utilisateur non‑root `node` et ne monte qu'un HOME (`/home/node`) pour persister `~/.pong-cli/token.json` via le volume `pong_cli_home`.
- Certificats TLS: la CLI accepte les certificats auto‑signés pour le développement (agent HTTPS avec `rejectUnauthorized: false`). En production, exposez un certificat valide (ou fournissez une AC via `NODE_EXTRA_CA_CERTS`) et n'utilisez pas de certificats auto‑signés.
- Cibles réseau: en mode Docker, la CLI parle au WAF via `https://waf` et `wss://waf/ws`. Hors Docker, utilisez `https://localhost:3443` et `wss://localhost:3443/ws`.

### Définitions de sécurité

- **PATH système** : Une liste de dossiers où l'ordinateur cherche les commandes exécutables (éviter d'y ajouter des scripts limite les risques de sécurité)
- **Surface d'attaque** : L'ensemble des points par lesquels un attaquant pourrait compromettre un système (moins il y en a, mieux c'est)
- **Permissions/chmod** : Règles qui définissent qui peut lire, modifier ou exécuter un fichier (750 = propriétaire peut tout, groupe peut lire/exécuter, autres rien)
- **world-writable** : Un fichier/dossier que n'importe quel utilisateur peut modifier (dangereux car ouvre la porte aux modifications malveillantes)
- **Utilisateur non-root** : Un compte sans privilèges administrateur complets, limitant les dégâts en cas de compromission
- **TLS/Certificat** : Technologie de chiffrement qui sécurise les communications web (le cadenas dans votre navigateur)
- **Certificat auto-signé** : Un certificat créé localement sans validation par une autorité reconnue (acceptable pour le développement, pas pour la production)
- **AC (Autorité de Certification)** : Organisation de confiance qui valide l'identité d'un site web et émet des certificats reconnus
