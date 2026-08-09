import pRetry, { type RetryContext } from 'p-retry';

const RETRYABLE_STATUS_CODES = [408, 429, 500, 502, 503, 504];

export interface RetryOptions {
    /** Number of retries before giving up (default: 3) */
    retries?: number;
    /** Name of the operation for logging purposes */
    operationName?: string;
}

/**
 * Checks if an error should be retried based on HTTP status code.
 * 
 * @param context - The retry context containing the error and attempt number
 * @returns True if the error should be retried, false otherwise
 */
const shouldRetry = (context: RetryContext): boolean => {
    const error = context.error;

    // Retry axios-compatible request errors with retryable status codes.
    if (isAxiosCompatibleError(error) && error.response?.status) {
        return RETRYABLE_STATUS_CODES.includes(error.response.status);
    }

    // Retry network errors (no response)
    if (isAxiosCompatibleError(error) && !error.response) {
        return true;
    }

    // Retry custom HTTP status errors used by API wrappers.
    if (isStatusError(error)) {
        return RETRYABLE_STATUS_CODES.includes(error.statusCode);
    }

    // Don't retry other errors
    return false;
};

interface StatusErrorLike {
    statusCode: number;
}

interface AxiosCompatibleErrorLike {
    isAxiosError: true;
    response?: {
        status?: number;
    };
}

const isAxiosCompatibleError = (error: unknown): error is AxiosCompatibleErrorLike => {
    return !!error
        && typeof error === "object"
        && (error as AxiosCompatibleErrorLike).isAxiosError === true;
};

const isStatusError = (error: unknown): error is StatusErrorLike => {
    return (
        error instanceof Error &&
        typeof (error as unknown as StatusErrorLike).statusCode === "number"
    );
};

/**
 * Wraps a function with retry logic using exponential backoff.
 *
 * Only retries on transient errors (network issues, 5xx, 408, 429).
 * Client errors (4xx) are not retried as they indicate permanent failures.
 *
 * @param fn - The async function to execute with retries
 * @param options - Optional configuration
 * @param options.retries - Number of retries (default: 3)
 * @param options.operationName - Name for logging failed attempts
 * @returns A promise that resolves with the function result, or rejects after all retries fail
 */
export const withRetry = <T>(
    fn: () => Promise<T>,
    options?: RetryOptions,
): Promise<T> => {
    return pRetry(fn, {
        retries: options?.retries ?? 3,
        shouldRetry,
        onFailedAttempt: (context: RetryContext) => {
            const name = options?.operationName ?? 'Operation';
            const attempt = context.attemptNumber;
            const total = context.retriesLeft + context.attemptNumber;
            console.warn(`${name} failed (attempt ${attempt}/${total}):`, context.error.message);
        },
    });
};
