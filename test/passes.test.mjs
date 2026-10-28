// Le rangement d'une passe et le bouton « réinitialiser » (P-8).
// `node --test` — aucune dépendance. Le serveur ne s'importe pas : on éprouve les deux
// règles là où elles vivent, dans le contrat.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { frontmatter, jeuDePasse, reinitialiserPasse, RX } from "../journal-contrat.mjs";

const passe = (fm, cases) => `---\n${fm}\n---\n\n# QA\n\n### Zone\n\n${cases}\n`;
const lire = (texte, dejaCochee = false) => {
  const faits = texte.split("\n").filter(l => { const b = RX.box.exec(l); return b && b[1] !== " "; }).length;
  return jeuDePasse({ fm: frontmatter(texte), faits, dejaCochee });
};

test("une passe cochée en partie est jouée, sans `derniere:`", () => {
  const t = passe("passe: x", "- [x] un\n- [ ] deux\n- [ ] trois");
  assert.deepEqual(lire(t), { jouee: true, derniere: null, dateEcrite: null });
});

test("une passe complète sans date est jouée", () => {
  assert.equal(lire(passe("passe: x\nderniere: —", "- [x] un\n- [X] deux")).jouee, true);
});

test("une passe sans `derniere:` ni coche n'est pas jouée", () => {
  assert.equal(lire(passe("passe: x", "- [ ] un")).jouee, false);
});

test("`derniere:` écrit à la création ne fait pas une partie, et ne s'affiche pas", () => {
  const r = lire(passe("passe: x\nderniere: 2026-08-27", "- [ ] un\n- [ ] deux"));
  assert.deepEqual(r, { jouee: false, derniere: null, dateEcrite: "2026-08-27" });
});

test("une passe décochée mais cochée dans l'historique est jouée, et garde sa date", () => {
  const r = lire(passe("passe: x\nderniere: 2026-09-01", "- [ ] un"), true);
  assert.deepEqual(r, { jouee: true, derniere: "2026-09-01", dateEcrite: "2026-09-01" });
});

test("`—` et une valeur vide valent absence de date", () => {
  for (const v of ["derniere: —", "derniere:", "derniere:   "])
    assert.equal(lire(passe(`passe: x\n${v}`, "- [x] un")).derniere, null, v);
});

test("réinitialiser remplace une `derniere:` existante et décoche tout", () => {
  const t = reinitialiserPasse(passe("passe: x\nderniere: 2026-08-01", "- [x] un\n* [X] deux\n- [ ] trois"), "2026-10-28");
  assert.equal(frontmatter(t).derniere, "2026-10-28");
  assert.equal((t.match(/\[[xX]\]/g) || []).length, 0);
  assert.equal((t.match(/^derniere:/gm) || []).length, 1);
});

test("réinitialiser POSE `derniere:` quand la ligne manque", () => {
  const avant = passe("passe: x\nchantier: R6", "- [x] un\n- [x] deux");
  const t = reinitialiserPasse(avant, "2026-10-28");
  assert.equal(frontmatter(t).derniere, "2026-10-28");
  assert.equal(frontmatter(t).passe, "x");
  assert.equal(frontmatter(t).chantier, "R6");
  // Jouée (cochée dans l'historique), réinitialisée : déjà jouée, avec la date du bouton.
  assert.deepEqual(lire(t, true), { jouee: true, derniere: "2026-10-28", dateEcrite: "2026-10-28" });
  // Et réinitialiser deux fois ne double pas la ligne.
  const deux = reinitialiserPasse(t, "2026-10-29");
  assert.equal((deux.match(/^derniere:/gm) || []).length, 1);
  assert.equal(frontmatter(deux).derniere, "2026-10-29");
});

test("réinitialiser remplace `derniere: —`", () => {
  const t = reinitialiserPasse(passe("passe: x\nderniere: —", "- [x] un"), "2026-10-28");
  assert.equal(frontmatter(t).derniere, "2026-10-28");
});

test("réinitialiser une passe sans frontmatter lui en donne un", () => {
  const t = reinitialiserPasse("# QA\n\n### Zone\n\n- [x] un\n", "2026-10-28");
  assert.equal(frontmatter(t).derniere, "2026-10-28");
  assert.match(t, /^---\n/);
  assert.match(t, /- \[ \] un/);
});

test("réinitialiser ne touche pas un `derniere:` hors du frontmatter", () => {
  const t = reinitialiserPasse(passe("passe: x", "- [x] un") + "\nderniere: en prose\n", "2026-10-28");
  assert.match(t, /^derniere: en prose$/m);
  assert.equal(frontmatter(t).derniere, "2026-10-28");
});

test("réinitialiser accepte des fins de ligne CRLF", () => {
  const t = reinitialiserPasse(passe("passe: x", "- [x] un").replace(/\n/g, "\r\n"), "2026-10-28");
  assert.equal(frontmatter(t).derniere, "2026-10-28");
});

test("l'exemple du gabarit ne déclare pas de partie", () => {
  const gabarit = readFileSync(new URL("../pilotage/_TEMPLATE.md", import.meta.url), "utf8");
  const bloc = /## Gabarit 2[\s\S]*?```markdown\r?\n([\s\S]*?)```/.exec(gabarit);
  assert.ok(bloc, "le bloc d'exemple de la passe est introuvable");
  const fm = frontmatter(bloc[1]);
  assert.ok(fm.passe, "le frontmatter d'exemple n'a pas été lu");
  assert.equal(fm.derniere, undefined);
  assert.equal(lire(bloc[1].replace(/\r/g, "")).jouee, false);
});
