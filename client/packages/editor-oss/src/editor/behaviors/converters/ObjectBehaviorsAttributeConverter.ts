import {Object3D} from "three";

import global from "@stem/editor-oss/global";
import {BehaviorAttributeData, ObjectBehaviorsAttribute} from "../BehaviorAttributes";
import BehaviorAttributeType from "../BehaviorAttributeType";
import AttributeConverter from "./AttributeConverter";
import {BehaviorContext} from "../BehaviorContextProvider";
import {DYNAMIC_ROOT_NAME} from "@stem/editor-oss/scene/dynamicRoots";
import {traverseObjectDepthFirst} from "@stem/editor-oss/utils/SceneTraverser";

class ObjectBehaviorsAttributeConverter implements AttributeConverter {
    convertAttribute(attributeData: BehaviorAttributeData, behaviorContext: BehaviorContext): ObjectBehaviorsAttribute {
        const app = (global as any).app;
        const editor = app.editor;

        // get all objects in the scene
        const includeNone = attributeData.includeNone !== false;
        const excludeNames = new Set<string>(
            Array.isArray(attributeData.excludeNames)
                ? attributeData.excludeNames.map((name: string) => String(name).toLowerCase())
                : [],
        );
        const excludeSelf = attributeData.excludeSelf === true;
        const objectOptions: {name: string; uuid: string}[] = includeNone ? [{name: "none", uuid: ""}] : [];
        traverseObjectDepthFirst(editor.scene, (child: Object3D & {isGroup?: boolean}) => {
            // Skip runtime-only and internal objects
            if (child.name === DYNAMIC_ROOT_NAME || child.name === "BatchRoot" || child.userData?.isRuntimeOnly) {
                return;
            }
            if (excludeNames.has(String(child.name || "").toLowerCase())) {
                return;
            }
            if (excludeSelf && behaviorContext.object && child.uuid === behaviorContext.object.uuid) {
                return;
            }
            if (child && !!child.userData?.isStemObject || child.isGroup) {
                objectOptions.push({name: child.name, uuid: child.uuid});
            }
        });

        // Determine the default value
        let defaultValue = attributeData.default || {object: "", behaviors: []};

        // If defaultToSelf is true and we have an object context, use it as default
        if (attributeData.defaultToSelf && behaviorContext.object) {
            defaultValue = {
                object: behaviorContext.object.uuid,
                behaviors: [],
            };
        }

        return {
            name: attributeData.name,
            type: BehaviorAttributeType.ObjectBehaviors,
            array: attributeData.array || false,
            invisible: attributeData.invisible || false,
            visibleIf: attributeData.visibleIf,
            default: defaultValue,
            filterByAttributes: attributeData.filterByAttributes || {},
            defaultToSelf: attributeData.defaultToSelf || false,
            selectAllByDefault: attributeData.selectAllByDefault || false,
            targetEntity: attributeData.targetEntity === "lambda" ? "lambda" : "behavior",
            object: objectOptions,
            behaviors: [], // this will be filled in later when an object is selected
            order: attributeData.order || 0,
        };
    }
}

export default ObjectBehaviorsAttributeConverter;
