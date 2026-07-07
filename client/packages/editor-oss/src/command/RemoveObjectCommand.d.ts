import type * as THREE from "three";
import type {CommandResult} from "./AddObjectCommand";

export class RemoveObjectCommand {
    constructor(object: THREE.Object3D, selectedObject?: THREE.Object3D | THREE.Object3D[] | null);
    execute: () => CommandResult;
    undo: () => CommandResult;
    toJSON: () => unknown;
    fromJSON: (json: unknown) => void;
}
