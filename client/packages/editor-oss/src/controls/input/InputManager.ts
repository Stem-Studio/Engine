import {InputProvider} from "./InputProvider";
import {DetectDevice} from "@stem/editor-oss/utils/DetectDevice";

export enum TriggerType {
    Keyboard = "/keyboard/",
    MouseClick = "/mouse/click/",
    MouseMove = "/mouse/move/",
    GamepadButton = "/gamepad/button/",
    GamepadAxis = "/gamepad/axis/",
    VirtualButton = "/virtual/button/",
    VirtualAxis = "/virtual/axis/",
}

type Action = string;
type Motion = string;
type Trigger = string;

function normalizeRawKeyboardAction(actionId: Action): string | null {
    if (typeof actionId !== "string") return null;
    const value = actionId.trim();
    if (/^Key[A-Z]$/i.test(value)) return `Key${value.slice(3).toUpperCase()}`;
    if (/^[a-z]$/i.test(value)) return `Key${value.toUpperCase()}`;
    if (/^(Arrow(?:Up|Down|Left|Right)|Space|Enter|Escape|Tab|Backspace|Shift(?:Left|Right)|Control(?:Left|Right)|Alt(?:Left|Right)|Meta(?:Left|Right)|Digit[0-9]|Numpad\w+)$/i.test(value)) {
        return value;
    }
    return null;
}

class ActionBinding {
    name: Action;

    constructor(name: Action) {
        this.name = name;
    }
}

class MotionBinding {
    name: Motion;
    scale: number;

    constructor(name: Motion, scale?: number) {
        this.name = name;
        this.scale = scale ?? 1;
    }
}

class MotionState {
    name: Motion;
    value: number;
    delta: number;

    constructor(name: Motion, value: number, delta: number) {
        this.name = name;
        this.value = value;
        this.delta = delta;
    }
}

export class Bindings<ActionsAndMotions extends string> {
    actions = new Map<Trigger, ActionBinding[]>();
    motions = new Map<Trigger, MotionBinding[]>();
    debounceFlags = new Map<Trigger, boolean>(); // tracks which triggers should use debounce

    bindKey(code: string, useDebounce: boolean = false) {
        const trigger = TriggerType.Keyboard + code;
        if (useDebounce) {
            this.debounceFlags.set(trigger, true);
        }
        return {
            toAction: (name: ActionsAndMotions) => {
                const b = new ActionBinding(name);
                let actions = this.actions.get(trigger);
                if (!actions) {
                    actions = [];
                    this.actions.set(trigger, actions);
                }
                actions.push(b);
            },
            toMotion: (name: ActionsAndMotions, scale?: number) => {
                const b = new MotionBinding(name, scale);
                let motions = this.motions.get(trigger);
                if (!motions) {
                    motions = [];
                    this.motions.set(trigger, motions);
                }
                motions.push(b);
            },
        };
    }

    bindMouseClick(button: number) {
        const trigger = TriggerType.MouseClick + button;
        return {
            toAction: (name: ActionsAndMotions) => {
                const b = new ActionBinding(name);
                let actions = this.actions.get(trigger);
                if (!actions) {
                    actions = [];
                    this.actions.set(trigger, actions);
                }
                actions.push(b);
            },
            toMotion: (name: ActionsAndMotions, scale?: number) => {
                const b = new MotionBinding(name, scale);
                let motions = this.motions.get(trigger);
                if (!motions) {
                    motions = [];
                    this.motions.set(trigger, motions);
                }
                motions.push(b);
            },
        };
    }

    bindMouseMove(axis: "x" | "y") {
        const trigger = TriggerType.MouseMove + axis;
        return {
            toMotion: (name: ActionsAndMotions, scale?: number) => {
                const b = new MotionBinding(name, scale);
                let motions = this.motions.get(trigger);
                if (!motions) {
                    motions = [];
                    this.motions.set(trigger, motions);
                }
                motions.push(b);
            },
        };
    }

    bindGamepadButton(buttonIndex: number) {
        const trigger = TriggerType.GamepadButton + buttonIndex;
        return {
            toAction: (name: ActionsAndMotions) => {
                const b = new ActionBinding(name);
                let actions = this.actions.get(trigger);
                if (!actions) {
                    actions = [];
                    this.actions.set(trigger, actions);
                }
                actions.push(b);
            },
            toMotion: (name: ActionsAndMotions, scale?: number) => {
                const b = new MotionBinding(name, scale);
                let motions = this.motions.get(trigger);
                if (!motions) {
                    motions = [];
                    this.motions.set(trigger, motions);
                }
                motions.push(b);
            },
        };
    }

    bindGamepadAxis(axisIndex: number) {
        const trigger = TriggerType.GamepadAxis + axisIndex;
        return {
            toMotion: (name: ActionsAndMotions, scale?: number) => {
                const b = new MotionBinding(name, scale);
                let motions = this.motions.get(trigger);
                if (!motions) {
                    motions = [];
                    this.motions.set(trigger, motions);
                }
                motions.push(b);
            },
        };
    }

    bindVirtualButton(name: string) {
        const trigger = TriggerType.VirtualButton + name;
        return {
            toAction: (actionName: ActionsAndMotions) => {
                const b = new ActionBinding(actionName);
                let actions = this.actions.get(trigger);
                if (!actions) {
                    actions = [];
                    this.actions.set(trigger, actions);
                }
                actions.push(b);
            },
            toMotion: (motionName: ActionsAndMotions, scale?: number) => {
                const b = new MotionBinding(motionName, scale);
                let motions = this.motions.get(trigger);
                if (!motions) {
                    motions = [];
                    this.motions.set(trigger, motions);
                }
                motions.push(b);
            },
        };
    }

    bindVirtualAxis(name: string, axis: "x" | "y") {
        const trigger = TriggerType.VirtualAxis + name + "/" + axis;
        return {
            toMotion: (motionName: ActionsAndMotions, scale?: number) => {
                const b = new MotionBinding(motionName, scale);
                let motions = this.motions.get(trigger);
                if (!motions) {
                    motions = [];
                    this.motions.set(trigger, motions);
                }
                motions.push(b);
            },
        };
    }
}

export class InputManager<ActionsAndMotions extends string> implements InputProvider<ActionsAndMotions> {
    private bindings: Bindings<ActionsAndMotions>;
    private actions = new Map<Action, boolean>();
    private motions = new Map<Motion, MotionState>();
    private attachedEventTarget: EventTarget | null = null;
    private onDetachFns: (() => void)[] = [];
    private isAttached = false;
    private downKeys = new Set<string>();
    private heldPressTriggers = new Set<Trigger>();
    private activeTriggers = new Set<string>();
    private triggerValues = new Map<string, number>(); // Store values for each trigger
    private virtualDispatcher = new VirtualInputDispatcher();

    private readonly releaseDebounceMs = 30; // 20–40 ms is a good range
    private releaseDebounceTimers = new Map<Trigger, number>(); // trigger -> timeoutId

    // Input State Timeout - Industry standard solution for stuck inputs
    private readonly INPUT_TIMEOUT_MS = 200; // Actions timeout after 200ms without refresh
    private readonly MAX_DELTA_PER_EVENT = 1000; // Max delta per mouse/touch event
    private inputTimestamps = new Map<Trigger, number>(); // trigger -> last update timestamp
    private stuckTriggersScratch: Trigger[] = [];

    private mouseX: number = 0;
    private mouseY: number = 0;
    private movementX: number = 0;
    private movementY: number = 0;

    // Gamepad support
    private gamepadIndex: number = -1;
    private readonly GAMEPAD_DEADZONE = 0.15;
    private gamepadButtonStates = new Map<number, boolean>();
    private gamepadButtonTriggerCache: Trigger[] = [];
    private gamepadAxisTriggerCache: Trigger[] = [];

    constructor(bindings: Bindings<ActionsAndMotions>, eventTarget: EventTarget) {
        this.bindings = bindings;
        this.attachedEventTarget = eventTarget;
        this.initInputMaps();
    }

    setBindings(bindings: Bindings<ActionsAndMotions>) {
        this.bindings = bindings;
        this.initInputMaps();
    }

    /**
     * Set action and motion bindings from provided maps.
     * @param actions - key is the key code, value is the actionId, debounce is optional
     * @param motions - key is the key code, value is the motionId and scale, debounce is optional
     */
    setBindingFromMaps(actions: Map<string, {name: string, debounce: boolean}> = new Map(), motions: Map<string, {name: string, scale: number, debounce: boolean}> = new Map()) {
        const bindings = new Bindings<string>();

        //user's key bindings
        actions.forEach((action, key) =>
            bindings.bindKey(key, action.debounce).toAction(action.name));
        motions.forEach((action, key) =>
            bindings.bindKey(key, action.debounce).toMotion(action.name, action.scale));

        //default mouse bindings
        bindings.bindMouseClick(0).toAction("primary");
        bindings.bindMouseClick(2).toAction("secondary");
        bindings.bindMouseMove("x").toMotion("view_x", 1);
        bindings.bindMouseMove("y").toMotion("view_y", 1);

        this.setBindings(bindings);
    }

    /**
     *  Returns true if the action is currently active, false otherwise.      * @param actionId
     * @param actionId
     */
    getAction(actionId: Action): boolean {
        const boundState = this.actions.get(actionId);
        if (boundState === true) return true;
        const virtualState = this.virtualDispatcher.getButtonState(actionId);
        if (virtualState !== undefined) return virtualState;
        if (boundState !== undefined) return boundState;

        // Behaviors sometimes use a raw keyboard shorthand for lightweight
        // UI toggles (for example `getAction("h")`) instead of registering a
        // gameplay action. Preserve named-action semantics above, then fall
        // back to the browser's stable `KeyboardEvent.code` representation.
        // This keeps unbound keys useful without making a key masquerade as a
        // bound action when that action is explicitly released.
        const keyCode = normalizeRawKeyboardAction(actionId);
        return keyCode ? this.downKeys.has(keyCode) : false;
    }

    /**
     * Returns 0 if motion doesn't exist, otherwise returns the combined scale value.      * @param motionId
     * @param motionId
     */
    getMotion(motionId: Motion): number {
        const motion = this.motions.get(motionId);
        const value = motion ? motion.value + motion.delta : 0;
        return value;
    }

    getVirtualDispatcher(): VirtualInputDispatcher {
        return this.virtualDispatcher;
    }

    /** Updated Mouse Touch Position Handling */
    getMouseTouchPosition() {
        if (document.pointerLockElement) {
            return {x: this.movementX, y: this.movementY, isRelative: true};
        } else {
            return {x: this.mouseX, y: this.mouseY, isRelative: false};
        }
    }

    pause() {
        this.detach();
    }

    resume() {
        this.attach();
    }

    attach() {
        if (this.isAttached) return;
        this.isAttached = true;
        this.downKeys.clear();
        this.attachVirtual();

        /** Window Focus Handling */
        this.listen("blur", () => {
            this.clearAllInputStates();
        }, window);

        /** Visibility API - More reliable than blur for tab switching */
        this.listen("visibilitychange", () => {
            if (document.hidden) {
                this.clearAllInputStates();
            }
        }, document);

        /** Keyboard Input Handling */
        this.listen("keydown", (event: KeyboardEvent) => {
            // NOTE: we ignore metaKey here because there are no keyup events if Command is pressed.
            const isApple = ["macOS", "iOS"].includes(DetectDevice.getOS());
            if (event.metaKey && isApple) return;

            if (this.downKeys.has(event.code)) return;
            this.downKeys.add(event.code);
            const trigger = TriggerType.Keyboard + event.code;

            // if there was a delayed release — cancel it
            const pending = this.releaseDebounceTimers.get(trigger);
            if (pending) {
                clearTimeout(pending);
                this.releaseDebounceTimers.delete(trigger);
            }

            this.markTriggerHeld(trigger, true);

            this.setActionState(trigger, true);
            this.setMotionState(trigger, true);
        });

        this.listen("keyup", (event: KeyboardEvent) => {
            if (!this.downKeys.has(event.code)) return;
            this.downKeys.delete(event.code);
            const trigger = TriggerType.Keyboard + event.code;
            this.markTriggerHeld(trigger, false);

            // Release action immediately (no delay)
            this.setActionState(trigger, false);

            // For keyboard motions — delayed release,
            // only if debounce is enabled for this specific trigger and there are motion bindings
            const shouldUseDebounce = this.bindings.debounceFlags.get(trigger) ?? false;
            if (this.releaseDebounceMs > 0 && shouldUseDebounce && this.bindings.motions.has(trigger)) {
                const existing = this.releaseDebounceTimers.get(trigger);
                if (existing) {
                    clearTimeout(existing);
                }

                const timeoutId = window.setTimeout(() => {
                    this.releaseDebounceTimers.delete(trigger);
                    this.setMotionState(trigger, false);
                }, this.releaseDebounceMs);

                this.releaseDebounceTimers.set(trigger, timeoutId);
            } else {
                // immediate release for keys without debounce
                this.setMotionState(trigger, false);
            }
        });

        /** Mouse Input Handling */
        this.listen("mousedown", (event: MouseEvent) => {
            const trigger = TriggerType.MouseClick + event.button;
            this.markTriggerHeld(trigger, true);
            this.setActionState(trigger, true);
            this.setMotionState(trigger, true);
        });

        this.listen("mouseup", (event: MouseEvent) => {
            const trigger = TriggerType.MouseClick + event.button;
            this.markTriggerHeld(trigger, false);
            this.setActionState(trigger, false);
            this.setMotionState(trigger, false);
        });

        this.listen("mousemove", (event: MouseEvent) => {
            const triggerX = TriggerType.MouseMove + "x";
            const triggerY = TriggerType.MouseMove + "y";

            if (document.pointerLockElement) {
                // Pointer lock mode - use movement deltas
                this.movementX = event.movementX;
                this.movementY = event.movementY;
            } else {
                // Normal mode - Calculate movement manually
                this.movementX = event.clientX - this.mouseX;
                this.movementY = event.clientY - this.mouseY;

                this.mouseX = event.clientX;
                this.mouseY = event.clientY;
            }

            // Apply movement to motion states
            this.addMotionDelta(triggerX, this.movementX);
            this.addMotionDelta(triggerY, this.movementY);
        });

        /** Touch Input Handling */
        this.listen("touchstart", (event: TouchEvent) => {
            if (this.shouldPreventTouchDefault(event)) {
                event.preventDefault?.(); // Prevent default touch behaviors (scroll, zoom)
            }

            for (let i = 0; i < event.changedTouches.length; i++) {
                const touch = event.changedTouches[i];
                if (!touch) continue;
                const trigger = TriggerType.MouseClick + touch.identifier;
                this.markTriggerHeld(trigger, true);
                this.setActionState(trigger, true);
                this.setMotionState(trigger, true);
                if (i === 0) {
                    this.mouseX = touch.clientX;
                    this.mouseY = touch.clientY;
                }
            }
        });

        this.listen("touchmove", (event: TouchEvent) => {
            if (this.shouldPreventTouchDefault(event)) {
                event.preventDefault?.(); // Prevent scrolling during touch movement
            }
            const touch = event.changedTouches[0];
            if (!touch) return;
            const triggerX = TriggerType.MouseMove + "x";
            const triggerY = TriggerType.MouseMove + "y";

            this.addMotionDelta(triggerX, touch.clientX - this.mouseX);
            this.addMotionDelta(triggerY, touch.clientY - this.mouseY);

            this.mouseX = touch.clientX;
            this.mouseY = touch.clientY;
        });

        this.listen("touchend", (event: TouchEvent) => {
            this.releaseChangedTouches(event);
        });

        // A touch can leave the viewport, be interrupted by the browser, or be
        // cancelled by a competing gesture without producing touchend. Treat
        // cancellation as release so gameplay actions and virtual overlays can
        // never remain latched after a lost contact.
        this.listen("touchcancel", (event: TouchEvent) => {
            this.releaseChangedTouches(event);
        });

        /** Gamepad Input Handling */
        this.listen("gamepadconnected", (event: GamepadEvent) => {
            this.gamepadIndex = event.gamepad.index;
        }, window);

        this.listen("gamepaddisconnected", (event: GamepadEvent) => {
            if (event.gamepad.index === this.gamepadIndex) {
                this.clearGamepadState();
                this.gamepadIndex = -1;
            }
        }, window);
    }

    detach() {
        if (!this.isAttached && this.onDetachFns.length === 0) {
            this.clearAllInputStates();
            return;
        }
        this.isAttached = false;
        this.onDetachFns.forEach(fn => fn());
        this.onDetachFns = [];
        this.virtualDispatcher.clearListeners();
        this.clearAllInputStates();
    }

    private clearAllInputStates() {
        // Clear all debounce timers
        for (const id of this.releaseDebounceTimers.values()) {
            clearTimeout(id);
        }
        this.releaseDebounceTimers.clear();

        // Clear all input timestamps
        this.inputTimestamps.clear();

        // Clear all pressed keys
        for (const keyCode of this.downKeys) {
            const trigger = TriggerType.Keyboard + keyCode;
            this.setActionState(trigger, false);
            this.setMotionState(trigger, false);
        }
        this.downKeys.clear();

        // Reset input state for pause/resume feature
        for (const key of this.actions.keys()) {
            this.actions.set(key, false);
        }
        for (const motionList of this.bindings.motions.values()) {
            for (const motion of motionList) {
                const state = this.motions.get(motion.name);
                if (state) {
                    state.value = 0;
                    state.delta = 0;
                }
            }
        }

        this.activeTriggers.clear();
        this.triggerValues.clear();
        this.heldPressTriggers.clear();

        // Clear gamepad state
        this.clearGamepadState();
    }

    private attachVirtual() {
        for (const [trigger] of this.bindings.actions) {
            if (!trigger.startsWith(TriggerType.VirtualButton)) continue;
            const name = trigger.slice(TriggerType.VirtualButton.length);
            this.virtualDispatcher.setButtonListener(name, (pressed) => {
                this.markTriggerHeld(trigger, pressed);
                this.setActionState(trigger, pressed);
                this.setMotionState(trigger, pressed);
            });
        }

        const axisNames = new Set<string>();
        for (const [trigger] of this.bindings.motions) {
            if (!trigger.startsWith(TriggerType.VirtualAxis)) continue;
            const nameAxis = trigger.slice(TriggerType.VirtualAxis.length); // "name/x" or "name/y"
            const [name] = nameAxis.split("/");
            if (name) {
                axisNames.add(name);
            }
        }

        for (const axisName of axisNames) {
            this.virtualDispatcher.setAxisListener(axisName, ({ x, y }) => {
                const xTrigger = TriggerType.VirtualAxis + axisName + "/x";
                const yTrigger = TriggerType.VirtualAxis + axisName + "/y";

                this.setMotionState(xTrigger, x !== 0, x);
                this.setMotionState(yTrigger, y !== 0, y);
            });
        }
    }

    private setActionState(actionId: string, active: boolean) {
        const actionsList = this.bindings.actions.get(actionId);
        if (!actionsList) return;

        if (active) {
            // Update timestamp when activating
            this.inputTimestamps.set(actionId, performance.now());
        } else {
            // Clear timestamp when deactivating
            this.inputTimestamps.delete(actionId);
        }

        for (const action of actionsList) {
            this.actions.set(action.name, active);
        }
    }

    private shouldPreventTouchDefault(event: TouchEvent): boolean {
        const target = event.target;
        const attached = this.attachedEventTarget;
        if (!target || !attached) return false;
        if (target === attached) return true;

        // Game input is normally attached to `document` or a viewport root,
        // while touches land on a canvas/UI descendant. Use containment so the
        // browser cannot steal those gestures for scroll or pinch handling.
        try {
            const contains = (attached as EventTarget & {contains?: (node: unknown) => boolean}).contains;
            return typeof contains === "function" && contains.call(attached, target);
        } catch {
            return false;
        }
    }

    private releaseChangedTouches(event: TouchEvent): void {
        if (this.shouldPreventTouchDefault(event)) {
            event.preventDefault?.();
        }

        for (let i = 0; i < event.changedTouches.length; i++) {
            const touch = event.changedTouches[i];
            if (!touch) continue;
            const trigger = TriggerType.MouseClick + touch.identifier;
            this.markTriggerHeld(trigger, false);
            this.setActionState(trigger, false);
            this.setMotionState(trigger, false);
        }
    }

    private setMotionState(motionId: string, active: boolean, value: number = 1) {
        if (active) {
            this.activeTriggers.add(motionId);
            this.triggerValues.set(motionId, value);
        } else {
            this.activeTriggers.delete(motionId);
            this.triggerValues.delete(motionId);
        }

        // Reset all motion values to 0
        for (const motion of this.motions.values()) {
            motion.value = 0;
        }

        for (const trigger of this.activeTriggers) {
            const triggerValue = this.triggerValues.get(trigger) ?? 1;
            for (const binding of this.bindings.motions.get(trigger) || []) {
                const state = this.motions.get(binding.name);
                if (state) {
                    state.value += triggerValue * binding.scale;
                }
            }
        }
    }

    private markTriggerHeld(trigger: Trigger, active: boolean) {
        if (active) {
            this.heldPressTriggers.add(trigger);

            if (this.bindings.actions.has(trigger) || this.bindings.motions.has(trigger)) {
                this.inputTimestamps.set(trigger, performance.now());
            }
            return;
        }

        this.heldPressTriggers.delete(trigger);
        this.inputTimestamps.delete(trigger);
    }

    private addMotionDelta(motionId: string, delta: number) {
        const motionsList = this.bindings.motions.get(motionId);
        if (!motionsList || motionsList.length === 0) return;

        const clampedDelta = Math.max(-this.MAX_DELTA_PER_EVENT, Math.min(this.MAX_DELTA_PER_EVENT, delta));

        for (const motion of motionsList) {
            const state = this.motions.get(motion.name);
            if (state) {
                state.delta += clampedDelta * motion.scale;
            }
        }
    }

    private initInputMaps() {
        this.actions.clear();
        for (const binding of this.bindings.actions.values()) {
            binding.forEach(action => {
                this.actions.set(action.name, false);
            });
        }

        this.motions.clear();
        for (const binding of this.bindings.motions.values()) {
            binding.forEach(motion => {
                this.motions.set(motion.name, new MotionState(motion.name, 0, 0));
            });
        }
    }

    update() {
        //NOTICE: this code below is wrong - behaviors should zero delta once it's consumed
        // Clear per-frame motion deltas
        // for (const state of this.motions.values()) {
        //     state.delta = 0;
        // }
        // Poll gamepad state
        this.pollGamepad();
        // Input State Timeout - automatically clear stuck inputs
        this.clearStuckInputs();
    }

    private pollGamepad() {
        if (typeof navigator === "undefined" || !navigator.getGamepads) return;

        const gamepads = navigator.getGamepads();

        // If no gamepad connected, try to find one
        if (this.gamepadIndex === -1) {
            for (let i = 0; i < gamepads.length; i++) {
                if (gamepads[i]) {
                    this.gamepadIndex = i;
                    break;
                }
            }
            if (this.gamepadIndex === -1) return;
        }

        const gamepad = gamepads[this.gamepadIndex];
        if (!gamepad) return;

        // Poll buttons — edge detection
        for (let i = 0; i < gamepad.buttons.length; i++) {
            const button = gamepad.buttons[i];
            if (!button) continue;
            const pressed = button.pressed;
            const wasPressed = this.gamepadButtonStates.get(i) ?? false;
            if (pressed !== wasPressed) {
                this.gamepadButtonStates.set(i, pressed);
                const trigger = this.getGamepadButtonTrigger(i);
                this.markTriggerHeld(trigger, pressed);
                this.setActionState(trigger, pressed);
                this.setMotionState(trigger, pressed);
            }
        }

        // Poll axes — apply deadzone
        for (let i = 0; i < gamepad.axes.length; i++) {
            const raw = gamepad.axes[i] ?? 0;
            const value = Math.abs(raw) < this.GAMEPAD_DEADZONE ? 0 : raw;
            const trigger = this.getGamepadAxisTrigger(i);
            this.setGamepadAxisState(trigger, value);
        }
    }

    private getGamepadButtonTrigger(buttonIndex: number): Trigger {
        return this.gamepadButtonTriggerCache[buttonIndex] ??= TriggerType.GamepadButton + buttonIndex;
    }

    private getGamepadAxisTrigger(axisIndex: number): Trigger {
        return this.gamepadAxisTriggerCache[axisIndex] ??= TriggerType.GamepadAxis + axisIndex;
    }

    private setGamepadAxisState(trigger: Trigger, value: number): void {
        const active = value !== 0;
        const wasActive = this.activeTriggers.has(trigger);
        if (wasActive === active && (!active || this.triggerValues.get(trigger) === value)) {
            return;
        }
        this.setMotionState(trigger, active, value);
    }

    private clearGamepadState() {
        for (const [buttonIndex] of this.gamepadButtonStates) {
            const trigger = this.getGamepadButtonTrigger(buttonIndex);
            this.setActionState(trigger, false);
            this.setMotionState(trigger, false);
        }
        this.gamepadButtonStates.clear();

        // Clear all gamepad axis triggers
        for (const trigger of this.activeTriggers) {
            if (trigger.startsWith(TriggerType.GamepadAxis)) {
                this.setMotionState(trigger, false);
            }
        }
    }

    private clearStuckInputs() {
        if (this.inputTimestamps.size === 0) {
            return;
        }

        const now = performance.now();
        const stuckTriggers = this.stuckTriggersScratch;
        stuckTriggers.length = 0;

        for (const [trigger, timestamp] of this.inputTimestamps.entries()) {
            if (this.isTriggerHeld(trigger)) {
                this.inputTimestamps.set(trigger, now);
                continue;
            }

            // Only clear if timeout exceeded and input is not actively held
            if (now - timestamp > this.INPUT_TIMEOUT_MS) {
                stuckTriggers.push(trigger);
            }
        }

        // Clear all stuck inputs
        for (const trigger of stuckTriggers) {
            console.debug(`[InputManager] Auto-clearing stuck input: ${trigger} (timeout: ${this.INPUT_TIMEOUT_MS}ms)`);

            this.setActionState(trigger, false);
            this.setMotionState(trigger, false);

            // Also remove from downKeys if it's a keyboard input
            if (trigger.startsWith(TriggerType.Keyboard)) {
                const keyCode = trigger.slice(TriggerType.Keyboard.length);
                this.downKeys.delete(keyCode);
            }
        }
        stuckTriggers.length = 0;
    }

    private isTriggerHeld(trigger: Trigger) {
        if (trigger.startsWith(TriggerType.Keyboard)) {
            const keyCode = trigger.slice(TriggerType.Keyboard.length);
            return this.downKeys.has(keyCode);
        }

        return this.heldPressTriggers.has(trigger);
    }

    dispose() {
        this.detach();
        this.attachedEventTarget = null;
        this.actions.clear();
        this.motions.clear();
    }

    private listen(name: string, listener: (event: any) => void, target?: EventTarget) {
        const eventTarget = target || this.attachedEventTarget;
        if (eventTarget) {
            eventTarget.addEventListener(name, listener);
            this.onDetachFns.push(() => {
                eventTarget.removeEventListener(name, listener);
            });
        }
    }
}

// TODO: rewrite to axis and buttons
export class VirtualInputDispatcher {
    private listeners: Map<string, (data?: any) => void> = new Map();
    private buttonStates: Map<string, boolean> = new Map();
    private axisStates: Map<string, {x: number; y: number}> = new Map();

    constructor() {}

    setAxisListener(name: string, listener: (data: {x: number; y: number}) => void) {
        this.listeners.set(name, listener);
        const state = this.axisStates.get(name);
        if (state) {
            listener(state);
        }
    }

    setButtonListener(name: string, listener: (data: boolean) => void) {
        this.listeners.set(name, listener);
        const state = this.buttonStates.get(name);
        if (state !== undefined) {
            listener(state);
        }
    }

    dispatchAxis(name: string, data: {x: number; y: number}) {
        this.axisStates.set(name, data);
        const listener = this.listeners.get(name);
        if (listener) {
            listener(data);
        }
    }

    dispatchButton(name: string, data: boolean) {
        this.buttonStates.set(name, data);
        const listener = this.listeners.get(name);
        if (listener) {
            listener(data);
        }
    }

    getButtonState(name: string): boolean | undefined {
        return this.buttonStates.get(name);
    }

    clearListeners() {
        this.listeners.clear();
        this.buttonStates.clear();
        this.axisStates.clear();
    }
}
