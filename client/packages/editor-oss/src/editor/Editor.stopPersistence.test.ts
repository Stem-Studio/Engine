import {afterEach, describe, expect, it, vi} from "vitest";

import {ApplicationMode, EngineRuntime} from "../EngineRuntime";
import {DebouncedSaveCoordinator} from "../persistence/DebouncedSaveCoordinator";
import {
    LocalAutosaveDirtyWatchdog,
    prepareLocalAutosaveForStop,
} from "../persistence/LocalAutosaveLifecycle";

afterEach(() => {
    vi.useRealTimers();
});

describe("Editor failed-stop autosave recovery", () => {
    it("retains Edit mode and watchdog, then observes and saves a later direct watermark mutation", async () => {
        vi.useFakeTimers();

        const scene = {userData: {lastEditTime: 10, lastSaveTime: 0}};
        const call = vi.fn();
        let storageAvailable = false;
        let isStopping = false;
        const save = vi.fn(async () => {
            if (!storageAvailable) throw new Error("storage unavailable");
            scene.userData.lastSaveTime = scene.userData.lastEditTime;
        });
        const coordinator = new DebouncedSaveCoordinator({
            debounceMs: 1_500,
            retryMs: 5_000,
            isDirty: () => scene.userData.lastEditTime > scene.userData.lastSaveTime,
            save,
        });
        const editorToken = {};
        const watchdog = new LocalAutosaveDirtyWatchdog(
            () => !isStopping && scene.userData.lastEditTime > scene.userData.lastSaveTime,
            () => {
                call("editorDirtyStateChanged", editorToken, {dirty: true});
                coordinator.markDirty();
            },
        );
        watchdog.start();

        const runtime = Object.create(EngineRuntime.prototype) as EngineRuntime;
        const enterMode = vi.fn(async () => undefined);
        Object.assign(runtime as any, {
            _mode: ApplicationMode.EDIT,
            setModePromise: Promise.resolve(),
            exitMode: vi.fn(async () =>
                prepareLocalAutosaveForStop({
                    policy: "flush",
                    coordinator,
                    watchdog,
                    hasDirtyChanges: () => scene.userData.lastEditTime > scene.userData.lastSaveTime,
                    setStopping: value => {
                        isStopping = value;
                    },
                }),
            ),
            enterMode,
        });

        await expect(runtime.setMode(ApplicationMode.PLAY)).rejects.toThrow("storage unavailable");
        expect(runtime.mode).toBe(ApplicationMode.EDIT);
        expect(enterMode).not.toHaveBeenCalled();
        expect(watchdog.isRunning).toBe(true);
        expect(isStopping).toBe(false);

        storageAvailable = true;
        scene.userData.lastEditTime = 20; // direct mutation: no objectChanged event
        await vi.advanceTimersByTimeAsync(2_000);
        expect(call).toHaveBeenCalledWith("editorDirtyStateChanged", editorToken, {dirty: true});
        await vi.advanceTimersByTimeAsync(1_500);

        expect(save).toHaveBeenCalledTimes(2);
        expect(scene.userData.lastSaveTime).toBe(20);
        watchdog.stop();
    });
});
