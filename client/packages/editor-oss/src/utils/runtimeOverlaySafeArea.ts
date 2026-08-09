import type {ViewportSafeArea} from "./viewportSafeArea";

type ManagedStyles = {
    top: string;
    topPriority: string;
    height: string;
    heightPriority: string;
    marker: string | null;
};

export interface RuntimeOverlaySafeAreaOptions {
    getSafeArea: () => ViewportSafeArea;
    document?: Document;
    window?: Window;
}

const HOST_CHROME_ATTRIBUTE = "data-stem-host-chrome";
const MANAGED_ATTRIBUTE = "data-stem-safe-overlay-managed";
const MIN_RUNTIME_Z_INDEX = 1000;
const FULLSCREEN_OVERLAY_RATIO = 0.75;

const isFiniteNumber = (value: number): boolean => Number.isFinite(value);

/**
 * Keeps legacy body-level game HUDs inside the engine's measured safe area.
 *
 * New behaviors should use `erth.viewport.getSafeArea()` directly. This
 * coordinator is intentionally conservative compatibility glue for existing
 * scenes that still append fixed overlays to `document.body` and therefore
 * cannot consume the safe-area contract themselves.
 */
export class RuntimeOverlaySafeAreaCoordinator {
    private readonly document: Document | undefined;
    private readonly window: Window | undefined;
    private readonly managed = new Map<HTMLElement, ManagedStyles>();
    private observer: MutationObserver | null = null;
    private refreshScheduled = false;
    private started = false;
    private readonly onResize = () => this.scheduleRefresh();

    constructor(private readonly options: RuntimeOverlaySafeAreaOptions) {
        this.document = options.document ?? (typeof document !== "undefined" ? document : undefined);
        this.window = options.window ?? (typeof window !== "undefined" ? window : undefined);
    }

    start(): void {
        if (this.started || !this.document?.body) return;
        this.started = true;
        this.observer = new MutationObserver(() => this.scheduleRefresh());
        this.observer.observe(this.document.body, {childList: true});
        this.window?.addEventListener("resize", this.onResize, {passive: true});
        this.refresh();
    }

    dispose(): void {
        this.observer?.disconnect();
        this.observer = null;
        this.window?.removeEventListener("resize", this.onResize);
        this.restoreAll();
        this.started = false;
    }

    refresh(): void {
        if (!this.document?.body) return;
        const safeArea = this.options.getSafeArea();
        const safeTop = Math.max(0, safeArea.top);
        const viewportHeight = Math.max(
            0,
            this.window?.innerHeight || this.document.documentElement?.clientHeight || 0,
        );
        const candidates = Array.from(this.document.body.children)
            .filter((element): element is HTMLElement => element instanceof HTMLElement)
            .filter(element => this.isCandidate(element, safeTop, viewportHeight));

        const candidateSet = new Set(candidates);
        for (const element of candidates) {
            this.applySafeTop(element, safeTop, viewportHeight);
        }
        for (const element of this.managed.keys()) {
            if (!candidateSet.has(element)) this.restore(element);
        }
    }

    private scheduleRefresh(): void {
        if (this.refreshScheduled) return;
        this.refreshScheduled = true;
        queueMicrotask(() => {
            this.refreshScheduled = false;
            this.refresh();
        });
    }

    private isCandidate(element: HTMLElement, safeTop: number, viewportHeight: number): boolean {
        if (safeTop <= 0 || element.hasAttribute(HOST_CHROME_ATTRIBUTE)) return false;
        if (element.hasAttribute(MANAGED_ATTRIBUTE)) return true;
        if (element.id === "container" || element.id === "root" || element.id === "app") return false;
        if (element.closest(`[${HOST_CHROME_ATTRIBUTE}="true"]`)) return false;

        const style = getComputedStyle(element);
        if (style.position !== "fixed") return false;
        const zIndex = Number.parseInt(style.zIndex, 10);
        if (!isFiniteNumber(zIndex) || zIndex < MIN_RUNTIME_Z_INDEX) return false;

        const rect = element.getBoundingClientRect();
        if (rect.top >= safeTop || rect.bottom <= 0) return false;
        // Only shift overlays that are top-anchored. Centered prompts and
        // bottom HUDs should retain their authored placement.
        const top = Number.parseFloat(style.top);
        if (isFiniteNumber(top) && top > 1) return false;
        return rect.height >= viewportHeight * FULLSCREEN_OVERLAY_RATIO || rect.top <= 1;
    }

    private applySafeTop(element: HTMLElement, safeTop: number, viewportHeight: number): void {
        if (!this.managed.has(element)) {
            this.managed.set(element, {
                top: element.style.getPropertyValue("top"),
                topPriority: element.style.getPropertyPriority("top"),
                height: element.style.getPropertyValue("height"),
                heightPriority: element.style.getPropertyPriority("height"),
                marker: element.getAttribute(MANAGED_ATTRIBUTE),
            });
        }

        element.setAttribute(MANAGED_ATTRIBUTE, "true");
        element.style.setProperty("top", `${safeTop}px`, "important");
        const rect = element.getBoundingClientRect();
        if (rect.height >= viewportHeight * FULLSCREEN_OVERLAY_RATIO) {
            element.style.setProperty("height", `calc(100vh - ${safeTop}px)`, "important");
        }
    }

    private restore(element: HTMLElement): void {
        const original = this.managed.get(element);
        if (!original) return;
        if (original.top) element.style.setProperty("top", original.top, original.topPriority);
        else element.style.removeProperty("top");
        if (original.height) element.style.setProperty("height", original.height, original.heightPriority);
        else element.style.removeProperty("height");
        if (original.marker === null) element.removeAttribute(MANAGED_ATTRIBUTE);
        else element.setAttribute(MANAGED_ATTRIBUTE, original.marker);
        this.managed.delete(element);
    }

    private restoreAll(): void {
        for (const element of Array.from(this.managed.keys())) this.restore(element);
    }
}

