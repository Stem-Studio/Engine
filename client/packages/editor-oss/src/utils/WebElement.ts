import getYouTubeID from "get-youtube-id";
import * as THREE from "three";
import {CSS3DObject, CSS3DSprite} from "three/addons/renderers/CSS3DRenderer.js";

import {showToast} from "@stem/editor-oss/showToast";

class WebElement {
    url: string;
    width: string;
    height: string;
    backgroundColor: string;
    borderRadius: string;
    object: THREE.Group | null = null;
    isSprite: boolean = false;
    isLoop: boolean = false;
    isYouTubeLink: boolean = false;

    constructor(
        url: string,
        isSprite: boolean,
        isLoop: boolean,
        width: number,
        height: number,
        backgroundColor: string,
        borderRadius: string,
        isYouTubeLink: boolean,
    ) {
        this.url = url;
        this.isSprite = isSprite;
        this.isLoop = isLoop;
        this.width = `${width}px`;
        this.height = `${height}px`;
        this.backgroundColor = backgroundColor;
        this.borderRadius = borderRadius;
        this.isYouTubeLink = isYouTubeLink;
        this.object = this.create();
    }

    create = () => {
        if (this.isYouTubeLink) {
            const id = getYouTubeID(this.url);
            if (!id) {
                showToast({
                    type: "error",
                    title: "Billboard unavailable!",
                    body: "This URL is not a valid youtube URL.",
                });
            } else {
                this.url = `https://www.youtube.com/embed/${id}`;
            }
        }

        const div = document.createElement("div");
        div.style.width = this.width;
        div.style.height = this.height;
        div.style.backgroundColor = this.backgroundColor;

        const iframe = document.createElement("iframe");
        iframe.style.width = this.width;
        iframe.style.height = this.height;
        iframe.style.border = this.borderRadius;
        iframe.src = this.isLoop ? this.url + "?version=3&loop=1" : this.url;
        div.appendChild(iframe);
        div.style.pointerEvents = "none";
        iframe.style.pointerEvents = "all";
        iframe.allow = "autoplay";

        iframe.onerror = () => {
            showToast({
                type: "error",
                title: "Billboard unavailable!",
                body: "This website is not supported. Please try another URL.",
            });
        };

        const object = this.isSprite ? new CSS3DSprite(div) : new CSS3DObject(div);
        object.scale.set(0.01, 0.01, 0.01);

        const group = new THREE.Group();
        group.add(object);
        return group;
    };

    isValidYouTubeUrl(): boolean {
        // Regex to check if URL fits YouTube Embed format, allowing both "www" and without it
        const regex = /^(https:\/\/(?:www\.)?youtube\.com\/embed\/[a-zA-Z0-9_-]+)$/;
        return regex.test(this.url);
    }
}

export default WebElement;
