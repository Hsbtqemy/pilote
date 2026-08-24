Bloc à coller dans le `CLAUDE.md` (ou `AGENTS.md`) du dépôt hôte. Le préfixe `_` le
rend invisible pour l'outil : ce n'est ni un chantier ni une passe.

---

## Pilotage

Un chantier interrompu a un fichier `pilotage/<CODE>.md`. Une QA visuelle est une
passe rejouable dans `pilotage/qa/<nom>.md`. Voir `pilotage/_TEMPLATE.md`.

IMPORTANT — respecter exactement `## Reste` et les H3 de zone : l'outil ne lit que
ces sections.

- Fin de session : mettre à jour le `Reste` du chantier travaillé.
- Le commit de code d'abord, le commit de fiche ensuite, **séparément** : une fiche
  ne peut pas citer le commit qui la met à jour, et les commits qui ne touchent que
  `pilotage/` sont exclus du datage.
- Avant de clore une session : `node pilotage/verifier.mjs` (code de retour non nul
  = l'outil lira mal le dossier ; `--strict` rend les avertissements bloquants).
- QA visuelle : écrire une passe dans `pilotage/qa/`, jamais dans le fil de
  conversation. Regrouper les points par zone en H3.
- Ne jamais cocher soi-même une case d'une passe de QA.
- Ne pas créer de fichier pour un finding traité en un seul commit.

Le journal se lit avec `npx pilote` puis `localhost:4123` (git + `pilotage/`, lecture
seule sauf les cases, dont l'écriture est bornée à `pilotage/`).
