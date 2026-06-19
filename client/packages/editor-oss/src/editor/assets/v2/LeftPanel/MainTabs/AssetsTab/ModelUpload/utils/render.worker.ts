/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unused-vars */

// --- Event System Polyfill ---
const eventRegistry = new Map<any, Record<string, any[]>>();

/**
 * Adds an event listener to the target
 * @param target - The event target
 * @param type - The event type
 * @param listener - The event listener
 */
function addListener(target: any, type: string, listener: any) {
    let targetListeners = eventRegistry.get(target);
    if (!targetListeners) {
        targetListeners = {};
        eventRegistry.set(target, targetListeners);
    }
    if (!targetListeners[type]) targetListeners[type] = [];
    if (!targetListeners[type].includes(listener)) {
        targetListeners[type].push(listener);
    }
}

/**
 * Removes an event listener from the target
 * @param target - The event target
 * @param type - The event type
 * @param listener - The event listener
 */
function removeListener(target: any, type: string, listener: any) {
    const targetListeners = eventRegistry.get(target);
    if (targetListeners && targetListeners[type]) {
        const idx = targetListeners[type].indexOf(listener);
        if (idx !== -1) targetListeners[type].splice(idx, 1);
    }
}

/**
 * Dispatches an event with bubbling support (Target -> Document -> Window)
 * @param target - The event target
 * @param event - The event object
 * @returns boolean
 */
function dispatchEventPolyfill(target: any, event: any) {
    // Simple bubbling: Target -> OwnerDocument -> Window (self)
    const chain = [target];
    if (target.ownerDocument) chain.push(target.ownerDocument);
    if (target.ownerDocument !== self) chain.push(self);

    for (const obj of chain) {
        const targetListeners = eventRegistry.get(obj);
        // Ensure array exists before spreading
        const listenersList = targetListeners ? targetListeners[event.type] : undefined;

        if (listenersList) {
            const listeners = [...listenersList];
            for (const l of listeners) {
                if (typeof l === 'function') {
                    l.call(obj, event);
                } else if (l && typeof l.handleEvent === 'function') {
                    l.handleEvent(event);
                }
            }
        }
        if (event.cancelBubble) break;
    }
    return true;
}

// Polyfills for Worker Environment
const workerGlobal = self as unknown as any;
workerGlobal.window = self;

function createFakeElement(ownerDocument?: any) {
    const el = {
        style: {},
        nodeType: 1,
        ownerDocument,
        setAttribute: () => { },
        append: (..._nodes: any[]) => _nodes.at(-1),
        appendChild: <T>(node: T) => node,
        removeChild: <T>(child: T) => child,
        addEventListener: (type: string, listener: any) => addListener(el, type, listener),
        removeEventListener: (type: string, listener: any) => removeListener(el, type, listener),
        querySelector: () => null,
        querySelectorAll: () => [],
    } as unknown as any;
    return el;
}

self.addEventListener = (type: string, listener: any, options?: any) => {
    void options;
    addListener(self, type, listener);
};
self.removeEventListener = (type: string, listener: any, options?: any) => {
    void options;
    removeListener(self, type, listener);
};

const fakeDocument = {} as any;
workerGlobal.document = fakeDocument;

fakeDocument.createElement = (_name: string) => {
    void _name;
    return createFakeElement(fakeDocument);
};
fakeDocument.createElementNS = (_ns: string, _name: string) => {
    void _ns;
    void _name;
    return createFakeElement(fakeDocument);
};
fakeDocument.querySelector = () => null;
fakeDocument.querySelectorAll = () => [];
fakeDocument.body = createFakeElement(fakeDocument);
fakeDocument.head = createFakeElement(fakeDocument);
fakeDocument.documentElement = createFakeElement(fakeDocument);
fakeDocument.addEventListener = (type: string, listener: any) => addListener(fakeDocument, type, listener);
fakeDocument.removeEventListener = (type: string, listener: any) => removeListener(fakeDocument, type, listener);

let renderer: any;
let rendererReady = false;
let pendingModelPayload: ArrayBuffer | undefined;

async function updateModelPayload(payload: ArrayBuffer) {
    if (!renderer) return;

    const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
    const loader = new GLTFLoader();

    try {
        loader.parse(
            payload,
            '',
            (gltf) => {
                renderer?.updateModel(gltf.scene);
            },
            (error) => {
                const payloadType = payload ? payload.constructor?.name ?? typeof payload : typeof payload;
                const sizeInfo =
                    payload instanceof ArrayBuffer
                        ? `, byteLength=${payload.byteLength}`
                        : '';
                console.error(
                    `Worker: Failed to parse GLB (payloadType=${payloadType}${sizeInfo})`,
                    error,
                );
            },
        );
    } catch (err) {
        const payloadType = payload ? payload.constructor?.name ?? typeof payload : typeof payload;
        const sizeInfo =
            payload instanceof ArrayBuffer
                ? `, byteLength=${payload.byteLength}`
                : '';
        console.error(
            `Worker: Failed to parse model (payloadType=${payloadType}${sizeInfo})`,
            err,
        );
    }
}

self.onmessage = async (e: MessageEvent) => {
    const { type, payload } = e.data;

    switch (type) {
        case 'init': {
            const { canvas, width, height, pixelRatio } = payload;
            const offscreenCanvas = canvas as unknown as AnyCanvas;

            // Polyfill canvas properties
            if (!offscreenCanvas.style) {
                offscreenCanvas.style = { width, height, cursor: 'default' };
            }
            // Polyfill dimensions for OrbitControls calculations
            if (!(offscreenCanvas as any).clientWidth) {
                (offscreenCanvas as any).clientWidth = width;
            }
            if (!(offscreenCanvas as any).clientHeight) {
                (offscreenCanvas as any).clientHeight = height;
            }
            if (!(offscreenCanvas as any).getBoundingClientRect) {
                (offscreenCanvas as any).getBoundingClientRect = () => {
                    const currentWidth =
                        (offscreenCanvas as any).clientWidth ??
                        (offscreenCanvas as any).width ??
                        width;
                    const currentHeight =
                        (offscreenCanvas as any).clientHeight ??
                        (offscreenCanvas as any).height ??
                        height;
                    return {
                        left: 0,
                        top: 0,
                        width: currentWidth,
                        height: currentHeight,
                        right: currentWidth,
                        bottom: currentHeight,
                    };
                };
            }

            if (!offscreenCanvas.ownerDocument) {
                offscreenCanvas.ownerDocument = self.document;
            }
            if (!offscreenCanvas.getRootNode) {
                offscreenCanvas.getRootNode = () => offscreenCanvas;
            }
            // Polyfill pointer capture for OrbitControls
            if (!(offscreenCanvas as any).setPointerCapture) {
                (offscreenCanvas as any).setPointerCapture = () => { };
            }
            if (!(offscreenCanvas as any).releasePointerCapture) {
                (offscreenCanvas as any).releasePointerCapture = () => { };
            }

            // Hook into our event system
            offscreenCanvas.addEventListener = (eventType: string, listener: any) => {
                addListener(offscreenCanvas, eventType, listener);
            };
            offscreenCanvas.removeEventListener = (eventType: string, listener: any) => {
                removeListener(offscreenCanvas, eventType, listener);
            };
            (offscreenCanvas as any).dispatchEvent = (event: any) => {
                return dispatchEventPolyfill(offscreenCanvas, event);
            };

            const { ModelPreviewRenderer } = await import('./ModelPreviewRenderer');
            rendererReady = false;
            renderer = new ModelPreviewRenderer(canvas, width as number, height as number, pixelRatio as number);
            await renderer.init();
            rendererReady = true;

            if (pendingModelPayload) {
                const modelPayload = pendingModelPayload;
                pendingModelPayload = undefined;
                await updateModelPayload(modelPayload);
            }
            break;
        }

        case 'updateModel': {
            if (!rendererReady) {
                if (payload instanceof ArrayBuffer) {
                    pendingModelPayload = payload;
                }
                return;
            }

            await updateModelPayload(payload as ArrayBuffer);
            break;
        }

        case 'resize': {
            if (!renderer) return;
            const { width, height } = payload;
            renderer.setSize(width as number, height as number);
            break;
        }

        case 'dispose': {
            renderer?.dispose();
            renderer = undefined;
            rendererReady = false;
            pendingModelPayload = undefined;
            break;
        }

        case 'event': {
            if (!renderer) return;
            const { eventCopy } = payload;

            eventCopy.preventDefault = () => { };
            eventCopy.stopPropagation = () => { eventCopy.cancelBubble = true; };

            // Fix target to be the canvas
            eventCopy.target = renderer.renderer.domElement;

            // Dispatch with bubbling
            (renderer.renderer.domElement as any).dispatchEvent(eventCopy);
            break;
        }
    }
};

// Types helper
type AnyCanvas = {
    style: any;
    ownerDocument: any;
    getRootNode: () => any;
    addEventListener: any;
    removeEventListener: any;
    dispatchEvent: any;
};
