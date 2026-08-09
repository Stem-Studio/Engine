
/**
 * Module: PlayerAudio.js
 * Purpose: Contains logic for player audio.
 */


import {Audio, AudioLoader} from "three";
import PlayerComponent from "./PlayerComponent";
import {backendUrlFromPath} from "../../utils/UrlUtils";

const AUDIO_DISCOVERY_BATCH_SIZE = 256;
const AUDIO_DISCOVERY_FRAME_BUDGET_MS = 8;
const AUDIO_LOAD_CONCURRENCY = 4;

const nowForAudioDiscovery = () =>
    typeof performance !== "undefined" && typeof performance.now === "function"
        ? performance.now()
        : Date.now();

const yieldAudioDiscoveryToPaint = () =>
    new Promise(resolve => {
        const finish = () => setTimeout(resolve, 0);
        if (typeof requestAnimationFrame === "function") {
            requestAnimationFrame(() => finish());
        } else {
            finish();
        }
    });

class PlayerAudio extends PlayerComponent {
    constructor(app) {
        super(app);
        this.audios = [];
        this.loader = new AudioLoader();
        this.loadGeneration = 0;
        this.disposed = false;
    }

    async create(scene, _camera, _renderer) {
        this.stopAudios();
        this.disposed = false;
        const generation = ++this.loadGeneration;
        const audios = [];
        this.audios = audios;

        await this.collectAudioObjects(scene, audios, generation);
        if (generation !== this.loadGeneration || this.disposed) {
            return [];
        }

        return this.loadAudios(audios, generation);
    }

    async collectAudioObjects(scene, audios, generation) {
        if (!scene) {
            return;
        }

        if (!Array.isArray(scene.children)) {
            scene.traverse?.(n => {
                if (n instanceof Audio) {
                    audios.push(n);
                }
            });
            return;
        }

        const stack = [scene];
        let sliceStart = nowForAudioDiscovery();
        let processedThisSlice = 0;

        while (stack.length > 0) {
            if (generation !== this.loadGeneration || this.disposed) {
                return;
            }

            const node = stack.pop();
            if (!node) {
                continue;
            }

            if (node instanceof Audio) {
                audios.push(node);
            }

            const children = node.children;
            if (Array.isArray(children)) {
                for (let i = children.length - 1; i >= 0; i--) {
                    const child = children[i];
                    if (child) stack.push(child);
                }
            }

            processedThisSlice++;
            if (
                processedThisSlice >= AUDIO_DISCOVERY_BATCH_SIZE ||
                nowForAudioDiscovery() - sliceStart >= AUDIO_DISCOVERY_FRAME_BUDGET_MS
            ) {
                await yieldAudioDiscoveryToPaint();
                sliceStart = nowForAudioDiscovery();
                processedThisSlice = 0;
            }
        }
    }

    async loadAudios(audios, generation) {
        if (audios.length === 0) {
            return [];
        }

        const results = new Array(audios.length);
        const workerCount = Math.min(AUDIO_LOAD_CONCURRENCY, audios.length);
        let nextIndex = 0;

        const runWorker = async () => {
            while (nextIndex < audios.length) {
                if (generation !== this.loadGeneration || this.disposed) {
                    return;
                }

                const index = nextIndex++;
                results[index] = await this.loadAudio(audios[index], generation);
            }
        };

        await Promise.all(Array.from({length: workerCount}, runWorker));
        return results;
    }

    loadAudio(audio, generation) {
        return new Promise(resolve => {
            // TODO: global.app.options.server is not a player config
            const url = backendUrlFromPath(audio.userData.Url);
            this.loader.load(
                url,
                buffer => {
                    if (generation !== this.loadGeneration || this.disposed) {
                        resolve();
                        return;
                    }

                    audio.setBuffer(buffer);

                    if (audio.userData.autoplay) {
                        audio.autoplay = audio.userData.autoplay;
                        audio.play();
                    }

                    resolve();
                },
                undefined,
                () => {
                    if (generation === this.loadGeneration && !this.disposed) {
                        console.warn(`PlayerLoader: ${audio.userData.Url} loaded failed.`);
                    }
                    resolve();
                },
            );
        });
    }

    dispose() {
        this.disposed = true;
        this.loadGeneration++;
        this.stopAudios();
        this.audios.length = 0;
    }

    stopAudios() {
        this.audios.forEach(n => {
            if (n.isPlaying) {
                n.stop();
            }
        });
    }
}

export default PlayerAudio;
