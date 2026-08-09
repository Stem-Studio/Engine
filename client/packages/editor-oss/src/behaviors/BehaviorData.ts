import { Object3D } from "three";

import {BehaviorThrottleConfig} from "./Behavior";

export const BEHAVIOR_DATA_SCHEMA_VERSION = 1;

// This data is saved and loaded from user data and scene file
interface BehaviorData {
    schemaVersion?: number;
    id: string;
    uuid: string;
    /** The uuid of the corresponding behavior in the prefab */
    prefabBehaviorUuid?: string;
    enabled: boolean;
    priority: number;
    attributesData?: Record<string, any>;
    throttleConfig?: BehaviorThrottleConfig;
    target?: Object3D;
}

export default BehaviorData;
