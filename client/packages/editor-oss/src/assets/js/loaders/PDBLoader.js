import * as THREE from "three";
import { PDBLoader as ThreePDBLoader } from "three/addons/loaders/PDBLoader.js";

import BaseLoader from "./BaseLoader";

/**
 * PDBLoader
 *
 */
class PDBLoader extends BaseLoader {
    constructor() {
        super();
    }

    load(url) {

        return new Promise(resolve => {
            const loader = new ThreePDBLoader();

            const offset = new THREE.Vector3();

            loader.load(
                url,
                pdb => {
                    const geometryAtoms = pdb.geometryAtoms;
                    const geometryBonds = pdb.geometryBonds;
                    // var json = pdb.json;

                    const root = new THREE.Group();

                    const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
                    const sphereGeometry = new THREE.IcosahedronGeometry(1, 2);
                    const atomMaterials = new Map();
                    const bondMaterial = new THREE.MeshPhongMaterial({color: 0xffffff});

                    geometryAtoms.computeBoundingBox();
                    geometryAtoms.boundingBox.getCenter(offset).negate();

                    geometryAtoms.translate(offset.x, offset.y, offset.z);
                    geometryBonds.translate(offset.x, offset.y, offset.z);

                    let positions = geometryAtoms.getAttribute("position");
                    const colors = geometryAtoms.getAttribute("color");

                    const position = new THREE.Vector3();
                    const color = new THREE.Color();

                    let i;
                    let object;

                    for (i = 0; i < positions.count; i++) {
                        position.x = positions.getX(i);
                        position.y = positions.getY(i);
                        position.z = positions.getZ(i);

                        color.r = colors.getX(i);
                        color.g = colors.getY(i);
                        color.b = colors.getZ(i);

                        const colorKey = `${color.r},${color.g},${color.b}`;
                        let material = atomMaterials.get(colorKey);
                        if (!material) {
                            material = new THREE.MeshPhongMaterial({color: color.clone()});
                            atomMaterials.set(colorKey, material);
                        }

                        object = new THREE.Mesh(sphereGeometry, material);
                        object.position.copy(position);
                        object.position.multiplyScalar(75);
                        object.scale.multiplyScalar(25);
                        root.add(object);
                    }

                    positions = geometryBonds.getAttribute("position");

                    const start = new THREE.Vector3();
                    const end = new THREE.Vector3();

                    for (i = 0; i < positions.count; i += 2) {
                        start.x = positions.getX(i);
                        start.y = positions.getY(i);
                        start.z = positions.getZ(i);

                        end.x = positions.getX(i + 1);
                        end.y = positions.getY(i + 1);
                        end.z = positions.getZ(i + 1);

                        start.multiplyScalar(75);
                        end.multiplyScalar(75);

                        object = new THREE.Mesh(boxGeometry, bondMaterial);
                        object.position.copy(start);
                        object.position.lerp(end, 0.5);
                        object.scale.set(5, 5, start.distanceTo(end));
                        object.lookAt(end);
                        root.add(object);
                    }

                    resolve(root);
                },
                undefined,
                () => {
                    resolve(null);
                },
            );
        });
    }
}

export default PDBLoader;
