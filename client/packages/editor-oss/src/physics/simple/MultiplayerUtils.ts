import {isNumber} from "lodash";
import {Object3D, Scene} from "three";

import type SpawnPointBehavior from "@stem/editor-oss/behaviors/packs/spawnpoint/SpawnPointBehavior";
import global from "@stem/editor-oss/global";
import {TemplateType} from '@stem/editor-oss/types/TemplateType';
import {cloneObject, setObjectTemplate} from "@stem/editor-oss/utils/ObjectUtils";
import {
    findObjectByUuidDepthFirst,
    traverseObjectDepthFirst,
} from "@stem/editor-oss/utils/SceneTraverser";
import TagUtil from "@stem/editor-oss/utils/TagUtil";
import {CollisionFlag, IPhysics} from "../common/types";
import {PhysicsRuntimeUtil as PhysicsUtil} from "../PhysicsRuntimeUtil";

export class MultiplayerUtils {
    private static readonly SPAWN_POINT_BEHAVIOR_ID = "spawnpoint";

    public static isNeedsShapeUpdate(object: Object3D): boolean {
        return Boolean(object.userData.needsShapeUpdate);
    }

    static setShouldSynchronizeChildren(object: Object3D, shouldSynchronizeChildren: boolean | [string]) {
        object.userData.synchronizeChildren = shouldSynchronizeChildren;
    }

    static shouldSynchronizeChildren(object: Object3D) {
        return  typeof object.userData.synchronizeChildren === "boolean" && object.userData.synchronizeChildren ||
                Array.isArray(object.userData.synchronizeChildren) && object.userData.synchronizeChildren.length > 0;
    }

    static isValidChild(object: Object3D, child: Object3D): boolean {
        return !Array.isArray(object.userData.synchronizeChildren) || object.userData.synchronizeChildren.includes(child.name);
    }

    static isMultiplayerEnabled() {
        return Boolean(global.app?.editor?.isMultiplayer);
    }

    static isMultiplayerTemplate(object: Object3D) {
        return this.isMultiplayerEnabled() && TagUtil.hasAnyTag(object, ["player", "Player"]);
    }

    //checks that children names are unique
    static isValidForChildrenSync(object: Object3D): boolean {
        if (!Array.isArray(object.userData.synchronizeChildren)) return true;
        let valid = true;
        for (const childName of object.userData.synchronizeChildren) {
            let matchCount = 0;
            traverseObjectDepthFirst(object, child => {
                if (child.name === childName) {
                    matchCount++;
                }
            }, {includeRoot: false});

            if (matchCount > 1) {
                console.warn(
                    `isValidObjectForChildrenSync: ${object.uuid}/${object.name} -> non-unique child name in setting: ${childName}`,
                );
                valid = false;
            }
        }
        return valid;
    }

    /**
     * Creates a clone of the object by template UUID.
     * 
     * @remarks
     * Removes the prefab object from physics and hides it.
     * 
     * @param physics - The physics engine
     * @param objectPrefab - The prefab to clone
     * @param useBehaviors - Whether to clone the prefab's behaviors
     * @returns The cloned object
     */
    public static cloneObject(
        physics: IPhysics | null,
        objectPrefab: Object3D,
        useBehaviors = false,
    ): Object3D {
        const clonedObject = cloneObject(objectPrefab);

        if (!useBehaviors) {
            delete clonedObject.userData.behaviors; //remove character behavior
        }

        // TODO: this should probably be done elsewhere
        // If the prefab is removed from the world via regular remove call, then
        // we also remove it from the scene in objects.onRemove.
        physics?.removePrefab(objectPrefab.uuid); // remove player prefab from physics world

        // Hide the prefab.
        // TODO: do we really want to do this? This produces a side-effect on
        // the prefab which could lead to unexpected behavior.
        objectPrefab.visible = false;

        // Make the cloned object visible.
        // TODO: ideally cloneObject() shouldn't change the visibility of the
        // object. This should probably be done elsewhere.
        clonedObject.visible = true;

        clonedObject.removeFromParent();

        return clonedObject;
    }

    /**
     * Clone the player prefab object with the specified UUID and add the clone
     * to the scene.
     *
     * @param physics - The physics engine
     * @param playerPrefabUuid - The UUID of the player prefab
     * @param scene - The scene to add the player object to
     * @param playerUuid - The UUID to assign to the player object
     * @param slot - The spawn point slot
     * @returns The cloned player object
     */
    public static async clonePlayerObject(
        physics: IPhysics,
        playerPrefabUuid: string,
        scene: Scene,
        playerUuid?: string,
        slot?: number,
    ): Promise<Object3D> {
        const playerPrefab = findObjectByUuidDepthFirst(scene, playerPrefabUuid);
        if (!playerPrefab) {
            console.warn(`MP.clonePlayerObject: object prefab is not in the scene: ${playerPrefabUuid}`);
            throw new Error(`player prefab is not in the scene: ${playerPrefabUuid}`);
        }

        const playerObject = MultiplayerUtils.cloneObject(physics, playerPrefab);
        scene.add(playerObject);

        //TODO: move it to character behavior props
        MultiplayerUtils.setShouldSynchronizeChildren(playerObject, true);

        console.log(
            `MP.clonePlayerObject: ${playerObject.name} ->${playerObject.uuid}`,
            playerObject.scale,
            PhysicsUtil.getPhysicsConfig(playerObject),
        );

        if (playerUuid) {
            //set new object uuid to the remote player uuid
            playerObject.uuid = playerUuid;
            //remote player - already added to the world, just add it to the local update cache
            const physicsConfig = PhysicsUtil.getPhysicsConfig(playerObject)!;
            physics.addObject(playerObject.uuid, physicsConfig.mass, CollisionFlag.DYNAMIC, playerObject);
        } else {
            //local player - new object, add to the world
            setObjectTemplate(playerObject, TemplateType.UUID, playerPrefabUuid);
            const {PhysicsUtil: ShapePhysicsUtil} = await import("../PhysicsUtil");
            await ShapePhysicsUtil.addObjectShapeToPhysics(playerObject, physics, playerPrefab);
        }

        //enable haviors on new player ONLY if template is tagged as player
        if (MultiplayerUtils.isMultiplayerTemplate(playerPrefab)) {
            traverseObjectDepthFirst(playerObject, obj => {
                if (obj.userData?.behaviors) {
                    //initialize behaviors
                    void global.app?.game?.initializeObject(obj);
                }
            });
        }

        //add player to the slot according to SpawnBehavior setup
        if (isNumber(slot) && slot >= 0) {
            const spawnPoints = (global.app?.game!.behaviorManager?.getBehaviorsById(
                MultiplayerUtils.SPAWN_POINT_BEHAVIOR_ID,
            ) || []) as SpawnPointBehavior[];
            const spawnPoint = spawnPoints.find(sp => sp.attributes["slot"] === slot);
            if (spawnPoint?.target) {
                console.log(`Using Spawn Point with slot: ${slot}`);
                playerObject.position.copy(spawnPoint.target.position);
            } else {
                console.warn(`Spawn Points for slot ${slot} is not set. Placing player in random location`);
            }
        } else {
            console.warn("Slot is not set. Placing player in random location.");
        }

        console.log(`MP.clonePlayerObject:`, playerObject);

        return playerObject;
    }
}
