import {useRef} from "react";
import {useOnClickOutside} from "usehooks-ts";

import {
    Container,
    CloseButton,
    Title,
    TitleRow,
    Content,
    RemixRow,
    RemixThumbnail,
    RemixInfo,
    RemixName,
    RemixDate,
    Footer,
} from "./RemixPickerModal.style";
import {getThumbnail} from "@stem/editor-oss/utils/thumbnailUrl";
import {useEscapeDismiss} from "../../../common/hooks/useEscapeDismiss";
import {StyledButton} from "../../../common/StyledButton";
import scenePlaceholder from "../../../icons/stem-studio-project-placeholder.png";
import {FileData} from "../../../types/file";
import remixIcon from "../../icons/remix.svg";
import closeIcon from "../../icons/x-mark.svg";

interface RemixPickerModalProps {
    sceneName: string;
    remixes: FileData[];
    onSelectRemix: (sceneId: string) => void;
    onCreateNew: () => void;
    onCancel: () => void;
}

export const RemixPickerModal = ({
    sceneName,
    remixes,
    onSelectRemix,
    onCreateNew,
    onCancel,
}: RemixPickerModalProps) => {
    const ref = useRef<HTMLDivElement>(null!);
    useOnClickOutside(ref, onCancel);
    useEscapeDismiss({onEscape: onCancel});

    return (
        <Container ref={ref}>
            <TitleRow>
                <Title>Existing remixes of &apos;{sceneName}&apos;</Title>
                <CloseButton className="reset-css"
                    onClick={onCancel}
                >
                    <img src={closeIcon}
                        alt="close"
                    />
                </CloseButton>
            </TitleRow>
            <Content>
                {remixes.map(remix => (
                    <RemixRow key={remix.ID} onClick={() => onSelectRemix(remix.ID)}>
                        <RemixThumbnail
                            src={getThumbnail(remix.Thumbnail) || scenePlaceholder}
                            alt={remix.Name}
                        />
                        <RemixInfo>
                            <RemixName>{remix.Name}</RemixName>
                            <RemixDate>
                                {remix.UpdateTime
                                    ? `Updated ${new Date(remix.UpdateTime).toLocaleDateString()}`
                                    : ""}
                            </RemixDate>
                        </RemixInfo>
                    </RemixRow>
                ))}
            </Content>
            <Footer>
                <StyledButton
                    onClick={onCancel}
                    isGreySecondary
                    style={{padding: "8px 20px", fontSize: "14px", width: "min-content"}}
                >
                    Cancel
                </StyledButton>
                <StyledButton
                    onClick={onCreateNew}
                    customIcon={remixIcon}
                    style={{
                        background: "var(--theme-dialog-button-purple)",
                        padding: "8px 20px",
                        fontSize: "14px",
                        fontWeight: 600,
                        height: "36px",
                        width: "min-content",
                        whiteSpace: "nowrap",
                    }}
                >
                    Create new remix
                </StyledButton>
            </Footer>
        </Container>
    );
};
