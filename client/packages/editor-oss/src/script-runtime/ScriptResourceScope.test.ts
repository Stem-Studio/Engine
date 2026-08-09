import {afterEach, describe, expect, it, vi} from "vitest";

import {ScriptResourceScope} from "./ScriptResourceScope";

describe("ScriptResourceScope", () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it("tracks and removes host listeners through the scoped window", () => {
        const scope = new ScriptResourceScope({window, document});
        const listener = vi.fn();
        const scopedWindow = scope.getWindow();

        scopedWindow.addEventListener("stem-resource-scope", listener);
        window.dispatchEvent(new Event("stem-resource-scope"));
        expect(listener).toHaveBeenCalledOnce();

        scope.dispose();
        window.dispatchEvent(new Event("stem-resource-scope"));
        expect(listener).toHaveBeenCalledOnce();
        expect(scope.isDisposed).toBe(true);
    });

    it("cancels forgotten timers and animation frames on dispose", () => {
        vi.useFakeTimers();
        const scope = new ScriptResourceScope({window, document});
        const timeout = vi.fn();
        const interval = vi.fn();
        const frame = vi.fn();

        scope.setTimeout(timeout, 20);
        scope.setInterval(interval, 10);
        scope.requestAnimationFrame(frame);
        scope.dispose();
        vi.advanceTimersByTime(100);

        expect(timeout).not.toHaveBeenCalled();
        expect(interval).not.toHaveBeenCalled();
        expect(frame).not.toHaveBeenCalled();
    });

    it("makes later registrations no-ops after disposal", () => {
        const scope = new ScriptResourceScope({window, document});
        scope.dispose();

        expect(scope.setTimeout(vi.fn(), 0)).toBe(-1);
        expect(scope.setInterval(vi.fn(), 0)).toBe(-1);
        expect(scope.requestAnimationFrame(vi.fn())).toBe(-1);
    });

    it("keeps native DOM objects unproxied for Web IDL brand checks", () => {
        const scope = new ScriptResourceScope({window, document});
        const scopedDocument = scope.getDocument();
        const canvas = scopedDocument?.createElement("canvas");

        expect(canvas).toBeInstanceOf(HTMLCanvasElement);
        expect(canvas?.getContext).toBeInstanceOf(Function);
        expect(scope.getWindow().document).toBe(scopedDocument);
        expect(scopedDocument?.defaultView).toBe(scope.getWindow());
        scope.dispose();
    });
});
