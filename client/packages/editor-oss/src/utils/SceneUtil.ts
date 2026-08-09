import {Object3D, Scene} from "three";

import {traverseObjectDepthFirst} from "@stem/editor-oss/utils/SceneTraverser";

/**
 * Returns all objects in the hierarchy that match the given predicate.
 *
 * @param object - The root object to start the search from
 * @param predicate - The predicate function to test each object
 * @returns An array of objects that match the predicate.
 */
export const findAllObjects = (object: Object3D, predicate: (obj: Object3D) => boolean): Object3D[] => {
    const results: Object3D[] = [];
    traverseObjectDepthFirst(object, obj => {
        if (predicate(obj)) {
            results.push(obj);
        }
    });
    return results;
};

/**
 * Returns true if any object in the hierarchy matches the given predicate.
 *
 * @param object - The root object to start the search from
 * @param predicate - The predicate function to test each object
 * @returns true if any object matches the predicate, false otherwise.
 */
export const someObject = (object: Object3D, predicate: (obj: Object3D) => boolean): boolean => {
    const queue = [object];
    for (let index = 0; index < queue.length; index++) {
        const obj = queue[index]!;
        if (predicate(obj)) {
            return true;
        }
        for (let childIndex = 0; childIndex < obj.children.length; childIndex++) {
            queue.push(obj.children[childIndex]!);
        }
    }
    return false;
};

/**
 * Returns the scene that the given object belongs to.
 *
 * @remarks
 * If the object is not part of any scene, null is returned.
 *
 * @param object - The object to check.
 * @returns The scene the object belongs to, or null if not part of any scene.
 */
export const getScene = (object: Object3D): Scene | null => {
    let obj: Object3D | null = object;
    while (obj) {
        if (obj instanceof Scene) {
            return obj;
        }
        obj = obj.parent;
    }
    return null;
};

/**
 * Indicates whether the given object is a direct child of the scene.
 *
 * @param object - The object to check.
 * @returns True if the object is a direct child of the scene, false otherwise.
 */
export const isChildOfScene = (object: Object3D): boolean => {
    return object.parent instanceof Scene;
};

/**
 * Traverses the scene depth-first, calling the callback function for each
 * object in the hierarchy.
 *
 * @remarks
 * The callback function should return false to stop traversing the object's
 * children.
 *
 * @param object - The root object to start the traversal from
 * @param callback - The callback function to call for each object
 */
export const traverseSceneDepthFirst = (object: Object3D, callback: (obj: Object3D) => boolean) => {
    const stack = [object];
    while (stack.length > 0) {
        const obj = stack.pop()!;
        const shouldContinue = callback(obj);
        if (!shouldContinue) {
            continue;
        }
        for (let i = obj.children.length - 1; i >= 0; i--) {
            stack.push(obj.children[i]!);
        }
    }
};

/**
 * Sets the active state of a game object.
 *
 * @remarks
 * When an object is set to inactive, all of its attached components (including behaviors)
 * and all child objects within its hierarchy will also be disabled and will cease operation,
 * regardless of their individual activeAtStart settings.
 *
 * When an object is set to active, its components and children will resume operation
 * based on their individual active states.
 *
 * A child object can be explicitly enabled or disabled without affecting the active state
 * of its parent object, allowing for selective management of elements within a larger structure.
 *
 * @param targetObject - The game object to set the active state for
 * @param activeState - True to enable the object, false to disable it
 */
export const setObjectActive = (targetObject: Object3D, activeState: boolean): void => {
    if (activeState) {
        // Behaviors will be resumed by the game manager
        const app = (window as any).app;
        if (app?.game) {
            app.game.resumeObject(targetObject, true); // true = resume children as well
        }
    } else {
        // Behaviors will be paused by the game manager
        const app = (window as any).app;
        if (app?.game) {
            app.game.pauseObject(targetObject, true); // true = pause children as well
        }
    }
};

/**
 * Sets the active state of a specific component (behavior) on a game object.
 *
 * @remarks
 * This function allows for selective enabling/disabling of specific behaviors
 * on an object without affecting the object itself or other behaviors.
 *
 * @param targetObject - The game object that owns the component
 * @param componentUUID - The UUID of the behavior component to enable/disable
 * @param activeState - True to enable the component, false to disable it
 */
export const setComponentActive = (targetObject: Object3D, componentUUID: string, activeState: boolean): void => {
    const app = (window as any).app;
    const behaviorManager = app?.game?.behaviorManager;

    if (!behaviorManager) {
        console.warn("setComponentActive: BehaviorManager not found");
        return;
    }

    const behavior = behaviorManager.getBehaviorByUUID(componentUUID);
    if (!behavior) {
        console.warn(`setComponentActive: Behavior with UUID ${componentUUID} not found`);
        return;
    }

    if (activeState) {
        behaviorManager.resumeBehavior(behavior);
    } else {
        behaviorManager.pauseBehavior(behavior);
    }
};
