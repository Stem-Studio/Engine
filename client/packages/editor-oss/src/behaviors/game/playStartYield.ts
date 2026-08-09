export const PLAY_START_PAINT_YIELD_MAX_DELAY_MS = 100;

/**
 * Gives a healthy browser one animation frame plus one task to paint while
 * keeping play startup moving when requestAnimationFrame is throttled.
 */
export function yieldPlayStartToPaint(
    maxDelayMs = PLAY_START_PAINT_YIELD_MAX_DELAY_MS,
): Promise<void> {
    return new Promise(resolve => {
        let settled = false;
        let animationFrameId: number | undefined;
        let postFrameTimer: ReturnType<typeof setTimeout> | undefined;
        let fallbackTimer: ReturnType<typeof setTimeout> | undefined;

        const finish = () => {
            if (settled) return;
            settled = true;

            if (fallbackTimer !== undefined) {
                clearTimeout(fallbackTimer);
                fallbackTimer = undefined;
            }
            if (postFrameTimer !== undefined) {
                clearTimeout(postFrameTimer);
                postFrameTimer = undefined;
            }
            if (
                animationFrameId !== undefined &&
                typeof cancelAnimationFrame === "function"
            ) {
                cancelAnimationFrame(animationFrameId);
                animationFrameId = undefined;
            }

            resolve();
        };

        fallbackTimer = setTimeout(finish, Math.max(0, maxDelayMs));

        if (typeof requestAnimationFrame === "function") {
            animationFrameId = requestAnimationFrame(() => {
                animationFrameId = undefined;
                if (settled) return;
                postFrameTimer = setTimeout(() => {
                    postFrameTimer = undefined;
                    finish();
                }, 0);
            });
        } else {
            postFrameTimer = setTimeout(() => {
                postFrameTimer = undefined;
                finish();
            }, 0);
        }
    });
}
