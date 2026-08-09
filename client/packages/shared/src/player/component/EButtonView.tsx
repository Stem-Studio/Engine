import {Trans} from "react-i18next";
import styled from "styled-components";

const Container = styled.div`
    font-size: 20px;
    color: white;
    text-align: center;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
`;

const Keycap = styled.span`
    width: 32px;
    height: 32px;
    border-radius: 6px;
    border: 1px solid rgba(255, 255, 255, 0.55);
    background: rgba(0, 0, 0, 0.35);
    color: #ffffff;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 16px;
    font-weight: 700;
    line-height: 1;
`;

export const EButtonView = ({name}: {name: string}) => {
    return (
        <Container>
            <Trans
                i18nKey="Press <button></button> to talk to {{name}}"
                values={{name}}
                components={{
                    button: <Keycap>E</Keycap>,
                }}
            />
        </Container>
    );
};
