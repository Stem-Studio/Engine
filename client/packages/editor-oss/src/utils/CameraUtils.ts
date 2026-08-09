import {Object3D} from "three";

import {traverseObjectDepthFirst} from "@stem/editor-oss/utils/SceneTraverser";

export default class CameraUtils {

    public static disableCameraCollision(target: Object3D) {
        traverseObjectDepthFirst(target, (child: Object3D) => {
            child.userData.disableCameraCollision = true;
        });
    }

    public static enableCameraCollision(target: Object3D) {
        traverseObjectDepthFirst(target, (child: Object3D) => {
            child.userData.disableCameraCollision = false;
        });
    }
    
}
