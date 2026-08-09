import {useEffect} from "react";

export const Waitlist = ({setShowWaitlist}: {setShowWaitlist: React.Dispatch<React.SetStateAction<boolean>>}) => {
    useEffect(() => {
        setShowWaitlist(false);
    }, [setShowWaitlist]);

    return null;
};
