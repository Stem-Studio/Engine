const DEFAULT_FIXED_HZ = 60;
const DEFAULT_MAX_STEPS_PER_FRAME = 3;
const DEFAULT_MAX_FRAME_DELTA_SECONDS = 0.25;
const STEP_EPSILON_SECONDS = 1e-9;
const MIN_FIXED_HZ = 1;
const MAX_FIXED_HZ = 240;
const MAX_STEPS_PER_FRAME_LIMIT = 16;
const MIN_FRAME_DELTA_CLAMP_SECONDS = 0.001;
const MAX_FRAME_DELTA_CLAMP_SECONDS = 1;

export interface FixedStepSimulationClockConfig {
    fixedHz?: number;
    maxStepsPerFrame?: number;
    maxFrameDeltaSeconds?: number;
}

/**
 * Allocation-stable result reused by FixedStepSimulationClock.advance().
 * Consumers must treat it as frame-scoped and must not retain it.
 */
export interface FixedStepSimulationFrame {
    rawDeltaTime: number;
    deltaTime: number;
    fixedDeltaTime: number;
    fixedStepCount: number;
    interpolationAlpha: number;
    fixedOverstep: number;
    droppedTime: number;
    droppedSteps: number;
    totalDroppedTime: number;
    totalDroppedSteps: number;
}

/**
 * The sole accumulator for the runtime simulation.
 *
 * The clock deliberately separates deciding how many steps are due from
 * executing those steps. EngineRuntime can therefore preserve an explicit
 * physics -> gameplay order without allocating callbacks in the hot path.
 */
export class FixedStepSimulationClock {
    private fixedDeltaTime = 1 / DEFAULT_FIXED_HZ;
    private maxStepsPerFrame = DEFAULT_MAX_STEPS_PER_FRAME;
    private maxFrameDeltaSeconds = DEFAULT_MAX_FRAME_DELTA_SECONDS;
    private accumulator = 0;
    private totalDroppedTime = 0;
    private totalDroppedSteps = 0;
    private readonly frame: FixedStepSimulationFrame = {
        rawDeltaTime: 0,
        deltaTime: 0,
        fixedDeltaTime: 1 / DEFAULT_FIXED_HZ,
        fixedStepCount: 0,
        interpolationAlpha: 0,
        fixedOverstep: 0,
        droppedTime: 0,
        droppedSteps: 0,
        totalDroppedTime: 0,
        totalDroppedSteps: 0,
    };

    constructor(config: FixedStepSimulationClockConfig = {}) {
        this.configure(config);
    }

    configure(config: FixedStepSimulationClockConfig): void {
        const nextFixedHz = Math.min(
            MAX_FIXED_HZ,
            Math.max(MIN_FIXED_HZ, this.positiveFiniteOr(config.fixedHz, 1 / this.fixedDeltaTime)),
        );
        const nextFixedDeltaTime = 1 / nextFixedHz;
        const nextMaxSteps = Math.min(
            MAX_STEPS_PER_FRAME_LIMIT,
            Math.max(
                1,
                Math.floor(this.positiveFiniteOr(config.maxStepsPerFrame, this.maxStepsPerFrame)),
            ),
        );
        const nextMaxDelta = Math.min(
            MAX_FRAME_DELTA_CLAMP_SECONDS,
            Math.max(
                MIN_FRAME_DELTA_CLAMP_SECONDS,
                this.positiveFiniteOr(config.maxFrameDeltaSeconds, this.maxFrameDeltaSeconds),
            ),
        );

        if (Math.abs(nextFixedDeltaTime - this.fixedDeltaTime) > STEP_EPSILON_SECONDS) {
            // A remainder expressed in the old timestep has no deterministic
            // meaning in the new one.
            this.accumulator = 0;
        }
        this.fixedDeltaTime = nextFixedDeltaTime;
        this.maxStepsPerFrame = nextMaxSteps;
        this.maxFrameDeltaSeconds = nextMaxDelta;
        this.frame.fixedDeltaTime = nextFixedDeltaTime;
    }

    advance(rawDeltaTime: number): Readonly<FixedStepSimulationFrame> {
        const safeRawDelta = Number.isFinite(rawDeltaTime) && rawDeltaTime > 0
            ? rawDeltaTime
            : 0;
        const clampedDelta = Math.min(safeRawDelta, this.maxFrameDeltaSeconds);
        let droppedTime = safeRawDelta - clampedDelta;

        this.accumulator += clampedDelta;
        const availableSteps = Math.floor(
            (this.accumulator + STEP_EPSILON_SECONDS) / this.fixedDeltaTime,
        );
        const fixedStepCount = Math.min(availableSteps, this.maxStepsPerFrame);
        const droppedSteps = Math.max(0, availableSteps - fixedStepCount);

        this.accumulator -= fixedStepCount * this.fixedDeltaTime;
        if (droppedSteps > 0) {
            const catchUpDrop = droppedSteps * this.fixedDeltaTime;
            this.accumulator -= catchUpDrop;
            droppedTime += catchUpDrop;
        }
        if (this.accumulator < STEP_EPSILON_SECONDS) {
            this.accumulator = 0;
        }

        this.totalDroppedTime += droppedTime;
        this.totalDroppedSteps += droppedSteps;

        const frame = this.frame;
        frame.rawDeltaTime = safeRawDelta;
        frame.deltaTime = clampedDelta;
        frame.fixedDeltaTime = this.fixedDeltaTime;
        frame.fixedStepCount = fixedStepCount;
        frame.interpolationAlpha = Math.min(1, this.accumulator / this.fixedDeltaTime);
        frame.fixedOverstep = this.accumulator;
        frame.droppedTime = droppedTime;
        frame.droppedSteps = droppedSteps;
        frame.totalDroppedTime = this.totalDroppedTime;
        frame.totalDroppedSteps = this.totalDroppedSteps;
        return frame;
    }

    /**
     * Discards only pending wall-clock remainder. Lifetime drop counters remain
     * diagnostic truth across pause/visibility transitions.
     */
    reset(): void {
        this.accumulator = 0;
        this.frame.rawDeltaTime = 0;
        this.frame.deltaTime = 0;
        this.frame.fixedStepCount = 0;
        this.frame.interpolationAlpha = 0;
        this.frame.fixedOverstep = 0;
        this.frame.droppedTime = 0;
        this.frame.droppedSteps = 0;
    }

    getCurrentFrame(): Readonly<FixedStepSimulationFrame> {
        return this.frame;
    }

    getFixedHz(): number {
        return 1 / this.fixedDeltaTime;
    }

    getMaxStepsPerFrame(): number {
        return this.maxStepsPerFrame;
    }

    private positiveFiniteOr(value: number | undefined, fallback: number): number {
        return Number.isFinite(value) && value! > 0 ? value! : fallback;
    }
}
