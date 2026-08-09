import {PerspectiveCamera} from "three";
import * as THREE from "three";
import {OrbitControls} from "three/addons/controls/OrbitControls.js";

/**
 *
 * @param camera
 * @param viewer
 * @param center
 */
export default function setControls(
    camera: PerspectiveCamera,
    viewer: HTMLElement,
    center: THREE.Vector3,
): OrbitControls {
    const controls = new OrbitControls(camera, viewer);
    controls.target.set(center.x, center.y, center.z);
    controls.update();
    return controls;
}
