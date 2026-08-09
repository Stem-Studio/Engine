import * as THREE from "three";
import { TeapotGeometry } from "three/addons/geometries/TeapotGeometry.js";

/**
 * Teapot Mesh Object
 * @class
 * @extends THREE.Mesh
 * @description A 3D teapot with configurable geometry and material
 */
class Teapot extends THREE.Mesh {
    /**
     * Create a new Teapot object
     * @param {TeapotGeometry} [geometry=new TeapotGeometry(3, 10, true, true, true, true, true)] - The teapot geometry
     * @param {THREE.MeshStandardMaterial} [material=new THREE.MeshStandardMaterial()] - The material to apply
     */
    constructor(
        geometry = new TeapotGeometry(3, 10, true, true, true, true, true),
        material = new THREE.MeshStandardMaterial(),
    ) {
        super(geometry, material);
        
        // Fix type error in TeapotGeometry, originally BufferGeometry
        geometry.type = "TeapotGeometry";

        // Fix missing parameters in TeapotGeometry
        geometry.parameters = {
            size: 3,
            segments: 10,
            bottom: true,
            lid: true,
            body: true,
            fitLid: true,
            blinn: true,
        };

        this.name = _t("Teapot");
        this.castShadow = true;
        this.receiveShadow = true;

        // Set up default physics properties
        this.userData.physics = this.userData.physics || {
            enabled: true,
            type: "rigidBody",
            shape: "btBoxShape",
            mass: 0,
            inertia: {
                x: 0,
                y: 0,
                z: 0,
            },
            restitution: 0,
            ctype: "Static",
        };
    }
}

export default Teapot;
