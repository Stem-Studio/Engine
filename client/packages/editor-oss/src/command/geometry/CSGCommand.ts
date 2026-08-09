import {t} from "i18next";
import * as THREE from "three";
import {Brush, Evaluator, SUBTRACTION, ADDITION, INTERSECTION, DIFFERENCE, HOLLOW_SUBTRACTION, HOLLOW_INTERSECTION} from "three-bvh-csg";

import global from "../../global";
import {cloneJsonCompatible} from "../../utils/cloneJsonCompatible";
import {AddObjectCommand, RemoveObjectCommand} from "../Commands";
import Command from "../Command";

/**
 * CSG Operation Types
 */
export enum CSGOperation {
    UNION = "union",
    INTERSECTION = "intersection",
    SUBTRACTION = "subtraction",
    DIFFERENCE = "difference",
    HOLLOW_SUBTRACTION = "hollow_subtraction",
    HOLLOW_INTERSECTION = "hollow_intersection",
}


/**
 * CSG Command - Performs Constructive Solid Geometry operations on meshes
 * @description Combines multiple meshes using union, intersection, difference, and hollow operations
 * Supports undo/redo functionality and works with any valid mesh geometry
 */
class CSGCommand extends Command {
    private objects: THREE.Object3D[];
    private operation: CSGOperation;
    private resultMesh: THREE.Mesh | null;
    private removeCommands: RemoveObjectCommand[];
    private addCommand: AddObjectCommand | null;
    private parent: THREE.Object3D | null;

    /**
     * Create a new CSG Command
     * @param objects - Array of mesh objects to perform CSG on
     * @param operation - The CSG operation to perform (union, intersection, subtraction, difference, hollow operations)
     */
    constructor(objects: THREE.Object3D[], operation: CSGOperation) {
        super();
        this.type = "CSGCommand";
        this.name = t(`CSG ${operation}`);
        this.editor = global?.app?.editor;

        this.objects = objects;
        this.operation = operation;
        this.resultMesh = null;
        this.removeCommands = [];
        this.addCommand = null;
        this.parent = null;

        // Validate inputs
        if (!objects || objects.length < 2) {
            throw new Error("CSG operation requires at least 2 objects");
        }
    }

    /**
     * Check if an object is a valid mesh for CSG operations
     * @param object
     */
    private isValidMesh(object: THREE.Object3D): object is THREE.Mesh {
        if (!(object instanceof THREE.Mesh)) {
            return false;
        }

        const geometry = object.geometry;
        if (!geometry) {
            return false;
        }

        // Ensure geometry has position attribute (valid BufferGeometry)
        return geometry.attributes && geometry.attributes.position && geometry.attributes.position.count > 0;
    }

    /**
     * Validate that all objects are valid meshes
     */
    private validateObjects(): boolean {
        for (const obj of this.objects) {
            if (!this.isValidMesh(obj)) {
                console.error(`Object "${obj.name}" is not a valid mesh for CSG operations (type: ${obj.type})`);
                return false;
            }
        }
        return true;
    }

    /**
     * Perform the CSG operation
     */
    private performCSG(): THREE.Mesh | null {
        if (!this.validateObjects()) {
            return null;
        }

        console.log("Performing CSG operation:", this.operation);
        console.log("Objects:", this.objects.map(o => ({
            name: o.name,
            position: o.position.toArray(),
            rotation: o.rotation.toArray(),
            scale: o.scale.toArray(),
        })));

        const evaluator = new Evaluator();
        const brushes: Brush[] = [];

        // Convert meshes to brushes and apply world transforms
        for (const obj of this.objects as THREE.Mesh[]) {
            // Ensure matrix world is up to date
            obj.updateMatrixWorld(true);

            console.log(`Creating brush for ${obj.name}:`, {
                position: obj.position.toArray(),
                rotation: obj.rotation.toArray(),
                scale: obj.scale.toArray(),
                matrixWorld: obj.matrixWorld.elements,
            });

            // Clone the geometry and apply the world transform to it
            const geometry = obj.geometry.clone();
            geometry.applyMatrix4(obj.matrixWorld);

            const brush = new Brush(geometry, obj.material);
            brushes.push(brush);

            console.log(`Brush created, vertices:`, brush.geometry.attributes.position!.count);
            console.log(`Brush geometry bounding box:`, brush.geometry.boundingBox);
        }

        if (brushes.length === 0) {
            return null;
        }

        // Start with the first brush
        let result = brushes[0]!;
        console.log("Starting with first brush, vertices:", result.geometry.attributes.position!.count);

        // Apply operation sequentially
        for (let i = 1; i < brushes.length; i++) {
            const brush = brushes[i];
            if (!brush) {
                continue;
            }

            console.log(`Applying ${this.operation} with brush ${i}, vertices:`, brush.geometry.attributes.position!.count);

            switch (this.operation) {
                case CSGOperation.UNION:
                    result = evaluator.evaluate(result, brush, ADDITION);
                    break;
                case CSGOperation.INTERSECTION:
                    result = evaluator.evaluate(result, brush, INTERSECTION);
                    break;
                case CSGOperation.SUBTRACTION:
                    result = evaluator.evaluate(result, brush, SUBTRACTION);
                    break;
                case CSGOperation.DIFFERENCE:
                    result = evaluator.evaluate(result, brush, DIFFERENCE);
                    break;
                case CSGOperation.HOLLOW_SUBTRACTION:
                    result = evaluator.evaluate(result, brush, HOLLOW_SUBTRACTION);
                    break;
                case CSGOperation.HOLLOW_INTERSECTION:
                    result = evaluator.evaluate(result, brush, HOLLOW_INTERSECTION);
                    break;
            }

            console.log(`Result after ${this.operation}, vertices:`, result.geometry.attributes.position!.count);
        }

        // Convert brush back to mesh
        const resultGeometry = result.geometry;
        console.log("Final result geometry vertices:", resultGeometry.attributes.position!.count);
        console.log("Result geometry bounds:", resultGeometry.boundingBox);

        // Compute bounding box to verify geometry
        resultGeometry.computeBoundingBox();
        console.log("Computed bounding box:", resultGeometry.boundingBox);
        if (resultGeometry.boundingBox) {
            console.log("Bounding box min:", resultGeometry.boundingBox.min);
            console.log("Bounding box max:", resultGeometry.boundingBox.max);
            console.log("Bounding box size:", {
                x: resultGeometry.boundingBox.max.x - resultGeometry.boundingBox.min.x,
                y: resultGeometry.boundingBox.max.y - resultGeometry.boundingBox.min.y,
                z: resultGeometry.boundingBox.max.z - resultGeometry.boundingBox.min.z,
            });
        }

        const firstMesh = this.objects[0] as THREE.Mesh;
        const sourceMaterial = Array.isArray(firstMesh.material) ? firstMesh.material[0]! : firstMesh.material;
        const resultMaterial = sourceMaterial.clone();

        const mesh = new THREE.Mesh(resultGeometry, resultMaterial);
        mesh.name = `CSG_${this.operation}_Result`;
        mesh.castShadow = firstMesh.castShadow;
        mesh.receiveShadow = firstMesh.receiveShadow;

        // Copy userData from first object
        mesh.userData = cloneJsonCompatible(firstMesh.userData);
        delete mesh.userData.meshData;

        console.log("CSG operation complete, result mesh:", mesh);
        console.log("Result mesh position:", mesh.position);
        console.log("Result mesh rotation:", mesh.rotation);
        console.log("Result mesh scale:", mesh.scale);
        console.log("Result mesh geometry:", mesh.geometry);

        return mesh;
    }

    /**
     * Execute the CSG command
     */
    async execute() {
        try {
            // Perform CSG operation
            this.resultMesh = this.performCSG();

            if (!this.resultMesh) {
                return {
                    message: "CSG operation failed: Invalid objects",
                    status: "error",
                };
            }

            // Store parent for undo
            this.parent = this.objects[0]!.parent;

            // Don't copy position/rotation/scale - the geometry already has world transforms baked in
            // from applyMatrix4(obj.matrixWorld) in performCSG()

            // Remove original objects
            this.removeCommands = this.objects.map(obj => new RemoveObjectCommand(obj, obj));

            for (const cmd of this.removeCommands) {
                cmd.execute();
            }

            // Add result mesh
            this.addCommand = new AddObjectCommand(this.resultMesh, this.parent);
            await this.addCommand.execute();

            return {
                message: `CSGCommand: ${this.operation} operation completed successfully`,
                status: "success",
            };
        } catch (error: any) {
            console.error("CSG operation error:", error);
            return {
                message: `CSG operation failed: ${error?.message}`,
                status: "error",
            };
        }
    }

    /**
     * Undo the CSG command
     */
    undo() {
        try {
            // Remove the result mesh
            if (this.addCommand) {
                this.addCommand.undo();
            }

            // Restore original objects
            for (let i = this.removeCommands.length - 1; i >= 0; i--) {
                this.removeCommands[i]?.undo();
            }

            return {
                message: `CSGCommand: ${this.operation} operation undone`,
                status: "success",
            };
        } catch (error: any) {
            console.error("CSG undo error:", error);
            return {
                message: `CSG undo failed: ${error.message}`,
                status: "error",
            };
        }
    }

    /**
     * Serialize command to JSON
     */
    toJSON() {
        const output: any = Command.prototype.toJSON.call(this);
        output.operation = this.operation;
        output.objectUuids = this.objects.map(obj => obj.uuid);

        if (this.resultMesh) {
            output.resultMesh = this.resultMesh.toJSON();
        }

        return output;
    }

    /**
     * Deserialize command from JSON
     * @param json
     */
    fromJSON(json: any) {
        Command.prototype.fromJSON.call(this, json);

        this.operation = json.operation;

        // Restore objects by UUID
        this.objects = json.objectUuids
            .map((uuid: string) => this.editor.objectByUuid(uuid))
            .filter((obj: THREE.Object3D) => obj !== undefined);

        if (json.resultMesh) {
            const loader = new THREE.ObjectLoader();
            this.resultMesh = loader.parse(json.resultMesh) as THREE.Mesh;
        }
    }
}

export {CSGCommand};
