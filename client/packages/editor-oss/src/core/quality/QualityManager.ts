import { EventEmitter } from 'events';

import { DeviceCapabilityDetector } from './DeviceCapabilityDetector';
import type {
    IQualityManager,
    IQualitySettings,
    IQualityPreset,
    IQualityModule,
    IPerformanceMetrics,
    IQualityChangeEvent,
} from './interfaces/IQualityManager';
import { PerformanceMonitor } from './PerformanceMonitor';
import { QualityPersistence } from './QualityPersistence';
import { QualityPresets } from './QualityPresets';

/**
 * Init-time quality config provider.
 * Detects device capabilities, determines settings, and lets systems read them.
 */
export class QualityManager extends EventEmitter implements IQualityManager {
    private static instance: QualityManager | null = null;

    private currentSettings: IQualitySettings;
    private modules: Map<string, IQualityModule> = new Map();
    private performanceMonitor: PerformanceMonitor;
    private deviceDetector: DeviceCapabilityDetector;
    private persistence: QualityPersistence;
    private customPresets: Map<string, IQualityPreset> = new Map();
    private runtimeRenderingOverride: Partial<IQualitySettings['rendering']> | null = null;
    private initialized = false;
    private initializationPromise: Promise<void> | null = null;

    private constructor() {
        super();
        this.currentSettings = QualityPresets.getDefault().settings;
        this.performanceMonitor = new PerformanceMonitor();
        this.deviceDetector = new DeviceCapabilityDetector();
        this.persistence = new QualityPersistence();
    }

    public static getInstance(): QualityManager {
        if (!QualityManager.instance) {
            QualityManager.instance = new QualityManager();
        }
        return QualityManager.instance;
    }

    public async initialize(): Promise<void> {
        if (this.initialized) {
            console.warn('QualityManager already initialized');
            return;
        }
        if (this.initializationPromise) {
            await this.initializationPromise;
            return;
        }

        this.initializationPromise = (async () => {
            // Load custom presets only. Runtime quality should be selected from
            // device profile + scene launch config, not persisted user state.
            const customPresets = await this.persistence.loadCustomPresets();
            customPresets.forEach(preset => {
                this.customPresets.set(preset.id, preset);
            });

            // Detect device capabilities and apply as launch baseline
            const recommendedSettings = await this.detectDeviceCapabilities();
            this.currentSettings = recommendedSettings;
            await this.applySettingsToModules(recommendedSettings);

            this.initialized = true;
            console.log('QualityManager initialized successfully');
        })();

        try {
            await this.initializationPromise;
        } catch (error) {
            console.error('Failed to initialize QualityManager:', error);
            throw error;
        } finally {
            this.initializationPromise = null;
        }
    }

    public dispose(): void {
        // Dispose all modules
        this.modules.forEach(module => module.dispose());
        this.modules.clear();

        // Clean up
        this.performanceMonitor.dispose();
        this.removeAllListeners();

        this.initialized = false;
        QualityManager.instance = null;
    }

    public getCurrentSettings(): IQualitySettings {
        return this.getEffectiveSettings();
    }

    public getConfiguredSettings(): IQualitySettings {
        return {
            ...this.currentSettings,
            rendering: { ...this.currentSettings.rendering },
            physics: { ...this.currentSettings.physics },
            behavior: { ...this.currentSettings.behavior },
            scene: { ...this.currentSettings.scene },
            runtimeBudget: this.currentSettings.runtimeBudget ? { ...this.currentSettings.runtimeBudget } : undefined,
            network: { ...this.currentSettings.network },
            scheduler: { ...this.currentSettings.scheduler },
        };
    }

    public async setSettings(settings: Partial<IQualitySettings>, options?: { persist?: boolean }): Promise<void> {
        const previousSettings = this.getEffectiveSettings();

        // Deep merge settings
        this.currentSettings = this.mergeSettings(this.currentSettings, settings);

        // Apply to all modules
        await this.applySettingsToModules(this.getEffectiveSettings());

        // Emit change event
        const event: IQualityChangeEvent = {
            previousSettings,
            newSettings: this.getEffectiveSettings(),
            reason: 'manual',
            timestamp: Date.now(),
        };
        this.emit('qualityChanged', event);

        // Save settings (skipped during launch-time quality selection)
        if (options?.persist !== false) {
            await this.saveSettings();
        }
    }

    public async applyPreset(presetId: string, options?: { persist?: boolean }): Promise<void> {
        const preset = this.getPresetById(presetId);
        if (!preset) {
            throw new Error(`Preset ${presetId} not found`);
        }

        await this.setSettings(preset.settings, options);
    }

    /** Apply a preset for an explicit performance-policy change. */
    public async applyPresetForPerformance(presetId: string): Promise<void> {
        const preset = this.getPresetById(presetId);
        if (!preset) {
            throw new Error(`Preset ${presetId} not found`);
        }

        const previousSettings = this.getEffectiveSettings();
        this.currentSettings = this.mergeSettings(this.currentSettings, preset.settings);
        await this.applySettingsToModules(this.getEffectiveSettings());

        const event: IQualityChangeEvent = {
            previousSettings,
            newSettings: this.getEffectiveSettings(),
            reason: 'performance',
            timestamp: Date.now(),
        };
        this.emit('qualityChanged', event);
    }

    public setRuntimeRenderingOverride(
        override: Partial<IQualitySettings['rendering']> | null,
    ): void {
        const normalizedOverride = override ? { ...override } : null;
        if (this.areRenderingOverridesEqual(this.runtimeRenderingOverride, normalizedOverride)) {
            return;
        }

        const previousSettings = this.getEffectiveSettings();
        this.runtimeRenderingOverride = normalizedOverride;
        const effectiveSettings = this.getEffectiveSettings();

        this.modules.forEach(module => {
            void module.applySettings(effectiveSettings).catch(error => {
                console.error(`Failed to apply runtime override to module ${module.name}:`, error);
            });
        });

        const event: IQualityChangeEvent = {
            previousSettings,
            newSettings: effectiveSettings,
            reason: 'performance',
            timestamp: Date.now(),
        };
        this.emit('qualityChanged', event);
    }

    public getPresets(): IQualityPreset[] {
        const builtInPresets = QualityPresets.getAllPresets();
        const customPresets = Array.from(this.customPresets.values());
        return [...builtInPresets, ...customPresets];
    }

    public createCustomPreset(name: string, settings: IQualitySettings): IQualityPreset {
        const preset: IQualityPreset = {
            id: `custom_${Date.now()}`,
            name: name.toLowerCase().replace(/\s+/g, '_'),
            displayName: name,
            settings: { ...settings },
        };

        this.customPresets.set(preset.id, preset);
        void this.persistence.saveCustomPresets(Array.from(this.customPresets.values()));

        return preset;
    }

    public getPerformanceMetrics(): IPerformanceMetrics {
        return this.performanceMonitor.getMetrics();
    }

    public registerModule(module: IQualityModule): void {
        if (this.modules.has(module.name)) {
            console.warn(`Module ${module.name} already registered`);
            return;
        }

        this.modules.set(module.name, module);

        // Apply current settings to the new module
        if (this.initialized) {
            module.initialize(this.currentSettings).catch(error => {
                console.error(`Failed to initialize module ${module.name}:`, error);
            });
        }
    }

    public unregisterModule(moduleName: string): void {
        const module = this.modules.get(moduleName);
        if (module) {
            module.dispose();
            this.modules.delete(moduleName);
        }
    }

    public async detectDeviceCapabilities(): Promise<IQualitySettings> {
        return this.deviceDetector.detectCapabilities();
    }

    public getRecommendedSettings(): IQualitySettings {
        return this.deviceDetector.getRecommendedSettings();
    }

    public async saveSettings(): Promise<void> {
        await this.persistence.saveSettings(this.currentSettings);
    }

    public async loadSettings(): Promise<void> {
        const savedSettings = await this.persistence.loadSettings();
        if (savedSettings) {
            void this.setSettings(savedSettings);
        }

        // Load custom presets
        const customPresets = await this.persistence.loadCustomPresets();
        customPresets.forEach(preset => {
            this.customPresets.set(preset.id, preset);
        });
    }

    private async applySettingsToModules(settings: IQualitySettings): Promise<void> {
        const promises: Promise<void>[] = [];

        this.modules.forEach(module => {
            promises.push(
                module.applySettings(settings).catch(error => {
                    console.error(`Failed to apply settings to module ${module.name}:`, error);
                }),
            );
        });

        await Promise.all(promises);
    }

    private getEffectiveSettings(): IQualitySettings {
        const rendering = this.runtimeRenderingOverride
            ? { ...this.currentSettings.rendering, ...this.runtimeRenderingOverride }
            : this.currentSettings.rendering;

        return {
            ...this.currentSettings,
            rendering: { ...rendering },
            physics: { ...this.currentSettings.physics },
            behavior: { ...this.currentSettings.behavior },
            scene: { ...this.currentSettings.scene },
            runtimeBudget: this.currentSettings.runtimeBudget ? { ...this.currentSettings.runtimeBudget } : undefined,
            network: { ...this.currentSettings.network },
            scheduler: { ...this.currentSettings.scheduler },
        };
    }

    private mergeSettings(
        current: IQualitySettings,
        partial: Partial<IQualitySettings>,
    ): IQualitySettings {
        const merged = { ...current };

        // Deep merge each category
        if (partial.rendering) {
            merged.rendering = { ...current.rendering, ...partial.rendering };
        }
        if (partial.physics) {
            merged.physics = { ...current.physics, ...partial.physics };
        }
        if (partial.behavior) {
            merged.behavior = { ...current.behavior, ...partial.behavior };
        }
        if (partial.scene) {
            merged.scene = { ...current.scene, ...partial.scene };
        }
        if (partial.runtimeBudget) {
            merged.runtimeBudget = { ...current.runtimeBudget, ...partial.runtimeBudget };
        }
        if (partial.network) {
            merged.network = { ...current.network, ...partial.network };
        }
        if (partial.scheduler) {
            merged.scheduler = { ...current.scheduler, ...partial.scheduler };
        }

        return merged;
    }

    private getPresetById(id: string): IQualityPreset | null {
        // Check built-in presets
        const builtInPreset = QualityPresets.getAllPresets().find(p => p.id === id);
        if (builtInPreset) return builtInPreset;

        // Check custom presets
        return this.customPresets.get(id) || null;
    }

    private areRenderingOverridesEqual(
        left: Partial<IQualitySettings['rendering']> | null,
        right: Partial<IQualitySettings['rendering']> | null,
    ): boolean {
        if (left === right) return true;
        if (!left || !right) return left === right;

        const leftKeys = Object.keys(left);
        const rightKeys = Object.keys(right);
        if (leftKeys.length !== rightKeys.length) {
            return false;
        }

        return leftKeys.every(key => (left as Record<string, unknown>)[key] === (right as Record<string, unknown>)[key]);
    }
}
