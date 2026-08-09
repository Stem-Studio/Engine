import * as THREE from "three";
import {TextGeometry} from "three/addons/geometries/TextGeometry.js";
import {Font} from "three/addons/loaders/FontLoader.js";

import {BodyShapeType} from "@stem/editor-oss/physics/common/types";

/**
 * 3D Text Mesh Object
 * @class
 * @extends THREE.Mesh
 * @description A 3D text mesh with configurable content, font, and extrusion parameters
 */
class Text3D extends THREE.Mesh {
    /**
     * Create a new Text3D object
     * @param {string} text - The text content to display
     * @param {Font} font - The loaded font to use
     * @param {object} options - Text geometry options
     * @param options.fontSize
     * @param options.lineHeight
     * @param options.spacing
     * @param options.fontName
     * @param options.weight
     * @param options.horizontalAlign
     * @param options.verticalAlign
     * @param options.case
     * @param options.extrusion
     * @param options.bevel
     * @param options.bevelSides
     * @param material
     */
    constructor(
        text: string = "Text",
        font: Font,
        options: {
            fontSize?: number;
            lineHeight?: number;
            spacing?: number;
            fontName?: string;
            weight?: string;
            horizontalAlign?: string;
            verticalAlign?: string;
            case?: string;
            extrusion?: number;
            bevel?: number;
            bevelSides?: number;
        } = {},
        material = new THREE.MeshStandardMaterial({color: 0xffffff}),
    ) {
        // Apply case transformation
        let displayText = text;
        if (options.case === "uppercase") {
            displayText = text.toUpperCase();
        } else if (options.case === "lowercase") {
            displayText = text.toLowerCase();
        }

        // Use fontSize directly as the size (no scaling)
        const threeSize = options.fontSize ?? 1;

        const geometry = new TextGeometry(displayText, {
            font: font,
            size: threeSize,
            depth: options.extrusion ?? 0,
            curveSegments: 12,
            bevelEnabled: (options.bevel ?? 0) > 0,
            bevelThickness: options.bevel ?? 0,
            bevelSize: options.bevel ?? 0,
            bevelOffset: 0,
            bevelSegments: options.bevelSides ?? 1,
        });

        // Center the geometry based on alignment
        geometry.computeBoundingBox();
        if (geometry.boundingBox) {
            const centerOffset = new THREE.Vector3();
            geometry.boundingBox.getCenter(centerOffset);

            // Horizontal alignment
            if (options.horizontalAlign === "center" || options.horizontalAlign === "justify") {
                geometry.translate(-centerOffset.x, 0, 0);
            } else if (options.horizontalAlign === "right") {
                geometry.translate(-geometry.boundingBox.max.x, 0, 0);
            } else {
                // left
                geometry.translate(-geometry.boundingBox.min.x, 0, 0);
            }

            // Vertical alignment
            if (options.verticalAlign === "middle") {
                geometry.translate(0, -centerOffset.y, 0);
            } else if (options.verticalAlign === "bottom") {
                geometry.translate(0, -geometry.boundingBox.min.y, 0);
            } else {
                // top
                geometry.translate(0, -geometry.boundingBox.max.y, 0);
            }

            // Center on Z-axis
            geometry.translate(0, 0, -centerOffset.z);
        }

        super(geometry, material);

        this.name = "Text";
        this.castShadow = true;
        this.receiveShadow = true;

        // Store text configuration in userData for later editing
        // Collaborative clients load the font by fontName from local assets
        this.userData.textConfig = {
            text,
            fontSize: options.fontSize ?? 1,
            lineHeight: options.lineHeight ?? 1.2,
            spacing: options.spacing ?? 0,
            fontName: options.fontName ?? "helvetiker",
            weight: options.weight ?? "regular",
            horizontalAlign: options.horizontalAlign ?? "center",
            verticalAlign: options.verticalAlign ?? "middle",
            case: options.case ?? "normal",
            extrusion: options.extrusion ?? 0.2,
            bevel: options.bevel ?? 0,
            bevelSides: options.bevelSides ?? 1,
        };

        // Set up default physics properties
        this.userData.physics = this.userData.physics || {
            enabled: false, // Text is usually static decoration
            type: "rigidBody",
            shape: BodyShapeType.CONVEX_HULL, // Use convex hull for collision
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
     * Update the text content and regenerate geometry
     * @param text
     * @param font
     * @param options
     * @param options.fontSize
     * @param options.lineHeight
     * @param options.spacing
     * @param options.fontName
     * @param options.weight
     * @param options.horizontalAlign
     * @param options.verticalAlign
     * @param options.case
     * @param options.extrusion
     * @param options.bevel
     * @param options.bevelSides
     */
    updateText(
        text: string,
        font: Font,
        options: {
            fontSize?: number;
            lineHeight?: number;
            spacing?: number;
            fontName?: string;
            weight?: string;
            horizontalAlign?: string;
            verticalAlign?: string;
            case?: string;
            extrusion?: number;
            bevel?: number;
            bevelSides?: number;
        },
    ) {
        // Dispose old geometry
        if (this.geometry) {
            this.geometry.dispose();
        }

        // Apply case transformation
        let displayText = text;
        if (options.case === "uppercase") {
            displayText = text.toUpperCase();
        } else if (options.case === "lowercase") {
            displayText = text.toLowerCase();
        }

        // Use fontSize directly as the size
        const threeSize = options.fontSize ?? 1;

        const geometry = new TextGeometry(displayText, {
            font: font,
            size: threeSize,
            depth: options.extrusion ?? 0,
            curveSegments: 12,
            bevelEnabled: (options.bevel ?? 0) > 0,
            bevelThickness: options.bevel ?? 0,
            bevelSize: options.bevel ?? 0,
            bevelOffset: 0,
            bevelSegments: options.bevelSides ?? 1,
        });

        // Center the geometry based on alignment
        geometry.computeBoundingBox();
        if (geometry.boundingBox) {
            const centerOffset = new THREE.Vector3();
            geometry.boundingBox.getCenter(centerOffset);

            // Horizontal alignment
            if (options.horizontalAlign === "center" || options.horizontalAlign === "justify") {
                geometry.translate(-centerOffset.x, 0, 0);
            } else if (options.horizontalAlign === "right") {
                geometry.translate(-geometry.boundingBox.max.x, 0, 0);
            } else {
                // left
                geometry.translate(-geometry.boundingBox.min.x, 0, 0);
            }

            // Vertical alignment
            if (options.verticalAlign === "middle") {
                geometry.translate(0, -centerOffset.y, 0);
            } else if (options.verticalAlign === "bottom") {
                geometry.translate(0, -geometry.boundingBox.min.y, 0);
            } else {
                // top
                geometry.translate(0, -geometry.boundingBox.max.y, 0);
            }

            // Center on Z-axis
            geometry.translate(0, 0, -centerOffset.z);
        }

        this.geometry = geometry;

        // Update userData with consistent field names
        this.userData.textConfig = {
            text,
            fontSize: options.fontSize ?? 1,
            lineHeight: options.lineHeight ?? 1.2,
            spacing: options.spacing ?? 0,
            fontName: options.fontName ?? "helvetiker",
            weight: options.weight ?? "regular",
            horizontalAlign: options.horizontalAlign ?? "center",
            verticalAlign: options.verticalAlign ?? "middle",
            case: options.case ?? "normal",
            extrusion: options.extrusion ?? 0.2,
            bevel: options.bevel ?? 0,
            bevelSides: options.bevelSides ?? 1,
        };
    }
}

export default Text3D;
