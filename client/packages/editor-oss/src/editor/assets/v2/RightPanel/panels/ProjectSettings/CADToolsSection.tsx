import React from "react";

import {PanelCheckbox} from "../../common/PanelCheckbox";

export interface CADToolsSectionProps {
    enabled: boolean;
    onChange: (enabled: boolean) => void;
}

export const CADToolsSection: React.FC<CADToolsSectionProps> = ({
    enabled,
    onChange,
}) => (
    <PanelCheckbox
        v2
        text="Enable CAD & BIM tools (beta)"
        checked={enabled}
        isGray
        regular
        onChange={() => onChange(!enabled)}
        tooltipText="Shows Model and Plan beta tools in the Build menu."
        dataTestId="cad-tools-toggle"
        switchDataTestId="cad-tools-switch"
        inputAriaLabel="Enable CAD and BIM tools"
    />
);
