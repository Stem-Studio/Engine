import * as UIKit from "@ni2khanna/uikit";
import {CSS3DObject, CSS3DSprite} from "three/addons/renderers/CSS3DRenderer.js";
import type * as THREE from "three";
import * as Quarks from "three.quarks";

import {
    BEHAVIOR_LIFECYCLE_HOOK_QUERY,
    Behavior,
    BehaviorBase,
    BehaviorConstructor,
    type BehaviorLifecycleHookName,
    BehaviorOptions,
} from "./Behavior";
import EventBus from "./event/EventBus";
import GameManager from "./game/GameManager";
import UIKitPointerEvents from "./uikit/UIKitPointerEvents";
import type {ReadonlyAssetResolutionContext} from "@stem/editor-oss/asset-management/AssetResolutionContext";
import {CesiumTool} from "@stem/editor-oss/cesium/CesiumTool";
import {breakpointManager, injectDebuggerStatements} from "@stem/editor-oss/editor/assets/v2/BehaviorEditor/breakpoints";
import global from "@stem/editor-oss/global";
import {buildScriptImportAliases} from "../script-runtime/scriptImportAliases";
import {
    collectParticleEmitterObjects,
    EDITOR_PREVIEW_ADOPTED_KEY,
    EDITOR_PREVIEW_ROOT_KEY,
    EDITOR_PREVIEW_BEHAVIOR_UUID_KEY,
    findEditorPreviewRootForBehavior,
} from "./editorPreviewVisuals";
import {parseScriptImportsCached, type ScriptImportRevisionMap} from "../script-runtime/scriptImportCore";
import {RuntimeTHREE, TSL} from "../script-runtime/runtimeThreeEndowment";
import {removeDebuggerStatements, shouldFilterDebuggers} from "@stem/editor-oss/utils/DebuggerUtils";
import {SCRIPT_RESOURCE_SCOPE_SYMBOL, ScriptResourceScope} from "@stem/editor-oss/script-runtime/ScriptResourceScope";

import "ses";

const SCRIPT_CLASS_CACHE_LIMIT = 128;
const SCRIPT_RUNTIME_COMPAT_VERSION = "uikit-fullscreen-camera-v21-root-full-percent-normalize";
const scriptClassCache = new Map<string, BehaviorConstructor>();

const isPromiseLike = <T = unknown>(value: unknown): value is PromiseLike<T> =>
    !!value &&
    (typeof value === "object" || typeof value === "function") &&
    typeof (value as {then?: unknown}).then === "function";

const hashString = (value: string): string => {
    let hash = 2166136261;
    for (let i = 0; i < value.length; i++) {
        hash ^= value.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
};

const getRecordSignature = (record?: Readonly<Record<string, string>>): string => {
    if (!record) {
        return "";
    }

    return Object.keys(record)
        .sort()
        .map(key => `${key}:${record[key]}`)
        .join("|");
};

const getContextSignature = (context?: ReadonlyAssetResolutionContext): string =>
    [
        getRecordSignature(context?.logicalIdToAssetId),
        getRecordSignature(context?.assetIdToRevisionId),
        getRecordSignature(context?.nameToAssetId),
    ].join("||");

const getImportRevisionMapSignature = (importRevisionMap?: ScriptImportRevisionMap): string => {
    if (!importRevisionMap) {
        return "";
    }

    return Object.keys(importRevisionMap)
        .sort()
        .map(key => {
            const entry = importRevisionMap[key];
            const code = entry?.code ?? "";
            return `${key}:${entry?.assetId ?? ""}:${entry?.revisionId ?? ""}:${code.length}:${hashString(code)}`;
        })
        .join("|");
};

const getBreakpointSignature = (breakpoints: Set<number>): string =>
    Array.from(breakpoints)
        .sort((a, b) => a - b)
        .join(",");

const getScriptClassCacheKey = (
    scriptName: string,
    scriptString: string,
    compartmentsEnabled: boolean,
    productionMode: unknown,
    breakpoints: Set<number>,
    options?: {
        context?: ReadonlyAssetResolutionContext;
        importRevisionMap?: ScriptImportRevisionMap;
    },
): string =>
    [
        SCRIPT_RUNTIME_COMPAT_VERSION,
        scriptName,
        scriptString.length,
        hashString(scriptString),
        compartmentsEnabled ? "compartment" : "function",
        String(productionMode ?? false),
        getBreakpointSignature(breakpoints),
        getContextSignature(options?.context),
        getImportRevisionMapSignature(options?.importRevisionMap),
    ].join("\u001f");

const getCachedScriptClass = (key: string): BehaviorConstructor | null => {
    const cached = scriptClassCache.get(key);
    if (!cached) {
        return null;
    }

    scriptClassCache.delete(key);
    scriptClassCache.set(key, cached);
    return cached;
};

const setCachedScriptClass = (key: string, cls: BehaviorConstructor): void => {
    scriptClassCache.set(key, cls);
    if (scriptClassCache.size <= SCRIPT_CLASS_CACHE_LIMIT) {
        return;
    }

    const oldestKey = scriptClassCache.keys().next().value;
    if (oldestKey !== undefined) {
        scriptClassCache.delete(oldestKey);
    }
};

/**
 *
 */
function isCompartmentsEnabled(): boolean {
    return global.app?.editor?.scene?.userData?.compartmentsEnabled ?? false;
}

interface UIKitFullscreenLike extends THREE.Object3D {
    update(...args: any[]): void;
}

const RuntimeFullscreenBase = UIKit.Fullscreen as unknown as new (...args: any[]) => UIKitFullscreenLike;
const fullscreenCameraResolutionWarnings = new WeakSet<UIKitFullscreenLike>();
const fullscreenInstanceUpdatePatchedSymbol = Symbol.for(
    `stem.editor-oss.uikit.fullscreenInstanceUpdatePatched.${SCRIPT_RUNTIME_COMPAT_VERSION}`,
);
const fullscreenInstanceDisposePatchedSymbol = Symbol.for(
    `stem.editor-oss.uikit.fullscreenInstanceDisposePatched.${SCRIPT_RUNTIME_COMPAT_VERSION}`,
);
const FULLSCREEN_REPAIR_SCAN_DEPTH = 5;
const directScriptHookWrappedSymbol = Symbol.for(
    `stem.editor-oss.directScriptHookWrapped.${SCRIPT_RUNTIME_COMPAT_VERSION}`,
);
const visualBuilderWrappedSymbol = Symbol.for(
    `stem.editor-oss.visualBuilderWrapped.${SCRIPT_RUNTIME_COMPAT_VERSION}`,
);
const visualBuilderAdoptionAttemptedSymbol = Symbol.for(
    `stem.editor-oss.visualBuilderAdoptionAttempted.${SCRIPT_RUNTIME_COMPAT_VERSION}`,
);
const visualTeardownWrappedSymbol = Symbol.for(
    `stem.editor-oss.visualTeardownWrapped.${SCRIPT_RUNTIME_COMPAT_VERSION}`,
);
const ownedRootDisposeWrappedSymbol = Symbol.for(
    `stem.editor-oss.ownedRootDisposeWrapped.${SCRIPT_RUNTIME_COMPAT_VERSION}`,
);
const EXPLICIT_EDITOR_PREVIEW_ADOPTION_HOOK = "_adoptEditorPreviewRoot";
const ADOPTED_EDITOR_PREVIEW_ROOT_KEY = "_adoptedEditorPreviewRoot";
const ADOPTED_EDITOR_PREVIEW_CONTEXT_KEY = "_adoptedEditorPreviewContext";
const DIRECT_SCRIPT_HOOKS = [
    "init",
    "dispose",
    "update",
    "fixedUpdate",
    "onStart",
    "onStop",
    "onPaused",
    "onResumed",
    "onReset",
    "onEvent",
    "onAttributesUpdated",
    "onStateUpdated",
    "onAttributeChangeRequested",
    "onAttributeChanged",
] as const;
type DirectScriptHookName = (typeof DIRECT_SCRIPT_HOOKS)[number];
type DirectScriptHookStorage = Partial<Record<DirectScriptHookName, unknown>>;
const DIRECT_SCRIPT_HOOK_SET = new Set<DirectScriptHookName>(DIRECT_SCRIPT_HOOKS);
const FRAME_SCRIPT_HOOKS = new Set<(typeof DIRECT_SCRIPT_HOOKS)[number]>(["update", "fixedUpdate"]);
const directScriptHookValuesSymbol = Symbol.for(
    `stem.editor-oss.directScriptHookValues.${SCRIPT_RUNTIME_COMPAT_VERSION}`,
);
const scriptResourceScopeSymbol = SCRIPT_RESOURCE_SCOPE_SYMBOL;
const fullscreenFrameHookPreparedRoots = new WeakSet<object>();
const fullscreenKnownRootsByScriptRoot = new WeakMap<object, Set<UIKitFullscreenLike>>();
const fullscreenDisposedRoots = new WeakSet<UIKitFullscreenLike>();
const fullscreenOwnedRoots = new WeakSet<UIKitFullscreenLike>();
const fullscreenEverCameraAttachedRoots = new WeakSet<UIKitFullscreenLike>();
const fullscreenUpdatedBehaviorFrames = new WeakMap<UIKitFullscreenLike, bigint>();
let fullscreenBehaviorFrameEpoch = 0n;
let activeFullscreenBehaviorFrameEpoch = 0n;
let activeFullscreenBehaviorFrameRootA: unknown;
let activeFullscreenBehaviorFrameRootB: unknown;
const FULLSCREEN_REPAIR_SKIP_KEYS = new Set([
    "target",
    "gameObject",
    "erth",
    "attributes",
    "options",
    "throttleConfig",
    "game",
    "_game",
    "scene",
    "renderer",
    "camera",
    "uiCamera",
    "behaviorManager",
    "lambdaManager",
    "physics",
    "engine",
]);

const isFullscreenCameraLike = (object: unknown): object is THREE.PerspectiveCamera | THREE.OrthographicCamera =>
    !!object &&
    typeof object === "object" &&
    ((object as THREE.PerspectiveCamera).isPerspectiveCamera === true ||
        (object as THREE.OrthographicCamera).isOrthographicCamera === true);

const firstFullscreenCamera = (...cameras: unknown[]): THREE.PerspectiveCamera | THREE.OrthographicCamera | undefined =>
    cameras.find(isFullscreenCameraLike);

const attachRuntimeFullscreenToCamera = (fullscreen: UIKitFullscreenLike, force = false): boolean => {
    if (!fullscreen || (!force && isFullscreenCameraLike(fullscreen.parent))) {
        return true;
    }

    const globalApp = (globalThis as {app?: unknown}).app;
    const app = ((global.app as any) ?? globalApp) as any;
    const game = app?.game;
    let camera: THREE.Camera | undefined;

    try {
        if (typeof game?.ensureUICamera === "function") {
            camera = firstFullscreenCamera(game.ensureUICamera());
        }
    } catch (error) {
        if (!fullscreenCameraResolutionWarnings.has(fullscreen)) {
            fullscreenCameraResolutionWarnings.add(fullscreen);
            console.warn("[BehaviorScriptInjector] Failed to resolve game UI camera for UIKit.Fullscreen", error);
        }
    }

    if (!camera) {
        camera = firstFullscreenCamera(game?.uiCamera, game?.camera);
    }

    const editor = app?.editor;
    if (!camera && editor) {
        if (editor.uiCamera) {
            camera = firstFullscreenCamera(editor.uiCamera);
        } else if (typeof editor.ensureUICamera === "function") {
            void editor.ensureUICamera()
                .then((editorCamera: THREE.Camera) => {
                    if (!isFullscreenCameraLike(fullscreen.parent) && isFullscreenCameraLike(editorCamera)) {
                        editorCamera.add(fullscreen as unknown as THREE.Object3D);
                    }
                })
                .catch((error: unknown) => {
                    console.warn("[BehaviorScriptInjector] Failed to resolve editor UI camera for UIKit.Fullscreen", error);
                });
        }
    }

    if (!camera) {
        camera = firstFullscreenCamera(app?.camera);
    }

    if (isFullscreenCameraLike(camera)) {
        camera.add(fullscreen as unknown as THREE.Object3D);
        fullscreenEverCameraAttachedRoots.add(fullscreen);
        return true;
    }

    return false;
};

const isTransientFullscreenCameraError = (error: unknown): boolean => {
    const message =
        error && typeof error === "object" && "message" in error
            ? String((error as {message?: unknown}).message)
            : String(error);
    return message.toLowerCase().includes("fullscreen can only be added to a camera");
};

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
    !!value && typeof value === "object";

const isRuntimeFullscreenRoot = (value: unknown): value is UIKitFullscreenLike => {
    if (!isObjectRecord(value)) {
        return false;
    }

    const candidate = value as UIKitFullscreenLike & Record<string, unknown>;
    const constructorName = typeof candidate.constructor?.name === "string"
        ? candidate.constructor.name.toLowerCase()
        : "";
    return (
        candidate.isObject3D === true &&
        typeof candidate.update === "function" &&
        (
            constructorName.includes("fullscreen") ||
            (
                "renderer" in candidate &&
                "sizeX" in candidate &&
                "sizeY" in candidate &&
                "pixelSize" in candidate
            )
        )
    );
};

const repairRuntimeFullscreenRoots = (
    value: unknown,
    seen = new WeakSet<object>(),
    depth = 0,
    discoveredRoots?: Set<UIKitFullscreenLike>,
): boolean => {
    if (!isObjectRecord(value)) {
        return false;
    }

    const object = value as object;
    if (seen.has(object)) {
        return false;
    }
    seen.add(object);

    if (isRuntimeFullscreenRoot(value)) {
        if (fullscreenDisposedRoots.has(value)) {
            return false;
        }
        discoveredRoots?.add(value);
        patchRuntimeFullscreenInstanceUpdate(value);
        if (isFullscreenCameraLike(value.parent)) {
            fullscreenEverCameraAttachedRoots.add(value);
            return false;
        }
        return attachRuntimeFullscreenToCamera(value, true);
    }

    if (depth >= FULLSCREEN_REPAIR_SCAN_DEPTH || value.isObject3D === true) {
        return false;
    }

    let repaired = false;
    try {
        for (const [key, nested] of Object.entries(value)) {
            if (FULLSCREEN_REPAIR_SKIP_KEYS.has(key)) {
                continue;
            }
            repaired = repairRuntimeFullscreenRoots(nested, seen, depth + 1, discoveredRoots) || repaired;
        }
    } catch {
        // Script-owned values can include proxies or host objects. This scan is
        // best-effort repair before suppressing a transient UIKit parent error.
    }

    return repaired;
};

const getFullscreenKnownRoots = (root: unknown): Set<UIKitFullscreenLike> | null => {
    if (!isObjectRecord(root)) {
        return null;
    }

    let knownRoots = fullscreenKnownRootsByScriptRoot.get(root as object);
    if (!knownRoots) {
        knownRoots = new Set<UIKitFullscreenLike>();
        fullscreenKnownRootsByScriptRoot.set(root as object, knownRoots);
    }
    return knownRoots;
};

const registerKnownRuntimeFullscreenRoot = (root: unknown, fullscreen: UIKitFullscreenLike): void => {
    if (fullscreenDisposedRoots.has(fullscreen)) {
        return;
    }

    patchRuntimeFullscreenInstanceUpdate(fullscreen);
    fullscreenOwnedRoots.add(fullscreen);
    const knownRoots = getFullscreenKnownRoots(root);
    knownRoots?.add(fullscreen);
};

const registerRuntimeFullscreenWithActiveBehaviorFrame = (fullscreen: UIKitFullscreenLike): void => {
    if (activeFullscreenBehaviorFrameEpoch === 0n) {
        return;
    }

    registerKnownRuntimeFullscreenRoot(activeFullscreenBehaviorFrameRootA, fullscreen);
    if (activeFullscreenBehaviorFrameRootB !== undefined) {
        registerKnownRuntimeFullscreenRoot(activeFullscreenBehaviorFrameRootB, fullscreen);
    }
};

const markRuntimeFullscreenUpdatedForActiveBehaviorFrame = (fullscreen: UIKitFullscreenLike): void => {
    if (activeFullscreenBehaviorFrameEpoch === 0n) {
        return;
    }

    fullscreenUpdatedBehaviorFrames.set(fullscreen, activeFullscreenBehaviorFrameEpoch);
};

const withFullscreenBehaviorFrame = <T>(
    delta: number,
    rootA: unknown,
    rootB: unknown,
    callback: (epoch: bigint, delta: number, rootA: unknown, rootB: unknown) => T,
): T => {
    const previousEpoch = activeFullscreenBehaviorFrameEpoch;
    const previousRootA = activeFullscreenBehaviorFrameRootA;
    const previousRootB = activeFullscreenBehaviorFrameRootB;
    const epoch = ++fullscreenBehaviorFrameEpoch;
    activeFullscreenBehaviorFrameEpoch = epoch;
    activeFullscreenBehaviorFrameRootA = rootA;
    activeFullscreenBehaviorFrameRootB = rootB;
    try {
        return callback(epoch, delta, rootA, rootB);
    } finally {
        activeFullscreenBehaviorFrameEpoch = previousEpoch;
        activeFullscreenBehaviorFrameRootA = previousRootA;
        activeFullscreenBehaviorFrameRootB = previousRootB;
    }
};

const clearKnownRuntimeFullscreenRoots = (...roots: unknown[]): void => {
    for (const root of roots) {
        if (isObjectRecord(root)) {
            fullscreenKnownRootsByScriptRoot.delete(root as object);
        }
    }
};

const pruneKnownRuntimeFullscreenRoot = (
    knownRoots: Set<UIKitFullscreenLike>,
    fullscreen: UIKitFullscreenLike,
): boolean => {
    if (
        !fullscreen ||
        fullscreenDisposedRoots.has(fullscreen) ||
        fullscreen.isObject3D !== true ||
        (
            fullscreen.parent == null &&
            fullscreenOwnedRoots.has(fullscreen) &&
            fullscreenEverCameraAttachedRoots.has(fullscreen)
        )
    ) {
        knownRoots.delete(fullscreen);
        return true;
    }

    if (isFullscreenCameraLike(fullscreen.parent)) {
        fullscreenEverCameraAttachedRoots.add(fullscreen);
    }

    return false;
};

const autoUpdateKnownRuntimeFullscreenRoots = (
    root: unknown,
    epoch: bigint,
    delta: number,
): void => {
    if (!isObjectRecord(root)) {
        return;
    }

    const knownRoots = fullscreenKnownRootsByScriptRoot.get(root as object);
    if (!knownRoots || knownRoots.size === 0) {
        return;
    }

    for (const fullscreen of knownRoots) {
        if (pruneKnownRuntimeFullscreenRoot(knownRoots, fullscreen)) {
            continue;
        }
        if (fullscreenUpdatedBehaviorFrames.get(fullscreen) === epoch) {
            continue;
        }

        fullscreen.update(delta);
    }
};

const autoUpdateRuntimeFullscreenFrameRoots = (
    epoch: bigint,
    delta: number,
    rootA: unknown,
    rootB?: unknown,
): void => {
    autoUpdateKnownRuntimeFullscreenRoots(rootA, epoch, delta);
    if (rootB !== undefined) {
        autoUpdateKnownRuntimeFullscreenRoots(rootB, epoch, delta);
    }
};

const repairKnownRuntimeFullscreenRoots = (root: unknown): boolean => {
    const knownRoots = getFullscreenKnownRoots(root);
    if (!knownRoots || knownRoots.size === 0) {
        return false;
    }

    let repaired = false;
    for (const fullscreen of knownRoots) {
        if (pruneKnownRuntimeFullscreenRoot(knownRoots, fullscreen)) {
            continue;
        }
        const neededRepair = !isFullscreenCameraLike(fullscreen.parent);
        const didRepair = neededRepair && attachRuntimeFullscreenToCamera(fullscreen, true);
        repaired = didRepair || repaired;
    }
    return repaired;
};

const shouldPrepareRuntimeFullscreenBeforeHook = (
    value: unknown,
    hookName?: (typeof DIRECT_SCRIPT_HOOKS)[number],
): boolean => {
    if (!isObjectRecord(value)) {
        return false;
    }

    if (!hookName || !FRAME_SCRIPT_HOOKS.has(hookName)) {
        return true;
    }

    const object = value as object;
    if (fullscreenFrameHookPreparedRoots.has(object)) {
        return false;
    }

    fullscreenFrameHookPreparedRoots.add(object);
    return true;
};

const shouldRepairKnownRuntimeFullscreenBeforeHook = (
    value: unknown,
    hookName?: (typeof DIRECT_SCRIPT_HOOKS)[number],
): boolean => {
    if (!hookName || !FRAME_SCRIPT_HOOKS.has(hookName) || !isObjectRecord(value)) {
        return false;
    }

    const knownRoots = fullscreenKnownRootsByScriptRoot.get(value as object);
    return !!knownRoots && knownRoots.size > 0;
};

const handleTransientFullscreenScriptError = (error: unknown, ...roots: unknown[]): boolean => {
    if (!isTransientFullscreenCameraError(error)) {
        return false;
    }

    const seen = new WeakSet<object>();
    let repaired = false;
    for (const root of roots) {
        const discoveredRoots = getFullscreenKnownRoots(root) ?? undefined;
        repaired = repairKnownRuntimeFullscreenRoots(root) || repaired;
        repaired = repairRuntimeFullscreenRoots(root, seen, 0, discoveredRoots) || repaired;
    }
    return repaired;
};

const repairKnownRuntimeFullscreenScriptRoots = (...roots: unknown[]): void => {
    for (const root of roots) {
        repairKnownRuntimeFullscreenRoots(root);
    }
};

const prepareRuntimeFullscreenScriptRoots = (...roots: unknown[]): void => {
    const seen = new WeakSet<object>();
    for (const root of roots) {
        const discoveredRoots = getFullscreenKnownRoots(root) ?? undefined;
        repairKnownRuntimeFullscreenRoots(root);
        repairRuntimeFullscreenRoots(root, seen, 0, discoveredRoots);
    }
};

const getPrototypeLifecycleHook = (hookName: DirectScriptHookName): unknown =>
    BehaviorBase.prototype[hookName as keyof BehaviorBase];

const getDirectScriptHookStorage = (behavior: BehaviorBase): DirectScriptHookStorage => {
    const record = behavior as unknown as Record<string | symbol, unknown>;
    let storage = record[directScriptHookValuesSymbol] as DirectScriptHookStorage | undefined;
    if (!storage) {
        storage = Object.create(null) as DirectScriptHookStorage;
        Object.defineProperty(record, directScriptHookValuesSymbol, {
            value: storage,
            configurable: false,
            enumerable: false,
        });
    }
    return storage;
};

const peekDirectScriptHookStorage = (behavior: BehaviorBase): DirectScriptHookStorage | null =>
    ((behavior as unknown as Record<symbol, unknown>)[directScriptHookValuesSymbol] as DirectScriptHookStorage | undefined) ?? null;

const wrapDirectScriptHookFunction = (
    hookName: DirectScriptHookName,
    hook: (...hookArgs: unknown[]) => unknown,
): (...hookArgs: unknown[]) => unknown => {
    if ((hook as unknown as Record<symbol, unknown>)[directScriptHookWrappedSymbol]) {
        return hook;
    }

    const wrapped = function directScriptHookWrapper(this: BehaviorBase, ...args: unknown[]) {
        try {
            if (hookName === "onStart") {
                prepareDeclarativeEditorPreviewRootIfRequested(this as unknown as Record<string | symbol, unknown>, this);
            }
            const runHook = (epoch?: bigint, delta?: number, rootA?: unknown) => {
                if (shouldPrepareRuntimeFullscreenBeforeHook(this, hookName)) {
                    prepareRuntimeFullscreenScriptRoots(this);
                } else if (shouldRepairKnownRuntimeFullscreenBeforeHook(this, hookName)) {
                    repairKnownRuntimeFullscreenScriptRoots(this);
                }
                const result = hook.apply(this, args);
                if (epoch !== undefined) {
                    autoUpdateRuntimeFullscreenFrameRoots(epoch, delta ?? 0, rootA);
                }
                return result;
            };
            const result = withFullscreenBehaviorFrame(Number(args[0] ?? 0), this, undefined, (epoch, delta, rootA) => {
                const hookResult = runHook(
                    FRAME_SCRIPT_HOOKS.has(hookName) ? epoch : undefined,
                    delta,
                    rootA,
                );
                if (!FRAME_SCRIPT_HOOKS.has(hookName)) {
                    prepareRuntimeFullscreenScriptRoots(this);
                }
                return hookResult;
            });
            if (isPromiseLike(result)) {
                void Promise.resolve(result).catch(error => {
                    if (!handleTransientFullscreenScriptError(error, this)) {
                        throw error;
                    }
                });
            }
            if (hookName === "dispose") {
                clearKnownRuntimeFullscreenRoots(this);
                const resourceScope = (this as unknown as Record<symbol, {dispose?: () => void}>)[scriptResourceScopeSymbol];
                resourceScope?.dispose?.();
            }
            return result;
        } catch (error) {
            if (hookName === "dispose") {
                const resourceScope = (this as unknown as Record<symbol, {dispose?: () => void}>)[scriptResourceScopeSymbol];
                resourceScope?.dispose?.();
            }
            if (handleTransientFullscreenScriptError(error, this)) {
                return undefined;
            }
            throw error;
        }
    };

    Object.defineProperty(wrapped, directScriptHookWrappedSymbol, {
        value: true,
        configurable: false,
    });
    return wrapped;
};

const installDirectScriptHookAccessors = (behavior: BehaviorBase): void => {
    const record = behavior as unknown as Record<string | symbol, unknown>;
    const storage = getDirectScriptHookStorage(behavior);

    for (const hookName of DIRECT_SCRIPT_HOOKS) {
        const descriptor = Object.getOwnPropertyDescriptor(record, hookName);
        if (descriptor && !descriptor.configurable) {
            continue;
        }

        const currentValue = descriptor && "value" in descriptor ? descriptor.value : undefined;
        Object.defineProperty(record, hookName, {
            configurable: true,
            enumerable: descriptor?.enumerable ?? false,
            get(this: BehaviorBase) {
                const value = getDirectScriptHookStorage(this)[hookName];
                return value === undefined ? getPrototypeLifecycleHook(hookName) : value;
            },
            set(this: BehaviorBase, value: unknown) {
                getDirectScriptHookStorage(this)[hookName] = typeof value === "function"
                    ? wrapDirectScriptHookFunction(hookName, value as (...hookArgs: unknown[]) => unknown)
                    : value;
            },
        });

        if (typeof currentValue === "function" && currentValue !== getPrototypeLifecycleHook(hookName)) {
            storage[hookName] = wrapDirectScriptHookFunction(hookName, currentValue as (...hookArgs: unknown[]) => unknown);
        }
    }
};

const hasAssignedDirectScriptHook = (
    behavior: BehaviorBase,
    hookName: BehaviorLifecycleHookName,
): boolean => {
    if (!DIRECT_SCRIPT_HOOK_SET.has(hookName as DirectScriptHookName)) {
        return false;
    }

    const directHookName = hookName as DirectScriptHookName;
    const storage = peekDirectScriptHookStorage(behavior);
    if (typeof storage?.[directHookName] === "function") {
        return true;
    }

    const descriptor = Object.getOwnPropertyDescriptor(behavior as unknown as Record<string, unknown>, directHookName);
    return !!(
        descriptor &&
        "value" in descriptor &&
        typeof descriptor.value === "function" &&
        descriptor.value !== getPrototypeLifecycleHook(directHookName)
    );
};

const wrapDirectScriptHook = (behavior: BehaviorBase, hookName: DirectScriptHookName): void => {
    const record = behavior as unknown as Record<string | symbol, unknown>;
    if (!Object.prototype.hasOwnProperty.call(record, hookName)) {
        return;
    }

    const storage = peekDirectScriptHookStorage(behavior);
    if (storage && Object.prototype.hasOwnProperty.call(storage, hookName)) {
        const storedHook = storage[hookName];
        if (typeof storedHook === "function") {
            storage[hookName] = wrapDirectScriptHookFunction(
                hookName,
                storedHook as (...hookArgs: unknown[]) => unknown,
            );
        }
        return;
    }

    const descriptor = Object.getOwnPropertyDescriptor(record, hookName);
    if (!descriptor || !("value" in descriptor) || typeof descriptor.value !== "function") {
        return;
    }
    record[hookName] = wrapDirectScriptHookFunction(
        hookName,
        descriptor.value as (...hookArgs: unknown[]) => unknown,
    );
};

const wrapDirectScriptHooks = (behavior: BehaviorBase): void => {
    for (const hookName of DIRECT_SCRIPT_HOOKS) {
        wrapDirectScriptHook(behavior, hookName);
    }
};

const isObject3DLike = (value: unknown): value is THREE.Object3D =>
    !!value && typeof value === "object" && (value as THREE.Object3D).isObject3D === true;

const recordEditorPreviewVisualAdoption = (
    behavior: BehaviorBase,
    root: THREE.Object3D,
    mode = "visual",
): void => {
    const globalRecord = globalThis as {
        __stemEditorPreviewAdoptions?: Array<Record<string, unknown>>;
    };
    const adoptions = globalRecord.__stemEditorPreviewAdoptions ?? [];
    adoptions.push({
        behaviorId: behavior.id,
        behaviorUuid: behavior.uuid,
        rootName: root.name || root.uuid,
        objectCount: root.children.length,
        mode,
        at: Math.round(performance.now()),
    });
    globalRecord.__stemEditorPreviewAdoptions = adoptions.slice(-200);
};

const isOwnedAdoptedPreviewRoot = (root: THREE.Object3D | null | undefined, behavior: BehaviorBase): root is THREE.Object3D =>
    root?.userData?.isRuntimeOnly === true &&
    root.userData?.[EDITOR_PREVIEW_ROOT_KEY] === true &&
    root?.userData?.[EDITOR_PREVIEW_ADOPTED_KEY] === true &&
    root.userData?.[EDITOR_PREVIEW_BEHAVIOR_UUID_KEY] === behavior.uuid;

const hasSupportedEditorPreviewAdoptionContract = (scriptRecord: Record<string | symbol, unknown>): boolean =>
    typeof scriptRecord._buildVisuals === "function" ||
    scriptRecord[EXPLICIT_EDITOR_PREVIEW_ADOPTION_HOOK] === true;

const isExplicitlyAdoptablePreviewRoot = (
    root: THREE.Object3D | null | undefined,
    behavior: BehaviorBase,
): root is THREE.Object3D =>
    root?.userData?.isRuntimeOnly === true &&
    root.userData?.[EDITOR_PREVIEW_ROOT_KEY] === true &&
    root.userData?.[EDITOR_PREVIEW_BEHAVIOR_UUID_KEY] === behavior.uuid;

const adoptEditorPreviewVisualRoot = (
    scriptRecord: Record<string | symbol, unknown>,
    behavior: BehaviorBase,
    args: unknown[],
): THREE.Object3D | null => {
    const parentArg = args.find(isObject3DLike);
    const parent = parentArg ?? behavior.target;
    if (!parent) {
        return null;
    }

    const previewRoot = findEditorPreviewRootForBehavior(parent, behavior);
    if (!previewRoot) {
        return null;
    }

    previewRoot.visible = true;
    previewRoot.userData[EDITOR_PREVIEW_ADOPTED_KEY] = true;
    scriptRecord._root = previewRoot;

    const emitters = collectParticleEmitterObjects(previewRoot);
    if (emitters.length > 0) {
        const currentEmitters = scriptRecord._particleEmitters;
        if (!Array.isArray(currentEmitters) || currentEmitters.length === 0) {
            scriptRecord._particleEmitters = emitters;
        }
    }

    recordEditorPreviewVisualAdoption(behavior, previewRoot);
    return previewRoot;
};

const clearDeclarativeEditorPreviewAdoption = (scriptRecord: Record<string | symbol, unknown>): void => {
    scriptRecord[ADOPTED_EDITOR_PREVIEW_ROOT_KEY] = null;
    scriptRecord[ADOPTED_EDITOR_PREVIEW_CONTEXT_KEY] = null;
};

const prepareDeclarativeEditorPreviewRootIfRequested = (
    scriptRecord: Record<string | symbol, unknown>,
    behavior: BehaviorBase,
): void => {
    if (scriptRecord[EXPLICIT_EDITOR_PREVIEW_ADOPTION_HOOK] !== true) {
        clearDeclarativeEditorPreviewAdoption(scriptRecord);
        return;
    }

    const parentCandidate = scriptRecord._editorPreviewParent;
    const parent = isObject3DLike(parentCandidate) ? parentCandidate : behavior.target;
    const previewRoot = parent ? findEditorPreviewRootForBehavior(parent, behavior) : null;
    if (!isExplicitlyAdoptablePreviewRoot(previewRoot, behavior)) {
        clearDeclarativeEditorPreviewAdoption(scriptRecord);
        return;
    }

    previewRoot.visible = true;
    previewRoot.userData[EDITOR_PREVIEW_ADOPTED_KEY] = true;
    scriptRecord[ADOPTED_EDITOR_PREVIEW_ROOT_KEY] = previewRoot;
    scriptRecord[ADOPTED_EDITOR_PREVIEW_CONTEXT_KEY] = {
        behaviorId: behavior.id,
        behaviorUuid: behavior.uuid,
        parent,
    };
    recordEditorPreviewVisualAdoption(behavior, previewRoot, "declarative");
};

const deregisterAdoptedPreviewParticles = (scriptRecord: Record<string | symbol, unknown>): void => {
    const batchedRenderer = scriptRecord._batchedRenderer as {deleteSystem?: (system: unknown) => void} | undefined;
    const emitters = scriptRecord._particleEmitters;
    if (!batchedRenderer || !Array.isArray(emitters)) {
        return;
    }

    for (const emitter of emitters) {
        const system = (emitter as {system?: unknown} | undefined)?.system;
        if (!system) {
            continue;
        }
        try {
            batchedRenderer.deleteSystem?.(system);
        } catch {
            // Best-effort teardown for preview-owned particle roots.
        }
    }
};

const markGeneratedRuntimeVisualRoot = (value: unknown): THREE.Object3D | null => {
    if (!isObject3DLike(value)) {
        return null;
    }

    value.userData.isRuntimeOnly = true;
    return value;
};

const markGeneratedRuntimeVisualRoots = (
    scriptRecord: Record<string | symbol, unknown>,
    result: unknown,
): void => {
    if (isPromiseLike(result)) {
        void Promise.resolve(result)
            .then(resolved => {
                markGeneratedRuntimeVisualRoots(scriptRecord, resolved);
            })
            .catch(() => {});
        return;
    }

    markGeneratedRuntimeVisualRoot(result);
    markGeneratedRuntimeVisualRoot(scriptRecord._root);
};

const wrapGeneratedVisualLifecycle = (
    scriptRecord: Record<string | symbol, unknown>,
    behavior: BehaviorBase,
): void => {
    const buildVisuals = scriptRecord._buildVisuals;
    if (
        typeof buildVisuals === "function" &&
        !((buildVisuals as unknown as Record<symbol, unknown>)[visualBuilderWrappedSymbol])
    ) {
        const wrappedBuildVisuals = function generatedVisualBuilderWrapper(this: Record<string | symbol, unknown>, ...args: unknown[]) {
            if (!this[visualBuilderAdoptionAttemptedSymbol]) {
                this[visualBuilderAdoptionAttemptedSymbol] = true;
                const adoptedRoot = adoptEditorPreviewVisualRoot(this, behavior, args);
                if (adoptedRoot) {
                    return adoptedRoot;
                }
            }

            const result = (buildVisuals as (...buildArgs: unknown[]) => unknown).apply(this, args);
            markGeneratedRuntimeVisualRoots(this, result);
            return result;
        };

        Object.defineProperty(wrappedBuildVisuals, visualBuilderWrappedSymbol, {
            value: true,
            configurable: false,
        });
        scriptRecord._buildVisuals = wrappedBuildVisuals;
    }

    const teardownVisuals = scriptRecord._teardownVisuals;
    if (
        typeof teardownVisuals === "function" &&
        !((teardownVisuals as unknown as Record<symbol, unknown>)[visualTeardownWrappedSymbol])
    ) {
        const wrappedTeardownVisuals = function generatedVisualTeardownWrapper(this: Record<string | symbol, unknown>, ...args: unknown[]) {
            const root = this._root as THREE.Object3D | undefined;
            if (
                hasSupportedEditorPreviewAdoptionContract(this) &&
                isOwnedAdoptedPreviewRoot(root, behavior)
            ) {
                deregisterAdoptedPreviewParticles(this);
                root.userData[EDITOR_PREVIEW_ADOPTED_KEY] = false;
                this._root = null;
                this._particleEmitters = null;
                return undefined;
            }

            return (teardownVisuals as (...teardownArgs: unknown[]) => unknown).apply(this, args);
        };

        Object.defineProperty(wrappedTeardownVisuals, visualTeardownWrappedSymbol, {
            value: true,
            configurable: false,
        });
        scriptRecord._teardownVisuals = wrappedTeardownVisuals;
    }

    const disposeOwnedRoot = scriptRecord._disposeOwnedRoot;
    if (
        typeof disposeOwnedRoot === "function" &&
        !((disposeOwnedRoot as unknown as Record<symbol, unknown>)[ownedRootDisposeWrappedSymbol])
    ) {
        const wrappedDisposeOwnedRoot = function generatedOwnedRootDisposeWrapper(
            this: Record<string | symbol, unknown>,
            root: unknown,
            removePhysics?: unknown,
            ...rest: unknown[]
        ) {
            if (
                removePhysics !== true &&
                hasSupportedEditorPreviewAdoptionContract(this) &&
                isOwnedAdoptedPreviewRoot(root as THREE.Object3D | null | undefined, behavior)
            ) {
                return undefined;
            }

            return (disposeOwnedRoot as (...disposeArgs: unknown[]) => unknown).apply(this, [root, removePhysics, ...rest]);
        };

        Object.defineProperty(wrappedDisposeOwnedRoot, ownedRootDisposeWrappedSymbol, {
            value: true,
            configurable: false,
        });
        scriptRecord._disposeOwnedRoot = wrappedDisposeOwnedRoot;
    }

};

const normalizeFullscreenUpdateArgs = (args: any[]): any[] => {
    // Legacy generated scripts passed renderer width/height to old UIKit
    // fullscreen roots. Current UIKit expects a delta; keep those scripts
    // compatible without feeding layout a huge "delta" value every frame.
    if (
        args.length >= 2 &&
        typeof args[0] === "number" &&
        typeof args[1] === "number" &&
        (args[0] > 1 || args[1] > 1)
    ) {
        return [1 / 60];
    }
    return args;
};

const shouldSkipDetachedOwnedRuntimeFullscreenUpdate = (fullscreen: UIKitFullscreenLike): boolean =>
    fullscreen.parent == null &&
    fullscreenOwnedRoots.has(fullscreen) &&
    fullscreenEverCameraAttachedRoots.has(fullscreen);

const retryRuntimeFullscreenUpdateAfterCameraRepair = (
    fullscreen: UIKitFullscreenLike,
    update: () => void,
): boolean => {
    const parentBeforeRepair = fullscreen.parent;
    const repaired = attachRuntimeFullscreenToCamera(fullscreen, true);
    const parentAfterRepair = fullscreen.parent;
    if (
        !repaired ||
        !isFullscreenCameraLike(parentAfterRepair) ||
        parentAfterRepair === parentBeforeRepair
    ) {
        return false;
    }

    update();
    return true;
};

const isFullscreenRootFullPercent = (value: unknown): boolean => {
    if (typeof value !== "string") {
        return false;
    }

    const trimmed = value.trim();
    if (!trimmed.endsWith("%")) {
        return false;
    }

    const numericValue = trimmed.slice(0, -1).trim();
    if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(numericValue)) {
        return false;
    }

    return Number(numericValue) === 100;
};

const normalizeRuntimeFullscreenConstructorArgs = (args: any[]): any[] => {
    const properties = args[1];
    if (properties == null || typeof properties !== "object") {
        return args;
    }

    const shouldRemoveWidth =
        Object.prototype.hasOwnProperty.call(properties, "width") &&
        isFullscreenRootFullPercent((properties as {width?: unknown}).width);
    const shouldRemoveHeight =
        Object.prototype.hasOwnProperty.call(properties, "height") &&
        isFullscreenRootFullPercent((properties as {height?: unknown}).height);

    if (!shouldRemoveWidth && !shouldRemoveHeight) {
        return args;
    }

    const normalizedProperties = {...properties};
    if (shouldRemoveWidth) {
        delete normalizedProperties.width;
    }
    if (shouldRemoveHeight) {
        delete normalizedProperties.height;
    }

    const normalizedArgs = [...args];
    normalizedArgs[1] = normalizedProperties;
    return normalizedArgs;
};

function patchRuntimeFullscreenInstanceUpdate(fullscreen: UIKitFullscreenLike): void {
    const record = fullscreen as UIKitFullscreenLike & Record<symbol, unknown>;
    if (record[fullscreenInstanceUpdatePatchedSymbol]) {
        patchRuntimeFullscreenInstanceDispose(fullscreen);
        return;
    }

    const originalUpdate = fullscreen.update;
    Object.defineProperty(record, fullscreenInstanceUpdatePatchedSymbol, {
        value: true,
        configurable: false,
    });

    record.update = function patchedFullscreenInstanceUpdate(this: UIKitFullscreenLike, ...args: any[]): void {
        markRuntimeFullscreenUpdatedForActiveBehaviorFrame(this);
        const updateArgs = normalizeFullscreenUpdateArgs(args);
        if (shouldSkipDetachedOwnedRuntimeFullscreenUpdate(this)) {
            return;
        }
        const needsCameraRepair = !isFullscreenCameraLike(this.parent);
        if (!attachRuntimeFullscreenToCamera(this, needsCameraRepair) || !isFullscreenCameraLike(this.parent)) {
            return;
        }

        try {
            originalUpdate.apply(this, updateArgs);
        } catch (error) {
            if (
                isTransientFullscreenCameraError(error) &&
                retryRuntimeFullscreenUpdateAfterCameraRepair(this, () => originalUpdate.apply(this, updateArgs))
            ) {
                return;
            }

            throw error;
        }
    };

    patchRuntimeFullscreenInstanceDispose(fullscreen);
}

function patchRuntimeFullscreenInstanceDispose(fullscreen: UIKitFullscreenLike): void {
    const record = fullscreen as UIKitFullscreenLike & Record<symbol, unknown> & {
        dispose?: (...args: any[]) => unknown;
    };
    if (record[fullscreenInstanceDisposePatchedSymbol] || typeof record.dispose !== "function") {
        return;
    }

    const originalDispose = record.dispose;
    Object.defineProperty(record, fullscreenInstanceDisposePatchedSymbol, {
        value: true,
        configurable: false,
    });

    record.dispose = function patchedFullscreenInstanceDispose(this: UIKitFullscreenLike, ...args: any[]) {
        fullscreenDisposedRoots.add(this);
        return originalDispose.apply(this, args);
    };
}

class RuntimeFullscreen extends RuntimeFullscreenBase {
    constructor(...args: any[]) {
        super(...normalizeRuntimeFullscreenConstructorArgs(args));
        patchRuntimeFullscreenInstanceDispose(this);
        registerRuntimeFullscreenWithActiveBehaviorFrame(this);
        attachRuntimeFullscreenToCamera(this);
    }

    update(...args: any[]): void {
        markRuntimeFullscreenUpdatedForActiveBehaviorFrame(this);
        const updateArgs = normalizeFullscreenUpdateArgs(args);
        if (shouldSkipDetachedOwnedRuntimeFullscreenUpdate(this)) {
            return;
        }
        const needsCameraRepair = !isFullscreenCameraLike(this.parent);
        if (!attachRuntimeFullscreenToCamera(this, needsCameraRepair) || !isFullscreenCameraLike(this.parent)) {
            return;
        }
        try {
            super.update(...updateArgs);
        } catch (error) {
            if (
                isTransientFullscreenCameraError(error) &&
                retryRuntimeFullscreenUpdateAfterCameraRepair(this, () => super.update(...updateArgs))
            ) {
                return;
            }
            throw error;
        }
    }
}

const RuntimeUIKit = {
    ...UIKit,
    Fullscreen: RuntimeFullscreen as unknown as typeof UIKit.Fullscreen,
};

class BehaviorScriptInjector {
    constructor() {}
    parse(
        scriptName: string,
        scriptString: string,
        displayName?: string,
        options?: {
            context?: ReadonlyAssetResolutionContext;
            importRevisionMap?: ScriptImportRevisionMap;
        },
    ): BehaviorConstructor {
        // Check if production mode is enabled and filter debugger statements
        const productionMode = global.app?.editor?.scene?.userData?.productionMode;
        const compartmentsEnabled = isCompartmentsEnabled();
        if (shouldFilterDebuggers({productionMode})) {
            scriptString = removeDebuggerStatements(scriptString);
        }

        // Inject debugger statements at breakpoint lines
        const breakpoints = breakpointManager.get(`${scriptName}-code`);
        if (breakpoints.size > 0) {
            scriptString = injectDebuggerStatements(scriptString, breakpoints);
        }

        const parsedScript = parseScriptImportsCached(scriptString);
        if (parsedScript.errors.length > 0) {
            throw new Error(parsedScript.errors[0]!.message);
        }

        const cacheKey = getScriptClassCacheKey(
            scriptName,
            scriptString,
            compartmentsEnabled,
            productionMode,
            breakpoints,
            {
                context:
                    !options?.importRevisionMap && parsedScript.directives.length > 0
                        ? options?.context
                        : undefined,
                importRevisionMap: options?.importRevisionMap,
            },
        );
        const cached = getCachedScriptClass(cacheKey);
        if (cached) {
            return cached;
        }

        const buildImportAliases = (runtimeEndowments: Record<string, unknown>) =>
            buildScriptImportAliases({
                source: scriptString,
                context: options?.context,
                importRevisionMap: options?.importRevisionMap,
                runtimeEndowments,
                useCompartment: compartmentsEnabled,
            });

        let BehaviorClass: BehaviorConstructor;

        if (!compartmentsEnabled) {
            const baseEndowments = {
                THREE: RuntimeTHREE,
                TSL,
                CSS3DObject,
                CSS3DSprite,
                UIKit: RuntimeUIKit,
                Fullscreen: RuntimeFullscreen,
                UIKitPointerEvents,
                CesiumTool,
                EventBus,
                // three.quarks — see compartment-mode comment below for usage
                Quarks,
                ParticleEmitter: Quarks.ParticleEmitter,
                ParticleSystem: Quarks.ParticleSystem,
                BatchedRenderer: Quarks.BatchedRenderer,
                QuarksUtil: Quarks.QuarksUtil,
                SphereEmitter: Quarks.SphereEmitter,
                ConeEmitter: Quarks.ConeEmitter,
                DonutEmitter: Quarks.DonutEmitter,
                // Host APIs are supplied per behavior instance below through
                // ScriptResourceScope so forgotten timers/listeners cannot
                // retain a stopped Play session.
                window: undefined,
                document: undefined,
                performance: undefined,
                requestAnimationFrame: undefined,
                cancelAnimationFrame: undefined,
                setTimeout: undefined,
                clearTimeout: undefined,
                setInterval: undefined,
                clearInterval: undefined,
                Audio: undefined,
                AudioContext: undefined,
            };
            const importAliasNames = parsedScript.directives.map(directive => directive.alias);
            const argNames = [...Object.keys(baseEndowments), ...importAliasNames];
            let compiledScript: Function | null = null;
            let compileError: unknown = null;

            try {
                // eslint-disable-next-line @typescript-eslint/no-implied-eval -- intentional: behavior scripts run via Function with endowments as named args
                compiledScript = new Function(
                    ...argNames,
                    `
                    with (this) {
                        ${parsedScript.code}
                    }
                    //# sourceURL=behavior://${scriptName}
                    `,
                );
            } catch (error) {
                compileError = error;
            }

            BehaviorClass = class ScriptBehavior extends BehaviorBase {
                private readonly resourceScope = new ScriptResourceScope({label: `behavior:direct:${scriptName}`});

                constructor(target: THREE.Object3D, id: string, options: BehaviorOptions) {
                    super(target, id, options);
                    installDirectScriptHookAccessors(this);
                    // The accessor intentionally falls back to BehaviorBase's
                    // no-op lifecycle hooks. Seed dispose through the same
                    // wrapper even when user code does not declare a dispose
                    // function, so the per-instance browser resource scope is
                    // always revoked when the behavior is torn down.
                    this.dispose = this.dispose;
                    Object.defineProperty(this, scriptResourceScopeSymbol, {
                        value: this.resourceScope,
                        configurable: false,
                        enumerable: false,
                    });

                    try {
                        if (compileError) {
                            throw compileError;
                        }

                        const runtimeEndowments = {
                            ...baseEndowments,
                            window: this.resourceScope.getWindow(),
                            document: this.resourceScope.getDocument(),
                            performance,
                            requestAnimationFrame: this.resourceScope.requestAnimationFrame.bind(this.resourceScope),
                            cancelAnimationFrame: this.resourceScope.cancelAnimationFrame.bind(this.resourceScope),
                            setTimeout: this.resourceScope.setTimeout.bind(this.resourceScope),
                            clearTimeout: this.resourceScope.clearTimeout.bind(this.resourceScope),
                            setInterval: this.resourceScope.setInterval.bind(this.resourceScope),
                            clearInterval: this.resourceScope.clearInterval.bind(this.resourceScope),
                            Audio: this.resourceScope.getAudioConstructor(),
                            AudioContext: this.resourceScope.getAudioContextConstructor(),
                        };
                        const importAliases = buildImportAliases(runtimeEndowments);
                        const argValues = [
                            ...Object.values(runtimeEndowments),
                            ...importAliasNames.map(alias => importAliases[alias]),
                        ];
                        withFullscreenBehaviorFrame(0, this, undefined, () => {
                            compiledScript!.call(this, ...argValues);
                        });
                        prepareRuntimeFullscreenScriptRoots(this);
                        wrapGeneratedVisualLifecycle(this as unknown as Record<string | symbol, unknown>, this);
                        wrapDirectScriptHooks(this);
                    } catch (error) {
                        if (!handleTransientFullscreenScriptError(error, this)) {
                            console.error(`Initialisation error in ${scriptName}/${displayName}:`, error);
                        }
                    }
                }

                [BEHAVIOR_LIFECYCLE_HOOK_QUERY](hookName: BehaviorLifecycleHookName): boolean {
                    return hasAssignedDirectScriptHook(this, hookName);
                }

                // Editor preview plugins are owned by BehaviorPluginManager,
                // which tears them down through onEditorDispose rather than
                // the runtime dispose hook. Revoke browser resources here so
                // a Play -> Edit transition cannot retain the preview scope.
                onEditorDispose(): void {
                    this.resourceScope.dispose();
                }
            };
            setCachedScriptClass(cacheKey, BehaviorClass);
            return BehaviorClass;
        }

        BehaviorClass = class ScriptBehavior extends BehaviorBase {
            private compartment: Compartment | null = null;
            private script: Partial<Behavior> = {};
            private scriptFactory: (() => Partial<Behavior>) | null = null;
            private readonly resourceScope = new ScriptResourceScope({label: `behavior:compartment:${scriptName}`});

            private logScriptError(hook: string, error: unknown): void {
                if (handleTransientFullscreenScriptError(error, this.script, this)) {
                    return;
                }
                console.error(`Error in "${scriptName}/${displayName}" script ${hook}:`, error);
            }

            private prepareScriptHook(hookName?: (typeof DIRECT_SCRIPT_HOOKS)[number]): void {
                if (hookName === "onStart") {
                    prepareDeclarativeEditorPreviewRootIfRequested(this.script as Record<string | symbol, unknown>, this);
                }
                const shouldPrepareScript = shouldPrepareRuntimeFullscreenBeforeHook(this.script, hookName);
                const shouldPrepareBehavior = shouldPrepareRuntimeFullscreenBeforeHook(this, hookName);
                if (shouldPrepareScript || shouldPrepareBehavior) {
                    prepareRuntimeFullscreenScriptRoots(this.script, this);
                    return;
                }

                const shouldRepairKnownScript = shouldRepairKnownRuntimeFullscreenBeforeHook(this.script, hookName);
                const shouldRepairKnownBehavior = shouldRepairKnownRuntimeFullscreenBeforeHook(this, hookName);
                if (shouldRepairKnownScript || shouldRepairKnownBehavior) {
                    repairKnownRuntimeFullscreenScriptRoots(this.script, this);
                }
            }

            [BEHAVIOR_LIFECYCLE_HOOK_QUERY](hookName: BehaviorLifecycleHookName): boolean {
                return typeof this.script[hookName as keyof Behavior] === "function";
            }

            // The editor owns preview instances separately from runtime
            // behaviors, so their onEditorDispose path must release the same
            // scoped browser resources as runtime dispose.
            onEditorDispose(): void {
                this.resourceScope.dispose();
            }

            constructor(target: THREE.Object3D, id: string, options: BehaviorOptions) {
                super(target, id, options);
                Object.defineProperty(this, scriptResourceScopeSymbol, {
                    value: this.resourceScope,
                    configurable: false,
                    enumerable: false,
                });
            }

            private initializeCompartment() {
                if (this.compartment) {
                    return;
                }

                try {
                    const baseEndowments = {
                        //TODO - remove access to full threejs
                        THREE: RuntimeTHREE,
                        TSL,
                        EventBus, // @deprecated — use onEvent() and game.behaviorManager.sendEventToObjectBehaviors() instead
                        CSS3DObject,
                        CSS3DSprite,
                        UIKit: RuntimeUIKit,
                        Fullscreen: RuntimeFullscreen,
                        UIKitPointerEvents,
                        CesiumTool,
                        // three.quarks particle system — exposed so behaviors can construct
                        // ParticleEmitter / ParticleSystem and emitter shape classes
                        // (SphereEmitter, ConeEmitter, DonutEmitter, etc.) at runtime.
                        // Attach the resulting ParticleEmitter to the scene/gameObject and
                        // register its `system` with the engine's shared BatchedRenderer
                        // (located via `game.scene.getObjectByProperty("type", "BatchedRenderer")`
                        // — the engine names it `"BatchedRenderer"` in EngineRuntime.ts).
                        // The renderer ticks every frame; un-register on dispose with
                        // `batchedRenderer.deleteSystem(emitter.system)`. See
                        // docs/domains/three-quarks-api-reference.md and existing behavior
                        // MP-Garden-Party-v1.31.01.002-4/behaviors/EffectPool-2.yaml for the
                        // canonical add/delete pattern.
                        Quarks,
                        ParticleEmitter: Quarks.ParticleEmitter,
                        ParticleSystem: Quarks.ParticleSystem,
                        BatchedRenderer: Quarks.BatchedRenderer,
                        QuarksUtil: Quarks.QuarksUtil,
                        SphereEmitter: Quarks.SphereEmitter,
                        ConeEmitter: Quarks.ConeEmitter,
                        DonutEmitter: Quarks.DonutEmitter,
                        console: {
                            log: (...args: any[]) => console.log(...args),
                            error: (...args: any[]) => console.error(...args),
                            warn: (...args: any[]) => console.warn(...args),
                            info: (...args: any[]) => console.info(...args),
                            debug: (...args: any[]) => console.debug(...args),
                        },
                        document: this.resourceScope.getDocument(),
                        window: this.resourceScope.getWindow(), // host window — exposed for legacy DOM access (addEventListener, innerWidth, etc.). Prefer `this.erth.*`, `game.renderer.domElement`, or `document`.
                        performance, // host performance — Date.now() is already available via Compartment base globals
                        requestAnimationFrame: this.resourceScope.requestAnimationFrame.bind(this.resourceScope),
                        cancelAnimationFrame: this.resourceScope.cancelAnimationFrame.bind(this.resourceScope),
                        setTimeout: this.resourceScope.setTimeout.bind(this.resourceScope),
                        clearTimeout: this.resourceScope.clearTimeout.bind(this.resourceScope),
                        setInterval: this.resourceScope.setInterval.bind(this.resourceScope),
                        clearInterval: this.resourceScope.clearInterval.bind(this.resourceScope),
                        // DOM audio constructors — commonly needed for one-shot sound playback
                        Audio: this.resourceScope.getAudioConstructor(),
                        AudioContext: this.resourceScope.getAudioContextConstructor(),
                        Image: window.Image,
                        // Fetch & URL — commonly needed for proxy calls and asset URL handling
                        fetch: window.fetch.bind(window),
                        URL: window.URL,
                        URLSearchParams: window.URLSearchParams,
                        eval: undefined,
                        harden: undefined,
                        lockdown: undefined,
                    };

                    const importAliases = buildImportAliases(baseEndowments);
                    const endowments = {
                        ...baseEndowments,
                        ...importAliases,
                    };

                    this.compartment = new Compartment(endowments);

                    // Apply debugger filtering for compartment mode as well
                    const productionMode = global.app?.editor?.scene?.userData?.productionMode;
                    const filteredScriptString = shouldFilterDebuggers({productionMode})
                        ? removeDebuggerStatements(parsedScript.code)
                        : parsedScript.code;

                    const wrapperCode = `
                    (function() {
                        return function() {
                            const behavior = {
                                target: undefined,
                                erth: undefined,
                                gameObject: undefined,
                                attributes: this.attributes,
                                id: undefined,
                                uuid: undefined,
                                type: this.type,
                                isPaused: this.isPaused,
                                throttleConfig: undefined,
                                getAttribute: undefined,
                                requestAttributeChange: undefined,
                                findBehavior: undefined,
                                findBehaviors: undefined,
                                init: undefined,
                                dispose: undefined,
                                update: undefined,
                                fixedUpdate: undefined,
                                onStart: undefined,
                                onStop: undefined,
                                onPaused: undefined,
                                onResumed: undefined,
                                onReset: undefined,
                                onEvent: undefined,
                                onAttributesUpdated: undefined,
                                onWorkerMessage: undefined,
                                getWorkerInitData: undefined,
                                onStateUpdated: undefined,
                                onAttributeChangeRequested: undefined,
                                onAttributeChanged: undefined,
                                yield: undefined,
                            };

                            (function() {
                                ${filteredScriptString}
                            }).call(behavior);

                            return behavior;
                        };
                    })()
                    //# sourceURL=behavior://${scriptName}
                    `;

                    this.scriptFactory = this.compartment.evaluate(wrapperCode);
                    if (this.scriptFactory) {
                        withFullscreenBehaviorFrame(0, this, undefined, () => {
                            this.script = this.scriptFactory!();
                        });
                        prepareRuntimeFullscreenScriptRoots(this.script, this);
                    }
                } catch (error) {
                    if (!handleTransientFullscreenScriptError(error, this.script, this)) {
                        console.error(`Initialisation error in ${scriptName}/${displayName}:`, error);
                    }
                    this.compartment = null;
                    this.script = {};
                }
            }

            init(game: GameManager): void | Promise<void> {
                try {
                    this.initializeCompartment();
                    this.updateScript();
                    wrapGeneratedVisualLifecycle(this.script as Record<string | symbol, unknown>, this);
                    this.prepareScriptHook("init");
                    if (this.script.init) {
                        const result = withFullscreenBehaviorFrame(0, this.script, this, () =>
                            this.script.init!(game),
                        );
                        prepareRuntimeFullscreenScriptRoots(this.script, this);
                        if (isPromiseLike(result)) {
                            return Promise.resolve(result).catch(error => {
                                this.logScriptError("init", error);
                            });
                        }
                    }
                } catch (error) {
                    this.logScriptError("init", error);
                }
            }

            update(deltaTime: number): void {
                try {
                    withFullscreenBehaviorFrame(deltaTime, this.script, this, (epoch, delta, rootA, rootB) => {
                        (this.script.target as any) = this.target;
                        (this.script as any).isPaused = this.isPaused;
                        this.prepareScriptHook("update");
                        if (this.script.update) {
                            const result: any = this.script.update(deltaTime);
                            if (isPromiseLike(result)) {
                                void Promise.resolve(result).catch(error => {
                                    this.logScriptError("update", error);
                                });
                            }
                        }
                        autoUpdateRuntimeFullscreenFrameRoots(epoch, delta, rootA, rootB);
                    });
                } catch (error) {
                    this.logScriptError("update", error);
                }
            }

            onStart(): void | Promise<void> {
                try {
                    this.updateScript();
                    this.prepareScriptHook("onStart");

                    if (this.script.onStart) {
                        const result = this.script.onStart();
                        if (isPromiseLike(result)) {
                            return Promise.resolve(result).catch(error => {
                                this.logScriptError("onStart", error);
                            });
                        }
                    }
                } catch (error) {
                    this.logScriptError("onStart", error);
                }
            }

            onStop(): void {
                try {
                    this.updateScript();
                    this.prepareScriptHook("onStop");

                    if (this.script.onStop) {
                        this.script.onStop();
                    }
                } catch (error) {
                    this.logScriptError("onStop", error);
                }
            }

            onReset(): void {
                try {
                    const onReset = this.script.onReset;
                    if (!onReset) {
                        return;
                    }

                    this.updateScript();
                    this.prepareScriptHook("onReset");
                    onReset();
                } catch (error) {
                    this.logScriptError("onReset", error);
                }
            }

            dispose(): void {
                try {
                    this.prepareScriptHook("dispose");
                    if (this.script.dispose) {
                        this.script.dispose();
                    }
                } catch (error) {
                    this.logScriptError("dispose", error);
                } finally {
                    clearKnownRuntimeFullscreenRoots(this.script, this);
                    this.resourceScope.dispose();
                }
            }

            onEvent(msg: string, data: any): void | Promise<void> | Generator {
                try {
                    this.prepareScriptHook("onEvent");
                    if (this.script.onEvent) {
                        const result: any = this.script.onEvent(msg, data);
                        if (isPromiseLike(result)) {
                            void Promise.resolve(result).catch(error => {
                                this.logScriptError("onEvent", error);
                            });
                        }
                        return result;
                    }
                } catch (error) {
                    this.logScriptError("onEvent", error);
                }
            }

            onAttributesUpdated(): void {
                try {
                    this.updateScript();
                    this.prepareScriptHook("onAttributesUpdated");

                    if (this.script.onAttributesUpdated) {
                        this.script.onAttributesUpdated();
                    }
                } catch (error) {
                    this.logScriptError("onAttributesUpdated", error);
                }
            }

            fixedUpdate(fixedDeltaTime: number): void {
                try {
                    withFullscreenBehaviorFrame(fixedDeltaTime, this.script, this, (epoch, delta, rootA, rootB) => {
                        this.prepareScriptHook("fixedUpdate");
                        if (this.script.fixedUpdate) {
                            this.script.fixedUpdate(fixedDeltaTime);
                        }
                        autoUpdateRuntimeFullscreenFrameRoots(epoch, delta, rootA, rootB);
                    });
                } catch (error) {
                    this.logScriptError("fixedUpdate", error);
                }
            }

            onStateUpdated(key: string, value: string | undefined): void {
                try {
                    this.updateScript();
                    this.prepareScriptHook("onStateUpdated");

                    if (this.script.onStateUpdated) {
                        this.script.onStateUpdated(key, value);
                    }
                } catch (error) {
                    this.logScriptError("onStateUpdated", error);
                }
            }

            onAttributeChangeRequested(key: string, newValue: any, oldValue: any, requester: any): boolean {
                try {
                    this.prepareScriptHook("onAttributeChangeRequested");
                    if (this.script.onAttributeChangeRequested) {
                        return this.script.onAttributeChangeRequested(key, newValue, oldValue, requester) ?? true;
                    }
                } catch (error) {
                    this.logScriptError("onAttributeChangeRequested", error);
                }
                return true;
            }

            onAttributeChanged(key: string, newValue: any, oldValue: any): void {
                try {
                    this.prepareScriptHook("onAttributeChanged");
                    if (this.script.onAttributeChanged) {
                        this.script.onAttributeChanged(key, newValue, oldValue);
                    }
                } catch (error) {
                    this.logScriptError("onAttributeChanged", error);
                }
            }

            private updateScript() {
                (this.script.target as any) = this.target;
                (this.script.attributes as any) = this.attributes;
                (this.script as any).erth = this.erth;
                (this.script as any).gameObject = this.gameObject;
                (this.script as any).id = this.id;
                (this.script as any).uuid = this.uuid;
                (this.script as any).isPaused = this.isPaused;
                (this.script as any).throttleConfig = this.throttleConfig;
                (this.script as any).getAttribute = (key: string) => this.getAttribute(key);
                (this.script as any).requestAttributeChange = (key: string, value: any, options?: any) => this.requestAttributeChange(key, value, options);
                (this.script as any).findBehavior = (id: string, target?: THREE.Object3D) => this.findBehavior(id, target);
                (this.script as any).findBehaviors = (id: string) => this.findBehaviors(id);
                (this.script as any).yield = () => this.yield();
            }
        };

        setCachedScriptClass(cacheKey, BehaviorClass);
        return BehaviorClass;
    }
}

export default BehaviorScriptInjector;
