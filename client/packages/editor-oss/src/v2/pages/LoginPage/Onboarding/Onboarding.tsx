import {useEffect} from "react";

interface Props {
    onCorrectAuth: () => void;
    setOnboarding: React.Dispatch<React.SetStateAction<boolean>>;
}

export const Onboarding = ({onCorrectAuth, setOnboarding}: Props) => {
    useEffect(() => {
        setOnboarding(false);
        onCorrectAuth();
    }, [onCorrectAuth, setOnboarding]);

    return null;
};
