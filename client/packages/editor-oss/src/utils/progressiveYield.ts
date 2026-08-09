export interface ProgressiveYieldOptions {
    batchSize?: number;
    frameBudgetMs?: number;
    yieldToFrame?: () => Promise<void>;
}

export interface ProgressiveYieldDefaults {
    batchSize: number;
    frameBudgetMs: number;
}

const nowForProgressiveYield = (): number =>
    typeof performance !== "undefined" && typeof performance.now === "function"
        ? performance.now()
        : Date.now();

const defaultYieldToFrame = (): Promise<void> =>
    new Promise(resolve => {
        const finish = () => setTimeout(resolve, 0);
        if (typeof requestAnimationFrame === "function") {
            requestAnimationFrame(() => finish());
        } else {
            finish();
        }
    });

function positiveInteger(value: number | undefined, fallback: number): number {
    return Number.isFinite(value) && value! > 0 ? Math.floor(value!) : fallback;
}

function nonNegativeNumber(value: number | undefined, fallback: number): number {
    return Number.isFinite(value) && value! >= 0 ? value! : fallback;
}

export function createProgressiveYieldController(
    options: ProgressiveYieldOptions = {},
    defaults: ProgressiveYieldDefaults,
): (force?: boolean) => Promise<void> {
    const batchSize = positiveInteger(options.batchSize, defaults.batchSize);
    const frameBudgetMs = nonNegativeNumber(options.frameBudgetMs, defaults.frameBudgetMs);
    const yieldToFrame = options.yieldToFrame ?? defaultYieldToFrame;
    let sliceStart = nowForProgressiveYield();
    let processedThisSlice = 0;

    return async (force = false): Promise<void> => {
        processedThisSlice += 1;
        if (
            !force &&
            processedThisSlice < batchSize &&
            nowForProgressiveYield() - sliceStart < frameBudgetMs
        ) {
            return;
        }

        await yieldToFrame();
        sliceStart = nowForProgressiveYield();
        processedThisSlice = 0;
    };
}
