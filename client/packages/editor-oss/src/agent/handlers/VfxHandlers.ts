import * as THREE from "three";
import {
    ParticleEmitter,
    ParticleSystem,
    ConstantValue,
    IntervalValue,
    PiecewiseBezier,
    Bezier,
    ConstantColor,
    ColorRange,
    RandomColor,
    Gradient,
    RandomColorBetweenGradient,
    Vector3,
    Vector4,
    PointEmitter,
    SphereEmitter,
    ConeEmitter,
    DonutEmitter,
    CircleEmitter,
    HemisphereEmitter,
    GridEmitter,
    RandomQuatGenerator,
    AxisAngleGenerator,
    EulerGenerator,
    BehaviorTypes,
    Behavior,
} from "three.quarks";

import {AssetType} from "@stem/network/api/asset";
import {setAssetRevision} from "../../asset-management/AssetResolutionContext";
import {createAsset} from "../../editor/asset-management/hooks/assets";
import EngineRuntime from "../../EngineRuntime";
import {DEFAULT_PARTICLE_CONFIG} from "../../services";
import {findObjectByUuidOrNameDepthFirst} from "../../utils/SceneTraverser";
import {setVfxId} from "../../vfx/util";
import {CommandResult} from "../types/ACPTypes";

// Type definition for ParticleSystemParameters (inferred from three.quarks)
type ParticleSystemParameters = typeof DEFAULT_PARTICLE_CONFIG;
type AgentParticleSystemConfig = Partial<ParticleSystemParameters> & {
    emitterShape?: unknown;
};

/**
 * VFX (Particle Effects) command handlers for CommandsRegistry
 */
export class VFXHandlers {
    constructor(private engine: EngineRuntime) {}

    private extractAutoStartFlag(config?: Record<string, unknown>): boolean | undefined {
        if (!config) return undefined;

        const value = config.autoStart ?? config.autoplay ?? config.autoPlay;
        if (typeof value === "boolean") return value;
        return undefined;
    }

    private applyAutoStartFlag(emitter: ParticleEmitter, enabled: boolean | undefined): void {
        if (enabled === undefined) return;

        emitter.userData.autoStart = enabled;
        emitter.userData.autoplay = enabled;
        emitter.userData.autoPlay = enabled;
    }

    async handleAddVFX({
        name,
        position,
        rotation,
        scale,
        parent,
        config,
    }: {
        name: string;
        position?: {x: number; y: number; z: number};
        rotation?: {x: number; y: number; z: number};
        scale?: {x: number; y: number; z: number};
        parent?: string;
        config?: AgentParticleSystemConfig;
    }): Promise<CommandResult> {
        try {
            const Commands = await import("../../command/Commands");
            const autoStart = this.extractAutoStartFlag(config);

            // Get preset config if specified
            let systemConfig = {...DEFAULT_PARTICLE_CONFIG};

            // Merge with custom config
            if (config) {
                const sanitizedConfig = {...config} as Record<string, unknown>;
                delete sanitizedConfig.autoStart;
                delete sanitizedConfig.autoplay;
                delete sanitizedConfig.autoPlay;

                const deserializedConfig = this.deserializeConfig(sanitizedConfig);
                systemConfig = {...systemConfig, ...deserializedConfig};
            }

            // Create particle system
            const particleSystem = new ParticleSystem(systemConfig);
            const emitter = new ParticleEmitter(particleSystem);
            emitter.name = name;
            this.applyAutoStartFlag(emitter, autoStart);

            // Set transform
            if (position) {
                emitter.position.set(position.x ?? 0, position.y ?? 0, position.z ?? 0);
            }
            if (rotation) {
                emitter.rotation.set(rotation.x ?? 0, rotation.y ?? 0, rotation.z ?? 0);
            }
            if (scale) {
                emitter.scale.set(scale.x ?? 1, scale.y ?? 1, scale.z ?? 1);
            }

            // Find parent object
            let parentObj: THREE.Object3D | undefined;
            if (parent) {
                parentObj = this.findObject(parent) || undefined;
            }

            // Add to scene
            await new Commands.AddObjectCommand(emitter, parentObj).execute();

            // Keep Script Tool-created VFX visible in Particle Effects library by persisting as scene Quarks asset.
            await this.registerVFXAsset(emitter);

            return {
                status: "success",
                message: `VFX "${name}" created successfully`,
                data: this.serializeVFX(emitter),
            };
        } catch (error) {
            return {
                status: "failed",
                message: `Failed to create VFX: ${error instanceof Error ? error.message : String(error)}`,
                data: null,
            };
        }
    }

    private async registerVFXAsset(emitter: ParticleEmitter): Promise<void> {
        const editor = this.engine.editor;
        const assetSource = editor?.assetSource;

        if (!editor || !assetSource) {
            return;
        }

        try {
            const serialized = editor.serializeObject(emitter);
            const asset = await createAsset({
                assetSource,
                type: AssetType.Quarks,
                name: emitter.name,
                data: JSON.stringify(serialized),
                format: "quarks",
                contentType: "application/json",
            });

            emitter.userData.isVFX = true;
            setVfxId(emitter, asset.id);

            setAssetRevision(this.engine.scene, asset.id, asset.headRevisionId);
            this.engine.call("finishedModelUpload", editor);
        } catch (error) {
            console.error("Failed to register VFX asset after add_vfx:", error);
        }
    }

    async handleModifyVFX({
        target,
        position,
        rotation,
        scale,
        config,
        action,
    }: {
        target: string;
        position?: {x: number; y: number; z: number};
        rotation?: {x: number; y: number; z: number};
        scale?: {x: number; y: number; z: number};
        config?: AgentParticleSystemConfig;
        action?: "play" | "stop" | "pause" | "restart";
    }): Promise<CommandResult> {
        try {
            const emitter = this.findVFXEmitter(target);
            if (!emitter) {
                return {
                    status: "failed",
                    message: `VFX emitter not found: ${target}`,
                    data: null,
                };
            }

            const Commands = await import("../../command/Commands");
            const system = emitter.system as ParticleSystem;

            // Update transform
            if (position) {
                new Commands.SetPositionCommand(
                    emitter,
                    new THREE.Vector3(
                        position.x ?? emitter.position.x,
                        position.y ?? emitter.position.y,
                        position.z ?? emitter.position.z,
                    ),
                ).execute();
            }

            if (rotation) {
                new Commands.SetRotationCommand(
                    emitter,
                    new THREE.Euler(
                        rotation.x ?? emitter.rotation.x,
                        rotation.y ?? emitter.rotation.y,
                        rotation.z ?? emitter.rotation.z,
                    ),
                ).execute();
            }

            if (scale) {
                new Commands.SetScaleCommand(
                    emitter,
                    new THREE.Vector3(
                        scale.x ?? emitter.scale.x,
                        scale.y ?? emitter.scale.y,
                        scale.z ?? emitter.scale.z,
                    ),
                ).execute();
            }

            // Apply particle system config updates
            if (config) {
                const autoStart = this.extractAutoStartFlag(config);
                const sanitizedConfig = {...config} as Record<string, unknown>;
                delete sanitizedConfig.autoStart;
                delete sanitizedConfig.autoplay;
                delete sanitizedConfig.autoPlay;

                const deserializedConfig = this.deserializeConfig(sanitizedConfig);
                if (Object.prototype.hasOwnProperty.call(deserializedConfig, "shape")) {
                    system.emitterShape = (deserializedConfig as any).shape;
                    delete (system as any).shape;
                    delete (deserializedConfig as any).shape;
                }
                Object.assign(system, deserializedConfig);
                this.applyAutoStartFlag(emitter, autoStart);
            }

            // Handle playback actions
            if (action) {
                switch (action) {
                    case "play":
                        if (system.paused) {
                            system.play();
                        } else {
                            system.restart();
                        }
                        break;
                    case "stop":
                        system.stop();
                        break;
                    case "pause":
                        system.pause();
                        break;
                    case "restart":
                        system.restart();
                        break;
                }
            }

            // Notify changes
            this.engine.call("objectChanged", this, emitter);

            return {
                status: "success",
                message: `VFX "${target}" modified successfully`,
                data: this.serializeVFX(emitter),
            };
        } catch (error) {
            return {
                status: "failed",
                message: `Failed to modify VFX: ${error instanceof Error ? error.message : String(error)}`,
                data: null,
            };
        }
    }

    async handleDeleteVFX({target}: {target: string}): Promise<CommandResult> {
        try {
            const emitter = this.findVFXEmitter(target);
            if (!emitter) {
                return {
                    status: "failed",
                    message: `VFX emitter not found: ${target}`,
                    data: null,
                };
            }

            const Commands = await import("../../command/Commands");

            // Remove from scene
            await new Commands.RemoveObjectCommand(emitter).execute();

            return {
                status: "success",
                message: `VFX "${target}" deleted successfully`,
                data: null,
            };
        } catch (error) {
            return {
                status: "failed",
                message: `Failed to delete VFX: ${error instanceof Error ? error.message : String(error)}`,
                data: null,
            };
        }
    }

    handleGetVFX({target}: {target: string}): CommandResult {
        try {
            const emitter = this.findVFXEmitter(target);
            if (!emitter) {
                return {
                    status: "failed",
                    message: `VFX emitter not found: ${target}`,
                    data: null,
                };
            }

            return {
                status: "success",
                message: `VFX "${target}" retrieved successfully`,
                data: this.serializeVFX(emitter),
            };
        } catch (error) {
            return {
                status: "failed",
                message: `Failed to get VFX: ${error instanceof Error ? error.message : String(error)}`,
                data: null,
            };
        }
    }

    handleAddVFXBehavior({
        target,
        behaviorType,
        config,
    }: {
        target: string;
        behaviorType: string;
        config: Record<string, unknown>;
    }): CommandResult {
        try {
            const emitter = this.findVFXEmitter(target);
            if (!emitter) {
                return {
                    status: "failed",
                    message: `VFX emitter not found: ${target}`,
                    data: null,
                };
            }

            const system = emitter.system as ParticleSystem;

            // Create behavior based on type
            const behavior = this.createBehavior(behaviorType, config);
            if (!behavior) {
                return {
                    status: "failed",
                    message: `Unknown behavior type: ${behaviorType}`,
                    data: null,
                };
            }

            // Add behavior to system
            system.addBehavior(behavior as Behavior);

            // Notify changes
            this.engine.call("objectChanged", this, emitter);

            return {
                status: "success",
                message: `Behavior "${behaviorType}" added to VFX "${target}"`,
                data: this.serializeVFX(emitter),
            };
        } catch (error) {
            return {
                status: "failed",
                message: `Failed to add behavior: ${error instanceof Error ? error.message : String(error)}`,
                data: null,
            };
        }
    }

    handleRemoveVFXBehavior({target, behaviorIndex}: {target: string; behaviorIndex: number}): CommandResult {
        try {
            const emitter = this.findVFXEmitter(target);
            if (!emitter) {
                return {
                    status: "failed",
                    message: `VFX emitter not found: ${target}`,
                    data: null,
                };
            }

            const system = emitter.system as ParticleSystem;

            if (behaviorIndex < 0 || behaviorIndex >= system.behaviors.length) {
                return {
                    status: "failed",
                    message: `Invalid behavior index: ${behaviorIndex}`,
                    data: null,
                };
            }

            // Remove behavior
            system.behaviors.splice(behaviorIndex, 1);

            // Notify changes
            this.engine.call("objectChanged", this, emitter);

            return {
                status: "success",
                message: `Behavior at index ${behaviorIndex} removed from VFX "${target}"`,
                data: this.serializeVFX(emitter),
            };
        } catch (error) {
            return {
                status: "failed",
                message: `Failed to remove behavior: ${error instanceof Error ? error.message : String(error)}`,
                data: null,
            };
        }
    }

    // Helper methods

    private findObject(identifier: string): THREE.Object3D | null {
        return findObjectByUuidOrNameDepthFirst(this.engine.scene, identifier);
    }

    private findVFXEmitter(identifier: string): ParticleEmitter | null {
        const object = this.findObject(identifier);
        if (object && object instanceof ParticleEmitter) {
            return object;
        }
        return null;
    }

    private serializeVFX(emitter: ParticleEmitter): Record<string, unknown> {
        const system = emitter.system as ParticleSystem;
        return {
            uuid: emitter.uuid,
            name: emitter.name,
            type: "ParticleEmitter",
            position: {x: emitter.position.x, y: emitter.position.y, z: emitter.position.z},
            rotation: {x: emitter.rotation.x, y: emitter.rotation.y, z: emitter.rotation.z},
            scale: {x: emitter.scale.x, y: emitter.scale.y, z: emitter.scale.z},
            system: {
                duration: system.duration,
                looping: system.looping,
                worldSpace: system.worldSpace,
                autoDestroy: system.autoDestroy,
                prewarm: system.prewarm,
                emissionOverTime: this.serializeValueGenerator(system.emissionOverTime),
                behaviors: system.behaviors.map((b, index) => ({
                    index,
                    type: b.type,
                })),
            },
            userData: emitter.userData || {},
        };
    }

    private serializeValueGenerator(generator: unknown): unknown {
        if (!generator) return null;

        // Handle ConstantValue
        if ((generator as any).type === "ConstantValue") {
            return {type: "ConstantValue", value: (generator as any).value};
        }

        // Handle IntervalValue
        if ((generator as any).type === "IntervalValue") {
            return {type: "IntervalValue", a: (generator as any).a, b: (generator as any).b};
        }

        return generator;
    }

    private createBehavior(behaviorType: string, config: Record<string, unknown>): unknown {
        const entry = BehaviorTypes[behaviorType];
        if (!entry) {
            return null;
        }

        const args: unknown[] = [];
        const params = entry.params as Array<[string, string | string[]]>;

        for (let i = 0; i < params.length; i++) {
            const param = params[i];
            if (!param) continue;
            const paramName = param[0];
            const paramType = param[1];
            const arrOfTypes = Array.isArray(paramType) ? paramType : [paramType];

            // Check if config has a value for this parameter
            const configValue = config[paramName];

            arrOfTypes.forEach(type => {
                let value;

                // If config has a value for this parameter, deserialize it
                if (configValue !== undefined) {
                    switch (type) {
                        case "number":
                            value = typeof configValue === "number" ? configValue : 1;
                            break;
                        case "vec3":
                            if (Array.isArray(configValue)) {
                                value = new Vector3(...(configValue as [number, number, number]));
                            } else if (typeof configValue === "object" && configValue !== null) {
                                const v = configValue as any;
                                value = new Vector3(v.x ?? 1, v.y ?? 1, v.z ?? 1);
                            } else {
                                value = new Vector3(1, 1, 1);
                            }
                            break;
                        case "rotationFunc":
                            if (typeof configValue === "object" && configValue !== null) {
                                value = this.deserializeRotation(configValue);
                            } else {
                                value = new AxisAngleGenerator(new Vector3(0, 1, 0), new ConstantValue(0));
                            }
                            break;
                        case "valueFunc":
                        case "value":
                            if (typeof configValue === "object" && configValue !== null) {
                                value = this.deserializeValueGenerator(configValue);
                            } else if (typeof configValue === "number") {
                                value = new ConstantValue(configValue);
                            } else {
                                value =
                                    type === "valueFunc"
                                        ? new PiecewiseBezier([[new Bezier(0, 0.3333, 0.6667, 1.0), 0]])
                                        : new ConstantValue(1);
                            }
                            break;
                        case "colorFunc":
                            if (typeof configValue === "object" && configValue !== null) {
                                value = this.deserializeColor(configValue);
                            } else {
                                value = new ColorRange(
                                    new Vector4(1.0, 1.0, 1.0, 1.0),
                                    new Vector4(0.0, 0.0, 0.0, 1.0),
                                );
                            }
                            break;
                        case "boolean":
                            value = typeof configValue === "boolean" ? configValue : false;
                            break;
                        case "self":
                            // For behaviors that need particle system reference
                            value = configValue ?? null;
                            break;
                        case "particleSystem":
                        case "mesh":
                            value = configValue ?? undefined;
                            break;
                        default:
                            value = configValue;
                    }
                } else {
                    // Use default values if config doesn't have this parameter
                    switch (type) {
                        case "number":
                            value = 1;
                            break;
                        case "vec3":
                            value = new Vector3(1, 1, 1);
                            break;
                        case "rotationFunc":
                            value = new AxisAngleGenerator(new Vector3(0, 1, 0), new ConstantValue(0));
                            break;
                        case "valueFunc":
                            value = new PiecewiseBezier([[new Bezier(0, 0.3333, 0.6667, 1.0), 0]]);
                            break;
                        case "value":
                            value = new ConstantValue(1);
                            break;
                        case "colorFunc":
                            value = new ColorRange(new Vector4(1.0, 1.0, 1.0, 1.0), new Vector4(0.0, 0.0, 0.0, 1.0));
                            break;
                        case "boolean":
                            value = false;
                            break;
                        case "self":
                            value = null;
                            break;
                        case "particleSystem":
                        case "mesh":
                            value = undefined;
                            break;
                        default:
                            value = undefined;
                    }
                }

                args.push(value);
            });
        }

        try {
            const behavior = new entry.constructor(...(args));
            return behavior;
        } catch (error) {
            console.error(`Failed to create behavior ${behaviorType}:`, error);
            return null;
        }
    }

    private static readonly VALUE_GENERATOR_FIELDS: ReadonlyArray<string> = [
        "emissionOverTime",
        "emissionOverDistance",
        "startLife",
        "startSpeed",
        "startSize",
        "startLength",
        "startRotation",
        "startTileIndex",
    ];

    private static readonly SUPPORTED_SHAPE_TYPES: ReadonlyArray<string> = [
        "point",
        "PointEmitter",
        "circle",
        "CircleEmitter",
        "cone",
        "ConeEmitter",
        "sphere",
        "SphereEmitter",
        "hemisphere",
        "HemisphereEmitter",
        "donut",
        "DonutEmitter",
        "grid",
        "GridEmitter",
        "mesh_surface",
        "MeshSurfaceEmitter",
    ];

    private normalizeShapeConfig(config: AgentParticleSystemConfig): Partial<ParticleSystemParameters> {
        if (!Object.prototype.hasOwnProperty.call(config, "emitterShape")) {
            return config;
        }

        const normalized = {...config} as Record<string, unknown>;
        if (normalized.shape === undefined) {
            normalized.shape = normalized.emitterShape;
        }
        delete normalized.emitterShape;
        return normalized;
    }

    private getShapeValidationError(config: Partial<ParticleSystemParameters>): string | null {
        const shape = config.shape;
        if (shape === undefined || shape === null) {
            return null;
        }

        if (typeof shape !== "object") {
            return (
                `"shape": got ${typeof shape} (${JSON.stringify(shape)}), expected either an emitter instance ` +
                `(object with toJSON()) or a serialized emitter descriptor like {"type":"PointEmitter"} or ` +
                `{"type":"CircleEmitter","radius":1}.`
            );
        }

        const hasToJSON = typeof (shape as any).toJSON === "function";
        const shapeType = (shape as any).type;
        const hasSupportedType =
            typeof shapeType === "string" && VFXHandlers.SUPPORTED_SHAPE_TYPES.includes(shapeType);

        if (!hasToJSON && !hasSupportedType) {
            return (
                `"shape": got ${JSON.stringify(shape)}, expected either an emitter instance ` +
                `(object with toJSON()) or a serialized emitter descriptor with one of ` +
                `${VFXHandlers.SUPPORTED_SHAPE_TYPES.join(", ")}.`
            );
        }

        return null;
    }

    private validateVfxConfig(config: Partial<ParticleSystemParameters>): void {
        const invalid: string[] = [];
        for (const field of VFXHandlers.VALUE_GENERATOR_FIELDS) {
            const value = (config as any)[field];
            if (value === undefined || value === null) {
                continue;
            }

            // Reject bare primitives (number, string, boolean, etc.)
            if (typeof value !== "object") {
                invalid.push(
                    `"${field}": got ${typeof value} (${JSON.stringify(value)}), ` +
                    `expected object e.g. {"type":"value","value":${JSON.stringify(value)}}`,
                );
                continue;
            }

            // At this point value is a non-null object.
            const hasToJSON = typeof (value).toJSON === "function";
            const hasType = typeof (value).type === "string";

            // Only accept either a generator instance (with toJSON) or a serialized generator (with "type").
            if (!hasToJSON && !hasType) {
                invalid.push(
                    `"${field}": got ${JSON.stringify(value)}, expected either a generator instance ` +
                    `(object with toJSON()) or a serialized generator object with a "type" string.`,
                );
            }
        }

        const shapeError = this.getShapeValidationError(config);
        if (shapeError) {
            invalid.push(shapeError);
        }

        if (invalid.length > 0) {
            throw new Error(
                `VFX config contains invalid serialized fields — these cause "toJSON is not a function" at runtime.\n` +
                invalid.join("\n") + "\n" +
                `Use either a generator instance or a serialized form like {"type":"value","value":X} or ` +
                `{"type":"randomBetweenTwoConstants","a":X,"b":Y}. For emitter shapes, use ` +
                `config.shape with a typed object like {"type":"PointEmitter"} or {"type":"SphereEmitter","radius":1}. ` +
                `Legacy config.emitterShape is normalized automatically.`,
            );
        }
    }

    private deserializeConfig(config: AgentParticleSystemConfig): Partial<ParticleSystemParameters> {
        const normalizedConfig = this.normalizeShapeConfig(config);
        this.validateVfxConfig(normalizedConfig);
        const result: any = {...normalizedConfig};

        // Deserialize value generators
        if (normalizedConfig.startLife && typeof normalizedConfig.startLife === "object") {
            result.startLife = this.deserializeValueGenerator(normalizedConfig.startLife as any);
        }
        if (normalizedConfig.startSpeed && typeof normalizedConfig.startSpeed === "object") {
            result.startSpeed = this.deserializeValueGenerator(normalizedConfig.startSpeed as any);
        }
        if (normalizedConfig.startSize && typeof normalizedConfig.startSize === "object") {
            result.startSize = this.deserializeValueGenerator(normalizedConfig.startSize as any);
        }
        if (normalizedConfig.startLength && typeof normalizedConfig.startLength === "object") {
            result.startLength = this.deserializeValueGenerator(normalizedConfig.startLength as any);
        }
        if (normalizedConfig.startRotation && typeof normalizedConfig.startRotation === "object") {
            // Check if it's a rotation generator (RandomQuatGenerator, AxisAngleGenerator, EulerGenerator)
            // or a value generator (ConstantValue, IntervalValue, PiecewiseBezier)
            const rotationType = (normalizedConfig.startRotation as any).type;
            if (
                rotationType === "RandomQuatGenerator" ||
                rotationType === "AxisAngleGenerator" ||
                rotationType === "EulerGenerator"
            ) {
                result.startRotation = this.deserializeRotation(normalizedConfig.startRotation as any);
            } else {
                result.startRotation = this.deserializeValueGenerator(normalizedConfig.startRotation as any);
            }
        }
        if (normalizedConfig.emissionOverTime && typeof normalizedConfig.emissionOverTime === "object") {
            result.emissionOverTime = this.deserializeValueGenerator(normalizedConfig.emissionOverTime as any);
        }
        if (normalizedConfig.emissionOverDistance && typeof normalizedConfig.emissionOverDistance === "object") {
            result.emissionOverDistance = this.deserializeValueGenerator(normalizedConfig.emissionOverDistance as any);
        }
        if (normalizedConfig.startTileIndex && typeof normalizedConfig.startTileIndex === "object") {
            result.startTileIndex = this.deserializeValueGenerator(normalizedConfig.startTileIndex as any);
        }

        // Deserialize colors
        if (normalizedConfig.startColor && typeof normalizedConfig.startColor === "object") {
            result.startColor = this.deserializeColor(normalizedConfig.startColor as any);
        }

        // Deserialize shape
        if (normalizedConfig.shape !== undefined) {
            result.shape = this.deserializeShapeConfig(normalizedConfig.shape);
        }

        // Deserialize material
        if (normalizedConfig.material && typeof normalizedConfig.material === "object") {
            result.material = this.deserializeMaterial(normalizedConfig.material as any);
        }

        // Deserialize emission bursts
        if (normalizedConfig.emissionBursts && Array.isArray(normalizedConfig.emissionBursts)) {
            result.emissionBursts = normalizedConfig.emissionBursts.map((burst: any) => ({
                time: burst.time ?? 0,
                count:
                    burst.count && typeof burst.count === "object"
                        ? this.deserializeValueGenerator(burst.count)
                        : new ConstantValue(burst.count ?? 1),
                cycle: burst.cycle ?? 1,
                interval: burst.interval ?? 0.01,
                probability: burst.probability ?? 1,
            }));
        }

        // Deserialize behaviors
        if (normalizedConfig.behaviors && Array.isArray(normalizedConfig.behaviors)) {
            result.behaviors = normalizedConfig.behaviors
                .map((behavior: any) => this.createBehavior(behavior.type, behavior))
                .filter(b => b !== null);
        }

        // Handle simple numeric/boolean properties
        if (typeof normalizedConfig.renderMode === "number") {
            result.renderMode = normalizedConfig.renderMode;
        }
        if (typeof normalizedConfig.autoDestroy === "boolean") {
            result.autoDestroy = normalizedConfig.autoDestroy;
        }
        if (typeof normalizedConfig.looping === "boolean") {
            result.looping = normalizedConfig.looping;
        }
        if (typeof normalizedConfig.prewarm === "boolean") {
            result.prewarm = normalizedConfig.prewarm;
        }
        if (typeof normalizedConfig.duration === "number") {
            result.duration = normalizedConfig.duration;
        }
        if (typeof normalizedConfig.worldSpace === "boolean") {
            result.worldSpace = normalizedConfig.worldSpace;
        }
        if (typeof normalizedConfig.onlyUsedByOther === "boolean") {
            result.onlyUsedByOther = normalizedConfig.onlyUsedByOther;
        }
        if (typeof normalizedConfig.speedFactor === "number") {
            result.speedFactor = normalizedConfig.speedFactor;
        }
        if (typeof normalizedConfig.renderOrder === "number") {
            result.renderOrder = normalizedConfig.renderOrder;
        }
        if (typeof normalizedConfig.uTileCount === "number") {
            result.uTileCount = normalizedConfig.uTileCount;
        }
        if (typeof normalizedConfig.vTileCount === "number") {
            result.vTileCount = normalizedConfig.vTileCount;
        }
        if (typeof normalizedConfig.blendTiles === "boolean") {
            result.blendTiles = normalizedConfig.blendTiles;
        }
        if (typeof normalizedConfig.softParticles === "boolean") {
            result.softParticles = normalizedConfig.softParticles;
        }
        if (typeof normalizedConfig.softFarFade === "number") {
            result.softFarFade = normalizedConfig.softFarFade;
        }
        if (typeof normalizedConfig.softNearFade === "number") {
            result.softNearFade = normalizedConfig.softNearFade;
        }
        if (normalizedConfig.rendererEmitterSettings) {
            result.rendererEmitterSettings = this.deserializeRendererEmitterSettings(
                normalizedConfig.rendererEmitterSettings as any,
            );
        }

        return result;
    }

    private deserializeShapeConfig(shape: unknown): unknown {
        if (!shape || typeof shape !== "object") {
            return shape;
        }

        if (typeof (shape as any).toJSON === "function") {
            return shape;
        }

        if (typeof (shape as any).type === "string") {
            return this.deserializeShape(shape as any);
        }

        throw new Error(
            `Invalid VFX shape config: expected an emitter instance with toJSON() or a typed object such as ` +
            `{"type":"PointEmitter"} or {"type":"CircleEmitter","radius":1}.`,
        );
    }

    private deserializeValueGenerator(obj: any): any {
        if (!obj || !obj.type) return obj;

        switch (obj.type) {
            case "ConstantValue":
                return new ConstantValue(obj.value ?? 0);
            case "IntervalValue":
                return new IntervalValue(obj.a ?? 0, obj.b ?? 1);
            case "PiecewiseBezier":
                if (obj.functions && Array.isArray(obj.functions)) {
                    const curves = obj.functions.map((f: any) => {
                        const bezierData = f.function;

                        if (bezierData) {
                            const bezier = new Bezier(
                                bezierData.p0 ?? 0,
                                bezierData.p1 ?? 0,
                                bezierData.p2 ?? 1,
                                bezierData.p3 ?? 1,
                            );
                            return [bezier, f.start ?? 0];
                        }
                    });
                    return new PiecewiseBezier(curves);
                }
                return new PiecewiseBezier();
            default:
                return obj;
        }
    }

    private deserializeColor(obj: any): any {
        if (!obj || !obj.type) return obj;

        switch (obj.type) {
            case "ConstantColor":
                if (Array.isArray(obj.value)) {
                    return new ConstantColor(new Vector4(...obj.value));
                }
                if (obj.color && Array.isArray(obj.color)) {
                    return new ConstantColor(new Vector4(...obj.color));
                }
                return new ConstantColor(new Vector4(1, 1, 1, 1));
            case "ColorRange":
                if (Array.isArray(obj.a) && Array.isArray(obj.b)) {
                    return new ColorRange(new Vector4(...obj.a), new Vector4(...obj.b));
                }
                return new ConstantColor(new Vector4(1, 1, 1, 1));
            case "RandomColor":
                if (Array.isArray(obj.a) && Array.isArray(obj.b)) {
                    return new RandomColor(new Vector4(...obj.a), new Vector4(...obj.b));
                }
                return new RandomColor(new Vector4(0, 0, 0, 1), new Vector4(1, 1, 1, 1));
            case "Gradient":
                if (obj.functions && Array.isArray(obj.functions)) {
                    // Check if functions use the format: [{function: {p0: [r,g,b,a], p1: [r,g,b,a]}, start: time}, ...]
                    if (obj.functions.length > 0 && obj.functions[0].function && obj.functions[0].start !== undefined) {
                        // Extract colors (RGB) and alpha values from function bezier format
                        const colors: Array<[Vector3, number]> = [];
                        const alphaFunctions: Array<[number, number]> = [];

                        obj.functions.forEach((item: any) => {
                            const p0 = item.function.p0;
                            const start = item.start;

                            if (Array.isArray(p0) && p0.length >= 4) {
                                // p0 contains [r, g, b, a]
                                colors.push([new Vector3(p0[0], p0[1], p0[2]), start]);
                                alphaFunctions.push([p0[3], start]);
                            }
                        });

                        if (colors.length > 0 && alphaFunctions.length > 0) {
                            return new Gradient(colors, alphaFunctions);
                        }
                    }
                    // Legacy format: separate colors and functions arrays
                    else if (obj.colors && Array.isArray(obj.colors)) {
                        // Convert color arrays to [Vector3, number] tuples
                        const colors: Array<[Vector3, number]> = obj.colors.map((c: any) => {
                            if (Array.isArray(c) && c.length === 2) {
                                const [color, time] = c;
                                if (Array.isArray(color)) {
                                    return [new Vector3(...color), time];
                                }
                            }
                            return [new Vector3(1, 1, 1), 0];
                        });
                        // Convert function arrays to [number, number] tuples
                        const functions: Array<[number, number]> = obj.functions.map((f: any) => {
                            if (Array.isArray(f) && f.length === 2) {
                                return [f[0], f[1]];
                            }
                            return [1, 0];
                        });
                        return new Gradient(colors, functions);
                    }
                }
                // Default gradient
                return new Gradient(
                    [
                        [new Vector3(1, 0, 0), 0],
                        [new Vector3(1, 0, 0), 1],
                    ],
                    [
                        [1, 0],
                        [1, 1],
                    ],
                );
            case "RandomColorBetweenGradient": {
                let gradient1: Gradient;
                let gradient2: Gradient;

                if (obj.gradient1) {
                    gradient1 = this.deserializeColor(obj.gradient1) as Gradient;
                } else {
                    gradient1 = new Gradient(
                        [
                            [new Vector3(1, 0, 0), 0],
                            [new Vector3(1, 0, 0), 1],
                        ],
                        [
                            [1, 0],
                            [1, 1],
                        ],
                    );
                }

                if (obj.gradient2) {
                    gradient2 = this.deserializeColor(obj.gradient2) as Gradient;
                } else {
                    gradient2 = new Gradient(
                        [
                            [new Vector3(0, 1, 0), 0],
                            [new Vector3(0, 1, 0), 1],
                        ],
                        [
                            [1, 0],
                            [1, 1],
                        ],
                    );
                }

                return new RandomColorBetweenGradient(gradient1, gradient2);
            }
            default:
                return obj;
        }
    }

    private deserializeRotation(obj: any): any {
        if (!obj || !obj.type) return obj;

        switch (obj.type) {
            case "RandomQuatGenerator":
                return new RandomQuatGenerator();
            case "AxisAngleGenerator": {
                let axis = new Vector3(0, 1, 0);
                if (obj.axis) {
                    if (Array.isArray(obj.axis)) {
                        axis = new Vector3(...obj.axis);
                    } else if (obj.axis.x !== undefined && obj.axis.y !== undefined && obj.axis.z !== undefined) {
                        axis = new Vector3(obj.axis.x, obj.axis.y, obj.axis.z);
                    }
                }
                let angle = new ConstantValue(Math.PI / 2);
                if (obj.angle) {
                    angle = this.deserializeValueGenerator(obj.angle);
                }
                return new AxisAngleGenerator(axis, angle);
            }
            case "EulerGenerator": {
                let angleX = new ConstantValue(0);
                let angleY = new ConstantValue(0);
                let angleZ = new ConstantValue(0);

                if (obj.angleX) {
                    angleX = this.deserializeValueGenerator(obj.angleX);
                }
                if (obj.angleY) {
                    angleY = this.deserializeValueGenerator(obj.angleY);
                }
                if (obj.angleZ) {
                    angleZ = this.deserializeValueGenerator(obj.angleZ);
                }

                return new EulerGenerator(angleX, angleY, angleZ);
            }
            default:
                return obj;
        }
    }

    private deserializeShape(obj: any): any {
        if (!obj || !obj.type) return obj;

        // Helper function to deserialize speed parameter (can be valueFunc or value)
        const deserializeSpeed = (speed: any) => {
            if (!speed) return undefined;
            if (typeof speed === "object") {
                return this.deserializeValueGenerator(speed);
            } else if (typeof speed === "number") {
                return new ConstantValue(speed);
            }
            return undefined;
        };

        switch (obj.type) {
            case "point":
            case "PointEmitter":
                return new PointEmitter();

            case "circle":
            case "CircleEmitter": {
                const emitter = new CircleEmitter();
                if (obj.radius !== undefined) emitter.radius = obj.radius;
                if (obj.arc !== undefined) emitter.arc = obj.arc;
                if (obj.thickness !== undefined) emitter.thickness = obj.thickness;
                if (obj.mode !== undefined) emitter.mode = obj.mode;
                if (obj.spread !== undefined) emitter.spread = obj.spread;
                if (obj.speed !== undefined) {
                    const speed = deserializeSpeed(obj.speed);
                    if (speed) emitter.speed = speed;
                }
                return emitter;
            }

            case "cone":
            case "ConeEmitter": {
                const emitter = new ConeEmitter();
                if (obj.radius !== undefined) emitter.radius = obj.radius;
                if (obj.arc !== undefined) emitter.arc = obj.arc;
                if (obj.thickness !== undefined) emitter.thickness = obj.thickness;
                if (obj.angle !== undefined) emitter.angle = obj.angle;
                if (obj.mode !== undefined) emitter.mode = obj.mode;
                if (obj.spread !== undefined) emitter.spread = obj.spread;
                if (obj.speed !== undefined) {
                    const speed = deserializeSpeed(obj.speed);
                    if (speed) emitter.speed = speed;
                }
                return emitter;
            }

            case "sphere":
            case "SphereEmitter": {
                const emitter = new SphereEmitter();
                if (obj.radius !== undefined) emitter.radius = obj.radius;
                if (obj.arc !== undefined) emitter.arc = obj.arc;
                if (obj.thickness !== undefined) emitter.thickness = obj.thickness;
                if (obj.mode !== undefined) emitter.mode = obj.mode;
                if (obj.spread !== undefined) emitter.spread = obj.spread;
                if (obj.speed !== undefined) {
                    const speed = deserializeSpeed(obj.speed);
                    if (speed) emitter.speed = speed;
                }
                return emitter;
            }

            case "hemisphere":
            case "HemisphereEmitter": {
                const emitter = new HemisphereEmitter();
                if (obj.radius !== undefined) emitter.radius = obj.radius;
                if (obj.arc !== undefined) emitter.arc = obj.arc;
                if (obj.thickness !== undefined) emitter.thickness = obj.thickness;
                if (obj.mode !== undefined) emitter.mode = obj.mode;
                if (obj.spread !== undefined) emitter.spread = obj.spread;
                if (obj.speed !== undefined) {
                    const speed = deserializeSpeed(obj.speed);
                    if (speed) emitter.speed = speed;
                }
                return emitter;
            }

            case "donut":
            case "DonutEmitter": {
                const emitter = new DonutEmitter();
                if (obj.radius !== undefined) emitter.radius = obj.radius;
                if (obj.arc !== undefined) emitter.arc = obj.arc;
                if (obj.thickness !== undefined) emitter.thickness = obj.thickness;
                if (obj.donutRadius !== undefined) emitter.donutRadius = obj.donutRadius;
                if (obj.mode !== undefined) emitter.mode = obj.mode;
                if (obj.spread !== undefined) emitter.spread = obj.spread;
                if (obj.speed !== undefined) {
                    const speed = deserializeSpeed(obj.speed);
                    if (speed) emitter.speed = speed;
                }
                return emitter;
            }

            case "grid":
            case "GridEmitter": {
                const emitter = new GridEmitter();
                if (obj.width !== undefined) emitter.width = obj.width;
                if (obj.height !== undefined) emitter.height = obj.height;
                if (obj.rows !== undefined) emitter.row = obj.rows;
                if (obj.column !== undefined) emitter.column = obj.column;
                return emitter;
            }

            case "mesh_surface":
            case "MeshSurfaceEmitter":
                if (obj.geometry) {
                    // Geometry would need to be resolved from scene or passed as reference
                    // For now, return PointEmitter as fallback
                    return new PointEmitter();
                }
                return new PointEmitter();

            default:
                throw new Error(
                    `Unsupported VFX emitter shape type "${obj.type}". Supported types: ` +
                    `${VFXHandlers.SUPPORTED_SHAPE_TYPES.join(", ")}.`,
                );
        }
    }

    private deserializeMaterial(obj: any): any {
        if (!obj || !obj.type) return obj;

        const materialConfig: any = {...obj};
        delete materialConfig.type;

        // Convert blending string to THREE constant
        if (materialConfig.blending && typeof materialConfig.blending === "string") {
            const blendingMap: Record<string, number> = {
                NoBlending: THREE.NoBlending,
                NormalBlending: THREE.NormalBlending,
                AdditiveBlending: THREE.AdditiveBlending,
                SubtractiveBlending: THREE.SubtractiveBlending,
                MultiplyBlending: THREE.MultiplyBlending,
                CustomBlending: THREE.CustomBlending,
            };
            materialConfig.blending = blendingMap[materialConfig.blending] ?? THREE.NormalBlending;
        }

        // Handle texture map (Base64 or Percent-encoded data URL)
        if (materialConfig.map && typeof materialConfig.map === "string") {
            // Load texture from data URL (supports both base64 and percent-encoded formats)
            const texture = new THREE.TextureLoader().load(materialConfig.map);
            materialConfig.map = texture;
        }

        switch (obj.type) {
            case "MeshBasicMaterial":
                return new THREE.MeshBasicMaterial(materialConfig);
            case "MeshStandardMaterial":
                return new THREE.MeshStandardMaterial(materialConfig);
            case "SpriteMaterial":
                return new THREE.SpriteMaterial(materialConfig);
            default:
                return new THREE.MeshBasicMaterial(materialConfig);
        }
    }

    private deserializeRendererEmitterSettings(obj: any): any {
        if (!obj || !obj.type) return obj;

        const settingsType = obj.type;

        switch (settingsType) {
            case "TrailSettings": {
                const settings: any = {};

                // Deserialize startLength as ValueGenerator
                if (obj.startLength && typeof obj.startLength === "object") {
                    settings.startLength = this.deserializeValueGenerator(obj.startLength);
                }

                // Copy followLocalOrigin boolean
                if (typeof obj.followLocalOrigin === "boolean") {
                    settings.followLocalOrigin = obj.followLocalOrigin;
                }

                return settings;
            }

            case "MeshSettings": {
                const settings: any = {};

                // Deserialize rotationAxis as Vector3
                if (obj.rotationAxis) {
                    if (Array.isArray(obj.rotationAxis)) {
                        settings.rotationAxis = new THREE.Vector3(...obj.rotationAxis);
                    } else if (
                        obj.rotationAxis.x !== undefined &&
                        obj.rotationAxis.y !== undefined &&
                        obj.rotationAxis.z !== undefined
                    ) {
                        settings.rotationAxis = new THREE.Vector3(
                            obj.rotationAxis.x,
                            obj.rotationAxis.y,
                            obj.rotationAxis.z,
                        );
                    }
                }

                // Deserialize rotation value generators
                if (obj.startRotationX && typeof obj.startRotationX === "object") {
                    settings.startRotationX = this.deserializeValueGenerator(obj.startRotationX);
                }
                if (obj.startRotationY && typeof obj.startRotationY === "object") {
                    settings.startRotationY = this.deserializeValueGenerator(obj.startRotationY);
                }
                if (obj.startRotationZ && typeof obj.startRotationZ === "object") {
                    settings.startRotationZ = this.deserializeValueGenerator(obj.startRotationZ);
                }

                return settings;
            }

            case "StretchedBillBoardSettings": {
                return {
                    speedFactor: obj.speedFactor ?? 1,
                    lengthFactor: obj.lengthFactor ?? 1,
                };
            }

            case "BillBoardSettings": {
                return {};
            }

            default:
                // Pass through unknown types
                return obj;
        }
    }
}
