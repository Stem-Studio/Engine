import {registerOssAsset} from "@stem/network/api/asset";

import {getProjectStore} from "./projectStoreFactory";
import type {ProjectStore} from "./ProjectStore";
import type {ProjectBody, ProjectMeta, StoredAsset} from "./types";

type ImportableFile = File & {webkitRelativePath?: string};

type AssetManifestEntry = Omit<StoredAsset, "data"> & {
    file?: string;
    data?: string;
};

export type ProjectBundleImportResult = {
    meta: ProjectMeta;
    oldProjectId: string;
    assetsImported: number;
};

const PROJECT_SUFFIX = ".stemscript.json";

const nowIso = (): string => new Date().toISOString();

const createLocalId = (prefix: string): string => {
    const ts = Date.now().toString(36);
    const rand = Math.random().toString(36).slice(2, 8);
    return `${prefix}-${ts}-${rand}`;
};

const normalizePath = (path: string): string =>
    path.replace(/\\/g, "/").replace(/^\/+/, "").replace(/^\.\//, "");

const filePath = (file: ImportableFile): string =>
    normalizePath(file.webkitRelativePath || file.name);

const dirname = (path: string): string => {
    const normalized = normalizePath(path);
    const index = normalized.lastIndexOf("/");
    return index >= 0 ? normalized.slice(0, index) : "";
};

const joinPath = (...parts: string[]): string =>
    normalizePath(parts.filter(Boolean).join("/"));

const parseProjectBody = async (file: File): Promise<ProjectBody> => {
    const parsed = JSON.parse(await file.text()) as ProjectBody;
    if (!parsed || typeof parsed !== "object" || typeof parsed.sceneJson !== "string") {
        throw new Error("Imported file is not a valid .stemscript.json project");
    }
    if (!parsed.meta || typeof parsed.meta !== "object") {
        parsed.meta = {
            id: "",
            name: "Imported project",
            createdAt: "",
            updatedAt: "",
        };
    }
    return parsed;
};

const fileToBase64 = async (file: File): Promise<string> => {
    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    const chunks: string[] = [];
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
        chunks.push(String.fromCharCode(...bytes.subarray(i, i + chunkSize)));
    }
    return btoa(chunks.join(""));
};

const parseDataUrl = (value: string): {contentType?: string; data: string} => {
    const comma = value.indexOf(",");
    if (!value.startsWith("data:") || comma < 0) {
        return {data: value};
    }
    const header = value.slice(5, comma);
    const contentType = header.split(";")[0] || undefined;
    return {contentType, data: value.slice(comma + 1)};
};

const collectAssetContextEntries = (value: unknown): Array<[string, string]> => {
    const out: Array<[string, string]> = [];
    const visit = (node: unknown) => {
        if (!node || typeof node !== "object") return;
        if (Array.isArray(node)) {
            node.forEach(visit);
            return;
        }
        const record = node as Record<string, unknown>;
        const ctx = record.assetResolutionContext;
        if (ctx && typeof ctx === "object" && !Array.isArray(ctx)) {
            const map = (ctx as {assetIdToRevisionId?: unknown}).assetIdToRevisionId;
            if (map && typeof map === "object" && !Array.isArray(map)) {
                for (const [assetId, revisionId] of Object.entries(map as Record<string, unknown>)) {
                    if (typeof revisionId === "string") out.push([assetId, revisionId]);
                }
            }
        }
        Object.values(record).forEach(visit);
    };
    try {
        visit(JSON.parse(typeof value === "string" ? value : JSON.stringify(value)));
    } catch {
        // Invalid scene JSON is handled by the load path. Import validation is
        // only concerned with detecting obvious sidecar requirements.
    }
    return out;
};

const assertSingleFileIsSelfContained = (body: ProjectBody): void => {
    if (typeof body.meta.extra?.assetManifest === "string" && body.meta.extra.assetManifest) {
        throw new Error("This project references sidecar assets. Import the containing folder instead.");
    }
    const assetRefs = collectAssetContextEntries(body.sceneJson);
    if (assetRefs.length > 0) {
        throw new Error("This project references sidecar assets. Import the containing folder instead.");
    }
};

const assertManifestCoversAssetContext = (
    body: ProjectBody,
    assets: StoredAsset[],
): void => {
    const refs = collectAssetContextEntries(body.sceneJson);
    if (refs.length === 0) return;

    const manifestAssetIds = new Set(assets.map(asset => asset.assetId));
    const manifestPairs = new Set(assets.map(asset => `${asset.assetId}\u0000${asset.revisionId}`));
    for (const [assetId, revisionId] of refs) {
        if (manifestPairs.has(`${assetId}\u0000${revisionId}`)) continue;
        if (!manifestAssetIds.has(assetId)) {
            throw new Error(
                `Project references asset "${assetId}" revision "${revisionId}", but that asset is missing from the sidecar manifest.`,
            );
        }
        throw new Error(
            `Project references asset "${assetId}" revision "${revisionId}", but that revision is missing from the sidecar manifest.`,
        );
    }
};

const assertNoRevisionHistoryBundles = (assets: StoredAsset[]): void => {
    const revisionsByAsset = new Map<string, Set<string>>();
    for (const asset of assets) {
        let revisions = revisionsByAsset.get(asset.assetId);
        if (!revisions) {
            revisions = new Set();
            revisionsByAsset.set(asset.assetId, revisions);
        }
        revisions.add(asset.revisionId);
    }
    for (const [assetId, revisions] of revisionsByAsset) {
        if (revisions.size > 1) {
            throw new Error(
                `Project bundle contains multiple revisions for asset "${assetId}". Revision-history bundles are not supported by local import yet.`,
            );
        }
    }
};

const remapJson = (
    value: unknown,
    replacements: ReadonlyArray<[string, string]>,
): unknown => {
    if (typeof value === "string") {
        let next = value;
        for (const [from, to] of replacements) {
            next = next.split(from).join(to);
        }
        return next;
    }
    if (Array.isArray(value)) {
        return value.map(item => remapJson(item, replacements));
    }
    if (!value || typeof value !== "object") {
        return value;
    }
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
        let nextKey = key;
        for (const [from, to] of replacements) {
            nextKey = nextKey.split(from).join(to);
        }
        out[nextKey] = remapJson(item, replacements);
    }
    return out;
};

const remapSceneJson = (sceneJson: string, replacements: ReadonlyArray<[string, string]>): string => {
    try {
        return JSON.stringify(remapJson(JSON.parse(sceneJson), replacements));
    } catch {
        let next = sceneJson;
        for (const [from, to] of replacements) {
            next = next.split(from).join(to);
        }
        return next;
    }
};

const remapStoredAssets = (
    assets: StoredAsset[],
    assetIdMap: Map<string, string>,
    revisionIdMap: Map<string, string>,
    replacements: ReadonlyArray<[string, string]>,
): StoredAsset[] =>
    assets.map(asset => ({
        ...asset,
        assetId: assetIdMap.get(asset.assetId) ?? asset.assetId,
        revisionId: revisionIdMap.get(asset.revisionId) ?? asset.revisionId,
        metadata: asset.metadata
            ? remapJson(asset.metadata, replacements) as Record<string, unknown>
            : undefined,
    }));

const buildRemappedProject = (
    body: ProjectBody,
    assets: StoredAsset[],
): {body: ProjectBody; assets: StoredAsset[]; oldProjectId: string} => {
    const oldProjectId = body.meta.id || "";
    const newProjectId = createLocalId("oss");
    const assetIdMap = new Map<string, string>();
    const revisionIdMap = new Map<string, string>();

    for (const asset of assets) {
        if (!assetIdMap.has(asset.assetId)) {
            const newAssetId = createLocalId("oss-asset");
            assetIdMap.set(asset.assetId, newAssetId);
            revisionIdMap.set(asset.revisionId, `oss-rev-${newAssetId}`);
        }
    }

    const replacements = [
        ...Array.from(revisionIdMap.entries()),
        ...Array.from(assetIdMap.entries()),
        ...(oldProjectId ? [[oldProjectId, newProjectId] as [string, string]] : []),
    ].sort((a, b) => b[0].length - a[0].length);

    const importedAt = nowIso();
    const meta: ProjectMeta = {
        ...body.meta,
        id: newProjectId,
        createdAt: importedAt,
        updatedAt: importedAt,
        extra: {
            ...body.meta.extra,
            importedFromProjectId: oldProjectId || undefined,
            assetManifest: undefined,
        },
    };

    return {
        oldProjectId,
        body: {
            ...body,
            meta,
            sceneJson: remapSceneJson(body.sceneJson, replacements),
            bundledAssets: body.bundledAssets
                ? remapJson(body.bundledAssets, replacements) as Record<string, string>
                : undefined,
        },
        assets: remapStoredAssets(assets, assetIdMap, revisionIdMap, replacements),
    };
};

const findProjectFile = (files: ImportableFile[]): ImportableFile => {
    const matches = files.filter(file => filePath(file).toLowerCase().endsWith(PROJECT_SUFFIX));
    if (matches.length === 0) {
        throw new Error("No .stemscript.json project file found.");
    }
    if (matches.length > 1) {
        throw new Error("Folder contains multiple .stemscript.json projects. Import one project folder at a time.");
    }
    return matches[0]!;
};

const readManifest = async (
    filesByPath: Map<string, ImportableFile>,
    projectFilePath: string,
    body: ProjectBody,
): Promise<{dir: string; entries: AssetManifestEntry[]} | null> => {
    const projectDir = dirname(projectFilePath);
    const originalId = body.meta.id || "";
    const manifestName = typeof body.meta.extra?.assetManifest === "string"
        ? body.meta.extra.assetManifest
        : "assets.json";
    const candidateDirs = Array.from(new Set([
        originalId,
        originalId ? `oss-${originalId.replace(/^oss-/, "")}` : "",
    ].filter(Boolean)));

    for (const assetDir of candidateDirs) {
        for (const name of Array.from(new Set([manifestName, "assets.json"]))) {
            const manifestPath = joinPath(projectDir, assetDir, name);
            const file = filesByPath.get(manifestPath);
            if (!file) continue;
            const parsed = JSON.parse(await file.text()) as AssetManifestEntry[];
            if (!Array.isArray(parsed)) {
                throw new Error(`Asset manifest "${manifestPath}" is not an array.`);
            }
            return {dir: dirname(manifestPath), entries: parsed};
        }
    }

    return null;
};

const loadStoredAssets = async (
    filesByPath: Map<string, ImportableFile>,
    manifestDir: string,
    entries: AssetManifestEntry[],
): Promise<StoredAsset[]> => {
    const out: StoredAsset[] = [];
    for (const entry of entries) {
        if (!entry.assetId || !entry.revisionId || !entry.type) {
            throw new Error("Asset manifest contains an invalid entry.");
        }
        let data = entry.data;
        let contentType = entry.contentType;
        if (!data) {
            if (!entry.file) {
                throw new Error(`Asset "${entry.assetId}" is missing a payload file.`);
            }
            const payloadFile = filesByPath.get(joinPath(manifestDir, entry.file));
            if (!payloadFile) {
                throw new Error(`Missing required asset file: ${joinPath(manifestDir, entry.file)}`);
            }
            data = await fileToBase64(payloadFile);
            contentType = contentType || payloadFile.type || undefined;
        } else if (data.startsWith("data:")) {
            const parsed = parseDataUrl(data);
            data = parsed.data;
            contentType = contentType || parsed.contentType;
        }
        const {file: _file, ...asset} = entry;
        out.push({...asset, contentType, data});
    }
    return out;
};

export async function importProjectBundleFiles(
    files: File[],
    store: ProjectStore = getProjectStore(),
): Promise<ProjectBundleImportResult> {
    if (store.kind === "remote" || !store.commitProject) {
        throw new Error("Project bundle import requires a local ProjectStore.");
    }

    const importableFiles = files as ImportableFile[];
    const filesByPath = new Map(importableFiles.map(file => [filePath(file), file]));
    const projectFile = findProjectFile(importableFiles);
    const projectPath = filePath(projectFile);
    const parsedBody = await parseProjectBody(projectFile);
    const manifest = await readManifest(filesByPath, projectPath, parsedBody);
    const assets = manifest
        ? await loadStoredAssets(filesByPath, manifest.dir, manifest.entries)
        : [];

    if (!manifest) {
        assertSingleFileIsSelfContained(parsedBody);
    } else {
        assertNoRevisionHistoryBundles(assets);
        assertManifestCoversAssetContext(parsedBody, assets);
    }

    const remapped = buildRemappedProject(parsedBody, assets);
    const saved = await store.commitProject(remapped.body, remapped.assets);

    for (const asset of remapped.assets) {
        const mime = asset.contentType || (asset.format === "json" ? "application/json" : "application/octet-stream");
        const thumbMime = asset.thumbnailContentType || "image/png";
        registerOssAsset({
            assetId: asset.assetId,
            revisionId: asset.revisionId,
            type: asset.type as never,
            format: asset.format,
            name: asset.name,
            contentType: asset.contentType,
            metadata: asset.metadata,
            dataUrl: `data:${mime};base64,${asset.data}`,
            thumbnailDataUrl: asset.thumbnailData
                ? `data:${thumbMime};base64,${asset.thumbnailData}`
                : undefined,
            projectId: saved.id,
        });
    }

    return {
        meta: saved,
        oldProjectId: remapped.oldProjectId,
        assetsImported: remapped.assets.length,
    };
}
