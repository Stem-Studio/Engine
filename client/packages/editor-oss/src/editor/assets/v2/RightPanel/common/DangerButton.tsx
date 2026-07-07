import type { ButtonHTMLAttributes } from "react";
import styled from "styled-components";

export type DangerButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  $confirm?: boolean;
};

export const DangerButton = styled.button<DangerButtonProps>`
  width: 100%;
  min-height: 32px;
  border: 1px solid color-mix(in srgb, var(--theme-font-red) 55%, transparent);
  border-radius: 6px;
  background: ${({ $confirm }) =>
    $confirm
      ? "color-mix(in srgb, var(--theme-font-red) 28%, transparent)"
      : "color-mix(in srgb, var(--theme-font-red) 12%, transparent)"};
  color: ${({ $confirm }) =>
    $confirm
      ? "var(--theme-font-main-selected-color)"
      : "var(--theme-font-red)"};
  cursor: pointer;
  font-size: var(--theme-font-size-s, 12px);
  font-weight: var(--theme-font-bold, 700);
  line-height: 1.2;
  padding: 6px 10px;

  &:disabled {
    cursor: not-allowed;
    opacity: 0.55;
  }

  &:focus-visible {
    outline: 2px solid var(--theme-font-red);
    outline-offset: 2px;
  }
`;
