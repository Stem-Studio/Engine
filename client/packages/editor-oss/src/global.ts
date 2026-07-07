import * as THREE from "three";

import type EngineRuntime from "./EngineRuntime";

interface GlobalType {
    app: EngineRuntime | null;
    three$1: typeof THREE;
    greenworks: unknown;
}

export default {
    app: null,
    three$1: THREE,
} as GlobalType;
