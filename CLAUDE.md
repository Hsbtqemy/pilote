# CLAUDE.md

Pilote est l'outil de journal de bord lui-même : un serveur local sans dépendance qui
confronte un dossier `pilotage/` à ce que `git` montre. Il se pilote avec lui-même —
ses propres chantiers sont dans `pilotage/`.

`journal-contrat.mjs` DÉFINIT les règles de lecture ; `pilotage/_TEMPLATE.md` les
DÉCRIT ; `README.md` ne les redit pas. Quand un document contredit le contrat, c'est
le code qui a raison.

Toute évolution du contrat se fait dans `journal-contrat.mjs`, jamais en double.

## Pilotage

Un chantier interrompu a un fichier `pilotage/<CODE>.md`. Une QA visuelle est une
passe rejouable dans `pilotage/qa/<nom>.md`. Voir `pilotage/_TEMPLATE.md`.

IMPORTANT — respecter exactement `## Reste` et les H3 de zone : l'outil ne lit que
ces sections.

- Fin de session : mettre à jour le `Reste` du chantier travaillé.
- `statut:` se prend dans `à venir` · `interrompu` · `différé` · `clos` · `livré`,
  et rien d'autre — le contrôleur refuse le reste. `différé` = mis en attente exprès
  (autre chose doit aboutir d'abord), à distinguer d'`interrompu` = arrêté en plein
  travail.
- Le commit de code d'abord, le commit de fiche ensuite, **séparément** : une fiche
  ne peut pas citer le commit qui la met à jour, et les commits qui ne touchent que
  `pilotage/` sont exclus du datage.
- Avant de clore une session : `node pilotage/verifier.mjs` (code de retour non nul
  = l'outil lira mal le dossier ; `--strict` rend les avertissements bloquants).
- QA visuelle : écrire une passe dans `pilotage/qa/`, jamais dans le fil de
  conversation. Regrouper les points par zone en H3.
- Ne jamais cocher soi-même une case d'une passe de QA.
- Ne pas créer de fichier pour un finding traité en un seul commit.

Le journal se lit avec `node journal.mjs` puis `localhost:4123` — la commande est
idempotente, se retaper sans vérifier si un serveur tourne est le geste prévu
(`node journal.mjs arreter` ferme, `node journal.mjs aide` liste tout). Lecture seule
sauf les cases, dont l'écriture est bornée à `pilotage/`.

`pilotage/_CLAUDE-bloc.md` dit `pilote` là où ce fichier dit `node journal.mjs` : le
bloc s'adresse à un dépôt qui CONSOMME le paquet, celui-ci au dépôt qui EST le paquet,
et qui n'a donc pas de `node_modules` où trouver la commande. Les règles, elles, doivent
rester identiques mot pour mot — c'est le seul écart légitime entre les deux.
