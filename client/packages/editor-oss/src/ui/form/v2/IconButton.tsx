import "../css/IconButton.css";
import classNames from "classnames";

interface Props {
    className?: string;
    style?: any;
    icon?: string;
    name?: string;
    title?: string;
    show?: boolean;
    selected?: boolean;
    disabled?: boolean;
    onClick?: (name: string | undefined, event: any) => void;
}

const IconButton = ({
    className,
    style,
    icon,
    name,
    title,
    show = true,
    selected = false,
    disabled = false,
    onClick,
}: Props) => {
    const handleClick = (event: any) => {
        if (!disabled && onClick) onClick(name, event);
    };

    return (
        <button
            className={classNames(
                "IconButton",
                selected && "selected",
                !show && "hidden",
                disabled && "disabled",
                className,
            )}
            style={style}
            title={title}
            onClick={handleClick}
        >
            <i className={classNames("iconfont", icon && "icon-" + icon)} />
        </button>
    );
};

export default IconButton;
