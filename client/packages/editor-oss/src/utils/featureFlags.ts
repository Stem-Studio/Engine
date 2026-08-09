// Stripe billing is not part of this repository.
export const isStripeCreditsPurchasingEnabled = (): boolean => false;

// Shared `@import` scripts (reusable JS/YAML helpers consumed by behaviors and
// lambdas) are a first-class open-source authoring feature — the stemscript-folder
// import pipeline, docs/import-packs.md, and several shipped example games
// (2048, drop7, island-defense, machine-arena, sky-bomber, tinyskies) all rely
// on `import script` + `@import "name" as X;`.
export const isScriptsEnabled = (): boolean => true;
