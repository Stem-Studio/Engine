import { Object3D } from 'three';

import { createRigidBodyHandle } from './createRigidBodyHandle';
import { GameObjectPhysics } from './GameObjectPhysics';
import { PhysicsSettings } from './PhysicsSettings';
import { configToSettings, settingsToConfig } from './util';
import GameManager from '../../../behaviors/game/GameManager';
import { PhysicsRuntimeUtil as PhysicsUtil } from '../../../physics/PhysicsRuntimeUtil';

export const createGameObjectPhysics = (object: Object3D, game?: GameManager): GameObjectPhysics => {
  return {
    configure: (settings: PhysicsSettings) => {
        const physicsConfig = PhysicsUtil.getPhysicsConfig(object) || { type: 'rigidBody' };

        object.userData.physics = {
            ...physicsConfig,
            ...settingsToConfig(settings),
        };
    },

    getSettings: () => {
        const config = PhysicsUtil.getPhysicsConfig(object);
        if (!config) {
            return undefined;
        }
        return configToSettings(config);
    },
    
    getBody: () => game ? createRigidBodyHandle(object, game) : undefined,
  };
};
