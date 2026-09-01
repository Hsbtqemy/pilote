#!/usr/bin/env node
// Journal de bord — serveur local.
//   pilote            [--port 4123] [--dir pilotage] [--days 60]
//   pilote verifier   [--dir pilotage] [--strict] [--json]
//   pilote arreter    [--port 4123]
//   pilote exporter   [dossier]
// Sélecteur de journaux : --voisins 4120-4130 (défaut) ou --voisins 4123,4200
// Aucune dépendance. Node 18+.

import { createServer, get as httpGet } from "node:http";
import { execFileSync } from "node:child_process";
import { readFile, writeFile, readdir, mkdir } from "node:fs/promises";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, relative, basename, dirname, isAbsolute } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
// Contrat de parsing partage avec pilotage/verifier.mjs -- voir journal-contrat.mjs.
import { RX, frontmatter, walk, estPasse, constatsAudit, texteDeCase, lemmeArret } from "./journal-contrat.mjs";


const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i > -1 ? args[i + 1] : d; };
const PORT = Number(opt("port", 4123));
const DIR  = opt("dir", "pilotage");
const DAYS = Number(opt("days", 60));
const ROOT = process.cwd();
// Où vit l'OUTIL, par opposition à où vit le DÉPÔT. Lancé par `npx`, le serveur est
// dans node_modules et le dépôt est le cwd. Confondre les deux, c'est chercher la vue
// et le contrôleur dans le projet de l'utilisateur — qui ne les a pas. Sur un dépôt
// qui héberge l'outil lui-même, les deux coïncident et rien ne change.
const OUTIL = dirname(fileURLToPath(import.meta.url));
// Longueur de la traînée de commits affichée sur une fiche.
const TRAINEE = Number(opt("trainee", 5));

// L'aide vient EN PREMIER : elle ne sonde aucun port, ne lit ni git ni le dossier, et
// répond même dans un répertoire qui n'est pas un dépôt. Sans elle, `pilote --help`
// ignorait le drapeau et lançait le serveur — on demandait la liste des commandes et on
// obtenait autre chose, ce qui est la pire réponse possible à une question de débutant.
//
// C'est aussi le SEUL endroit qui liste tout. Le README et le bloc CLAUDE en montrent ce
// qui sert à démarrer et renvoient ici : trois listes à tenir à jour en donneraient deux
// de fausses.
if (args.includes("--help") || args.includes("-h") || args[0] === "aide") {
  console.log(`pilote — journal de bord local. Confronte un dossier pilotage/ à ce que git montre.

COMMANDES
  pilote                ouvre le journal sur localhost:4123
  pilote arreter        ferme le journal
  pilote exporter <dir> écrit un export statique lisible partout (défaut : journal-export)
  pilote verifier       contrôle le dossier ; code de retour non nul = l'outil lira mal
  pilote aide           ceci  (aussi --help, -h)

OPTIONS DU JOURNAL
  --port <n>        défaut 4123
  --dir <nom>       dossier des fiches, défaut « pilotage »
  --days <n>        fenêtre de commits lue, en jours ; défaut 60
  --refs <a,b,c>    refs d'intégration, de l'amont vers l'aval, séparées par des virgules ;
                    défaut : celles de l'inventaire, sinon origin/main
  --trainee <n>     commits affichés sous une fiche, défaut 5
  --web <url>       base des liens de fichier de l'export ; sinon dérivée du remote
  --voisins <p-p>   plage de ports balayée pour le sélecteur de journaux, ou liste
                    séparée par des virgules ; défaut : les huit ports autour du sien

OPTIONS DU CONTRÔLEUR
  --dir <nom>       comme ci-dessus
  --strict          un avertissement suffit alors à faire échouer
  --json            sortie machine plutôt que lisible

LANCER
  La commande du journal se retape sans vérifier si un serveur tourne. Elle sonde le port
  et agit : rien ne tourne, elle démarre ; ton journal tourne déjà, elle donne l'adresse
  et sort ; l'outil a été mis à jour depuis, elle remplace le serveur périmé ; le port
  sert un autre dépôt ou un autre programme, elle le dit et le nomme.

CE QUI VIT DANS TON DÉPÔT, PAS DANS L'OUTIL
  pilotage/<CODE>.md           une fiche de chantier
  pilotage/qa/<nom>.md         une passe de QA rejouable
  pilotage/_TEMPLATE.md        le gabarit, qui décrit le contrat
  pilotage/journal.config.mjs  l'inventaire — facultatif ; sans lui on perd les masses
                               par aire, la veille à seuil et les liens code → document

  Le journal est en LECTURE SEULE, sauf les cases à cocher, dont l'écriture est bornée
  au dossier des fiches.`);
  process.exit(0);
}

// Un seul point d'entrée. Le dépôt hôte n'a plus à héberger l'outil : ni le serveur,
// ni la vue, ni le contrat, ni le contrôleur — qui vivait dans `pilotage/` mais
// importait `../journal-contrat.mjs`, ce qui rendait les quatre fichiers indissociables
// et forçait à les recopier ensemble à chaque lot.
//
// Un second binaire aurait obligé l'appelant à connaître son nom interne
// (`npx --package … pilote-verifier`) ; une sous-commande se retient. Le contrôleur lit
// `process.argv` lui-même et trouve ses drapeaux par nom : le mot `verifier` en tête ne
// le gêne pas. Il finit sur `process.exit`, donc l'import ne rend jamais la main.
if (args[0] === "verifier") await import(pathToFileURL(join(OUTIL, "pilotage/verifier.mjs")).href);

// ---------- lancer sans avoir à y penser ----------
// `pilote` doit pouvoir se taper à tout moment. Avant, `.listen()` sur un port déjà pris
// crachait douze lignes de pile Node (`EADDRINUSE`) qui ne distinguaient même pas les
// trois situations : ton propre journal déjà en route — le cas courant, et il n'y a rien
// à faire —, une version périmée de l'outil, ou un autre programme sur le port.
//
// L'empreinte est le mtime des trois fichiers de l'outil. Un serveur en cours garde
// `journal.mjs` en mémoire ; seul `journal.html` est relu à chaque requête. Une mise à
// jour du paquet laisse donc un moteur ancien servir une vue neuve. La vue affiche déjà
// un bandeau quand elle le détecte, mais après coup — ici c'est réglé au lancement.
const empreinte = () => ["journal.mjs", "journal.html", "journal-contrat.mjs"]
  .map(f => { try { return Math.round(statSync(join(OUTIL, f)).mtimeMs); } catch { return 0; } })
  .join("-");

// FIGÉE AU DÉMARRAGE, et c'est tout l'intérêt. Un serveur qui recalculerait son
// empreinte à chaque requête lirait le disque courant — donc exactement ce que lit le
// lanceur, donc toujours d'accord avec lui, donc incapable de se dire périmé. Première
// version écrite ainsi : mettre l'outil à jour puis relancer répondait « déjà en route »
// et laissait tourner le vieux moteur, ce que la fonction était censée empêcher.
// Ici la valeur dit « voilà l'outil que j'ai CHARGÉ », qui est la seule chose vraie
// d'un processus en cours.
const EMPREINTE = empreinte();

// Sonde en `node:http` brut, délibérément : il ne lit pas `HTTP_PROXY`, contrairement à
// la plupart des clients. Un proxy d'entreprise qui intercepte la boucle locale
// répondrait à la place du serveur, et la sonde mentirait.
const sonde = (port, ms = 900) => new Promise(resolve => {
  const req = httpGet({ host: "127.0.0.1", port, path: "/pilote", timeout: ms },
    res => { let b = ""; res.on("data", c => b += c);
             res.on("end", () => { try { resolve(JSON.parse(b)); } catch { resolve(null); } }); });
  req.on("error", () => resolve(null));
  req.on("timeout", () => { req.destroy(); resolve(null); });
});

// ---------- les journaux voisins ----------
// Passer d'un journal à l'autre sans que le moteur sache lire plusieurs dépôts. La carte
// d'identité `/pilote` dit déjà quelle racine sert un port : balayer une petite plage
// suffit à dresser la liste des journaux ouverts, avec leur dépôt.
//
// C'est délibérément l'inverse du multi-racine dans le moteur. Celui-ci coûterait de
// passer ROOT, DIR, CFG, REFS, DOCS, VEILLE et TETE en contexte — 55 références dans un
// fichier de 894 lignes — et de mémoïser par racine ce qui l'est aujourd'hui par tête.
// Le balayage donne le même geste à l'écran pour un coût mesuré à 19 ms, et chaque
// serveur reste ce qu'il est : un dépôt, une config, un contrôleur.
//
// Un port qui répond autre chose est ignoré par construction : la sonde rend `null` dès
// que la réponse n'est pas le JSON attendu.
const PLAGE = (opt("voisins", "") || `${PORT - 3}-${PORT + 4}`);
const portsVoisins = () => {
  const m = String(PLAGE).match(/^(\d+)-(\d+)$/);
  const l = m ? Array.from({ length: Math.max(0, Math.min(16, +m[2] - +m[1] + 1)) }, (_, i) => +m[1] + i)
              : String(PLAGE).split(",").map(s => Number(s.trim())).filter(Boolean);
  return l.filter(p => p > 0 && p < 65536 && p !== PORT);
};
const voisins = async () => (await Promise.all(portsVoisins().map(p => sonde(p, 250))))
  .map((v, i) => v && v.pilote ? { port: portsVoisins()[i], racine: v.racine,
                                   nom: String(v.racine).split(/[\\/]/).filter(Boolean).pop() } : null)
  .filter(Boolean);

// `exporter` ne sert rien : il ne doit NI sonder le port, NI remplacer quoi que ce soit.
// Écrit sans cette garde, il tuait le serveur en cours parce qu'il le trouvait « périmé » —
// une commande de lecture qui coupe la session de travail de celui qui la tape. La sonde
// est sautée plutôt que ses conséquences filtrées : ne rien demander est plus sûr que
// demander puis ignorer.
let enRoute = args[0] === "exporter" ? null : await sonde(PORT);

if (args[0] === "arreter") {
  if (!enRoute) { console.log(`Rien ne tourne sur le port ${PORT}.`); process.exit(0); }
  // `arreter` agit sur un PORT, pas sur un dépôt : on peut fermer depuis n'importe où,
  // ce qui est le geste utile quand on a oublié d'où on l'avait lancé. Mais fermer le
  // journal d'un autre dépôt sans le dire serait une surprise — donc on le nomme.
  if (enRoute.racine !== ROOT) console.log(`Ce port sert le journal d'un autre dépôt : ${enRoute.racine}`);
  try { process.kill(enRoute.pid); console.log(`Journal arrêté — port ${PORT}, pid ${enRoute.pid}.`); }
  catch (e) { console.error(`Impossible d'arrêter le pid ${enRoute.pid} : ${e.message}`); process.exit(1); }
  process.exit(0);
}

if (enRoute && enRoute.racine !== ROOT) {
  console.error(`Le port ${PORT} sert déjà le journal d'un AUTRE dépôt :`);
  console.error(`  ${enRoute.racine}`);
  console.error(`Relance avec --port sur un autre numéro,`);
  console.error(`ou ferme celui-là par « pilote arreter --port ${PORT} » — qui marche d'ici.`);
  process.exit(1);
}

if (enRoute && enRoute.empreinte === empreinte()) {
  // De loin le cas le plus fréquent, et le seul qui plantait bruyamment pour rien.
  console.log(`Journal déjà en route  →  http://localhost:${PORT}`);
  console.log(`${ROOT}  ·  ${enRoute.dir}/  ·  pid ${enRoute.pid}  ·  « pilote arreter » pour le fermer`);
  process.exit(0);
}

if (enRoute) {
  // Même dépôt, outil différent : c'est le « serveur périmé » que la vue signale trop
  // tard. On le remplace, puisque personne d'autre ne s'en sert.
  console.log(`Serveur périmé sur le port ${PORT} (outil mis à jour depuis) — on le remplace.`);
  try { process.kill(enRoute.pid); } catch { /* déjà mort : tant mieux */ }
  // Attendre qu'il lâche vraiment le port : tuer est asynchrone, et se précipiter sur
  // `.listen()` redonnerait l'EADDRINUSE qu'on vient de supprimer.
  for (let i = 0; i < 60 && await sonde(PORT); i++) await new Promise(r => setTimeout(r, 50));
}

// ---------- ce que le journal sait de ce dépôt ----------
// Tout ce qui nomme des chemins, des fichiers ou des codes vit dans
// `pilotage/journal.config.mjs`, à côté du dossier qu'il décrit. Le fichier est
// facultatif : sans lui, on garde le dossier (fiches, passes, cases, contrôleur,
// front d'intégration) et on perd ce qui exige de connaître le dépôt — les masses
// par aire, la veille à seuil, les liens code → document.
// `documentation` porte deux natures qu'il fallait séparer. Le NOM DU DOSSIER est de
// l'inventaire : il sert à distinguer un commit de cadrage d'un commit de code, et son
// absence ne rendait pas ce test muet — elle le faisait SUR-DÉCLENCHER, une note de
// conception comptant alors comme du code et démentant un `à venir` qui était juste.
// D'où une convention plutôt qu'un réglage : `docs/` par défaut, ce qui ne coûte rien à
// un dépôt qui n'en a pas. Les SOURCES, elles, décrivent quels fichiers portent quels
// codes : ça reste de la grammaire, et son absence ne coûte que des liens.
const DEFAUT = {
  refs: ["origin/main"],
  codes: { chantier: RX.chantier, decision: RX.decision, adr: RX.adr },
  documentation: { dossier: "docs", sources: [] },
  aires: [],
  veille: null
};
const CFG = await (async () => {
  const p = join(ROOT, DIR, "journal.config.mjs");
  if (!existsSync(p)) return DEFAUT;
  // `import()` d'un chemin Windows nu échoue : il faut une URL file://.
  const m = await import(pathToFileURL(p).href).catch(e => {
    console.error(`config illisible (${p}) : ${e.message} — on continue sans.`);
    return null;
  });
  // Fusion imbriquée : à plat, déclarer `documentation.sources` seul effacerait le
  // dossier par défaut, et déclarer un seul motif de `codes` effacerait les deux autres.
  const c = m ? (m.default || m) : {};
  return { ...DEFAUT, ...c,
    codes: { ...DEFAUT.codes, ...(c.codes || {}) },
    documentation: { ...DEFAUT.documentation, ...(c.documentation || {}) } };
})();

// Refs d'intégration, de l'amont vers l'aval. Un chantier vit sur la première qui
// contient son dernier commit ; à défaut sur la branche courante, donc pas intégré.
const REFS = opt("refs", CFG.refs.join(","))
  .split(",").map(s => s.trim()).filter(Boolean);

// Lecture synchrone tolérante : un document annoncé par une fiche peut avoir disparu.
const lireSync = (p) => { try { return readFileSync(p, "utf8"); } catch { return null; } };

// Rend null quand la commande ÉCHOUE, "" quand elle réussit sans rien dire. `git()` écrase
// les deux, ce qui convient partout où une absence vaut zéro — mais pas là où un zéro
// serait lui-même une mesure. Payé une fois : un `--format=@` invalide (git y lit un NOM
// de format) faisait rendre "" pour chaque audit, donc « 0 commit depuis » sur les dix,
// un vert parfaitement faux.
//
// stderr ignoré : sur un dépôt sans commit, git écrit huit `fatal:` sur la console avant
// que le journal ait rendu sa première page. C'est le `catch` qui décide, pas le bruit.
const gitEssai = (...a) => {
  try { return execFileSync("git", a,
    { cwd: ROOT, encoding: "utf8", maxBuffer: 64e6, stdio: ["ignore", "pipe", "ignore"] }).trim(); }
  catch { return null; }
};

const git = (...a) => gitEssai(...a) ?? "";

// ---------- lecture de pilotage/ ----------
async function pilotage() {
  const files = await walk(join(ROOT, DIR));
  const chantiers = [], passes = [];

  for (const abs of files) {
    const rel = relative(ROOT, abs).split(/[\\/]/).join("/");
    const text = await readFile(abs, "utf8");
    const fm = frontmatter(text);
    const lines = text.split(/\r?\n/);
    const titre = (RX.h1.exec(text) || [, basename(rel, ".md")])[1];

    if (estPasse(rel, fm)) {
      // --- passe de QA : cases regroupées par H3 ---
      const zones = []; let cur = null;
      lines.forEach((l, i) => {
        const h3 = RX.h3.exec(l);
        if (h3) { cur = { nom: h3[1].trim(), items: [] }; zones.push(cur); return; }
        const b = RX.box.exec(l);
        if (b) {
          if (!cur) { cur = { nom: "Général", items: [] }; zones.push(cur); }
          cur.items.push({ texte: texteDeCase(lines, i), fait: b[1].toLowerCase() === "x", ligne: i + 1 });
        }
      });
      const tot = zones.reduce((n, z) => n + z.items.length, 0);
      passes.push({
        file: rel, nom: fm.passe || titre, titre,
        chantier: (fm.chantier && fm.chantier !== "—") ? fm.chantier : null,
        duree: fm.duree || null,
        derniere: (fm.derniere && fm.derniere !== "—") ? fm.derniere : null,
        intro: intro(text), zones, total: tot,
        faits: zones.reduce((n, z) => n + z.items.filter(i => i.fait).length, 0)
      });
    } else {
      // --- fiche de chantier ---
      // Le `Reste` accepte les mêmes zones `###` qu'une passe. Sans elles, une fiche
      // à seize items aplatit des groupes qui existent déjà — trois items T6 qui ont
      // un ordre, trois sur l'annulation, quatre arbitrages — et oblige à tout
      // re-trier de tête à chaque ouverture. Zone nulle = liste simple, comme avant.
      const reste = []; let section = null, zone = null;
      lines.forEach((l, i) => {
        const h2 = RX.h2.exec(l);
        if (h2) { section = h2[1].trim().toLowerCase(); zone = null; return; }
        const h3 = RX.h3.exec(l); if (h3) { zone = h3[1].trim(); return; }
        const b = RX.box.exec(l);
        if (b && section === "reste")
          reste.push({ texte: texteDeCase(lines, i),
                       fait: b[1].toLowerCase() === "x", ligne: i + 1, zone });
      });
      // Le lemme rend son libellé avec son texte : la vue affiche le mot que la FICHE a
      // écrit, elle ne le redéduit pas du statut (voir `RX.arret`).
      const lemme = lemmeArret(text);
      chantiers.push({
        file: rel, code: fm.chantier || basename(rel, ".md"), titre,
        statut: fm.statut || "interrompu",
        audit: fm.audit || null,
        arrete: lemme ? lemme.texte : null,
        arreteLibelle: lemme ? lemme.libelle : null,
        reste, contexte: bloc(text, "Contexte")
      });
    }
  }
  return { chantiers, passes };
}

const intro = (text) => {
  const t = text.replace(RX.fm, "").replace(RX.h1, "");
  const cut = t.search(/^###\s+/m);
  return (cut > -1 ? t.slice(0, cut) : t).trim();
};

const bloc = (text, nom) => {
  const lines = text.split(/\r?\n/); let on = false; const out = [];
  for (const l of lines) {
    const h2 = RX.h2.exec(l);
    if (h2) { on = h2[1].trim().toLowerCase() === nom.toLowerCase(); continue; }
    if (on) out.push(l);
  }
  return out.join("\n").trim();
};

// ---------- git ----------
function historique() {
  const jours = [...new Set(git("log", "--all", "--format=%ad", "--date=short").split("\n").filter(Boolean))].sort();
  const raw = git("log", "--all", "--format=%h\x1f%H\x1f%ad\x1f%s\x1f%b\x1e", "--date=short");
  const commits = raw.split("\x1e").map(c => c.trim()).filter(Boolean).map(c => {
    const [hash, full, date, sujet, corps] = c.split("\x1f");
    const sc = /^([a-z]+)(?:\(([^)]+)\))?:/.exec(sujet || "");
    return { hash, full, date, sujet: sujet || "", corps: (corps || "").trim(),
             type: sc ? sc[1] : null, scope: sc ? (sc[2] || sc[1]) : "—" };
  });
  return { jours, commits };
}

const joursActifs = (jours, depuis) => jours.filter(j => j > depuis).length;

// Remontée des codes de constat vers leur chantier. Le travail réel cite le constat
// (`ALI-10`), jamais le chantier (`R3`) : sans ça, le chantier n'est daté que par les
// notes qu'on écrit SUR lui. Trois gardes, parce que les audits se citent entre eux :
//   — le code doit venir du TABLEAU de constats, pas de la prose : un audit en
//     mentionne un autre en renvoi, son tableau non ;
//   — l'audit doit n'être possédé que par UNE fiche — mesuré : un même audit cité par
//     quatre chantiers verrait ses orphelins remonter aux quatre ;
//   — le code ne doit pas avoir de fiche à lui.
// Les constats clos comptent aussi : un commit citant `ALI-10` est du travail sur son
// chantier, que le constat soit soldé ou non.
async function remontee(chantiers) {
  const fiches = new Set(chantiers.map(c => c.code));
  const proprio = {};
  for (const c of chantiers) if (c.audit) (proprio[c.audit] ||= []).push(c.code);
  const out = {};
  for (const c of chantiers) {
    if (!c.audit || proprio[c.audit].length !== 1) continue;
    const texte = await readFile(join(ROOT, c.audit), "utf8").catch(() => "");
    const { reconnu, constats } = constatsAudit(texte);
    if (!reconnu) continue;
    const codes = [...new Set(constats.map(x => x.code))].filter(x => !fiches.has(x));
    if (codes.length) out[c.code] = codes;
  }
  return out;
}

// Un `Arrêté sur` est décalé s'il ne cite pas le dernier commit du chantier — y
// compris quand il ne cite aucun hash du tout. Sans `dernier`, on ne peut rien dire.
const c_arreteDecale = (ch) => {
  if (!ch.arrete || !ch.dernier) return false;
  const cites = ch.arrete.match(/\b[0-9a-f]{7,40}\b/g) || [];
  return !cites.some(h => ch.dernier.hash.startsWith(h) || h.startsWith(ch.dernier.hash));
};

const echappe = (c) => c.replace(/[.]/g, "\\.");
const rxCodes = (codes) =>
  new RegExp(`(^|[^A-Za-z0-9-])(${codes.map(echappe).join("|")})([^A-Za-z0-9-]|$)`);

// Un commit qui touche 3 CHANTIERS ou plus est un fourre-tout : il ne date rien.
// Compter les codes bruts serait faux depuis la remontée — un commit citant ALI-01,
// ALI-10 et ALI-22 est du R3 pur, pas un fourre-tout.
//
// Le compte se fait sur le vocabulaire DÉCLARÉ — les codes des fiches, plus ceux qu'elles
// remontent de leurs audits — et non sur un motif générique. Un motif ne sait pas ce qui
// est un chantier ICI : mesuré sur un dépôt réel, il prenait ADR-043 pour un chantier
// dans douze sujets, et comptait R3.3 comme distinct de R3 alors que c'en est une
// tranche. L'écart total est de huit verdicts sur mille cent quatre-vingt-deux, dont six
// sans conséquence — le sujet ne cite alors aucun chantier connu et ne date rien.
//
// La DÉCOUVERTE, elle, garde son motif : index() doit reconnaître des codes qu'aucune
// fiche ne déclare, pour renvoyer vers le document qui les a écrits. Attribuer demande un
// vocabulaire, découvrir demande un motif — ce ne sont pas le même besoin, et le second
// ne fausse que des liens, jamais un datage.
const fourretout = (sujet, rx, proprietaire) =>
  new Set([...sujet.matchAll(rx)].map(m => proprietaire[m[2]] || m[2])).size >= 3;

// Le motif qui EXTRAIT d'un sujet tous les codes connus du dossier. Trié du plus long au
// plus court : sans ça, R6 masquerait R6.5 dans l'alternance si les deux étaient déclarés.
const rxVocabulaire = (codes) => new RegExp(
  "(^|[^A-Za-z0-9-])(" + [...codes].sort((a, b) => b.length - a.length).map(echappe).join("|")
  + ")(?=[^A-Za-z0-9-]|$)", "g");

// Les commits d'un chantier, du plus récent au plus ancien. `tenue` = ceux qui ne
// touchent que `pilotage/` : tenir le dossier n'est pas travailler sur le chantier
// dont on parle — sans cette garde, une note « recompter l'item de R3 » remettait le
// silence de R3 à zéro.
const commitsDuChantier = (commits, codes, rxVoc, proprietaire, tenue) => {
  const rx = rxCodes(codes);
  return commits.filter(c =>
    rx.test(c.sujet) && !fourretout(c.sujet, rxVoc, proprietaire) && !tenue.has(c.hash));
};

// Front d'intégration : jusqu'où le travail est remonté. Dérivé, jamais déclaré.
function fronts() {
  const set = (r) => new Set(git("rev-list", r).split("\n").filter(Boolean));
  const l = REFS.map(nom => ({ nom, integre: true, hashes: set(nom) })).filter(f => f.hashes.size);
  const tete = git("rev-parse", "--abbrev-ref", "HEAD");
  if (tete && tete !== "HEAD" && !REFS.includes(tete))
    l.push({ nom: tete, integre: false, hashes: set(tete) });
  return l;
}

// ---------- masses de code ----------
// Les aires viennent de la config du dépôt (voir `pilotage/journal.config.mjs`) :
// un préfixe de chemin chacune, le premier qui matche l'emporte. Les tailles sont
// le cumul de `--numstat` : vérifié exact au fichier près sur 6 aires, à condition
// de désactiver la détection de renommage (sinon le chemin sort en
// `{ancien => nouveau}`). Sans aires déclarées, l'onglet reste vide — mais la passe
// tourne quand même : c'est elle qui repère les commits de tenue.
const AIRES = CFG.aires;
// Les NOMS distincts, pas les entrées : plusieurs préfixes peuvent porter le même nom
// d'aire — l'inventaire l'annonce et les dépôts s'en servent — et ils doivent
// s'ADDITIONNER en une série, pas se dupliquer en autant de copies.
//
// `cum`/`serie` sont déjà indexés par nom, donc le cumul était juste ; c'est le
// PARCOURS qui ne l'était pas. `graver()` itérait les entrées : une aire déclarée six
// fois recevait six points par mois, et la ligne finale sortait six fois. Mesuré le
// 2026-08-27 sur un dépôt hôte — `noyau` en six préfixes, `docs` en deux :
//
//   noyau  série de 18 points pour 3 mois, delta annoncé 0      (vrai : +857)
//   docs   série de  6 points pour 3 mois, delta annoncé -152   (vrai : +1474)
//
// Le delta se prend `fenetre` points en arrière : sur une série gonflée, il remontait
// 3 POINTS et non 3 mois — une demi-fenêtre pour `noyau`. `docs` en sortait avec le
// mauvais SIGNE, annoncé en recul alors qu'il grossit, et le tri par |delta| — qui est
// tout l'intérêt de l'écran — classait les deux aires à la cave. La courbe, elle, était
// tracée contre un axe de 3 mois avec 18 valeurs.
const NOMS = [...new Set(AIRES.map(([n]) => n))];
// Le dossier de documentation du dépôt, quand il est déclaré : sert à distinguer un
// commit de cadrage (note + fiche) d'un commit de code. Sans config, aucun démenti.
const DOCS = CFG.documentation.dossier;

// `fenetre` en mois : sur 6 le delta égale presque la masse et le classement retombe
// sur la taille ; sur 3 les reculs ressortent (screens, ui) et le tri dit qui bouge.
// La passe --numstat coûte ~2,5 s sur 1 000 commits : mémorisée sur le hash de HEAD,
// sinon chaque coche de case repayerait le parcours complet de l'historique.
const masses = (seuil = 1000, fenetre = 3) => surTete("masses", () => calculMasses(seuil, fenetre));

function calculMasses(seuil, fenetre) {
  const aire = (p) => { for (const [n, pre] of AIRES) if (p === pre || p.startsWith(pre)) return n; return null; };
  const raw = git("log", "--reverse", "--no-renames", "--numstat",
                  "--format=@%h\x1f%ad\x1f%s", "--date=short");
  if (!raw) return null;

  const cum = {}, serie = {}, mois = [], jalons = [], tenue = [], redaction = [];
  for (const n of NOMS) { cum[n] = 0; serie[n] = []; }
  let m = null, c = null, net = 0, nf = 0, npil = 0, ndoc = 0;
  const clore = () => {
    if (!c) return;
    if (net <= -seuil) jalons.push({ ...c, delta: net });
    // Ne touche que `pilotage/` : de la tenue de dossier, pas du travail daté.
    if (nf > 0 && nf === npil) tenue.push(c.hash);
    // Ne touche que `pilotage/` et la doc : du cadrage écrit, pas du code. Sert au
    // seul démenti du statut `à venir` — surtout PAS au silence, où écrire une note
    // de conception est un vrai travail sur le chantier.
    if (nf > 0 && nf === npil + ndoc) redaction.push(c.hash);
  };
  const graver = () => { mois.push(m); for (const n of NOMS) serie[n].push(cum[n]); };

  for (const l of raw.split("\n")) {
    if (l.startsWith("@")) {
      clore();
      const [hash, date, sujet] = l.slice(1).split("\x1f");
      const mm = date.slice(0, 7);
      if (m && m !== mm) graver();
      m = mm; c = { hash, date, sujet }; net = 0; nf = 0; npil = 0; ndoc = 0;
      continue;
    }
    const f = l.split("\t");
    if (f.length < 3 || !/^\d+$/.test(f[0])) continue;   // binaire (`-`) ou ligne vide
    const n = Number(f[0]) - Number(f[1]);
    net += n; nf++;
    if (f[2].startsWith(DIR + "/")) npil++;
    else if (DOCS && f[2].startsWith(DOCS + "/")) ndoc++;
    const a = aire(f[2]); if (a) cum[a] += n;
  }
  clore();
  if (m) graver();

  const aires = NOMS.map(nom => {
    const v = serie[nom], tot = v[v.length - 1] || 0;
    return { nom, valeurs: v, total: tot, delta: tot - (v[Math.max(0, v.length - 1 - fenetre)] ?? 0) };
  }).filter(a => a.total > 0).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  return { mois, fenetre, aires, tenue, redaction,
           jalons: jalons.sort((a, b) => a.delta - b.delta).slice(0, 8) };
}

// ---------- veille à seuil ----------
// Le seul chiffre du tableau de bord qui ait une limite réelle ; déclaré par dépôt
// (voir `pilotage/journal.config.mjs`). Absent = pas de bandeau de veille.
const VEILLE = CFG.veille;

// Mémo sur le hash de HEAD : ce qui ne dépend que de l'historique se recalcule au commit
// suivant, pas à chaque coche de case. (Le contrôleur, lui, lit les fichiers de
// `pilotage/` — il doit rester vivant, il n'est pas mémorisé.)
//
// La tête est lue UNE fois par requête, pas à chaque consultation de clé. Mesuré : avec
// une quarantaine de clés, `rev-parse HEAD` était appelé 47 fois et coûtait 1,16 s — le
// mémo dépensait plus qu'il n'économisait. `build()` remet le cache à zéro en entrant.
const memos = new Map();
let TETE = null;
const tete = () => TETE ?? (TETE = git("rev-parse", "HEAD"));
const surTete = (cle, fn) => {
  const t = tete(), m = memos.get(cle);
  if (t && m && m.tete === t) return m.val;
  const val = fn();
  memos.set(cle, { tete: t, val });
  return val;
};

// Quand chaque document est entré dans le dépôt. Le nom de fichier porte souvent la date,
// mais pas toujours, et il peut mentir : `--diff-filter=A` la donne pour n'importe quel
// fichier, sans convention de nommage.
//
// UNE passe pour tout l'arbre, pas une par chemin. Mesuré : trente et un relevés séparés
// coûtaient 4,7 s au démarrage, chacun parcourant l'historique entier pour un seul
// fichier. Le journal sort du plus récent au plus ancien, donc la DERNIÈRE occurrence
// d'un chemin est son entrée.
const entrees = () => surTete("entrees", () => {
  const raw = git("log", "--all", "--diff-filter=A", "--name-only",
                  "--format=@%ad", "--date=short");
  const par = new Map();
  let d = null;
  for (const l of raw.split("\n")) {
    if (l.startsWith("@")) { d = l.slice(1); continue; }
    if (l.trim() && d) par.set(l, d);
  }
  return par;
});

const entree = (chemin) => entrees().get(chemin) || null;

const gardeFou = () => surTete("veille", calculGardeFou);

function calculGardeFou() {
  if (!VEILLE) return null;
  const raw = git("log", `--since=${VEILLE.jours} days ago`, "--numstat", "--format=", "--", VEILLE.fichier);
  if (!raw) return null;
  let a = 0, d = 0;
  for (const l of raw.split("\n")) {
    const f = l.split("\t");
    if (/^\d+$/.test(f[0])) { a += Number(f[0]); d += Number(f[1]); }
  }
  return { ...VEILLE, net: a - d };
}

// ---------- branches en vol ----------
// Une branche n'existe à l'écran que si un chantier la porte, et un chantier n'est porté
// que si un commit cite son code. Le travail qui échappe aux deux est invisible : mesuré
// sur un dépôt réel, cinq commits de fonctionnalité sur quatorze en vol — de l'italique à
// l'import, une borne sur un run d'alignement — qu'aucune fiche ne pouvait montrer.
//
// Ce n'est pas un défaut de l'outil mais de la discipline qu'il mesure : les sujets ne
// citaient pas de code. C'est précisément ce qu'il doit rendre visible.
//
// Le test de « porté » réutilise ce qui existe : le motif des codes déclarés, et la table
// fichiers-par-commit, dont un ensemble VIDE signale un commit qui n'a touché que le
// dossier ou la documentation — de la tenue ou du cadrage, pas du travail à rattacher.
function branchesEnVol(codes, parCommit) {
  const brut = git("for-each-ref", "--format=%(refname:short)", "refs/heads", "refs/remotes");
  const court = (r) => r.replace(/^[^/]+\//, "");
  const estRef = (r) => REFS.includes(r) || REFS.includes(court(r));
  const rx = codes.length ? rxCodes(codes) : null;
  const par = new Map();

  for (const ref of brut.split("\n").map(x => x.trim()).filter(Boolean)) {
    if (!ref || ref.endsWith("/HEAD") || estRef(ref)) continue;
    const liste = git("rev-list", "--format=%h\x1f%s", "--no-commit-header",
                      ref, ...REFS.map(r => "^" + r))
      .split("\n").filter(Boolean).map(l => { const [hash, sujet] = l.split("\x1f"); return { hash, sujet }; });
    if (!liste.length) continue;   // fusionnée : rien à signaler

    const orphelins = liste.filter(c =>
      (parCommit.get(c.hash)?.size || 0) > 0 && !(rx && rx.test(c.sujet)));
    const tete = git("log", "-1", "--format=%h\x1f%ad\x1f%s", "--date=short", ref).split("\x1f");
    const e = { nom: ref, avance: liste.length, orphelins: orphelins.length,
                exemples: orphelins.slice(0, 3).map(c => ({ hash: c.hash, sujet: c.sujet })),
                dernier: { hash: tete[0], date: tete[1], sujet: tete[2] } };
    // Locale et distante de même nom sont la même branche à deux tips. On garde la plus
    // avancée plutôt que d'afficher deux lignes pour un seul travail.
    const cle = court(ref);
    const a = par.get(cle);
    if (!a || e.avance > a.avance) par.set(cle, e);
  }
  return [...par.values()].sort((a, b) => b.orphelins - a.orphelins || b.avance - a.avance);
}

// ---------- collisions entre chantiers ----------
// Deux chantiers qui ont touché les mêmes fichiers se marcheront dessus à la reprise.
// La relation existe déjà dans les fiches, écrite à la main — et mesurée le 2026-08-25,
// les trois chiffres inscrits étaient tous faux, tous sous-évalués (14→21, 12→25,
// 25→31), et la deuxième collision du dépôt n'était écrite nulle part. Une déclaration
// manuelle enregistre ce à quoi on a pensé, jamais ce qu'on a manqué.
//
// `docs/` et le dossier de pilotage sont écartés : deux chantiers qui citent le même
// audit ne se marchent pas dessus, ils se réfèrent au même document.
const fichiersParCommit = () => surTete("fichiers", () => {
  const raw = git("log", "--all", "--no-renames", "--name-only", "--format=@%h");
  const par = new Map();
  const exclus = [DIR + "/", DOCS + "/"];
  let cur = null;
  for (const l of raw.split("\n")) {
    if (l.startsWith("@")) { cur = new Set(); par.set(l.slice(1), cur); continue; }
    if (!l.trim() || !cur) continue;
    if (exclus.some(e => l.startsWith(e))) continue;
    cur.add(l);
  }
  return par;
});

const fichiersDe = (liste, par) => {
  const s = new Set();
  for (const c of liste) for (const f of par.get(c.hash) || []) s.add(f);
  return s;
};

// Le nombre seul ne suffit pas : une collision avec un chantier clos est un empiètement
// HISTORIQUE — le terrain est stabilisé — tandis qu'avec un chantier vivant c'est un
// risque présent. Même nombre, situation opposée. L'état de l'autre voyage donc avec.
const collisions = (moi, sets, chantiers) => {
  const a = sets.get(moi.code);
  if (!a || !a.size) return null;
  const out = [];
  for (const o of chantiers) {
    if (o.code === moi.code) continue;
    const b = sets.get(o.code);
    if (!b || !b.size) continue;
    let n = 0;
    for (const f of a) if (b.has(f)) n++;
    if (n) out.push({ code: o.code, n, statut: o.statut, silence: o.silence });
  }
  return out.length ? out.sort((x, y) => y.n - x.n) : null;
};

// ---------- portée d'un audit ----------
// Un audit observe le code à la date où il est écrit. Le code bouge ensuite, souvent par
// d'autres chantiers. Ce qui est mesuré ici n'est PAS qu'un constat est réglé — aucune
// mesure ne peut le dire — mais que le sol a bougé sous lui, donc qu'il faut le relire
// avant de planifier dessus.
//
// Les chemins sont trouvés par leur forme, puis filtrés par leur EXISTENCE dans l'arbre.
// Une liste de dossiers ou d'extensions admis serait exactement le réglage propre à un
// dépôt qu'on refuse d'introduire ; ce qui n'existe pas n'est pas un chemin.
//
// Le dossier de pilotage et celui de la documentation sont écartés : un audit qui en
// cite un autre parle de lui-même, pas du code qu'il décrit.
const RX_CHEMIN = /\b[A-Za-z0-9_][A-Za-z0-9_.-]*(?:\/[A-Za-z0-9_.-]+)+\.[A-Za-z0-9]{1,6}\b/g;
// Au-delà, la ligne de commande git dépasse la limite du système. Le compte devient
// partiel et le DIT (`tronque`), plutôt que de mentir par un chiffre trop bas.
const MAX_CHEMINS = 80;

function calculPortee(fichier, depuis) {
  const texte = lireSync(join(ROOT, fichier));
  if (texte === null || !depuis) return null;
  const exclus = [DIR + "/", DOCS + "/"];
  const vus = new Set();
  for (const m of texte.match(RX_CHEMIN) || []) {
    const c = m.replace(/^\.\//, "");
    if (exclus.some(e => c.startsWith(e))) continue;
    if (!vus.has(c) && existsSync(join(ROOT, c))) vus.add(c);
  }
  const chemins = [...vus];
  const vises = chemins.slice(0, MAX_CHEMINS);
  // Zéro chemin n'est pas zéro mouvement : c'est « je n'ai pas su regarder ». Les deux
  // doivent se distinguer à l'écran, sinon un audit qui parle de comportements plutôt
  // que de fichiers passerait pour un audit dont le code n'a pas bougé.
  if (!vises.length) return { chemins: 0, tronque: false, commits: null, plus: 0, moins: 0, depuis };

  // `--format=@` seul est refusé par git, qui y lit un NOM de format ; il faut au moins un
  // placeholder. Et l échec doit remonter en « inconnu », pas en zéro.
  const raw = gitEssai("log", "--all", "--no-renames", "--numstat", "--format=@%h",
                       "--since=" + depuis, "--", ...vises);
  if (raw === null) return { chemins: chemins.length, tronque: false, commits: null,
                             plus: 0, moins: 0, depuis, echec: true };
  let commits = 0, plus = 0, moins = 0;
  for (const l of raw.split("\n")) {
    if (l.startsWith("@")) { commits++; continue; }
    const f = l.split("\t");
    if (/^\d+$/.test(f[0])) { plus += Number(f[0]); moins += Number(f[1]); }
  }
  return { chemins: chemins.length, tronque: chemins.length > MAX_CHEMINS,
           commits, plus, moins, depuis };
}

const portee = (fichier, depuis) =>
  surTete(`portee:${fichier}:${depuis}`, () => calculPortee(fichier, depuis));

// ---------- contrôleur du dossier ----------
// `pilotage/verifier.mjs` s'exécute au chargement et sort par process.exit : on le
// lance en processus fils plutôt que de l'importer. Code de retour non nul = il a
// trouvé des erreurs, pas qu'il a planté — la sortie JSON reste bonne.
function controleur() {
  // Celui de l'outil d'abord : un exemplaire copié dans un projet et laissé en arrière
  // vérifierait un contrat que le serveur n'applique plus.
  const p = [join(OUTIL, "pilotage", "verifier.mjs"), join(ROOT, DIR, "verifier.mjs")]
    .find(existsSync);
  if (!p) return null;
  const lire = (s) => { try { return JSON.parse(s || ""); } catch { return null; } };
  try {
    return lire(execFileSync(process.execPath, [p, "--json", "--dir", DIR],
      { cwd: ROOT, encoding: "utf8", maxBuffer: 16e6, stdio: ["ignore", "pipe", "ignore"] }));
  } catch (e) { return lire(e.stdout); }
}

// ---------- index de navigation ----------
// D'où vient un code : le document qui l'a écrit, pour que l'écran y renvoie. Les
// règles — quels fichiers, quel vocabulaire — sont propres au dépôt et déclarées
// dans la config. Première source qui cite un code l'emporte, sauf `ecrase` : les
// ADR font foi contre une note de conception qui les mentionne.
async function index() {
  const map = {};
  const cfg = CFG.documentation;
  if (!cfg.sources.length) return map;   // aucun motif déclaré : rien à découvrir

  const dossier = join(ROOT, cfg.dossier);
  let noms = []; try { noms = (await readdir(dossier)).filter(n => n.endsWith(".md")); } catch {}

  for (const n of noms) {
    const p = `${cfg.dossier}/${n}`;
    const t = await readFile(join(dossier, n), "utf8").catch(() => "");
    for (const s of cfg.sources) {
      if (!s.fichiers.test(n)) continue;
      for (const c of new Set(t.match(CFG.codes[s.codes]) || []))
        if (s.ecrase) map[c] = p; else map[c] ||= p;
    }
  }
  return map;
}

// ---------- assemblage ----------
async function build() {
  TETE = null;   // une lecture de HEAD par requête, pas une par clé de mémo

  const { jours, commits } = historique();
  const { chantiers, passes } = await pilotage();
  const liens = await index();
  const fr = fronts();
  const mss = masses();
  // La passe des masses suit HEAD, pas `--all` : un commit de tenue posé sur une
  // autre branche ne sera pas reconnu comme tel. Sans conséquence en pratique.
  const tenue = new Set(mss?.tenue || []);
  const redaction = new Set(mss?.redaction || []);
  const rem = await remontee(chantiers);
  const proprietaire = {};
  for (const [ch, codes] of Object.entries(rem)) for (const c of codes) proprietaire[c] = ch;
  // Le vocabulaire du dépôt, dérivé de son dossier : ce que les fiches déclarent, plus ce
  // qu'elles remontent de leurs audits. Rien à régler, rien à tenir à jour.
  const rxVoc = rxVocabulaire(new Set([...chantiers.map(c => c.code), ...Object.keys(proprietaire)]));

  const parCommit = fichiersParCommit(), sets = new Map();
  for (const ch of chantiers) {
    const codes = [ch.code, ...(rem[ch.code] || [])];
    ch.remontee = rem[ch.code] || null;
    const liste = commitsDuChantier(commits, codes, rxVoc, proprietaire, tenue);
    const last = liste[0] || null;
    ch.dernier = last ? { hash: last.hash, date: last.date, sujet: last.sujet } : null;
    // L'autre borne. `dernier` seul ne distingue pas un sprint de trois jours d'une
    // tresse de deux mois : mesuré, deux chantiers affichaient une carte identique pour
    // 7 commits en 3 jours d'un côté, 9 commits sur 64 jours de l'autre.
    const first = liste[liste.length - 1] || null;
    ch.premier = first ? { hash: first.hash, date: first.date } : null;
    ch.auditDate = ch.audit ? entree(ch.audit) : null;
    // Quand la fiche elle-même est entrée. Sans elle, un chantier `à venir` n'a aucune
    // marque sur l'axe du temps : pas de commit, donc pas de barre, donc invisible là où
    // il est justement le plus utile de le voir — récent et pas commencé.
    ch.ficheDate = entree(ch.file);
    ch.portee = ch.audit ? portee(ch.audit, ch.auditDate) : null;
    ch.silence = last ? joursActifs(jours, last.date) : null;
    const f = last ? fr.find(x => x.hashes.has(last.full)) : null;
    ch.front = f ? { ref: f.nom, integre: f.integre } : null;
    ch.commits = liste.length;
    // Les commits qui touchent autre chose que la doc et le dossier de pilotage. Un
    // `à venir` qui en porte n'est plus à venir : c'est le seul démenti mécanique du
    // statut déclaré, et il ne coûte aucune passe git de plus.
    ch.commitsCode = liste.filter(c => !redaction.has(c.hash)).length;
    // La traînée : `Arrêté sur` est une pile de profondeur un, réécrite à chaque
    // reprise. Mesuré le 2026-08-22 : 4 fiches sur 14 la portaient périmée, et
    // c'étaient les trois plus actives — elle ne tient que là où on n'en a pas besoin.
    ch.trainee = liste.slice(0, TRAINEE).map(c => ({ hash: c.hash, date: c.date, sujet: c.sujet }));
    // Le point de reprise cite-t-il encore le dernier commit ? Mesuré le 22 août :
    // 4 fiches sur 14 non, et c'étaient les trois plus actives. La traînée le rendait
    // visible ; ceci le compte, ce qui est la différence entre voir et savoir.
    // Un `à venir` n'a pas de point de reprise à périmer : sa ligne est un point de
    // départ, elle ne cite aucun commit et n'a pas à en citer un.
    ch.arreteDecale = ch.statut !== "à venir" && Boolean(c_arreteDecale(ch));
    sets.set(ch.code, fichiersDe(liste, parCommit));
    ch.passes = passes.filter(p => p.chantier === ch.code).map(p => p.file);
    liens[ch.code] = `#/c/${encodeURIComponent(ch.code)}`;
  }
  // Une seconde passe : croiser deux chantiers suppose les deux ensembles construits.
  for (const ch of chantiers) ch.collisions = collisions(ch, sets, chantiers);

  // Une passe vieillit comme un chantier : en jours actifs. Sans ça, « armée mais pas
  // encore jouée » ne durait qu'une journée et sortait de l'écran le lendemain.
  for (const p of passes) {
    p.silence = p.derniere ? joursActifs(jours, p.derniere) : null;
    // Quand la passe est entrée dans le dépôt. Avec `derniere`, ça donne la durée
    // pendant laquelle elle a été en jeu — une passe écrite il y a deux mois et rejouée
    // hier ne raconte pas la même chose qu'une passe écrite et jouée le même jour.
    p.entree = entree(p.file);
    liens[p.nom] ||= `#/qa/${encodeURIComponent(p.file)}`;
  }

  const enVol = branchesEnVol(chantiers.map(c => c.code), parCommit);

  const depuis = new Date(Date.now() - DAYS * 864e5).toISOString().slice(0, 10);
  return {
    repo: (git("rev-parse", "--show-toplevel") || ROOT).split(/[\\/]/).pop(),
    branche: git("rev-parse", "--abbrev-ref", "HEAD") || "—",
    refs: REFS,
    // La vue transforme un chemin de document en lien : elle a besoin de savoir où vit la
    // documentation, et elle ne lit pas la config.
    docs: DOCS,
    racine: ROOT,
    // Les autres journaux ouverts sur cette machine, pour le sélecteur. Recalculé à
    // chaque construction plutôt que mémoïsé : la liste change quand on ouvre ou ferme
    // un journal, pas quand HEAD bouge — la mémoire par tête serait le mauvais cadre.
    voisins: await voisins(),
    genere: new Date().toISOString(),
    dernierJour: jours[jours.length - 1] || null,
    silenceCourant: jours.length
      ? Math.round((Date.now() - Date.parse(jours[jours.length - 1])) / 864e5) : null,
    chantiers, passes, liens, masses: mss, branches: enVol,
    veille: gardeFou(), controle: controleur(),
    commits: commits.filter(c => c.date >= depuis)
  };
}

// ---------- écritures ----------
const sur = (rel) => {
  const r = String(rel).split(/[\\/]/).join("/");
  if (r.includes("..") || !r.startsWith(DIR + "/")) throw new Error("chemin refusé");
  return join(ROOT, r);
};

async function cocher({ file, ligne, fait }) {
  const abs = sur(file);
  const lines = (await readFile(abs, "utf8")).split(/\r?\n/);
  const i = ligne - 1;
  if (!RX.box.test(lines[i] ?? "")) throw new Error("ligne inattendue — recharge la page");
  lines[i] = lines[i].replace(/\[[ xX]\]/, fait ? "[x]" : "[ ]");
  await writeFile(abs, lines.join("\n"), "utf8");
}

async function reinitialiser({ file }) {
  const abs = sur(file);
  const today = new Date().toISOString().slice(0, 10);
  const lines = (await readFile(abs, "utf8")).split(/\r?\n/).map(l =>
    RX.box.test(l) ? l.replace(/\[[xX]\]/, "[ ]") : l.replace(/^derniere:\s*.*$/, `derniere: ${today}`));
  await writeFile(abs, lines.join("\n"), "utf8");
}

// ---------- export statique ----------
// La vue va chercher ses données par une URL RELATIVE (`fetch("journal.json")`). Deux
// fichiers côte à côte sur n'importe quel hébergeur suffisent donc à la servir : vérifié,
// le rendu est identique à l'octet près à celui du serveur. C'est ce qui rend un journal
// lisible depuis un téléphone, où `localhost` n'existe pas.
//
// Trois choses mentiraient sans correction, et ce sont les seules :
//   · les cases s'afficheraient actives et posteraient vers un `/cocher` absent ;
//   · les liens `vscode://` désigneraient un chemin absolu de MA machine, au mieux mort,
//     au pire ouvrant le mauvais fichier chez qui a la même arborescence ;
//   · le sélecteur de journaux pointerait vers `127.0.0.1`, donc vers la machine du
//     LECTEUR — c'est pourquoi il est retiré ici plutôt que traduit.
//
// L'adresse web du dépôt se dérive du remote, sans réseau : elle remplace `vscode://` et
// vaut mieux que lui à distance, puisqu'elle ouvre le fichier à la bonne révision chez
// celui qui lit.
const adresseWeb = () => {
  const u = gitEssai("remote", "get-url", "origin");
  if (!u) return null;
  const m = u.match(/^(?:https?:\/\/|git@|ssh:\/\/git@)([^/:]+)[/:](.+?)(?:\.git)?$/);
  if (!m) return null;
  const ref = git("rev-parse", "--abbrev-ref", "HEAD") || "HEAD";
  return `https://${m[1]}/${m[2]}/blob/${ref}/`;
};

if (args[0] === "exporter") {
  const dest = args[1] && !args[1].startsWith("--") ? args[1] : "journal-export";
  // `join(ROOT, …)` collait la racine devant un chemin déjà absolu.
  const abs = isAbsolute(dest) ? dest : join(ROOT, dest);
  const charge = await build();
  charge.statique = true;
  // `--web` prime sur la dérivation. En CI, l'adresse est CONNUE — GitHub la donne dans
  // son environnement — alors qu'ici on la devine à partir du remote. Répétée à blanc
  // dans un clone local, la dérivation rendait « pas de remote » et l'export sortait
  // avec des liens inertes : deviner marche là où l'on n'a rien de mieux, pas là où
  // l'on a la réponse.
  charge.web = opt("web", null) || adresseWeb();
  // Le sélecteur de voisins est local par nature : des ports de boucle locale. Un index
  // des exports est un autre objet, à écrire à côté des exports, pas dans chacun.
  //
  // VIDÉ, pas SUPPRIMÉ. C'est ce champ qui sert de sentinelle à « serveur périmé » : le
  // supprimer ferait passer chaque export pour un moteur ancien. Un tableau vide dit
  // « je sais faire, il n'y a personne » ; l'absence dirait « je ne sais pas faire ».
  charge.voisins = [];
  await mkdir(abs, { recursive: true });
  await writeFile(join(abs, "journal.json"), JSON.stringify(charge), "utf8");
  await writeFile(join(abs, "index.html"), await readFile(join(OUTIL, "journal.html")), "utf8");
  const ko = (s) => (s / 1024).toFixed(0);
  console.log(`Export écrit dans ${abs}`);
  console.log(`  index.html + journal.json  ·  ${ko(JSON.stringify(charge).length)} Ko`
    + `  ·  ${charge.chantiers.length} fiches, ${charge.passes.length} passes`);
  console.log(charge.web ? `  liens de fichier → ${charge.web}` : `  pas de remote : les liens de fichier seront inertes`);
  console.log(`  lecture seule : les cases sont désactivées.`);
  process.exit(0);
}

// ---------- serveur ----------
const HTML = join(OUTIL, "journal.html");

createServer(async (req, res) => {
  const send = (code, type, body) =>
    res.writeHead(code, { "Content-Type": type, "Cache-Control": "no-store" }).end(body);

  if (req.method === "POST") {
    let raw = ""; for await (const c of req) raw += c;
    try {
      const data = JSON.parse(raw || "{}");
      if (req.url === "/cocher") await cocher(data);
      else if (req.url === "/reinitialiser") await reinitialiser(data);
      else return send(404, "application/json", `{"error":"inconnu"}`);
      return send(200, "application/json", `{"ok":true}`);
    } catch (e) { return send(400, "application/json", JSON.stringify({ error: e.message })); }
  }

  // Carte d'identité du serveur, pour la sonde de lancement. Volontairement SANS git ni
  // lecture du dossier : elle doit répondre en quelques millisecondes, là où
  // `/journal.json` demande près d'une seconde. C'est ce qui permet à `pilote` d'être
  // idempotent sans que le coût se voie.
  if (req.url === "/pilote")
    return send(200, "application/json",
      JSON.stringify({ pilote: true, racine: ROOT, dir: DIR, empreinte: EMPREINTE, pid: process.pid }));

  if (req.url.startsWith("/journal.json")) {
    try { return send(200, "application/json", JSON.stringify(await build())); }
    catch (e) { return send(500, "application/json", JSON.stringify({ error: e.message })); }
  }

  if (!existsSync(HTML)) return send(404, "text/plain; charset=utf-8", "journal.html introuvable");
  send(200, "text/html; charset=utf-8", await readFile(HTML));
})
  // La sonde a pu dire « libre » et quelqu'un prendre le port entre-temps, ou le port
  // être tenu par un programme qui n'est pas un journal : dans les deux cas la sonde ne
  // pouvait rien dire d'utile. Ici on sait au moins que ce n'est pas nous.
  .on("error", e => {
    if (e.code !== "EADDRINUSE") throw e;
    console.error(`Le port ${PORT} est occupé par un programme qui n'est pas un journal.`);
    console.error(`Relance avec --port sur un autre numéro.`);
    process.exit(1);
  })
  // BOUCLE LOCALE, explicitement. `listen(PORT)` sans hôte écoute sur 0.0.0.0 et [::] —
  // toutes les interfaces. Mesuré le 2026-08-31 : le journal répondait 200 sur l'adresse
  // réseau de la machine, donc lisible par quiconque sur le même wifi, et ses deux routes
  // d'écriture (`/cocher`, `/reinitialiser`) sont ouvertes, sans jeton. La garde de chemin
  // borne CE QU'ON PEUT écrire, pas QUI peut écrire.
  //
  // Le README promettait « rien ne sort de la machine » : c'était vrai des données, faux
  // du service. Un défaut de porte, pas de serrure.
  .listen(PORT, "127.0.0.1", () => {
    console.log(`Journal de bord  →  http://localhost:${PORT}`);
    console.log(`${ROOT}  ·  ${DIR}/  ·  ${DAYS} jours de commits  ·  « pilote arreter » pour le fermer`);
  });
