import * as THREE from "three";

import {Behavior} from "../../behaviors/Behavior";
import BehaviorData from "../../behaviors/BehaviorData";
import {CreateBehaviorOptions} from '../../behaviors/BehaviorManager';
import GameManager from "../../behaviors/game/GameManager";
import {BehaviorEditorOptions} from "../../editor/behaviors/BehaviorConfig";
import global from "../../global";
import Command from "../Command";

class AttachBehaviorCommand extends Command {
    private selected: THREE.Object3D | null = null;
    private behaviorId: string = "";
    private behaviorData: BehaviorData | null = null;
    private behavior: Behavior | null = null;
    private game: GameManager | null = null;
    private options?: BehaviorEditorOptions;

    constructor(selected: THREE.Object3D | null, behaviorId: string, options?: BehaviorEditorOptions) {
        super();
        this.selected = selected;
        this.behaviorId = behaviorId;
        this.options = options;
        this.editor = global.app?.editor || null;
        this.game = global.app?.game || null;
    }

    async execute(): Promise<{message: string; status: "success" | "info" | "error"}> {
        if (!this.selected || !this.editor) {
            console.error("AttachBehaviorCommand: No selected object or editor is not initialized.");
            return {
                message: `AttachBehaviorCommand: Execution failed - No selected object or editor is not initialized.`,
                status: "error",
            };
        }

        this.behaviorData = await this.editor.addBehaviorToObject(this.selected, this.behaviorId, this.options);

        if (!this.behaviorData) {
            return {
                message: `AttachBehaviorCommand: Failed to attach behavior (${this.behaviorId})`,
                status: "error",
            };
        }

        if (!this.behaviorData.enabled) {
            return {
                message: `AttachBehaviorCommand: Behavior attached but disabled (${this.behaviorId})`,
                status: "success",
            };
        }

        try {
            if (this.editor.isSandbox) {
                this.editor.addPendingBehavior(this.selected, this.behaviorData);
                return {
                    message: `AttachBehaviorCommand: Behavior attached and pending initialization (${this.behaviorId})`,
                    status: "success",
                };
            }

            // Play/Stop can invalidate a command that was already queued by
            // scene import. The editor-side behavior data is still valid, but
            // there is no live runtime manager to initialize against until the
            // next Play session. Treat that transition as an informational
            // no-op instead of surfacing a spurious runtime exception.
            if (!this.game?.behaviorManager) {
                return {
                    message: `AttachBehaviorCommand: Behavior attached; runtime initialization deferred (${this.behaviorId})`,
                    status: "info",
                };
            }

            
            const runtimeOptions: CreateBehaviorOptions = {
                uuid: this.behaviorData.uuid,
                attributes: this.behaviorData.attributesData,
                throttleConfig: this.behaviorData.throttleConfig,
            };
            this.behavior =
                await this.game?.addBehaviorToObject(this.selected, this.behaviorData.id, runtimeOptions) || null;

            if (this.selected === this.editor?.selected && this.behavior) {
                this.game?.behaviorManager?.pauseBehavior(this.behavior);
            }
        } catch (error) {
            console.error("AttachBehaviorCommand: Error while adding behavior to object:", error);
            return {
                message: `AttachBehaviorCommand: Behavior attached but failed to initialize (${this.behaviorId})`,
                status: "error",
            };
        }

        return {
            message: `AttachBehaviorCommand: Behavior attached (${this.behaviorId})`,
            status: "success",
        };
    }

    undo(): {message: string; status: "success" | "info" | "error"} | void {
        if (!this.selected || !this.editor) {
            console.error("AttachBehaviorCommand: No selected object or editor is not initialized.");
            return {
                message: `AttachBehaviorCommand: Undo failed - No selected object or editor is not initialized.`,
                status: "error",
            };
        }

        // Use the editor's removeBehaviorFromObject method

        this.editor.removeBehaviorFromObject(this.selected, this.behaviorData?.uuid);

        if (this.behavior) {
            this.game?.behaviorManager?.destroyBehavior(this.behavior);
        }

        return {
            message: `AttachBehaviorCommand: Behavior removed (${this.behaviorId})`,
            status: "success",
        };
    }

    async redo(): Promise<{message: string; status: "success" | "info" | "error"} | void> {
        return await this.execute();
    }
}

export {AttachBehaviorCommand};
