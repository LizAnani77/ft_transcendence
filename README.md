[README.md](https://github.com/user-attachments/files/23980904/README.md)

MERCI MAELLE "WE MADE IT" 💪!

# ft_transcendence

![PONG Showcase](./pong-final.gif)

## 📚 Documentation technique

- 🏠 [Docker Compose Architecture](docs/README_architecture.md)
- 🛡️ [ModSecurity - Configuration WAF](docs/security/README_waf.md)
- 🔐 [Vault - Structure et rôles](docs/security/README_vault.md)
- 📲 [2FA - Authentification à deux facteurs](docs/security/README_2FA.md)
- 🤝 [Remote Auth - Se connecter via API 42](docs/README_oauth2.md)
- 🌐 [Multiple Language Support](docs/README_i18n.md)
- 🎮 [Pong CLI - Jouer depuis le terminal](docs/README_cli.md)

---

## Usage

1) Créer un **.env** à la racine du repo et y insérer les secrets
2)
```bash
make
```

---

## Schéma global TLS + WAF (Nginx + ModSecurity + Vault)

```text
🌍 Client (navigateur)
        │
        │   HTTPS (chiffré avec certificat TLS)
        ▼
🔐 Nginx (WAF + ModSecurity)
   ├── TLS Termination
   ├── Filtrage ModSecurity (OWASP CRS)
   └── Reverse proxy
        ├── /api/*   → Backend
        ├── /uploads → Volume partagé
        └── /        → Frontend
```
---
## 🔗 Liens / commandes utiles

**Vers l'app:**
https://localhost:3443/
