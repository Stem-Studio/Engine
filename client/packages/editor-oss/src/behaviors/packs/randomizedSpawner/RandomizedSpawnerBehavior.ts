import * as THREE from "three";

import { AssetRef } from '@stem/editor-oss/asset-management/AssetRef';
import EventBus, {IN_GAME_EVENTS} from "../../../behaviors/event/EventBus";
import CameraUtils from "@stem/editor-oss/utils/CameraUtils";
import {BehaviorBase} from "../../Behavior";
import GameManager from "../../game/GameManager";

interface PrefabListItem {
    prefabId: AssetRef;
    probability: number;
}

class RandomizedSpawnerBehavior extends BehaviorBase {
    private game?: GameManager;
    private lastSpawnedObject?: THREE.Object3D;
    private hasSpawnedThisCollision: boolean = false;
    private collisionStartTime: number = 0;
    private isColliding: boolean = false;
    private readonly playerBounds = new THREE.Box3();
    private readonly spawnBounds = new THREE.Box3();

    private spawnerData = {
        target: {} as THREE.Object3D,
    };

    init(game: GameManager) {
        this.game = game;
    }

    async onAdded(): Promise<void> {
        CameraUtils.disableCameraCollision(this.target);
        this.spawnerData.target = this.target!;

        // Preload all prefabs from randomList
        const randomList = this.getRandomList();
        
        if (randomList && randomList.length > 0) {
            const preloadPromises: Promise<void>[] = [];
            
            for (const item of randomList) {
                if (item.prefabId) {
                    const preloadPromise = this.game!.prefabManager!.preloadPrefab(item.prefabId)
                        .then(() => {
                            console.debug("[RandomizedSpawner] Preloaded prefab:", item.prefabId);
                        })
                        .catch((error) => {
                            console.error("[RandomizedSpawner] Failed to preload prefab:", item.prefabId, error);
                        });
                    preloadPromises.push(preloadPromise);
                }
            }
            
            // Wait for all prefabs to be preloaded
            await Promise.all(preloadPromises);
        }
    }

    private checkCollision(): void {
        if (!this.game || !this.target || this.isPaused) return;
        if (!this.hasSpawnablePrefab()) return;

        const player = this.game.player;
        if (!player) return;

        const playerBox = this.playerBounds.setFromObject(player);
        const spawnBox = this.spawnBounds.setFromObject(this.target);

        if (playerBox.intersectsBox(spawnBox)) {
            this.onCollision();
        }
    }

    onCollision() {
        if (!this.target) return;

        const currentTime = performance.now();

        if (!this.isColliding) {
            this.isColliding = true;
            this.collisionStartTime = currentTime;
        }

        if (!this.hasSpawnedThisCollision && !this.attributes.startOnTrigger) {
            void this.spawnPrefab();
            this.hasSpawnedThisCollision = true;
        }
    }

    update() {
        if (!this.attributes.startOnTrigger) {
            this.checkCollision();
        }

        if (this.isColliding && !this.attributes.startOnTrigger) {
            const currentTime = performance.now();
            const elapsed = (currentTime - this.collisionStartTime) / 1000;

            if (elapsed > 1) {
                this.hasSpawnedThisCollision = false;
                this.isColliding = false;
            }
        }
    }

    private async spawnPrefab() {
        if (!this.attributes.multipleSpawn && this.lastSpawnedObject) {
            return;
        }

        if (this.lastSpawnedObject && this.attributes.multipleSpawn) {
            // Remove previous spawned prefab
            this.game!.removeObject(this.lastSpawnedObject);
            this.lastSpawnedObject = undefined;
        }

        const randomList = this.getRandomList();
        if (!randomList || randomList.length === 0) {
            console.warn("[RandomizedSpawner] No prefabs in randomList");
            return;
        }

        const totalWeight = randomList.reduce((sum, obj) => sum + obj.probability, 0);
        const randomValue = Math.random() * totalWeight;

        let accumulated = 0;
        let selectedPrefab: PrefabListItem | null = null;

        for (const obj of randomList) {
            accumulated += obj.probability;
            if (randomValue <= accumulated) {
                selectedPrefab = obj;
                break;
            }
        }

        if (!selectedPrefab || !selectedPrefab.prefabId) {
            console.warn("[RandomizedSpawner] No prefab selected or prefabId is empty");
            return;
        }

        try {
            // Create instance from preloaded prefab
            const prefabInstance = await this.game!.prefabManager!.createPrefabInstance(selectedPrefab.prefabId);
            
            // Position and rotate the instance at spawner location
            prefabInstance.position.copy(this.target.position);
            prefabInstance.rotation.copy(this.target.rotation);

            // Add to scene
            if (this.target.parent) {
                this.target.parent.add(prefabInstance);
            } else {
                this.game!.scene.add(prefabInstance);
            }

            this.lastSpawnedObject = prefabInstance;
            EventBus.instance.send(IN_GAME_EVENTS.RANDOMIZED_SPAWNER_ACTIVATED, this.spawnerData);
            
            console.debug("[RandomizedSpawner] Spawned prefab:", selectedPrefab.prefabId);
        } catch (error) {
            console.error("[RandomizedSpawner] Failed to spawn prefab:", selectedPrefab.prefabId, error);
        }
    }

    onReset() {}

    onEvent(msg: string): void {
        if (msg === "trigger" && this.attributes.startOnTrigger) {
            void this.spawnPrefab();
        }
    }

    private getRandomList(): PrefabListItem[] {
        return Array.isArray(this.attributes.randomList) ? this.attributes.randomList : [];
    }

    private hasSpawnablePrefab(): boolean {
        for (const item of this.getRandomList()) {
            if (item?.prefabId) return true;
        }

        return false;
    }
}

export default RandomizedSpawnerBehavior;
