#!/usr/bin/env node
import {cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync} from "node:fs";
import {dirname, join, relative, resolve, sep} from "node:path";
import {spawnSync} from "node:child_process";
import {tmpdir} from "node:os";
import {fileURLToPath} from "node:url";

const REPO_URL = "https://github.com/jasonkneen/tiny-world-builder.git";
const DEFAULT_COMMIT = "70ec0933598e70136f3143f1a93e3222bd6647a5";
const TEXTURE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const enabled = process.env.ENABLE_TINY_WORLD_TEXTURES === "1";
const sourceOverride = process.env.TINY_WORLD_BUILDER_SOURCE_DIR;
const commit = process.env.TINY_WORLD_BUILDER_COMMIT || DEFAULT_COMMIT;
const outputRoot = resolve(
    rootDir,
    process.env.QUICK_BUILD_TEXTURE_PACK_OUTPUT || "client/public/vendor/texture-packs",
);
const packId = "tiny-world-builder";
const packOutput = join(outputRoot, packId);

function log(message) {
    console.log(`[tiny-world-textures] ${message}`);
}

function fail(message) {
    console.error(`[tiny-world-textures] ${message}`);
    process.exit(1);
}

function run(command, args, options = {}) {
    const result = spawnSync(command, args, {stdio: "inherit", ...options});
    if (result.status !== 0) {
        fail(`${command} ${args.join(" ")} failed`);
    }
}

function ensureSourceDir() {
    if (sourceOverride) {
        const sourceDir = resolve(rootDir, sourceOverride);
        if (!existsSync(join(sourceDir, "textures"))) {
            fail(`TINY_WORLD_BUILDER_SOURCE_DIR has no textures directory: ${sourceDir}`);
        }
        return sourceDir;
    }

    const checkoutDir = join(tmpdir(), `tiny-world-builder-${commit.slice(0, 12)}`);
    if (!existsSync(checkoutDir)) {
        run("git", ["clone", "--depth", "1", REPO_URL, checkoutDir]);
    }
    run("git", ["fetch", "--depth", "1", "origin", commit], {cwd: checkoutDir});
    run("git", ["checkout", "--detach", commit], {cwd: checkoutDir});
    return checkoutDir;
}

function collectFiles(dir) {
    const files = [];
    for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        const stats = statSync(path);
        if (stats.isDirectory()) {
            files.push(...collectFiles(path));
            continue;
        }
        const ext = entry.slice(entry.lastIndexOf(".")).toLowerCase();
        if (TEXTURE_EXTENSIONS.has(ext)) {
            files.push(path);
        }
    }
    return files.sort();
}

function inferPreset(relativePath) {
    const filename = relativePath.split(sep).join("/");
    const stem = filename.split("/").pop()?.replace(/\.(png|jpe?g|webp)$/i, "") || filename;
    const idStem = filename.replace(/\.(png|jpe?g|webp)$/i, "");
    const lower = stem.toLowerCase();
    const isPlaceableVariant =
        filename.startsWith("terrain-variants/") &&
        !filename.startsWith("terrain-variants/source/");
    const category = !isPlaceableVariant ? "reference" :
        lower.includes("water") ? "water" :
        lower.includes("path") || lower.includes("paver") ? "path" :
        lower.includes("stone") || lower.includes("rock") ? "stone" :
        lower.includes("wood") ? "wood" :
        lower.includes("reference") ? "reference" :
        "terrain";
    const stampKinds =
        category === "water" ? ["water"] :
        category === "path" ? ["path", "bridge"] :
        category === "stone" ? ["stone", "rock", "house"] :
        category === "wood" ? ["bridge", "fence", "house"] :
        category === "reference" ? [] :
        ["ground", "sand", "farm"];

    return {
        id: `tw-${idStem.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase()}`,
        label: stem.replace(/[-_]+/g, " ").trim().replace(/\b\w/g, char => char.toUpperCase()),
        category,
        stampKinds,
        url: `./textures/${filename}`,
        license: "AGPL-3.0",
        attribution: "Tiny World Builder textures by Jason Kneen",
    };
}

if (!enabled) {
    log("skipped; set ENABLE_TINY_WORLD_TEXTURES=1 to copy optional third-party textures");
    process.exit(0);
}

const sourceDir = ensureSourceDir();
const textureSource = join(sourceDir, "textures");
const licenseSource = join(sourceDir, "LICENSE");
if (!existsSync(textureSource)) fail(`missing textures directory: ${textureSource}`);
if (!existsSync(licenseSource)) fail(`missing upstream LICENSE: ${licenseSource}`);

rmSync(packOutput, {recursive: true, force: true});
mkdirSync(join(packOutput, "textures"), {recursive: true});
cpSync(textureSource, join(packOutput, "textures"), {recursive: true});
cpSync(licenseSource, join(packOutput, "LICENSE-AGPL-3.0.txt"));

const textureFiles = collectFiles(join(packOutput, "textures"));
const presets = textureFiles.map(file => inferPreset(relative(join(packOutput, "textures"), file)));
const now = new Date().toISOString();

writeFileSync(
    join(packOutput, "NOTICE.md"),
    [
        "# Tiny World Builder Texture Pack",
        "",
        `Source: ${REPO_URL}`,
        `Commit: ${commit}`,
        "License: GNU AGPL-3.0",
        "",
        "This is an optional deployment artifact. It is not bundled into StemStudio source code.",
        "Keep this notice and LICENSE-AGPL-3.0.txt with redistributed copies.",
        "",
    ].join("\n"),
);

writeFileSync(
    join(packOutput, "manifest.json"),
    JSON.stringify(
        {
            schema: "stem.quickBuildTexturePack.v1",
            id: packId,
            label: "Tiny World Builder",
            source: `${REPO_URL}@${commit}`,
            license: "AGPL-3.0",
            generatedAt: now,
            presets,
        },
        null,
        2,
    ),
);

mkdirSync(outputRoot, {recursive: true});
const indexPath = join(outputRoot, "manifest.json");
let existingPacks = [];
if (existsSync(indexPath)) {
    try {
        const existing = JSON.parse(readFileSync(indexPath, "utf8"));
        if (existing?.schema === "stem.quickBuildTexturePackIndex.v1" && Array.isArray(existing.packs)) {
            existingPacks = existing.packs.filter(pack => pack.id !== packId);
        }
    } catch {
        existingPacks = [];
    }
}

existingPacks.push({
    id: packId,
    label: "Tiny World Builder",
    manifestUrl: `./${packId}/manifest.json`,
    license: "AGPL-3.0",
});

writeFileSync(
    indexPath,
    JSON.stringify({schema: "stem.quickBuildTexturePackIndex.v1", generatedAt: now, packs: existingPacks}, null, 2),
);

log(`copied ${textureFiles.length} texture files to ${packOutput}`);
