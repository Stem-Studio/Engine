import type {ProjectStore} from "./ProjectStore";
import type {
    ListProjectsOptions,
    ListProjectsResult,
    ProjectBody,
    ProjectMeta,
    StoredAsset,
} from "./types";
export {isFileSystemAccessSupported} from "./fileSystemAccess";

/**
 * Chromium-only project store backed by the File System Access API. Each
 * project is one `.stemscript` JSON file inside a user-picked directory.
 *
 * The directory handle is supplied at construction time. The first-time
 * bootstrap modal is responsible for prompting the user and persisting the
 * handle (in IndexedDB) for re-use across sessions.
 */

// Subset of the File System Access API types so we don't pull in a full lib
// dep. The runtime check `isFileSystemAccessSupported()` is the source of
// truth for whether these are actually available.
type FsFileHandle = {
    kind: "file";
    name: string;
    getFile(): Promise<File>;
    createWritable(options?: {keepExistingData?: boolean}): Promise<{
        write(data: Blob | string | BufferSource): Promise<void>;
        close(): Promise<void>;
    }>;
};
type FsDirectoryHandle = {
    kind: "directory";
    name: string;
    getFileHandle(name: string, options?: {create?: boolean}): Promise<FsFileHandle>;
    getDirectoryHandle(name: string, options?: {create?: boolean}): Promise<FsDirectoryHandle>;
    removeEntry(name: string, options?: {recursive?: boolean}): Promise<void>;
    entries(): AsyncIterableIterator<[string, FsFileHandle | FsDirectoryHandle]>;
};

const SUFFIX = ".stemscript.json";

/** Filename for an asset's binary payload inside the project's subdirectory. */
const ASSET_MANIFEST = "assets.json";
const ASSET_MANIFEST_PREFIX = "assets.";
const ASSET_MANIFEST_SUFFIX = ".json";

/**
 * True only for the File System Access API's "this entry does not exist" error
 * (`getDirectoryHandle`/`getFileHandle` on a missing path). This is the *one*
 * absence we may treat as "legitimately empty". Every other error (permission
 * revoked, malformed JSON, truncated binary) is a real failure that must
 * surface — never be swallowed into an empty result.
 */
const isNotFoundError = (err: unknown): boolean =>
    err instanceof DOMException
        ? err.name === "NotFoundError"
        : (err as {name?: string})?.name === "NotFoundError";

const bytesToBase64 = (bytes: Uint8Array): string => {
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
};

const base64ToBytes = (base64: string): Uint8Array<ArrayBuffer> => {
    const binary = atob(base64);
    const buffer = new ArrayBuffer(binary.length);
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
};

type AssetManifestEntry = Omit<StoredAsset, "data"> & {file: string};

const nowIso = (): string => new Date().toISOString();

const newId = (): string =>
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `proj_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;

const sanitizeName = (name: string): string =>
    name.replace(/[^a-z0-9._-]+/gi, "_").slice(0, 80) || "untitled";

const generationToken = (): string =>
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

const filenameFor = (meta: ProjectMeta, generation = generationToken()): string =>
    `${sanitizeName(meta.name)}.${meta.id}.${generation}${SUFFIX}`;

export class FileSystemProjectStore implements ProjectStore {
    readonly kind = "filesystem" as const;

    constructor(private readonly dir: FsDirectoryHandle) {}

    // Serializes mutating operations. The File System Access API throws
    // `NoModificationAllowedError` if two `createWritable()` calls target the
    // same file concurrently, and our save flow writes many files plus a
    // manifest. When two saves overlap (e.g. an autosave firing while a manual
    // save is mid-write — more likely for large projects that take seconds to
    // persist), the second save's writes collide with the first, the asset
    // persist throws, and the project is left with no/partial assets. Chaining
    // every write through this promise guarantees they run one-at-a-time.
    private writeChain: Promise<unknown> = Promise.resolve();

    private serializeWrite<T>(op: () => Promise<T>): Promise<T> {
        const run = this.writeChain.then(() => this.runWithRetry(op), () => this.runWithRetry(op));
        // Keep the chain alive regardless of this op's outcome.
        this.writeChain = run.then(
            () => undefined,
            () => undefined,
        );
        return run;
    }

    /**
     * Heavy writes (e.g. a project with tens of MB of GLBs) intermittently fail
     * with transient File System Access errors — `NotFoundError`,
     * `InvalidStateError`, `NoModificationAllowedError` — when the browser is
     * under write pressure. These are not real data errors; the same op
     * succeeds on a retry. Retry a few times with a short backoff before giving
     * up so a single transient blip doesn't fail an entire project save.
     */
    private async runWithRetry<T>(op: () => Promise<T>, attempts = 3): Promise<T> {
        let lastErr: unknown;
        for (let i = 0; i < attempts; i++) {
            try {
                return await op();
            } catch (err) {
                lastErr = err;
                const name = (err as {name?: string})?.name ?? "";
                const transient =
                    name === "NotFoundError" ||
                    name === "InvalidStateError" ||
                    name === "NoModificationAllowedError";
                if (!transient || i === attempts - 1) throw err;
                await new Promise(resolve => setTimeout(resolve, 150 * (i + 1)));
            }
        }
        throw lastErr;
    }

    /** Folder name the user picked, surfaced in the dashboard UI. */
    getDirectoryName(): string {
        return this.dir.name;
    }

    async list(options: ListProjectsOptions = {}): Promise<ListProjectsResult> {
        const page = Math.max(1, options.page ?? 1);
        const limit = Math.max(1, options.limit ?? 40);
        const search = options.search?.trim().toLowerCase() ?? "";

        const latestById = new Map<string, ProjectMeta>();
        for await (const [name, handle] of this.dir.entries()) {
            if (handle.kind !== "file" || !name.endsWith(SUFFIX)) continue;
            try {
                const file = await (handle).getFile();
                const body = JSON.parse(await file.text()) as ProjectBody;
                if (body?.meta) {
                    const previous = latestById.get(body.meta.id);
                    if (
                        !previous ||
                        new Date(body.meta.updatedAt).getTime() > new Date(previous.updatedAt).getTime()
                    ) {
                        latestById.set(body.meta.id, body.meta);
                    }
                }
            } catch (err) {
                // We're iterating files that demonstrably exist, so a failure
                // here means the file is present but unreadable/corrupt — a real
                // problem. Keep listing the *other* projects (hiding all of them
                // behind one bad file would be its own masking fallback), but
                // make the bad file loud instead of silently dropping it.
                console.error(`[FileSystemProjectStore] Skipping unreadable project file "${name}":`, err);
            }
        }

        const all = [...latestById.values()];
        const filtered = search ? all.filter(p => p.name.toLowerCase().includes(search)) : all;
        const sorted = filtered.sort(
            (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
        );
        const start = (page - 1) * limit;
        const slice = sorted.slice(start, start + limit);

        return {
            projects: slice,
            page,
            hasMore: start + slice.length < sorted.length,
            totalCount: sorted.length,
        };
    }

    private async matchingNamesForId(id: string): Promise<string[]> {
        const matches: string[] = [];
        for await (const [name, handle] of this.dir.entries()) {
            if (handle.kind === "file" && name.endsWith(SUFFIX) && name.includes(`.${id}.`)) {
                matches.push(name);
            }
        }
        return matches;
    }

    private async resolveHandleForId(id: string): Promise<FsFileHandle> {
        let best: {handle: FsFileHandle; updatedAt: number} | undefined;
        for await (const [name, handle] of this.dir.entries()) {
            if (handle.kind !== "file" || !name.endsWith(SUFFIX) || !name.includes(`.${id}.`)) {
                continue;
            }
            let updatedAt = 0;
            try {
                const file = await handle.getFile();
                const body = JSON.parse(await file.text()) as ProjectBody;
                updatedAt = new Date(body.meta?.updatedAt ?? 0).getTime();
            } catch {
                // Keep malformed matches as a last-resort candidate so the
                // load error still points at the project file instead of
                // pretending it doesn't exist.
            }
            if (!best || updatedAt > best.updatedAt) {
                best = {handle, updatedAt};
            }
        }
        if (best) return best.handle;
        throw new Error(`Project ${id} not found in folder`);
    }

    async load(id: string): Promise<ProjectBody> {
        const handle = await this.resolveHandleForId(id);
        const file = await handle.getFile();
        return JSON.parse(await file.text()) as ProjectBody;
    }

    save(body: ProjectBody): Promise<ProjectMeta> {
        return this.serializeWrite(() => this.saveLocked(body));
    }

    private async saveLocked(body: ProjectBody): Promise<ProjectMeta> {
        const meta: ProjectMeta = {
            ...body.meta,
            id: body.meta.id || newId(),
            createdAt: body.meta.createdAt || nowIso(),
            updatedAt: nowIso(),
        };
        const toStore: ProjectBody = {...body, meta};
        const targetName = filenameFor(meta);
        const staleNames = (await this.matchingNamesForId(meta.id)).filter(name => name !== targetName);
        const handle = await this.dir.getFileHandle(targetName, {create: true});
        const writable = await handle.createWritable();
        try {
            await writable.write(JSON.stringify(toStore, null, 2));
        } finally {
            await writable.close();
        }
        for (const name of staleNames) {
            await this.dir.removeEntry(name);
        }
        return meta;
    }

    commitProject(body: ProjectBody, assets: StoredAsset[]): Promise<ProjectMeta> {
        return this.serializeWrite(() => this.commitProjectLocked(body, assets));
    }

    private async commitProjectLocked(body: ProjectBody, assets: StoredAsset[]): Promise<ProjectMeta> {
        const generation = generationToken();
        const id = body.meta.id || newId();
        const assetManifest = await this.writeAssetGenerationLocked(id, generation, assets);
        const meta: ProjectMeta = {
            ...body.meta,
            id,
            createdAt: body.meta.createdAt || nowIso(),
            updatedAt: nowIso(),
            extra: {...body.meta.extra, assetManifest},
        };
        const targetName = filenameFor(meta, generation);
        const staleNames = (await this.matchingNamesForId(meta.id)).filter(name => name !== targetName);

        // The project file is the commit record and is written last under a
        // fresh generation name. Until close succeeds, load() still resolves
        // the prior project and its prior asset-manifest pointer.
        const handle = await this.dir.getFileHandle(targetName, {create: true});
        const writable = await handle.createWritable();
        try {
            await writable.write(JSON.stringify({...body, meta}, null, 2));
        } finally {
            await writable.close();
        }

        for (const name of staleNames) {
            try {
                await this.dir.removeEntry(name);
            } catch (error) {
                console.warn(`[FileSystemProjectStore] Could not remove stale project generation "${name}"`, error);
            }
        }
        await this.cleanupOldAssetGenerations(meta.id, assetManifest);
        return meta;
    }

    delete(id: string): Promise<void> {
        return this.serializeWrite(() => this.deleteLocked(id));
    }

    private async deleteLocked(id: string): Promise<void> {
        for (const name of await this.matchingNamesForId(id)) {
            await this.dir.removeEntry(name);
        }
        // Drop the project's asset subdirectory too.
        try {
            await this.dir.removeEntry(id, {recursive: true});
        } catch {
            // No asset subdirectory — nothing to clean up.
        }
    }

    saveAssets(projectId: string, assets: StoredAsset[]): Promise<void> {
        return this.serializeWrite(async () => {
            const body = await this.load(projectId);
            await this.commitProjectLocked(body, assets);
        });
    }

    private async writeAssetGenerationLocked(
        projectId: string,
        generation: string,
        assets: StoredAsset[],
    ): Promise<string> {
        const projectDir = await this.dir.getDirectoryHandle(projectId, {create: true});
        const writeAsset = async (asset: StoredAsset): Promise<AssetManifestEntry> => {
            const file = `${generation}.${asset.assetId}.${asset.format || "bin"}`;
            const handle = await projectDir.getFileHandle(file, {create: true});
            const writable = await handle.createWritable();
            try {
                await writable.write(base64ToBytes(asset.data));
            } finally {
                await writable.close();
            }
            const {data: _omit, ...meta} = asset;
            return {...meta, file};
        };
        const manifest: AssetManifestEntry[] = await Promise.all(assets.map(writeAsset));

        // A generation manifest is never overwritten. If any payload or this
        // manifest fails, the previous project still points to its untouched
        // last-known-good generation.
        const manifestName = `${ASSET_MANIFEST_PREFIX}${generation}${ASSET_MANIFEST_SUFFIX}`;
        const manifestHandle = await projectDir.getFileHandle(manifestName, {create: true});
        const manifestWritable = await manifestHandle.createWritable();
        try {
            await manifestWritable.write(JSON.stringify(manifest, null, 2));
        } finally {
            await manifestWritable.close();
        }
        return manifestName;
    }

    private async cleanupOldAssetGenerations(projectId: string, currentManifestName: string): Promise<void> {
        let projectDir: FsDirectoryHandle;
        try {
            projectDir = await this.dir.getDirectoryHandle(projectId);
        } catch {
            return;
        }
        let currentManifest: AssetManifestEntry[];
        try {
            const file = await (await projectDir.getFileHandle(currentManifestName)).getFile();
            currentManifest = JSON.parse(await file.text()) as AssetManifestEntry[];
        } catch {
            // Never clean anything unless the committed generation re-reads.
            return;
        }
        const keep = new Set<string>([currentManifestName, ...currentManifest.map(entry => entry.file)]);
        for await (const [name, handle] of projectDir.entries()) {
            if (handle.kind !== "file" || keep.has(name)) continue;
            try {
                await projectDir.removeEntry(name);
            } catch (error) {
                console.warn(`[FileSystemProjectStore] Could not remove stale asset generation "${name}"`, error);
            }
        }
    }

    async loadAssets(projectId: string): Promise<StoredAsset[]> {
        let projectDir: FsDirectoryHandle;
        try {
            projectDir = await this.dir.getDirectoryHandle(projectId);
        } catch (err) {
            // The *only* acceptable quiet path: no asset subdirectory at all
            // (project saved before assets existed, or has no binary assets).
            // A permission error or anything else is real — surface it.
            if (isNotFoundError(err)) return [];
            throw err;
        }

        let manifestName = ASSET_MANIFEST;
        const projectNames = await this.matchingNamesForId(projectId);
        if (projectNames.length > 0) {
            const project = await this.load(projectId);
            const referencedManifest = project.meta.extra?.assetManifest;
            if (typeof referencedManifest === "string" && referencedManifest) {
                manifestName = referencedManifest;
            }
        }

        let manifest: AssetManifestEntry[];
        try {
            const manifestFile = await (await projectDir.getFileHandle(manifestName)).getFile();
            manifest = JSON.parse(await manifestFile.text()) as AssetManifestEntry[];
        } catch (err) {
            // No manifest file → no assets recorded (legit empty). But a manifest
            // that exists and fails to read/parse means the asset index is
            // corrupt — returning [] there would silently drop every model on
            // reload. Surface it instead of pretending the project has no assets.
            if (isNotFoundError(err)) return [];
            throw new Error(
                `Asset manifest for project "${projectId}" is unreadable or malformed: ` +
                (err instanceof Error ? err.message : String(err)),
            );
        }
        if (!Array.isArray(manifest)) {
            throw new Error(`Asset manifest for project "${projectId}" is not an array`);
        }

        const assets: StoredAsset[] = [];
        for (const entry of manifest) {
            // The manifest lists this asset, so the file is expected to exist.
            // A failure here is a real, data-losing problem (a model that won't
            // appear after reload) — fail the load loudly rather than returning
            // a half-populated scene that looks fine but is missing geometry.
            const file = await (await projectDir.getFileHandle(entry.file)).getFile();
            const bytes = new Uint8Array(await file.arrayBuffer());
            const {file: _file, ...meta} = entry;
            assets.push({...meta, data: bytesToBase64(bytes)});
        }
        return assets;
    }

    async exportToBlob(id: string): Promise<Blob> {
        const body = await this.load(id);
        return new Blob([JSON.stringify(body, null, 2)], {type: "application/json"});
    }

    async importFromBlob(blob: Blob): Promise<ProjectMeta> {
        const parsed = JSON.parse(await blob.text()) as ProjectBody;
        if (!parsed || typeof parsed !== "object" || !parsed.sceneJson) {
            throw new Error("Imported file is not a valid .stemscript project");
        }
        const incoming: ProjectMeta = parsed.meta ?? {
            id: "",
            name: "Imported project",
            updatedAt: nowIso(),
            createdAt: nowIso(),
        };
        return this.save({
            ...parsed,
            meta: {...incoming, id: newId(), createdAt: nowIso(), updatedAt: nowIso()},
        });
    }
}
