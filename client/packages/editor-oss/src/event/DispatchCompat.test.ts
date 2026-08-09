import {afterEach, describe, expect, it, vi} from "vitest";

import {dispatch} from "./DispatchCompat";
import EventList from "./EventList";

describe("DispatchCompat", () => {
    afterEach(() => {
        delete (globalThis as {__STEM_APP_EVENT_PROFILE__?: unknown}).__STEM_APP_EVENT_PROFILE__;
    });

    it("delivers the same event to multiple suffix registrations", () => {
        const d = dispatch("change");
        const a = vi.fn();
        const b = vi.fn();

        d.on("change.ComponentA", a);
        d.on("change.ComponentB", b);
        d.call("change", null, "payload");

        expect(a).toHaveBeenCalledWith("payload");
        expect(b).toHaveBeenCalledWith("payload");
    });

    it("calls handlers with provided context and arguments", () => {
        const d = dispatch("change");
        const handler = vi.fn();
        const ctx = {id: "ctx"};

        d.on("change.scope", handler);
        d.call("change", ctx, 1, 2);

        expect(handler).toHaveBeenCalledWith(1, 2);
        expect(handler.mock.contexts[0]).toBe(ctx);
    });

    it("calls handlers with no payload arguments", () => {
        const d = dispatch("change");
        const handler = vi.fn();
        const ctx = {id: "ctx"};

        d.on("change.scope", handler);
        d.call("change", ctx);

        expect(handler).toHaveBeenCalledWith();
        expect(handler.mock.contexts[0]).toBe(ctx);
    });

    it("preserves uncommon variadic payloads beyond the fixed-arity fast path", () => {
        const d = dispatch("change");
        const handler = vi.fn();

        d.on("change.scope", handler);
        d.call("change", null, 1, 2, 3, 4, 5);

        expect(handler).toHaveBeenCalledWith(1, 2, 3, 4, 5);
    });

    it("removes namespaced handlers with null", () => {
        const d = dispatch("change");
        const handler = vi.fn();

        d.on("change.scope", handler);
        d.call("change", null, "a");
        d.on("change.scope", null);
        d.call("change", null, "b");

        expect(handler).toHaveBeenCalledTimes(1);
        expect(handler).toHaveBeenCalledWith("a");
    });

    it("removes only the targeted suffix registration", () => {
        const d = dispatch("change");
        const a = vi.fn();
        const b = vi.fn();

        d.on("change.ComponentA", a);
        d.on("change.ComponentB", b);
        d.on("change.ComponentA", null);
        d.call("change", null, "payload");

        expect(a).not.toHaveBeenCalled();
        expect(b).toHaveBeenCalledWith("payload");
    });

    it("supports apply", () => {
        const d = dispatch("update");
        const handler = vi.fn();

        d.on("update.scope", handler);
        d.apply("update", null, ["x", "y"]);

        expect(handler).toHaveBeenCalledWith("x", "y");
    });

    it("supports apply with uncommon variadic payloads", () => {
        const d = dispatch("update");
        const handler = vi.fn();

        d.on("update.scope", handler);
        d.apply("update", null, ["a", "b", "c", "d", "e"]);

        expect(handler).toHaveBeenCalledWith("a", "b", "c", "d", "e");
    });

    it("profiles opted-in event handlers without changing dispatch semantics", () => {
        const d = dispatch("animate", "change");
        const handler = vi.fn(() => "result");
        (globalThis as any).__STEM_APP_EVENT_PROFILE__ = {enabled: true, types: ["animate"]};

        d.on("animate.behavior", handler);
        d.on("change.ui", vi.fn());

        expect(d.call("animate", {id: "runtime"}, 1, 2)).toBeUndefined();
        expect(handler).toHaveBeenCalledWith(1, 2);

        const profile = (globalThis as any).__STEM_APP_EVENT_PROFILE__;
        expect(profile.events["animate.behavior"]).toMatchObject({
            type: "animate",
            key: "animate.behavior",
            calls: 1,
        });
        expect(profile.events["change.ui"]).toBeUndefined();
    });

    it("registers Quick Build batch events used by the project tree", () => {
        expect(EventList).toContain("quickBuildBatchStarted");
        expect(EventList).toContain("quickBuildBatchEnded");
    });
});
