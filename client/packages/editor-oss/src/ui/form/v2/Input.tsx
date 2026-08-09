import "../css/Input.css";
import classNames from "classnames";

interface Props {
    className?: string;
    style?: any;
    name?: string;
    type?: "text" | "number" | "color" | "password" | "file";
    value?: string | number;
    min?: number;
    max?: number;
    step?: number;
    precision?: number;
    disabled?: boolean;
    accept?: string;
    show?: boolean;
    onFocus?: (event: any) => void;
    onChange?: (value: string | number | null, name?: string, event?: any) => void;
    onInput?: (value: string | number | null, name?: string, event?: any) => void;
}

const Input = ({
    className,
    style,
    name,
    type = "text",
    value = "",
    min,
    max,
    step,
    precision,
    disabled = false,
    accept,
    show = true,
    onFocus,
    onChange,
    onInput,
}: Props) => {
    const val = value === undefined || value === null ? "" : value;

    const handleFocus = (event: any) => {
        if (onFocus) onFocus(event);
    };

    const handleChange = (event: any) => {
        const val = event.target.value;
        if (type === "number") {
            if (val.trim() !== "") {
                const numValue = parseFloat(val);
                const intValue = parseInt(val);
                const finalValue =
                    precision === undefined
                        ? numValue
                        : precision === 0
                          ? intValue
                          : parseFloat(numValue.toFixed(precision));
                if (onChange) onChange(finalValue, name, event);
            } else {
                if (onChange) onChange(null, name, event);
            }
        } else {
            if (onChange) onChange(val, name, event);
        }
    };

    const handleInput = (event: any) => {
        const val = event.target.value;
        if (type === "number") {
            if (val.trim() !== "") {
                if (onInput) onInput(parseFloat(val), name, event);
            } else {
                if (onInput) onInput(null, name, event);
            }
        } else {
            if (onInput) onInput(val, name, event);
        }
    };

    return (
        <input
            className={classNames("Input", !show && "hidden", className)}
            style={style}
            type={type}
            value={val}
            min={min}
            max={max}
            step={step}
            disabled={disabled}
            accept={accept}
            autoComplete={"off"}
            onFocus={handleFocus}
            onChange={handleChange}
            onInput={handleInput}
        />
    );
};

export default Input;
