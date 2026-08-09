import { BehaviorAttributeData } from "./BehaviorAttributes";
import { BehaviorThrottleConfig } from "../../behaviors/Behavior";

// stored in scene json, used for editor UI
export type BehaviorConfig = {
    name: string; // display name, used in editor UI
    id: string; // like a package name, used to identify the behavior, for example: "oss.teleport"
    author: string;
    isScript: boolean;
    main: string;
    version: string;
    attributeTemplates?: Record<string, BehaviorAttributeData>; // reusable attribute definitions
    attributes: Record<string, BehaviorAttributeData>;
    description?: string;
    documentation?: string;
    debugOnly?: boolean;
    priority?: number;
    /** Coarse startup ordering. World builders finish before gameplay is created. */
    startupPhase?: "world" | "gameplay" | "late";
    isPriorityLocked?: boolean;
    isHidden?: boolean;
    visibilityConditions?: VisibilityCondition[];
    isSingleton?: boolean;
    allowMultiple?: boolean; // if true, multiple enabled instances of this behavior type can exist on one object
    isThrottlingLocked?: boolean; // if true, throttleConfig is not editable in editor UI
    // category: string; // maybe?
    tags?: string[];
    dependencies?: { [key: string]: string };
    throttleConfig?: BehaviorThrottleConfig; // performance optimization configuration
    worker?: boolean;        // Enable worker thread support
    workerFile?: string;     // For packs: path to dedicated worker file
    // not used directly in editor UI, but used to generate editor UI attributes
    objectSettings?: ObjectSettings;
};

export type VisibilityCondition = {
    key: string; // unique key for the condition (e.g. "isMesh", "isDirectionalLight", "animations.length")
    condition: Condition;
    value: any; // value to compare against, can be a string, number, boolean, etc.
};

export enum Condition {
    IS_GREATER = "isGreater",
    IS_GREATER_OR_EQUAL = "isGreaterOrEqual",
    IS_LESS_OR_EQUAL = "isLessOrEqual",
    IS_LESS = "isLess",
    IS_EQUAL = "isEqual",
    IS_NOT_EQUAL = "isNotEqual",
}

export type ObjectSettings = {
    visibility?: {
        visible?: boolean;
        backfaceCulling?: number;
    };
    physics?: {
        enabled?: boolean;
        mass?: number;
        type?: "dynamic" | "static" | "kinematic";
        shape?: "box" | "sphere" | "capsule" | "convex" | "concave";
    };
    lighting?: {
        castShadows?: boolean;
        receiveShadows?: boolean;
    };
};

export interface BehaviorEditorOptions {
    index?: number;
    priority?: number;
    uuid?: string;
    enabled?: boolean;
    throttleConfig?: BehaviorThrottleConfig;
    attributesData?: Record<string, any>;
}
