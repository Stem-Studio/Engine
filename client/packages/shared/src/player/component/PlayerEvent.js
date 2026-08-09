
/**
 * Module: PlayerEvent.js
 * Purpose: Contains logic for player event.
 */

import PlayerComponent from "./PlayerComponent";
import EventBus from "../../behaviors/event/EventBus";
import Ajax from "../../utils/Ajax";

const PLAYER_EVENT_SCRIPT_BATCH_SIZE = 8;
const PLAYER_EVENT_SCRIPT_FRAME_BUDGET_MS = 8;
const SCRIPT_EVENT_FACTORY_CACHE_LIMIT = 128;
const scriptEventFactoryCache = new Map();

const getCachedAmmo = () => globalThis.__erthAmmo__;

let threeNamespacePromise = null;
const getThreeNamespace = () => {
    if (!threeNamespacePromise) {
        threeNamespacePromise = import("three");
    }
    return threeNamespacePromise;
};

const nowForPlayerEventStartup = () =>
    typeof performance !== "undefined" && typeof performance.now === "function"
        ? performance.now()
        : Date.now();

const yieldPlayerEventStartupToPaint = () =>
    new Promise(resolve => {
        const finish = () => setTimeout(resolve, 0);
        if (typeof requestAnimationFrame === "function") {
            requestAnimationFrame(() => finish());
        } else {
            finish();
        }
    });

const getCachedScriptEventFactory = source => {
    const cached = scriptEventFactoryCache.get(source);
    if (cached) {
        scriptEventFactoryCache.delete(source);
        scriptEventFactoryCache.set(source, cached);
        return cached;
    }

    const factory = new Function(
        "app",
        "scene",
        "camera",
        "renderer",
        "THREE",
        "Ammo",
        "EventBus",
        "game",
        "physics",
        "ajax",
        source +
            `
        var init = init || null;
        var start = start || null;
        var update = update || null;
        var stop = stop || null;
        var onClick = onClick || null;
        var onDblClick = onDblClick || null;
        var onKeyDown = onKeyDown || null;
        var onKeyUp = onKeyUp || null;
        var onMouseDown = onMouseDown || null;
        var onMouseMove = onMouseMove || null;
        var onMouseUp = onMouseUp || null;
        var onMouseWheel = onMouseWheel || null;
        var onResize = onResize || null;
        var onTouchStart = onTouchStart || null;
        var onTouchEnd = onTouchEnd || null;
        var onTouchMove = onTouchMove || null;
        var onVRConnected = onVRConnected || null;
        var onVRDisconnected = onVRDisconnected || null;
        var onVRSelectStart = onVRSelectStart || null;
        var onVRSelectEnd = onVRSelectEnd || null;
        return { init, start, update, stop, onClick, onDblClick, onKeyDown, onKeyUp, onMouseDown, onMouseMove, onMouseUp, onMouseWheel, onTouchStart, onTouchEnd, onTouchMove, onResize, onVRConnected, onVRDisconnected, onVRSelectStart, onVRSelectEnd };
        `,
    );

    scriptEventFactoryCache.set(source, factory);
    if (scriptEventFactoryCache.size > SCRIPT_EVENT_FACTORY_CACHE_LIMIT) {
        const oldestKey = scriptEventFactoryCache.keys().next().value;
        if (oldestKey !== undefined) {
            scriptEventFactoryCache.delete(oldestKey);
        }
    }

    return factory;
};

class PlayerEvent extends PlayerComponent {
    gameManager = null;
    boundEventHandlers = [];
    initHandlers = [];
    startHandlers = [];
    updateHandlers = [];
    stopHandlers = [];

    constructor(app) {
        super(app);
        this.gameManager = app.game;
    }

    async create(scene, camera, renderer, scripts) {
        this.scene = scene;
        this.camera = camera;
        this.renderer = renderer;
        this.scripts = scripts;
        this.physics = this.app.physics.physics;
        this.boundEventHandlers = [];
        this.initHandlers = [];
        this.startHandlers = [];
        this.updateHandlers = [];
        this.stopHandlers = [];
        // Keep the historical Ammo script argument for Ammo scenes, but never
        // leak a cached Ammo module into a Rapier session after an engine
        // switch. `physics` remains the backend-neutral scripting surface.
        const physicsEngineType = this.physics?.getPhysicsEngineType?.();
        const ammo = physicsEngineType === "rapier"
            ? undefined
            : getCachedAmmo() || this.physics?.ammo || this.physics?.engine?.ammo;
        const dom = renderer.domElement;
        let THREE = null;
        let index = 0;
        let sliceStart = nowForPlayerEventStartup();
        let processedThisSlice = 0;
        this.events = [];

        for (const uuid in scripts) {
            if (!Object.prototype.hasOwnProperty.call(scripts, uuid)) {
                continue;
            }

            if (!THREE) {
                THREE = await getThreeNamespace();
            }

            const event = this.createScriptEvent(scripts[uuid], scene, camera, renderer, THREE, ammo);
            this.events.push(event);
            this.registerScriptEvent(event, index, dom);
            index++;

            processedThisSlice++;
            if (
                processedThisSlice >= PLAYER_EVENT_SCRIPT_BATCH_SIZE ||
                nowForPlayerEventStartup() - sliceStart >= PLAYER_EVENT_SCRIPT_FRAME_BUDGET_MS
            ) {
                await yieldPlayerEventStartupToPaint();
                sliceStart = nowForPlayerEventStartup();
                processedThisSlice = 0;
            }
        }

        return Promise.resolve();
    }

    createScriptEvent(script, scene, camera, renderer, THREE, ammo) {
        const factory = getCachedScriptEventFactory(script?.source || "");
        return factory.call(
            scene,
            this.app,
            scene,
            camera,
            renderer,
            THREE,
            ammo,
            EventBus,
            this.gameManager,
            this.physics,
            Ajax,
        );
    }

    registerScriptEvent(event, index, dom) {
        if (typeof event.init === "function") {
            this.initHandlers.push(event);
        }
        if (typeof event.start === "function") {
            this.startHandlers.push(event);
        }
        if (typeof event.update === "function") {
            this.updateHandlers.push(event);
        }
        if (typeof event.stop === "function") {
            this.stopHandlers.push(event);
        }

        const handlers = {};

        if (typeof event.onClick === "function") {
            handlers.onClick = event.onClick.bind(this.scene);
            dom.addEventListener("click", handlers.onClick);
        }
        if (typeof event.onDblClick === "function") {
            handlers.onDblClick = event.onDblClick.bind(this.scene);
            dom.addEventListener("dblclick", handlers.onDblClick);
        }
        //MISHA - key event listeners shouyld be added to the document
        if (typeof event.onKeyDown === "function") {
            handlers.onKeyDown = event.onKeyDown.bind(this.scene);
            document.addEventListener("keydown", handlers.onKeyDown);
        }
        if (typeof event.onKeyUp === "function") {
            handlers.onKeyUp = event.onKeyUp.bind(this.scene);
            document.addEventListener("keyup", handlers.onKeyUp);
        }
        if (typeof event.onMouseDown === "function") {
            handlers.onMouseDown = event.onMouseDown.bind(this.scene);
            dom.addEventListener("mousedown", handlers.onMouseDown);
        }
        if (typeof event.onMouseMove === "function") {
            handlers.onMouseMove = event.onMouseMove.bind(this.scene);
            dom.addEventListener("mousemove", handlers.onMouseMove);
        }
        if (typeof event.onMouseUp === "function") {
            handlers.onMouseUp = event.onMouseUp.bind(this.scene);
            dom.addEventListener("mouseup", handlers.onMouseUp);
        }
        if (typeof event.onMouseWheel === "function") {
            handlers.onMouseWheel = event.onMouseWheel.bind(this.scene);
            dom.addEventListener("mousewheel", handlers.onMouseWheel);
        }
        if (typeof event.onTouchStart === "function") {
            handlers.onTouchStart = event.onTouchStart.bind(this.scene);
            dom.addEventListener("touchstart", handlers.onTouchStart);
        }
        if (typeof event.onTouchEnd === "function") {
            handlers.onTouchEnd = event.onTouchEnd.bind(this.scene);
            dom.addEventListener("touchend", handlers.onTouchEnd);
        }
        if (typeof event.onTouchMove === "function") {
            handlers.onTouchMove = event.onTouchMove.bind(this.scene);
            dom.addEventListener("touchmove", handlers.onTouchMove);
        }
        if (typeof event.onResize === "function") {
            handlers.onResize = event.onResize.bind(this.scene);
            window.addEventListener("resize", handlers.onResize);
        }

        // Store handlers for removal later
        this.boundEventHandlers.push({script: event, handlers, index});
        if (typeof event.onVRConnected === "function") {
            this.app.on(`vrConnected.${this.id}-${index}`, event.onVRConnected.bind(this.scene));
        }
        if (typeof event.onVRDisconnected === "function") {
            this.app.on(`vrDisconnected.${this.id}-${index}`, event.onVRDisconnected.bind(this.scene));
        }
        if (typeof event.onVRSelectStart === "function") {
            this.app.on(`vrSelectStart.${this.id}-${index}`, event.onVRSelectStart.bind(this.scene));
        }
        if (typeof event.onVRSelectEnd === "function") {
            this.app.on(`vrSelectEnd.${this.id}-${index}`, event.onVRSelectEnd.bind(this.scene));
        }
    }

    init() {
        const handlers = this.initHandlers;
        for (let i = 0; i < handlers.length; i++) {
            handlers[i].init();
        }
    }

    start() {
        const handlers = this.startHandlers;
        for (let i = 0; i < handlers.length; i++) {
            handlers[i].start();
        }
    }

    update(clock, deltaTime) {
        const handlers = this.updateHandlers;
        for (let i = 0; i < handlers.length; i++) {
            handlers[i].update(clock, deltaTime);
        }
    }

    stop() {
        const handlers = this.stopHandlers;
        for (let i = 0; i < handlers.length; i++) {
            handlers[i].stop();
        }
    }

    dispose() {
        const dom = this.renderer?.domElement;
        if (!dom || !this.boundEventHandlers) return;

        this.boundEventHandlers.forEach(({handlers}) => {
            if (handlers.onClick) {
                dom.removeEventListener("click", handlers.onClick);
            }
            if (handlers.onDblClick) {
                dom.removeEventListener("dblclick", handlers.onDblClick);
            }
            if (handlers.onKeyDown) {
                document.removeEventListener("keydown", handlers.onKeyDown);
            }
            if (handlers.onKeyUp) {
                document.removeEventListener("keyup", handlers.onKeyUp);
            }
            if (handlers.onMouseDown) {
                dom.removeEventListener("mousedown", handlers.onMouseDown);
            }
            if (handlers.onMouseMove) {
                dom.removeEventListener("mousemove", handlers.onMouseMove);
            }
            if (handlers.onMouseUp) {
                dom.removeEventListener("mouseup", handlers.onMouseUp);
            }
            if (handlers.onMouseWheel) {
                dom.removeEventListener("mousewheel", handlers.onMouseWheel);
            }
            if (handlers.onTouchStart) {
                dom.removeEventListener("touchstart", handlers.onTouchStart);
            }
            if (handlers.onTouchEnd) {
                dom.removeEventListener("touchend", handlers.onTouchEnd);
            }
            if (handlers.onTouchMove) {
                dom.removeEventListener("touchmove", handlers.onTouchMove);
            }
            if (handlers.onResize) {
                window.removeEventListener("resize", handlers.onResize);
            }
        });

        // Clear the bound handlers array
        this.boundEventHandlers = [];
        this.initHandlers = [];
        this.startHandlers = [];
        this.updateHandlers = [];
        this.stopHandlers = [];

        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.scripts = null;
        this.events.length = 0;
    }
}

export default PlayerEvent;
