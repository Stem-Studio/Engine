import * as THREE from "three";

import EventBus, { IN_GAME_EVENTS } from "../../../behaviors/event/EventBus";
import CameraUtils from "@stem/editor-oss/utils/CameraUtils";
import { BehaviorBase } from "../../Behavior";
import GameManager from "../../game/GameManager";

class SpawnBehavior extends BehaviorBase {

    protected game: GameManager | null = null;
    private alreadySpawned: boolean = false;
    private readonly playerBounds = new THREE.Box3();
    private readonly spawnBounds = new THREE.Box3();

    private spawnData = {
        target: {} as THREE.Object3D,
    };

    init(game: GameManager) {
        this.game = game;
    }

    update() {
        if (!this.attributes.startOnTrigger){
            this.checkCollision();
        } 
    }

    async onAdded(): Promise<void> {
        CameraUtils.disableCameraCollision(this.target);
        this.spawnData.target = this.target!;
        
        if (this.attributes && this.attributes.stem) {
            try {
                await this.game!.prefabManager!.preloadPrefab(this.attributes.stem);
                console.debug("[SpawnBehavior] Preloaded prefab:", this.attributes.stem);
            } catch (error) {
                console.error("[SpawnBehavior] Failed to preload prefab:", this.attributes.stem, error);
            }
        }
    }

    private checkCollision(): void {
        if (!this.game || !this.target) return;
        if (this.alreadySpawned) return;
        if (!this.attributes.stem) return;

        const player = this.game.player;
        if (!player) return;

        const playerBox = this.playerBounds.setFromObject(player);
        const spawnBox = this.spawnBounds.setFromObject(this.target);

        if (playerBox.intersectsBox(spawnBox)) {
            this.onCollision();
        }
    }

    private onCollision() {
        void this.spawnObject();
    }

    async spawnObject() {
        if (!this.attributes.stem || !this.game || !this.target || this.alreadySpawned) return;

        try {
            const prefabInstance = await this.game.prefabManager!.createPrefabInstance(this.attributes.stem);
            
            prefabInstance.position.copy(this.target.position);
            prefabInstance.rotation.copy(this.target.rotation);

            if (this.target.parent) {
                this.target.parent.add(prefabInstance);
            } else {
                this.game.scene.add(prefabInstance);
            }

            this.alreadySpawned = true;
            EventBus.instance.send(IN_GAME_EVENTS.SPAWN_ACTIVATED, this.spawnData);
            
            console.debug("[SpawnBehavior] Spawned prefab:", this.attributes.stem);
        } catch (error) {
            console.error("[SpawnBehavior] Failed to spawn prefab:", this.attributes.stem, error);
        }
    }

    onRemoved(): void { }
    onReset() { }

    onEvent(msg: string, data: any): void {
        if (msg === "trigger" && data.actionType === "activate") {
            void this.spawnObject();
        }
    }
}

export default SpawnBehavior;
