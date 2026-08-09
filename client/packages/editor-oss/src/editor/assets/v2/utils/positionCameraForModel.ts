import * as THREE from "three";
import type {OrbitControls} from "three/addons/controls/OrbitControls.js";

import { getObjectBoundingBox } from '@stem/editor-oss/model/gaussianSplats';

export const positionCameraForModel = (
    model: THREE.Object3D,
    camera: THREE.PerspectiveCamera,
    controls: OrbitControls,
) => {
    // Calculate the bounding box of the model
    const box = getObjectBoundingBox(model);

    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());

    const hasFiniteBounds =
        Number.isFinite(size.x) && Number.isFinite(size.y) && Number.isFinite(size.z) &&
        Number.isFinite(center.x) && Number.isFinite(center.y) && Number.isFinite(center.z);

    if (!hasFiniteBounds || box.isEmpty() || Math.max(size.x, size.y, size.z) <= 0) {
        center.set(0, 0, 0);
        size.set(1, 1, 1);
    }

    // Calculate the appropriate distance for the camera
    // Use the diagonal of the bounding box for more accurate sizing
    const diagonal = Math.sqrt(size.x * size.x + size.y * size.y + size.z * size.z);
    const maxDim = Math.max(size.x, size.y, size.z, diagonal * 0.6);
    const fov = camera.fov * (Math.PI / 180);

    // Calculate distance needed to fit the model in view
    // Add extra margin (2.0x) to ensure large models fit with padding
    let cameraDistance = Math.abs(maxDim / Math.tan(fov / 2));
    cameraDistance *= 2.0;

    // Ensure minimum camera distance for very small models
    cameraDistance = Math.max(cameraDistance, 1);

    // Update camera near/far planes based on model size to prevent clipping
    const nearPlane = Math.max(0.01, cameraDistance * 0.001);
    const farPlane = Math.max(1000, cameraDistance * 10);
    camera.near = nearPlane;
    camera.far = farPlane;
    camera.updateProjectionMatrix();

    // Position camera at isometric angle for better 3D viewing
    const horizontalAngle = Math.PI / 4; // 45 degrees horizontal
    const verticalAngle = Math.PI / 6;   // 30 degrees elevation

    const newPos = new THREE.Vector3(
        center.x + cameraDistance * Math.sin(horizontalAngle) * Math.cos(verticalAngle),
        center.y + cameraDistance * Math.sin(verticalAngle),
        center.z + cameraDistance * Math.cos(horizontalAngle) * Math.cos(verticalAngle),
    );

    camera.position.copy(newPos);
    camera.lookAt(center);

    controls.target.set(center.x, center.y, center.z);
    controls.update();
};
