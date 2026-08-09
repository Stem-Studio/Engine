/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */
import {
    positionGeometry,
    positionWorld,
    cameraPosition,
    float,
    vec2,
    vec3,
    color as colorNode,
    Fn,
    fract,
    mix,
    smoothstep,
    clamp,
    abs,
    step,
    length,
    dFdx,
    dFdy,
    max as maxFn,
    cameraFar,
} from "three/tsl";
import {
    Color,
    DoubleSide,
    Mesh,
    PlaneGeometry,
    Scene,
} from "three";
import {MeshBasicNodeMaterial} from "three/webgpu";

import BaseHelper from "./BaseHelper";
import {ApplicationMode} from "../EngineRuntime";
import global from "../global";

class GridHelper extends BaseHelper {
    private infiniteGridPlane: Mesh | null = null;
    private infiniteGridMaterial: MeshBasicNodeMaterial | null = null;
    private snapSize: number | null = null;

    constructor() {
        super();
    }

    start() {
        global.app?.on(`appModeEntered.${this.id}`, this.onAppModeEntered.bind(this));
        global.app?.on(`snappingSettingsChanged.${this.id}`, this.onSnappingSettingsChanged.bind(this));

        this.enableInfiniteGrid();
    }

    stop() {
        global.app?.on(`appModeEntered.${this.id}`, null);
        global.app?.on(`snappingSettingsChanged.${this.id}`, null);
        this.disposeInfiniteGrid();
    }

    private onSnappingSettingsChanged(settings: any) {
        const oldSnap = this.snapSize;
        if (settings?.grid?.enabled && settings.grid.increment > 0) {
            this.snapSize = settings.grid.increment;
        } else {
            this.snapSize = null;
        }
        if (this.snapSize !== oldSnap) {
            this.enableInfiniteGrid();
        }
    }

    enableInfiniteGrid() {
        this.disposeInfiniteGrid();

        const helperRoot = global.app?.editor?.sceneHelpers;
        const scene = global.app?.editor?.scene;
        if (helperRoot && scene) {
            this.infiniteGrid(scene);
            if (this.infiniteGridPlane) {
                helperRoot.add(this.infiniteGridPlane);
            }
        }
    }

    private onAppModeEntered(mode: ApplicationMode) {
        if (!this.infiniteGridPlane) {
            return;
        }

        const showGrid = Boolean(mode === ApplicationMode.EDIT);
        if (showGrid) {
            global.app?.editor?.sceneHelpers.add(this.infiniteGridPlane);
        } else {
            this.infiniteGridPlane.removeFromParent();
        }
    }

    private infiniteGrid(scene: Scene) {
        const geometry = new PlaneGeometry(1, 1, 10, 10);

        const material = new MeshBasicNodeMaterial();
        this.infiniteGridMaterial = material;
        material.transparent = true;
        material.side = DoubleSide;

        // NOTE: cameraFar is used to scale the grid appropriately with camera distance
        const dist = cameraFar.min(1000).div(2).toVar();

        material.positionNode = Fn(() => {
            const x = positionGeometry.x.mul(dist).add(cameraPosition.x);
            const z = positionGeometry.y.mul(dist).add(cameraPosition.z);
            return vec3(x, 0, z);
        })();

        // TSL port of the provided GLSL "pristineGrid" multi-level grid
        // Parameters (defaults can be customized via scene.userData if desired)
        const safeColor = (val: unknown, fallback: Color) => {
            if (typeof val === "string" || Array.isArray(val) || typeof val === "number") {
                try {
                    // Color constructor accepts string | number | array(tuple)
                    return new Color(val as string | number | undefined);
                } catch {
                    return fallback;
                }
            }
            return fallback;
        };
        const colorX = colorNode(safeColor(scene.userData.gridColorX, new Color(0.5, 0.5, 0.5)));
        const colorZ = colorNode(safeColor(scene.userData.gridColorZ, new Color(0.5, 0.5, 0.5)));

        const base90 = vec3(float(0.4));
        const base70 = vec3(float(0.3));

        const resolutionVal = typeof scene.userData.gridResolution === "number" ? scene.userData.gridResolution : 3;
        // When snap is active, cap resolution at 1 to disable Level C (fine grid) safely
        const effectiveResolution = this.snapSize != null ? Math.min(resolutionVal, 1) : resolutionVal;
        const resolution = float(effectiveResolution);
        const epsilon = float(1).div(255);

        const pos = positionWorld.xz.toVar();
        const one = float(1);

        // Level A (coarse): spacing ~10 units (or 8*snap when snap active), axis coloring
        const levelAScale = this.snapSize != null ? float(1 / (this.snapSize * 8)) : float(0.1);
        const levelASize = float(2).div(1000); // 0.002
        const levelAPos = pos.mul(levelAScale).toVar();
        const ddxA = dFdx(levelAPos).toVar();
        const ddyA = dFdy(levelAPos).toVar();
        const uvDerivA = vec2(length(vec2(ddxA.x, ddyA.x)), length(vec2(ddxA.y, ddyA.y))).toVar();
        const lwA = vec2(levelASize).toVar();
        const invertA = step(float(0.5), lwA.x).toVar();
        const targetWidthA = mix(lwA, vec2(one).sub(lwA), invertA).toVar();
        const drawWidthA = clamp(targetWidthA, uvDerivA, vec2(float(0.5))).toVar();
        const lineAAA = uvDerivA.mul(1.5).toVar();
        const gridUVA = abs(fract(levelAPos).mul(2).sub(1)).toVar();
        const gridUVAdjA = mix(vec2(one).sub(gridUVA), gridUVA, invertA).toVar();
        const grid2_baseA = vec2(
            smoothstep(drawWidthA.x.add(lineAAA.x), drawWidthA.x.sub(lineAAA.x), gridUVAdjA.x),
            smoothstep(drawWidthA.y.add(lineAAA.y), drawWidthA.y.sub(lineAAA.y), gridUVAdjA.y),
        ).toVar();
        const grid2_scaledA = grid2_baseA.mul(clamp(targetWidthA.div(drawWidthA), float(0), one)).toVar();
        const tA = clamp(uvDerivA.mul(2).sub(1), float(0), one);
        const grid2_mixA = vec2(mix(grid2_scaledA.x, targetWidthA.x, tA.x), mix(grid2_scaledA.y, targetWidthA.y, tA.y)).toVar();
        const grid2A = mix(grid2_mixA, vec2(one).sub(grid2_mixA), invertA).toVar();
        const levelAAlpha = mix(grid2A.x, one, grid2A.y).toVar();

        const onXAxisA = float(1)
            .sub(step(levelASize, abs(levelAPos.y)))
            .toVar();
        const onZAxisA = float(1)
            .sub(step(levelASize, abs(levelAPos.x)))
            .toVar();
        const intersectionA = onXAxisA.mul(onZAxisA).toVar();
        const xOnlyA = onXAxisA.mul(float(1).sub(onZAxisA)).toVar();
        const zOnlyA = float(1).sub(onXAxisA).mul(onZAxisA).toVar();
        const generalA = float(1).sub(maxFn(onXAxisA, onZAxisA)).toVar();

        const colorA = vec3(float(0))
            .add(vec3(float(1)).mul(intersectionA))
            .add(colorX.mul(xOnlyA))
            .add(colorZ.mul(zOnlyA))
            .add(base90.mul(generalA))
            .toVar();

        const sA = step(epsilon, levelAAlpha).toVar();

        // Level B (medium): spacing ~1 unit (or snapSize when snap active)
        const levelBPos = this.snapSize != null ? pos.mul(float(1 / this.snapSize)).toVar() : pos;
        const levelBSize = float(1).div(100); // 0.01
        const ddxB = dFdx(levelBPos).toVar();
        const ddyB = dFdy(levelBPos).toVar();
        const uvDerivB = vec2(length(vec2(ddxB.x, ddyB.x)), length(vec2(ddxB.y, ddyB.y))).toVar();
        const lwB = vec2(levelBSize).toVar();
        const invertB = step(float(0.5), lwB.x).toVar();
        const targetWidthB = mix(lwB, vec2(one).sub(lwB), invertB).toVar();
        const drawWidthB = clamp(targetWidthB, uvDerivB, vec2(float(0.5))).toVar();
        const lineAAB = uvDerivB.mul(1.5).toVar();
        const gridUVB = abs(fract(levelBPos).mul(2).sub(1)).toVar();
        const gridUVAdjB = mix(vec2(one).sub(gridUVB), gridUVB, invertB).toVar();
        const grid2_baseB = vec2(
            smoothstep(drawWidthB.x.add(lineAAB.x), drawWidthB.x.sub(lineAAB.x), gridUVAdjB.x),
            smoothstep(drawWidthB.y.add(lineAAB.y), drawWidthB.y.sub(lineAAB.y), gridUVAdjB.y),
        ).toVar();
        const grid2_scaledB = grid2_baseB.mul(clamp(targetWidthB.div(drawWidthB), float(0), one)).toVar();
        const tB = clamp(uvDerivB.mul(2).sub(1), float(0), one);
        const grid2_mixB = vec2(mix(grid2_scaledB.x, targetWidthB.x, tB.x), mix(grid2_scaledB.y, targetWidthB.y, tB.y)).toVar();
        const grid2B = mix(grid2_mixB, vec2(one).sub(grid2_mixB), invertB).toVar();
        const levelBAlpha = mix(grid2B.x, one, grid2B.y).toVar();
        const enabledB = step(float(1), resolution).toVar(); // uResolution >= 1
        const sB = float(1).sub(sA).mul(step(epsilon, levelBAlpha)).mul(enabledB).toVar();
        const colorB = base70;

        // Level C (fine): spacing ~0.1 units (disabled via resolution when snap active)
        const levelCScale = float(10);
        const levelCSize = float(1).div(100); // 0.01
        const levelCPos = pos.mul(levelCScale).toVar();
        const ddxC = dFdx(levelCPos).toVar();
        const ddyC = dFdy(levelCPos).toVar();
        const uvDerivC = vec2(length(vec2(ddxC.x, ddyC.x)), length(vec2(ddxC.y, ddyC.y))).toVar();
        const lwC = vec2(levelCSize).toVar();
        const invertC = step(float(0.5), lwC.x).toVar();
        const targetWidthC = mix(lwC, vec2(one).sub(lwC), invertC).toVar();
        const drawWidthC = clamp(targetWidthC, uvDerivC, vec2(float(0.5))).toVar();
        const lineAAC = uvDerivC.mul(1.5).toVar();
        const gridUVC = abs(fract(levelCPos).mul(2).sub(1)).toVar();
        const gridUVAdjC = mix(vec2(one).sub(gridUVC), gridUVC, invertC).toVar();
        const grid2_baseC = vec2(
            smoothstep(drawWidthC.x.add(lineAAC.x), drawWidthC.x.sub(lineAAC.x), gridUVAdjC.x),
            smoothstep(drawWidthC.y.add(lineAAC.y), drawWidthC.y.sub(lineAAC.y), gridUVAdjC.y),
        ).toVar();
        const grid2_scaledC = grid2_baseC.mul(clamp(targetWidthC.div(drawWidthC), float(0), one)).toVar();
        const tC = clamp(uvDerivC.mul(2).sub(1), float(0), one);
        const grid2_mixC = vec2(mix(grid2_scaledC.x, targetWidthC.x, tC.x), mix(grid2_scaledC.y, targetWidthC.y, tC.y)).toVar();
        const grid2C = mix(grid2_mixC, vec2(one).sub(grid2_mixC), invertC).toVar();
        const levelCAlpha = mix(grid2C.x, one, grid2C.y).toVar();
        const enabledC = step(float(2), resolution).toVar(); // uResolution >= 2
        const sC = float(1)
            .sub(sA)
            .mul(float(1).sub(step(epsilon, levelBAlpha)))
            .mul(step(epsilon, levelCAlpha))
            .mul(enabledC)
            .toVar();
        const colorC = base70;

        const outColor = colorA.mul(sA).add(colorB.mul(sB)).add(colorC.mul(sC)).toVar();
        const distToCam = length(pos.sub(cameraPosition.xz));
        const fade = float(1.0).sub(smoothstep(dist.mul(0.75), dist, distToCam));
        const outAlpha = levelAAlpha
            .mul(sA)
            .add(levelBAlpha.mul(sB))
            .add(levelCAlpha.mul(sC))
            .mul(fade)
            .toVar();

        // Premultiply for better blending
        material.colorNode = outColor.mul(outAlpha);
        material.opacityNode = outAlpha;
        material.premultipliedAlpha = true;

        this.infiniteGridPlane = new Mesh(geometry, material);
        this.infiniteGridPlane.name = "InfiniteGridPlane";
        this.infiniteGridPlane.userData.isInfiniteGrid = true;
        this.infiniteGridPlane.userData.isBatchable = false;
        // depth flags directly on the material instance
        material.depthWrite = false;
        material.depthTest = true;
        material.polygonOffset = true;
        material.polygonOffsetFactor = -1;
        material.polygonOffsetUnits = -1;
        this.infiniteGridPlane.frustumCulled = false;
        this.infiniteGridPlane.renderOrder = 0;
    }

    private disposeInfiniteGrid() {
        if (this.infiniteGridPlane) {
            this.infiniteGridPlane.removeFromParent();
            if (this.infiniteGridPlane.geometry) {
                this.infiniteGridPlane.geometry.dispose();
            }
            if ((this.infiniteGridPlane as any).dispose) {
                (this.infiniteGridPlane as any).dispose();
            }
            this.infiniteGridPlane = null;
        }

        if (this.infiniteGridMaterial) {
            this.infiniteGridMaterial.dispose();
            this.infiniteGridMaterial = null;
        }
    }

    dispose() {
        this.disposeInfiniteGrid();
    }
}

export default GridHelper;
