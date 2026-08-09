import * as THREE from "three";
import {CSS3DObject} from "three/addons/renderers/CSS3DRenderer.js";

import {BILLBOARD_TYPES} from "@stem/editor-oss/types/editor";
import Billboard from "@stem/editor-oss/utils/Billboard";
import {BehaviorBase} from "../../Behavior";
import GameManager from "../../game/GameManager";

class BillboardBehavior extends BehaviorBase {
    game: GameManager | null = null;
    private raycaster: THREE.Raycaster = new THREE.Raycaster();
    private v1: THREE.Vector3 = new THREE.Vector3();
    private v2: THREE.Vector3 = new THREE.Vector3();
    private v3: THREE.Vector3 = new THREE.Vector3();
    private screenPosition: THREE.Vector2 = new THREE.Vector2();
    private intersections: THREE.Intersection<THREE.Object3D>[] = [];

    init(gameManager: GameManager) {
        this.game = gameManager;
    }

    onAdded(): void {
        if (!this.target) {
            console.warn("BillboardBehavior: Target is not defined.");
        }
    }

    update(): void {
        if (!this.game?.player || !this.game?.camera || !this.game?.scene || !this.target) {
            return;
        }

        if (this.attributes.faceCamera) {
            this.target.lookAt(this.game.camera.position);
        }

        if (
            this.attributes.billboardMode === BILLBOARD_TYPES.WEB ||
            this.attributes.billboardMode === BILLBOARD_TYPES.YT_VIDEO
        ) {
            if (!this.isObjectBehindCamera(this.target, this.game.camera)) {
                const isVisible = this.isObjectVisible(
                    this.target,
                    this.game.camera,
                    this.raycaster,
                    this.game.scene.children,
                );

                const cssObject = this.target.children[0] as CSS3DObject;

                if (cssObject) {
                    if (isVisible) {
                        this.target.visible = true;
                        cssObject.element.style.display = "block";
                    } else {
                        this.target.visible = false;
                        cssObject.element.style.display = "none";
                    }
                }
            }
        }
    }

    private isObjectBehindCamera(el: THREE.Object3D, camera: THREE.Camera): boolean {
        const objectPos = this.v1.setFromMatrixPosition(el.matrixWorld);
        const cameraPos = this.v2.setFromMatrixPosition(camera.matrixWorld);
        const deltaCamObj = objectPos.sub(cameraPos);
        const camDir = camera.getWorldDirection(this.v3);
        return deltaCamObj.dot(camDir) < 0;
    }

    private isObjectVisible(
        el: THREE.Object3D,
        camera: THREE.Camera,
        raycaster: THREE.Raycaster,
        occlude: THREE.Object3D[],
    ): boolean {
        const elPos = this.v1.setFromMatrixPosition(el.matrixWorld);
        const screenPos = this.v2.copy(elPos).project(camera);

        this.screenPosition.set(screenPos.x, screenPos.y);
        raycaster.setFromCamera(this.screenPosition, camera);
        this.intersections.length = 0;
        raycaster.intersectObjects(occlude, true, this.intersections);
        if (this.intersections.length) {
            const intersectionDistance = this.intersections[0]!.distance;
            const pointDistanceSq = elPos.distanceToSquared(raycaster.ray.origin);
            return pointDistanceSq < intersectionDistance * intersectionDistance;
        }
        return true;
    }

    onRemoved(): void {
        // Cleanup logic if necessary
    }

    onReset(): void {
        // Reset logic if necessary
    }

    onEditorAdded(): void {
        this.replaceBillboard();
    }

    onEditorAttributesUpdated(): void {
        this.replaceBillboard();
    }

    private async replaceBillboard(): Promise<void> {
        if (!this.target) return;

        const {billboardMode, assetFile, urlLink, faceCamera, loop, twoSided, transparent} = this.attributes;

        const type = await this.checkFileType(assetFile || "");

        let color = "#ffffff";

        if (this.target instanceof THREE.Mesh && this.target.material instanceof THREE.MeshBasicMaterial) {
            color = `#${this.target.material.color.getHexString()}`;
        }

        if (this.target instanceof THREE.Sprite && this.target.material instanceof THREE.SpriteMaterial) {
            color = `#${this.target.material.color.getHexString()}`;
        }

        const billboard = new Billboard();

        await billboard.update(
            this.target,
            billboardMode || "image",
            assetFile || "",
            urlLink || "",
            10,
            10,
            !!faceCamera,
            type,
            !!loop,
            !!twoSided,
            !!transparent,
            color,
        );
    }

    private async checkFileType(url: string): Promise<"video" | "gif" | "image" | "unknown"> {
        try {
            const response = await fetch(url, {method: "HEAD"});
            const contentType = response.headers.get("Content-Type");

            if (!contentType) {
                return "unknown";
            }

            if (contentType.startsWith("video/")) {
                return "video";
            } else if (contentType === "image/gif") {
                return "gif";
            } else if (contentType.startsWith("image/")) {
                return "image";
            } else {
                return "unknown";
            }
        } catch (error) {
            console.error("Error fetching file type:", error);
            return "unknown";
        }
    }
}

export default BillboardBehavior;
