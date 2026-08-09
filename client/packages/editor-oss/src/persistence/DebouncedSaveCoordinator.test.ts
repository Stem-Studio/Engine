import {describe, expect, it, vi} from "vitest";

import {DebouncedSaveCoordinator} from "./DebouncedSaveCoordinator";

describe("DebouncedSaveCoordinator", () => {
    it("coalesces a burst of dirty notifications", async () => {
        vi.useFakeTimers();
        let dirty = true;
        const save = vi.fn(async () => {
            dirty = false;
        });
        const coordinator = new DebouncedSaveCoordinator({
            debounceMs: 100,
            retryMs: 500,
            isDirty: () => dirty,
            save,
        });

        coordinator.markDirty();
        coordinator.markDirty();
        coordinator.markDirty();
        await vi.advanceTimersByTimeAsync(100);

        expect(save).toHaveBeenCalledTimes(1);
        vi.useRealTimers();
    });

    it("never overlaps saves and follows up when edits arrive in flight", async () => {
        vi.useFakeTimers();
        let dirty = true;
        let resolveSave!: () => void;
        const save = vi.fn(
            () =>
                new Promise<void>(resolve => {
                    resolveSave = () => {
                        dirty = false;
                        resolve();
                    };
                }),
        );
        const coordinator = new DebouncedSaveCoordinator({
            debounceMs: 100,
            retryMs: 500,
            isDirty: () => dirty,
            save,
        });

        coordinator.markDirty();
        await vi.advanceTimersByTimeAsync(100);
        expect(save).toHaveBeenCalledTimes(1);

        dirty = true;
        coordinator.markDirty();
        await vi.advanceTimersByTimeAsync(1_000);
        expect(save).toHaveBeenCalledTimes(1);

        resolveSave();
        await Promise.resolve();
        dirty = true;
        await vi.advanceTimersByTimeAsync(100);
        expect(save).toHaveBeenCalledTimes(2);
        vi.useRealTimers();
    });

    it("keeps retrying a dirty save after failure", async () => {
        vi.useFakeTimers();
        let dirty = true;
        const save = vi
            .fn<() => Promise<void>>()
            .mockRejectedValueOnce(new Error("disk full"))
            .mockImplementationOnce(async () => {
                dirty = false;
            });
        const coordinator = new DebouncedSaveCoordinator({
            debounceMs: 100,
            retryMs: 500,
            isDirty: () => dirty,
            save,
        });

        coordinator.markDirty();
        await vi.advanceTimersByTimeAsync(100);
        expect(save).toHaveBeenCalledTimes(1);
        expect(dirty).toBe(true);

        await vi.advanceTimersByTimeAsync(500);
        expect(save).toHaveBeenCalledTimes(2);
        expect(dirty).toBe(false);
        vi.useRealTimers();
    });

    it("flushFully drains an edit queued during the active generation", async () => {
        let editVersion = 1;
        let savedVersion = 0;
        let releaseFirst!: () => void;
        const firstGate = new Promise<void>(resolve => {
            releaseFirst = resolve;
        });
        const save = vi.fn(async () => {
            const captured = editVersion;
            if (captured === 1) await firstGate;
            savedVersion = captured;
        });
        const coordinator = new DebouncedSaveCoordinator({
            debounceMs: 100,
            retryMs: 500,
            isDirty: () => editVersion > savedVersion,
            save,
        });

        const draining = coordinator.flushFully();
        await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1));
        editVersion = 2;
        coordinator.markDirty();
        releaseFirst();
        await draining;

        expect(save).toHaveBeenCalledTimes(2);
        expect(savedVersion).toBe(2);
    });

    it("discardPending suppresses a queued dirty generation", async () => {
        vi.useFakeTimers();
        const save = vi.fn(async () => undefined);
        const coordinator = new DebouncedSaveCoordinator({
            debounceMs: 100,
            retryMs: 500,
            isDirty: () => true,
            save,
        });

        coordinator.markDirty();
        await coordinator.discardPending();
        await vi.advanceTimersByTimeAsync(1_000);

        expect(save).not.toHaveBeenCalled();
        vi.useRealTimers();
    });

    it("invalidates an active save without blocking editor teardown", async () => {
        vi.useFakeTimers();
        let releaseSave!: () => void;
        const save = vi.fn(() => new Promise<void>(resolve => {
            releaseSave = resolve;
        }));
        const onDiscard = vi.fn();
        const coordinator = new DebouncedSaveCoordinator({
            debounceMs: 100,
            retryMs: 500,
            isDirty: () => true,
            save,
            onDiscard,
        });

        coordinator.markDirty();
        await vi.advanceTimersByTimeAsync(100);
        expect(save).toHaveBeenCalledTimes(1);

        await coordinator.discardPending();
        expect(onDiscard).toHaveBeenCalledTimes(1);

        releaseSave();
        await Promise.resolve();
        vi.useRealTimers();
    });
});
