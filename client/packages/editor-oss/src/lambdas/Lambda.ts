import { Object3D } from "three";

import type { StemEngineInterface } from "@stem/editor-oss/behaviors/stem/StemEngineInterface";
import type GameManager from "@stem/editor-oss/behaviors/game/GameManager";

export const RAW_LAMBDA_SYMBOL = Symbol("rawLambda");

const readonlyValueProxyCache = new WeakMap<object, unknown>();

const createReadonlyValueView = <T>(value: T): T => {
    if (typeof value !== "object" || value === null) {
        return value;
    }

    const cached = readonlyValueProxyCache.get(value) as T | undefined;
    if (cached) {
        return cached;
    }

    const proxy = new Proxy(value, {
        get(target, prop, receiver) {
            return createReadonlyValueView(Reflect.get(target, prop, receiver));
        },
        set() {
            return true;
        },
        deleteProperty() {
            return true;
        },
        defineProperty() {
            return true;
        },
        setPrototypeOf() {
            return false;
        },
    });

    readonlyValueProxyCache.set(value, proxy);
    return proxy;
};

const foreignLambdaViewCache = new WeakMap<Lambda, Lambda>();

export const unwrapLambda = <T extends Lambda | null | undefined>(lambda: T): T =>
    (((lambda as any)?.[RAW_LAMBDA_SYMBOL] as T | undefined) ?? lambda);

export const createForeignLambdaView = (lambda: Lambda): Lambda => {
    if (!lambda) {
        return lambda;
    }

    const cached = foreignLambdaViewCache.get(lambda);
    if (cached) {
        return cached;
    }

    const proxy = new Proxy(lambda, {
        get(target, prop) {
            if (prop === RAW_LAMBDA_SYMBOL) {
                return target;
            }
            if (prop === "attributes") {
                return createReadonlyValueView(target.attributes);
            }

            const value = Reflect.get(target, prop, target);
            return typeof value === "function" ? value.bind(target) : value;
        },
        set(target, prop, value) {
            if (prop === "attributes") {
                return true;
            }

            return Reflect.set(target, prop, value, target);
        },
    });

    foreignLambdaViewCache.set(lambda, proxy);
    return proxy;
};

/**
 * Per-object component data stored in object.userData.lambdaComponents[]
 */
export interface LambdaComponentData {
    lambdaId: string;
    instanceId: string;
    uuid: string;
    prefabLambdaUuid?: string;
    enabled: boolean;
    /** If true, this component is automatically processed every frame at game start. Defaults to false. */
    autoApply?: boolean;
    componentData: Record<string, any>;
    /** If true, this component is never throttled by LambdaScheduler. Overrides lambda-level default. */
    isCritical?: boolean;
}

/**
 * Scene-level lambda instance data stored in scene.userData.lambdaInstances[]
 */
export interface LambdaInstanceData {
    lambdaId: string;
    instanceId: string;
    enabled: boolean;
    attributes: Record<string, any>;
}

export interface LambdaOptions {
    uuid?: string;
    attributes?: Record<string, any>;
    erth?: StemEngineInterface;
}

export interface LambdaAttributeChangeOptions {
    sync?: boolean;
}

export interface LambdaAttributeChangeResult {
    accepted: boolean;
    key: string;
    value?: any;
    previousValue?: any;
}

/**
 * Field metadata for lambda attributes/component schema.
 */
export interface LambdaFieldConfig {
    /** User-facing label shown in editor forms. */
    name: string;
    /** Form control and runtime value shape. */
    type: "number" | "boolean" | "string" | "enum";
    /** Default value used when component data is created. */
    default: any;
    /** Numeric lower bound (number fields only). */
    min?: number;
    /** Numeric upper bound (number fields only). */
    max?: number;
    /** Enum choices. Supports both labeled options and plain value lists. */
    options?: {label: string; value: string}[] | string[];
    /** Hide field from editor UI while preserving runtime support. */
    userVisible?: boolean;
}

/**
 * Lambda pack metadata loaded from `lambda.json`.
 */
export interface LambdaConfig {
    /** Stable machine ID used for serialization and lookups. */
    id: string;
    /** Human-readable name shown in the editor. */
    name: string;
    /** Short usage description shown in lambda pickers. */
    description?: string;
    /** Optional owner/author string for pack attribution. */
    author?: string;
    /** Semver version string. */
    version: string;
    /** Main class file inside the lambda pack folder. */
    main: string;
    /** Search and grouping tags (e.g. "physics", "common"). */
    tags?: string[];
    /** Scene-level fields shared across all registered objects for this instance. */
    attributes: Record<string, LambdaFieldConfig>;
    /** Per-object component fields stored in `object.userData.lambdaComponents[]`. */
    componentSchema: Record<string, LambdaFieldConfig>;
    /** Default criticality for all components of this Lambda type. Components can override. */
    isCritical?: boolean;
    /** Component types this lambda reads (for dependency graph wave scheduling). Defaults to componentSchema keys. */
    readComponents?: string[];
    /** Component types this lambda writes (for dependency graph wave scheduling). Defaults to componentSchema keys. */
    writeComponents?: string[];
}

export type LambdaConstructor = new (id: string, options: LambdaOptions) => Lambda;

export interface Lambda {
    readonly id: string;
    readonly uuid: string;
    readonly attributes: Record<string, any>;
    readonly registeredObjects: ReadonlyMap<Object3D, Record<string, any>>;
    readonly entityCount: number;

    // Lifecycle
    init(game: GameManager): void | Promise<void>;
    dispose(): void;

    // Core ECS - process all registered objects (wraps update() with _isApplying safety)
    apply(deltaTime?: number): void;

    // Override this to implement per-frame logic (called by apply())
    update(deltaTime?: number): void;

    /**
     * Called at fixed timestep for physics-dependent logic.
     * In legacy runtime, fixedUpdate-only lambdas run from the normal apply pass.
     * @param fixedDeltaTime - Fixed timestep in seconds (e.g., 1/60 = 0.0167s at 60Hz)
     */
    fixedUpdate?(fixedDeltaTime: number): void;

    // Object registration callbacks
    onObjectAdded(target: Object3D, componentData: Record<string, any>): void;
    onObjectRemoved(target: Object3D): void;

    /**
     * Fires after a per-object component field is mutated via setComponentData()
     * when the value actually changes. Does not fire for direct data mutation or
     * during the initial register (use onObjectAdded for seeding).
     */
    onSet?(target: Object3D, key: string, newValue: any, oldValue: any): void;

    // Component data access
    getComponentData(target: Object3D): Record<string, any> | null;
    setComponentData(target: Object3D, key: string, value: any): void;
    requestAttributeChange(
        key: string,
        value: any,
        options?: LambdaAttributeChangeOptions,
    ): Promise<LambdaAttributeChangeResult> | LambdaAttributeChangeResult;

    onAttributesUpdated?(): void;
    onAttributeChangeRequested?(key: string, newValue: any, oldValue: any, requester: Lambda | null): boolean;
    onAttributeChanged?(key: string, newValue: any, oldValue: any): void;

    // Event integration (behavior event bus) — can be sync, async, or a generator
    onEvent(msg: string, data: any): void | Promise<void> | Generator;
}
