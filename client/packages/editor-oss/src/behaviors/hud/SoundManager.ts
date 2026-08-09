import * as THREE from "three";

import {ISoundSettings} from "@stem/editor-oss/types/editor";

class SoundManager {
    scene: THREE.Scene | null = null;
    audioListener: THREE.AudioListener | null = null;
    loadedSounds: Record<string, THREE.Audio> = {};
    totalSounds: number = -1;
    currentlyPlayingSoundId: string | null = null;
    private activeSounds: Record<string, THREE.Audio> = {};
    private audioLoader = new THREE.AudioLoader();
    private loadGeneration = 0;
    private pendingLoads = 0;

    constructor(scene: THREE.Scene | null) {
        this.scene = scene;
        this.audioListener = null;
        this.loadedSounds = {};
        this.clearLoadedSounds();
        this.audioListener = new THREE.AudioListener();
    }

    // Method to clear loaded sounds
    clearLoadedSounds() {
        this.loadGeneration++;
        this.pendingLoads = 0;
        this.currentlyPlayingSoundId = null;
        this.stopAllSounds();

        for (const id in this.loadedSounds) {
            if (Object.prototype.hasOwnProperty.call(this.loadedSounds, id)) {
                this.disposeSound(id);
            }
        }
    }

    stopAllSounds() {
        Object.keys(this.activeSounds).forEach(id => {
            const sound = this.activeSounds[id];
            if (sound && sound.isPlaying) {
                sound.stop();
            }
        });
        this.activeSounds = {};
    }

    stopSound(id: string) {
        if (!this.loadedSounds || !this.loadedSounds[id]) {
            console.warn(`Sound with ID "${id}" not found or already removed.`);
            return;
        }
        this.loadedSounds[id].stop();
    }

    loadSounds(soundSettings: ISoundSettings[]) {
        if (!soundSettings.length) {
            return;
        }

        const generation = ++this.loadGeneration;
        const settingsById = new Map<string, ISoundSettings>();
        soundSettings.forEach(setting => settingsById.set(setting.id, setting));
        const settings = [...settingsById.values()];
        this.totalSounds = settings.length;
        this.pendingLoads = settings.length;

        settings.forEach((setting: ISoundSettings) => {
            this.disposeSound(setting.id);

            this.audioLoader.load(
                setting.url,
                buffer => {
                    if (generation !== this.loadGeneration) {
                        return;
                    }

                    const sound = new THREE.Audio(this.audioListener!);
                    sound.setBuffer(buffer);

                    sound.setLoop(setting.loop);
                    sound.setVolume(setting.volume * 0.5);

                    this.loadedSounds[setting.id] = sound;
                    this.pendingLoads = Math.max(0, this.pendingLoads - 1);

                    if (this.pendingLoads === 0) {
                        this.onAllSoundsLoaded();
                    }

                    // Play the "background" sound once it's loaded
                    if (setting.soundType === "play-now" || setting.soundType === "menu-background") {
                        this.playSound(setting.id, setting.soundType);
                    }
                    if (setting.soundType === "play-preview") {
                        this.playSoundPreview(setting.id);
                    }
                },
                undefined,
                error => {
                    if (generation === this.loadGeneration) {
                        this.pendingLoads = Math.max(0, this.pendingLoads - 1);
                    }
                    console.error("Failed to load audio file:", error);
                },
            );
        });
    }

    onAllSoundsLoaded() {
        console.log("All sounds have been loaded.");
    }

    async playSoundPreview(id: string) {
        this.stopAllSounds();

        const sound = this.loadedSounds[id];
        if (!sound) {
            console.error(`Sound with ID "${id}" not found.`);
            return;
        }

        this.activeSounds[id] = sound;
        sound.play();
    }

    playSound(id: string, type?: string) {
        const sound = this.loadedSounds[id];
        if (sound) {
            if (type === "play-now" || type === "jump" || type === "menu-background") {
                sound.setVolume(0.5);
            } else {
                sound.stop();
                sound.setVolume(1.5);
            }

            sound.play();
        } else {
            console.error(`Sound with ID "${id}" not found.`);
        }
    }

    setVolume(id: string, volume: number) {
        const sound = this.loadedSounds[id];
        if (sound) {
            sound.setVolume(volume);
        } else {
            console.error(`Sound with ID "${id}" not found.`);
        }
    }

    muteAllSounds() {
        for (const id in this.loadedSounds) {
            if (Object.prototype.hasOwnProperty.call(this.loadedSounds, id)) {
                const sound = this.loadedSounds[id];
                if (sound) {
                    sound.setVolume(0);
                }
            }
        }
    }

    private disposeSound(id: string) {
        const sound = this.loadedSounds[id];
        if (!sound) {
            return;
        }

        if (sound.isPlaying) {
            sound.stop();
        }
        sound.disconnect();
        delete this.loadedSounds[id];
        delete this.activeSounds[id];
    }
}

export {SoundManager};
