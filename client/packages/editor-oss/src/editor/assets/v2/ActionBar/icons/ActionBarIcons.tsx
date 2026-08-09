import type { ReactElement, ReactNode, SVGProps } from "react";

export type ActionBarIconProps = SVGProps<SVGSVGElement> & {
    size?: number | string;
};

export type ActionBarIconComponent = (
    props: ActionBarIconProps,
) => ReactElement;

const ActionBarSvgIcon = ({
    size = 20,
    children,
    ...props
}: ActionBarIconProps & { children: ReactNode }) => (
    <svg
        viewBox="0 0 20 20"
        width={size}
        height={size}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        {...props}
    >
        {children}
    </svg>
);

export const BrushIcon = (props: ActionBarIconProps) => (
    <ActionBarSvgIcon {...props}>
        <path d="M12.6 4.6L15.4 7.4" />
        <path d="M6.2 14.2L13.8 6.6C14.6 5.8 14.6 4.6 13.8 3.8C13 3 11.8 3 11 3.8L3.8 11" />
        <path d="M3.6 11.4C5.8 11.5 7.3 12.8 7.5 15.1C6.1 15.7 4.5 16 2.9 16.1C3 14.5 3.2 12.9 3.6 11.4Z" />
    </ActionBarSvgIcon>
);

export const HomeIcon = (props: ActionBarIconProps) => (
    <ActionBarSvgIcon {...props}>
        <path d="M3.5 9.4L10 4L16.5 9.4" />
        <path d="M5.4 8.5V16H14.6V8.5" />
        <path d="M8.2 16V11.5H11.8V16" />
    </ActionBarSvgIcon>
);

export const ToolsIcon = (props: ActionBarIconProps) => (
    <ActionBarSvgIcon {...props}>
        <path d="M12.5 4.2C13.6 3.7 14.9 3.9 15.8 4.8L13.6 7L15 8.4L17.2 6.2C17.7 7.3 17.5 8.6 16.6 9.5C15.7 10.4 14.4 10.6 13.3 10.1L8 15.4C7.3 16.1 6.2 16.1 5.5 15.4L4.6 14.5C3.9 13.8 3.9 12.7 4.6 12L9.9 6.7C9.4 5.7 9.6 4.9 10.3 4.2" />
        <path d="M4.2 4.6L7.2 7.6" />
        <path d="M3.4 6.2L5.8 3.8" />
    </ActionBarSvgIcon>
);

export const ChevronUpIcon = (props: ActionBarIconProps) => (
    <ActionBarSvgIcon {...props}>
        <path d="M5 12.2L10 7.2L15 12.2" />
    </ActionBarSvgIcon>
);

export const CloseIcon = (props: ActionBarIconProps) => (
    <ActionBarSvgIcon {...props}>
        <path d="M5.5 5.5L14.5 14.5" />
        <path d="M14.5 5.5L5.5 14.5" />
    </ActionBarSvgIcon>
);

export const MoveIcon = (props: ActionBarIconProps) => (
    <ActionBarSvgIcon {...props}>
        <path d="M10 3.5V16.5" />
        <path d="M7.8 5.7L10 3.5L12.2 5.7" />
        <path d="M7.8 14.3L10 16.5L12.2 14.3" />
        <path d="M3.5 10H16.5" />
        <path d="M5.7 7.8L3.5 10L5.7 12.2" />
        <path d="M14.3 7.8L16.5 10L14.3 12.2" />
    </ActionBarSvgIcon>
);

export const CubeIcon = (props: ActionBarIconProps) => (
    <ActionBarSvgIcon {...props}>
        <path d="M10 3.5L16 6.8V13.2L10 16.5L4 13.2V6.8L10 3.5Z" />
        <path d="M4.2 6.9L10 10.2L15.8 6.9" />
        <path d="M10 10.2V16.2" />
    </ActionBarSvgIcon>
);

export const PencilIcon = (props: ActionBarIconProps) => (
    <ActionBarSvgIcon {...props}>
        <path d="M4 13.7L3.5 16.5L6.3 16L15.7 6.6L13.4 4.3L4 13.7Z" />
        <path d="M12.2 5.5L14.5 7.8" />
    </ActionBarSvgIcon>
);

export const RefreshIcon = (props: ActionBarIconProps) => (
    <ActionBarSvgIcon {...props}>
        <path d="M15.4 7.1C14.5 5.3 12.6 4 10.4 4C7.9 4 5.8 5.6 5.1 7.9" />
        <path d="M15.5 4.6V7.1H13" />
        <path d="M4.6 12.9C5.5 14.7 7.4 16 9.6 16C12.1 16 14.2 14.4 14.9 12.1" />
        <path d="M4.5 15.4V12.9H7" />
    </ActionBarSvgIcon>
);

export const ScaleIcon = (props: ActionBarIconProps) => (
    <ActionBarSvgIcon {...props}>
        <path d="M5 15L15 5" />
        <path d="M11.5 5H15V8.5" />
        <path d="M8.5 15H5V11.5" />
        <path d="M5 5H8" />
        <path d="M5 5V8" />
        <path d="M15 15H12" />
        <path d="M15 15V12" />
    </ActionBarSvgIcon>
);

export const ViewGridIcon = (props: ActionBarIconProps) => (
    <ActionBarSvgIcon {...props}>
        <rect x="4" y="4" width="4.5" height="4.5" rx="0.7" />
        <rect x="11.5" y="4" width="4.5" height="4.5" rx="0.7" />
        <rect x="4" y="11.5" width="4.5" height="4.5" rx="0.7" />
        <rect x="11.5" y="11.5" width="4.5" height="4.5" rx="0.7" />
    </ActionBarSvgIcon>
);
