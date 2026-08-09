/**
 * Unit tests for InputManager
 * Tests keyboard, mouse, touch, virtual inputs, debounce, and Input State Timeout mechanism
 */

import { defaultBindings } from "./DefaultBindings";
import { InputManager, Bindings, TriggerType } from "./InputManager";

type TestActions = "jump" | "run" | "crouch" | "use" | "reload" | "forward" | "lateral" | "steer";

// Mock DetectDevice
vi.mock("../../../utils/DetectDevice", () => ({
    DetectDevice: {
        getOS: () => "Windows",
    },
}));

// Mock DOM elements
class MockEventTarget {
    private listeners = new Map<string, ((event: any) => void)[]>();

    addEventListener(event: string, handler: (event: any) => void) {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, []);
        }
        this.listeners.get(event)!.push(handler);
    }

    removeEventListener(event: string, handler: (event: any) => void) {
        const handlers = this.listeners.get(event);
        if (handlers) {
            const index = handlers.indexOf(handler);
            if (index !== -1) {
                handlers.splice(index, 1);
            }
        }
    }

    dispatchEvent(event: Event): boolean {
        const handlers = this.listeners.get(event.type);
        if (handlers) {
            handlers.forEach(handler => handler(event));
        }
        return true;
    }

    // Helper to trigger events
    trigger(eventType: string, eventInit: any = {}) {
        const event = { type: eventType, ...eventInit };
        const handlers = this.listeners.get(eventType);
        if (handlers) {
            handlers.forEach(handler => handler(event));
        }
    }
}

describe("InputManager", () => {
    let inputManager: InputManager<TestActions>;
    let bindings: Bindings<TestActions>;
    let eventTarget: MockEventTarget;

    beforeEach(() => {
        eventTarget = new MockEventTarget();
        bindings = new Bindings<TestActions>();
        
        // Setup basic bindings
        bindings.bindKey("Space").toAction("jump");
        bindings.bindKey("ShiftLeft").toAction("run");
        bindings.bindKey("ControlLeft").toAction("crouch");
        bindings.bindKey("KeyE").toAction("use");
        bindings.bindKey("KeyR").toAction("reload");
        
        bindings.bindKey("KeyW", true).toMotion("forward", 1);
        bindings.bindKey("KeyS", true).toMotion("forward", -1);
        bindings.bindKey("KeyA", true).toMotion("lateral", -1);
        bindings.bindKey("KeyD", true).toMotion("lateral", 1);

        inputManager = new InputManager(bindings, eventTarget);
    });

    afterEach(() => {
        inputManager.dispose();
        vi.clearAllTimers();
    });

    describe("Keyboard Input", () => {
        it("does not read performance time when there are no timestamped inputs to clear", () => {
            const nowSpy = vi.spyOn(performance, "now");

            inputManager.update();

            expect(nowSpy).not.toHaveBeenCalled();
            nowSpy.mockRestore();
        });

        it("reuses the stuck input scratch list while clearing timed-out inputs", () => {
            const trigger = TriggerType.Keyboard + "Space";
            const internals = inputManager as unknown as {
                inputTimestamps: Map<string, number>;
                stuckTriggersScratch: string[];
            };
            const scratch: string[] = [];
            internals.inputTimestamps.set(trigger, 0);
            internals.stuckTriggersScratch = scratch;
            const nowSpy = vi.spyOn(performance, "now").mockReturnValue(250);

            inputManager.update();

            expect(inputManager.getAction("jump")).toBe(false);
            expect(internals.inputTimestamps.has(trigger)).toBe(false);
            expect(internals.stuckTriggersScratch).toBe(scratch);
            expect(scratch).toHaveLength(0);
            nowSpy.mockRestore();
        });

        it("should detect key press", () => {
            inputManager.attach();

            eventTarget.trigger("keydown", { code: "Space" });

            expect(inputManager.getAction("jump")).toBe(true);
        });

        it("should detect key release", () => {
            inputManager.attach();

            eventTarget.trigger("keydown", { code: "Space" });
            expect(inputManager.getAction("jump")).toBe(true);

            eventTarget.trigger("keyup", { code: "Space" });
            expect(inputManager.getAction("jump")).toBe(false);
        });

        it("supports raw key shorthand actions for behavior-local toggles", () => {
            inputManager.attach();

            eventTarget.trigger("keydown", { code: "KeyH" });
            expect(inputManager.getAction("h" as TestActions)).toBe(true);
            expect(inputManager.getAction("KeyH" as TestActions)).toBe(true);

            eventTarget.trigger("keyup", { code: "KeyH" });
            expect(inputManager.getAction("h" as TestActions)).toBe(false);
        });

        it("does not duplicate listeners when attach is called repeatedly", () => {
            inputManager.attach();
            inputManager.attach();

            eventTarget.trigger("keydown", { code: "Space" });
            expect(inputManager.getAction("jump")).toBe(true);

            eventTarget.trigger("keyup", { code: "Space" });
            expect(inputManager.getAction("jump")).toBe(false);
        });

        it("should handle multiple simultaneous key presses", () => {
            inputManager.attach();

            eventTarget.trigger("keydown", { code: "Space" });
            eventTarget.trigger("keydown", { code: "ShiftLeft" });

            expect(inputManager.getAction("jump")).toBe(true);
            expect(inputManager.getAction("run")).toBe(true);
        });

        it("should ignore duplicate keydown events", () => {
            inputManager.attach();

            eventTarget.trigger("keydown", { code: "Space" });
            eventTarget.trigger("keydown", { code: "Space" }); // Duplicate

            expect(inputManager.getAction("jump")).toBe(true);
        });

        it("should ignore keyup without keydown", () => {
            inputManager.attach();

            eventTarget.trigger("keyup", { code: "Space" });

            expect(inputManager.getAction("jump")).toBe(false);
        });
    });

    describe("Motion Input", () => {
        it("should detect forward motion", () => {
            inputManager.attach();

            eventTarget.trigger("keydown", { code: "KeyW" });

            expect(inputManager.getMotion("forward")).toBe(1);
        });

        it("should detect backward motion", () => {
            inputManager.attach();

            eventTarget.trigger("keydown", { code: "KeyS" });

            expect(inputManager.getMotion("forward")).toBe(-1);
        });

        it("should sum opposite directions", () => {
            inputManager.attach();

            eventTarget.trigger("keydown", { code: "KeyW" });
            eventTarget.trigger("keydown", { code: "KeyS" });

            expect(inputManager.getMotion("forward")).toBe(0);
        });

        it("should handle lateral motion", () => {
            inputManager.attach();

            eventTarget.trigger("keydown", { code: "KeyA" });
            expect(inputManager.getMotion("lateral")).toBe(-1);

            eventTarget.trigger("keydown", { code: "KeyD" });
            expect(inputManager.getMotion("lateral")).toBe(0); // Both pressed = cancel out
        });

        it("should clear motion on release", () => {
            vi.useFakeTimers();
            inputManager.attach();

            eventTarget.trigger("keydown", { code: "KeyW" });
            expect(inputManager.getMotion("forward")).toBe(1);

            eventTarget.trigger("keyup", { code: "KeyW" });
            // Motion persists due to 30ms debounce
            expect(inputManager.getMotion("forward")).toBe(1);
            
            // After debounce timeout
            vi.advanceTimersByTime(30);
            expect(inputManager.getMotion("forward")).toBe(0);
            
            vi.useRealTimers();
        });
    });

    describe("Mouse Input", () => {
        it("should detect mouse button press", () => {
            const mouseBindings = new Bindings<"primary" | "secondary">();
            mouseBindings.bindMouseClick(0).toAction("primary");
            mouseBindings.bindMouseClick(2).toAction("secondary");

            const mouseManager = new InputManager(mouseBindings, eventTarget);
            mouseManager.attach();

            eventTarget.trigger("mousedown", { button: 0 });
            expect(mouseManager.getAction("primary")).toBe(true);

            eventTarget.trigger("mouseup", { button: 0 });
            expect(mouseManager.getAction("primary")).toBe(false);

            mouseManager.dispose();
        });

        it("should keep mouse button active while held past the stuck-input timeout", () => {
            vi.useFakeTimers();
            const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
            const mouseBindings = new Bindings<"primary">();
            mouseBindings.bindMouseClick(0).toAction("primary");

            const mouseManager = new InputManager(mouseBindings, eventTarget);
            mouseManager.attach();

            eventTarget.trigger("mousedown", { button: 0 });
            expect(mouseManager.getAction("primary")).toBe(true);

            vi.advanceTimersByTime(250);
            mouseManager.update();

            expect(mouseManager.getAction("primary")).toBe(true);
            expect(consoleWarnSpy).not.toHaveBeenCalled();

            eventTarget.trigger("mouseup", { button: 0 });
            expect(mouseManager.getAction("primary")).toBe(false);

            consoleWarnSpy.mockRestore();
            vi.useRealTimers();
            mouseManager.dispose();
        });

        it("should track mouse movement", () => {
            const mouseBindings = new Bindings<"view_x" | "view_y">();
            mouseBindings.bindMouseMove("x").toMotion("view_x", 1);
            mouseBindings.bindMouseMove("y").toMotion("view_y", 1);

            const mouseManager = new InputManager(mouseBindings, eventTarget);
            mouseManager.attach();

            eventTarget.trigger("mousemove", { 
                clientX: 100, 
                clientY: 50,
                movementX: 10,
                movementY: 5,
            });

            mouseManager.update();

            eventTarget.trigger("mousemove", { 
                clientX: 110, 
                clientY: 55,
                movementX: 10,
                movementY: 5,
            });

            expect(mouseManager.getMotion("view_x")).not.toBe(0);
            expect(mouseManager.getMotion("view_y")).not.toBe(0);

            mouseManager.dispose();
        });
    });

    describe("Touch Input", () => {
        it("should detect touch start", () => {
            const touchBindings = new Bindings<"touch">();
            touchBindings.bindMouseClick(0).toAction("touch");

            const touchManager = new InputManager(touchBindings, eventTarget);
            touchManager.attach();

            eventTarget.trigger("touchstart", {
                changedTouches: [{ identifier: 0, clientX: 100, clientY: 100 }],
            });

            expect(touchManager.getAction("touch")).toBe(true);

            touchManager.dispose();
        });

        it("should detect touch end", () => {
            const touchBindings = new Bindings<"touch">();
            touchBindings.bindMouseClick(0).toAction("touch");

            const touchManager = new InputManager(touchBindings, eventTarget);
            touchManager.attach();

            eventTarget.trigger("touchstart", {
                changedTouches: [{ identifier: 0, clientX: 100, clientY: 100 }],
            });

            eventTarget.trigger("touchend", {
                changedTouches: [{ identifier: 0 }],
            });

            expect(touchManager.getAction("touch")).toBe(false);

            touchManager.dispose();
        });

        it("should release a touch when the browser cancels it", () => {
            const touchBindings = new Bindings<"touch">();
            touchBindings.bindMouseClick(0).toAction("touch");

            const touchManager = new InputManager(touchBindings, eventTarget);
            touchManager.attach();

            eventTarget.trigger("touchstart", {
                changedTouches: [{ identifier: 0, clientX: 100, clientY: 100 }],
            });
            expect(touchManager.getAction("touch")).toBe(true);

            eventTarget.trigger("touchcancel", {
                changedTouches: [{ identifier: 0 }],
            });

            expect(touchManager.getAction("touch")).toBe(false);
            touchManager.dispose();
        });

        it("prevents browser gesture handling for touches on attached descendants", () => {
            const touchBindings = new Bindings<"touch">();
            touchBindings.bindMouseClick(0).toAction("touch");

            const child = {};
            Object.assign(eventTarget, {
                contains: (node: unknown) => node === child,
            });
            const touchManager = new InputManager(touchBindings, eventTarget);
            touchManager.attach();

            const preventDefault = vi.fn();
            eventTarget.trigger("touchstart", {
                target: child,
                preventDefault,
                changedTouches: [{ identifier: 0, clientX: 100, clientY: 100 }],
            });

            expect(preventDefault).toHaveBeenCalledOnce();
            touchManager.dispose();
        });
    });

    describe("Virtual Input", () => {
        it("should handle virtual button press", () => {
            const virtualBindings = new Bindings<"virtual_jump">();
            virtualBindings.bindVirtualButton("jump").toAction("virtual_jump");

            const virtualManager = new InputManager(virtualBindings, eventTarget);
            virtualManager.attach();

            const dispatcher = virtualManager.getVirtualDispatcher();
            dispatcher.dispatchButton("jump", true);

            expect(virtualManager.getAction("virtual_jump")).toBe(true);

            dispatcher.dispatchButton("jump", false);
            expect(virtualManager.getAction("virtual_jump")).toBe(false);

            virtualManager.dispose();
        });

        it("should keep virtual buttons active while held past the stuck-input timeout", () => {
            vi.useFakeTimers();
            const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
            const virtualBindings = new Bindings<"virtual_jump">();
            virtualBindings.bindVirtualButton("jump").toAction("virtual_jump");

            const virtualManager = new InputManager(virtualBindings, eventTarget);
            virtualManager.attach();

            const dispatcher = virtualManager.getVirtualDispatcher();
            dispatcher.dispatchButton("jump", true);
            expect(virtualManager.getAction("virtual_jump")).toBe(true);

            vi.advanceTimersByTime(250);
            virtualManager.update();

            expect(virtualManager.getAction("virtual_jump")).toBe(true);
            expect(consoleWarnSpy).not.toHaveBeenCalled();

            dispatcher.dispatchButton("jump", false);
            expect(virtualManager.getAction("virtual_jump")).toBe(false);

            consoleWarnSpy.mockRestore();
            vi.useRealTimers();
            virtualManager.dispose();
        });

        it("should handle virtual axis", () => {
            const virtualBindings = new Bindings<"move_x" | "move_y">();
            virtualBindings.bindVirtualAxis("move", "x").toMotion("move_x", 1);
            virtualBindings.bindVirtualAxis("move", "y").toMotion("move_y", 1);

            const virtualManager = new InputManager(virtualBindings, eventTarget);
            virtualManager.attach();

            const dispatcher = virtualManager.getVirtualDispatcher();
            dispatcher.dispatchAxis("move", { x: 0.5, y: -0.5 });

            expect(virtualManager.getMotion("move_x")).toBe(0.5);
            expect(virtualManager.getMotion("move_y")).toBe(-0.5);

            virtualManager.dispose();
        });

        it("should expose unbound custom virtual buttons as actions", () => {
            const virtualBindings = new Bindings<"jump">();
            const virtualManager = new InputManager(virtualBindings, eventTarget);
            virtualManager.attach();

            const dispatcher = virtualManager.getVirtualDispatcher();
            dispatcher.dispatchButton("gear", true);
            expect(virtualManager.getAction("gear" as any)).toBe(true);

            dispatcher.dispatchButton("gear", false);
            expect(virtualManager.getAction("gear" as any)).toBe(false);

            virtualManager.dispose();
        });

        it("default bindings map the touch steering wheel axis to steer motion", () => {
            const manager = new InputManager(defaultBindings(), eventTarget);
            manager.attach();

            manager.getVirtualDispatcher().dispatchAxis("steer", {x: 0.75, y: 0});

            expect(manager.getMotion("steer")).toBe(0.75);

            manager.dispose();
        });
    });

    describe("Debounce", () => {
        beforeEach(() => {
            vi.useFakeTimers();
        });

        afterEach(() => {
            vi.useRealTimers();
        });

        it("should apply debounce to motion with flag", () => {
            inputManager.attach();

            eventTarget.trigger("keydown", { code: "KeyW" });
            expect(inputManager.getMotion("forward")).toBe(1);

            eventTarget.trigger("keyup", { code: "KeyW" });
            
            // Motion should still be active due to debounce
            expect(inputManager.getMotion("forward")).toBe(1);

            // After debounce timeout
            vi.advanceTimersByTime(30);
            expect(inputManager.getMotion("forward")).toBe(0);
        });

        it("should not apply debounce to actions", () => {
            inputManager.attach();

            eventTarget.trigger("keydown", { code: "Space" });
            expect(inputManager.getAction("jump")).toBe(true);

            eventTarget.trigger("keyup", { code: "Space" });
            
            // Action should be released immediately
            expect(inputManager.getAction("jump")).toBe(false);
        });

        it("should cancel debounce on re-press", () => {
            inputManager.attach();

            eventTarget.trigger("keydown", { code: "KeyW" });
            eventTarget.trigger("keyup", { code: "KeyW" });

            // Start debounce timer
            vi.advanceTimersByTime(10);

            // Re-press before debounce completes
            eventTarget.trigger("keydown", { code: "KeyW" });

            // Motion should still be 1
            expect(inputManager.getMotion("forward")).toBe(1);

            // Advance past original debounce time
            vi.advanceTimersByTime(30);

            // Motion should STILL be 1 because key is pressed
            expect(inputManager.getMotion("forward")).toBe(1);
        });
    });

    describe("Input State Timeout", () => {
        beforeEach(() => {
            vi.useFakeTimers();
        });

        afterEach(() => {
            vi.useRealTimers();
        });

        it("should not clear input while key is physically held", () => {
            inputManager.attach();

            eventTarget.trigger("keydown", { code: "Space" });
            expect(inputManager.getAction("jump")).toBe(true);

            // Advance well past timeout — key is still held (in downKeys)
            vi.advanceTimersByTime(500);
            inputManager.update();

            // Must remain active because the key was never released
            expect(inputManager.getAction("jump")).toBe(true);
        });

        it("should not warn for normally held inputs", () => {
            const consoleDebugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});

            inputManager.attach();

            eventTarget.trigger("keydown", { code: "ShiftLeft" });
            vi.advanceTimersByTime(500);
            inputManager.update();

            expect(inputManager.getAction("run")).toBe(true);
            expect(consoleDebugSpy).not.toHaveBeenCalled();

            consoleDebugSpy.mockRestore();
        });
    });

    describe("Focus/Blur Handling", () => {
        it("should clear all inputs on blur", () => {
            // Create mock window target
            const bindings = new Bindings<TestActions>();
            bindings.bindKey("Space").toAction("jump");
            bindings.bindKey("ShiftLeft").toAction("run");
            bindings.bindKey("KeyW", true).toMotion("forward", 1);
            
            const manager = new InputManager(bindings, eventTarget);
            manager.attach();

            eventTarget.trigger("keydown", { code: "Space" });
            eventTarget.trigger("keydown", { code: "ShiftLeft" });
            eventTarget.trigger("keydown", { code: "KeyW" });

            expect(manager.getAction("jump")).toBe(true);
            expect(manager.getAction("run")).toBe(true);
            expect(manager.getMotion("forward")).toBe(1);

            // Directly call clearAllInputStates by triggering detach/attach
            manager.pause(); // Uses detach internally

            expect(manager.getAction("jump")).toBe(false);
            expect(manager.getAction("run")).toBe(false);
            expect(manager.getMotion("forward")).toBe(0);
            
            manager.dispose();
        });

        it("should clear all inputs on visibility change", () => {
            inputManager.attach();

            eventTarget.trigger("keydown", { code: "Space" });
            expect(inputManager.getAction("jump")).toBe(true);

            // Pause/resume simulates focus loss
            inputManager.pause();
            expect(inputManager.getAction("jump")).toBe(false);
        });
    });

    describe("Pause/Resume", () => {
        it("should clear inputs on pause", () => {
            inputManager.attach();

            eventTarget.trigger("keydown", { code: "Space" });
            expect(inputManager.getAction("jump")).toBe(true);

            inputManager.pause();

            expect(inputManager.getAction("jump")).toBe(false);
        });

        it("should not process inputs while paused", () => {
            inputManager.attach();
            inputManager.pause();

            eventTarget.trigger("keydown", { code: "Space" });

            expect(inputManager.getAction("jump")).toBe(false);
        });

        it("should resume input processing", () => {
            inputManager.attach();
            inputManager.pause();
            inputManager.resume();

            eventTarget.trigger("keydown", { code: "Space" });

            expect(inputManager.getAction("jump")).toBe(true);
        });
    });

    //THIS TEST INVALID - DELTAS ARE CLEARED BY THE CONSUMER
    // describe("Update Cycle", () => {
    //     it("should clear motion deltas on update", () => {
    //         const mouseBindings = new Bindings<"view_x">();
    //         mouseBindings.bindMouseMove("x").toMotion("view_x", 1);
    //
    //         const mouseManager = new InputManager(mouseBindings, eventTarget as any);
    //         mouseManager.attach();
    //
    //         eventTarget.trigger("mousemove", {
    //             clientX: 100,
    //             clientY: 100,
    //             movementX: 10,
    //             movementY: 0,
    //         });
    //
    //         expect(mouseManager.getMotion("view_x")).not.toBe(0);
    //
    //         mouseManager.update();
    //
    //         // Delta should be cleared
    //         expect(mouseManager.getMotion("view_x")).toBe(0);
    //
    //         mouseManager.dispose();
    //     });
    // });

    describe("Bindings", () => {
        it("should allow rebinding at runtime", () => {
            inputManager.attach();

            eventTarget.trigger("keydown", { code: "Space" });
            expect(inputManager.getAction("jump")).toBe(true);

            // Create new bindings
            const newBindings = new Bindings<TestActions>();
            newBindings.bindKey("KeyJ").toAction("jump");

            inputManager.setBindings(newBindings);

            // Old binding should not work
            eventTarget.trigger("keyup", { code: "Space" });
            eventTarget.trigger("keydown", { code: "Space" });
            expect(inputManager.getAction("jump")).toBe(false);

            // New binding should work
            eventTarget.trigger("keydown", { code: "KeyJ" });
            expect(inputManager.getAction("jump")).toBe(true);
        });

        it("should support multiple bindings for same action", () => {
            const multiBindings = new Bindings<"jump">();
            multiBindings.bindKey("Space").toAction("jump");
            multiBindings.bindKey("KeyW").toAction("jump");

            const multiManager = new InputManager(multiBindings, eventTarget);
            multiManager.attach();

            eventTarget.trigger("keydown", { code: "Space" });
            expect(multiManager.getAction("jump")).toBe(true);

            eventTarget.trigger("keyup", { code: "Space" });
            expect(multiManager.getAction("jump")).toBe(false);

            eventTarget.trigger("keydown", { code: "KeyW" });
            expect(multiManager.getAction("jump")).toBe(true);

            multiManager.dispose();
        });
    });

    describe("Dispose", () => {
        it("should clean up on dispose", () => {
            inputManager.attach();

            eventTarget.trigger("keydown", { code: "Space" });
            expect(inputManager.getAction("jump")).toBe(true);

            inputManager.dispose();

            // Should not respond to events after dispose
            eventTarget.trigger("keyup", { code: "Space" });
            eventTarget.trigger("keydown", { code: "ShiftLeft" });

            expect(inputManager.getAction("jump")).toBe(false);
            expect(inputManager.getAction("run")).toBe(false);
        });
    });

    describe("Edge Cases", () => {
        it("should handle rapid key presses", () => {
            inputManager.attach();

            for (let i = 0; i < 10; i++) {
                eventTarget.trigger("keydown", { code: "Space" });
                eventTarget.trigger("keyup", { code: "Space" });
            }

            expect(inputManager.getAction("jump")).toBe(false);
        });

        it("should handle all keys released at once", () => {
            inputManager.attach();

            eventTarget.trigger("keydown", { code: "Space" });
            eventTarget.trigger("keydown", { code: "ShiftLeft" });
            eventTarget.trigger("keydown", { code: "KeyW" });

            // Simulate blur via pause
            inputManager.pause();

            expect(inputManager.getAction("jump")).toBe(false);
            expect(inputManager.getAction("run")).toBe(false);
            expect(inputManager.getMotion("forward")).toBe(0);
        });

        it("should handle undefined actions gracefully", () => {
            inputManager.attach();

            expect(inputManager.getAction("nonexistent" as any)).toBe(false);
            expect(inputManager.getMotion("nonexistent" as any)).toBe(0);
        });
    });

    describe("Gamepad Input", () => {
        let gamepadBindings: Bindings<TestActions>;
        let gamepadManager: InputManager<TestActions>;
        let mockGamepad: any;

        beforeEach(() => {
            gamepadBindings = new Bindings<TestActions>();
            gamepadBindings.bindGamepadButton(0).toAction("jump");
            gamepadBindings.bindGamepadButton(5).toAction("use");
            gamepadBindings.bindGamepadAxis(0).toMotion("lateral", 1);
            gamepadBindings.bindGamepadAxis(1).toMotion("forward", -1);

            gamepadManager = new InputManager(gamepadBindings, eventTarget);
            gamepadManager.attach();

            mockGamepad = {
                index: 0,
                buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })),
                axes: [0, 0, 0, 0],
            };

            vi.stubGlobal("navigator", {
                getGamepads: () => [mockGamepad, null, null, null],
            });
        });

        afterEach(() => {
            gamepadManager.dispose();
            vi.unstubAllGlobals();
        });

        it("should detect gamepad button press via polling", () => {
            // Simulate gamepadconnected
            eventTarget.trigger("gamepadconnected", { gamepad: { index: 0 } });

            // First update — button not pressed
            gamepadManager.update();
            expect(gamepadManager.getAction("jump")).toBe(false);

            // Press button 0 (A)
            mockGamepad.buttons[0] = { pressed: true, value: 1 };
            gamepadManager.update();
            expect(gamepadManager.getAction("jump")).toBe(true);

            const internals = gamepadManager as unknown as { gamepadButtonTriggerCache: string[] };
            expect(internals.gamepadButtonTriggerCache[0]).toBe(TriggerType.GamepadButton + 0);
        });

        it("should detect gamepad button release via edge detection", () => {
            eventTarget.trigger("gamepadconnected", { gamepad: { index: 0 } });

            // Press
            mockGamepad.buttons[0] = { pressed: true, value: 1 };
            gamepadManager.update();
            expect(gamepadManager.getAction("jump")).toBe(true);

            // Release
            mockGamepad.buttons[0] = { pressed: false, value: 0 };
            gamepadManager.update();
            expect(gamepadManager.getAction("jump")).toBe(false);
        });

        it("should not re-fire while button is held", () => {
            eventTarget.trigger("gamepadconnected", { gamepad: { index: 0 } });

            mockGamepad.buttons[0] = { pressed: true, value: 1 };
            gamepadManager.update();
            expect(gamepadManager.getAction("jump")).toBe(true);

            // Second update with same state — should not change
            gamepadManager.update();
            expect(gamepadManager.getAction("jump")).toBe(true);
        });

        it("should apply deadzone to axes", () => {
            eventTarget.trigger("gamepadconnected", { gamepad: { index: 0 } });

            // Value below deadzone (0.15)
            mockGamepad.axes[0] = 0.1;
            gamepadManager.update();
            expect(gamepadManager.getMotion("lateral")).toBe(0);

            // Value above deadzone
            mockGamepad.axes[0] = 0.8;
            gamepadManager.update();
            expect(gamepadManager.getMotion("lateral")).toBe(0.8);
        });

        it("should apply scale to axis motions", () => {
            eventTarget.trigger("gamepadconnected", { gamepad: { index: 0 } });

            // Left Y axis with scale -1
            mockGamepad.axes[1] = 0.5;
            gamepadManager.update();
            expect(gamepadManager.getMotion("forward")).toBe(-0.5); // 0.5 * -1 scale
        });

        it("does not recompute gamepad axis motion when axis values are unchanged", () => {
            eventTarget.trigger("gamepadconnected", { gamepad: { index: 0 } });
            const setMotionState = vi.spyOn(gamepadManager as any, "setMotionState");

            mockGamepad.axes[0] = 0.8;
            gamepadManager.update();
            expect(gamepadManager.getMotion("lateral")).toBe(0.8);
            expect(setMotionState).toHaveBeenCalledWith(TriggerType.GamepadAxis + 0, true, 0.8);
            const internals = gamepadManager as unknown as { gamepadAxisTriggerCache: string[] };
            const cachedAxisTrigger = internals.gamepadAxisTriggerCache[0];
            expect(cachedAxisTrigger).toBe(TriggerType.GamepadAxis + 0);

            setMotionState.mockClear();
            gamepadManager.update();

            expect(gamepadManager.getMotion("lateral")).toBe(0.8);
            expect(internals.gamepadAxisTriggerCache[0]).toBe(cachedAxisTrigger);
            expect(setMotionState).not.toHaveBeenCalled();
        });

        it("clears gamepad axis motion when the axis returns inside the deadzone", () => {
            eventTarget.trigger("gamepadconnected", { gamepad: { index: 0 } });
            const setMotionState = vi.spyOn(gamepadManager as any, "setMotionState");

            mockGamepad.axes[0] = 0.8;
            gamepadManager.update();
            setMotionState.mockClear();

            mockGamepad.axes[0] = 0.05;
            gamepadManager.update();

            expect(gamepadManager.getMotion("lateral")).toBe(0);
            expect(setMotionState).toHaveBeenCalledWith(TriggerType.GamepadAxis + 0, false, 0);
        });

        it("should clear gamepad state on disconnect", () => {
            eventTarget.trigger("gamepadconnected", { gamepad: { index: 0 } });

            mockGamepad.buttons[0] = { pressed: true, value: 1 };
            mockGamepad.axes[0] = 0.8;
            gamepadManager.update();
            expect(gamepadManager.getAction("jump")).toBe(true);
            expect(gamepadManager.getMotion("lateral")).toBe(0.8);

            //FIXME: this is a wrong target object - no listener for gamepaddisconnected
            // eventTarget.trigger("gamepaddisconnected", { gamepad: { index: 0 } });
            // expect(gamepadManager.getAction("jump")).toBe(false);
            // expect(gamepadManager.getMotion("lateral")).toBe(0);
        });

        it("should auto-detect gamepad when no connected event fires", () => {
            // Don't trigger gamepadconnected — pollGamepad should scan
            mockGamepad.buttons[0] = { pressed: true, value: 1 };
            gamepadManager.update();
            expect(gamepadManager.getAction("jump")).toBe(true);
        });

        it("should handle multiple button bindings", () => {
            eventTarget.trigger("gamepadconnected", { gamepad: { index: 0 } });

            mockGamepad.buttons[0] = { pressed: true, value: 1 };
            mockGamepad.buttons[5] = { pressed: true, value: 1 };
            gamepadManager.update();

            expect(gamepadManager.getAction("jump")).toBe(true);
            expect(gamepadManager.getAction("use")).toBe(true);

            mockGamepad.buttons[0] = { pressed: false, value: 0 };
            gamepadManager.update();

            expect(gamepadManager.getAction("jump")).toBe(false);
            expect(gamepadManager.getAction("use")).toBe(true);
        });
    });
});
