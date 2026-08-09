import styled from "styled-components";

interface Props {
    width: string;
    height: string;
    className?: string;
    bgImage?: string | null;
}

export const Logo = ({width, height, bgImage, className}: Props) => {
    return <StyledLogo className={className}
        width={width}
        height={height}
        $bgImage={bgImage}
           />;
};

const StyledLogo = styled.button<{
    width: string;
    height: string;
    $bgImage?: string | null;
}>`
    padding: 0;
    margin: 0;
    box-sizing: border-box;
    background: none;
    cursor: default;
    color: #fff;
    width: ${({width}) => width};
    height: ${({height}) => height};
    max-width: 100%;
    border-radius: 12px;
    font-size: 32px;

    ${({$bgImage}) =>
        $bgImage
            ? `
  background-image: url('${$bgImage}');
  background-repeat: no-repeat;
  background-size: cover;
  background-position: center;
  border: none;
  
  `
            : `opacity: 0;`}
`;
