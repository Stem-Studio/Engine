const DEFAULT_MAX_EVENTS = 600;

/**
 *
 * @param raw
 */
function normalizeTraceConfig(raw) {
    if (!raw) {
        return { enabled: false, filters: null, console: false, maxEvents: DEFAULT_MAX_EVENTS };
    }

    if (raw === true) {
        return { enabled: true, filters: null, console: false, maxEvents: DEFAULT_MAX_EVENTS };
    }

    if (typeof raw === "string") {
        return {
            enabled: true,
            filters: raw.split(",").map(part => part.trim()).filter(Boolean),
            console: false,
            maxEvents: DEFAULT_MAX_EVENTS,
        };
    }

    if (Array.isArray(raw)) {
        return { enabled: true, filters: raw, console: false, maxEvents: DEFAULT_MAX_EVENTS };
    }

    if (typeof raw === "object") {
        const filters = Array.isArray(raw.filters)
            ? raw.filters
            : typeof raw.filters === "string"
                ? raw.filters.split(",").map(part => part.trim()).filter(Boolean)
                : null;
        return {
            enabled: true,
            filters,
            console: raw.console === true,
            maxEvents: Number.isFinite(raw.maxEvents) && raw.maxEvents > 0 ? raw.maxEvents : DEFAULT_MAX_EVENTS,
        };
    }

    return { enabled: false, filters: null, console: false, maxEvents: DEFAULT_MAX_EVENTS };
}

/**
 *
 * @param kind
 * @param filters
 */
function matchesFilter(kind, filters) {
    if (!filters || filters.length === 0) {
        return true;
    }

    return filters.some(filter => {
        if (filter === "*" || filter === kind) {
            return true;
        }
        if (typeof filter === "string" && filter.endsWith("*")) {
            return kind.startsWith(filter.slice(0, -1));
        }
        return false;
    });
}

/**
 *
 */
function getTraceStore() {
    const root = globalThis;
    if (!root.__FRAME_RUNTIME_TRACE__) {
        root.__FRAME_RUNTIME_TRACE__ = {
            events: [],
            _writeIndex: 0,
            _size: 0,
            dropped: 0,
            lastByKind: {},
            clear() {
                this.events.length = 0;
                this._writeIndex = 0;
                this._size = 0;
                this.dropped = 0;
                this.lastByKind = {};
            },
        };
    }
    return root.__FRAME_RUNTIME_TRACE__;
}

/**
 *
 * @param kind
 */
export function isFrameRuntimeTraceEnabled(kind) {
    const config = normalizeTraceConfig(globalThis.__TRACE_FRAME_RUNTIME__);
    return config.enabled && matchesFilter(kind, config.filters);
}

/**
 *
 * @param event
 */
export function recordFrameRuntimeTrace(event) {
    if (!event || typeof event.kind !== "string") {
        return;
    }

    const config = normalizeTraceConfig(globalThis.__TRACE_FRAME_RUNTIME__);
    if (!config.enabled || !matchesFilter(event.kind, config.filters)) {
        return;
    }

    const store = getTraceStore();
    const entry = {
        time: typeof performance !== "undefined" ? performance.now() : Date.now(),
        ...event,
    };

    store.lastByKind[event.kind] = entry;

    // Circular buffer: O(1) insertion instead of O(n) Array.shift()
    if (store._size < config.maxEvents) {
        store.events.push(entry);
        store._size++;
        store._writeIndex = store._size;
    } else {
        store.events[store._writeIndex % config.maxEvents] = entry;
        store._writeIndex++;
        store.dropped++;
    }

    if (config.console && (event.kind === "runtime-frame" || event.kind === "render-frame")) {
        console.debug(`[FrameRuntimeTrace] ${event.kind}`, entry);
    }
}

/**
 *
 */
export function getFrameRuntimeTraceStore() {
    return getTraceStore();
}
