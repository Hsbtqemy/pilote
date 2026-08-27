// journal-contrat.mjs — les règles de lecture partagées par les deux outils.
//
// Le gros du fichier est le contrat de `pilotage/`. S'y ajoute la lecture du tableau
// de constats d'un audit (`constatsAudit`), qui vit dans `docs/` et non dans
// `pilotage/` : le périmètre est élargi sciemment le 2026-08-21, parce que ce tableau
// est l'autre bout d'une relation que le contrat définit déjà — le `audit:` du
// front-matter d'une fiche. Le contrôleur en tire ses constats ouverts, le serveur
// en tire les codes à remonter vers le chantier. Deux copies de cette lecture
// produiraient des chiffres plausibles et contradictoires.
//
// Extrait de journal.mjs le 2026-08-20. Raison d'être unique : `journal.mjs` (le
// serveur) et `pilotage/verifier.mjs` (le contrôleur) doivent lire EXACTEMENT les
// mêmes règles. Un contrôleur qui vérifierait un contrat différent de celui que
// l'outil applique donnerait un vert sans valeur — ou un rouge sans cause.
//
// Toute évolution du contrat se fait ici. `pilotage/_TEMPLATE.md` le DÉCRIT ; ce
// fichier le DÉFINIT. Quand les deux divergent, c'est le code qui a raison — c'est
// déjà arrivé (le gabarit annonçait que `## QA` portait le rattachement des passes,
// alors qu'il n'est jamais lu ; corrigé le 2026-08-20).

import { readdir } from "node:fs/promises";
import { join, extname } from "node:path";

export const RX = {
  fm:      /^---\r?\n([\s\S]*?)\r?\n---/,
  h1:      /^#\s+(.+)$/m,
  // « Point de départ » est le même artefact sous le mot juste pour un `à venir` :
  // on ne s'est arrêté sur rien. Un seul champ, deux libellés — l'écran affiche celui
  // que la fiche a écrit, et le contrat n'en gagne pas un second.
  //
  // Le libellé est donc CAPTURÉ (groupe 1), le texte suit (groupe 2). La vue le dérivait
  // du statut, ce qui faisait mentir toute fiche `différé` : elle écrit « Point de départ »
  // parce qu'elle n'a rien commencé, et s'affichait « Arrêté sur ». La phrase ci-dessus
  // décrivait depuis le début une règle que rien n'appliquait — mesuré le 2026-08-27 sur
  // un dépôt hôte, six fiches sur vingt-sept.
  arret:   /^\*\*(Arrêté sur|Point de départ)\*\*\s*[—–-]?\s*(.+)$/m,
  box:     /^\s*[-*]\s+\[([ xX])\]\s+(.+)$/,
  h2:      /^##\s+(.+)$/,
  h3:      /^###\s+(.+)$/,
  chantier:/\b(R[0-9](?:\.[0-9])?|[A-Z]{1,4}-[0-9]{1,3}[A-Za-z]?)\b/g,
  decision:/\bD-[PWC][0-9]{1,2}\b/g,
  adr:     /\bADR-[0-9]{3}\b/g,
  docpath: /\b(docs\/[A-Za-z0-9_.\-]+\.md)\b/g
};

// Une case peut tenir sur plusieurs lignes : les suivantes sont indentées, et ne sont
// ni une autre case ni un titre. Le parseur, ligne à ligne, les jetait EN SILENCE —
// ce qui coupait l'item à sa moitié « attendu ». Mesuré le 2026-08-21 sur le dossier :
// 21 cases tronquées, dont 15 DÉJÀ COCHÉES. L'une d'elles, cochée, se lisait « Croiser
// une portée vide — document X et langue fr — » sans plus rien dire de ce qui devait se
// passer : on coche ce qu'on voit.
//
// Le numéro de ligne rendu reste celui de la CASE, donc l'écriture des coches
// (`ecrireCase`) n'est pas concernée : elle vise toujours la bonne ligne.
//
// Monté ici depuis `journal.mjs` le 2026-08-26. C'est une RÈGLE DE LECTURE, et elle
// n'était appliquée que par le serveur : le contrôleur lisait la ligne brute. Le
// contrôle 4 est l'endroit où l'écart s'est vu — un code tombé sur la ligne repliée
// était annoncé « sans item » avec le travail en cours écrit juste au-dessus. Le
// gabarit DÉCRIVAIT déjà le recollage dans ses quatre règles strictes ; le contrat ne
// le DÉFINISSAIT nulle part, et c'est le contrat qui fait foi.
export const suiteDeCase = (lines, i) => {
  const bouts = [];
  for (let j = i + 1; j < lines.length; j++) {
    const l = lines[j];
    if (!l.trim() || !/^\s/.test(l) || RX.box.test(l)) break;
    bouts.push(l.trim());
  }
  return bouts.length ? " " + bouts.join(" ") : "";
};

/** Le texte ENTIER d'une case : la ligne de la case, plus ses lignes repliées.
 *  `RX.box` rend le contenu sans la puce ni la coche ; `suiteDeCase` rend la suite. */
export const texteDeCase = (lines, i) => {
  const b = RX.box.exec(lines[i]);
  return b ? (b[2] + suiteDeCase(lines, i)).trim() : "";
};

// Ce qui interrompt un paragraphe markdown. « Jusqu'à la ligne vide » ne suffisait pas :
// une liste, une citation, un tableau, une règle ou un bloc de code se retrouvaient
// aplatis DANS la phrase — « x : - un - deux ». Aucune fiche des deux dossiers n'écrit
// ça aujourd'hui, mais le docblock ci-dessous promet un paragraphe, et c'est la promesse
// qui fait foi. Le titre est ATX strict (`#` suivi d'une espace, comme
// `RX.h1`/`h2`/`h3`) pour qu'un « #3 » en prose ne coupe pas la phrase ; l'item de liste
// couvre la case, qui n'est qu'un item parmi d'autres.
const FIN_PARAGRAPHE =
  /^\s*(?:#{1,6}\s|[-*+]\s|\d+[.)]\s|>|\||-{3,}\s*$|\*{3,}\s*$|_{3,}\s*$|`{3}|~{3})/;

/** Le lemme d'une fiche — son `Arrêté sur` / `Point de départ` — rendu ENTIER :
 *  `{ libelle, texte }`, ou `null` si la fiche n'en porte pas.
 *
 *  Il tient sur un PARAGRAPHE, pas sur une ligne. La regex est mono-ligne par nature
 *  (`.` ne franchit pas le saut) : elle rendait la première ligne et jetait le reste EN
 *  SILENCE. C'est le jumeau exact du bug des cases (`suiteDeCase`, corrigé le
 *  2026-08-21), à l'endroit où personne ne l'avait vu — aucun contrôle ne regarde le
 *  lemme, et la première ligne se lit très bien : on ne voit pas ce qui manque.
 *
 *  Mesuré le 2026-08-27. Sur les six fiches de CE dépôt, CINQ étaient coupées ; sur les
 *  vingt-sept d'un dépôt hôte, VINGT-SEPT. La moitié perdue porte souvent la conclusion :
 *  « n'a jamais été commencée », « à traiter AVANT toute exposition réseau », « l'option
 *  (c), seule à garantir le zéro-OOM, est restée dehors ». Ce qui restait à l'écran
 *  n'était que le décor de la phrase.
 *
 *  La suite n'est PAS indentée, contrairement à celle d'une case : c'est un paragraphe
 *  markdown ordinaire, qui s'arrête où un paragraphe s'arrête — `FIN_PARAGRAPHE`.
 *  `suiteDeCase` ne pouvait donc pas servir telle quelle.
 *
 *  `RX.arret` garde son `/m` : appliqué ligne à ligne, le drapeau ne sert à rien, mais
 *  il laisse la regex juste sur un texte entier — la forme la plus lisible du champ.
 *
 *  Le décalage y gagne au passage : `c_arreteDecale` cherche un hash dans ce texte, et
 *  une fiche qui citait son commit en deuxième ligne s'annonçait décalée à tort. */
export const lemmeArret = (text) => {
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = RX.arret.exec(lines[i]);
    if (!m) continue;
    const bouts = [m[2].trim()];
    for (let j = i + 1; j < lines.length; j++) {
      const l = lines[j];
      if (!l.trim() || FIN_PARAGRAPHE.test(l)) break;
      bouts.push(l.trim());
    }
    return { libelle: m[1], texte: bouts.join(" ").trim() };
  }
  return null;
};

export const frontmatter = (text) => {
  const m = RX.fm.exec(text); if (!m) return {};
  const o = {};
  for (const l of m[1].split(/\r?\n/)) {
    const k = /^([a-zA-Zé]+):\s*(.*)$/.exec(l);
    if (k) o[k[1]] = k[2].trim();
  }
  return o;
};

/** Les `.md` du dossier, récursivement. Les fichiers préfixés `_` sont écartés :
 *  c'est ainsi que `_TEMPLATE.md` n'apparaît pas comme un chantier. */
export const walk = async (dir) => {
  const out = [];
  let items = []; try { items = await readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const it of items) {
    const p = join(dir, it.name);
    if (it.isDirectory()) out.push(...await walk(p));
    else if (extname(it.name) === ".md" && !it.name.startsWith("_")) out.push(p);
  }
  return out;
};

/** Passe de QA ou fiche de chantier ? La règle est double, et l'ordre compte :
 *  un `passe:` dans le frontmatter suffit, le dossier `qa/` aussi. */
export const estPasse = (rel, fm) => fm.passe !== undefined || rel.includes("/qa/");

/** Statuts admis pour un chantier. Absent ⇒ `interrompu` (journal.mjs).
 *  `à venir` : cadré, pas commencé — une fiche écrite AVANT le premier commit de code.
 *  Sans lui, un chantier neuf s'annonçait « interrompu », ce qui dit qu'on s'est arrêté
 *  en plein travail alors que rien n'a commencé. Le journal le dément mécaniquement dès
 *  qu'un commit de code cite le code (voir `commitsCode`).
 *
 *  `différé` : mis en attente exprès, parce qu'autre chose doit aboutir d'abord. Il
 *  était implémenté par la VUE — bac propre, pastille, compté comme ouvert — mais
 *  absent d'ici, donc REFUSÉ par le contrôleur : l'écrire donnait un écran juste et un
 *  contrôleur rouge. Les deux moitiés de l'outil se contredisaient.
 *
 *  Il n'a pas de démenti mécanique, et c'est délibéré : `commitsCode` compte sur toute
 *  la fenêtre, sans savoir ce qui précède la mise en attente. Le démenti se déclencherait
 *  sur l'historique légitime d'avant. Il en faudrait une date, que la fiche ne porte pas.
 *
 *  `livré` : intégré. C'est le seul statut qui parle d'INTÉGRATION, et l'outil la mesure
 *  déjà — `ch.front` dit sur quelle ref vit le dernier commit du chantier, et si cette ref
 *  est une ref d'intégration. Il a longtemps été purement déclaratif : reproduit le
 *  2026-08-26 sur un dépôt jetable, une fiche `livré` dont le dernier commit vivait sur
 *  `feat/r9`, absente de la ref d'intégration, était rangée « Clos et livrés » sans que
 *  rien ne signale l'écart. Il a désormais son démenti, comme `à venir` : déclarer
 *  l'intention, laisser le journal la contredire. Sans front mesurable — un chantier
 *  livré sans aucun commit — on ne dit rien, comme pour un `Arrêté sur` sans dernier.
 *
 *  `abandonné` : décidé de ne pas le faire. Fermé, mais PAS fait — et c'est exactement
 *  ce qui manquait : sans le mot, on supprime le fichier et le raisonnement part avec.
 *  Une fiche abandonnée garde son `Reste` ouvert exprès ; c'est la trace de ce qu'on a
 *  renoncé à faire, pas un reliquat.
 *
 *  Il n'a pas de démenti mécanique, pour la raison exacte de `différé` : il faudrait la
 *  date de l'abandon, et la fiche ne la porte pas. Un commit citant le code APRÈS coup
 *  serait un vrai démenti ; `commitsCode` compte sur toute la fenêtre et se déclencherait
 *  sur le travail légitime d'avant la décision. */
export const STATUTS = ["à venir", "interrompu", "clos", "différé", "livré", "abandonné"];

// Un constat est OUVERT si sa colonne sévérité porte une de ces pastilles ; ✅ ou
// barré valent clos. `reconnu` distingue « aucun constat ouvert » de « je ne sais pas
// lire ce document » — sans cette garde, un audit d'une autre forme afficherait « 0
// ouvert », un vert qui ne mesure rien.
export const SEVERITES_OUVERTES = ["🔴", "🟠", "🟡", "🟢"];

// Deux formes de constat coexistent dans la documentation d'un dépôt, et les lire
// toutes les deux coûte moins cher que de renuméroter les audits — un code d'audit
// finit cité partout, jusque dans les fichiers de CI.
//
//  · TABLEAU   `| A-01 | 🔴 | constat | preuve |`
//    Le préfixe va de UNE à cinq lettres : `A-01`, `Q-01`, `T-01` étaient muets sous
//    un ancien `{2,5}`. Un code barré (`| ~~A-05~~ |`) ne matche pas, donc n'est pas
//    compté : c'est voulu, il est retiré.
//  · TITRE     `### IMP-01 ✔ — 🔴 P0 — …`
//    Collecté SEULEMENT s'il porte une pastille, et clos s'il porte ✔ ou ✅ — la
//    pastille y est la SÉVÉRITÉ, pas l'état, si bien qu'un `✔ — 🔴` compterait
//    ouvert sans cette seconde lecture.
//
// La condition de pastille n'est pas une commodité. Un backlog mesuré portait des
// codes en titre (`### C-1 — …`) et AUCUNE sévérité : le collecter le faisait passer
// « reconnu, 0 ouvert » alors que six items y étaient ouverts — un vert qui ne mesure
// rien, précisément ce que `reconnu` existe pour empêcher. Il reste INCONNU, et c'est
// le document qu'il faut alors corriger, pas cette règle.
const CLOS_EN_TITRE = ["✔", "✅"];

export const constatsAudit = (texte) => {
  // Clé = le code, et le TABLEAU gagne. Un audit mesuré portait les DEUX formes — un
  // tableau de 24 lignes ET une section `### CODE-NN` par constat — et les additionner
  // faisait passer son compte de 16 à 38 ouverts. Le tableau est l'index
  // canonique : lui seul porte l'état (✅, code barré) ; la section ne porte que le
  // détail, et n'y répète pas la clôture.
  const parCode = new Map();
  for (const [, code, sev] of texte.matchAll(/^\|\s*([A-Z]{1,5}-\d+)\s*\|\s*([^|]*?)\s*\|/gm))
    if (!parCode.has(code))
      parCode.set(code, { code, sev, ouvert: SEVERITES_OUVERTES.some(s => sev.includes(s)) });
  for (const [, code, reste] of texte.matchAll(/^#{2,4}\s+([A-Z]{1,5}-\d+)\b(.*)$/gm)) {
    if (parCode.has(code)) continue;
    // `sev` vaut LA PASTILLE SEULE, comme en forme tableau : les appelants s'en servent
    // de clé de regroupement (`parSeverite[sev]`), et y verser tout le reste du titre
    // fabriquait un seau par constat au lieu d'un seau par sévérité.
    const pastille = SEVERITES_OUVERTES.find(s => reste.includes(s));
    if (!pastille) continue;
    parCode.set(code, { code, sev: pastille, ouvert: !CLOS_EN_TITRE.some(m => reste.includes(m)) });
  }
  const constats = [...parCode.values()];
  return { reconnu: constats.length > 0, constats };
};
