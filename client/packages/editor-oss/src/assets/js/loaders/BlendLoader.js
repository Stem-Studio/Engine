
import { Group } from 'three';

import BaseLoader from './BaseLoader';

/**
 * BlendLoader - Placeholder for Blender file format
 *
 * Blender's .blend format is Blender's native binary project format and contains:
 * - Complete scene data including modifiers, animations, materials
 * - Blender-specific features like node trees, constraints, drivers
 * - Python scripts and custom properties
 *
 * This format cannot be directly parsed in web browsers. Users should:
 * 1. Export from Blender to GLTF/GLB (recommended for web)
 * 2. Export to FBX for complex animations
 * 3. Export to OBJ for simple static meshes
 */
class BlendLoader extends BaseLoader {
    constructor() {
        super();
    }

    load(url, options) {
        return new Promise(resolve => {
            console.error(
                `BlendLoader: Cannot load .blend files directly.\n` +
                `Blender files must be exported to a web-compatible format:\n` +
                `- GLTF/GLB: Best for web, supports PBR materials and animations\n` +
                `- FBX: Good for complex animations and rigged characters\n` +
                `- OBJ: Simple static meshes\n` +
                `- COLLADA (.dae): Alternative with good material support\n\n` +
                `Please export your .blend file from Blender using File > Export`,
            );

            // Return empty group with error info
            const group = new Group();
            group.userData.type = 'BLEND';
            group.userData.url = url;
            group.userData.options = options;
            group.userData.error = 'Blender files cannot be loaded directly. Please export to GLTF, FBX, or OBJ format.';

            // Still resolve (not reject) so the app doesn't crash
            // but the group will be empty
            resolve(group);
        });
    }
}

export default BlendLoader;
