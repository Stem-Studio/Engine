import styled from "styled-components";

const Container = styled.div`
    height: 100%;
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    box-sizing: border-box;
    background-color: var(--theme-container-main-dark);
`;

const Message = styled.div`
    font-size: 40px;
    color: white;
    text-align: center;
`;

export const GameQueueView = () => {
    return (
        <Container>
            <Message>Room is full. You are in queue...</Message>
        </Container>
    );
};
