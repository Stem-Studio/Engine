
/**
 * Module: VolumePointLightHelper.js
 * Purpose: Contains logic for volume point light helper.
 */


import {EdgesGeometry, LineBasicMaterial, LineSegments, Mesh, MeshBasicMaterial, SphereGeometry} from "three";
class VolumePointLightHelper extends LineSegments {
    constructor(light, sphereSize, color) {
        const helperGeometry = new EdgesGeometry(
            new SphereGeometry( sphereSize, 4, 2 ),
        );
        const helperMaterial = new LineBasicMaterial({
            fog: false,
            toneMapped: false,
        });

        super(helperGeometry, helperMaterial);

        this.light = light;
        this.color = color;
        this.type = "PointLightHelper";
        this.matrix = this.light.matrixWorld;
        this.matrixAutoUpdate = false;

        var geometry = new SphereGeometry(2, 4, 2);
        var material = new MeshBasicMaterial({
            color: 0xff0000,
            visible: false,
        });

        this.picker = new Mesh(geometry, material);
        this.picker.name = "picker";
        this.add(this.picker);

        this.update();
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

        this.picker?.geometry.dispose();
        this.picker?.material.dispose();
        if (this.picker.dispose) {
            this.picker.dispose();
        }
        delete this.picker;

        this.geometry.dispose();
        this.material.dispose();
    }

    update() {
        this.light.updateWorldMatrix(true, false);

        if (this.color !== undefined) {
            this.material.color.set(this.color);
        } else {
            this.material.color.copy(this.light.color);
        }
    }
}

export default VolumePointLightHelper;
