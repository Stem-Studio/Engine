export type AnalyticsParams = Record<string, string | number | boolean>;

/**
 * IAnalyticsRecorder is the seam between editor-side product analytics
 * call sites and any concrete recording surface. This repository wires
 * `NullAnalyticsRecorder`, so events are silently dropped.
 */
export interface IAnalyticsRecorder {
    /** Record a named event with arbitrary string/number/boolean params. */
    logEvent(name: string, params?: AnalyticsParams): void;
    /** Associate subsequent events with a user identifier. */
    setUserId(userId: string | undefined): void;
    /** Attach long-lived properties (plan tier, locale, etc.) to the user. */
    setUserProperties(params: AnalyticsParams): void;
}

/** Default no-op implementation. */
export class NullAnalyticsRecorder implements IAnalyticsRecorder {
    logEvent(): void {/* no-op */}
    setUserId(): void {/* no-op */}
    setUserProperties(): void {/* no-op */}
}
