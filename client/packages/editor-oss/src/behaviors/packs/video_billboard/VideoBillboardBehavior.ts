import * as THREE from "three";
import {Mesh, Material} from "three";

import {VideoSource} from "./VideoSource";
import {isAssetRef} from "@stem/editor-oss/asset-management/AssetRef";
import {showToast} from "@stem/editor-oss/showToast";
import {BehaviorBase} from "../../Behavior";
import ScalingImageMaterial from "../shared/ScalingImageMaterial";

class VideoBillboardBehavior extends BehaviorBase {
    game: any = null;

    private originalMaterial: Material | Material[] | null = null;
    private isPlaying: boolean = false;
    private proximityDistance: number = 0;
    private wasPlayingBeforeDispose: boolean = false;

    private videoSource?: VideoSource;
    private videoElem?: HTMLVideoElement;
    public initialVolume: number = 0.1;

    init(game: any) {
        this.game = game;
    }

    async onAdded(): Promise<void> {
        if (!this.target) {
            console.warn("Video BB: target does not exist");
            return;
        }

        this.proximityDistance = this.attributes["proximity"] || 0;
        this.initialVolume = this.attributes["volume"] ?? 0.1;

        let mesh =
            this.target instanceof THREE.Mesh
                ? this.target
                : (this.target.children.find(c => c instanceof THREE.Mesh) as THREE.Mesh);

        if (!mesh) {
            mesh = this.createPlaceholderMesh();
            this.target.add(mesh);
        }

        mesh.userData.isBillboardContent = true;
        mesh.userData.isSelectable = false;
        mesh.userData.isRuntimeOnly = true;

        this.originalMaterial = mesh.material;

        let videoUrl: string;
        let source: "internal" | "external" | "asset" = "external";

        const videoAsset = this.attributes.videoAsset;
        if (videoAsset && isAssetRef(videoAsset)) {
            try {
                videoUrl = await this.stem.asset.video.getUrl(videoAsset);
                source = "asset";
            } catch (err) {
                console.error("Video BB: failed to load asset URL, falling back to legacy", err);
                const legacy = this.getVideoUrl();
                videoUrl = legacy.url;
                source = legacy.source;
            }
        } else {
            const legacy = this.getVideoUrl();
            videoUrl = legacy.url;
            source = legacy.source;
        }

        const url = videoUrl;
        if (!url || url.toLowerCase() === "none") {
            mesh.material = new THREE.MeshBasicMaterial({color: 0x808080, side: THREE.DoubleSide});
            return;
        }
        this.videoSource = new VideoSource(
            this.game?.renderer,
            document.body,
            this.attributes["muted"],
            url,
        );
        this.videoSource
            .createVideoSource()
            .then(videoElem => {
                this.videoElem = videoElem;
                const width = this.videoSource!.getWidth();
                const height = this.videoSource!.getHeight();
                const material = this.createMaterial(
                    this.getAspectRatio(width, height),
                    this.attributes["fit"] || "cover",
                    !!this.attributes["autoplay"],
                    this.attributes["rotate"],
                );

                if (material) {
                    mesh.material = material;

                    this.videoSource!.setLoop(!!this.attributes["loop"]);

                    this.videoSource!.setVolume(this.initialVolume);
                    if (this.attributes["autoplay"] || this.wasPlayingBeforeDispose) {
                        this.play();
                        this.wasPlayingBeforeDispose = false;
                    }
                }
            })
            .catch(async err => {
                console.error("Video BB: failed to load main source", err);
                const fallbackUrl =
                    source === "external" ? this.attributes["internal_url"] : this.attributes["external_url"];
                if (fallbackUrl) {
                    try {
                        showToast({
                            title: source === "external" ? "Cannot load video from URL" : "Cannot Load local video",
                            type: "error",
                        });
                        showToast({
                            title:
                                source === "external"
                                    ? "Trying to use local video as fallback..."
                                    : "Trying to use URL as fallback",
                            type: "info",
                        });
                        const fallbackVideoSource = new VideoSource(
                            this.game?.renderer,
                            document.body,
                            this.attributes["muted"],
                            fallbackUrl,
                        );
                        const fallbackVideoElem = await fallbackVideoSource.createVideoSource();
                        this.videoSource = fallbackVideoSource;
                        this.videoElem = fallbackVideoElem;

                        const width = this.videoSource.getWidth();
                        const height = this.videoSource.getHeight();
                        const material = this.createMaterial(
                            this.getAspectRatio(width, height),
                            this.attributes["fit"] || "cover",
                            !!this.attributes["autoplay"],
                            this.attributes["rotate"],
                        );
                        if (material) mesh.material = material;

                        this.videoSource.setLoop(!!this.attributes["loop"]);

                        this.videoSource.setVolume(this.initialVolume);
                        if (this.attributes["autoplay"] || this.wasPlayingBeforeDispose) {
                            this.play();
                            this.wasPlayingBeforeDispose = false;
                        }
                    } catch (fallbackErr) {
                        console.error("Video BB: fallback also failed", fallbackErr);
                        mesh.material = new THREE.MeshBasicMaterial({color: 0x808080, side: THREE.DoubleSide});
                    }
                } else {
                    mesh.material = new THREE.MeshBasicMaterial({color: 0x808080, side: THREE.DoubleSide});
                }
            });
    }

    onEvent(msg: string, data: any): void {
        if (msg === "trigger" && this.attributes.startOnTrigger) {
            if (data.actionType === "activate") {
                this.play();
            } else if (data.actionType === "deactivate") {
                this.stop();
            }
        }
    }

    getAspectRatio(imgWidth: number, imgHeight: number) {
        const imgAspect = imgWidth / imgHeight;
        const geoAspect = this.attributes["aspect"] || 1;
        return this.attributes["fit"] === "cover" ? imgAspect / geoAspect : geoAspect / imgAspect;
    }

    createMaterial(vidAspect: number, fit: string, autoPlay: boolean, rotateDegrees: number) {
        if (this.videoElem) {
            const texture = this.videoSource ? this.videoSource.getTexture()! : new THREE.VideoTexture(this.videoElem);

            return ScalingImageMaterial.createMaterial(texture, vidAspect, rotateDegrees * Math.PI / 180);
        } else console.error("Video BB: this.videoElem is undefined");
    }

    update() {
        if (!this.videoSource || !this.videoSource.isReady() || !this.target) return;

        const texture = this.videoSource.getTexture();
        if (texture && this.videoSource.isPlaying()) {
            texture.needsUpdate = true;
        }

        if (this.game?.player && this.proximityDistance > 0) {
            const proximityDistanceSq = this.proximityDistance * this.proximityDistance;
            const distanceToPlayerSq = this.game.player.position.distanceToSquared(this.target.position);

            if (distanceToPlayerSq < proximityDistanceSq) {
                const distanceToPlayer = Math.sqrt(distanceToPlayerSq);
                const distanceRatio = Math.max(0, Math.min(1, 1 - distanceToPlayer / this.proximityDistance));
                const calculatedVolume = distanceRatio * this.initialVolume;
                this.videoSource.setVolume(calculatedVolume);
                this.play();
            } else {
                this.videoSource.setVolume(0);
                this.pause();
            }
        }
    }

    private createPlaceholderMesh(): THREE.Mesh {
        const geometry = new THREE.BoxGeometry(10, 10, 0.001);
        const material = new THREE.MeshBasicMaterial({color: 0x808080, side: THREE.DoubleSide});
        return new THREE.Mesh(geometry, material);
    }

    getVideoUrl(): {url: string; source: "internal" | "external"} {
        const useLocal = this.attributes["useLocalFile"];
        const internal = this.attributes["internal_url"];
        const external = this.attributes["external_url"];

        const [url, source] = useLocal
            ? [internal || external, internal ? "internal" : "external"]
            : [external || internal, external ? "external" : "internal"];

        if (!url || url.toLowerCase() === "none") return {url, source: source as "internal" | "external"};

        try {
            const parsed = new URL(url);
            if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
                showToast({title: "Incorrect protocol in URL", body: url, type: "error"});
            }
        } catch {
            showToast({title: "Incorrect video URL", body: url, type: "error"});
        }

        return {url, source: source as "internal" | "external"};
    }

    onEditorAdded() {
        this.dispose();
        this.onAdded();
    }

    onEditorRemoved() {
        this.dispose();
    }

    onEditorDispose() {
        this.dispose();
    }

    onEditorAttributesUpdated() {
        this.wasPlayingBeforeDispose = this.isPlaying;

        const videoAsset = this.attributes.videoAsset;
        const hasAssetVideo = videoAsset && isAssetRef(videoAsset);
        const currentUrl = this.getVideoUrl();
        const needsReload = hasAssetVideo || !this.videoSource || currentUrl.url !== this.videoSource.getUrl();

        if (needsReload) {
            this.dispose();
            this.onAdded();
        } else {
            const mesh =
                this.target instanceof THREE.Mesh
                    ? this.target
                    : (this.target?.children.find(c => c instanceof THREE.Mesh) as THREE.Mesh);

            if (mesh && this.videoSource && this.videoElem) {
                const width = this.videoSource.getWidth();
                const height = this.videoSource.getHeight();
                const material = this.createMaterial(
                    this.getAspectRatio(width, height),
                    this.attributes["fit"] || "cover",
                    !!this.attributes["autoplay"],
                    this.attributes["rotate"] || 0,
                );

                if (material) {
                    mesh.material = material;
                }

                this.proximityDistance = this.attributes["proximity"] || 0;
                this.initialVolume = this.attributes["volume"] ?? 0.1;
                this.videoSource.setVolume(this.initialVolume);
                this.videoSource.setLoop(!!this.attributes["loop"]);
            }
        }
    }

    onRemoved(): void {
        this.dispose();
    }

    dispose() {
        super.dispose();

        if (!this.wasPlayingBeforeDispose) {
            this.stop();
        } else {
            if (this.videoSource && this.videoSource.isReady()) {
                this.videoSource.pause();
            } else if (this.videoElem) {
                this.videoElem.pause();
            }
            this.isPlaying = false;
        }

        if (this.target instanceof Mesh && this.originalMaterial) {
            this.target.material = this.originalMaterial;
        }

        this.videoSource?.release();
        this.videoElem = undefined;
        this.videoSource = undefined;
    }

    private play() {
        if (this.isPlaying) return;

        const onPlaySuccess = () => {
            this.isPlaying = true;
        };
        const onPlayError = (err: any) => {
            console.warn("Video BB: play failed", err);
            this.isPlaying = false;

            // Fallback to muted autoplay if not allowed
            if (err.name === "NotAllowedError" && this.videoSource && !this.videoSource.isMuted()) {
                console.warn("Video BB: attempting muted autoplay fallback");
                this.videoSource.setMuted(true);
                this.videoSource.play().then(onPlaySuccess).catch(e => {
                    console.warn("Video BB: muted autoplay also failed", e);
                });
            }
        };

        if (this.videoSource && this.videoSource.isReady()) {
            this.videoSource.play().then(onPlaySuccess).catch(onPlayError);
        } else if (this.videoElem) {
            this.videoElem.play().then(onPlaySuccess).catch(onPlayError);
        } else {
            console.warn("Video BB: play is requested while video is not ready");
        }
    }

    private pause() {
        if (!this.isPlaying) return;

        if (this.videoSource && this.videoSource.isReady()) {
            this.videoSource.pause();
        } else if (this.videoElem) {
            this.videoElem.pause();
        } else {
            console.warn("Video BB: pause is requested while video is not ready");
            return;
        }

        this.isPlaying = false;
    }

    private stop() {
        if (!this.isPlaying) return;

        if (this.videoSource && this.videoSource.isReady()) {
            this.videoSource.stop();
        } else if (this.videoElem) {
            this.videoElem.pause();
            this.videoElem.currentTime = 0;
        } else {
            console.warn("Video BB: stop is requested while video is not ready");
            return;
        }

        this.isPlaying = false;
    }
}

export default VideoBillboardBehavior;
