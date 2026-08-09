import type { IPhysics } from '@stem/editor-oss/physics/common/types';
import type { IQualityModule, IQualitySettings, IPerformanceMetrics } from '../interfaces/IQualityManager';

/**
 * Manages physics quality settings
 */
export class PhysicsQualityModule implements IQualityModule {
    public readonly name = 'PhysicsQuality';

    private physics: IPhysics | null = null;
    private pendingSettings: IQualitySettings | null = null;

    public setPhysics(physics: IPhysics): void {
        if (!physics) {
            throw new Error('PhysicsQualityModule: Physics system cannot be null');
        }
        this.physics = physics;

        // Apply any pending settings
        if (this.pendingSettings) {
            console.log('PhysicsQualityModule: Applying pending settings after physics system is ready');
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
            throw new Error('PhysicsQualityModule: Settings cannot be null');
        }

        if (!this.physics) {
            // Store settings to apply later when physics is available
            this.pendingSettings = settings;
            console.log('PhysicsQualityModule: Physics system not ready, deferring settings application');
            return;
        }

        // PlayerPhysics2 owns the fixed-step accumulator and exposes this
        // optional adapter hook. Keeping the call here makes quality preset
        // changes effective even when they arrive after the Play session has
        // created physics. Lower-level Ammo/Rapier implementations that do not
        // own scheduling simply omit the hook.
        this.physics.configureQuality?.(
            settings.physics.updateRate,
            settings.physics.substeps,
            settings.physics.maxStepsPerFrame,
            true,
            true,
            settings.physics.solverIterations,
        );
    }

    public getMetrics(): Partial<IPerformanceMetrics> {
        return {};
    }

    public dispose(): void {
        this.physics = null;
    }
}
