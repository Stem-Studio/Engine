import {afterEach, describe, expect, it, vi} from "vitest";

import EventBus from "./EventBus";

describe("EventBus", () => {
    afterEach(() => {
        EventBus.instance.reset();
    });

    it("sends a topic to multiple subscribers", () => {
        const a = vi.fn();
        const b = vi.fn();
        EventBus.instance.subscribe("game.start", a);
        EventBus.instance.subscribe("game.start", b);

        EventBus.instance.send("game.start", {id: 1});

        expect(a).toHaveBeenCalledWith("game.start", {id: 1});
        expect(b).toHaveBeenCalledWith("game.start", {id: 1});
    });

    it("unsubscribes using a token", () => {
        const a = vi.fn();
        const token = EventBus.instance.subscribe("game.pause", a);

        EventBus.instance.unsubscribe(token);
        EventBus.instance.send("game.pause", {id: 2});

        expect(a).not.toHaveBeenCalled();
    });

    it("unsubscribes all listeners by topic", () => {
        const a = vi.fn();
        const b = vi.fn();
        EventBus.instance.subscribe("game.stop", a);
        EventBus.instance.subscribe("game.stop", b);

        EventBus.instance.unsubscribe("game.stop");
        EventBus.instance.send("game.stop", {id: 3});

        expect(a).not.toHaveBeenCalled();
        expect(b).not.toHaveBeenCalled();
    });

    it("delivers engine-priority listeners before game listeners", () => {
        const order: string[] = [];
        EventBus.instance.subscribe("game.tick", () => order.push("game"));
        EventBus.instance.subscribe("game.tick", () => order.push("engine"), {priority: "engine"});

        EventBus.instance.send("game.tick");

        expect(order).toEqual(["engine", "game"]);
    });

    it("delivers child topics to subscribed hierarchical parents", () => {
        const parent = vi.fn();
        EventBus.instance.subscribe("game", parent);

        EventBus.instance.send("game.start", {id: 4});

        expect(parent).toHaveBeenCalledWith("game.start", {id: 4});
    });

    it("does not emit through eventemitter when no subscribed topic can match", () => {
        const bus = EventBus.instance as never as {emitter: {emit: (...args: unknown[]) => boolean}};
        const emit = vi.spyOn(bus.emitter, "emit");
        EventBus.instance.subscribe("game.pause", vi.fn());

        EventBus.instance.send("inventory.add", {id: 5});

        expect(emit).not.toHaveBeenCalled();
    });

    it("reuses cached emitter event names across repeated dispatches", () => {
        const bus = EventBus.instance as never as {eventNames: Map<string, unknown>};
        const exact = vi.fn();
        const parent = vi.fn();

        EventBus.instance.subscribe("game.tick", exact);
        EventBus.instance.subscribe("game", parent);
        const cacheSizeAfterSubscribe = bus.eventNames.size;

        EventBus.instance.send("game.tick", {frame: 1});
        EventBus.instance.send("game.tick", {frame: 2});

        expect(exact).toHaveBeenCalledTimes(2);
        expect(parent).toHaveBeenCalledTimes(2);
        expect(bus.eventNames.size).toBe(cacheSizeAfterSubscribe);
    });
});
