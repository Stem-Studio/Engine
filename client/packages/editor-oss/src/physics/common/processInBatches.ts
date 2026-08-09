export interface ProcessInBatchesOptions<T> {
    items: T[];
    batchSize: number;
    concurrency: number;
    processItem: (item: T, index: number) => Promise<void> | void;
    onBatchComplete?: (completedCount: number, totalCount: number) => Promise<void> | void;
    yieldBetweenBatches?: boolean;
}

type SchedulerWithYield = {
    yield?: () => Promise<void> | void;
};

function getSchedulerYield(): (() => Promise<void> | void) | null {
    const scheduler = (globalThis as typeof globalThis & {scheduler?: SchedulerWithYield}).scheduler;
    return typeof scheduler?.yield === "function" ? scheduler.yield.bind(scheduler) : null;
}

async function yieldToEventLoop(): Promise<void> {
    const schedulerYield = getSchedulerYield();
    if (schedulerYield) {
        await schedulerYield();
        return;
    }

    await new Promise<void>(resolve => setTimeout(resolve, 0));
}

async function runWithConcurrency<T>(
    items: T[],
    processItem: (item: T, index: number) => Promise<void> | void,
    startIndex: number,
    endIndex: number,
    concurrency: number,
): Promise<void> {
    const itemCount = endIndex - startIndex;
    if (itemCount <= 0) {
        return;
    }

    const workerCount = Math.min(Math.max(1, concurrency), itemCount);
    if (workerCount === 1) {
        for (let itemIndex = startIndex; itemIndex < endIndex; itemIndex++) {
            await processItem(items[itemIndex]!, itemIndex);
        }
        return;
    }

    let cursor = startIndex;
    const workers: Array<Promise<void>> = [];
    for (let workerIndex = 0; workerIndex < workerCount; workerIndex++) {
        workers.push((async () => {
            while (cursor < endIndex) {
                const itemIndex = cursor++;
                await processItem(items[itemIndex]!, itemIndex);
            }
        })());
    }
    await Promise.all(workers);
}

/**
 * Processes a list in bounded batches, optionally yielding to the host between
 * batches so large scene loads do not monopolize the main thread.
 */
export async function processInBatches<T>(options: ProcessInBatchesOptions<T>): Promise<void> {
    const { items, processItem, onBatchComplete } = options;
    const batchSize = Math.max(1, Math.floor(options.batchSize));
    const concurrency = Math.max(1, Math.floor(options.concurrency));
    const yieldBetweenBatches = options.yieldBetweenBatches ?? true;

    for (let i = 0; i < items.length; i += batchSize) {
        const endIndex = Math.min(i + batchSize, items.length);
        await runWithConcurrency(items, processItem, i, endIndex, concurrency);
        if (onBatchComplete) {
            await onBatchComplete(endIndex, items.length);
        }
        if (yieldBetweenBatches && i + batchSize < items.length) {
            await yieldToEventLoop();
        }
    }
}
