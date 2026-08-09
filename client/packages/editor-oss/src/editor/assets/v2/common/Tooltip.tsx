import React, {useCallback, useRef, useState, useEffect} from "react";
import {createPortal} from "react-dom";
import styled from "styled-components";

import {flexCenter} from "../../../../assets/style";
import questionMarkIcon from "../icons/question-mark.svg";

const Wrapper = styled.div<{
    $width?: string;
    $height?: string;
    $triggerWidth?: string;
    $triggerHeight?: string;
    $padding?: string;
    $background?: string;
    $fullWidth?: boolean;
}>`
    position: relative;
    cursor: pointer;
    display: ${({$fullWidth}) => ($fullWidth ? "block" : "inline-block")};
    ${({$fullWidth}) => ($fullWidth ? "width: 100%;" : "")};
    width: ${({$triggerWidth}) => $triggerWidth || "auto"};
    height: ${({$triggerHeight, $height}) => ($triggerHeight ? `${$triggerHeight}` : $height ? `${$height}` : "24px")};
`;

const TooltipBox = styled.div<{
    $width?: string;
    $height?: string;
    $padding?: string;
    $background?: string;
    $show?: boolean;
    $isRichContent?: boolean;
}>`
    text-align: center;
    z-index: 999999;
    position: fixed;
    ${flexCenter};
    align-items: center;
    border-radius: 8px;
    font-size: var(--theme-font-size-extra-small);
    padding: ${({$padding, $isRichContent}) => $padding || ($isRichContent ? "12px 16px" : "6px 10px")};
    background: ${({$background}) => $background || "var(--theme-grey-bg)"};
    color: white;
    ${({$width}) => $width && `width: ${$width};`};
    ${({$height}) => $height && `height: ${$height};`};
    opacity: ${({$show}) => ($show ? 1 : 0)};
    transform: ${({$show}) => ($show ? "translateY(0) scale(1)" : "translateY(8px) scale(0.95)")};
    transition:
        opacity 0.2s cubic-bezier(0.4, 0, 0.2, 1),
        transform 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    pointer-events: ${({$show, $isRichContent}) => {
        // Only allow pointer events for rich interactive content when visible
        if (!$show) return "none";
        return $isRichContent ? "auto" : "none";
    }};
    box-shadow: 0px 4px 15px rgba(0, 0, 0, 0.3);
    max-width: ${({$isRichContent}) => ($isRichContent ? "400px" : "300px")};
    word-wrap: break-word;
    white-space: ${({$isRichContent}) => ($isRichContent ? "normal" : "pre-wrap")};
    text-align: ${({$isRichContent}) => ($isRichContent ? "left" : "center")};

    /* Arrow pointing down (when tooltip is above) */
    &::after {
        content: "";
        position: absolute;
        top: 100%;
        left: 50%;
        transform: translateX(-50%);
        width: 0;
        height: 0;
        border-left: 6px solid transparent;
        border-right: 6px solid transparent;
        border-top: 6px solid ${({$background}) => $background || "var(--theme-grey-bg)"};
        /* Ensure arrow doesn't interfere with hover */
        pointer-events: none;
    }

    /* Arrow pointing up (when tooltip is below) */
    &.below::after {
        top: -6px;
        border-top: none;
        border-bottom: 6px solid ${({$background}) => $background || "var(--theme-grey-bg)"};
        /* Ensure arrow doesn't interfere with hover */
        pointer-events: none;
    }

    /* No arrow for left-of placement */
    &.left-of::after {
        display: none;
    }
`;

// Error boundary for rich content
class TooltipErrorBoundary extends React.Component<
    {children: React.ReactNode; fallback?: React.ReactNode},
    {hasError: boolean}
> {
    constructor(props: {children: React.ReactNode; fallback?: React.ReactNode}) {
        super(props);
        this.state = {hasError: false};
    }

    static getDerivedStateFromError() {
        return {hasError: true};
    }

    componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
        console.warn("Tooltip rich content error:", error, errorInfo);
    }

    render() {
        if (this.state.hasError) {
            return this.props.fallback || <div>Error loading tooltip content</div>;
        }

        return this.props.children;
    }
}

type Props = {
    // Backward compatible text API
    text?: string;

    // New rich content API
    content?: React.ReactNode;

    // Shared props
    width?: string;
    height?: string;
    padding?: string;
    background?: string;
    delay?: number; // Delay before showing tooltip in ms
    children?: React.ReactNode; // Custom trigger content
    id?: string; // For accessibility
    triggerWidth?: string;
    triggerHeight?: string;

    // Mobile touch options
    touchBehavior?: "hover" | "tap" | "longPress" | "disabled"; // How tooltip behaves on mobile
    longPressDelay?: number; // Long press duration for mobile
    autoHideDelay?: number; // Auto-hide after this time on mobile (0 = disabled)

    // Rich content options
    stayOpenOnHover?: boolean; // Keep tooltip open when hovering over it (for interactive content)
    maxWidth?: string; // Override max width for rich content
    errorFallback?: React.ReactNode; // Custom error fallback for rich content
    // Custom placement options
    placement?: "auto" | "left-of-anchor"; // Position strategy
    anchorRef?: React.RefObject<HTMLElement | null>; // Anchor element used for custom placement
    // Trigger layout options
    triggerFullWidth?: boolean; // Make trigger wrapper span full width
    // Position adjustments
    offsetX?: number; // Horizontal offset in pixels (applied to computed left)
    offsetY?: number; // Vertical offset in pixels (applied to computed top)
};

export const Tooltip = ({
    text,
    content,
    width,
    height,
    padding,
    background,
    delay = 300,
    children,
    id,
    triggerWidth,
    triggerHeight,
    touchBehavior = "hover", // Default to hover behavior
    longPressDelay = 500,
    autoHideDelay = 3000,
    stayOpenOnHover = false,
    maxWidth,
    errorFallback,
    placement = "auto",
    anchorRef,
    triggerFullWidth = false,
    offsetX,
    offsetY = 0,
}: Props) => {
    const triggerRef = useRef<HTMLDivElement>(null);
    const tooltipRef = useRef<HTMLDivElement>(null);
    const showTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const hideTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const longPressTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const autoHideTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    const [visible, setVisible] = useState(false);
    const [shouldRender, setShouldRender] = useState(false);
    const [isMobile, setIsMobile] = useState(false);
    const [touchStartTime, setTouchStartTime] = useState<number>(0);
    const [position, setPosition] = useState<{
        top: number;
        left: number;
        isBelow: boolean;
    }>({top: 0, left: 0, isBelow: false});

    // Determine if we have rich content
    const hasRichContent = content !== undefined;
    const tooltipContent = hasRichContent ? content : text;
    const shouldStayOpenOnHover = hasRichContent && stayOpenOnHover;

    // Detect mobile device
    useEffect(() => {
        const checkMobile = () => {
            const isMobileDevice =
                /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
                "ontouchstart" in window ||
                window.innerWidth <= 768;
            setIsMobile(isMobileDevice);
        };

        checkMobile();
        window.addEventListener("resize", checkMobile);

        return () => window.removeEventListener("resize", checkMobile);
    }, []);

    // Helper function to safely parse dimensions
    const parseDimension = (dimension: string | undefined, fallback: number): number => {
        if (!dimension) return fallback;
        const parsed = parseInt(dimension.replace(/px|em|rem|%/, ""), 10);
        return isNaN(parsed) ? fallback : parsed;
    };

    const calculatePosition = useCallback(
        (actualTooltipWidth?: number, actualTooltipHeight?: number) => {
            const trigger = triggerRef.current;
            if (!trigger) return {top: 0, left: 0, isBelow: false};

            const triggerRect = trigger.getBoundingClientRect();
            // Use actual measured width if available, otherwise estimate
            const tooltipWidth = actualTooltipWidth ?? parseDimension(maxWidth || width, hasRichContent ? 400 : 300);
            const tooltipHeight = actualTooltipHeight ?? parseDimension(height, hasRichContent ? 88 : 40);

            const viewportWidth = window.innerWidth;
            const viewportHeight = window.innerHeight;
            const scrollX = window.scrollX;
            const scrollY = window.scrollY;

            // Mobile-specific adjustments
            const mobileOffset = isMobile ? 12 : 8; // Extra space on mobile
            const viewportPadding = isMobile ? 16 : 8; // More padding on mobile

            // Minimum gap to prevent hover interference (critical for smooth hover behavior)
            const minGap = Math.max(mobileOffset, 10);

            // If asked to position to the left of an anchor element, do so
            if (placement === "left-of-anchor" && anchorRef?.current) {
                const anchorRect = anchorRef.current.getBoundingClientRect();
                // Place tooltip flush to the left of the anchor (panel), edge-to-edge
                const xOff = typeof offsetX === "number" ? offsetX : 0;
                const left = anchorRect.left + scrollX - tooltipWidth + xOff;
                // Vertically align with the trigger element so it relates to the hovered control
                let top = triggerRect.top + scrollY + triggerRect.height / 2 - tooltipHeight / 2;
                // Clamp top to viewport bounds with padding
                const viewportPaddingTop = viewportPadding;
                const maxTop = viewportHeight - tooltipHeight - viewportPaddingTop + scrollY;
                if (top < scrollY + viewportPaddingTop) top = scrollY + viewportPaddingTop;
                if (top > maxTop) top = maxTop;
                return {top: top + offsetY, left: Math.max(viewportPadding, left), isBelow: false};
            }

            // Default horizontal position (auto): center on trigger
            let left = triggerRect.left + scrollX + triggerRect.width / 2 - tooltipWidth / 2;

            // Clamp horizontal position to viewport
            if (left < viewportPadding) {
                left = viewportPadding;
            } else if (left + tooltipWidth > viewportWidth - viewportPadding) {
                left = viewportWidth - tooltipWidth - viewportPadding;
            }

            // Calculate vertical position - prefer above
            let top = triggerRect.top + scrollY - tooltipHeight - minGap;
            let isBelow = false;

            // If not enough space above, show below
            const requiredSpaceAbove = isMobile ? tooltipHeight + 40 : tooltipHeight + 20;
            if (triggerRect.top < requiredSpaceAbove) {
                top = triggerRect.bottom + scrollY + minGap;
                isBelow = true;
            }

            // If still not enough space below, force above
            const requiredSpaceBelow = isMobile ? tooltipHeight + 40 : tooltipHeight + 20;
            if (isBelow && triggerRect.bottom + requiredSpaceBelow > viewportHeight) {
                top = triggerRect.top + scrollY - tooltipHeight - minGap;
                isBelow = false;
            }

            return {top: top + offsetY, left, isBelow};
        },
        [width, height, maxWidth, hasRichContent, isMobile, placement, anchorRef, offsetY],
    );

    const show = useCallback(() => {
        // Clear any existing timeouts
        [showTimeoutRef, hideTimeoutRef, longPressTimeoutRef, autoHideTimeoutRef].forEach(ref => {
            if (ref.current) clearTimeout(ref.current);
        });

        // Mobile-optimized delay
        const showDelay = isMobile ? Math.min(delay, 150) : delay;

        showTimeoutRef.current = setTimeout(() => {
            const pos = calculatePosition();
            setPosition(pos);
            setShouldRender(true);

            requestAnimationFrame(() => {
                // Measure actual tooltip size and recalculate position if needed
                const tooltip = tooltipRef.current;
                if (tooltip) {
                    const {width: actualWidth, height: actualHeight} = tooltip.getBoundingClientRect();
                    const adjustedPos = calculatePosition(actualWidth, actualHeight);
                    setPosition(adjustedPos);
                }

                setVisible(true);

                // Auto-hide on mobile after delay (but not for interactive rich content)
                if (isMobile && autoHideDelay > 0 && !shouldStayOpenOnHover) {
                    autoHideTimeoutRef.current = setTimeout(() => {
                        hide();
                    }, autoHideDelay);
                }
            });
        }, showDelay);
    }, [calculatePosition, delay, isMobile, autoHideDelay, shouldStayOpenOnHover]);

    const hide = useCallback((deferred = false) => {
        // Clear all timeouts
        [showTimeoutRef, longPressTimeoutRef, autoHideTimeoutRef].forEach(ref => {
            if (ref.current) clearTimeout(ref.current);
        });

        if (hideTimeoutRef.current) {
            clearTimeout(hideTimeoutRef.current);
        }

        const performHide = () => {
            setVisible(false);
            hideTimeoutRef.current = setTimeout(() => setShouldRender(false), 200);
        };

        if (deferred) {
            hideTimeoutRef.current = setTimeout(performHide, 120);
            return;
        }

        performHide();
    }, []);

    // Mouse event handlers (for desktop)
    const handleMouseEnter = useCallback(() => {
        if (isMobile && touchBehavior !== "hover") return;
        if (hideTimeoutRef.current) {
            clearTimeout(hideTimeoutRef.current);
        }
        show();
    }, [show, isMobile, touchBehavior]);

    const handleMouseLeave = useCallback(() => {
        if (isMobile && touchBehavior !== "hover") return;
        hide(shouldStayOpenOnHover);
    }, [hide, isMobile, touchBehavior, shouldStayOpenOnHover]);

    // Rich content hover handlers
    const handleTooltipMouseEnter = useCallback(() => {
        if (!shouldStayOpenOnHover) return;
        // Clear hide timeout when hovering over interactive tooltip
        if (hideTimeoutRef.current) {
            clearTimeout(hideTimeoutRef.current);
        }
        setVisible(true);
    }, [shouldStayOpenOnHover]);

    const handleTooltipMouseLeave = useCallback(() => {
        if (!shouldStayOpenOnHover) return;
        hide();
    }, [hide, shouldStayOpenOnHover]);

    // Touch event handlers (for mobile)
    const handleTouchStart = useCallback(
        (e: React.TouchEvent) => {
            if (!isMobile || touchBehavior === "disabled" || touchBehavior === "hover") return;

            e.preventDefault(); // Prevent mouse events from firing
            setTouchStartTime(Date.now());

            if (touchBehavior === "longPress") {
                longPressTimeoutRef.current = setTimeout(() => {
                    show();
                }, longPressDelay);
            }
        },
        [isMobile, touchBehavior, longPressDelay, show],
    );

    const handleTouchEnd = useCallback(
        (e: React.TouchEvent) => {
            if (!isMobile || touchBehavior === "disabled" || touchBehavior === "hover") return;

            e.preventDefault();
            const touchDuration = Date.now() - touchStartTime;

            if (touchBehavior === "tap" && touchDuration < 300) {
                // Quick tap - toggle tooltip
                if (visible) {
                    hide();
                } else {
                    show();
                }
            } else if (touchBehavior === "longPress") {
                // Clear long press timeout if touch ended early
                if (longPressTimeoutRef.current) {
                    clearTimeout(longPressTimeoutRef.current);
                }
            }
        },
        [isMobile, touchBehavior, touchStartTime, visible, show, hide],
    );

    const handleTouchCancel = useCallback(() => {
        if (longPressTimeoutRef.current) {
            clearTimeout(longPressTimeoutRef.current);
        }
    }, []);

    // Clean up timeouts on unmount
    useEffect(() => {
        return () => {
            [showTimeoutRef, hideTimeoutRef, longPressTimeoutRef, autoHideTimeoutRef].forEach(ref => {
                if (ref.current) clearTimeout(ref.current);
            });
        };
    }, []);

    // Reset tooltip state when content is dynamically removed
    useEffect(() => {
        if (!tooltipContent) {
            setVisible(false);
            setShouldRender(false);
            [showTimeoutRef, hideTimeoutRef, longPressTimeoutRef, autoHideTimeoutRef].forEach(ref => {
                if (ref.current) clearTimeout(ref.current);
            });
        }
    }, [!tooltipContent]);

    // Don't render if no content provided
    if (!tooltipContent) {
        return children ? <>{children}</> : null;
    }

    const tooltipId = id || `tooltip-${Math.random().toString(36).substr(2, 9)}`;

    return (
        <>
            <Wrapper
                ref={triggerRef}
                $width={width}
                $height={height}
                $triggerWidth={triggerWidth}
                $triggerHeight={triggerHeight}
                $padding={padding}
                $background={background}
                $fullWidth={triggerFullWidth}
                onMouseEnter={handleMouseEnter}
                onMouseLeave={handleMouseLeave}
                onTouchStart={handleTouchStart}
                onTouchEnd={handleTouchEnd}
                onTouchCancel={handleTouchCancel}
                aria-describedby={visible ? tooltipId : undefined}
                aria-label={typeof text === "string" ? text : undefined}
                role="button"
                tabIndex={0}
                onFocus={handleMouseEnter}
                onBlur={handleMouseLeave}
            >
                {children || (
                    <img
                        src={questionMarkIcon}
                        className="infoIcon-tooltip"
                        alt="Help"
                    />
                )}
            </Wrapper>

            {shouldRender &&
                createPortal(
                    <TooltipBox
                        ref={tooltipRef}
                        id={tooltipId}
                        role="tooltip"
                        className={`${position.isBelow ? "below" : ""} ${placement === "left-of-anchor" ? "left-of" : ""}`}
                        $width={maxWidth || width}
                        $height={height}
                        $padding={padding}
                        $background={background}
                        $show={visible}
                        $isRichContent={hasRichContent}
                        style={{
                            top: position.top,
                            left: position.left,
                        }}
                        aria-hidden={!visible}
                        onMouseEnter={handleTooltipMouseEnter}
                        onMouseLeave={handleTooltipMouseLeave}
                    >
                        {hasRichContent ? (
                            <TooltipErrorBoundary fallback={errorFallback}>{tooltipContent}</TooltipErrorBoundary>
                        ) : (
                            tooltipContent
                        )}
                    </TooltipBox>,
                    document.body,
                )}
        </>
    );
};
