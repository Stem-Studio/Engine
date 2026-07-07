import type { SVGProps } from "react";

const MeshToolIcon = (props: SVGProps<SVGSVGElement>) => (
    <svg
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        {...props}
    />
);

export const VertexSelectIcon = () => (
    <MeshToolIcon>
        <path d="M5 14L10 5.5L15 14" />
        <path d="M5 14H15" />
        <circle
            cx="10"
            cy="5.5"
            r="1.8"
            fill="currentColor"
            stroke="none"
        />
        <circle
            cx="5"
            cy="14"
            r="1.3"
        />
        <circle
            cx="15"
            cy="14"
            r="1.3"
        />
    </MeshToolIcon>
);

export const EdgeSelectIcon = () => (
    <MeshToolIcon>
        <path d="M4.5 6.5L15.5 6.5L13.5 13.5L6.5 13.5Z" />
        <path d="M4.5 6.5L6.5 13.5" />
        <path d="M15.5 6.5L13.5 13.5" />
        <path
            d="M4.5 6.5L15.5 6.5"
            strokeWidth="2.6"
        />
    </MeshToolIcon>
);

export const FaceSelectIcon = () => (
    <MeshToolIcon>
        <path d="M4.5 6.5L15.5 6.5L13.5 13.5L6.5 13.5Z" />
        <path d="M4.5 6.5L6.5 13.5" />
        <path d="M15.5 6.5L13.5 13.5" />
        <path
            d="M6.2 8.1H13.8L12.6 11.9H7.4Z"
            fill="currentColor"
            fillOpacity="0.3"
            stroke="none"
        />
    </MeshToolIcon>
);

export const LassoSelectIcon = () => (
    <MeshToolIcon>
        <path d="M4.5 10.5C4.7 7.1 7.4 5 10.4 5C13.4 5 15.8 6.7 15.8 9.4C15.8 12.2 13.4 14 9.9 14C7.4 14 5.8 13.2 5.2 12.1" />
        <path d="M5 12.1L3.8 14.8L6.9 14.3" />
        <circle
            cx="8"
            cy="9.3"
            r="1"
            fill="currentColor"
            stroke="none"
        />
        <circle
            cx="12.1"
            cy="10.8"
            r="1"
            fill="currentColor"
            stroke="none"
        />
    </MeshToolIcon>
);

export const ExtrudeIcon = () => (
    <MeshToolIcon>
        <path d="M5.5 12.8H14.5V16H5.5Z" />
        <path
            d="M7 10.2H13V12.8H7Z"
            fill="currentColor"
            fillOpacity="0.2"
        />
        <path d="M10 12.3V4.5" />
        <path d="M7.7 6.8L10 4.5L12.3 6.8" />
    </MeshToolIcon>
);

export const InsetIcon = () => (
    <MeshToolIcon>
        <rect
            x="4.5"
            y="4.5"
            width="11"
            height="11"
            rx="0.5"
        />
        <rect
            x="7.3"
            y="7.3"
            width="5.4"
            height="5.4"
            rx="0.5"
        />
        <path d="M10 4.7V2.9" />
        <path d="M10 17.1V15.3" />
        <path d="M4.7 10H2.9" />
        <path d="M17.1 10H15.3" />
    </MeshToolIcon>
);

export const BevelIcon = () => (
    <MeshToolIcon>
        <path d="M5 5H12.2L15 7.8V15H5Z" />
        <path d="M12.2 5V7.8H15" />
        <path d="M8 12L12 8" />
        <path d="M7 14H10.2L14 10.2V7" />
    </MeshToolIcon>
);

export const ApplyCheckIcon = () => (
    <MeshToolIcon>
        <path d="M4.5 10.5L8.5 14.5L15.5 5.5" />
    </MeshToolIcon>
);

export const RulerIcon = () => (
    <MeshToolIcon>
        <path d="M3 10H17" />
        <path d="M3 8V12" />
        <path d="M17 8V12" />
        <path d="M10 8.5V10" />
        <path d="M6.5 9V10" />
        <path d="M13.5 9V10" />
    </MeshToolIcon>
);

export const AxisIcon = () => (
    <MeshToolIcon>
        <path d="M10 10H16.5" />
        <path d="M14.5 8L16.5 10L14.5 12" />
        <path d="M10 10V3.5" />
        <path d="M8 5.5L10 3.5L12 5.5" />
        <path d="M10 10L5.5 14.5" />
        <path d="M5.8 12.2L5.5 14.5L7.8 14.2" />
    </MeshToolIcon>
);

export const FlatProfileIcon = () => (
    <MeshToolIcon>
        <circle cx="5" cy="10" r="1.5" fill="currentColor" stroke="none" />
        <circle cx="15" cy="10" r="1.5" fill="currentColor" stroke="none" />
        <path d="M6.5 10H13.5" />
    </MeshToolIcon>
);

export const RoundProfileIcon = () => (
    <MeshToolIcon>
        <circle cx="5" cy="13" r="1.5" fill="currentColor" stroke="none" />
        <circle cx="15" cy="13" r="1.5" fill="currentColor" stroke="none" />
        <path d="M5 13C5 6 15 6 15 13" />
    </MeshToolIcon>
);
