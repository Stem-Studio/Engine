import * as THREE from 'three';

import global from '../../../global';
// EffectRenderer already lives in editor-oss after the render/ migration.
import type EffectRenderer from '../../../render/EffectRenderer';
import type { IQualityModule, IQualitySettings, IPerformanceMetrics } from '../interfaces/IQualityManager';

interface QualityCompatibleRenderer {
    setPixelRatio: (value: number) => void;
    info: {
        memory: { textures: number; geometries: number };
        render: { calls: number; triangles: number };
    };
    shadowMap?: {
        enabled: boolean;
        type: number;
    };
}

/**
 * Manages rendering quality settings and integrates with EffectRenderer
 */
export class RenderingQualityModule implements IQualityModule {
    public readonly name = 'RenderingQuality';
    
    private renderer: EffectRenderer | null = null;
    private settings: IQualitySettings | null = null;
    private pendingSettings: IQualitySettings | null = null;
    private runtimeRenderer: QualityCompatibleRenderer | null = null;

    // Pixel-ratio scaling. The renderer owns the drawing buffer; this module
    // only applies the effective ratio and does not retain a second target.
    private basePixelRatio = typeof window !== "undefined" ? window.devicePixelRatio : 1;
    private currentPixelRatio = 1.0;

    // Lighting configuration
    private maxLights: number = 10;
    
    public setRenderer(renderer: EffectRenderer): void {
        if (!renderer) {
            throw new Error('RenderingQualityModule: Renderer cannot be null');
        }
        this.renderer = renderer;
        this.runtimeRenderer = this.extractRuntimeRenderer(renderer);

        // Renderer can become available after quality settings were already applied.
        // Replay the most recent settings so quality actually takes effect.
        const settingsToApply = this.pendingSettings || this.settings;
        if (settingsToApply) {
            void this.applySettings(settingsToApply);
            this.pendingSettings = null;
        }
    }

    public async initialize(settings: IQualitySettings): Promise<void> {
        this.settings = settings;
        // Don't apply settings during initialization if renderer is not ready
        if (this.renderer && this.runtimeRenderer) {
            await this.applySettings(settings);
        }
    }

    // eslint-disable-next-line @typescript-eslint/require-await
    public async applySettings(settings: IQualitySettings): Promise<void> {
        if (!settings) {
            throw new Error('RenderingQualityModule: Settings cannot be null');
        }

        this.settings = settings;

        if (!this.renderer || !this.runtimeRenderer) {
            this.pendingSettings = settings;
            return;
        }

        // Apply rendering settings
        this.applyPixelRatio(settings.rendering.pixelRatio);
        this.applyShadowSettings(settings.rendering);
        // Store max lights for the live lighting integration.
        this.maxLights = settings.rendering.maxLights;
    }

    public getMetrics(): Partial<IPerformanceMetrics> {
        if (!this.runtimeRenderer) return {};

        const info = this.runtimeRenderer.info;
        
        // Calculate actual memory usage
        const textureCount = info.memory.textures;
        const geometryCount = info.memory.geometries;
        
        // Estimate memory in MB (rough approximation)
        const textureMemory = textureCount * 4; // Assume average 4MB per texture
        const geometryMemory = geometryCount * 0.1; // Assume average 100KB per geometry
        
        return {
            drawCalls: info.render.calls,
            triangles: info.render.triangles,
            textureMemory,
            geometryMemory,
        };
    }

    public dispose(): void {
        this.renderer = null;
        this.runtimeRenderer = null;
        this.settings = null;
    }

    private applyPixelRatio(pixelRatio: number): void {
        if (!this.runtimeRenderer) return;

        this.currentPixelRatio = pixelRatio;
        // Keep authored/device ratios within a safe drawing-buffer range.
        const effectivePixelRatio = THREE.MathUtils.clamp(this.basePixelRatio * pixelRatio, 0.25, 3);
        
        // Update renderer pixel ratio
        this.runtimeRenderer.setPixelRatio(effectivePixelRatio);
    }

    private applyShadowSettings(settings: IQualitySettings['rendering']): void {
        if (!this.runtimeRenderer?.shadowMap) return;

        // Respect the scene's explicit shadow choice. Adaptive quality may
        // DOWNGRADE (turn shadows off on weak devices) but must never ENABLE
        // shadows on a scene that disabled them — otherwise a no-shadow game
        // (e.g. tinyskies, useShadows=false) pays shadow-variant shader
        // compiles + a full shadow pass over the whole scene every frame.
        const sceneAllowsShadows = global.app?.editor?.useShadows !== false;

        // Enable/disable shadows
        this.runtimeRenderer.shadowMap.enabled = sceneAllowsShadows && settings.shadowQuality !== 'none';

        if (!this.runtimeRenderer.shadowMap.enabled) return;
        
        // Set shadow map type based on quality
        switch (settings.shadowQuality) {
            case 'low':
                this.runtimeRenderer.shadowMap.type = THREE.BasicShadowMap;
                break;
            case 'medium':
                this.runtimeRenderer.shadowMap.type = THREE.PCFShadowMap;
                break;
            case 'high':
            case 'ultra':
                this.runtimeRenderer.shadowMap.type = THREE.PCFSoftShadowMap;
                break;
        }
        
    }

    // Pixel-ratio control retained under the historical method names for
    // callers that already use the quality module API.
    public setDynamicResolutionScale(scale: number): void {
        if (this.settings) {
            this.settings.rendering.pixelRatio = scale;
            this.applyPixelRatio(scale);
        }
    }

    public getDynamicResolutionScale(): number {
        return this.currentPixelRatio;
    }

    public getMaxLights(): number {
        return this.maxLights;
    }

    private extractRuntimeRenderer(effectRenderer: EffectRenderer): QualityCompatibleRenderer | null {
        const rawRenderer = (effectRenderer as { renderer?: unknown }).renderer;
        if (!rawRenderer || typeof rawRenderer !== 'object') {
            return null;
        }

        if (!('setPixelRatio' in rawRenderer) || !('info' in rawRenderer)) {
            return null;
        }

        return rawRenderer as QualityCompatibleRenderer;
    }
}
