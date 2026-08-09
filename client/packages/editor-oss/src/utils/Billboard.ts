import * as THREE from "three";
import {KTX2Loader} from "three/addons/loaders/KTX2Loader.js";

import {THREE_GetGifTexture} from "./GifTexture";
import {resolveImageUrl, resolveVideoUrl, loadTextureWithAssetResolution} from "./LoaderWrappers";
import WebElement from "./WebElement";
import {getAsset} from "@stem/network/api/asset";
import {AssetRef} from "@stem/editor-oss/asset-management/AssetRef";
import {RemoveObjectCommand} from "@stem/editor-oss/command/Commands";
import global from "../global";
import {showToast} from "@stem/editor-oss/showToast";
import {BILLBOARD_TYPES} from "../types/editor";

const BILLBOARD_SELECTION_DEPTH = 0.001;
const WEB_BILLBOARD_WIDTH = 1270 * 0.01;
const WEB_BILLBOARD_HEIGHT = 720 * 0.01;

class Billboard {
    public mesh: THREE.Object3D | null = null;
    public texture: THREE.Texture | null = null;
    private billboardMode: BILLBOARD_TYPES | null = null;
    private file: AssetRef | string = "";
    private url: string = "";
    private width: number = 0;
    private height: number = 0;
    private faceCamera: boolean = false;
    private type: "image" | "gif" | "video" | "unknown" = "image";
    private loop: boolean = false;
    private twoSided: boolean = false;
    private transparent: boolean = false;
    private color: string = "#ffffff";

    constructor() {}

    create = async (
        billboardMode: BILLBOARD_TYPES,
        file: AssetRef | string,
        url: string,
        width: number,
        height: number,
        faceCamera: boolean,
        type: "image" | "gif" | "video" | "unknown",
        loop: boolean,
        twoSided: boolean,
        transparent: boolean,
        color: string,
    ) => {
        this.billboardMode = billboardMode;
        this.file = file;
        this.url = url;
        this.width = width;
        this.height = height;
        this.faceCamera = faceCamera;
        this.type = type;
        this.loop = billboardMode === BILLBOARD_TYPES.WEB ? false : loop;
        this.twoSided = twoSided;
        this.transparent = transparent;
        this.color = color;

        try {
            this.mesh = await this.createBillboard();
            if (this.mesh) {
                this.markAsBillboardContent(this.mesh);
            }
        } catch (error) {
            console.error(error);
        }
    };

    update = async (
        object: THREE.Object3D,
        billboardMode: BILLBOARD_TYPES,
        file: AssetRef | string,
        url: string,
        width: number,
        height: number,
        faceCamera: boolean,
        type: "image" | "gif" | "video" | "unknown",
        loop: boolean,
        twoSided: boolean,
        transparent: boolean,
        color: string,
    ) => {
        this.billboardMode = billboardMode;
        this.file = file;
        this.url = url;
        this.width = width;
        this.height = height;
        this.faceCamera = faceCamera;
        this.type = type;
        this.loop = billboardMode === BILLBOARD_TYPES.WEB ? false : loop;
        this.twoSided = twoSided;
        this.transparent = transparent;
        this.color = color;
        this.updateSelectionBounds(object);

        try {
            await this.updateBillboard(object);
        } catch (error) {
            console.error(error);
        }
    };

    private async createBillboard(): Promise<THREE.Mesh | THREE.Sprite | THREE.Object3D | null> {
        switch (this.billboardMode) {
            case BILLBOARD_TYPES.IMAGE:
                switch (this.type) {
                    case "image":
                        return this.createImageBillboard();
                    case "gif":
                        return this.createAnimatedBillboard();
                    case "video":
                        return this.createVideoBillboard();
                    default:
                        return this.createImageBillboard();
                }
            case BILLBOARD_TYPES.WEB:
                return this.createWebBillboard().children[0]!;
            case BILLBOARD_TYPES.YT_VIDEO:
                return this.createWebBillboard().children[0]!;
            default:
                throw new Error("Unsupported billboard mode");
        }
    }

    private async updateBillboard(object: THREE.Object3D): Promise<void> {
        try {
            const orginalChild = object.children.length > 0 ? object.children[0] : null;
            const child = await this.createBillboard();
            if (!child) {
                return;
            }
            this.markAsBillboardContent(child);
            if (child instanceof THREE.Sprite && orginalChild instanceof THREE.Sprite) {
                Object.assign(child.scale, orginalChild.scale);
            }

            if (child instanceof THREE.Sprite && orginalChild instanceof THREE.Mesh) {
                const scale = orginalChild.scale;
                child.scale.set(this.width * scale.x, this.height * scale.y, 1);
            }

            if (child instanceof THREE.Mesh && orginalChild instanceof THREE.Sprite) {
                const scale = orginalChild.scale;
                child.scale.set(scale.x / this.width, scale.y / this.height, 1);
            }

            if (child instanceof THREE.Mesh && orginalChild instanceof THREE.Mesh) {
                Object.assign(child.scale, orginalChild.scale);
            }

            if (orginalChild) {
                new RemoveObjectCommand(orginalChild).execute();
            }

            object.add(child);
        } catch (error) {
            console.error(error);
        }
    }

    private markAsBillboardContent<T extends THREE.Object3D>(object: T): T {
        object.userData.isBillboardContent = true;
        object.userData.isSelectable = false;
        object.userData.isRuntimeOnly = true;
        return object;
    }

    private updateSelectionBounds(object: THREE.Object3D): void {
        object.userData.billboardSelectionBounds = this.getSelectionBounds();
    }

    private getSelectionBounds(): {width: number; height: number; depth: number} {
        if (this.billboardMode === BILLBOARD_TYPES.WEB || this.billboardMode === BILLBOARD_TYPES.YT_VIDEO) {
            return {
                width: WEB_BILLBOARD_WIDTH,
                height: WEB_BILLBOARD_HEIGHT,
                depth: BILLBOARD_SELECTION_DEPTH,
            };
        }

        return {
            width: Math.max(Math.abs(this.width), BILLBOARD_SELECTION_DEPTH),
            height: Math.max(Math.abs(this.height), BILLBOARD_SELECTION_DEPTH),
            depth: BILLBOARD_SELECTION_DEPTH,
        };
    }

    private async createImageBillboard(): Promise<THREE.Mesh | THREE.Sprite> {
        if (!this.file || typeof this.file === "string") {
            return this.createSimpleBillboard();
        }
        const imageData = await getAsset(this.file.assetId, {includeThumbnails: true});

        if (!imageData) {
            return this.createSimpleBillboard();
        }

        if (!imageData.thumbnailUrl) {
            return this.createSimpleBillboard();
        }

        if (imageData.format === "ktx2") {
            const renderer = global?.app?.renderer;
            if (!renderer) {
                console.warn("Billboard: renderer unavailable for KTX2 texture support");
                return this.createSimpleBillboard();
            }
            const loader = new KTX2Loader().setTranscoderPath(`/assets/js/basis/`).detectSupport(renderer);
            try {
                const resolvedUrl = await resolveImageUrl(imageData.thumbnailUrl);
                this.texture = await new Promise((resolve, reject) => {
                    loader.load(resolvedUrl, resolve, undefined, reject);
                });
                if (this.texture) {
                    this.texture.userData.Server = true;
                    this.texture.userData.Url = this.file;
                }
            } catch (error) {
                console.error(error);
                this.texture = null;
            }
        } else {
            try {
                this.texture = await loadTextureWithAssetResolution(imageData.thumbnailUrl);
            } catch (error) {
                console.error("Failed to load texture:", error);
                this.texture = null;
            }
        }

        if (!this.texture) {
            showToast({type: "error", title: "Failed to load texture"});
            return this.createSimpleBillboard();
        }

        return this.createMeshFromTexture();
    }

    private createSimpleBillboard(): THREE.Mesh | THREE.Sprite {
        return this.createMeshFromColor(this.color);
    }

    private createMeshFromColor(color: string): THREE.Mesh {
        const material = new THREE.MeshBasicMaterial({
            color: new THREE.Color(color),
            side: this.twoSided ? THREE.DoubleSide : THREE.FrontSide,
            transparent: this.transparent,
        });
        const geometry = new THREE.BoxGeometry(this.width, this.height, 0.001);
        return new THREE.Mesh(geometry, material);
    }

    private createMeshFromTexture(): THREE.Mesh {
        const material = new THREE.MeshBasicMaterial({
            map: this.texture,
            side: this.twoSided ? THREE.DoubleSide : THREE.FrontSide,
            transparent: this.transparent,
            color: 0xffffff,
        });
        const geometry = new THREE.BoxGeometry(this.width, this.height, 0.001);
        return new THREE.Mesh(geometry, material);
    }

    private createFaceCameraSprite(): THREE.Sprite {
        const material = new THREE.SpriteMaterial({map: this.texture});
        const sprite = new THREE.Sprite(material);

        sprite.scale.set(this.width, this.height, 1);
        return sprite;
    }

    private async createAnimatedBillboard(): Promise<THREE.Mesh | THREE.Sprite | null> {
        if (!this.file) {
            return this.createSimpleBillboard();
        }

        if (typeof this.file !== "string") {
            console.error("File type different than expected, expected string, got:", this.file);
            return this.createSimpleBillboard();
        }

        try {
            this.texture = await THREE_GetGifTexture(this.file);

            if (!this.texture) {
                showToast({type: "error", title: "Failed to load texture"});
                return this.createSimpleBillboard();
            }

            /*if (this.faceCamera) {
                return this.createFaceCameraSprite();
            }*/

            const plane = this.createMeshFromTexture();
            plane.onBeforeRender = () => {
                if (this.texture) {
                    this.texture.needsUpdate = true;
                }
            };
            return plane;
        } catch (error) {
            showToast({type: "error", title: "Failed to load texture"});
            console.error(error);
            return null;
        }
    }

    private async createVideoBillboard(): Promise<THREE.Mesh | THREE.Sprite> {
        try {
            if (typeof this.file !== "string") {
                console.error("File type different than expected, expected string, got:", this.file);
                return this.createSimpleBillboard();
            }

            const resolvedUrl = await resolveVideoUrl(this.file);
            const video = document.createElement("video");
            video.src = resolvedUrl;
            video.loop = this.loop;
            video.muted = true;
            void video.play();

            this.texture = new THREE.VideoTexture(video);

            if (!this.texture) {
                showToast({type: "error", title: "Failed to load texture"});
                return this.createSimpleBillboard();
            }

            this.texture.minFilter = THREE.LinearFilter;
            this.texture.magFilter = THREE.LinearFilter;
            this.texture.format = THREE.RGBAFormat;

            if (this.faceCamera) {
                return this.createFaceCameraSprite();
            }
        } catch (error) {
            console.error("Failed to resolve video URL:", error);
            showToast({type: "error", title: "Failed to load video"});
            return this.createSimpleBillboard();
        }

        return this.createMeshFromTexture();
    }

    private createWebBillboard(): THREE.Group | THREE.Mesh | THREE.Sprite {
        if (!this.url) {
            return this.createSimpleBillboard();
        }

        const isYT = this.billboardMode === BILLBOARD_TYPES.YT_VIDEO;
        return new WebElement(this.url, false, this.loop, 1270, 720, this.color, "10px", isYT).object!;
    }
}

export default Billboard;
