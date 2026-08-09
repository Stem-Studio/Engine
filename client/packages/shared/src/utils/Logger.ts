// Log levels in order of severity (lower numbers = higher priority)
enum LogLevel {
    ERROR = 0, // Only errors
    WARN = 1, // Warnings and errors
    INFO = 2, // Info, warnings, and errors
    DEBUG = 3, // Debug and above
    LOG = 4, // All logs
}

// Resolver function to convert environment variable string to LogLevel
/**
 *
 * @param envLogLevel
 */
function resolveLogLevel(envLogLevel: string | undefined): LogLevel | undefined {
    if (!envLogLevel) {
        return undefined;
    }

    const normalizedLevel = envLogLevel.toUpperCase().trim();

    switch (normalizedLevel) {
        case "ERROR":
            return LogLevel.ERROR;
        case "WARN":
        case "WARNING":
            return LogLevel.WARN;
        case "INFO":
            return LogLevel.INFO;
        case "DEBUG":
            return LogLevel.DEBUG;
        case "LOG":
            return LogLevel.LOG;
        default:
            return undefined;
    }
}

interface LoggerConfig {
    enabled: boolean; // Set to true to log messages, false to disable logging
    logLevel?: LogLevel; // Minimum log level to display
}

interface AdvancedLoggerConfig {
    logLevel: LogLevel; // Minimum log level to display
}

// Store original console methods to prevent infinite recursion
const originalConsole = {
    log: console.log.bind(console),
    debug: console.debug.bind(console),
    info: console.info.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
    table: console.table.bind(console),
    group: console.group.bind(console),
    groupCollapsed: console.groupCollapsed.bind(console),
    groupEnd: console.groupEnd.bind(console),
    time: console.time.bind(console),
    timeEnd: console.timeEnd.bind(console),
    timeLog: console.timeLog.bind(console),
};

// Empty function for disabled log levels
const noop = (): void => {};

export type LogListener = (level: LogLevel, args: unknown[]) => void;

// Create the Logger class
export class Logger {
    private enabled: boolean;
    private logLevel: LogLevel;
    private listeners: LogListener[] = [];

    // Pre-bound log functions based on configuration
    public readonly log: (...args: unknown[]) => void;
    public readonly debug: (...args: unknown[]) => void;
    public readonly info: (...args: unknown[]) => void;
    public readonly warn: (...args: unknown[]) => void;
    public readonly error: (...args: unknown[]) => void;
    public readonly prettyPrint: (object: unknown) => void;
    public readonly table: (...args: unknown[]) => void;
    public readonly group: (...args: unknown[]) => void;
    public readonly groupCollapsed: (...args: unknown[]) => void;
    public readonly groupEnd: () => void;
    public readonly time: (...args: unknown[]) => void;
    public readonly timeEnd: (...args: unknown[]) => void;
    public readonly timeLog: (...args: unknown[]) => void;

    constructor(config: LoggerConfig | AdvancedLoggerConfig) {
        // Handle backwards compatibility
        if ("enabled" in config) {
            this.enabled = config.enabled;
            this.logLevel = config.logLevel ?? LogLevel.LOG;
        } else {
            this.enabled = true;
            this.logLevel = config.logLevel;
        }

        // Pre-bind log functions based on current configuration
        this.log = this.createLogFunction(LogLevel.LOG, originalConsole.log);
        this.debug = this.createLogFunction(LogLevel.DEBUG, originalConsole.debug);
        this.info = this.createLogFunction(LogLevel.INFO, originalConsole.info);
        this.warn = this.createLogFunction(LogLevel.WARN, originalConsole.warn);
        this.error = this.createLogFunction(LogLevel.ERROR, originalConsole.error);
        this.prettyPrint = this.shouldLog(LogLevel.DEBUG)
            ? (object: unknown) => originalConsole.log(JSON.stringify(object, null, 2))
            : noop;
        this.table = this.createLogFunction(LogLevel.DEBUG, originalConsole.table);
        this.group = this.createLogFunction(LogLevel.DEBUG, originalConsole.group);
        this.groupCollapsed = this.createLogFunction(LogLevel.DEBUG, originalConsole.groupCollapsed);
        this.groupEnd = this.shouldLog(LogLevel.DEBUG) ? originalConsole.groupEnd : noop;
        this.time = this.createLogFunction(LogLevel.DEBUG, originalConsole.time);
        this.timeEnd = this.createLogFunction(LogLevel.DEBUG, originalConsole.timeEnd);
        this.timeLog = this.createLogFunction(LogLevel.DEBUG, originalConsole.timeLog);
    }

    public addListener(listener: LogListener) {
        this.listeners.push(listener);
    }

    public removeListener(listener: LogListener) {
        this.listeners = this.listeners.filter(l => l !== listener);
    }

    private createLogFunction(level: LogLevel, originalMethod: (...args: any[]) => void) {
        return (...args: unknown[]) => {
            if (this.shouldLog(level)) {
                originalMethod(...args);
                this.notifyListeners(level, args);
            }
        };
    }

    public notifyListeners(level: LogLevel, args: unknown[]) {
        this.listeners.forEach(listener => listener(level, args));
    }

    /**
     * Check if a given log level would be displayed at the current configuration.
     * @param level
     */
    public isLevelEnabled(level: LogLevel): boolean {
        return this.shouldLog(level);
    }

    // Check if a log level should be displayed
    private shouldLog(level: LogLevel): boolean {
        return this.enabled && level <= this.logLevel;
    }
}

// Enhanced function to initialize logger with log levels
/**
 *
 * @param config
 * @param fallbackLevel
 */
export function initializeLogger(config?: AdvancedLoggerConfig, fallbackLevel?: LogLevel): void {
    const finalConfig = config || getDefaultLoggerConfig(fallbackLevel);
    const logger = new Logger(finalConfig);

    // Check if the window and console objects are available
    if (typeof window !== "undefined" && window.console) {
        // Replace default console methods with the custom logger's methods
        window.console.log = logger.log.bind(logger);
        window.console.info = logger.info.bind(logger);
        window.console.warn = logger.warn.bind(logger);
        window.console.error = logger.error.bind(logger);
        window.console.debug = logger.debug.bind(logger);

        window.console.table = logger.table.bind(logger);
        window.console.group = logger.group.bind(logger);
        window.console.groupCollapsed = logger.groupCollapsed.bind(logger);
        window.console.groupEnd = logger.groupEnd.bind(logger);
        window.console.time = logger.time.bind(logger);
        window.console.timeEnd = logger.timeEnd.bind(logger);
        window.console.timeLog = logger.timeLog.bind(logger);

        // Add the prettyPrint method to console
        (window.console as any).prettyPrint = logger.prettyPrint.bind(logger);

        // Expose logger instance to allow adding listeners
        (window as any).logger = logger;
    }
}

export const LOG_LEVEL_STORAGE_KEY = "logLevelOverride";

/** Stores mismatch info when localStorage overrides the .env log level. */
export let logLevelMismatch: {stored: string; env: string} | null = null;

// Get default configuration based on environment
/**
 *
 * @param fallbackLevel
 */
function getDefaultLoggerConfig(fallbackLevel: LogLevel = LogLevel.WARN): AdvancedLoggerConfig {
    // Runtime override from localStorage takes priority
    const stored = typeof window !== "undefined"
        ? localStorage.getItem(LOG_LEVEL_STORAGE_KEY)
        : null;
    const storedLevel = resolveLogLevel(stored ?? undefined);
    const envLevel = resolveLogLevel(process.env.REACT_APP_WEB_LOG_LEVEL);

    // Detect and report mismatch between localStorage override and .env setting
    if (storedLevel !== undefined && envLevel !== undefined && storedLevel !== envLevel) {
        const storedName = LogLevel[storedLevel] ?? "UNKNOWN";
        const envName = LogLevel[envLevel] ?? "UNKNOWN";
        logLevelMismatch = {stored: storedName, env: envName};
        originalConsole.warn(
            `[Logger] Log level override detected: localStorage="${storedName}" overrides .env="${envName}". ` +
            `Use the Log Level picker in the editor menu to reset, or clear localStorage key "${LOG_LEVEL_STORAGE_KEY}".`
        );
    } else {
        logLevelMismatch = null;
    }

    return {
        logLevel: storedLevel ?? envLevel ?? fallbackLevel,
    };
}

/**
 *
 * @param level
 */
export function getLogLevelName(level: LogLevel): string {
    return LogLevel[level] ?? "WARN";
}

/** Returns the global logger instance. Prefer this over (window as any).logger */
export function getLogger(): Logger | undefined {
    return (window as any).logger as Logger | undefined;
}

// Export the LogLevel enum for external use
export {LogLevel};
