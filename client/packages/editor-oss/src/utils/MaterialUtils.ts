import {
    Color,
    Mesh,
    Vector2,
    Material,
    Texture,
    MeshStandardMaterial,
    MeshPhongMaterial,
    MeshBasicMaterial,
    MeshLambertMaterial,
    MeshToonMaterial,
    MeshNormalMaterial,
    MeshDepthMaterial,
    MeshDistanceMaterial,
    MeshMatcapMaterial,
    MeshPhysicalMaterial,
    Object3D,
} from "three";
import {
    uv,
    texture,
    float,
    color as colorNode,
    normalMap as normalMapTSL,
    clamp,
    uniform,
    instanceIndex,
    drawIndex,
    textureLoad,
    ivec2,
    int,
    vec2,
    vec3,
    vec4,
    varying,
    mix,
    normalLocal,
    positionGeometry,
} from "three/tsl";
import {MeshPhysicalNodeMaterial, MeshStandardNodeMaterial} from "three/webgpu";

/**
 * Type guard to check if an object is a Mesh
 * @param obj - The object to check
 * @returns True if the object is a Mesh
 */
function isMesh(obj: Object3D): obj is Mesh {
    return (obj as Mesh).isMesh;
}

/**
 * Type guard to check if a material is a MeshStandardMaterial
 * @param material - The material to check
 * @returns True if the material is a MeshStandardMaterial
 */
function isMeshStandardMaterial(material: Material): material is MeshStandardMaterial {
    return (material as MeshStandardMaterial).isMeshStandardMaterial;
}

const CUSTOM_TSL_NODE_KEYS = [
    "colorNode",
    "opacityNode",
    "normalNode",
    "emissiveNode",
    "positionNode",
    "metalnessNode",
    "roughnessNode",
    "clearcoatNormalNode",
    "backdropNode",
    "backdropAlphaNode",
    "fragmentNode",
    "vertexNode",
    "outputNode",
    "receivedShadowNode",
] as const;

type MaterialWithTSLNodes = Material & {
    isNodeMaterial?: boolean;
    userData?: Record<string, unknown>;
} & Partial<Record<(typeof CUSTOM_TSL_NODE_KEYS)[number], unknown>>;

/**
 *
 * @param material
 */
export function hasCustomTSLNodes(material: Material): boolean {
    const materialWithTSLNodes = material as MaterialWithTSLNodes;

    if (materialWithTSLNodes.userData?.batchManagerGeneratedTSL === true) {
        return false;
    }

    if (materialWithTSLNodes.isNodeMaterial !== true) {
        return false;
    }

    return CUSTOM_TSL_NODE_KEYS.some(key => materialWithTSLNodes[key] != null);
}

/**
 * Type guard to check if a material is a MeshPhongMaterial
 * @param material - The material to check
 * @returns True if the material is a MeshPhongMaterial
 */
function isMeshPhongMaterial(material: Material): material is MeshPhongMaterial {
    return (material as MeshPhongMaterial).isMeshPhongMaterial;
}

/**
 * Type guard to check if a material is a MeshBasicMaterial
 * @param material - The material to check
 * @returns True if the material is a MeshBasicMaterial
 */
function isMeshBasicMaterial(material: Material): material is MeshBasicMaterial {
    return (material as MeshBasicMaterial).isMeshBasicMaterial;
}

/**
 * Type guard to check if a material is a MeshLambertMaterial
 * @param material - The material to check
 * @returns True if the material is a MeshLambertMaterial
 */
function isMeshLambertMaterial(material: Material): material is MeshLambertMaterial {
    return (material as MeshLambertMaterial).isMeshLambertMaterial;
}

/**
 * Type guard to check if a material is a MeshToonMaterial
 * @param material - The material to check
 * @returns True if the material is a MeshToonMaterial
 */
function isMeshToonMaterial(material: Material): material is MeshToonMaterial {
    return (material as MeshToonMaterial).isMeshToonMaterial;
}

/**
 * Type guard to check if a material is a MeshNormalMaterial
 * @param material - The material to check
 * @returns True if the material is a MeshNormalMaterial
 */
function isMeshNormalMaterial(material: Material): material is MeshNormalMaterial {
    return (material as MeshNormalMaterial).isMeshNormalMaterial;
}

/**
 * Type guard to check if a material is a MeshDepthMaterial
 * @param material - The material to check
 * @returns True if the material is a MeshDepthMaterial
 */
function isMeshDepthMaterial(material: Material): material is MeshDepthMaterial {
    return (material as MeshDepthMaterial).isMeshDepthMaterial;
}

/**
 * Type guard to check if a material is a MeshDistanceMaterial
 * @param material - The material to check
 * @returns True if the material is a MeshDistanceMaterial
 */
function isMeshDistanceMaterial(material: Material): material is MeshDistanceMaterial {
    return (material as MeshDistanceMaterial).isMeshDistanceMaterial;
}

/**
 * Type guard to check if a material is a MeshMatcapMaterial
 * @param material - The material to check
 * @returns True if the material is a MeshMatcapMaterial
 */
function isMeshMatcapMaterial(material: Material): material is MeshMatcapMaterial {
    return (material as MeshMatcapMaterial).isMeshMatcapMaterial;
}

/**
 * Type guard to check if a material is a MeshPhysicalMaterial
 * @param material - The material to check
 * @returns True if the material is a MeshPhysicalMaterial
 */
function isMeshPhysicalMaterial(material: Material): material is MeshPhysicalMaterial {
    return (material as MeshPhysicalMaterial).isMeshPhysicalMaterial;
}

/**
 * Type guard to check if a value is a Texture
 * @param value - The value to check
 * @returns True if the value is a Texture
 */
function isTexture(value: unknown): value is Texture {
    return !!value && (value as Texture).isTexture === true;
}

/**
 * Convert a MeshStandardMaterial -> MeshStandardNodeMaterial (TSL)
 * Notes:
 * - Tries to mirror look/behavior of the source material.
 * - Safe to use with WebGPURenderer.
 * - You can keep tweaking the returned node material (it’s a graph).
 * @param src
 */
export function convertMeshStandardToNodeMaterial(src: MeshStandardMaterial): MeshStandardNodeMaterial {
    const isPhysical = isMeshPhysicalMaterial(src);
    const dst: MeshStandardNodeMaterial = isPhysical ? new MeshPhysicalNodeMaterial() : new MeshStandardNodeMaterial();
    const dstPhys = isPhysical ? (dst as MeshPhysicalNodeMaterial) : null;

    if (!dst.userData) dst.userData = {} as any;
    dst.userData.batchManagerGeneratedTSL = true;
    dst.userData.tslNodes = {} as Record<string, any>;

    const _store = (name: string, node: any) => {
        if (node !== null && node !== undefined) dst.userData.tslNodes[name] = node;
    };

    const uvNode = uv().setName("uv");

    const baseColorNode = colorNode(src.color ?? new Color(0xffffff)).setName("baseColor");
    const baseColorMapNode = src.map ? texture(src.map, uvNode).setName("baseColorMap") : null;
    const alphaMapNode = src.alphaMap ? texture(src.alphaMap, uvNode).setName("alphaMap") : null;

    _store("baseColor", baseColorNode);
    // store underlying Texture objects (not TSL texture nodes) so
    // patchNodeMaterialSetup can call texture(map, uvNode) later
    _store("baseColorMap", src.map ?? null);
    _store("alphaMap", src.alphaMap ?? null);

    dst.colorNode = baseColorMapNode ? baseColorNode.mul(baseColorMapNode.rgb as any).setName("colorNode") : baseColorNode;

    const opacityFactor = float(src.opacity ?? 1.0).setName("opacityFactor");
    dst.opacityNode = alphaMapNode
        ? clamp(alphaMapNode.g.mul(opacityFactor), float(0.0), float(1.0)).setName("opacityNode")
        : baseColorMapNode
          ? clamp(baseColorMapNode.a.mul(opacityFactor), float(0.0), float(1.0)).setName("opacityNode")
          : opacityFactor;

    dst.transparent = src.transparent ?? false;
    dst.alphaTest = src.alphaTest ?? 0;

    const metalnessFactor = float(src.metalness ?? 0.0).setName("metalnessFactor");
    const roughnessFactor = float(src.roughness ?? 1.0).setName("roughnessFactor");

    const metalnessTexNode = src.metalnessMap ? texture(src.metalnessMap, uvNode).setName("metalnessMap") : null;
    const roughnessTexNode = src.roughnessMap ? texture(src.roughnessMap, uvNode).setName("roughnessMap") : null;

    _store("metalnessMap", src.metalnessMap ?? null);
    _store("roughnessMap", src.roughnessMap ?? null);

    dst.metalnessNode = metalnessTexNode
        ? metalnessTexNode.b.mul(metalnessFactor).setName("metalnessNode")
        : metalnessFactor;

    dst.roughnessNode = roughnessTexNode
        ? roughnessTexNode.g.mul(roughnessFactor).setName("roughnessNode")
        : roughnessFactor;

    if (src.normalMap) {
        const nScale = src.normalScale ?? new Vector2(1, 1);
        const normalMapTexNode = texture(src.normalMap, uvNode).setName("normalMapTex");
        dst.normalNode = (normalMapTSL(normalMapTexNode, vec2(nScale.x, nScale.y)) as any).setName("normalNode");
        _store("normalMapTex", src.normalMap ?? null);
    }

    const emissiveColorNode = colorNode(src.emissive ?? new Color(0x000000))
        .mul(float(src.emissiveIntensity ?? 1.0))
        .setName("emissiveColor");

    const emissiveTexNode = src.emissiveMap ? texture(src.emissiveMap, uvNode).setName("emissiveMap") : null;

    if (emissiveTexNode) {
        dst.emissiveNode = emissiveColorNode.mul(emissiveTexNode.rgb).setName("emissiveNode");
        _store("emissiveMap", src.emissiveMap ?? null);
    } else if (src.emissive && src.emissive.getHex() !== 0 || (src.emissiveIntensity ?? 0) > 0) {
        dst.emissiveNode = emissiveColorNode;
    }

    if (src.aoMap) {
        const aoTexNode = texture(src.aoMap, uvNode).setName("aoMap");
        const aoIntensityNode = float(src.aoMapIntensity ?? 1.0).setName("aoIntensity");
        const aoFactorNode = aoTexNode.r.mul(aoIntensityNode).setName("aoFactor");
        // Avoid assigning aoNode/aoMap on generated node materials. Three r185's
        // built-in AO lighting path currently emits a TSL stack warning there.
        dst.colorNode = (dst.colorNode as any).mul(aoFactorNode).setName("colorNode");
        _store("aoMap", src.aoMap ?? null);
        _store("aoMapIntensity", src.aoMapIntensity ?? 1.0);
    }

    if (src.displacementMap) {
        const dispTexNode = texture(src.displacementMap, uvNode).setName("displacementMap");
        const dispScaleNode = float(src.displacementScale ?? 1.0).setName("displacementScale");
        const dispBiasNode = float(src.displacementBias ?? 0.0).setName("displacementBias");
        const displacement = dispTexNode.r.mul(dispScaleNode).add(dispBiasNode);
        dst.positionNode = positionGeometry.add(normalLocal.mul(displacement)).setName("positionNode");
        _store("displacementMap", src.displacementMap ?? null);
    }

    if ("envMapIntensity" in src && typeof src.envMapIntensity === "number") dst.envMapIntensity = src.envMapIntensity;

    if (dstPhys) {
        const srcPhys = src as MeshPhysicalMaterial;
        if (typeof srcPhys.clearcoat === "number") dstPhys.clearcoat = srcPhys.clearcoat;
        if (srcPhys.clearcoatMap) dstPhys.clearcoatMap = srcPhys.clearcoatMap;
        // store clearcoat map node if present
        // note: clearcoatMap is a plain Texture on the node material, not a TSL node; we only store TSL texture nodes created above
        if (typeof srcPhys.clearcoatRoughness === "number") dstPhys.clearcoatRoughness = srcPhys.clearcoatRoughness;
        if (srcPhys.clearcoatRoughnessMap) dstPhys.clearcoatRoughnessMap = srcPhys.clearcoatRoughnessMap;
        if (srcPhys.clearcoatNormalMap) {
            const ccScale = srcPhys.clearcoatNormalScale ?? new Vector2(1, 1);
            const ccNormalTexNode = texture(srcPhys.clearcoatNormalMap, uvNode).setName("clearcoatNormalMap");
            dstPhys.clearcoatNormalNode = (normalMapTSL(ccNormalTexNode, vec2(ccScale.x, ccScale.y)) as any).setName(
                "clearcoatNormalNode",
            );
            _store("clearcoatNormalMap", srcPhys.clearcoatNormalMap ?? null);
        }

        if (srcPhys.sheen) dstPhys.sheen = srcPhys.sheen;
        if (srcPhys.sheenColor) dstPhys.sheenColor = srcPhys.sheenColor;
        if (srcPhys.sheenRoughness !== undefined) dstPhys.sheenRoughness = srcPhys.sheenRoughness;
        if (srcPhys.sheenColorMap) dstPhys.sheenColorMap = srcPhys.sheenColorMap;
        // sheenColorMap is left as a plain texture property on the node material
        if (srcPhys.sheenRoughnessMap) dstPhys.sheenRoughnessMap = srcPhys.sheenRoughnessMap;

        if (srcPhys.transmission !== undefined) dstPhys.transmission = srcPhys.transmission;
        if (srcPhys.transmissionMap) dstPhys.transmissionMap = srcPhys.transmissionMap;
        if (srcPhys.thickness !== undefined) dstPhys.thickness = srcPhys.thickness;
        if (srcPhys.thicknessMap) dstPhys.thicknessMap = srcPhys.thicknessMap;
        if (srcPhys.ior !== undefined) dstPhys.ior = srcPhys.ior;
        if (srcPhys.attenuationColor) dstPhys.attenuationColor = srcPhys.attenuationColor;
        if (srcPhys.attenuationDistance !== undefined) dstPhys.attenuationDistance = srcPhys.attenuationDistance;
    }

    dst.side = src.side;
    dst.fog = src.fog ?? true;
    dst.flatShading = src.flatShading ?? false;
    dst.toneMapped = src.toneMapped ?? true;
    dst.depthWrite = src.depthWrite ?? true;
    dst.depthTest = src.depthTest ?? true;
    dst.blending = src.blending;
    dst.premultipliedAlpha = src.premultipliedAlpha ?? false;
    dst.dithering = src.dithering ?? false;

    dst.needsUpdate = true;
    return dst;
}

/**
 * Patch a MeshStandardNodeMaterial's setupPosition to read per-instance data from a batched mesh
 * uniforms texture and apply values to the material's node properties.
 * It expects the material to have previously stored TSL texture nodes at material.userData.tslNodes
 * @param material
 * @param batchedMesh
 */
export function patchNodeMaterialSetup(material: any, batchedMesh: any) {
    if (!material) return;
    const setupMaterial = material.setupPosition?.bind(material);
    if (!setupMaterial) return;

    material.setupPosition = (builder: any) => {
        const result = setupMaterial(builder);

        try {
            if (batchedMesh.uniformsTexture) {
                const uTex = batchedMesh.uniformsTexture;
                const map = uTex.uniformMap;

                const uSize = uniform(uTex.image.width, "int");
                const uPPI = uniform(uTex.pixelsPerInstance, "int");

                const hasIndirect = Boolean(batchedMesh._indirectTexture);
                let idx: any;

                let drawId: any = null;
                if (drawId === null) {
                    if (builder.getDrawIndex() === null) {
                        drawId = instanceIndex;
                    } else {
                        drawId = drawIndex;
                    }
                }
                const drawIdInt = int(drawId);

                if (hasIndirect) {
                    const indTex: any = batchedMesh._indirectTexture;
                    const iSize = uniform(indTex.image.width, "int");
                    const ix = drawIdInt.mod(iSize);
                    const iy = drawIdInt.div(iSize);
                    idx = int(textureLoad(indTex, ivec2(ix, iy)).x);
                } else {
                    idx = drawIdInt;
                }

                const j = idx.mul(uPPI);
                const x = j.mod(uSize);
                const y = j.div(uSize);

                const texels: any[] = [];
                for (let i = 0; i < uTex.pixelsPerInstance; i++) {
                    texels.push(textureLoad(uTex, ivec2(x.add(int(i)), y)));
                }

                const pick = (offset: number, size: number): any => {
                    const comps: any[] = [];
                    const channels = uTex.channels;
                    for (let k = 0; k < size; k++) {
                        const absolute = offset + k;
                        const tIdx = Math.floor(absolute / channels);
                        const cIdx = absolute % channels;
                        const t = texels[tIdx] ?? texels[texels.length - 1];
                        comps.push(
                            cIdx === 0
                                ? t.r
                                : cIdx === 1
                                  ? t.g
                                  : cIdx === 2
                                    ? t.b
                                    : t.a,
                        );
                    }
                    if (size === 1) return comps[0];
                    if (size === 2) return vec2(comps[0], comps[1]);
                    if (size === 3) return vec3(comps[0], comps[1], comps[2]);
                    return vec4(comps[0], comps[1], comps[2], comps[3]);
                };

                const getIf = (
                    key: string,
                    size: number | null,
                    toType: "float" | "vec2" | "vec3" | "vec4" | "color" = "float",
                    fallback?: any,
                ): any => {
                    const entry = map.get(key);
                    if (!entry) return null;
                    const node = pick(entry.offset, size ?? entry.size);
                    let value = node;
                    if (toType === "vec4" && entry.size === 3) value = vec4(node.x, node.y, node.z, float(1));
                    if (toType === "vec3" && entry.size === 4) value = vec3(node.x, node.y, node.z);
                    if (toType === "color") {
                        value =
                            entry.size === 4
                                ? vec3(node.x, node.y, node.z)
                                : entry.size === 3
                                  ? node
                                  : vec3(node, node, node);
                    }
                    if (fallback && value === undefined) value = fallback;
                    return value;
                };

                // Only support a limited set of properties from the uniforms texture.
                // Supported mappings:
                // metalness: float -> material.metalnessNode
                // roughness: float -> material.roughnessNode
                // opacity: float -> material.opacityNode
                // diffuse: vec3 -> material.colorNode (combined with saved baseColorMap if present)
                // emissive: vec3 -> material.emissiveNode
                // emissiveIntensity: float -> composed into material.emissiveNode

                // Use the material's existing nodes (created by convertMeshStandardToNodeMaterial)
                // as the base formulas, then apply per-instance uniform modifiers when present.
                // This preserves the original conversion formulas and composes per-instance values on top.

                const tslNodes = material.userData.tslNodes || {};

                // create a uv node for any texture nodes we need to build
                const uvNode = uv().setName("uv");

                const makeTextureNode = (maybeTex: any, name: string) => {
                    if (!maybeTex) return null;
                    // if it's already a TSL node, use it; if it's a three.Texture, create a texture(...) node
                    if (maybeTex.isTexture) {
                        // apply tiling from texture.repeat by scaling the uv node
                        const tilingX = maybeTex.repeat?.x ?? 1;
                        const tilingY = maybeTex.repeat?.y ?? 1;
                        const tiledUv =
                            tilingX === 1 && tilingY === 1
                                ? uvNode
                                : uvNode.mul(vec2(tilingX, tilingY)).setName(`${name}_uv`);
                        return texture(maybeTex, tiledUv).setName(name);
                    }
                    return maybeTex;
                };

                const baseColor = getIf("diffuse", 3, "vec3") ?? tslNodes["baseColor"];

                // When a DataArrayTexture atlas is available, sample it using the
                // per-instance textureLayer uniform as the z coordinate instead of
                // using the original per-material 2D texture.
                const textureLayerU = getIf("textureLayer", 1, "float");
                const arrayMap = material.userData?.textureArrayMap;
                let baseColorMap: any = null;
                if (arrayMap && textureLayerU) {
                    const srcTex = tslNodes["baseColorMap"];
                    const tilingX = srcTex?.repeat?.x ?? 1;
                    const tilingY = srcTex?.repeat?.y ?? 1;
                    const tiledUv =
                        tilingX === 1 && tilingY === 1
                            ? uvNode
                            : uvNode.mul(vec2(tilingX, tilingY)).setName("baseColorMap_uv");
                    const arrayUv = vec3(tiledUv.x, tiledUv.y, float(varying(textureLayerU) as any));
                    baseColorMap = texture(arrayMap, arrayUv).setName("baseColorMap");
                } else {
                    baseColorMap = makeTextureNode(tslNodes["baseColorMap"], "baseColorMap");
                }

                if (baseColor && baseColorMap) {
                    material.colorNode = (varying(baseColor) as any).mul(baseColorMap);
                } else if (baseColorMap) {
                    material.colorNode = baseColorMap;
                } else if (baseColor) {
                    material.colorNode = varying(baseColor);
                }

                const metalnessU = getIf("metalness", 1, "float");
                const savedMetalnessMap = makeTextureNode(tslNodes["metalnessMap"], "metalnessMap");
                if (savedMetalnessMap && metalnessU) {
                    material.metalnessNode = savedMetalnessMap.b.mul(varying(metalnessU));
                } else if (savedMetalnessMap) {
                    material.metalnessNode = savedMetalnessMap.b;
                } else if (metalnessU) {
                    material.metalnessNode = varying(metalnessU);
                }

                const roughnessU = getIf("roughness", 1, "float");
                const savedRoughnessMap = makeTextureNode(tslNodes["roughnessMap"], "roughnessMap");
                if (savedRoughnessMap && roughnessU) {
                    material.roughnessNode = savedRoughnessMap.g.mul(varying(roughnessU));
                } else if (savedRoughnessMap) {
                    material.roughnessNode = savedRoughnessMap.g;
                } else if (roughnessU) {
                    material.roughnessNode = varying(roughnessU);
                }

                const opacityU = getIf("opacity", 1, "float");
                const savedAlphaMap = makeTextureNode(tslNodes["alphaMap"], "alphaMap");
                if (savedAlphaMap && opacityU) {
                    material.opacityNode = clamp(
                        savedAlphaMap.g.mul(varying(opacityU)),
                        float(0.0),
                        float(1.0),
                    );
                } else if (savedAlphaMap) {
                    material.opacityNode = clamp(savedAlphaMap.g, float(0.0), float(1.0));
                } else if (opacityU) {
                    material.opacityNode = varying(clamp(opacityU, float(0.0), float(1.0)));
                }

                const emissiveU = getIf("emissive", 3, "vec3");
                const savedEmissiveMap = makeTextureNode(tslNodes["emissiveMap"], "emissiveMap");
                let composedEmissiveNode: any = null;
                if (savedEmissiveMap && emissiveU) {
                    composedEmissiveNode = savedEmissiveMap.rgb.mul(varying(emissiveU));
                } else if (savedEmissiveMap) {
                    composedEmissiveNode = savedEmissiveMap.rgb;
                } else if (emissiveU) {
                    composedEmissiveNode = varying(emissiveU);
                }

                const emissiveIntensityNode = getIf("emissiveIntensity", 1, "float");
                if (composedEmissiveNode && emissiveIntensityNode) {
                    composedEmissiveNode = composedEmissiveNode.mul(varying(emissiveIntensityNode));
                }
                if (composedEmissiveNode) {
                    material.emissiveNode = composedEmissiveNode;
                }

                // Per-instance receiveShadow: mix shadow with 1.0 (no shadow) based on uniform
                const receiveShadowU = getIf("receiveShadow", 1, "float");
                if (receiveShadowU) {
                    const rcv = varying(receiveShadowU) as any;
                    material.receivedShadowNode = (shadowNode: any) => mix(float(1.0), shadowNode, rcv);
                }
            }
        } catch (e) {
            // swallow errors here to avoid breaking material setup in non-batched contexts
            console.warn("patchNodeMaterialSetup error", e);
        }

        return result;
    };
}

/**
 * Material utility class
 */
const MaterialUtils = {
    isMesh,
    isMeshStandardMaterial,
    hasCustomTSLNodes,
    isMeshPhongMaterial,
    isMeshBasicMaterial,
    isMeshLambertMaterial,
    isMeshToonMaterial,
    isMeshNormalMaterial,
    isMeshDepthMaterial,
    isMeshDistanceMaterial,
    isMeshMatcapMaterial,
    isMeshPhysicalMaterial,
    isTexture,
};

export default MaterialUtils;
