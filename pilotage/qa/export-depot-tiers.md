---
passe: Export vers un dépôt tiers
chantier: P-2
duree: 10 min
derniere: 2026-08-24
---

# QA — l'outil s'installe ailleurs

Se joue depuis un dépôt qui n'est PAS Pilote. Un dépôt jetable suffit : `git init`, un
`pilotage/` avec une fiche, rien d'autre. La passe vérifie que rien ne fuit du répertoire
courant vers l'outil, ni l'inverse.

### Dépôt neuf, sans aucun commit

- [ ] Le serveur démarre sans écrire une seule ligne d'erreur sur la console
- [ ] La fiche apparaît, ses items sont comptés, les zones `###` sont rendues
- [ ] Le dernier commit, le silence, le front et les courbes sont vides — pas faux
- [ ] Cocher une case réécrit bien le markdown du dépôt courant

### Dépôt avec historique, sans inventaire

- [ ] Les chantiers sont datés par leur code trouvé dans les sujets de commit
- [ ] L'onglet des masses annonce qu'il n'a rien à montrer, sans casser la page
- [ ] Aucun bandeau de veille n'apparaît

### Provenance des fichiers

- [ ] La vue vient du paquet : renommer `journal.html` dans le dépôt courant ne change rien
- [ ] Le contrôleur vient du paquet : ses avertissements apparaissent sans qu'aucun
      `verifier.mjs` n'existe dans le dépôt courant
- [ ] Le refus d'écrire hors de `pilotage/` tient depuis un dépôt tiers
