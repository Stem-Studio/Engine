import styled, { css } from "styled-components";

export const builderToolbarTokens = {
  focusRing: "#93c5fd",
  borderSubtle: "rgba(255, 255, 255, 0.12)",
  borderMuted: "rgba(255, 255, 255, 0.1)",
  borderDisabled: "rgba(255, 255, 255, 0.08)",
  surfaceSubtle: "rgba(255, 255, 255, 0.04)",
  surfaceHover: "rgba(255, 255, 255, 0.09)",
  surfaceSelected: "rgba(255, 255, 255, 0.08)",
  surfaceDisabled: "rgba(255, 255, 255, 0.02)",
  shortcutSurface: "rgba(0, 0, 0, 0.25)",
  shadow: "rgba(0, 0, 0, 0.3)",
  shadowStrong: "rgba(0, 0, 0, 0.38)",
  textPrimary: "#f8fafc",
  textSecondary: "#e5e7eb",
  textMuted: "#cbd5e1",
  textDisabled: "rgba(255, 255, 255, 0.27)",
  textOption: "#111827",
  accentGold: "#d5b867",
  accentGoldBorder: "rgba(213, 184, 103, 0.4)",
  accentGoldBorderStrong: "rgba(213, 184, 103, 0.5)",
  accentGoldSurface: "rgba(213, 184, 103, 0.1)",
  accentGoldSurfaceStrong: "rgba(213, 184, 103, 0.12)",
  accentGoldText: "#f8d66d",
  accentGoldTextSoft: "#f8e7a1",
  accentPlan: "#69a297",
  accentPlanBorder: "rgba(105, 162, 151, 0.4)",
  accentPlanBorderStrong: "rgba(105, 162, 151, 0.5)",
  accentPlanSurface: "rgba(105, 162, 151, 0.09)",
  accentPlanText: "#cdeee8",
  accentSteel: "#8ea5b5",
  accentSteelBorder: "rgba(142, 165, 181, 0.5)",
  accentSteelSurface: "rgba(142, 165, 181, 0.1)",
  accentSteelText: "#c8d7e0",
  error: "#ef4444",
  errorBorder: "rgba(239, 68, 68, 0.5)",
  errorSurface: "rgba(239, 68, 68, 0.08)",
  errorText: "#fca5a5",
  activeFallback: "#38bdf8",
  darkCheckboard: "#111827",
  measurementSurface: "rgba(15, 23, 42, 0.8)",
} as const;

export const builderToolbarToolColors = {
  shared: {
    select: builderToolbarTokens.accentGold,
    erase: builderToolbarTokens.error,
    validPreview: "#7dd3fc",
    invalidPreview: builderToolbarTokens.error,
  },
  quickBuild: {
    ground: "#4f8f3a",
    sand: "#d9bd78",
    stone: "#9aa0a6",
    path: "#caa66a",
    water: "#2f8fcf",
    bridge: "#8b5e34",
    farm: "#8b5a2b",
    fence: "#8a5a33",
    tree: "#3f8f45",
    bush: "#4f9b59",
    rock: "#8b8f92",
    house: "#9e3f35",
    lamp: "#facc15",
    street: "#64748b",
    cobble: "#a8a29e",
    hedge: "#3f7f45",
    flowering: "#f472b6",
    cabin: "#8b5a2b",
    townhouse: "#c45f4f",
  },
  planCad: {
    wall: builderToolbarTokens.textSecondary,
    room: "#b9b09d",
    zone: builderToolbarTokens.accentPlan,
    door: "#9b6a3f",
    window: "#96c9e8",
    part: builderToolbarTokens.accentSteel,
  },
} as const;

export const focusVisibleRing = css`
  &:focus-visible {
    outline: 2px solid ${builderToolbarTokens.focusRing};
    outline-offset: 2px;
  }
`;

export const BuilderToolbar = styled.div<{
  $maxWidth?: string;
  $mobileBreakpoint?: string;
}>`
  position: absolute;
  z-index: 101;
  bottom: 78px;
  left: 50%;
  transform: translateX(-50%);
  width: auto;
  max-width: ${({ $maxWidth }) =>
    $maxWidth ?? "min(840px, calc(100vw - 560px))"};
  min-height: 58px;
  height: auto;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 12px;
  border: 1px solid ${builderToolbarTokens.borderMuted};
  background: var(--theme-container-minor-dark);
  color: white;
  pointer-events: all;
  box-shadow: 0 10px 28px ${builderToolbarTokens.shadow};
  overflow: visible;

  @media (max-width: 1180px) {
    max-width: calc(100vw - 32px);
  }

  @media (max-width: ${({ $mobileBreakpoint }) =>
      $mobileBreakpoint ?? "760px"}) {
    width: calc(100vw - 16px);
    justify-content: flex-start;
  }
`;

export const BuilderModeLabel = styled.div<{ $width?: string }>`
  width: ${({ $width }) => $width ?? "74px"};
  flex: 0 0 ${({ $width }) => $width ?? "74px"};
  font-size: 12px;
  font-weight: 700;
  line-height: 1;
  color: ${builderToolbarTokens.textSecondary};
  white-space: nowrap;
`;

export const BuilderToolsCluster = styled.div<{ $columns?: string }>`
  display: grid;
  grid-template-columns: ${({ $columns }) =>
    $columns ?? "repeat(2, 54px) repeat(4, 92px)"};
  grid-auto-rows: 40px;
  gap: 6px;
  flex: 0 0 auto;
`;

export const BuilderToolButton = styled.button<{
  $selected: boolean;
  $color: string;
}>`
  position: relative;
  width: 54px;
  height: 40px;
  border: 1px solid
    ${({ $selected, $color }) =>
      $selected ? $color : builderToolbarTokens.borderSubtle};
  border-radius: 8px;
  background: ${({ $selected }) =>
    $selected ? builderToolbarTokens.surfaceSelected : "transparent"};
  color: ${({ $selected, $color }) =>
    $selected ? $color : builderToolbarTokens.textPrimary};
  display: grid;
  grid-template-rows: 18px 11px;
  place-items: center;
  align-content: center;
  gap: 1px;
  cursor: pointer;
  padding: 0;

  &:hover {
    background: ${builderToolbarTokens.surfaceHover};
    border-color: ${({ $color }) => $color};
  }

  ${focusVisibleRing}
`;

export const BuilderToolLabel = styled.span<{ $maxWidth?: string }>`
  max-width: ${({ $maxWidth }) => $maxWidth ?? "46px"};
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 9px;
  font-weight: 800;
  line-height: 1;
`;

export const BuilderToolMenuGroup = styled.div<{ $width?: string }>`
  position: relative;
  width: ${({ $width }) => $width ?? "92px"};
  height: 40px;
`;

export const BuilderToolGroupButton = styled.button<{
  $selected: boolean;
  $color: string;
  $width?: string;
  $labelMaxWidth?: string;
}>`
  position: relative;
  width: ${({ $width }) => $width ?? "92px"};
  height: 40px;
  border: 1px solid
    ${({ $selected, $color }) =>
      $selected ? $color : builderToolbarTokens.borderSubtle};
  border-radius: 8px;
  background: ${({ $selected }) =>
    $selected ? builderToolbarTokens.surfaceSelected : "transparent"};
  color: ${({ $selected, $color }) =>
    $selected ? $color : builderToolbarTokens.textPrimary};
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr) 12px;
  align-items: center;
  gap: 3px;
  cursor: pointer;
  padding: 0 5px 0 7px;

  ${BuilderToolLabel} {
    max-width: ${({ $labelMaxWidth }) => $labelMaxWidth ?? "52px"};
  }

  &:hover {
    background: ${builderToolbarTokens.surfaceHover};
    border-color: ${({ $color }) => $color};
  }

  ${focusVisibleRing}
`;

export const BuilderToolMenuChevron = styled.span<{ $open: boolean }>`
  display: grid;
  place-items: center;
  opacity: 0.72;
  transform: ${({ $open }) => ($open ? "rotate(180deg)" : "rotate(0deg)")};
  transition: transform 120ms ease;
`;

export const BuilderToolMenuSheet = styled.div<{ $open: boolean }>`
  position: absolute;
  left: 50%;
  bottom: calc(100% + 8px);
  transform: translateX(-50%)
    translateY(${({ $open }) => ($open ? "0" : "4px")});
  width: 184px;
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  border: 1px solid ${builderToolbarTokens.borderMuted};
  border-radius: 10px;
  background: var(--theme-container-minor-dark);
  box-shadow: 0 18px 42px ${builderToolbarTokens.shadowStrong};
  opacity: ${({ $open }) => ($open ? 1 : 0)};
  pointer-events: ${({ $open }) => ($open ? "auto" : "none")};
  transition:
    opacity 120ms ease,
    transform 120ms ease;
  z-index: 4;
`;

export const BuilderToolMenuItem = styled.button<{
  $selected: boolean;
  $color: string;
}>`
  width: 100%;
  min-height: 34px;
  display: grid;
  grid-template-columns: 24px minmax(0, 1fr);
  align-items: center;
  gap: 8px;
  border: 1px solid
    ${({ $selected, $color }) => ($selected ? $color : "transparent")};
  border-radius: 8px;
  background: ${({ $selected }) =>
    $selected ? builderToolbarTokens.surfaceSelected : "transparent"};
  color: ${builderToolbarTokens.textPrimary};
  cursor: pointer;
  padding: 4px 7px;
  text-align: left;

  &:hover {
    background: ${builderToolbarTokens.surfaceHover};
    border-color: ${({ $color }) => $color};
  }

  ${focusVisibleRing}
`;

export const BuilderToolMenuIcon = styled.span<{ $color: string }>`
  width: 24px;
  height: 24px;
  display: grid;
  place-items: center;
  border-radius: 7px;
  color: ${({ $color }) => $color};
  background: ${builderToolbarTokens.surfaceSubtle};
`;

export const BuilderToolMenuText = styled.span`
  min-width: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 22px;
  align-items: center;
  gap: 8px;
`;

export const BuilderToolMenuLabel = styled.span`
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  font-weight: 800;
  line-height: 1.1;
`;

export const BuilderToolMenuShortcut = styled.span<{ $empty?: boolean }>`
  min-width: 22px;
  height: 18px;
  display: grid;
  place-items: center;
  border-radius: 5px;
  background: ${({ $empty }) =>
    $empty ? "transparent" : builderToolbarTokens.shortcutSurface};
  color: ${({ $empty }) =>
    $empty ? "transparent" : builderToolbarTokens.textMuted};
  font-size: 10px;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
`;

export const BuilderSwatch = styled.span<{ $color: string }>`
  position: absolute;
  right: 5px;
  bottom: 5px;
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: ${({ $color }) => $color};
  box-shadow: 0 0 0 1px ${builderToolbarTokens.shortcutSurface};
`;

export const BuilderPanelDivider = styled.span`
  width: 1px;
  height: 28px;
  background: ${builderToolbarTokens.borderMuted};
  flex: 0 0 auto;
`;

export const BuilderAnchorPill = styled.div<{ $width?: string }>`
  width: ${({ $width }) => $width ?? "68px"};
  height: 34px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid ${builderToolbarTokens.accentGoldBorder};
  border-radius: 8px;
  background: ${builderToolbarTokens.accentGoldSurface};
  color: ${builderToolbarTokens.accentGoldText};
  font-size: 10px;
  font-weight: 800;
  line-height: 1;
  white-space: nowrap;
`;
