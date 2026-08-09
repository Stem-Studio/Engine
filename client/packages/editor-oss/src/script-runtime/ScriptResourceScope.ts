/**
 * Owns browser resources created by one generated behavior/lambda instance.
 *
 * User scripts are allowed to use familiar browser APIs, but those APIs do
 * not know when a Play session ends. Keeping the handles here lets the
 * runtime revoke them even when a script forgot to implement cleanup.
 */
export interface ScriptResourceCounts {
    timeouts: number;
    intervals: number;
    animationFrames: number;
    listeners: number;
    audioNodes: number;
    audioContexts: number;
}

export interface ScriptResourceDiagnostics extends ScriptResourceCounts {
    scopes: number;
    scopeLabels: Record<string, number>;
}

const activeScopes = new Set<ScriptResourceScope>();
// Shared with generated behavior classes and the editor plugin owner. Keeping
// the symbol here lets teardown revoke a scope even when a user script
// overrides the optional onEditorDispose hook.
export const SCRIPT_RESOURCE_SCOPE_SYMBOL = Symbol.for(
    "stem.editor-oss.scriptResourceScope.uikit-fullscreen-camera-v21-root-full-percent-normalize",
);

export function disposeScriptResourceScope(value: unknown): void {
    const scope = (value as Record<symbol, {dispose?: () => void}> | null | undefined)?.[SCRIPT_RESOURCE_SCOPE_SYMBOL];
    scope?.dispose?.();
}

export function getScriptResourceDiagnostics(): ScriptResourceDiagnostics {
    const diagnostics: ScriptResourceDiagnostics = {
        scopes: activeScopes.size,
        scopeLabels: {},
        timeouts: 0,
        intervals: 0,
        animationFrames: 0,
        listeners: 0,
        audioNodes: 0,
        audioContexts: 0,
    };
    for (const scope of activeScopes) {
        diagnostics.scopeLabels[scope.label] = (diagnostics.scopeLabels[scope.label] ?? 0) + 1;
        const counts = scope.getResourceCounts();
        diagnostics.timeouts += counts.timeouts;
        diagnostics.intervals += counts.intervals;
        diagnostics.animationFrames += counts.animationFrames;
        diagnostics.listeners += counts.listeners;
        diagnostics.audioNodes += counts.audioNodes;
        diagnostics.audioContexts += counts.audioContexts;
    }
    return diagnostics;
}

const globalResourceDiagnostics = globalThis as typeof globalThis & {
    __STEM_SCRIPT_RESOURCE_DIAGNOSTICS__?: () => ScriptResourceDiagnostics;
};
globalResourceDiagnostics.__STEM_SCRIPT_RESOURCE_DIAGNOSTICS__ = getScriptResourceDiagnostics;

export class ScriptResourceScope {
    private readonly hostWindow: Window;
    private readonly hostDocument: Document | null;
    private readonly timeoutIds = new Set<number>();
    private readonly intervalIds = new Set<number>();
    private readonly animationFrameIds = new Set<number>();
    private readonly listeners: Array<{
        target: EventTarget;
        type: string;
        listener: EventListenerOrEventListenerObject;
        options?: boolean | AddEventListenerOptions;
    }> = [];
    private readonly audioNodes = new Set<HTMLAudioElement>();
    private readonly audioContexts = new Set<AudioContext>();
    private windowProxy: Window | null = null;
    private documentProxy: Document | null = null;
    private disposed = false;
    readonly label: string;

    constructor(options: {window?: Window; document?: Document; label?: string} = {}) {
        this.hostWindow = options.window ?? (typeof window !== "undefined" ? window : globalThis as unknown as Window);
        this.hostDocument = options.document ?? (typeof document !== "undefined" ? document : null);
        this.label = options.label ?? "unlabeled";
        activeScopes.add(this);
    }

    get isDisposed(): boolean {
        return this.disposed;
    }

    getResourceCounts(): ScriptResourceCounts {
        return {
            timeouts: this.timeoutIds.size,
            intervals: this.intervalIds.size,
            animationFrames: this.animationFrameIds.size,
            listeners: this.listeners.length,
            audioNodes: this.audioNodes.size,
            audioContexts: this.audioContexts.size,
        };
    }

    setTimeout(handler: (...args: any[]) => void, timeout?: number, ...args: any[]): number {
        if (this.disposed) return -1;
        let id = -1;
        id = this.hostWindow.setTimeout(() => {
            this.timeoutIds.delete(id);
            if (!this.disposed) handler(...args);
        }, timeout, ...args);
        this.timeoutIds.add(id);
        return id;
    }

    clearTimeout(id: number): void {
        this.hostWindow.clearTimeout(id);
        this.timeoutIds.delete(id);
    }

    setInterval(handler: (...args: any[]) => void, timeout?: number, ...args: any[]): number {
        if (this.disposed) return -1;
        const id = this.hostWindow.setInterval(() => {
            if (!this.disposed) handler(...args);
        }, timeout, ...args);
        this.intervalIds.add(id);
        return id;
    }

    clearInterval(id: number): void {
        this.hostWindow.clearInterval(id);
        this.intervalIds.delete(id);
    }

    requestAnimationFrame(callback: FrameRequestCallback): number {
        if (this.disposed) return -1;
        let id = -1;
        id = this.hostWindow.requestAnimationFrame(timestamp => {
            this.animationFrameIds.delete(id);
            if (!this.disposed) callback(timestamp);
        });
        this.animationFrameIds.add(id);
        return id;
    }

    cancelAnimationFrame(id: number): void {
        this.hostWindow.cancelAnimationFrame(id);
        this.animationFrameIds.delete(id);
    }

    addEventListener(
        target: EventTarget,
        type: string,
        listener: EventListenerOrEventListenerObject | null,
        options?: boolean | AddEventListenerOptions,
    ): void {
        if (this.disposed || !listener) return;
        target.addEventListener(type, listener, options);
        this.listeners.push({target, type, listener, options});
    }

    removeEventListener(
        target: EventTarget,
        type: string,
        listener: EventListenerOrEventListenerObject | null,
        options?: boolean | EventListenerOptions,
    ): void {
        if (!listener) return;
        target.removeEventListener(type, listener, options);
        const capture = typeof options === "boolean" ? options : options?.capture ?? false;
        for (let index = this.listeners.length - 1; index >= 0; index--) {
            const record = this.listeners[index]!;
            const recordCapture = typeof record.options === "boolean" ? record.options : record.options?.capture ?? false;
            if (record.target === target && record.type === type && record.listener === listener && recordCapture === capture) {
                this.listeners.splice(index, 1);
                break;
            }
        }
    }

    wrapEventTarget<T extends object>(target: T): T {
        if (typeof EventTarget === "undefined" || !(target instanceof EventTarget)) return target;
        const scope = this;
        return new Proxy(target, {
            get(value, property, receiver) {
                if (property === "addEventListener") {
                    return (type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions) =>
                        scope.addEventListener(value, type, listener, options);
                }
                if (property === "removeEventListener") {
                    return (type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | EventListenerOptions) =>
                        scope.removeEventListener(value, type, listener, options);
                }
                const result = Reflect.get(value, property, value);
                return typeof result === "function" ? result.bind(value) : result;
            },
            set(value, property, nextValue) {
                return Reflect.set(value, property, nextValue, value);
            },
        });
    }

    getWindow(): Window {
        if (this.windowProxy) return this.windowProxy;
        const scope = this;
        this.windowProxy = new Proxy(this.hostWindow, {
            get(target, property, receiver) {
                switch (property) {
                    case "document": return scope.getDocument();
                    case "window":
                    case "self":
                    case "globalThis": return scope.getWindow();
                    case "setTimeout": return scope.setTimeout.bind(scope);
                    case "clearTimeout": return scope.clearTimeout.bind(scope);
                    case "setInterval": return scope.setInterval.bind(scope);
                    case "clearInterval": return scope.clearInterval.bind(scope);
                    case "requestAnimationFrame": return scope.requestAnimationFrame.bind(scope);
                    case "cancelAnimationFrame": return scope.cancelAnimationFrame.bind(scope);
                    case "addEventListener": return scope.addEventListener.bind(scope, target);
                    case "removeEventListener": return scope.removeEventListener.bind(scope, target);
                    case "Audio": return scope.getAudioConstructor();
                    case "AudioContext": return scope.getAudioContextConstructor();
                    case "webkitAudioContext": return scope.getAudioContextConstructor();
                    default: {
                        // Preserve the host object as the receiver. A Window proxy
                        // otherwise leaks the proxy into DOM/WebAudio accessors and
                        // triggers browser brand-check failures ("Illegal invocation").
                        const value = Reflect.get(target, property, target);
                        return typeof value === "function" ? value.bind(target) : value;
                    }
                }
            },
        });
        return this.windowProxy;
    }

    getDocument(): Document | null {
        if (!this.hostDocument) return null;
        if (this.documentProxy) return this.documentProxy;
        const scope = this;
        this.documentProxy = new Proxy(this.hostDocument, {
            get(target, property, receiver) {
                if (property === "addEventListener") return scope.addEventListener.bind(scope, target);
                if (property === "removeEventListener") return scope.removeEventListener.bind(scope, target);
                if (property === "defaultView") return scope.getWindow();
                const value = Reflect.get(target, property, target);
                if (typeof value !== "function") return value;
                return (...args: any[]) => {
                    const result = value.apply(target, args);
                    // Return native DOM objects unchanged. Proxying a canvas, image,
                    // or other element breaks Web IDL brand checks (for example
                    // HTMLCanvasElement#getContext) in Chromium/WebGPU.
                    return result;
                };
            },
        });
        return this.documentProxy;
    }

    getAudioConstructor(): typeof Audio | undefined {
        const AudioConstructor = (this.hostWindow as Window & {Audio?: typeof Audio}).Audio;
        if (!AudioConstructor) return undefined;
        const scope = this;
        return function ScopedAudio(this: HTMLAudioElement, ...args: any[]) {
            const audio = new AudioConstructor(...args);
            scope.audioNodes.add(audio);
            return audio;
        } as unknown as typeof Audio;
    }

    getAudioContextConstructor(): typeof AudioContext | undefined {
        const hostWindow = this.hostWindow as Window & {AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext};
        const AudioContextConstructor = (hostWindow.AudioContext ?? hostWindow.webkitAudioContext) as
            | (new (...args: any[]) => AudioContext)
            | undefined;
        if (!AudioContextConstructor) return undefined;
        const scope = this;
        return new Proxy(AudioContextConstructor, {
            construct(target, args, newTarget) {
                const context = Reflect.construct(target, args, newTarget);
                scope.audioContexts.add(context);
                return context;
            },
        }) as typeof AudioContext;
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        activeScopes.delete(this);
        for (const id of this.timeoutIds) this.hostWindow.clearTimeout(id);
        for (const id of this.intervalIds) this.hostWindow.clearInterval(id);
        for (const id of this.animationFrameIds) this.hostWindow.cancelAnimationFrame(id);
        this.timeoutIds.clear();
        this.intervalIds.clear();
        this.animationFrameIds.clear();
        for (const record of this.listeners) {
            record.target.removeEventListener(record.type, record.listener, record.options);
        }
        this.listeners.length = 0;
        for (const audio of this.audioNodes) {
            try {
                audio.pause();
                audio.removeAttribute("src");
                audio.load();
            } catch { /* best effort */ }
        }
        this.audioNodes.clear();
        for (const context of this.audioContexts) {
            try { void context.close(); } catch { /* best effort */ }
        }
        this.audioContexts.clear();
        this.windowProxy = null;
        this.documentProxy = null;
    }
}
