import styled from "styled-components";

import {
    Container,
    Content,
    Footer,
    Header,
    Overlay,
    StepCard,
    StepDescription,
    StepImageContainer,
    StepTitle,
} from "./FTUEModal.style";
import { StyledButton } from "../common/StyledButton";

// GIF images
import assetLibraryGif from "./images/asset_library.gif";
import dragDropGif from "./images/drag_drop.gif";
import gizmoGif from "./images/gizmo.gif";
import settingsGif from "./images/settings.gif";
import {useEscapeDismiss} from "../common/hooks/useEscapeDismiss";
import closeIcon from "../icons/close-panel.svg";

interface FTUEModalProps {
    onClose: () => void;
}

export const FTUEModal = ({ onClose }: FTUEModalProps) => {
    useEscapeDismiss({onEscape: onClose});

    return (
        <Overlay>
            <Container>
                <Header>
                    <h1>Getting Started: Learn How to Create Your Own Game!</h1>
                    <CloseButton className="reset-css"
                        onClick={onClose}
                    >
                        <img src={closeIcon}
                            alt="close"
                        />
                    </CloseButton>
                </Header>
                <Content>
                    <StepCard>
                        <StepImageContainer>
                            <img src={assetLibraryGif}
                                alt="Asset Library"
                            />
                        </StepImageContainer>
                        <StepTitle>1. Use the Asset Library</StepTitle>
                        <StepDescription>
                            Browse the Library to find and add objects to your scene.
                        </StepDescription>
                    </StepCard>

                    <StepCard>
                        <StepImageContainer>
                            <img src={dragDropGif}
                                alt="Drag and Drop"
                            />
                        </StepImageContainer>
                        <StepTitle>2. Drag & Drop Primitivies</StepTitle>
                        <StepDescription>
                            Click and drag objects from the Asset Library into the scene.
                        </StepDescription>
                    </StepCard>

                    <StepCard>
                        <StepImageContainer>
                            <img src={gizmoGif}
                                alt="Gizmo"
                            />
                        </StepImageContainer>
                        <StepTitle>3. Select to Edit & Move</StepTitle>
                        <StepDescription>
                            Click on objects in the scene to move, rotate, and scale them.
                        </StepDescription>
                    </StepCard>

                    <StepCard>
                        <StepImageContainer>
                            <img src={settingsGif}
                                alt="Game Settings"
                            />
                        </StepImageContainer>
                        <StepTitle>4. Customize Game Settings</StepTitle>
                        <StepDescription>
                            Open the Project Settings panel to adjust game rules, description, and more.
                        </StepDescription>
                    </StepCard>
                </Content>
                <Footer>
                    <StyledButton
                        isBlue
                        width="200px"
                        height="48px"
                        onClick={onClose}
                        style={{ fontSize: "18px", fontWeight: 600 }}
                    >
                        Got It
                    </StyledButton>
                </Footer>
            </Container>
        </Overlay>
    );
};

const CloseButton = styled.button`
    position: absolute;
    right: 16px;
    top: 16px;

    img {
        width: 13px;
        height: auto;
    }
`;
