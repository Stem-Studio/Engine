/**
 * Module: VolumeSpotLightHelper.js
 * Purpose: Contains logic for volume spot light helper.
 */

import {Mesh, MeshBasicMaterial, SphereGeometry, SpotLightHelper} from "three";
class VolumeSpotLightHelper extends SpotLightHelper {
    constructor(light, color) {
        super(light, color);
        var geometry = new SphereGeometry(2, 4, 2);
        var material = new MeshBasicMaterial({
            color: 0xff0000,
            visible: false,
        });

        this.picker = new Mesh(geometry, material);
        this.picker.name = "picker";
        this.add(this.picker);
    }

    raycast(raycaster, intersects) {
        var intersect = raycaster.intersectObject(this.picker)[0];
        if (intersect) {
            intersect.object = this.light;
            intersects.push(intersect);
        }
    }

    dispose() {
        this.remove(this.picker);

        this.picker.geometry.dispose();
        this.picker.material.dispose();
        if (this.picker.dispose) {
            this.picker.dispose();
        }
        delete this.picker;

        super.dispose();
    }
}

export default VolumeSpotLightHelper;
