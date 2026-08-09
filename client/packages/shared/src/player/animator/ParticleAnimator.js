
/**
 * Module: ParticleAnimator.js
 * Purpose: Contains logic for particle animator.
 */


import PlayerComponent from "../component/PlayerComponent";

class ParticleAnimator extends PlayerComponent {
    constructor(app) {
        super(app);
        this.scene = null;
        this.particleObjects = [];
        this.particleObjectsDirty = true;
        this.markParticleObjectsDirty = () => {
            this.particleObjectsDirty = true;
        };
    }

    create(scene, _camera, _renderer) {
        this.detachSceneListeners();
        this.scene = scene;
        this.particleObjects = [];
        this.particleObjectsDirty = true;

        if (this.scene && this.scene.addEventListener) {
            this.scene.addEventListener("childadded", this.markParticleObjectsDirty);
            this.scene.addEventListener("childremoved", this.markParticleObjectsDirty);
        }

        return new Promise(resolve => {
            resolve();
        });
    }

    update(clock, deltaTime, _time) {
        if (!this.scene) {
            return;
        }

        var elapsed = clock?.elapsedTime || 0;
        var particleObjects = this.getParticleObjects();

        for (let i = 0; i < particleObjects.length; i++) {
            const n = particleObjects[i];
            switch (n.userData.type) {
                case "Fire":
                    n.userData.fire.update(elapsed);
                    break;
                case "Smoke":
                    n.update(elapsed);
                    break;
                case "Water":
                    n.update();
                    break;
                case "ParticleEmitter":
                    n.userData.group.tick(deltaTime);
                    break;
            }
        }
    }

    getParticleObjects() {
        if (this.particleObjectsDirty) {
            this.refreshParticleObjects();
        }

        return this.particleObjects;
    }

    refreshParticleObjects() {
        const children = this.scene?.children || [];
        const particleObjects = [];

        for (let i = 0; i < children.length; i++) {
            const child = children[i];
            if (this.isParticleObject(child)) {
                particleObjects.push(child);
            }
        }

        this.particleObjects = particleObjects;
        this.particleObjectsDirty = false;
    }

    isParticleObject(object) {
        const type = object?.userData?.type;
        return type === "Fire" || type === "Smoke" || type === "Water" || type === "ParticleEmitter";
    }

    detachSceneListeners() {
        if (this.scene && this.scene.removeEventListener) {
            this.scene.removeEventListener("childadded", this.markParticleObjectsDirty);
            this.scene.removeEventListener("childremoved", this.markParticleObjectsDirty);
        }
    }

    dispose() {
        this.detachSceneListeners();
        this.scene = null;
        this.particleObjects = [];
        this.particleObjectsDirty = true;
    }
}

export default ParticleAnimator;
