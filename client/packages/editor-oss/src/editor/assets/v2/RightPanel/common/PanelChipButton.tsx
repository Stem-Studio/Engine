import type { ButtonHTMLAttributes } from "react";
import styled from "styled-components";

export type PanelChipButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  $selected?: boolean;
};

export const PanelChipButton = styled.button<PanelChipButtonProps>`
  min-height: 26px;
  border: 1px solid
    ${({ $selected }) =>
      $selected
        ? "var(--theme-font-main-selected-color)"
        : "var(--theme-container-divider)"};
  border-radius: 6px;
  background: ${({ $selected }) =>
    $selected ? "var(--theme-grey-bg-secondary-button)" : "transparent"};
  color: ${({ $selected }) =>
    $selected
      ? "var(--theme-font-main-selected-color)"
      : "var(--theme-font-unselected-color)"};
  cursor: pointer;
  font-size: var(--theme-font-size-extra-small);
  font-weight: var(--theme-font-regular);
  line-height: 1.2;
  padding: 4px 8px;
  text-transform: capitalize;

  &:focus-visible {
    outline: 2px solid var(--theme-font-main-selected-color);
    outline-offset: 2px;
  }
`;
