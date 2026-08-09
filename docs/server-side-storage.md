# Server-side storage & version control

> **Status:** design and integration reference. The current supported product
> workflow is the local Playground. Remote scene and asset APIs are not
> deployed, and selecting Playground mode never activates `RemoteProjectStore`.

StemStudio works fully offline — projects live in IndexedDB or a folder you
pick via the File System Access API. But the editor never talks to storage
directly. Every save, load, asset, and revision flows through a small set of
**interfaces**. Implement them and the editor runs against your own server,
with full version control.

This page lists the interfaces you implement to add network storage and a
version-controlled, self-hosted experience.

## Persistence is an interface, not a backend

This repository contains three `ProjectStore` implementations. The current
Playground selects IndexedDB or folder storage. `RemoteProjectStore` is an
undeployed adapter seam for a future/self-hosted integration.

| Implementation | Backing store |
|---|---|
| `IndexedDBProjectStore` | Browser-local (default) |
| `FileSystemProjectStore` | A user-picked folder (File System Access API) |
| `RemoteProjectStore` | HTTP-backed adapter seam; not a deployed Playground backend |

## 1. Project storage — `ProjectStore`

[`client/packages/editor-oss/src/persistence/ProjectStore.ts`](https://github.com/Stem-Studio/Engine/blob/main/client/packages/editor-oss/src/persistence/ProjectStore.ts)

The single seam between the editor's save/load flows and any storage backend:

```ts
interface ProjectStore {
    list(options?): Promise<ListProjectsResult>;
    load(id): Promise<ProjectBody>;
    save(body): Promise<ProjectMeta>;
    commitProject?(body, assets): Promise<ProjectMeta>;
    delete(id): Promise<void>;
    exportToBlob(id): Promise<Blob>;
    importFromBlob(blob): Promise<ProjectMeta>;
    saveAssets(projectId, assets): Promise<void>;
    loadAssets(projectId): Promise<StoredAsset[]>;
}
```

`commitProject` is optional at the interface level because remote transports
may coordinate persistence differently. It is the required local save path:
the IndexedDB and folder stores atomically publish a scene snapshot together
with its complete binary-asset generation, preserving the previously loadable
generation if the new commit fails.

The current remote adapter instead exposes separate `save` and `saveAssets`
operations. A future remote integration must provide its own transaction,
version, or recovery contract; two successful-looking requests are not
automatically equivalent to the local atomic commit.

Implement this interface (or extend the provided
[`RemoteProjectStore`](https://github.com/Stem-Studio/Engine/blob/main/client/packages/editor-oss/src/persistence/RemoteProjectStore.ts))
and register it once at boot with `setProjectStore()` from
[`persistence/projectStoreFactory.ts`](https://github.com/Stem-Studio/Engine/blob/main/client/packages/editor-oss/src/persistence/projectStoreFactory.ts).
`RemoteProjectStore` keeps its transport injectable through
`RemoteProjectStoreDeps` (`fetchScenes`, `loadScene`, `saveScene`,
`deleteScene`) — wire those four functions to your endpoints and you have
network storage. Doing so requires application bootstrap, authentication,
authorization, conflict handling, and operational work beyond implementing the
four transport calls.

## 2. Asset storage & dependencies — `AssetSource`

[`client/packages/editor-oss/src/editor/asset-management/AssetSource.ts`](https://github.com/Stem-Studio/Engine/blob/main/client/packages/editor-oss/src/editor/asset-management/AssetSource.ts)

Asset discovery, dependency tracking, and revision creation for models,
behaviors, audio, and textures:

```ts
interface AssetSource {
    getAssets(options?): Promise<AssetSourceResponse>;
    addDependencies(deps): Promise<void>;
    removeDependencies(assetIds): Promise<void>;
    createAsset(params): Promise<Asset>;
    createAssetRevision(params): Promise<AssetRevision>;
}
```

`createAssetRevision` is the per-asset version-control hook — every edit to a
model or behavior can become a new immutable revision.

## 3. Version control

Version control is the **revision model** exposed by the network adapter,
[`@stem/network`](https://github.com/Stem-Studio/Engine/tree/main/client/packages/network).
A self-hosted backend implements these endpoints:

| Capability | API surface |
|---|---|
| Scene revisions (head vs. published) | `getScene(id, { revision: "head" \| "published", revisionId })` |
| Asset revision history | `createAssetRevision`, `getAssetRevisions` |
| Published-release pinning | `getAssetReleases` |

Together these give the editor full history: every save is a revision,
viewers see the pinned published release, and contributors edit head — the
same model used by the editor's revision-aware adapters.

The local Playground stubs these (revisions resolve to a single synthetic entry,
release lists are empty). Implementing them on your server turns on the full
version-controlled experience.

## Summary — what to implement

1. **`ProjectStore`** — network storage for projects and their assets.
2. **`AssetSource`** — asset discovery and per-asset revisions.
3. **`@stem/network` revision endpoints** — scene/asset revision history and
   published releases for full version control.

Start from `RemoteProjectStore` and the `@stem/network` adapter when designing
a backend. Do not treat this page as a deployment recipe or a claim that the
remote mode is production-ready.
