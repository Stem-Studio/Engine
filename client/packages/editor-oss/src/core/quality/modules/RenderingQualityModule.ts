import * as THREE from 'three';

import global from '../../../global';
// EffectRenderer already lives in editor-oss after the render/ migration.
import EffectRenderer from '../../../render/EffectRenderer';
import type { IQualityModule, IQualitySettings, IPerformanceMetrics } from '../interfaces/IQualityManager';

interface RendererConfig {
    antialiasType?: string;
    antialiasQuality?: 'low' | 'medium' | 'high';
    postProcessingEnabled?: boolean;
    effects?: {
        ssao?: boolean;
        ssaoQuality?: 'low' | 'medium' | 'high';
        bloom?: boolean;
        bloomQuality?: 'low' | 'medium' | 'high';
        volumetricLighting?: boolean;
        reflections?: boolean;
        reflectionQuality?: 'low' | 'medium' | 'high';
        ambientOcclusion?: boolean;
    };
    targetAnisotropy?: number;
    textureQualityScale?: number;
    useInstancing?: boolean;
}

interface QualityCompatibleRenderer {
    setPixelRatio: (value: number) => void;
    getSize: (target: THREE.Vector2) => THREE.Vector2;
    info: {
        memory: { textures: number; geometries: number };
        render: { calls: number; triangles: number };
    };
    shadowMap?: {
        enabled: boolean;
        type: number;
    };
    capabilities?: {
        getMaxAnisotropy: () => number;
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

    // Dynamic resolution scaling
    private basePixelRatio = typeof window !== "undefined" ? window.devicePixelRatio : 1;
    private currentPixelRatio = 1.0;
    private renderTarget: THREE.WebGLRenderTarget | null = null;

    // Lighting configuration
    private maxLights: number = 10;
    
    // Shadow cascade system
    private shadowCascades: THREE.DirectionalLight[] = [];
    private cascadeSplits = [0.1, 0.3, 0.6, 1.0];
    
    // Renderer configuration storage
    private rendererConfig: RendererConfig = {};
    
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
        this.applyAntialiasing(settings.rendering);
        this.applyPostProcessing(settings.rendering);
        this.applyTextureSettings(settings.rendering);

        // Store max lights for culling
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
        if (this.renderTarget) {
            this.renderTarget.dispose();
            this.renderTarget = null;
        }
        
        this.shadowCascades.forEach(light => {
            if (light.shadow.map) {
                light.shadow.map.dispose();
            }
            light.dispose();
        });
        this.shadowCascades = [];
        
        this.renderer = null;
        this.runtimeRenderer = null;
        this.settings = null;
        this.rendererConfig = {};
    }

    private applyPixelRatio(pixelRatio: number): void {
        if (!this.runtimeRenderer) return;

        this.currentPixelRatio = pixelRatio;
        // CHECK: do we want to clamp this value to a reasonable range (e.g. 1 to 3) to prevent extreme scaling?
        // It prevents setupDynamicResolution
        const effectivePixelRatio = THREE.MathUtils.clamp(this.basePixelRatio * pixelRatio, 0.25, 3);
        
        // Update renderer pixel ratio
        this.runtimeRenderer.setPixelRatio(effectivePixelRatio);
        
        // Handle dynamic resolution scaling
        if (pixelRatio < 1.0) {
            this.setupDynamicResolution(pixelRatio);
        } else if (this.renderTarget) {
            // Disable dynamic resolution
            this.renderTarget.dispose();
            this.renderTarget = null;
        }
    }

    private setupDynamicResolution(scale: number): void {
        if (!this.runtimeRenderer) return;

        const size = this.runtimeRenderer.getSize(new THREE.Vector2());
        const scaledWidth = Math.floor(size.width * scale);
        const scaledHeight = Math.floor(size.height * scale);
        
        if (!this.renderTarget) {
            this.renderTarget = new THREE.WebGLRenderTarget(scaledWidth, scaledHeight, {
                minFilter: THREE.LinearFilter,
                magFilter: THREE.LinearFilter,
                format: THREE.RGBAFormat,
                stencilBuffer: false,
                depthBuffer: true,
            });
        } else {
            this.renderTarget.setSize(scaledWidth, scaledHeight);
        }
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
        
        // Note: Shadow cascades should be implemented in the scene/lighting system
        // This module only stores the configuration
        this.cascadeSplits = this.calculateCascadeSplits(settings.shadowCascades);
    }

    private calculateCascadeSplits(cascades: number): number[] {
        const splits: number[] = [];
        for (let i = 0; i < cascades; i++) {
            const lambda = 0.5; // Practical split scheme parameter
            const ratio = i / cascades;
            const log = Math.pow(0.1 / 1000, ratio);
            const uniform = 0.1 + (1000 - 0.1) * ratio;
            splits.push((1 - lambda) * uniform + lambda * log);
        }
        return splits;
    }

    private applyAntialiasing(settings: IQualitySettings['rendering']): void {
        if (!this.renderer) return;
        
        // Store antialiasing configuration
        this.rendererConfig.antialiasType = settings.antialiasing;
        this.rendererConfig.antialiasQuality = settings.antialiasingQuality;
    }

    private applyPostProcessing(settings: IQualitySettings['rendering']): void {
        if (!this.renderer) return;
        
        // Store post-processing configuration
        this.rendererConfig.postProcessingEnabled = settings.postProcessing;
        this.rendererConfig.effects = {
            ssao: settings.ssao,
            ssaoQuality: settings.ssaoQuality,
            bloom: settings.bloom,
            bloomQuality: settings.bloomQuality,
            volumetricLighting: settings.volumetricLighting,
            reflections: settings.reflections,
            reflectionQuality: settings.reflectionQuality,
            ambientOcclusion: settings.ambientOcclusion,
        };
    }

    private applyTextureSettings(settings: IQualitySettings['rendering']): void {
        if (!this.runtimeRenderer) return;

        // Calculate anisotropic filtering level.
        // WebGPURenderer may not expose WebGL-style capabilities.getMaxAnisotropy(),
        // especially when not on WebGL fallback backend.
        const maxAnisotropy = this.runtimeRenderer.capabilities?.getMaxAnisotropy?.() ?? settings.textureAnisotropy;
        const targetAnisotropy = Math.min(settings.textureAnisotropy, maxAnisotropy);
        
        // Store texture configuration
        this.rendererConfig.targetAnisotropy = targetAnisotropy;
        
        // Configure texture quality scale
        const textureScale = {
            'low': 0.25,
            'medium': 0.5,
            'high': 0.75,
            'ultra': 1.0,
        };
        
        this.rendererConfig.textureQualityScale = textureScale[settings.textureQuality];
    }

    // Dynamic resolution scaling methods
    public setDynamicResolutionScale(scale: number): void {
        if (this.settings) {
            this.settings.rendering.pixelRatio = scale;
            this.applyPixelRatio(scale);
        }
    }

    public getDynamicResolutionScale(): number {
        return this.currentPixelRatio;
    }

    // Configuration query methods for renderer integration
    public getRendererConfig(): Readonly<RendererConfig> {
        return this.rendererConfig;
    }

    public getMaxLights(): number {
        return this.maxLights;
    }

    public getShadowCascadeSplits(): number[] {
        return [...this.cascadeSplits];
    }

    // Integration helpers
    public shouldRenderEffect(effectName: string): boolean {
        if (!this.settings || !this.rendererConfig.postProcessingEnabled) return false;
        
        const effects = this.rendererConfig.effects;
        if (!effects) return false;
        
        switch (effectName) {
            case 'ssao': return effects.ssao || false;
            case 'bloom': return effects.bloom || false;
            case 'volumetric': return effects.volumetricLighting || false;
            case 'reflections': return effects.reflections || false;
            case 'ao': return effects.ambientOcclusion || false;
            default: return false;
        }
    }

    public getEffectQuality(effectName: string): 'low' | 'medium' | 'high' {
        const effects = this.rendererConfig.effects;
        if (!effects) return 'medium';
        
        switch (effectName) {
            case 'ssao': return effects.ssaoQuality || 'medium';
            case 'bloom': return effects.bloomQuality || 'medium';
            case 'reflection': return effects.reflectionQuality || 'medium';
            default: return 'medium';
        }
    }

    public getRenderTarget(): THREE.WebGLRenderTarget | null {
        return this.renderTarget;
    }

    private extractRuntimeRenderer(effectRenderer: EffectRenderer): QualityCompatibleRenderer | null {
        const rawRenderer = (effectRenderer as { renderer?: unknown }).renderer;
        if (!rawRenderer || typeof rawRenderer !== 'object') {
            return null;
        }

        if (!('setPixelRatio' in rawRenderer) || !('getSize' in rawRenderer) || !('info' in rawRenderer)) {
            return null;
        }

        return rawRenderer as QualityCompatibleRenderer;
    }
}
