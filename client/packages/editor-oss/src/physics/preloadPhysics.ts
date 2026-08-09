import global from "@stem/editor-oss/global";
import { DetectDevice } from "@stem/editor-oss/utils/DetectDevice";
import { PhysicsEngineType } from "./common/types";
import { PhysicsEngineFactory } from "./PhysicsEngineFactory";
import {isInDiscordEnvironment} from "../userManagement/playerProfile/discordEnvironment";

/**
 * Decide whether play-mode physics should run inside the dedicated physics
 * worker. This must produce the same answer at preload time as at
 * `PlayerPhysics2.physicsCreate` time, otherwise we'd preload a worker that
 * the eventual run never adopts.
 *
 * Mirrors the environment and platform support gates used by
 * `PlayerPhysics2`.
 *
 * @returns true if the worker path will be taken
 */
export const shouldUsePhysicsWorker = (): boolean => {
    if (typeof Worker === "undefined") return false;
    if (DetectDevice.getOS() === "Windows") return false;
    if (global.app?.debug) return false;
    if (isInDiscordEnvironment() && process.env.NODE_ENV !== "production") return false;
    return true;
};

/**
 * Start fetching/initializing the physics engine WASM as early as possible,
 * routing to the worker realm when applicable. Errors are logged but never
 * thrown — preload failure must not break scene load. The eventual
 * `PhysicsProxy.start()` / `physics.create()` will surface real errors.
 *
 * @param engineType which engine to preload (Ammo / Rapier)
 * @param gravity gravity to feed the worker's START message (ignored on the
 *   main-thread path, since `PhysicsEngineFactory.preload` doesn't take it)
 */
export const preloadPhysics = (
    engineType: PhysicsEngineType,
    gravity: number,
    solverIterations?: number,
): Promise<void> => {
    if (shouldUsePhysicsWorker()) {
        return Promise.all([
            PhysicsEngineFactory.preloadWorker(engineType, gravity, solverIterations).then(handle => handle.ready),
            import("./worker/PhysicsProxy").then(() => undefined),
        ])
            .then(() => undefined)
            .catch((err) => {
                console.warn("preloadPhysics: worker preload failed", err);
            });
    }
    return PhysicsEngineFactory.preload(engineType).catch((err) => {
        console.warn("preloadPhysics: main-thread preload failed", err);
    });
};
