import "./css/Icon.css";
import classNames from "classnames";

interface Props {
    className?: string;
    style?: any;
    name?: string;
    value?: string;
    icon?: string;
    title?: string;
    color?: string;
    onClick?: (name: string | null, event: any) => void;
}

const Icon = ({className, style, icon, title, onClick, color}: Props) => {
    const handleClick = (event: any) => {
        const name = event.currentTarget.getAttribute("name");
        if (onClick) onClick(name, event);
    };

    return (
        <i
            className={classNames("Icon", "iconfont", icon && "icon-" + icon, className)}
            style={style}
            title={title}
            onClick={handleClick}
            color={color}
        />
    );
};

export default Icon;
