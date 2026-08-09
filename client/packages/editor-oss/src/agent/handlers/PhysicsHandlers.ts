import * as THREE from "three";

import EngineRuntime from "../../EngineRuntime";
import {getPhysics} from "../../physics/common/getPhysics";
import {isPhysicsEngineType, PhysicsEngineType} from "../../physics/common/types";
import {PhysicsEngineFactory} from "../../physics/PhysicsEngineFactory";
import {findObjectByUuidOrNameDepthFirst} from "../../utils/SceneTraverser";
import {CommandResult} from "../types/ACPTypes";

const VALID_PHYSICS_ENGINES = Object.values(PhysicsEngineType);

function normalizePhysicsEngineInput(value: unknown): PhysicsEngineType | null {
    if (typeof value !== "string") return null;
    const lowered = value.trim().toLowerCase();
    return isPhysicsEngineType(lowered) ? lowered : null;
}

/**
 * Physics command handlers for CommandsRegistry
 */
export class PhysicsHandlers {
    constructor(private engine: EngineRuntime) {}

    async handleEnablePhysics({
        target,
        config,
        shape,
        ctype,
        mass,
        friction,
        restitution,
    }: {
        target: string;
        config?: Record<string, unknown>;
        shape?: string;
        ctype?: string;
        mass?: number;
        friction?: number;
        restitution?: number;
    }): Promise<CommandResult> {
        try {
            const object = this.findObject(target);
            if (!object) {
                return {
                    status: "failed",
                    message: `Object not found: ${target}`,
                    data: null,
                };
            }

            if (!this.isPhysicsCompatible(object)) {
                return {
                    status: "failed",
                    message: `"${target}" is a light or camera and cannot have physics. Use a mesh or group instead.`,
                    data: null,
                };
            }

            // Enable physics in userData
            if (!object.userData.physics) {
                object.userData.physics = {};
            }
            const directConfig = this.compactObject({shape, ctype, mass, friction, restitution});
            const hasConfig = Object.keys(directConfig).length > 0 || !!config;
            object.userData.physics = hasConfig
                ? getPhysics({
                    ...object.userData.physics,
                    ...(config || {}),
                    ...directConfig,
                    enabled: true,
                }, object)
                : {
                    ...object.userData.physics,
                    enabled: true,
                };

            // Add object to physics engine
            await this.engine.physics?.addObject(object);

            // Notify that object changed
            this.engine.call("objectChanged", this, object);

            return {
                status: "success",
                message: `Physics enabled for ${object.name || target}`,
                data: {
                    uuid: object.uuid,
                    name: object.name,
                    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                    physics: object.userData.physics,
                },
            };
        } catch (error) {
            return {
                status: "failed",
                message: `Failed to enable physics: ${error instanceof Error ? error.message : String(error)}`,
                data: null,
            };
        }
    }

    async handleDisablePhysics({target}: {target: string}): Promise<CommandResult> {
        try {
            const object = this.findObject(target);
            if (!object) {
                return {
                    status: "failed",
                    message: `Object not found: ${target}`,
                    data: null,
                };
            }

            if (!this.isPhysicsCompatible(object)) {
                return {
                    status: "failed",
                    message: `"${target}" is a light or camera and cannot have physics. Use a mesh or group instead.`,
                    data: null,
                };
            }

            // Disable physics in userData
            if (!object.userData.physics) {
                object.userData.physics = {};
            }
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
            object.userData.physics.enabled = false;

            // Remove object from physics engine
            this.engine.physics?.removeObject(object);

            // Notify that object changed
            this.engine.call("objectChanged", this, object);

            return {
                status: "success",
                message: `Physics disabled for ${object.name || target}`,
                data: {
                    uuid: object.uuid,
                    name: object.name,
                    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                    physics: object.userData.physics,
                },
            };
        } catch (error) {
            return {
                status: "failed",
                message: `Failed to disable physics: ${error instanceof Error ? error.message : String(error)}`,
                data: null,
            };
        }
    }

    async handleSetPhysics({
        target,
        config,
        enabled,
        shape,
        ctype,
        mass,
        friction,
        restitution,
    }: {
        target: string;
        config?: Record<string, unknown>;
        enabled?: boolean;
        shape?: string;
        ctype?: string;
        mass?: number;
        friction?: number;
        restitution?: number;
    }): Promise<CommandResult> {
        try {
            const object = this.findObject(target);
            if (!object) {
                return {
                    status: "failed",
                    message: `Object not found: ${target}`,
                    data: null,
                };
            }

            if (!this.isPhysicsCompatible(object)) {
                return {
                    status: "failed",
                    message: `"${target}" is a light or camera and cannot have physics. Use a mesh or group instead.`,
                    data: null,
                };
            }

            // Initialize physics if not exists
            if (!object.userData.physics) {
                object.userData.physics = {};
            }

            // Merge new config with existing physics data
            const directConfig = this.compactObject({enabled, shape, ctype, mass, friction, restitution});
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
            object.userData.physics = {
                ...object.userData.physics,
                ...(config || {}),
                ...directConfig,
            };

            // Validate and complete physics data
            object.userData.physics = getPhysics(object.userData.physics);

            // If physics is enabled, refresh the object in physics engine
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
            if (object.userData.physics.enabled) {
                this.engine.physics?.removeObject(object);
                await this.engine.physics?.addObject(object);
            }

            // Notify that object changed
            this.engine.call("objectChanged", this, object);

            return {
                status: "success",
                message: `Physics configured for ${object.name || target}`,
                data: {
                    uuid: object.uuid,
                    name: object.name,
                    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                    physics: object.userData.physics,
                },
            };
        } catch (error) {
            return {
                status: "failed",
                message: `Failed to set physics: ${error instanceof Error ? error.message : String(error)}`,
                data: null,
            };
        }
    }

    /**
     * Set the scene-level physics engine (and optionally gravity).
     * Writes scene.userData.physics.engine and scene.userData.physics.gravity.
     * The change takes effect at next scene load — existing physics bodies keep running
     * under whichever engine was active when the scene loaded.
     */
    async handleSetPhysicsEngine({
        type,
        gravity,
    }: {
        type: string;
        gravity?: number;
    }): Promise<CommandResult> {
        try {
            const engine = normalizePhysicsEngineInput(type);
            if (!engine) {
                return {
                    status: "failed",
                    message: `Invalid physics engine "${type}". Valid values: ${VALID_PHYSICS_ENGINES.join(", ")}`,
                    data: null,
                };
            }

            if (gravity !== undefined && typeof gravity !== "number") {
                return {
                    status: "failed",
                    message: `Invalid gravity "${String(gravity)}": must be a number (negative = down; Earth-like is -9.81)`,
                    data: null,
                };
            }

            const scene = this.engine.scene;
            const physicsData: Record<string, unknown> =
                (scene.userData.physics as Record<string, unknown> | undefined) ?? {};
            physicsData.engine = engine;
            if (gravity !== undefined) {
                physicsData.gravity = gravity;
            }
            scene.userData.physics = physicsData;

            // Kick off a preload of the chosen engine's WASM so the next scene load is faster
            PhysicsEngineFactory.preload(engine).catch(() => {
                /* preload is best-effort */
            });

            // Let the editor know scene settings changed so it can re-render panels
            this.engine.call("sceneGraphChanged", this, null);

            return {
                status: "success",
                message:
                    gravity !== undefined
                        ? `Physics engine set to ${engine} with gravity ${gravity} (takes effect on next scene load)`
                        : `Physics engine set to ${engine} (takes effect on next scene load)`,
                data: {
                    engine,
                    gravity: physicsData.gravity,
                },
            };
        } catch (error) {
            return {
                status: "failed",
                message: `Failed to set physics engine: ${error instanceof Error ? error.message : String(error)}`,
                data: null,
            };
        }
    }

    handleGetPhysicsSettings({target}: {target: string}): CommandResult {
        const object = this.findObject(target);
        if (!object) {
            return {
                status: "failed",
                message: `Object not found: ${target}`,
                data: null,
            };
        }

        return {
            status: "success",
            message: `Physics settings for ${object.name || target} retrieved successfully`,
            data: {
                uuid: object.uuid,
                name: object.name,
                physics: object.userData?.physics ?? null,
            },
        };
    }

    private isPhysicsCompatible(object: THREE.Object3D): boolean {
        const flags = object as THREE.Object3D & {isLight?: boolean; isCamera?: boolean};
        return !flags.isLight && !flags.isCamera;
    }

    private findObject(identifier: string): THREE.Object3D | null {
        return findObjectByUuidOrNameDepthFirst(this.engine.scene, identifier);
    }

    private compactObject<T extends Record<string, unknown>>(value: T): Partial<T> {
        return Object.fromEntries(
            Object.entries(value).filter(([, entry]) => entry !== undefined),
        ) as Partial<T>;
    }
}
