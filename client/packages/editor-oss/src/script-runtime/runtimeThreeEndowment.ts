import * as THREE from "three";
import * as TSL from "three/tsl";
import * as THREEWebGPU from "three/webgpu";

const stripUnsupportedMaterialParameters = <T,>(parameters: T, unsupportedKeys: string[]): T => {
    if (!parameters || typeof parameters !== "object" || Array.isArray(parameters)) {
        return parameters;
    }

    const source = parameters as Record<string, unknown>;
    let next: Record<string, unknown> | null = null;
    for (const key of unsupportedKeys) {
        if (key in source) {
            next = next ? next : {...source};
            delete next[key];
        }
    }

    return (next || parameters) as T;
};

class RuntimeMeshPhysicalNodeMaterial extends THREEWebGPU.MeshPhysicalNodeMaterial {
    constructor(parameters?: any) {
        super(stripUnsupportedMaterialParameters(parameters, ["reflectivity"]));
    }
}

const RuntimeNodeMaterials = Object.fromEntries(
    Object.entries(THREEWebGPU).filter(([name]) => name.endsWith("NodeMaterial")),
);

export const RuntimeTHREE = {
    ...THREE,
    ...RuntimeNodeMaterials,
    TSL,
    MeshPhysicalNodeMaterial: RuntimeMeshPhysicalNodeMaterial,
};

export {TSL};
