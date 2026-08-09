import * as THREE from "three";
import {CSS3DObject} from "three/addons/renderers/CSS3DRenderer.js";

import CameraUtils from "@stem/editor-oss/utils/CameraUtils";
import GameManager from "../game/GameManager";

class RangeDetector {
    private keyText: string | null = null;
    private text: string | null = null;
    distanceThreshold: number = 5;
    isTargetInRange: boolean = false;

    private player: THREE.Object3D | null = null;
    private target: THREE.Object3D | null = null;
    private textMesh?: CSS3DObject;
    private textElement?: HTMLSpanElement;
    private keyElement?: HTMLSpanElement;
    private gameManager: GameManager;
    private readonly playerWorldPosition = new THREE.Vector3();
    private readonly targetWorldPosition = new THREE.Vector3();
    private readonly labelWorldPosition = new THREE.Vector3();

    constructor(gameManager: GameManager) {
        this.gameManager = gameManager;
    }
    
    setActive(active: boolean) {
        if (!this.textMesh) {
            return;
        }
        this.textMesh.visible = active;
    }

    setPlayer(player: THREE.Object3D) {
        this.player = player;
    }

    setTarget(target: THREE.Object3D) {
        this.target = target;
    }

    setText(text: string) {
        if (this.text === text) {
            return;
        }
        this.text = text;
        this.updateDisplayedText();
    }
    
    setKeyText(keyText: string | null) {
        if (this.keyText === keyText) {
            return;
        }
        this.keyText = keyText;
        this.updateDisplayedKeyText();
    }

    update() {

        if (!this.player || !this.target) return;
        this.isTargetInRange = this.isInRange();

        if (this.isTargetInRange) {
            if (!this.textMesh) {
                this.createText();
            }

            this.textMesh!.visible = true;
            this.updateTextPosition(true);
            
        } else {
            if (this.textMesh) {
                this.textMesh.visible = false;
            }
        }
    }
    
    createText() {
        if (this.textMesh) {
            return;
        }

        // Main div
        const div = document.createElement("div");
        div.style.position = "absolute";
        div.style.color = "white";
        div.style.fontSize = "14px";
        div.style.background = "rgba(0, 0, 0, 0.5)";
        div.style.padding = "5px";
        div.style.borderRadius = "5px";

        // Text container
        const textContainer = document.createElement("span");
        this.textElement = textContainer;
        textContainer.innerHTML = this.text || "Interact";
        
        div.appendChild(textContainer);

        // E key element
        if (this.keyText) {
            const keyContainer = document.createElement("span");
            this.keyElement = keyContainer;
            keyContainer.innerHTML = this.keyText;
            keyContainer.style.color = "white";
            keyContainer.style.background = "#18181b";
            keyContainer.style.padding = "3px 6px";
            keyContainer.style.borderRadius = "4px";
            keyContainer.style.marginRight = "4px";
            textContainer.insertBefore(keyContainer, textContainer.firstChild);
        }

        // Create the CSS3DObject
        const object = new CSS3DObject(div);
        object.position.set(0, 0, 0);
        object.scale.set(0.02, 0.02, 0.02);
        this.gameManager.scene.add(object);
        
        CameraUtils.disableCameraCollision(object);
        this.textMesh = object;
    }

    updateDisplayedText() {
        if (this.textElement) {
            // Preserve the existing key, if it exists
            const keyElement = this.textElement.querySelector('span');

            // Update the text
            this.textElement.innerHTML = this.text || "Interact";

            // Restore the key before the text, if it was present
            if (keyElement && this.keyText) {
                this.textElement.insertBefore(keyElement, this.textElement.firstChild);
            }
        }
    }

    updateDisplayedKeyText() {
        if (!this.textElement) return;

        // Remove the old key, if it exists
        if (this.keyElement) {
            this.keyElement.remove();
            this.keyElement = undefined;
        }

        // Add a new key, if specified
        if (this.keyText) {
            const keyContainer = document.createElement("span");
            keyContainer.innerHTML = this.keyText;
            keyContainer.style.color = "white";
            keyContainer.style.background = "#18181b";
            keyContainer.style.padding = "3px 6px";
            keyContainer.style.borderRadius = "4px";
            keyContainer.style.marginRight = "4px";
            this.textElement.insertBefore(keyContainer, this.textElement.firstChild);
            this.keyElement = keyContainer;
        }
    }


    updateTextPosition(useCachedTargetPosition = false) {
        if (!this.target || !this.textMesh || !this.gameManager.camera) return;

        if (useCachedTargetPosition) {
            this.labelWorldPosition.copy(this.targetWorldPosition);
        } else {
            this.target.getWorldPosition(this.labelWorldPosition);
        }

        // const offsetY = 1.5;
        this.textMesh.position.copy(this.labelWorldPosition);
        // this.textMesh.position.y += offsetY;

        this.textMesh.lookAt(this.gameManager.camera.position);
    }

    isInRange(): boolean {
        if (!this.player || !this.target) return false;
        if (this.distanceThreshold < 0) return false;

        this.player.getWorldPosition(this.playerWorldPosition);
        this.target.getWorldPosition(this.targetWorldPosition);

        const thresholdSq = this.distanceThreshold * this.distanceThreshold;
        const distanceSq = this.playerWorldPosition.distanceToSquared(this.targetWorldPosition);

        return distanceSq <= thresholdSq;
    }

    dispose() {
        if (this.textMesh) {
         
            this.gameManager.scene?.remove(this.textMesh);

            if (this.textMesh.element?.parentElement) {
                this.textMesh.element.parentElement.removeChild(this.textMesh.element);
            }

            this.textMesh = undefined;
        }

        this.textElement = undefined;
        this.keyElement = undefined;
        this.player = null;
        this.target = null;
        this.text = null;
        this.keyText = null;
    }


}

export default RangeDetector;
