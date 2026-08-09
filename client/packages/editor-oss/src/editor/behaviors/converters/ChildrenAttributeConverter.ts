import type {Bone, Mesh, Object3D} from "three";

import global from "@stem/editor-oss/global";
import {BehaviorAttributeData, ObjectAttribute} from "../BehaviorAttributes";
import BehaviorAttributeType from "../BehaviorAttributeType";
import AttributeConverter from "./AttributeConverter";
import {BehaviorContext} from "../BehaviorContextProvider";
import {
    findObjectByUuidDepthFirst,
    findObjectDepthFirst,
    traverseObjectDepthFirst,
} from "@stem/editor-oss/utils/SceneTraverser";

class ChildrenAttributeConverter implements AttributeConverter {
    private containsMesh(object: Object3D): boolean {
        return findObjectDepthFirst(object, child => (child as Mesh).isMesh === true) !== null;
    }

    private isBoneNode(object: Object3D): boolean {
        return (object as Bone)?.isBone || object?.type === "Bone";
    }

    private isHiddenNode(object: Object3D): boolean {
        if (!object?.userData?.isStemObject) {
            return true;
        }

        let current: Object3D | null = object;
        while (current) {
            if (current.visible === false) {
                return true;
            }
            current = current.parent;
        }
        return false;
    }

    convertAttribute(attributeData: BehaviorAttributeData, behaviorContext: BehaviorContext): ObjectAttribute {
        const app = global.app!;
        const editor = app.editor!;
        const options: {name: string; uuid: string}[] = [];
        const filter = attributeData.filter as string | undefined;
        const seenUuids = new Set<string>();

        const rootObject = behaviorContext.object
            ? findObjectByUuidDepthFirst(editor.scene, behaviorContext.object.uuid)
            : null;

        if (rootObject) {
            traverseObjectDepthFirst(rootObject, (child: Object3D) => {
                if (child.uuid === rootObject.uuid || seenUuids.has(child.uuid)) {
                    return;
                }

                if (filter === "mesh" && !this.containsMesh(child)) {
                    return;
                }

                const baseName = child.name || `${child.type || "Object3D"} (${child.uuid.slice(0, 8)})`;
                const flags: string[] = [];
                if (this.isBoneNode(child)) {
                    flags.push("Bone");
                }
                if (this.isHiddenNode(child)) {
                    flags.push("Hidden");
                }

                const label = flags.length > 0 ? `[${flags.join("][")}] ${baseName}` : baseName;
                options.push({name: label, uuid: child.uuid});
                seenUuids.add(child.uuid);
            });
        }

        let defaultValue = attributeData.default || "";

        if (attributeData.defaultToSelf && behaviorContext.object) {
            defaultValue = behaviorContext.object.uuid;
        }

        return {
            name: attributeData.name,
            type: BehaviorAttributeType.Children,
            array: attributeData.array || false,
            invisible: attributeData.invisible || false,
            visibleIf: attributeData.visibleIf,
            options,
            default: defaultValue,
            order: attributeData.order || 0,
            filter,
        };
    }
}

export default ChildrenAttributeConverter;
