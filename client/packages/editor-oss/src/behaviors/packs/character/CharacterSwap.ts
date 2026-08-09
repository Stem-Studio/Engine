import {Object3D} from "three";

import GameManager from "../../../behaviors/game/GameManager";
import RangeDetector from "../../../behaviors/range/RangeDetector";

export class CharacterSwap {
    
    private owner: Object3D;
    private rangeDetector: RangeDetector;
    private swapActivated: boolean = false;
    private swapCooldown: number = 0.5; // seconds
    private game: GameManager | null = null;

    constructor(owner: Object3D, gameManager: GameManager) {
        this.owner = owner;
        this.game = gameManager;
        this.rangeDetector = new RangeDetector(gameManager);
        this.rangeDetector.distanceThreshold = 2;
        this.rangeDetector.setText("Press E to swap");
    }

    update(deltaTime: number) {
        const player = this.game?.player;
        if (!player || player === this.owner) {
            return;
        }

        // In multiplayer, do not allow swap with remote players (clones)
        if (this.game?.isMultiplayer && this.isRemotePlayer(this.owner)) {
            this.rangeDetector?.setActive(false);
            return;
        }

        if (this.swapCooldown > 0) {
            this.swapCooldown -= deltaTime;
            if (this.swapCooldown <= 0) {
                this.swapActivated = true;
            }
        }

        this.rangeDetector.setTarget(this.owner);
        this.rangeDetector.setPlayer(player);
        this.rangeDetector?.update();
        
        if (!this.swapActivated) {
            this.rangeDetector?.setActive(false);
            return;
        }

        if (this.rangeDetector.isTargetInRange && player.userData.pressE) {
            this.swapCharacterControl(player);
        }
    }

    swapCharacterControl(player: Object3D) {
        this.reset();

        this.game?.behaviorManager?.sendEventToObjectBehaviors(player, "character:deactivate");
        
        this.game?.behaviorManager?.sendEventToObjectBehaviors(this.owner, "character:activate");
        
        // In multiplayer, notify the server about the active player change
        if (this.game?.isMultiplayer && this.game?.multiplayerState) {
            (this.game.multiplayerState as any).setPlayer?.(this.owner);
        }
    }

    updateOwner(newOwner: Object3D): void {
        this.owner = newOwner;
    }

    dispose() {
        this.rangeDetector?.dispose();
    }

    reset() {
        this.swapActivated = false;
        this.swapCooldown = 0.5; // seconds
        this.rangeDetector?.setActive(false);
    }

    private isRemotePlayer(obj: Object3D): boolean {
        return obj.name.includes('-mp-') || obj.name.includes('Remote');
    }

}
