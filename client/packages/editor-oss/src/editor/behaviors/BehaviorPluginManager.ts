import {Object3D} from "three";

import {isAssetRef} from "@stem/editor-oss/asset-management/AssetRef";
import {Behavior} from "../../behaviors/Behavior";
import BehaviorData from "../../behaviors/BehaviorData";
import {
    EDITOR_PREVIEW_ADOPTED_KEY,
    EDITOR_PREVIEW_BEHAVIOR_UUID_KEY,
    EDITOR_PREVIEW_ROOT_KEY,
    markNewEditorPreviewRoots,
} from "../../behaviors/editorPreviewVisuals";
import {BehaviorWorkerBridge} from "../../behaviors/worker/BehaviorWorkerBridge";
import {disposeScriptResourceScope} from "../../script-runtime/ScriptResourceScope";
import {ensureRenderableMeshNormals} from "../../render/ensureRenderableMeshNormals";
import {traverseObjectDepthFirst} from "../../utils/SceneTraverser";
import Editor from "../Editor";

class BehaviorPluginManager {
    private behaviorPlugins: Map<string, Behavior> = new Map();
    private activePlugins: Behavior[] = [];
    private editor: Editor;
    private onUpdateActivityChanged?: (active: boolean) => void;
    private readonly pendingAdditions = new Set<Promise<void>>();

    /** Throttle interval for onEditorUpdate callbacks (1 FPS). */
    private static readonly UPDATE_INTERVAL = 1;
    private timeSinceLastUpdate = 0;

    constructor(editor: Editor, onUpdateActivityChanged?: (active: boolean) => void) {
        this.editor = editor;
        this.onUpdateActivityChanged = onUpdateActivityChanged;
    }

    addPlugin(target: Object3D, plugin: Behavior) {
        if (this.behaviorPlugins.has(plugin.uuid)) {
            console.error(
                `[BehaviorPluginManager] Behavior Plugin "${plugin.id}" with uuid "${plugin.uuid}" is already added.`,
            );
            return;
        }

        this.behaviorPlugins.set(plugin.uuid, plugin);
        console.info(
            `[BehaviorPluginManager] Behavior Plugin "${plugin.id}" added successfully with uuid "${plugin.uuid}".`,
        );

        this.handlePluginAddition(target, plugin);
    }

    getPlugin(uuid: string): Behavior | null {
        return this.behaviorPlugins.get(uuid) || null;
    }

    removePlugin(plugin: Behavior) {
        const uuid = plugin.uuid;

        if (this.behaviorPlugins.has(uuid)) {
            this.behaviorPlugins.delete(uuid);

            this.handlePluginRemoval(plugin);

            console.info(
                `[BehaviorPluginManager] Behavior Plugin "${plugin.id}" with uuid "${uuid}" removed successfully.`,
            );
        } else {
            console.error(
                `[BehaviorPluginManager] Cannot remove Behavior Plugin "${plugin.id}" with uuid "${uuid}", it is not added.`,
            );
        }
    }

    isPlugin(plugin: Behavior): boolean {
        return !!(
            plugin.onEditorAdded ||
            plugin.onEditorRemoved ||
            plugin.onEditorDispose ||
            plugin.onEditorUpdate ||
            plugin.onEditorAttributesUpdated ||
            plugin.onEditorPanelShown ||
            plugin.onEditorPanelHidden ||
            plugin.onEditorEvent
        );
    }

    update(deltaTime: number) {
        if (this.activePlugins.length === 0) {
            return;
        }
        this.timeSinceLastUpdate += deltaTime;
        if (this.timeSinceLastUpdate < BehaviorPluginManager.UPDATE_INTERVAL) {
            return;
        }
        this.timeSinceLastUpdate = 0;

        this.activePlugins.forEach(plugin => {
            try {
                plugin.onEditorUpdate?.();
            } catch (error) {
                console.error(`[BehaviorPluginManager] Error in onEditorUpdate for plugin "${plugin.id}":`, error);
            }
        });
    }

    clear(options?: {preserveEditorPreviewRoots?: boolean}) {
        const hadUpdatePlugins = this.hasEditorUpdatePlugins();
        const pluginsToRemove = [...this.behaviorPlugins.values()];
        this.behaviorPlugins.clear();
        pluginsToRemove.forEach(plugin => {
            plugin._workerBridge?.sendStop();
            try {
                if (options?.preserveEditorPreviewRoots) {
                    this.markPluginPreviewRootsForRuntimeAdoption(plugin);
                }
                plugin.onEditorDispose?.();
            } catch (error) {
                console.error(`[BehaviorPluginManager] Error in onEditorDispose for plugin "${plugin.id}":`, error);
            } finally {
                // Generated scripts may override onEditorDispose. Revoke the
                // scoped browser resources independently of user hook shape.
                disposeScriptResourceScope(plugin);
                plugin._workerBridge?.dispose();
            }
        });
        this.activePlugins = [];
        this.pendingAdditions.clear();
        if (hadUpdatePlugins) {
            this.onUpdateActivityChanged?.(false);
        }
    }

    async waitForPendingAdditions(): Promise<void> {
        while (this.pendingAdditions.size > 0) {
            await Promise.allSettled(Array.from(this.pendingAdditions));
        }
    }

    private markPluginPreviewRootsForRuntimeAdoption(plugin: Behavior): void {
        if (!this.canRuntimeAdoptEditorPreviewRoots(plugin)) {
            return;
        }

        const target = (plugin as {target?: Object3D | null}).target;
        const root = (plugin as {_root?: Object3D | null})._root;
        const markIfOwnedPreviewRoot = (candidate: Object3D | null | undefined) => {
            if (
                candidate?.userData?.[EDITOR_PREVIEW_ROOT_KEY] === true &&
                candidate.userData?.[EDITOR_PREVIEW_BEHAVIOR_UUID_KEY] === plugin.uuid
            ) {
                candidate.userData[EDITOR_PREVIEW_ADOPTED_KEY] = true;
            }
        };

        markIfOwnedPreviewRoot(root);
        if (!target) {
            return;
        }

        for (let i = 0; i < target.children.length; i++) {
            markIfOwnedPreviewRoot(target.children[i]);
        }
    }

    private canRuntimeAdoptEditorPreviewRoots(plugin: Behavior): boolean {
        const record = plugin as unknown as Record<string, unknown>;
        return typeof record._buildVisuals === "function" || record._adoptEditorPreviewRoot === true;
    }

    hasEditorUpdatePlugins(): boolean {
        return this.activePlugins.length > 0;
    }

    /** Reapply the editor-only cap after a behavior rebuilds its visuals. */
    refreshEditorPreviewInstancingBudget(): void {
        this.editor.refreshEditorPreviewInstancingBudget();
    }

    /**
     * Notify editor plugins whose behavior attributes reference the given asset.
     * Should be called after the scene's AssetResolutionContext has been updated
     * and AssetRef values have been re-resolved.
     *
     * @param scene - The scene root to traverse.
     * @param assetId - The asset ID whose revision changed.
     */
    updateAssetRefs(scene: Object3D, assetId: string): void {
        traverseObjectDepthFirst(scene, object => {
            const behaviors = object.userData?.behaviors as BehaviorData[] | undefined;
            if (!behaviors) return;

            let objectAffected = false;

            for (const behavior of behaviors) {
                if (!behavior.attributesData || !this.behaviorReferencesAsset(behavior, assetId)) {
                    continue;
                }

                objectAffected = true;

                const plugin = this.getPlugin(behavior.uuid);
                if (plugin) {
                    try {
                        (plugin as any).attributes = behavior.attributesData;
                        plugin.onEditorAttributesUpdated?.();
                        this.editor.scheduleEditorPreviewInstancingBudget?.();
                    } catch (error) {
                        console.error(
                            `[BehaviorPluginManager] Error in onEditorAttributesUpdated for plugin "${plugin.id}":`,
                            error,
                        );
                    }
                }
            }

            if (objectAffected) {
                this.editor.engine?.call("objectChanged", this.editor, object);
            }
        });
    }

    /**
     * Check whether a behavior's attributes contain any AssetRef that
     * references the given asset ID.
     *
     * @param behavior - The behavior data to inspect.
     * @param assetId - The asset ID to search for.
     * @returns True if any attribute references the asset.
     */
    private behaviorReferencesAsset(behavior: BehaviorData, assetId: string): boolean {
        if (!behavior.attributesData) return false;

        const stack: unknown[] = Object.values(behavior.attributesData);
        const seen = new Set<object>();

        while (stack.length > 0) {
            const value = stack.pop();

            if (isAssetRef(value)) {
                if (value.assetId === assetId) {
                    return true;
                }
                continue;
            }

            if (Array.isArray(value)) {
                stack.push(...value);
                continue;
            }

            if (value && typeof value === "object") {
                if (seen.has(value)) {
                    continue;
                }
                seen.add(value);
                stack.push(...Object.values(value));
            }
        }

        return false;
    }

    private handlePluginAddition(target: Object3D, plugin: Behavior) {
        const hadUpdatePlugins = this.hasEditorUpdatePlugins();
        (plugin as any).target = target;
        const previousChildren = new Set(target.children);
        const markPreviewRoots = () => markNewEditorPreviewRoots(target, plugin, previousChildren);

        try {
            const editorAddedResult = plugin.onEditorAdded?.(this.editor) as void | Promise<void>;
            if (editorAddedResult && typeof (editorAddedResult as Promise<void>).then === "function") {
                const pending = Promise.resolve(editorAddedResult)
                    .then(() => {
                        if (this.behaviorPlugins.get(plugin.uuid) === plugin) {
                            markPreviewRoots();
                            this.editor.scheduleEditorPreviewInstancingBudget?.();
                        } else {
                            plugin.onEditorDispose?.();
                        }
                    })
                    .catch(error => {
                        console.error(`[BehaviorPluginManager] Error in async onEditorAdded for plugin "${plugin.id}":`, error);
                    })
                    .finally(() => {
                        this.pendingAdditions.delete(pending);
                    });
                this.pendingAdditions.add(pending);
            } else {
                markPreviewRoots();
                this.editor.scheduleEditorPreviewInstancingBudget?.();
            }
            ensureRenderableMeshNormals(target);
        } catch (error) {
            console.error(`[BehaviorPluginManager] Error in onEditorAdded for plugin "${plugin.id}":`, error);
        }

        this.initPluginWorker(plugin);

        if (plugin.onEditorUpdate) {
            this.activePlugins.push(plugin);
        }
        this.notifyUpdateActivityChanged(hadUpdatePlugins);
    }

    private handlePluginRemoval(plugin: Behavior) {
        const hadUpdatePlugins = this.hasEditorUpdatePlugins();
        const index = this.activePlugins.indexOf(plugin);
        if (index !== -1) {
            this.activePlugins.splice(index, 1);
        }
        this.notifyUpdateActivityChanged(hadUpdatePlugins);

        try {
            plugin._workerBridge?.sendStop();
            plugin.onEditorRemoved?.();
        } catch (error) {
            console.error(`[BehaviorPluginManager] Error in onEditorRemoved for plugin "${plugin.id}":`, error);
        } finally {
            plugin._workerBridge?.dispose();
        }

        (plugin as any).target = null;
    }

    private initPluginWorker(plugin: Behavior): void {
        if (!plugin.workerClass) return;
        const bridge = new BehaviorWorkerBridge(plugin, plugin.id);
        try {
            if (!bridge.init(plugin.workerClass)) {
                return;
            }
            plugin._workerBridge = bridge;
            bridge.sendInit(plugin.getWorkerInitData?.("editor") ?? {runtime: "editor"});
            bridge.sendStart();
        } catch (error) {
            console.error(`[BehaviorPluginManager] Error initializing worker for plugin "${plugin.id}":`, error);
            bridge.dispose();
        }
    }

    private notifyUpdateActivityChanged(previous: boolean): void {
        const current = this.hasEditorUpdatePlugins();
        if (previous === current) return;
        if (!current) this.timeSinceLastUpdate = 0;
        this.onUpdateActivityChanged?.(current);
    }
}

export default BehaviorPluginManager;
