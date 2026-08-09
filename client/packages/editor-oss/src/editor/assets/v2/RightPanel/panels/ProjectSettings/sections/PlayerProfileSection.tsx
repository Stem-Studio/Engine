import React from "react";

import {isPlaygroundMode} from "@web-shared/playgroundMode";
import {ContentItem} from "../../../common/ContentItem";
import {NumericInputRow} from "../../../common/NumericInputRow";
import {PanelCheckbox} from "../../../common/PanelCheckbox";
import {PanelSectionTitle} from "../../../RightPanel.style";

interface PlayerProfileProps {
    playerSupport: {enabled: boolean};
    allowAnonymousFirebase: boolean;
    useAvatar: boolean;
    isMultiplayer: boolean;
    multiplayerAutoJoin: boolean;
    maxMultiplayerClientsPerRoom: number;
    onPlayerSupportChange: (enabled: boolean) => void;
    onBooleanChange: (key: string, setter: (value: boolean) => void) => void;
    onMaxClientsChange: (value: number) => void;
    setAllowAnonymousFirebase: (value: boolean) => void;
    setUseAvatar: (value: boolean) => void;
    setIsMultiplayer: (value: boolean) => void;
    setMultiplayerAutoJoin: (value: boolean) => void;
}

const PlayerProfileSectionComponent = ({
    playerSupport,
    allowAnonymousFirebase,
    useAvatar,
    isMultiplayer,
    multiplayerAutoJoin,
    maxMultiplayerClientsPerRoom,
    onPlayerSupportChange,
    onBooleanChange,
    onMaxClientsChange,
    setAllowAnonymousFirebase,
    setUseAvatar,
    setIsMultiplayer,
    setMultiplayerAutoJoin,
}: PlayerProfileProps) => {
    // Playground builds don't ship the Colyseus multiplayer sidecar, so
    // enabling these checkboxes wouldn't actually connect anywhere. The
    // standalone dev script still boots the sidecar — keep the toggle
    // visible there.
    const showMultiplayer = !isPlaygroundMode();
    const showAccountToggles = false;
    // If nothing inside the section will render (playground mode hides
    // both groups), drop the whole "Player Settings" heading too — an
    // empty section just adds visual noise.
    if (!showMultiplayer && !showAccountToggles) {
        return null;
    }

    return (
        <ContentItem $rowGap="12px">
            <PanelSectionTitle>Player Settings</PanelSectionTitle>
            {showMultiplayer && (
                <PanelCheckbox
                    v2
                    text="Multiplayer"
                    checked={isMultiplayer}
                    isGray
                    regular
                    onChange={() => onBooleanChange("isMultiplayer", setIsMultiplayer)}
                    tooltipText="Enables networked multiplayer gameplay for this project. Turn this on only if players should share the same live session or room state."
                />
            )}
            {showMultiplayer && isMultiplayer && (
                <>
                    <PanelCheckbox
                        v2
                        text="Auto join on start"
                        checked={multiplayerAutoJoin}
                        isGray
                        regular
                        disabled={!isMultiplayer}
                        onChange={() => onBooleanChange("multiplayerAutoJoin", setMultiplayerAutoJoin)}
                        tooltipText="Automatically joins a multiplayer room when the game starts. Useful for seamless drop-in experiences. Leave it off if players should choose a room or game mode first."
                    />
                    <NumericInputRow
                        label="Max Clients per Room"
                        value={maxMultiplayerClientsPerRoom}
                        setValue={onMaxClientsChange}
                        rightAlign
                        $margin="0"
                        min={2}
                        labelTooltip="Maximum number of players allowed in one multiplayer room. Small co-op games often use 2-8, while larger values need careful testing for networking, gameplay readability, and performance."
                    />
                </>
            )}
            {showAccountToggles && (
                <PanelCheckbox
                    v2
                    text="Use Player Avatar as Character"
                    checked={useAvatar}
                    isGray
                    regular
                    onChange={() => onBooleanChange("useAvatar", setUseAvatar)}
                    tooltipText="Uses each player's profile avatar as their in-game character when supported. Best for social, creator, or identity-driven experiences."
                />
            )}
            {showAccountToggles && (
                <PanelCheckbox
                    v2
                    text="Enable user accounts"
                    checked={!!playerSupport.enabled}
                    isGray
                    regular
                    onChange={() => onPlayerSupportChange(!playerSupport.enabled)}
                    tooltipText="Enables account-based player identity and progression. Turn this on when your experience needs saved identity, progression, or authenticated player features."
                />
            )}
            {showAccountToggles && playerSupport.enabled && (
                <PanelCheckbox
                    v2
                    text="Allow Guest Players"
                    checked={allowAnonymousFirebase}
                    isGray
                    regular
                    onChange={() => onBooleanChange("allowAnonymousFirebase", setAllowAnonymousFirebase)}
                    tooltipText="Allows players to enter without creating an account. Good for lower-friction onboarding, but guest users usually have weaker persistence and identity guarantees."
                />
            )}
        </ContentItem>
    );
};

export const PlayerProfileSection = React.memo(PlayerProfileSectionComponent);
