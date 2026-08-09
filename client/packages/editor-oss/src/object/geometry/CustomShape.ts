import * as THREE from "three";
import {SVGLoader} from "three/addons/loaders/SVGLoader.js";

// Default SVG path - a star
const defaultSVGPath = "M 0,50 L 15,15 L 50,10 L 20,-10 L 30,-50 L 0,-20 L -30,-50 L -20,-10 L -50,10 L -15,15 Z";

/**
 * Custom Shape Mesh Object
 * @class
 * @extends THREE.Mesh
 * @description A 2D shape created from SVG path data
 */
class CustomShape extends THREE.Mesh {
    /**
     * Create a new CustomShape object from SVG path
     * @param {string} svgPath - SVG path data (e.g., "M 0,0 L 10,10 L 0,20 Z")
     * @param {THREE.ShapeGeometry} geometry - The shape geometry
     * @param {THREE.MeshStandardMaterial} material - The material to apply
     */
    constructor(
        svgPath: string = defaultSVGPath,
        geometry?: THREE.ShapeGeometry,
        material: THREE.Material = new THREE.MeshStandardMaterial({side: THREE.DoubleSide}),
    ) {
        // Create shape from SVG path if geometry not provided
        if (!geometry) {
            geometry = CustomShape.createGeometryFromSVG(svgPath);
        }

        super(geometry, material);
        this.name = "Custom Shape";
        this.castShadow = true;
        this.receiveShadow = true;

        // Store the SVG path for later editing
        this.userData.svgPath = svgPath;

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

    /**
     * Create geometry from SVG path data
     * @param {string} svgPath - SVG path data
     * @returns {THREE.ShapeGeometry}
     */
    static createGeometryFromSVG(svgPath: string): THREE.ShapeGeometry {
        try {
            const svgContent = svgPath.trim();
            const isFullSvgDocument = /<svg[\s>]/i.test(svgContent);

            // Support both raw path commands and full SVG documents.
            const svgString = isFullSvgDocument
                ? svgContent
                : `<svg xmlns="http://www.w3.org/2000/svg"><path d="${svgContent}"/></svg>`;

            // Parse SVG
            const loader = new SVGLoader();
            const svgData = loader.parse(svgString);

            if (svgData.paths.length === 0) {
                throw new Error("No paths found in SVG");
            }

            // Collect shapes from all parsed paths so grouped/multi-path SVGs import fully.
            const shapes = svgData.paths.flatMap(path => path.toShapes());
            if (shapes.length === 0) {
                throw new Error("No shapes created from SVG");
            }

            // Scale down the shape (SVG coordinates are often large)
            const geometry = new THREE.ShapeGeometry(shapes);
            // Flip Y to match SVG's top-left origin with Three.js world coordinates.
            geometry.scale(0.01, -0.01, 1); // Scale to reasonable size

            return geometry;
        } catch (error) {
            console.error("Failed to parse SVG path:", error);
            // Return a simple square as fallback
            const fallbackShape = new THREE.Shape();
            fallbackShape.moveTo(-0.5, -0.5);
            fallbackShape.lineTo(0.5, -0.5);
            fallbackShape.lineTo(0.5, 0.5);
            fallbackShape.lineTo(-0.5, 0.5);
            fallbackShape.lineTo(-0.5, -0.5);
            return new THREE.ShapeGeometry(fallbackShape);
        }
    }

    /**
     * Update the shape with new SVG path
     * @param {string} svgPath - New SVG path data
     */
    updateShape(svgPath: string) {
        const newGeometry = CustomShape.createGeometryFromSVG(svgPath);

        // Dispose old geometry
        this.geometry.dispose();

        // Update geometry
        this.geometry = newGeometry;

        // Store the path
        this.userData.svgPath = svgPath;
    }
}

export default CustomShape;
