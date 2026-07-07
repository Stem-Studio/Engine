import type * as THREE from "three";

export type CommandStatus = "success" | "info" | "error" | string;
export type CommandResult = {message: string; status: CommandStatus};

export class AddObjectCommand {
    constructor(
        obj: THREE.Object3D,
        parent?: THREE.Object3D | null,
        callback?: ((object: THREE.Object3D) => void) | null,
        noSelect?: boolean,
        noFocus?: boolean,
    );
    execute: () => Promise<CommandResult>;
    undo: () => CommandResult;
    toJSON: () => unknown;
    fromJSON: (json: unknown) => void;
}
