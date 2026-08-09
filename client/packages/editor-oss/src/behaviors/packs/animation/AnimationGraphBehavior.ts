import AnimationGraphController from '../../../controls/AnimationGraphController';
import { BehaviorBase } from '../../Behavior';
import GameManager from '../../game/GameManager';

class AnimationGraphBehavior extends BehaviorBase {
    private graphController?: AnimationGraphController;

    init(gameManager: GameManager) {
        this.graphController = gameManager.animationGraphController;
    }

    onAdded() {
        if (!this.graphController || !this.target) return;
        // Assume attributes.graphData contains serialized AnimationGraph
        if (this.attributes.graphData) {
            this.graphController.addGraph(this.target, this.attributes.graphData);
        }
        if (this.attributes.startState) {
            this.startGraph(this.attributes.startState);
        }
    }

    onRemoved(): void {
        if (this.graphController && this.target) {
            this.graphController.stopGraph(this.target);
        }
    }

    onPaused(): void {
        // Optionally implement pause logic
    }

    onResumed(): void {
        if (this.attributes.startState) {
            this.startGraph(this.attributes.startState);
        }
    }

    onReset() {}

    onEvent(msg: string, data: any): void {
        if (!this.graphController || !this.target) return;
        if (msg === 'setState' && data?.stateId) {
            this.graphController.playGraphState(this.target, data.stateId);
        }
        if (msg === 'setParameter' && data?.name !== undefined && data?.value !== undefined) {
            this.graphController.setParameter(this.target, data.name, data.value);
        }
    }

    onAttributesUpdated(): void {
        // Optionally re-load or update the graph if attributes change
        if (this.graphController && this.target && this.attributes.graphData) {
            this.graphController.addGraph(this.target, this.attributes.graphData);
        }
    }

    private startGraph(stateId: string) {
        if (!this.graphController || !this.target) return;
        this.graphController.playGraphState(this.target, stateId);
    }
}

export default AnimationGraphBehavior; 
