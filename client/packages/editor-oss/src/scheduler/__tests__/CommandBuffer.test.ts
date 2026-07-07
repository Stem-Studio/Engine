import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { CommandBuffer, DeferredCommand } from "../CommandBuffer";

describe("CommandBuffer", () => {
    let buffer: CommandBuffer;

    beforeEach(() => {
        buffer = new CommandBuffer();
    });

    afterEach(() => {
        buffer.dispose();
    });

    describe("push", () => {
        it("should queue add commands", () => {
            const cmd: DeferredCommand = {
                type: "add",
                target: "obj1",
                system: "behavior",
                data: { foo: "bar" },
            };
            buffer.push(cmd);
            expect(buffer.pending).toBe(1);
        });

        it("should queue remove commands", () => {
            const cmd: DeferredCommand = {
                type: "remove",
                target: "obj1",
                system: "behavior",
            };
            buffer.push(cmd);
            expect(buffer.pending).toBe(1);
        });

        it("should queue custom callback commands", () => {
            const cmd: DeferredCommand = {
                type: "custom",
                callback: () => {},
            };
            buffer.push(cmd);
            expect(buffer.pending).toBe(1);
        });

        it("should queue multiple commands", () => {
            buffer.push({ type: "add", target: "a", system: "s1" });
            buffer.push({ type: "remove", target: "b", system: "s2" });
            buffer.push({ type: "custom", callback: () => {} });
            expect(buffer.pending).toBe(3);
        });
    });

    describe("flush", () => {
        it("should execute custom callbacks in order", () => {
            const order: number[] = [];

            buffer.push({ type: "custom", callback: () => order.push(1) });
            buffer.push({ type: "custom", callback: () => order.push(2) });
            buffer.push({ type: "custom", callback: () => order.push(3) });

            buffer.flush();

            expect(order).toEqual([1, 2, 3]);
        });

        it("should clear pending commands after flush", () => {
            buffer.push({ type: "custom", callback: () => {} });
            buffer.push({ type: "add", target: "a", system: "s" });
            expect(buffer.pending).toBe(2);

            buffer.flush();

            expect(buffer.pending).toBe(0);
        });

        it("should do nothing when no commands queued", () => {
            expect(buffer.pending).toBe(0);
            buffer.flush(); // Should not throw
            expect(buffer.pending).toBe(0);
        });

        it("should handle errors in callbacks gracefully", () => {
            const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
            const successCallback = vi.fn();

            buffer.push({
                type: "custom",
                callback: () => {
                    throw new Error("Test error");
                },
            });
            buffer.push({ type: "custom", callback: successCallback });

            buffer.flush();

            // Error should be logged
            expect(consoleSpy).toHaveBeenCalledWith(
                "[CommandBuffer] Error executing command:",
                expect.any(Error),
            );

            // Subsequent callbacks should still execute
            expect(successCallback).toHaveBeenCalled();

            consoleSpy.mockRestore();
        });

        it("should execute add/remove commands through registered handlers", () => {
            const handler = {
                add: vi.fn(),
                remove: vi.fn(),
            };
            buffer.registerHandler("behavior", handler);

            buffer.push({ type: "add", target: "obj1", system: "behavior", data: {} });
            buffer.push({ type: "remove", target: "obj2", system: "behavior" });

            buffer.flush();

            expect(buffer.pending).toBe(0);
            expect(handler.add).toHaveBeenCalledWith("obj1", {});
            expect(handler.remove).toHaveBeenCalledWith("obj2");
        });

        it("should warn for add/remove commands without registered handlers", () => {
            const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

            buffer.push({ type: "add", target: "obj1", system: "behavior", data: {} });
            buffer.push({ type: "remove", target: "obj2", system: "lambda" });

            buffer.flush();

            expect(warnSpy).toHaveBeenCalledWith(
                expect.stringContaining("Dropped 2 add/remove command(s)"),
            );
            warnSpy.mockRestore();
        });

        it("should handle errors in registered handlers gracefully", () => {
            const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
            const successHandler = vi.fn();
            buffer.registerHandler("behavior", {
                add: () => {
                    throw new Error("add failed");
                },
            });
            buffer.registerHandler("lambda", {
                remove: successHandler,
            });

            buffer.push({ type: "add", target: "obj1", system: "behavior", data: {} });
            buffer.push({ type: "remove", target: "obj2", system: "lambda" });

            buffer.flush();

            expect(consoleSpy).toHaveBeenCalledWith(
                '[CommandBuffer] Error executing add command for system "behavior":',
                expect.any(Error),
            );
            expect(successHandler).toHaveBeenCalledWith("obj2");
            consoleSpy.mockRestore();
        });

        it("should warn only once for unwired add/remove commands", () => {
            const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

            buffer.push({ type: "add", target: "obj1", system: "behavior", data: {} });
            buffer.flush();
            buffer.push({ type: "remove", target: "obj2", system: "lambda" });
            buffer.flush();

            expect(warnSpy).toHaveBeenCalledTimes(1);
            warnSpy.mockRestore();
        });

        it("should allow reuse after flush", () => {
            const callback1 = vi.fn();
            const callback2 = vi.fn();

            buffer.push({ type: "custom", callback: callback1 });
            buffer.flush();

            buffer.push({ type: "custom", callback: callback2 });
            buffer.flush();

            expect(callback1).toHaveBeenCalledTimes(1);
            expect(callback2).toHaveBeenCalledTimes(1);
        });
    });

    describe("pending", () => {
        it("should return 0 for empty buffer", () => {
            expect(buffer.pending).toBe(0);
        });

        it("should return correct count after pushing", () => {
            buffer.push({ type: "add", target: "a", system: "s" });
            expect(buffer.pending).toBe(1);

            buffer.push({ type: "remove", target: "b", system: "s" });
            expect(buffer.pending).toBe(2);
        });

        it("should return 0 after flush", () => {
            buffer.push({ type: "add", target: "a", system: "s" });
            buffer.push({ type: "remove", target: "b", system: "s" });
            buffer.flush();
            expect(buffer.pending).toBe(0);
        });
    });

    describe("dispose", () => {
        it("should clear all pending commands", () => {
            buffer.push({ type: "add", target: "a", system: "s" });
            buffer.push({ type: "custom", callback: () => {} });
            expect(buffer.pending).toBe(2);

            buffer.dispose();

            expect(buffer.pending).toBe(0);
        });

        it("should prevent callbacks from executing after dispose", () => {
            const callback = vi.fn();
            buffer.push({ type: "custom", callback });

            buffer.dispose();
            buffer.flush();

            expect(callback).not.toHaveBeenCalled();
        });

        it("should clear registered handlers", () => {
            const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
            const handler = { add: vi.fn() };
            buffer.registerHandler("behavior", handler);

            buffer.dispose();
            buffer.push({ type: "add", target: "a", system: "behavior" });
            buffer.flush();

            expect(handler.add).not.toHaveBeenCalled();
            expect(warnSpy).toHaveBeenCalledWith(
                expect.stringContaining("Dropped 1 add/remove command(s)"),
            );
            warnSpy.mockRestore();
        });
    });
});
