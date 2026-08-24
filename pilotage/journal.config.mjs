// L'inventaire de CE dépôt. Rien d'autre : pas de grammaire, pas de réglage de
// lecture. Ce que l'outil ne peut pas deviner, c'est où sont les fichiers et
// comment s'appellent les branches — trois valeurs, remplies une fois.
//
// Le fichier est FACULTATIF. Sans lui, le journal lit `pilotage/` et rend les
// chantiers, les passes et le contrôleur ; on perd les courbes de masse, la veille
// à seuil, et les liens d'un code vers le document qui l'a écrit.

export default {
  // Refs d'intégration, de l'amont vers l'aval. Un chantier vit sur la première qui
  // contient son dernier commit ; à défaut sur la branche courante, donc pas intégré.
  refs: ["origin/main"],

  // Une aire = un préfixe de chemin ; le PREMIER qui matche l'emporte, donc le
  // contrôleur est détaché avant le dossier qui le contient.
  aires: [
    ["outil/serveur",    "journal.mjs"],
    ["outil/vue",        "journal.html"],
    ["outil/contrat",    "journal-contrat.mjs"],
    ["outil/controleur", "pilotage/verifier.mjs"],
    ["dossier",          "pilotage/"]
  ],

  // Le seul chiffre qui ait une limite réelle. Ici c'est le serveur : tout l'intérêt
  // de l'outil est qu'il reste lisible d'un bout à l'autre. `chantier` = la fiche où
  // se prend la décision quand le seuil approche ; sans elle, le chiffre est un
  // cul-de-sac — on voit qu'il monte, pas où agir.
  veille: { fichier: "journal.mjs", seuil: 300, jours: 90, chantier: "P-1" }
};
