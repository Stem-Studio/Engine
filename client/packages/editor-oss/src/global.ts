import type EngineRuntime from "./EngineRuntime";

interface GlobalType {
    app: EngineRuntime | null;
}

export default {
    app: null,
} as GlobalType;
