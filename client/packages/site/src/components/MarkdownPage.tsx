import {marked} from "marked";
import {useEffect, useMemo, useState} from "react";

import {GITHUB_URL} from "../content/links";
import type {DocEntry} from "../content/docs-nav";

// Build-time raw imports keep docs in the static bundle (no fetch at runtime).
// Vite's `?raw` query returns the file as a string.
import architectureMd from "../../../../../docs/architecture.md?raw";
import builtInBehaviorsMd from "../../../../../docs/built-in-behaviors.md?raw";
import byokMd from "../../../../../docs/byok.md?raw";
import exportingMd from "../../../../../docs/exporting-a-game.md?raw";
import gameObjectAndGameManagerApiMd from "../../../../../docs/gameobject-and-game-manager-api.md?raw";
import importPacksMd from "../../../../../docs/import-packs.md?raw";
import lambdasMd from "../../../../../docs/lambdas.md?raw";
import multiplayerMd from "../../../../../docs/multiplayer.md?raw";
import stemScriptMd from "../../../../../docs/stem-script.md?raw";
import runtimeApiMd from "../../../../../docs/runtime-api.md?raw";
import schedulerAndEditorSettingsMd from "../../../../../docs/scheduler-and-editor-settings.md?raw";
import serverSideStorageMd from "../../../../../docs/server-side-storage.md?raw";
import uikitApiMd from "../../../../../docs/uikit-api.md?raw";
import readmeMd from "../../../../../README.md?raw";
import contributingMd from "../../../../../CONTRIBUTING.md?raw";
import defaultSceneSettingsImg from "../../../../../docs/assets/default-scene-settings.png";
import directionalLightSettingsImg from "../../../../../docs/assets/directional-light-settings.png";
import editorProjectTabMapImg from "../../../../../docs/assets/editor-project-tab-map.png";
import projectSettingsOverviewImg from "../../../../../docs/assets/project-settings-overview.png";
import schedulerBehaviorPerformanceImg from "../../../../../docs/assets/scheduler-behavior-performance.png";
import schedulerLambdaExplorerImg from "../../../../../docs/assets/scheduler-lambda-explorer.png";
import schedulerQualityPresetsImg from "../../../../../docs/assets/scheduler-quality-presets.png";
import schedulerSettingsOverviewImg from "../../../../../docs/assets/scheduler-settings-overview.png";

const SOURCES: Record<string, string> = {
    "repo-docs:architecture.md": architectureMd,
    "repo-docs:built-in-behaviors.md": builtInBehaviorsMd,
    "repo-docs:byok.md": byokMd,
    "repo-docs:exporting-a-game.md": exportingMd,
    "repo-docs:gameobject-and-game-manager-api.md": gameObjectAndGameManagerApiMd,
    "repo-docs:import-packs.md": importPacksMd,
    "repo-docs:lambdas.md": lambdasMd,
    "repo-docs:multiplayer.md": multiplayerMd,
    "repo-docs:stem-script.md": stemScriptMd,
    "repo-docs:runtime-api.md": runtimeApiMd,
    "repo-docs:scheduler-and-editor-settings.md": schedulerAndEditorSettingsMd,
    "repo-docs:server-side-storage.md": serverSideStorageMd,
    "repo-docs:uikit-api.md": uikitApiMd,
    "repo-root:README.md": readmeMd,
    "repo-root:CONTRIBUTING.md": contributingMd,
};

const IMAGE_SOURCES: Record<string, string> = {
    "docs/assets/default-scene-settings.png": defaultSceneSettingsImg,
    "docs/assets/directional-light-settings.png": directionalLightSettingsImg,
    "docs/assets/editor-project-tab-map.png": editorProjectTabMapImg,
    "docs/assets/project-settings-overview.png": projectSettingsOverviewImg,
    "docs/assets/scheduler-behavior-performance.png": schedulerBehaviorPerformanceImg,
    "docs/assets/scheduler-lambda-explorer.png": schedulerLambdaExplorerImg,
    "docs/assets/scheduler-quality-presets.png": schedulerQualityPresetsImg,
    "docs/assets/scheduler-settings-overview.png": schedulerSettingsOverviewImg,
};

interface Props {
    entry: DocEntry;
}

export function MarkdownPage({entry}: Props) {
    const key = `${entry.source}:${entry.file}`;
    const raw = SOURCES[key];

    const [html, setHtml] = useState<string>("");

    const cleaned = useMemo(() => rewriteRepoLinks(raw ?? "", entry), [raw, entry]);

    useEffect(() => {
        let active = true;
        Promise.resolve(marked.parse(cleaned, {async: true})).then((out) => {
            if (active) setHtml(typeof out === "string" ? out : "");
        });
        return () => {
            active = false;
        };
    }, [cleaned]);

    if (!raw) {
        return <div className="docs-empty">Page not found.</div>;
    }

    return (
        <article
            className="docs-content"
            // Trusted source: markdown ships from the repo at build time. No
            // user-submitted content reaches this surface.
            dangerouslySetInnerHTML={{__html: html}}
        />
    );
}

function rewriteRepoLinks(md: string, entry: DocEntry): string {
    // Anchor non-curated relative links to the GitHub source so users don't
    // get 404s when a doc links to a file we haven't surfaced on the site.
    const basePath = entry.source === "repo-root" ? "" : "docs/";
    const rawGithubBase = GITHUB_URL.replace("https://github.com/", "https://raw.githubusercontent.com/");
    return md.replace(/(!?)\[([^\]]*)\]\((?!https?:|#|\/)([^)]+)\)/g, (_match, bang: string, label: string, rel: string) => {
        const repoPath = normalizeRepoPath(rel.startsWith("docs/") ? rel : `${basePath}${rel}`);
        const target = bang
            ? (IMAGE_SOURCES[repoPath] ?? `${rawGithubBase}/main/${repoPath}`)
            : `${GITHUB_URL}/blob/main/${repoPath}`;
        return `${bang}[${label}](${target})`;
    });
}

function normalizeRepoPath(path: string): string {
    return path
        .replace(/^\.\//, "")
        .replace(/\/\.\//g, "/");
}
