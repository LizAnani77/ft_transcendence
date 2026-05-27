#!/bin/bash

# Script de consultation de la base de données SQLite
# Usage: ./scripts/db-query.sh [commande]

set -e

# Couleurs pour l'affichage
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

CONTAINER_NAME="ft_transcendence_backend"
DB_PATH="/app/database/pong.db"

# Fonction pour exécuter une requête SQL
execute_query() {
    local query="$1"
    docker exec -i ${CONTAINER_NAME} sqlite3 ${DB_PATH} <<EOF
.headers on
.mode column
${query}
EOF
}

# Fonction pour exécuter une requête SQL en mode table
execute_query_table() {
    local query="$1"
    docker exec -i ${CONTAINER_NAME} sqlite3 ${DB_PATH} <<EOF
.headers on
.mode table
${query}
EOF
}

# Fonction pour afficher le menu
show_menu() {
    echo -e "${BLUE}========================================${NC}"
    echo -e "${BLUE}  Script de consultation de la DB${NC}"
    echo -e "${BLUE}========================================${NC}"
    echo ""
    echo -e "${GREEN}Commandes disponibles:${NC}"
    echo ""
    echo -e "  ${YELLOW}users${NC}          - Afficher tous les utilisateurs"
    echo -e "  ${YELLOW}user <id>${NC}      - Afficher un utilisateur spécifique"
    echo -e "  ${YELLOW}online${NC}         - Afficher les utilisateurs en ligne"
    echo -e "  ${YELLOW}games${NC}          - Afficher tous les matchs"
    echo -e "  ${YELLOW}game <id>${NC}      - Afficher un match spécifique"
    echo -e "  ${YELLOW}stats <id>${NC}     - Afficher les stats d'un utilisateur"
    echo -e "  ${YELLOW}leaderboard${NC}    - Afficher le classement ELO"
    echo -e "  ${YELLOW}tournaments${NC}    - Afficher tous les tournois"
    echo -e "  ${YELLOW}tournament <id>${NC} - Afficher un tournoi spécifique"
    echo -e "  ${YELLOW}friends <id>${NC}   - Afficher les amis d'un utilisateur"
    echo -e "  ${YELLOW}chat${NC}           - Afficher les messages du chat global"
    echo -e "  ${YELLOW}messages <id>${NC}  - Afficher les messages d'une conversation"
    echo -e "  ${YELLOW}notifications <id>${NC} - Afficher les notifications d'un utilisateur"
    echo -e "  ${YELLOW}challenges${NC}     - Afficher les défis en cours"
    echo -e "  ${YELLOW}tables${NC}         - Lister toutes les tables"
    echo -e "  ${YELLOW}schema <table>${NC} - Afficher le schéma d'une table"
    echo -e "  ${YELLOW}count${NC}          - Compter les entrées dans chaque table"
    echo -e "  ${YELLOW}sql <query>${NC}    - Exécuter une requête SQL personnalisée"
    echo -e "  ${YELLOW}interactive${NC}    - Mode interactif SQLite"
    echo -e "  ${YELLOW}backup${NC}         - Sauvegarder la base de données"
    echo -e "  ${YELLOW}all${NC}            - Exécuter toutes les commandes de consultation"
    echo -e "  ${YELLOW}menu${NC}           - Menu interactif"
    echo -e "  ${YELLOW}help${NC}           - Afficher ce menu"
    echo ""
}

# Vérifier si le conteneur est en cours d'exécution
check_container() {
    if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
        echo -e "${RED}Erreur: Le conteneur ${CONTAINER_NAME} n'est pas en cours d'exécution${NC}"
        echo -e "${YELLOW}Démarrez-le avec: make up${NC}"
        exit 1
    fi
}

# Commande: Afficher tous les utilisateurs
cmd_users() {
    echo -e "${GREEN}Liste de tous les utilisateurs:${NC}"
    execute_query_table "SELECT id, username, email, is_online, two_factor_enabled, created_at, last_login FROM users ORDER BY id;"
}

# Commande: Afficher un utilisateur spécifique
cmd_user() {
    local user_id="$1"
    if [ -z "$user_id" ]; then
        echo -e "${RED}Erreur: ID utilisateur requis${NC}"
        echo -e "${YELLOW}Usage: $0 user <id>${NC}"
        exit 1
    fi
    echo -e "${GREEN}Détails de l'utilisateur #${user_id}:${NC}"
    execute_query_table "SELECT * FROM users WHERE id = ${user_id};"
}

# Commande: Afficher les utilisateurs en ligne
cmd_online() {
    echo -e "${GREEN}Utilisateurs en ligne:${NC}"
    execute_query_table "SELECT id, username, email, last_login FROM users WHERE is_online = 1 ORDER BY last_login DESC;"
}

# Commande: Afficher tous les matchs
cmd_games() {
    echo -e "${GREEN}Liste de tous les matchs:${NC}"
    execute_query_table "
        SELECT
            g.id,
            u1.username as player1,
            u2.username as player2,
            g.player1_score,
            g.player2_score,
            u3.username as winner,
            g.game_mode,
            g.duration,
            g.created_at
        FROM games g
        LEFT JOIN users u1 ON g.player1_id = u1.id
        LEFT JOIN users u2 ON g.player2_id = u2.id
        LEFT JOIN users u3 ON g.winner_id = u3.id
        ORDER BY g.created_at DESC
        LIMIT 50;
    "
}

# Commande: Afficher un match spécifique
cmd_game() {
    local game_id="$1"
    if [ -z "$game_id" ]; then
        echo -e "${RED}Erreur: ID du match requis${NC}"
        echo -e "${YELLOW}Usage: $0 game <id>${NC}"
        exit 1
    fi
    echo -e "${GREEN}Détails du match #${game_id}:${NC}"
    execute_query_table "
        SELECT
            g.*,
            u1.username as player1_name,
            u2.username as player2_name,
            u3.username as winner_name
        FROM games g
        LEFT JOIN users u1 ON g.player1_id = u1.id
        LEFT JOIN users u2 ON g.player2_id = u2.id
        LEFT JOIN users u3 ON g.winner_id = u3.id
        WHERE g.id = ${game_id};
    "
}

# Commande: Afficher les stats d'un utilisateur
cmd_stats() {
    local user_id="$1"
    if [ -z "$user_id" ]; then
        echo -e "${RED}Erreur: ID utilisateur requis${NC}"
        echo -e "${YELLOW}Usage: $0 stats <id>${NC}"
        exit 1
    fi
    echo -e "${GREEN}Statistiques de l'utilisateur #${user_id}:${NC}"
    execute_query_table "
        SELECT
            u.id,
            u.username,
            COALESCE(s.games_played, 0) as games_played,
            COALESCE(s.games_won, 0) as games_won,
            COALESCE(s.games_lost, 0) as games_lost,
            COALESCE(s.tournaments_played, 0) as tournaments_played,
            COALESCE(s.tournaments_won, 0) as tournaments_won,
            COALESCE(s.total_points_scored, 0) as total_points_scored,
            COALESCE(s.total_points_conceded, 0) as total_points_conceded,
            ROUND(CAST(s.games_won AS FLOAT) / NULLIF(s.games_played, 0) * 100, 2) as win_rate
        FROM users u
        LEFT JOIN user_stats s ON u.id = s.user_id
        WHERE u.id = ${user_id};
    "
}

# Commande: Afficher le classement
cmd_leaderboard() {
    echo -e "${GREEN}Classement par victoires (Top 20):${NC}"
    execute_query_table "
        SELECT
            u.id,
            u.username,
            COALESCE(s.games_played, 0) as games_played,
            COALESCE(s.games_won, 0) as games_won,
            COALESCE(s.games_lost, 0) as games_lost,
            ROUND(CAST(s.games_won AS FLOAT) / NULLIF(s.games_played, 0) * 100, 2) as win_rate,
            COALESCE(s.tournaments_won, 0) as tournaments_won
        FROM users u
        LEFT JOIN user_stats s ON u.id = s.user_id
        WHERE s.games_played > 0
        ORDER BY s.games_won DESC, win_rate DESC
        LIMIT 20;
    "
}

# Commande: Afficher tous les tournois
cmd_tournaments() {
    echo -e "${GREEN}Liste de tous les tournois:${NC}"
    execute_query_table "SELECT * FROM tournaments ORDER BY created_at DESC;"
}

# Commande: Afficher un tournoi spécifique
cmd_tournament() {
    local tournament_id="$1"
    if [ -z "$tournament_id" ]; then
        echo -e "${RED}Erreur: ID du tournoi requis${NC}"
        echo -e "${YELLOW}Usage: $0 tournament <id>${NC}"
        exit 1
    fi
    echo -e "${GREEN}Détails du tournoi #${tournament_id}:${NC}"
    execute_query_table "SELECT * FROM tournaments WHERE id = ${tournament_id};"

    echo -e "\n${GREEN}Résultats du tournoi:${NC}"
    execute_query_table "
        SELECT
            tr.user_id,
            u.username,
            tr.final_position,
            tr.created_at
        FROM tournament_results tr
        LEFT JOIN users u ON tr.user_id = u.id
        WHERE tr.tournament_id = '${tournament_id}'
        ORDER BY tr.final_position;
    "

    echo -e "\n${GREEN}Alias des participants:${NC}"
    execute_query_table "
        SELECT
            ta.id,
            ta.player_alias,
            u.username as real_username,
            ta.is_owner,
            ta.joined_at
        FROM tournament_aliases ta
        LEFT JOIN users u ON ta.user_id = u.id
        WHERE ta.tournament_id = '${tournament_id}'
        ORDER BY ta.joined_at;
    "
}

# Commande: Afficher les amis d'un utilisateur
cmd_friends() {
    local user_id="$1"
    if [ -z "$user_id" ]; then
        echo -e "${RED}Erreur: ID utilisateur requis${NC}"
        echo -e "${YELLOW}Usage: $0 friends <id>${NC}"
        exit 1
    fi
    echo -e "${GREEN}Amis de l'utilisateur #${user_id}:${NC}"
    execute_query_table "
        SELECT
            f.friend_id,
            u.username,
            u.is_online,
            f.status,
            f.created_at
        FROM friends f
        LEFT JOIN users u ON f.friend_id = u.id
        WHERE f.user_id = ${user_id}
        ORDER BY f.created_at DESC;
    "
}

# Commande: Afficher les messages du chat global
cmd_chat() {
    echo -e "${GREEN}Messages du chat global (50 derniers):${NC}"
    execute_query_table "
        SELECT
            m.id,
            u.username as sender,
            m.message_type,
            m.content,
            m.created_at
        FROM messages m
        LEFT JOIN users u ON m.sender_id = u.id
        WHERE m.conversation_id = 1
        ORDER BY m.created_at DESC
        LIMIT 50;
    "
}

# Commande: Afficher les messages d'une conversation
cmd_messages() {
    local conversation_id="$1"
    if [ -z "$conversation_id" ]; then
        echo -e "${RED}Erreur: ID de conversation requis${NC}"
        echo -e "${YELLOW}Usage: $0 messages <id>${NC}"
        exit 1
    fi
    echo -e "${GREEN}Messages de la conversation #${conversation_id}:${NC}"
    execute_query_table "
        SELECT
            m.id,
            u.username as sender,
            m.message_type,
            m.content,
            m.created_at
        FROM messages m
        LEFT JOIN users u ON m.sender_id = u.id
        WHERE m.conversation_id = ${conversation_id}
        ORDER BY m.created_at DESC
        LIMIT 50;
    "
}

# Commande: Afficher les notifications d'un utilisateur
cmd_notifications() {
    local user_id="$1"
    if [ -z "$user_id" ]; then
        echo -e "${RED}Erreur: ID utilisateur requis${NC}"
        echo -e "${YELLOW}Usage: $0 notifications <id>${NC}"
        exit 1
    fi
    echo -e "${GREEN}Notifications de l'utilisateur #${user_id}:${NC}"
    execute_query_table "
        SELECT
            id,
            type,
            title,
            message,
            is_read,
            created_at
        FROM notifications
        WHERE user_id = ${user_id}
        ORDER BY created_at DESC
        LIMIT 50;
    "
}

# Commande: Afficher les défis en cours
cmd_challenges() {
    echo -e "${GREEN}Défis en cours:${NC}"
    execute_query_table "
        SELECT
            gc.id,
            u1.username as challenger,
            u2.username as challenged,
            gc.status,
            gc.game_mode,
            gc.message,
            gc.created_at,
            gc.responded_at
        FROM game_challenges gc
        LEFT JOIN users u1 ON gc.challenger_id = u1.id
        LEFT JOIN users u2 ON gc.challenged_id = u2.id
        WHERE gc.status IN ('pending', 'accepted')
        ORDER BY gc.created_at DESC;
    "
}

# Commande: Lister toutes les tables
cmd_tables() {
    echo -e "${GREEN}Liste des tables:${NC}"
    execute_query_table "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;"
}

# Commande: Afficher le schéma d'une table
cmd_schema() {
    local table_name="$1"
    if [ -z "$table_name" ]; then
        echo -e "${RED}Erreur: Nom de la table requis${NC}"
        echo -e "${YELLOW}Usage: $0 schema <table>${NC}"
        exit 1
    fi
    echo -e "${GREEN}Schéma de la table '${table_name}':${NC}"
    execute_query_table "PRAGMA table_info(${table_name});"

    echo -e "\n${GREEN}Index de la table '${table_name}':${NC}"
    execute_query_table "PRAGMA index_list(${table_name});"
}

# Commande: Compter les entrées dans chaque table
cmd_count() {
    echo -e "${GREEN}Nombre d'entrées par table:${NC}"

    # Récupérer dynamiquement toutes les tables
    tables=$(docker exec -i ${CONTAINER_NAME} sqlite3 ${DB_PATH} "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name;")

    while IFS= read -r table; do
        if [ -n "$table" ]; then
            count=$(docker exec -i ${CONTAINER_NAME} sqlite3 ${DB_PATH} "SELECT COUNT(*) FROM ${table};" 2>/dev/null || echo "ERROR")
            if [ "$count" != "ERROR" ]; then
                printf "  %-30s : %s\n" "$table" "$count"
            fi
        fi
    done <<< "$tables"
}

# Commande: Exécuter une requête SQL personnalisée
cmd_sql() {
    local query="$*"
    if [ -z "$query" ]; then
        echo -e "${RED}Erreur: Requête SQL requise${NC}"
        echo -e "${YELLOW}Usage: $0 sql \"SELECT * FROM users;\"${NC}"
        exit 1
    fi
    echo -e "${GREEN}Résultat de la requête:${NC}"
    execute_query_table "$query"
}

# Commande: Mode interactif
cmd_interactive() {
    echo -e "${GREEN}Mode interactif SQLite${NC}"
    echo -e "${YELLOW}Tapez .quit ou .exit pour quitter${NC}"
    docker exec -it ${CONTAINER_NAME} sqlite3 ${DB_PATH}
}

# Commande: Sauvegarder la base de données
cmd_backup() {
    local backup_dir="./backups"
    local timestamp=$(date +%Y%m%d_%H%M%S)
    local backup_file="${backup_dir}/pong_${timestamp}.db"

    mkdir -p "$backup_dir"

    echo -e "${GREEN}Sauvegarde de la base de données...${NC}"
    docker cp ${CONTAINER_NAME}:${DB_PATH} "${backup_file}"

    if [ -f "${backup_file}" ]; then
        echo -e "${GREEN}Base de données sauvegardée: ${backup_file}${NC}"

        # Afficher la taille du fichier
        size=$(du -h "${backup_file}" | cut -f1)
        echo -e "${YELLOW}Taille: ${size}${NC}"
    else
        echo -e "${RED}Erreur lors de la sauvegarde${NC}"
        exit 1
    fi
}

# Commande: Exécuter toutes les commandes de consultation
cmd_all() {
    echo -e "${BLUE}========================================${NC}"
    echo -e "${BLUE}  Rapport complet de la base de données${NC}"
    echo -e "${BLUE}========================================${NC}"
    echo ""

    # Comptage des entrées
    echo -e "\n${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BLUE}📊 COMPTAGE DES ENTRÉES${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    cmd_count

    # Utilisateurs
    echo -e "\n${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BLUE}👥 UTILISATEURS${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    cmd_users

    # Utilisateurs en ligne
    echo -e "\n${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BLUE}🟢 UTILISATEURS EN LIGNE${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    cmd_online

    # Classement
    echo -e "\n${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BLUE}🏆 CLASSEMENT${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    cmd_leaderboard

    # Matchs récents
    echo -e "\n${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BLUE}🎮 MATCHS RÉCENTS${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    cmd_games

    # Tournois
    echo -e "\n${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BLUE}🏆 TOURNOIS${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    cmd_tournaments

    # Défis en cours
    echo -e "\n${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BLUE}⚔️  DÉFIS EN COURS${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    cmd_challenges

    # Messages du chat
    echo -e "\n${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BLUE}💬 CHAT GLOBAL${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    cmd_chat

    # Tables
    echo -e "\n${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BLUE}📋 TABLES${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    cmd_tables

    echo -e "\n${GREEN}✓ Rapport complet terminé${NC}"
}

# Commande: Menu interactif
cmd_menu() {
    while true; do
        clear
        echo -e "${BLUE}╔════════════════════════════════════════╗${NC}"
        echo -e "${BLUE}║    Menu interactif - Consultation DB   ║${NC}"
        echo -e "${BLUE}╚════════════════════════════════════════╝${NC}"
        echo ""
        echo -e "${GREEN}Sélectionnez une option:${NC}"
        echo ""
        echo -e "  ${YELLOW}1${NC})  Afficher tous les utilisateurs"
        echo -e "  ${YELLOW}2${NC})  Afficher un utilisateur (par ID)"
        echo -e "  ${YELLOW}3${NC})  Utilisateurs en ligne"
        echo -e "  ${YELLOW}4${NC})  Afficher tous les matchs"
        echo -e "  ${YELLOW}5${NC})  Afficher un match (par ID)"
        echo -e "  ${YELLOW}6${NC})  Statistiques d'un utilisateur"
        echo -e "  ${YELLOW}7${NC})  Classement"
        echo -e "  ${YELLOW}8${NC})  Afficher tous les tournois"
        echo -e "  ${YELLOW}9${NC})  Afficher un tournoi (par ID)"
        echo -e "  ${YELLOW}10${NC}) Amis d'un utilisateur"
        echo -e "  ${YELLOW}11${NC}) Chat global"
        echo -e "  ${YELLOW}12${NC}) Messages d'une conversation"
        echo -e "  ${YELLOW}13${NC}) Notifications d'un utilisateur"
        echo -e "  ${YELLOW}14${NC}) Lister toutes les tables"
        echo -e "  ${YELLOW}15${NC}) Schéma d'une table"
        echo -e "  ${YELLOW}16${NC}) Requête SQL personnalisée"
        echo -e "  ${YELLOW}17${NC}) Sauvegarder la base de données"
        echo -e "  ${YELLOW}18${NC}) Rapport complet (toutes les commandes)"
        echo ""
        echo -e "  ${RED}0${NC})  Quitter"
        echo ""
        echo -n -e "${GREEN}Votre choix: ${NC}"
        read choice

        echo ""
        case "$choice" in
            1)
                cmd_users
                ;;
            2)
                echo -n -e "${YELLOW}ID de l'utilisateur: ${NC}"
                read user_id
                cmd_user "$user_id"
                ;;
            3)
                cmd_online
                ;;
            4)
                cmd_games
                ;;
            5)
                echo -n -e "${YELLOW}ID du match: ${NC}"
                read game_id
                cmd_game "$game_id"
                ;;
            6)
                echo -n -e "${YELLOW}ID de l'utilisateur: ${NC}"
                read user_id
                cmd_stats "$user_id"
                ;;
            7)
                cmd_leaderboard
                ;;
            8)
                cmd_tournaments
                ;;
            9)
                echo -n -e "${YELLOW}ID du tournoi: ${NC}"
                read tournament_id
                cmd_tournament "$tournament_id"
                ;;
            10)
                echo -n -e "${YELLOW}ID de l'utilisateur: ${NC}"
                read user_id
                cmd_friends "$user_id"
                ;;
            11)
                cmd_chat
                ;;
            12)
                echo -n -e "${YELLOW}ID de la conversation: ${NC}"
                read conversation_id
                cmd_messages "$conversation_id"
                ;;
            13)
                echo -n -e "${YELLOW}ID de l'utilisateur: ${NC}"
                read user_id
                cmd_notifications "$user_id"
                ;;
            14)
                cmd_tables
                ;;
            15)
                echo -n -e "${YELLOW}Nom de la table: ${NC}"
                read table_name
                cmd_schema "$table_name"
                ;;
            16)
                echo -e "${YELLOW}Entrez votre requête SQL (terminez par une ligne vide):${NC}"
                query=""
                while IFS= read -r line; do
                    [ -z "$line" ] && break
                    query="${query}${line} "
                done
                if [ -n "$query" ]; then
                    cmd_sql "$query"
                else
                    echo -e "${RED}Aucune requête saisie${NC}"
                fi
                ;;
            17)
                cmd_backup
                ;;
            18)
                cmd_all
                ;;
            0)
                echo -e "${GREEN}Au revoir!${NC}"
                exit 0
                ;;
            *)
                echo -e "${RED}Option invalide${NC}"
                ;;
        esac

        echo ""
        echo -n -e "${YELLOW}Appuyez sur Entrée pour continuer...${NC}"
        read
    done
}

# Point d'entrée principal
main() {
    check_container

    local command="${1:-help}"
    shift || true

    case "$command" in
        users)
            cmd_users
            ;;
        user)
            cmd_user "$@"
            ;;
        online)
            cmd_online
            ;;
        games)
            cmd_games
            ;;
        game)
            cmd_game "$@"
            ;;
        stats)
            cmd_stats "$@"
            ;;
        leaderboard)
            cmd_leaderboard
            ;;
        tournaments)
            cmd_tournaments
            ;;
        tournament)
            cmd_tournament "$@"
            ;;
        friends)
            cmd_friends "$@"
            ;;
        chat)
            cmd_chat
            ;;
        messages)
            cmd_messages "$@"
            ;;
        notifications)
            cmd_notifications "$@"
            ;;
        challenges)
            cmd_challenges
            ;;
        tables)
            cmd_tables
            ;;
        schema)
            cmd_schema "$@"
            ;;
        count)
            cmd_count
            ;;
        sql)
            cmd_sql "$@"
            ;;
        interactive)
            cmd_interactive
            ;;
        backup)
            cmd_backup
            ;;
        all)
            cmd_all
            ;;
        menu)
            cmd_menu
            ;;
        help|--help|-h)
            show_menu
            ;;
        *)
            echo -e "${RED}Commande inconnue: $command${NC}"
            show_menu
            exit 1
            ;;
    esac
}

main "$@"
