import * as THREE from "three";
import { CSMMode } from "three/addons/csm/CSM.js";

import { CSMManager } from "./CSMManager";
import { BehaviorBase, BehaviorOptions } from "../../Behavior";
import GameManager from "../../game/GameManager";

export interface CSMParams {
  cascades?: number;
  mode?: CSMMode;
  lightMargin?: number;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  customSplitsCallback?: Function;
  fade?: boolean;
}

export interface CSMEditorShadowBudget {
  enabled?: boolean;
  maxCascades?: number;
}

/** Resolve the cascade count without changing the authored/runtime setting. */
export function getEffectiveCsmCascades(
  requested: unknown,
  editorPreviewActive: boolean,
  budget?: CSMEditorShadowBudget,
): number {
  const authored = Number(requested);
  const normalizedAuthored = Number.isFinite(authored) && authored >= 1
    ? Math.floor(authored)
    : 3;
  if (!editorPreviewActive || budget?.enabled === false) return normalizedAuthored;

  const configuredCap = Number(budget?.maxCascades ?? 2);
  const cap = Number.isFinite(configuredCap) && configuredCap >= 1
    ? Math.floor(configuredCap)
    : 2;
  return Math.min(normalizedAuthored, cap);
}

/**
 * CSMBehavior: Attach to a DirectionalLight to manage CSM state and parameters.
 * Extends BehaviorBase to integrate with the behavior system.
 */
export default class CSMBehavior extends BehaviorBase {
  private csmManager: CSMManager;
  private editorPreviewActive = false;

  constructor(target: THREE.Object3D, id: string, options: BehaviorOptions) {
    super(target, id, options);
    this.csmManager = CSMManager.instance;
  }

  init(game: GameManager): void {
    super.init(game);
  }

  private getEditorShadowBudget(): CSMEditorShadowBudget | undefined {
    let root: THREE.Object3D = this.target;
    while (root.parent) root = root.parent;
    return root.userData?.rendering?.editorShadowBudget;
  }

  private buildCSMParams(): CSMParams {
    return {
      cascades: getEffectiveCsmCascades(
        this.attributes.cascades,
        this.editorPreviewActive,
        this.getEditorShadowBudget(),
      ),
      mode: this.attributes.mode || 'practical',
      lightMargin: this.attributes.lightMargin || 200,
      fade: this.attributes.fade ?? false,
    };
  }

  onStart(): void {
    if (this.target && this.target instanceof THREE.DirectionalLight) {
      // Set initial CSM parameters from attributes
      const csmParams = this.buildCSMParams();

      // Store CSM parameters in the light's userData
      this.target.userData.csmEnabled = true;

      // Enable CSM for this light
      this.csmManager.enableCSM(this.target, csmParams);
    }
  }

  onStop(): void {
    if (this.target && this.target instanceof THREE.DirectionalLight) {
      // Disable CSM for this light
      this.target.userData.csmEnabled = false;
      this.csmManager.disableCSM();
    }
  }

  onAttributesUpdated(): void {
    if (this.target && this.target instanceof THREE.DirectionalLight && this.target.userData.csmEnabled) {
      // Update CSM parameters from attributes
      const csmParams = this.buildCSMParams();

      // Update CSM parameters in the light's userData
      this.csmManager.enableCSM(this.target, csmParams);
    }
  }

  update(_deltaTime: number): void {
    // CSM update is handled by CSMManager in the render loop
    // This method is called every frame but CSM doesn't need per-frame updates

    CSMManager.instance.update();
  }

  dispose(): void {
    this.onStop();
  }

  // Editor methods
  onEditorAdded(): void {
      this.editorPreviewActive = true;
      this.onStart();
  }

  onEditorRemoved(): void {
      this.editorPreviewActive = false;
      this.onStop();
  }

  onEditorDispose(): void {
      this.editorPreviewActive = false;
      this.onStop();
  }

  onEditorUpdate(): void {
      this.update(0);
  }

  onEditorAttributesUpdated(): void {
      this.onAttributesUpdated();
  }

  // Legacy methods for backward compatibility (if needed)
  enable(params?: CSMParams) {
    if (this.target && this.target instanceof THREE.DirectionalLight) {
      this.target.userData.csmEnabled = true;
      if (params) {
        // No longer storing csmParams in userData
      }

      this.csmManager.enableCSM(this.target, params);
    }
  }

  disable() {
    if (this.target && this.target instanceof THREE.DirectionalLight) {
      this.target.userData.csmEnabled = false;
      this.csmManager.disableCSM();
    }
  }

  setParams(params: CSMParams) {
    if (this.target && this.target instanceof THREE.DirectionalLight) {
      // No longer storing csmParams in userData
      if (this.target.userData.csmEnabled) {
        this.csmManager.enableCSM(this.target, params);
      }
    }
  }

  isEnabled(): boolean {
    return !!(this.target && this.target.userData.csmEnabled);
  }

  getParams(): CSMParams {
    // No longer storing csmParams in userData
    return {};
  }
} 
