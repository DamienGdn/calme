# Calme — tri de mails Gmail piloté par Claude

Date : 2026-11-11 · Statut : validé par l'utilisateur (« je te laisse faire »)
Maquettes : https://claude.ai/artifact/NWTxsc6eHMJvYV4ddfTGvA (direction « salle de rédaction de nuit »)

## Intention

L'utilisateur reçoit trop de mails sur son Gmail perso ; les gérer lui coûte du temps. Il veut ne plus ouvrir Gmail :
une app qui relève les mails, laisse Claude les trier, les résumer, détecter ce qui demande une réponse,
proposer des réponses, proposer des suppressions et des désabonnements. L'utilisateur garde la main sur
tout ce qui part ou disparaît.

## Objectifs

- Relève automatique de la boîte de réception Gmail (un seul compte).
- Tri par Claude en 4 catégories : `reply` (À répondre), `read` (À lire), `news` (Newsletters), `trash` (À supprimer).
- Par mail : résumé en 1 à 3 points, action suggérée, jusqu'à 3 réponses proposées (catégorie `reply`, parfois `read`).
- Éditeur de réponse : destinataires, objet, corps, pièces jointes (envoi en fil Gmail), choix du ton
  (Chaleureux / Neutre / Bref), réécriture par instruction libre (« plus court »…).
- Ménage : mails `trash` regroupés par type (libellé de groupe donné par Claude), newsletters regroupées par expéditeur
  avec volume et désabonnement ; application groupée après validation.
- Actions mail : archiver, classer (libellé Gmail existant), corbeille, envoyer, désabonner.
- Interface conforme aux maquettes, thème sombre par défaut + thème clair, bascule dans l'app.
- Disponible sur Mac, Windows, Linux (app de bureau avec icône barre des tâches / tray) et iPhone (app web écran d'accueil).
- Notifications : natives sur le bureau, Web Push sur iPhone, quand un nouveau mail passe en `reply`.
- Pilotable depuis Claude Code (CLI + commandes `.claude/commands`).
- Agenda Google (ajout du 2026-11-11, demande utilisateur) : l'agenda des 14 prochains jours est donné à Claude pendant le tri
  pour des réponses compatibles avec les disponibilités ; un rendez-vous détecté dans un mail est proposé et créé dans
  l'agenda principal uniquement sur clic. Portée `calendar.events`.

## Non-objectifs

- Plusieurs comptes, autres fournisseurs que Gmail.
- App iOS native / App Store.
- Hébergement cloud : tout tourne chez l'utilisateur.
- Utiliser l'API Anthropic payante : l'IA passe par Claude Code (abonnement Max) en mode `claude -p`.

## Anti-objectifs (échec même si « ça marche »)

- Un mail envoyé, supprimé ou un désabonnement fait sans clic explicite de l'utilisateur.
- Suppression définitive : toujours la corbeille Gmail (récupérable 30 jours).
- Serveur joignable depuis Internet public, ou API sans authentification.
- Un mail piégé qui fait agir Claude (injection) : Claude n'a aucun outil, sort uniquement du JSON validé par schéma.
- HTML de mail rendu tel quel (XSS) : les mails sont affichés en texte.

## Architecture (décidée)

Un « cerveau » sur le PC toujours allumé de l'utilisateur ; des écrans qui s'y connectent.

- `server/` — Node 24, TypeScript exécuté nativement (type stripping, pas de build). Hono pour l'HTTP,
  `node:sqlite` pour le stockage, `@googleapis/gmail` + `google-auth-library` pour Gmail, `web-push` pour les notifications iPhone.
  Écoute uniquement `127.0.0.1:4747`. Relève toutes les 5 minutes, puis tri des nouveaux mails par lots de 10.
  Sert aussi l'interface web construite.
- `web/` — Vite + React + TypeScript. Écrans : Tri, Éditeur, Ménage ; mise en page responsive (iPhone = même app).
  PWA : manifeste, icônes, service worker (réception push uniquement, pas de cache des mails).
- `desktop/` — Electron, client léger : fenêtre sur l'URL du serveur (réglable), icône tray avec le nombre de
  mails À répondre, notifications natives. Paquets via electron-builder : dmg (Mac), nsis (Windows), AppImage (Linux).
  Choix de l'assistant : Electron plutôt que Tauri car Rust n'est pas installé et Electron ne demande que Node.
- Accès distant (iPhone, autres PC) : `tailscale serve` publie le serveur local en HTTPS sur le réseau privé
  Tailscale de l'utilisateur uniquement.
- Authentification des écrans : jeton d'appairage aléatoire généré au premier démarrage (affiché par `calme pair`),
  exigé en `Authorization: Bearer` sur toute route `/api/*`.
- IA : `claude -p --tools "" --strict-mcp-config --setting-sources "" --no-session-persistence --output-format json
  --json-schema <schéma>` ; contenu des mails encadré comme données non fiables. Modèle par défaut `sonnet`
  (variable `CALME_MODEL`). Vérifié le 2026-11-11 : fonctionne avec la connexion Max, renvoie `structured_output`.
- Données : `~/.calme/` (base `calme.db`, `token.json` Google en 0600, `config.json` : jeton d'appairage, clés VAPID).
- Gmail : client OAuth « Application de bureau » créé par l'utilisateur dans Google Cloud (gratuit) ;
  `credentials.json` déposé dans `~/.calme/`. Portées : `gmail.modify`, `gmail.send`.

## Comportements précis

- Relève : `in:inbox newer_than:30d`, 200 mails max par relève ; texte brut extrait (HTML converti en texte),
  tronqué à 4 000 caractères pour l'IA.
- Un mail archivé, classé ou mis à la corbeille depuis Calme sort de la liste.
- Désabonnement : en-tête `List-Unsubscribe` ; one-click (RFC 8058, POST `List-Unsubscribe=One-Click`) si
  `List-Unsubscribe-Post` présent, sinon mail `mailto:`, sinon on renvoie l'URL à ouvrir par l'utilisateur.
- Pièces jointes : 20 Mo max au total par envoi.
- Réponse : en fil (`threadId`, `In-Reply-To`, `References`), objet préfixé `Re: ` s'il ne l'est pas.
- Notifications : une par nouveau mail classé `reply` (expéditeur + objet), regroupées si plus de 3 dans une relève.
- Par défaut rien n'est automatique : Claude propose, l'utilisateur valide (mode auto = plus tard).

## Laissé au constructeur

Noms internes, structure des tables, détail des prompts, icône de l'app (cohérente avec la maquette : « c. » serif italique sur vert anis).
