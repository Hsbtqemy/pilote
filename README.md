# Pilote

Un journal de bord local pour un dépôt de code. Il lit un dossier `pilotage/` — ce que
tu déclares rester à faire — et le confronte à ce que `git` montre. Aucune dépendance,
Node 18+, rien ne sort de la machine.

**Ce n'est pas** un gestionnaire de tickets, un kanban, ni un service. Il n'ajoute pas
d'information : il met côte à côte ce que tu as écrit et ce que le dépôt a fait, et
laisse l'écart visible. C'est tout, et c'est le point.

Il est écrit pour un développeur seul qui reprend un chantier trois semaines plus tard,
et pour l'agent qui travaille dans le même dépôt.

---

## Installer

```bash
npx github:Hsbtqemy/pilote            # le journal, sur localhost:4123
npx github:Hsbtqemy/pilote verifier   # le contrôleur du dossier
npx github:Hsbtqemy/pilote arreter    # fermer le journal
```

**Plusieurs dépôts.** Lance un journal dans chacun, sur des ports voisins :
`pilote` dans le premier, `pilote --port 4124` dans le second. Chacun découvre les autres
en interrogeant les ports alentour et affiche un sélecteur dans son en-tête. Rien n'est
fusionné, et c'est voulu : la frise partage une échelle, les masses reposent sur les aires
déclarées, les collisions sur des chemins de fichiers — mêler deux dépôts en inventerait.

**La commande du journal se retape sans réfléchir.** Elle sonde le port avant d'écouter
et fait ce qu'il faut : rien ne tourne, elle démarre ; ton journal tourne déjà, elle
donne l'adresse et sort en 165 ms sans relire le dépôt ; l'outil a été mis à jour depuis,
elle remplace le serveur périmé ; le port sert un AUTRE dépôt ou un autre programme, elle
le dit et nomme le coupable. Aucun de ces cas ne coûte plus cher qu'avant — la sonde est
un aller-retour sur la boucle locale, et le démarrage à froid reste à 250 ms.

Le serveur écoute sur `localhost:4123`.

```bash
npx github:Hsbtqemy/pilote aide       # la liste complète : commandes, options, conventions
```

C'est le seul endroit qui liste tout, et il est vérifié contre le code — aucun drapeau
annoncé qui n'existe pas, aucun drapeau réel passé sous silence. Ce README n'en redit que
le nécessaire pour démarrer : trois listes à tenir à jour en donneraient deux de fausses.

`npx` va rechercher l'outil à chaque lancement : mesuré, **4,3 s contre 0,4 s** pour une
copie locale. C'est bon pour essayer, mauvais pour un dépôt dont tu ouvres le journal
tous les jours. Là, prends-le en dépendance :

```json
{ "devDependencies": { "pilote": "git+https://github.com/Hsbtqemy/pilote.git" },
  "scripts": { "journal": "pilote", "verifier": "pilote verifier",
               "arreter": "pilote arreter" } }
```

Rien n'est copié dans ton projet, sauf ce que tu écris toi-même : le dossier `pilotage/`
et, si tu le veux, un fichier d'inventaire. Les mises à jour de l'outil profitent à tous
tes dépôts d'un coup, sans fork — c'est tout l'intérêt, et le dépôt d'où vient l'outil a
mis quatre reports à la main en une journée avant de s'y mettre.

Pour commencer, copie `pilotage/_TEMPLATE.md` et écris ta première fiche.

---

## L'inventaire — trois valeurs, une fois

`pilotage/journal.config.mjs` est **facultatif**. Sans lui, tu as les chantiers, les
passes, le contrôleur et le front d'intégration. Avec lui, tu gagnes les courbes de
masse et la veille à seuil.

Il ne contient aucune grammaire, aucun réglage de lecture — seulement ce qu'aucun outil
ne peut deviner : `refs` (les branches d'intégration, de l'amont vers l'aval), `aires`
(des préfixes de chemin, un par zone du code) et `veille` (le fichier dont la croissance
te pose un vrai problème, avec son seuil). Voir l'exemple dans ce dépôt.

---

## Le premier jour

**Choisis ton vocabulaire de codes avant le premier commit.** C'est la seule décision
qui ne se rattrape pas.

L'outil date un chantier en cherchant son code dans les sujets de commit. Sur un dépôt
mesuré en août 2026, la convention avait changé quatre fois en 169 commits — `ANN-2`,
puis `B6 :`, puis `Roadmap :`, puis des verbes français — et **18 tickets sur 39** seulement
étaient rattachables à un commit. Les 82 % d'historique restants ne le seront jamais : on
ne réécrit pas un historique.

Ça coûte zéro avant le premier commit. Après, c'est perdu.

Un format qui marche : `PREFIXE-N`, le préfixe nommant un domaine (`ANN-2`, `SEC-1`,
`R6`). Écris-le dans le sujet du commit, pas seulement dans le corps.

---

## La discipline

Tout ce qui est mécanique est tenu par `pilote verifier`. Ce qui suit ne peut être
tenu que par toi.

**1. Le commit de code d'abord, le commit de fiche ensuite — séparément.** C'est
contre-intuitif et c'est la règle la plus importante : une fiche ne peut pas citer le
commit qui la met à jour, et les commits qui ne touchent que `pilotage/` sont exclus du
datage des chantiers. Les fusionner casse les deux mécanismes à la fois.

**1 bis. Le commit de code cite le code du chantier.** Un chantier n'est daté que par
les commits qui le citent ET qui sortent de `pilotage/` — les deux à la fois. Mesuré sur
le dépôt d'où vient l'outil : un chantier entièrement traité, deux commits de code, aucun
ne citant son code — `0 commit`, aucune date, aucune barre sur la fresque. Le travail
existait, le journal ne pouvait pas le voir.

**2. Une case = une affirmation vérifiable, avec son attendu.** « Vérifier le rendu » ne
se coche pas : ça se contemple. « Sur 375 px, la barre ne masque pas le geste » se coche.

**3. Une passe de QA s'écrit dans `pilotage/qa/`, jamais dans un fil de conversation.**
Une vérification qui n'existe que dans un échange n'est pas rejouable.

**4. On ne coche jamais une case de QA à la place de qui l'a écrite.** Si tu délègues la
passe à un agent, il la rédige et te la rend ; c'est toi qui coches.

**5. `pilote verifier` avant de clore une session.** Code de retour non nul =
l'outil lira mal le dossier.

---

## Ce que ça attrape

Des exemples réels, mesurés sur les deux dépôts d'où l'outil vient. Ce ne sont pas des
promesses — c'est ce qui est effectivement sorti quand on a regardé.

- **21 cases tronquées, dont 15 déjà cochées.** Le parseur jetait en silence les lignes
  de continuation ; l'une d'elles, cochée, ne disait plus ce qui devait se passer.
- **32 points de départ tronqués sur 33**, le jumeau du défaut ci-dessus à l'endroit où
  aucun contrôle ne regarde. 3 004 caractères n'atteignaient jamais l'écran, et la moitié
  perdue portait souvent la conclusion — « n'a jamais été commencée », « à traiter AVANT
  toute exposition réseau ». La première ligne se lit très bien : on ne voit pas ce qui
  manque.
- **4 points de reprise périmés sur 14**, et c'étaient les trois fiches les plus actives.
  Le `Arrêté sur` ne tient que là où on n'en a pas besoin — d'où la traînée de commits.
- **12 constats d'audit ouverts, dont 5 sérieux, qu'aucun `Reste` ne citait.** Ils
  n'existaient que dans `docs/`, donc pas pour qui planifie depuis le journal.
- **7 statuts faux sur 39** dans un backlog en prose : cinq tickets qu'une note de
  section déclarait livrés sans que leur ligne porte la marque, un ✅ qui voulait dire
  « la moitié », un « fait » sans ✅.

---

## Ce que ça ne fait pas

**Il ne confronte pas un item au code.** Aucun script ne peut dire si « la fonction X est
absente » est encore vrai : il faut ouvrir le fichier. Le contrôleur le déclare en toutes
lettres en fin de sortie, avec le compte d'items concernés — un vert qui laisserait croire
le contraire serait pire que pas de contrôle du tout. Dernière passe manuelle en date :
dix items relus, un périmé.

**Sur un dépôt neuf, tout le dérivé est nul.** Pas de commit, donc pas de dernier commit,
pas de silence, pas de front, pas de courbes. Il te reste un dossier structuré et un
contrôleur — utile, mais ce n'est pas encore une confrontation.

**Un dépôt à la fois.** Pas de vue multi-projets.

---

## Pour l'agent

`pilotage/_CLAUDE-bloc.md` contient le bloc à coller dans le `CLAUDE.md` (ou `AGENTS.md`)
du dépôt hôte. Sans lui, l'agent écrit des fiches hors contrat et le contrôleur passe son
temps à protester.

---

## Le contrat

`journal-contrat.mjs` **définit** les règles de lecture ; le serveur et le contrôleur
l'importent tous les deux, pour qu'un vert ne puisse pas vérifier autre chose que ce que
l'écran applique. `pilotage/_TEMPLATE.md` les **décrit**. Ce README ne les redit pas.

Quand un document contredit `journal-contrat.mjs`, c'est le code qui a raison.

---

## Licence

MIT — voir [LICENSE](LICENSE). Copie, modifie, redistribue, y compris dans un produit
fermé ; garde la notice.

Le dépôt était public avec `"license": "MIT"` dans `package.json` et **aucun fichier
LICENSE** : la déclaration ne suffisait pas, le défaut légal restait « tous droits
réservés ». C'est réparé ici.

`"private": true` reste en place, exprès. Il ne bloque que `npm publish`, et rien n'en
dépend : l'installation se fait par l'URL git, mesurée et éprouvée. Le retirer sera le
geste qui accompagne une vraie publication, pas un préalable.
