
import EventEmitter from "eventemitter3";

/**
 *
 * @param type
 */
function shouldTraceAppEvent(type) {
    const trace = globalThis?.__TRACE_APP_EVENTS__;
    if (!trace) {
        return false;
    }
    if (trace === true) {
        return true;
    }
    if (Array.isArray(trace)) {
        return trace.includes(type);
    }
    if (typeof trace === "string") {
        return trace.split(",").map(s => s.trim()).includes(type);
    }
    return false;
}

function shouldProfileAppEvent(type) {
    const profiler = globalThis?.__STEM_APP_EVENT_PROFILE__;
    if (!profiler || profiler.enabled === false) return false;
    const types = profiler.types;
    if (!types) return true;
    if (Array.isArray(types)) return types.includes(type);
    if (typeof types === "string") return types.split(",").map(value => value.trim()).includes(type);
    return true;
}

function recordAppEventProfile(type, key, durationMs) {
    const profiler = globalThis?.__STEM_APP_EVENT_PROFILE__;
    if (!profiler || profiler.enabled === false) return;

    if (typeof profiler.record === "function") {
        profiler.record({type, key, durationMs});
        return;
    }

    const events = profiler.events || (profiler.events = {});
    const entry = events[key] || (events[key] = {type, key, calls: 0, totalMs: 0, maxMs: 0});
    entry.calls += 1;
    entry.totalMs += durationMs;
    entry.maxMs = Math.max(entry.maxMs, durationMs);
}

function now() {
    return typeof globalThis?.performance?.now === "function" ? globalThis.performance.now() : Date.now();
}

/**
 *
 * @param typenames
 */
function parseTypenames(typenames) {
    return typenames.trim().split(/\s+/).map(name => {
        const index = name.indexOf(".");
        return {
            type: index === -1 ? name : name.slice(0, index),
            namespace: index === -1 ? "" : name.slice(index + 1),
        };
    });
}

function sliceArguments(argsLike, start) {
    const length = Math.max(0, argsLike.length - start);
    const args = new Array(length);
    for (let i = 0; i < length; i++) {
        args[i] = argsLike[i + start];
    }
    return args;
}

class DispatchCompat {
    constructor(...types) {
        this.types = new Set(types);
        this.emitter = new EventEmitter();
        this.listeners = new Map();
    }

    on(typenames, callback) {
        const names = parseTypenames(typenames);

        if (arguments.length < 2 && names.length > 0) {
            const {type, namespace} = names[0];
            this.ensureType(type);
            return this.listeners.get(`${type}.${namespace}`)?.callback;
        }

        names.forEach(({type, namespace}) => {
            this.ensureType(type);
            const key = `${type}.${namespace}`;
            const existing = this.listeners.get(key);

            if (existing) {
                this.emitter.off(type, existing.handler);
                this.listeners.delete(key);
            }

            if (callback === null || callback === undefined) {
                if (shouldTraceAppEvent(type)) {
                    console.info(`[DispatchCompat] off ${key}`);
                }
                return;
            }

            const handler = function (ctx, arg0, arg1, arg2, arg3) {
                const invoke = () => {
                    switch (arguments.length) {
                        case 1:
                            return callback.call(ctx);
                        case 2:
                            return callback.call(ctx, arg0);
                        case 3:
                            return callback.call(ctx, arg0, arg1);
                        case 4:
                            return callback.call(ctx, arg0, arg1, arg2);
                        case 5:
                            return callback.call(ctx, arg0, arg1, arg2, arg3);
                        default:
                            return callback.apply(ctx, sliceArguments(arguments, 1));
                    }
                };

                if (!shouldProfileAppEvent(type)) {
                    return invoke();
                }

                const startedAt = now();
                try {
                    return invoke();
                } finally {
                    recordAppEventProfile(type, key, now() - startedAt);
                }
            };
            this.listeners.set(key, {callback, handler});
            this.emitter.on(type, handler);
            if (shouldTraceAppEvent(type)) {
                console.info(`[DispatchCompat] on ${key} (listeners=${this.emitter.listenerCount(type)})`);
            }
        });

        return this;
    }

    off(typenames) {
        return this.on(typenames, null);
    }

    call(type, that, arg0, arg1, arg2, arg3) {
        this.ensureType(type);
        if (shouldTraceAppEvent(type)) {
            console.info(`[DispatchCompat] emit ${type} (listeners=${this.emitter.listenerCount(type)})`, sliceArguments(arguments, 2));
        }

        switch (arguments.length) {
            case 2:
                this.emitter.emit(type, that);
                return;
            case 3:
                this.emitter.emit(type, that, arg0);
                return;
            case 4:
                this.emitter.emit(type, that, arg0, arg1);
                return;
            case 5:
                this.emitter.emit(type, that, arg0, arg1, arg2);
                return;
            case 6:
                this.emitter.emit(type, that, arg0, arg1, arg2, arg3);
                return;
            default:
                this.emitter.emit(type, that, ...sliceArguments(arguments, 2));
        }
    }

    apply(type, that, args) {
        const values = Array.isArray(args) ? args : [];
        switch (values.length) {
            case 0:
                this.call(type, that);
                return;
            case 1:
                this.call(type, that, values[0]);
                return;
            case 2:
                this.call(type, that, values[0], values[1]);
                return;
            case 3:
                this.call(type, that, values[0], values[1], values[2]);
                return;
            case 4:
                this.call(type, that, values[0], values[1], values[2], values[3]);
                return;
            default:
                this.call(type, that, ...values);
        }
    }

    ensureType(type) {
        if (!this.types.has(type)) {
            throw new Error(`unknown type: ${type}`);
        }
    }
}

/**
 *
 * @param {...any} types
 */
export function dispatch(...types) {
    return new DispatchCompat(...types);
}
