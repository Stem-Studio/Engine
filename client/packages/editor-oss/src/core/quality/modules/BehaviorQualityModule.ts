import type BehaviorManager from '@stem/editor-oss/behaviors/BehaviorManager';
import { BehaviorThrottlePriority } from '@stem/editor-oss/behaviors/performance/interfaces/IThrottleStrategy';
import type { IQualityModule, IQualitySettings, IPerformanceMetrics } from '../interfaces/IQualityManager';

/**
 * Manages behavior quality settings and throttling
 */
export class BehaviorQualityModule implements IQualityModule {
    public readonly name = 'BehaviorQuality';
    
    private behaviorManager: BehaviorManager | null = null;
    private pendingSettings: IQualitySettings | null = null;
    
    // Throttling configuration
    private updateRates = {
        CRITICAL: 60,  // Always run at full rate
        HIGH: 30,      // Important behaviors
        MEDIUM: 15,    // Standard behaviors
        LOW: 5,        // Background behaviors
        MINIMAL: 2,    // Very low priority
    };
    
    public setBehaviorManager(manager: BehaviorManager): void {
        if (!manager) {
            throw new Error('BehaviorQualityModule: BehaviorManager cannot be null');
        }
        this.behaviorManager = manager;

        // Apply any pending settings (configures ThrottleContainer factors)
        if (this.pendingSettings) {
            console.log('BehaviorQualityModule: Applying pending settings after BehaviorManager is ready');
            void this.applySettings(this.pendingSettings);
            this.pendingSettings = null;
        }
    }

    public async initialize(settings: IQualitySettings): Promise<void> {
        await this.applySettings(settings);
    }

    // eslint-disable-next-line @typescript-eslint/require-await
    public async applySettings(settings: IQualitySettings): Promise<void> {
        if (!settings) {
            throw new Error('BehaviorQualityModule: Settings cannot be null');
        }
        
        if (!this.behaviorManager) {
            // Store settings to apply later when behavior manager is available
            this.pendingSettings = settings;
            console.log('BehaviorQualityModule: BehaviorManager not ready, deferring settings application');
            return;
        }
        
        // Apply behavior settings
        this.applyUpdateRates(settings.behavior);

        // Configure behavior manager
        this.configureBehaviorManager(settings.behavior);
    }

    public getMetrics(): Partial<IPerformanceMetrics> {
        return {};
    }

    public dispose(): void {
        this.behaviorManager = null;
    }

    private applyUpdateRates(settings: IQualitySettings['behavior']): void {
        // Adjust update rates based on quality settings
        const baseRate = settings.updateRate;

        this.updateRates = {
            CRITICAL: baseRate,
            HIGH: Math.max(baseRate * 0.5, 15),
            MEDIUM: Math.max(baseRate * 0.25, 10),
            LOW: Math.max(baseRate * 0.1, 5),
            MINIMAL: Math.max(baseRate * 0.05, 2),
        };

        // Derive ThrottleContainer priority factors from update rates
        // factor = ceil(targetFPS / updateRate) — higher rate = lower throttle factor
        if (this.behaviorManager) {
            const targetFPS = 60;
            this.behaviorManager.updateThrottlingConfig({
                priorityThrottleFactors: {
                    [BehaviorThrottlePriority.CRITICAL]: 1,
                    [BehaviorThrottlePriority.HIGH]: Math.max(1, Math.ceil(targetFPS / this.updateRates.HIGH)),
                    [BehaviorThrottlePriority.MEDIUM]: Math.max(1, Math.ceil(targetFPS / this.updateRates.MEDIUM)),
                    [BehaviorThrottlePriority.LOW]: Math.max(1, Math.ceil(targetFPS / this.updateRates.LOW)),
                    [BehaviorThrottlePriority.MINIMAL]: Math.max(1, Math.ceil(targetFPS / this.updateRates.MINIMAL)),
                },
            });
        }
    }

    private configureBehaviorManager(settings: IQualitySettings['behavior']): void {
        if (!this.behaviorManager) return;
        
        // Configure behavior manager with quality settings
        // Configure behavior manager if it supports max concurrent behaviors
        const managerWithLimit = this.behaviorManager;
        if ('maxConcurrentBehaviors' in managerWithLimit) {
            managerWithLimit.maxConcurrentBehaviors = settings.maxConcurrentBehaviors;
        }
    }

}
