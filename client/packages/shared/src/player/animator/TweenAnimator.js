
/**
 * Module: TweenAnimator.js
 * Purpose: Contains logic for tween animator.
 */


import Ease from "../../utils/Ease";
import {findObjectByUuidDepthFirst} from "../../utils/SceneTraverser";
import PlayerComponent from "../component/PlayerComponent";

class TweenAnimator extends PlayerComponent {
    constructor(app) {
        super(app);
        this.targetCache = new WeakMap();
    }

    create(scene, camera, renderer, animations) {
        this.scene = scene;
        this.animations = animations || [];
        this.targetCache = new WeakMap();

        return new Promise(resolve => {
            resolve();
        });
    }

    addAnimation(layerName, layerId, animation) {
        var layer = this.animations.find(n => {
            return n.name === layerName && n.id === layerId;
        });

        if (!layer) {
            layer = {
                name: layerName,
                id: layerId,
                animations: [],
            };
            this.animations.push(layer);
        }

        this.targetCache.delete(animation);
        layer.animations.push(animation);
    }

    removeAnimationByTargetUuid(layerName, layerId, uuid) {
        var layer = this.animations.find(n => {
            return n.name === layerName && n.id === layerId;
        });

        if (!layer) {
            return;
        }

        for (let i = layer.animations.length - 1; i >= 0; i--) {
            const animation = layer.animations[i];
            if (animation.target !== uuid) {
                continue;
            }
            this.targetCache.delete(animation);
            layer.animations.splice(i, 1);
        }
    }

    update(clock, deltaTime, time) {
        const layers = this.animations;
        for (let i = 0; i < layers.length; i++) {
            const animations = layers[i].animations;
            for (let j = 0; j < animations.length; j++) {
                const m = animations[j];
                if (m.model && m.model.userData) {
                    if (m.model.userData.triggerMovement === true && m.model.userData.startOnTrigger === true) {
                        this.tweenObject(m, 0);
                        m.model.userData.startOnTrigger = false;
                        m.model.userData.triggerMovement = false;
                    } else if (
                        m.model.userData.triggerMovement === false &&
                        m.model.userData.startOnTrigger === false
                    ) {
                        this.tweenObject(m, time);
                    }
                }
            }
        }
    }

    tweenObject(animation, time) {

        if (animation.type !== "Tween" || !animation.target) {
            return;
        }

        let data = animation.data;

        //check if it's a loop
        if (time < animation.beginTime || time > animation.endTime) {
            if (!animation.loop || !animation.loopType) return;
            //TAHIR: depending on the loopType we need to reset the animation
            let duration = animation.endTime - animation.beginTime;
            animation.beginTime = time;
            animation.endTime = time + duration;
            if (animation.loopType === "reflect") {
                //pos
                [data.endPositionX, data.beginPositionX] = [data.beginPositionX, data.endPositionX];
                [data.endPositionY, data.beginPositionY] = [data.beginPositionY, data.endPositionY];
                [data.endPositionZ, data.beginPositionZ] = [data.beginPositionZ, data.endPositionZ];
                //rot
                [data.endRotationX, data.beginRotationX] = [data.beginRotationX, data.endRotationX];
                [data.endRotationY, data.beginRotationY] = [data.beginRotationY, data.endRotationY];
                [data.endRotationZ, data.beginRotationZ] = [data.beginRotationZ, data.endRotationZ];
                //scale
                [data.endScaleX, data.beginScaleX] = [data.beginScaleX, data.endScaleX];
                [data.endScaleY, data.beginScaleY] = [data.beginScaleY, data.endScaleY];
                [data.endScaleZ, data.beginScaleZ] = [data.beginScaleZ, data.endScaleZ];
            }
        }

        var target = this.resolveAnimationTarget(animation);
        if (!target) {
            //console.warn(`[Animator]: There is no object that uuid equals to ${animation.target}.`);
            return;
        }

        var ease = Ease[data.ease];
        if (!ease) {
            //console.warn(`[Animator]: There is no easy ${target.name} -> ${data.ease}`);
            return;
        }

        //console.log(`[Animator]: Updating ${target.name}`);

        var result = ease((time - animation.beginTime) / (animation.endTime - animation.beginTime));

        var positionX = data.beginPositionX + (data.endPositionX - data.beginPositionX) * result;
        var positionY = data.beginPositionY + (data.endPositionY - data.beginPositionY) * result;
        var positionZ = data.beginPositionZ + (data.endPositionZ - data.beginPositionZ) * result;

        var rotationX = data.beginRotationX + (data.endRotationX - data.beginRotationX) * result;
        var rotationY = data.beginRotationY + (data.endRotationY - data.beginRotationY) * result;
        var rotationZ = data.beginRotationZ + (data.endRotationZ - data.beginRotationZ) * result;

        var scaleX = data.beginScaleX + (data.endScaleX - data.beginScaleX) * result;
        var scaleY = data.beginScaleY + (data.endScaleY - data.beginScaleY) * result;
        var scaleZ = data.beginScaleZ + (data.endScaleZ - data.beginScaleZ) * result;

        target.position.x = positionX;
        target.position.y = positionY;
        target.position.z = positionZ;

        target.rotation.x = rotationX;
        target.rotation.y = rotationY;
        target.rotation.z = rotationZ;

        target.scale.x = scaleX;
        target.scale.y = scaleY;
        target.scale.z = scaleZ;
    }

    resolveAnimationTarget(animation) {
        if (!animation || !this.scene || !animation.target) {
            return null;
        }

        const cachedTarget = this.targetCache.get(animation);
        if (
            cachedTarget &&
            cachedTarget.uuid === animation.target &&
            this.isObjectInScene(cachedTarget)
        ) {
            return cachedTarget;
        }

        const target = findObjectByUuidDepthFirst(this.scene, animation.target);
        if (target) {
            this.targetCache.set(animation, target);
        } else {
            this.targetCache.delete(animation);
        }
        return target || null;
    }

    isObjectInScene(object) {
        let current = object;
        while (current) {
            if (current === this.scene) {
                return true;
            }
            current = current.parent;
        }
        return false;
    }

    dispose() {
        this.scene = null;
        this.animations = null;
        this.targetCache = new WeakMap();
    }
}

export default TweenAnimator;
