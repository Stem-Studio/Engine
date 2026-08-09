
import * as THREE from "three";
import { ImprovedNoise } from "three/addons/math/ImprovedNoise.js";

/**
 * Generate height map data using Perlin noise
 * @param {Number} width - Width of the height map
 * @param {Number} height - Height of the height map
 * @param {Number} quality - Quality factor for noise generation
 * @returns {Uint8Array} Height map data
 */
function generateHeight(width, height, quality) {
    const data = new Uint8Array(width * height);
    const perlin = new ImprovedNoise();

    for (let i = 0; i < width; i++) {
        for (let j = 0; j < height; j++) {
            data[i * height + j] = Math.abs(perlin.noise(i / quality, j / quality, 0) * quality);
        }
    }

    return data;
}

/**
 * Bake lighting into a texture based on height map data
 * @param {Uint8Array} data - Height map data
 * @param {Number} width - Width of the texture
 * @param {Number} height - Height of the texture
 * @returns {HTMLCanvasElement} Canvas with baked lighting
 */
function generateTexture(data, width, height) {
    // Create ImageData
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext("2d");
    context.fillStyle = "#000";
    context.fillRect(0, 0, width, height);

    const image = context.getImageData(0, 0, canvas.width, canvas.height);
    const imageData = image.data;

    // Calculate lighting intensity
    const sun = new THREE.Vector3(1, 1, 1);
    sun.normalize();

    const vector3 = new THREE.Vector3(0, 0, 0);
    let shade;

    for (let i = 0, j = 0, l = imageData.length; i < l; i += 4, j++) {
        // i = pixel RGBA index, j = height data index
        vector3.x = data[j - 2] - data[j + 2];
        vector3.y = 2;
        vector3.z = data[j - width * 2] - data[j + width * 2];
        vector3.normalize();
        shade = vector3.dot(sun);
        imageData[i] = (96 + shade * 128) * (0.5 + data[j] * 0.007);
        imageData[i + 1] = (32 + shade * 96) * (0.5 + data[j] * 0.007);
        imageData[i + 2] = shade * 96 * (0.5 + data[j] * 0.007);
    }

    // Write lighting intensity to canvas
    context.putImageData(image, 0, 0);

    return canvas;
}

/**
 * Perlin Terrain
 * @class
 * @extends THREE.Mesh
 * @description Creates a terrain mesh using Perlin noise
 */
class PerlinTerrain extends THREE.Mesh {
    /**
     * Create a new Perlin terrain
     * @param {Number} [width=1000] - Terrain width
     * @param {Number} [depth=1000] - Terrain depth
     * @param {Number} [widthSegments=256] - Width segments
     * @param {Number} [depthSegments=256] - Depth segments
     * @param {Number} [quality=80] - Terrain quality (noise quality)
     */
    constructor(width = 1000, depth = 1000, widthSegments = 256, depthSegments = 256, quality = 80) {
        // Create terrain geometry
        const geometry = new THREE.PlaneGeometry(width, depth, widthSegments - 1, depthSegments - 1);
        geometry.rotateX(-Math.PI / 2);

        const vertices = geometry.attributes.position.array;
        const data = generateHeight(widthSegments, depthSegments, quality);

        for (let i = 0, l = vertices.length / 3; i < l; i++) {
            vertices[i * 3 + 1] = data[i]; // Assign y component to vertex array (ground height)
        }

        // Compute normals
        geometry.computeVertexNormals();

        // Create lighting texture
        const texture = new THREE.CanvasTexture(generateTexture(data, widthSegments, depthSegments));
        texture.wrapS = THREE.ClampToEdgeWrapping;
        texture.wrapT = THREE.ClampToEdgeWrapping;

        // Create mesh with material
        super(geometry, new THREE.MeshLambertMaterial({ map: texture }));

        this.name = _t("Terrain");
        this.position.y = -50;

        Object.assign(this.userData, {
            type: "PerlinTerrain",
            width,
            depth,
            widthSegments,
            depthSegments,
            quality,
        });
    }
}

export default PerlinTerrain;
