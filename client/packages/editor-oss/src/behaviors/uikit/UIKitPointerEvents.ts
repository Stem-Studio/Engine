/**
 * UIKit Pointer Events Integration
 *
 * This utility provides lazy initialization of the @pmndrs/pointer-events system.
 * The pointer events system is only active when at least one UIKit root exists,
 * avoiding performance overhead when UIKit is not being used.
 *
 * Reference counting ensures multiple behaviors can safely use this system:
 * - initialize() increments ref count, deinitialize() decrements it
 * - Pointer events only start when first root is registered
 * - Pointer events only stop when last root is unregistered
 * - Full cleanup only happens when ref count reaches 0 AND no roots exist
 *
 * Usage in behavior scripts:
 * ```javascript
 * // In init():
 * UIKitPointerEvents.initialize(game);
 *
 * // Create UI:
 * const ui = new UIKit.Container({ width: 200, height: 100 });
 * this.target.add(ui);
 * UIKitPointerEvents.registerRoot(ui);
 *
 * // In update():
 * UIKitPointerEvents.update(deltaTime);
 *
 * // In dispose():
 * UIKitPointerEvents.unregisterRoot(ui);
 * ui.dispose();
 * UIKitPointerEvents.deinitialize();
 * ```
 */

import {reversePainterSortStable} from "@ni2khanna/uikit";
import {forwardHtmlEvents} from "@pmndrs/pointer-events";
import {Vector2} from "three";
import type {Camera, Object3D, OrthographicCamera, PerspectiveCamera, Scene} from "three";

// UIKit Component interface (minimal typing for what we need)
interface UIKitComponent {
    update: (delta: number) => void;
    dispose: () => void;
    removeFromParent?: () => void;
}

interface UIKitClickEvent {
    target?: Object3D;
    nativeEvent?: PointerEvent;
}

interface GameManagerLike {
    scene?: Scene;
    camera?: Camera;
    uiCamera?: Camera;
    ensureUICamera?: () => Camera;
    renderer?: {
        domElement?: HTMLCanvasElement;
        setTransparentSort?: (method: (a: unknown, b: unknown) => number) => void;
    };
}

function asUIKitCamera(camera: Camera | unknown): PerspectiveCamera | OrthographicCamera | undefined {
    if (!camera) return undefined;
    const c = camera as {
        isPerspectiveCamera?: boolean;
        isOrthographicCamera?: boolean;
    };
    return c.isPerspectiveCamera === true || c.isOrthographicCamera === true
        ? (camera as PerspectiveCamera | OrthographicCamera)
        : undefined;
}

interface PointerEventsInstance {
    update: () => void;
    destroy: () => void;
}

// Singleton state
let pointerEventsInstance: PointerEventsInstance | null = null;
let gameRef: GameManagerLike | null = null;
let initRefCount = 0;
const activeRoots = new Set<UIKitComponent>();
const legacyClickHandlers = new WeakMap<UIKitComponent, (event: UIKitClickEvent) => void>();
let hasConfiguredTransparentSort = false;

function registerLegacyUserDataClickBridge(component: UIKitComponent): void {
    const eventful = component as unknown as {
        addEventListener?: (type: string, listener: (event: UIKitClickEvent) => void) => void;
    };
    if (legacyClickHandlers.has(component) || !eventful.addEventListener) {
        return;
    }

    const handler = (event: UIKitClickEvent) => {
        const root = component as unknown as Object3D;
        let current = event.target;
        while (current) {
            const onClick = current.userData?.onClick;
            if (typeof onClick === "function") {
                onClick(event.nativeEvent ?? event);
                return;
            }
            if (current === root) {
                return;
            }
            current = current.parent ?? undefined;
        }
    };
    legacyClickHandlers.set(component, handler);
    eventful.addEventListener("click", handler);
}

function unregisterLegacyUserDataClickBridge(component: UIKitComponent): void {
    const handler = legacyClickHandlers.get(component);
    if (!handler) {
        return;
    }
    const eventful = component as unknown as {
        removeEventListener?: (type: string, listener: (event: UIKitClickEvent) => void) => void;
    };
    eventful.removeEventListener?.("click", handler);
    legacyClickHandlers.delete(component);
}

// Diagnostic logging for UIKit layout/sizing issues. OFF by default — this is
// developer instrumentation that emits per-frame `[UIKitDiag]` snapshots for the
// first few frames of every registered root, which is console noise in normal
// use. Flip to true locally when debugging UIKit sizing/positioning.
const UIKIT_DIAG = false;
const diagFramesRemaining = new Map<UIKitComponent, number>();
const DIAG_MAX_FRAMES = 6;

const diagSizeVec = new Vector2();

interface SignalLike<T> {
    value: T;
    peek?: () => T;
}
interface FullscreenLike {
    renderer?: {getSize?: (target: Vector2) => Vector2; domElement?: HTMLCanvasElement};
    parent?: unknown;
    sizeX?: SignalLike<number>;
    sizeY?: SignalLike<number>;
    pixelSize?: SignalLike<number>;
    properties?: {peek?: () => Record<string, unknown>};
}
interface YogaNodeLike {
    getComputedWidth?: () => number;
    getComputedHeight?: () => number;
    getComputedLeft?: () => number;
    getComputedTop?: () => number;
}
interface UIKitInternal {
    node?: {node?: YogaNodeLike; size?: SignalLike<unknown>};
    children?: UIKitInternal[];
    constructor?: {name?: string};
    properties?: {peek?: () => Record<string, unknown>};
}

function snapshotComponent(component: UIKitComponent, depth: number, maxDepth: number): unknown {
    const c = component as unknown as UIKitInternal;
    const yoga = c.node?.node;
    const props = c.properties?.peek?.() ?? {};
    const out: Record<string, unknown> = {
        type: c.constructor?.name,
        width: props.width,
        height: props.height,
        text: (props as {text?: string}).text,
        computed: yoga
            ? {
                  w: yoga.getComputedWidth?.(),
                  h: yoga.getComputedHeight?.(),
                  left: yoga.getComputedLeft?.(),
                  top: yoga.getComputedTop?.(),
              }
            : undefined,
    };
    if (depth < maxDepth && Array.isArray(c.children) && c.children.length > 0) {
        out.children = c.children
            .slice(0, 4)
            .map(ch => snapshotComponent(ch as unknown as UIKitComponent, depth + 1, maxDepth));
        if (c.children.length > 4) {
            (out.children as unknown[]).push({truncated: c.children.length - 4});
        }
    }
    return out;
}

function logRootDiag(label: string, component: UIKitComponent): void {
    if (!UIKIT_DIAG) return;
    const fs = component as unknown as FullscreenLike;
    const renderer = fs.renderer;
    let size: {x: number; y: number} | undefined;
    try {
        if (renderer?.getSize) {
            const result = renderer.getSize(diagSizeVec);
            size = {x: result.x, y: result.y};
        }
    } catch (err) {
        size = undefined;
        console.warn("[UIKitDiag] renderer.getSize threw", err);
    }
    const canvas = renderer?.domElement;
    const parent = fs.parent as
        | undefined
        | {
              isPerspectiveCamera?: boolean;
              isOrthographicCamera?: boolean;
              fov?: number;
              near?: number;
              far?: number;
              aspect?: number;
              zoom?: number;
              parent?: unknown;
          };
    const fullscreenProps = fs.properties?.peek?.() ?? {};
    console.warn(`[UIKitDiag] ${label}`, {
        rendererCanvasPixels: size ? {x: size.x, y: size.y} : null,
        canvasCSS: canvas ? {w: canvas.clientWidth, h: canvas.clientHeight, width: canvas.width, height: canvas.height} : null,
        parentCamera: parent
            ? {
                  isPerspective: !!parent.isPerspectiveCamera,
                  isOrtho: !!parent.isOrthographicCamera,
                  fov: parent.fov,
                  near: parent.near,
                  aspect: parent.aspect,
                  zoom: parent.zoom,
                  hasParent: !!parent.parent,
              }
            : "NO_PARENT_CAMERA",
        fullscreenSignals: {
            sizeX: fs.sizeX?.value ?? fs.sizeX?.peek?.(),
            sizeY: fs.sizeY?.value ?? fs.sizeY?.peek?.(),
            pixelSize: fs.pixelSize?.value ?? fs.pixelSize?.peek?.(),
        },
        fullscreenProps: {
            pixelSize: (fullscreenProps as {pixelSize?: unknown}).pixelSize,
            distanceToCamera: (fullscreenProps as {distanceToCamera?: unknown}).distanceToCamera,
        },
        tree: snapshotComponent(component, 0, 3),
    });
}

function isFullscreenLike(component: UIKitComponent): component is UIKitComponent & FullscreenLike {
    const fs = component as unknown as FullscreenLike;
    return (
        typeof fs.renderer?.getSize === "function" &&
        !!fs.sizeX &&
        !!fs.sizeY &&
        !!fs.pixelSize
    );
}

function isFullscreenCameraError(error: unknown): boolean {
    const message =
        error && typeof error === "object" && "message" in error
            ? String((error as {message?: unknown}).message)
            : String(error);
    return message.includes("fullscreen can only be added to a camera");
}

function ensureFullscreenRootCamera(component: UIKitComponent): boolean {
    if (!isFullscreenLike(component)) {
        return true;
    }

    if (asUIKitCamera(component.parent)) {
        return true;
    }

    let camera: PerspectiveCamera | OrthographicCamera | undefined;
    try {
        camera = asUIKitCamera(gameRef?.ensureUICamera?.());
    } catch {
        camera = undefined;
    }

    camera =
        camera ??
        asUIKitCamera(gameRef?.uiCamera) ??
        asUIKitCamera(gameRef?.camera) ??
        asUIKitCamera((globalThis as {app?: {camera?: Camera}}).app?.camera);
    if (!camera) {
        return false;
    }

    camera.add(component as unknown as Object3D);
    return true;
}

/**
 * Ensures UIKit transparent objects use stable painter sorting.
 *
 * @param game - The GameManager-like runtime object containing renderer.
 * @returns void
 */
function ensureTransparentSort(game: GameManagerLike): void {
    if (hasConfiguredTransparentSort) {
        return;
    }

    const renderer = game.renderer;

    if (!renderer?.setTransparentSort) {
        return;
    }

    renderer.setTransparentSort(reversePainterSortStable as (a: unknown, b: unknown) => number);
    hasConfiguredTransparentSort = true;
}

/**
 * Initializes the module with a GameManager reference.
 * Call this once in your behavior's init() before creating any UIKit components.
 * Reference counted - each initialize() should be paired with a deinitialize().
 *
 * @param game - The GameManager instance
 */
export function initialize(game: GameManagerLike): void {
    initRefCount++;

    ensureTransparentSort(game);
    gameRef = game;
}

/**
 * Decrements the initialization reference count.
 * Call this in your behavior's dispose() after unregistering all roots.
 * The system fully cleans up when ref count reaches 0 AND no roots exist.
 */
export function deinitialize(): void {
    if (initRefCount > 0) {
        initRefCount--;
    }

    // Full cleanup only when no more references AND no active roots
    if (initRefCount === 0 && activeRoots.size === 0) {
        cleanupPointerEvents();
        gameRef = null;
    }
}

/**
 * Registers a UIKit component as a root (a component whose parent is not UIKit).
 * Automatically enables pointer events when the first root is registered.
 *
 * @param component - The UIKit component (Container, Fullscreen, etc.)
 */
export function registerRoot(component: UIKitComponent): void {
    activeRoots.add(component);
    registerLegacyUserDataClickBridge(component);

    // Initialize pointer events if this is the first root
    if (activeRoots.size === 1 && !pointerEventsInstance && gameRef) {
        initializePointerEvents();
    }

    // Force a synchronous first update so `Fullscreen` populates its
    // `sizeX/sizeY/pixelSize` signals from the parent camera + renderer.
    // Without this, any child added during the behavior's `init()` lays
    // out against `sizeX = 0` (the constructor default), so percentage
    // widths resolve to 0 and yoga measures text with width=0 — every
    // word ends up on its own line. The next behavior tick would update
    // dimensions, but yoga's text-measure cache and the timing of the
    // editor → play transition combine to leave that initial broken
    // layout pinned on the first play after a fresh import. A redundant
    // update on a stable root is harmless; the regular `update()` call
    // in the per-frame `UIKitPointerEvents.update` continues to handle
    // subsequent dimension changes.
    logRootDiag("registerRoot.before-warmup", component);
    diagFramesRemaining.set(component, DIAG_MAX_FRAMES);
    try {
        if (ensureFullscreenRootCamera(component)) {
            component.update(0);
        }
        logRootDiag("registerRoot.after-warmup", component);
    } catch (err) {
        // Fullscreen.update throws if the component isn't parented to a
        // camera yet. Helpers attach BEFORE calling registerRoot, so this
        // shouldn't happen in practice — but if a caller registers a
        // detached root, just skip the synchronous warm-up and let the
        // first per-frame update populate dimensions later.
        console.debug("[UIKitPointerEvents] registerRoot warm-up update skipped", err);
    }
}

/**
 * Unregisters a UIKit root component.
 * Disables pointer events when the last root is unregistered.
 *
 * @param component - The UIKit component to unregister
 */
export function unregisterRoot(component: UIKitComponent): void {
    if (!activeRoots.has(component)) {
        return;
    }

    activeRoots.delete(component);
    diagFramesRemaining.delete(component);
    unregisterLegacyUserDataClickBridge(component);

    // Clean up pointer events if no roots remain
    if (activeRoots.size === 0) {
        cleanupPointerEvents();

        // If no more init references either, clear gameRef
        if (initRefCount === 0) {
            gameRef = null;
        }
    }
}

/**
 * Updates all registered UIKit roots and processes pointer events.
 * Call this in your behavior's update() loop.
 * Safe to call even when no roots exist (no-op).
 *
 * @param deltaTime - Time since last frame in seconds
 */
export function update(deltaTime: number = 0): void {
    // Update pointer events system
    if (pointerEventsInstance) {
        pointerEventsInstance.update();
    }

    // Update all UIKit roots
    for (const root of activeRoots) {
        const framesLeft = diagFramesRemaining.get(root);
        const wantLog = UIKIT_DIAG && framesLeft !== undefined && framesLeft > 0;
        if (wantLog) {
            logRootDiag(`update.before-frame${DIAG_MAX_FRAMES - framesLeft + 1}`, root);
        }
        if (!ensureFullscreenRootCamera(root)) {
            continue;
        }
        try {
            root.update(deltaTime);
        } catch (error) {
            if (isFullscreenCameraError(error)) {
                ensureFullscreenRootCamera(root);
                continue;
            }
            throw error;
        }
        if (wantLog) {
            logRootDiag(`update.after-frame${DIAG_MAX_FRAMES - framesLeft + 1}`, root);
            const next = framesLeft - 1;
            if (next <= 0) diagFramesRemaining.delete(root);
            else diagFramesRemaining.set(root, next);
        }
    }
}

/**
 * Force cleanup of all roots and the pointer events system.
 * Use sparingly - prefer deinitialize() for normal cleanup.
 * This bypasses reference counting and immediately cleans everything.
 */
export function forceDispose(): void {
    for (const root of activeRoots) {
        unregisterLegacyUserDataClickBridge(root);
        try {
            root.removeFromParent?.();
        } catch (error) {
            console.warn("UIKitPointerEvents.forceDispose: Failed to remove root from parent", error);
        }

        try {
            root.dispose?.();
        } catch (error) {
            console.warn("UIKitPointerEvents.forceDispose: Failed to dispose root", error);
        }
    }

    activeRoots.clear();
    cleanupPointerEvents();
    gameRef = null;
    initRefCount = 0;
    hasConfiguredTransparentSort = false;
}

/**
 * Returns whether the pointer events system is currently active.
 * @returns True when pointer events instance exists and at least one root is active.
 */
export function isActive(): boolean {
    return pointerEventsInstance !== null && activeRoots.size > 0;
}

/**
 * Returns the number of active UIKit roots.
 * @returns Number of currently registered UIKit roots.
 */
export function getRootCount(): number {
    return activeRoots.size;
}

/**
 * Returns the current initialization reference count.
 * @returns Current initialize/deinitialize reference count.
 */
export function getInitRefCount(): number {
    return initRefCount;
}

/**
 * Returns whether the system is initialized (has game reference).
 * @returns True when a game reference is currently set.
 */
export function isInitialized(): boolean {
    return gameRef !== null;
}

// Internal: Initialize the pointer events system
/**
 *
 */
function initializePointerEvents(): void {
    if (!gameRef) {
        console.warn("UIKitPointerEvents: Not initialized. Call initialize(game) first.");
        return;
    }

    if (pointerEventsInstance) {
        // Already initialized
        return;
    }

    const scene = gameRef.scene;
    const camera: PerspectiveCamera | OrthographicCamera | undefined =
        asUIKitCamera(gameRef.uiCamera) ?? asUIKitCamera(gameRef.camera);
    const canvas = gameRef.renderer?.domElement ?? window.document.querySelector<HTMLCanvasElement>("canvas");

    if (!scene || !camera || !canvas) {
        console.warn("UIKitPointerEvents: Missing scene, camera, or canvas.");
        return;
    }

    // The camera controls call setPointerCapture() on the scene container
    // (#scene-container) on pointerdown for drag handling. That capture
    // redirects every subsequent pointermove/pointerup for the gesture to the
    // container, so a listener bound to the <canvas> only ever sees the initial
    // pointerdown — never the pointerup that completes a click. The result is
    // that UIKit buttons receive pointerdown but never click. Bind the pointer
    // forwarder to the capturing ancestor (falling back to the canvas) so the
    // UI pointer system sees the full down -> up -> click sequence. The
    // container and canvas share the same client rect, so the pointer -> NDC
    // coordinate mapping (which uses the bound element's bounding rect) is
    // unchanged.
    const eventSource =
        canvas.closest<HTMLElement>("#scene-container") ?? canvas.parentElement ?? canvas;

    pointerEventsInstance = forwardHtmlEvents(eventSource, camera, scene, {
        batchEvents: true,
        intersectEveryFrame: false,
        forwardPointerCapture: true,
    });
}

// Internal: Clean up pointer events
/**
 *
 */
function cleanupPointerEvents(): void {
    if (pointerEventsInstance) {
        pointerEventsInstance.destroy();
        pointerEventsInstance = null;
    }
}

// Default export for convenience
export default {
    initialize,
    deinitialize,
    registerRoot,
    unregisterRoot,
    update,
    forceDispose,
    isActive,
    getRootCount,
    getInitRefCount,
    isInitialized,
};
