/**
 * UIKit replacement for CustomMiniMap.tsx
 * Renders a mini-map using either a static image or a render-to-texture camera.
 */
import {Container, Image} from "@ni2khanna/uikit";
import * as THREE from "three";


import {IMiniMapInterface} from "@stem/editor-oss/editor/assets/v2/HUD/HUDEditView/types";
import global from "@stem/editor-oss/global";

export class UIKitMiniMap {
    readonly container: Container;
    private camera?: THREE.PerspectiveCamera;
    private mapRenderer?: THREE.WebGLRenderer;
    private renderTarget?: THREE.WebGLRenderTarget;

    constructor(style: IMiniMapInterface) {
        this.container = new Container({
            width: 174,
            height: 174,
            borderRadius: 12,
            overflow: "hidden",
            pointerEvents: "auto",
        });

        if (style.uploadedMapImg) {
            // Static image mini-map
            const mapImage = new Image({
                src: style.uploadedMapImg,
                width: "100%",
                height: "100%",
                objectFit: "cover",
            });
            this.container.add(mapImage);
        } else if (style.useMiniMapCamera) {
            // Render-to-texture mini-map
            this.setupRenderToTexture();
        }
    }

    private setupRenderToTexture() {
        const app = (global as any).app;
        const scene = app?.editor?.scene;
        if (!scene) return;

        this.renderTarget = new THREE.WebGLRenderTarget(174, 174);
        this.camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
        this.camera.position.set(0, 100, 0);
        this.camera.lookAt(0, 0, 0);

        // Use a texture image to show the render target
        const mapImage = new Image({
            src: this.renderTarget.texture,
            width: "100%",
            height: "100%",
            objectFit: "fill",
        });
        this.container.add(mapImage);

        this.mapRenderer = app.renderer;
    }

    update() {
        if (!this.camera || !this.mapRenderer || !this.renderTarget) return;

        const app = (global as any).app;
        const scene = app?.editor?.scene;
        if (!scene) return;

        const currentTarget = this.mapRenderer.getRenderTarget();
        this.mapRenderer.setRenderTarget(this.renderTarget);
        this.mapRenderer.render(scene, this.camera);
        this.mapRenderer.setRenderTarget(currentTarget);
    }

    dispose() {
        this.renderTarget?.dispose();
        this.container.dispose();
    }
}
