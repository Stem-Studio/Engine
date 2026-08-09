import {MenuItem} from "./AppMenu.style";
import {initializeLogger, LOG_LEVEL_STORAGE_KEY, LogLevel} from "@stem/editor-oss/utils/Logger";

const EDITOR_FALLBACK = LogLevel.LOG;
import {Separator} from "../../RightPanel/common/Separator";

const LOG_LEVELS = [
    {label: "ERROR", value: LogLevel.ERROR},
    {label: "WARN", value: LogLevel.WARN},
    {label: "INFO", value: LogLevel.INFO},
    {label: "DEBUG", value: LogLevel.DEBUG},
    {label: "LOG", value: LogLevel.LOG},
] as const;

/**
 *
 */
function getCurrentLevelName(): string {
    const stored = localStorage.getItem(LOG_LEVEL_STORAGE_KEY);
    return (stored ?? process.env.REACT_APP_WEB_LOG_LEVEL ?? "LOG").toUpperCase().trim();
}

interface LogLevelPickerProps {
    onClose: () => void;
}

export const LogLevelPicker = ({onClose}: LogLevelPickerProps) => {
    const currentName = getCurrentLevelName();

    const handleSelect = (label: string) => {
        localStorage.setItem(LOG_LEVEL_STORAGE_KEY, label);
        initializeLogger(undefined, EDITOR_FALLBACK);
        onClose();
    };

    const handleReset = () => {
        localStorage.removeItem(LOG_LEVEL_STORAGE_KEY);
        initializeLogger(undefined, EDITOR_FALLBACK);
        onClose();
    };

    return (
        <>
            <Separator margin="8px 0" />
            {LOG_LEVELS.map(({label}) => (
                <MenuItem
                    key={label}
                    onClick={() => handleSelect(label)}
                    style={{justifyContent: "space-between"}}
                >
                    {label}
                    {(label === currentName || currentName === "WARN") && (
                        <span style={{marginLeft: "auto", opacity: 0.8}}>●</span>
                    )}
                </MenuItem>
            ))}
            <Separator margin="8px 0" />
            <MenuItem onClick={handleReset}>Reset to Default</MenuItem>
        </>
    );
};
