import {IS_OSS} from "../mode/buildMode";

// Hard-off in OSS builds: the Stripe billing surface is integrated-only,
// and the OSS export step replaces `@web/network/api/stripe` with a stub
// (see `OSS_OVERRIDES` in scripts/export-oss.ts). Gating here on `IS_OSS`
// ensures the CreditsSummary / CreditsBar / CreditsPurchaseModal UI never
// renders in an OSS deploy even if an operator sets the env flag by mistake.
export const isStripeCreditsPurchasingEnabled = (): boolean =>
    !IS_OSS && import.meta.env.REACT_APP_STRIPE_CREDITS_ENABLED === "true";

// Shared `@import` scripts (reusable JS/YAML helpers consumed by behaviors and
// lambdas) are a first-class OSS authoring feature — the stemscript-folder
// import pipeline, docs/import-packs.md, and several shipped example games
// (2048, drop7, island-defense, machine-arena, sky-bomber, tinyskies) all rely
// on `import script` + `@import "name" as X;`. They are always on in OSS; the
// integrated build keeps the env-flag opt-in.
export const isScriptsEnabled = (): boolean =>
    IS_OSS || import.meta.env.REACT_APP_SCRIPTS_ENABLED === "true";
