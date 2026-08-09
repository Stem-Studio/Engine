import {NullAnalyticsRecorder, type IAnalyticsRecorder} from "./IAnalyticsRecorder";

let singleton: IAnalyticsRecorder | undefined;

/**
 * Returns the process-wide analytics recorder. Defaults to
 * `NullAnalyticsRecorder` (silent drop) unless an embedder registers a
 * custom implementation.
 */
export function getAnalyticsRecorder(): IAnalyticsRecorder {
    if (!singleton) {
        singleton = new NullAnalyticsRecorder();
    }
    return singleton;
}

/** Replace the singleton. Tests and embedders can use this to inject a recorder. */
export function setAnalyticsRecorder(recorder: IAnalyticsRecorder | undefined): void {
    singleton = recorder;
}
