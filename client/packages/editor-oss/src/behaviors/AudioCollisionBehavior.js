/**
 * AudioCollisionBehavior Class
 * This class manages audio collision behavior in the scene.
 * It checks for collisions between objects and triggers audio playback accordingly.
 * userData Properties:
 * - collision_sensitivity: Number - Threshold for collision detection sensitivity.
 * - selected_collision_object: String - Name of the collision object.
 * - soundEnabled: Boolean - Flag indicating whether sound is enabled for the object.
 * - soundUrl: String - URL of the sound file.
 * - soundVolume: Number - Volume level for the sound.
 * - fps_player: global - variable uses control object for player set when FPS controls are enabled
 */
import * as THREE from "three";
import {traverseObjectDepthFirst} from "@stem/editor-oss/utils/SceneTraverser";

class AudioCollisionBehavior {
    static activeInstances = new Set();
    static animationFrameId = null;
    static loadingObjects = new WeakSet();
    static boundSharedAnimate = () => AudioCollisionBehavior.animateActiveInstances();

    /**
     * Constructor for AudioCollisionBehavior class.
     * Initializes properties and starts the animation loop.
     * @param scene
     */
    constructor(scene) {
        // Initialize properties
        this.scene = scene;
        this.objectsWithData = [];
        this.player = null;
        this.running = false;
        this.loadingObjects = new WeakSet();
        this.collisionTargetScratch = new Map();

        // Bind methods
        this.animate = this.animate.bind(this);
        this.handleKeyPress = this.handleKeyPress.bind(this);

        // Start animation loop
        this.start();

        // Add event listener for key press
        document.addEventListener("keydown", this.handleKeyPress);
    }

    start() {
        if (this.running) {
            return;
        }

        this.running = true;
        AudioCollisionBehavior.activeInstances.add(this);
        this.checkForObjectsWithData();
        AudioCollisionBehavior.ensureAnimationLoop();
    }

    stop() {
        this.running = false;
        AudioCollisionBehavior.activeInstances.delete(this);
        if (AudioCollisionBehavior.activeInstances.size === 0) {
            AudioCollisionBehavior.cancelAnimationLoop();
        }
    }

    dispose() {
        this.stop();
        document.removeEventListener("keydown", this.handleKeyPress);
    }

    /**
     * Animation loop function.
     * Checks for objects with data and triggers collision detection.
     */
    animate() {
        if (!this.running) {
            return;
        }

        this.checkForObjectsWithData();
        AudioCollisionBehavior.ensureAnimationLoop();
    }

    static ensureAnimationLoop() {
        if (
            AudioCollisionBehavior.animationFrameId !== null ||
            AudioCollisionBehavior.activeInstances.size === 0 ||
            typeof requestAnimationFrame !== "function"
        ) {
            return;
        }
        AudioCollisionBehavior.animationFrameId = requestAnimationFrame(AudioCollisionBehavior.boundSharedAnimate);
    }

    static cancelAnimationLoop() {
        if (AudioCollisionBehavior.animationFrameId !== null && typeof cancelAnimationFrame === "function") {
            cancelAnimationFrame(AudioCollisionBehavior.animationFrameId);
        }
        AudioCollisionBehavior.animationFrameId = null;
    }

    static animateActiveInstances() {
        AudioCollisionBehavior.animationFrameId = null;
        if (AudioCollisionBehavior.activeInstances.size === 0) {
            return;
        }
        for (const instance of AudioCollisionBehavior.activeInstances) {
            instance.checkForObjectsWithData();
        }
        AudioCollisionBehavior.ensureAnimationLoop();
    }

    /**
     * Event handler for key press.
     * Resets collected objects when 'r' key is pressed.
     * @param {object} event - The keydown event object.
     */
    handleKeyPress(event) {
        if (event.key === "r" || event.key === "R") {
            this.resetCollectedObjects();
        }
    }

    /**
     * Checks for objects with data and triggers collision detection.
     */
    checkForObjectsWithData() {
        if (!this.scene || !this.scene.userData) {
            return;
        }

        if (this.scene && this.scene.userData && this.scene.userData.fps_player) {
            this.player = this.scene.userData.fps_player;
        }

        this.collisionTargetScratch.clear();

        this.objectsWithData.length = 0;

        traverseObjectDepthFirst(this.scene, object => {
            if (object.name && !this.collisionTargetScratch.has(object.name)) {
                this.collisionTargetScratch.set(object.name, object);
            }

            if (
                object.userData &&
                object.userData.selected_collision_object &&
                object.userData.soundEnabled &&
                !object.userData.collected &&
                !this.loadingObjects.has(object) &&
                !AudioCollisionBehavior.loadingObjects.has(object)
            ) {
                this.objectsWithData.push(object);
            }
        });

        for (let i = 0; i < this.objectsWithData.length; i++) {
            const object = this.objectsWithData[i];
            const player = this.player || this.collisionTargetScratch.get(object.userData.selected_collision_object);
            if (!player || !this.checkCollision(player, object)) {
                continue;
            }

            const soundUrl = object.userData.soundUrl;
            const soundVolume = object.userData.soundVolume !== undefined ? object.userData.soundVolume : 0;
            if (soundUrl && object.visible) {
                this.loadingObjects.add(object);
                AudioCollisionBehavior.loadingObjects.add(object);
                const audioListener = new THREE.AudioListener();
                object.add(audioListener);
                const audio = new THREE.Audio(audioListener);
                const audioLoader = new THREE.AudioLoader();
                audioLoader.load(
                    soundUrl,
                    buffer => {
                        audio.setBuffer(buffer);
                        audio.setVolume(soundVolume);
                        audio.play();
                        object.visible = false;
                        object.userData.collected = true;
                        this.loadingObjects.delete(object);
                        AudioCollisionBehavior.loadingObjects.delete(object);
                    },
                    undefined,
                    error => {
                        this.loadingObjects.delete(object);
                        AudioCollisionBehavior.loadingObjects.delete(object);
                        console.error("Failed to load audio file:", error);
                    },
                );
            }
        }
    }

    /**
     * Resolve a named collision target once per frame.
     * @param {string} name
     * @returns {THREE.Object3D | null}
     */
    getCollisionTarget(name) {
        if (!name) {
            return null;
        }
        if (!this.collisionTargetScratch.has(name)) {
            let target = null;
            traverseObjectDepthFirst(this.scene, object => {
                if (!target && object.name === name) {
                    target = object;
                }
            });
            this.collisionTargetScratch.set(name, target);
        }
        return this.collisionTargetScratch.get(name);
    }

    /**
     *
     * @param obj1
     * @param obj2
     */
    checkCollision(obj1, obj2) {
        const collisionThreshold = obj2.userData.collision_sensitivity;
        if (collisionThreshold === undefined || collisionThreshold < 0) {
            return false;
        }
        return obj1.position.distanceToSquared(obj2.position) < collisionThreshold * collisionThreshold;
    }

    /**
     * Resets collected objects by making them visible again and removing the audio listener.
     */
    resetCollectedObjects() {
        if (!this.scene || !this.scene.userData) {
            return;
        }
        //this.scene = global.app.editor.scene; enable for Stem Studio usage
        traverseObjectDepthFirst(this.scene, object => {
            if (object.userData && object.userData.collected) {
                object.userData.collected = false;
                object.visible = true;
                const audioListener = object.children.find(child => child instanceof THREE.AudioListener);
                if (audioListener) {
                    object.remove(audioListener);
                }
            }
        });
    }
}

export {AudioCollisionBehavior};
