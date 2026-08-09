import React, {useContext, useEffect, useState} from "react";

import {
    getOssAssetRegistry,
    setOssAssetRegistry,
    type OssAssetRegistry,
} from "@stem/network/api/asset/registry";

export const OssAssetRegistryContext = React.createContext<OssAssetRegistry | null>(null);

export const OssAssetRegistryProvider = ({children}: {children: React.ReactNode}) => {
    const [registry] = useState<OssAssetRegistry>(() => getOssAssetRegistry());

    useEffect(() => {
        setOssAssetRegistry(registry);
    }, [registry]);

    return (
        <OssAssetRegistryContext.Provider value={registry}>
            {children}
        </OssAssetRegistryContext.Provider>
    );
};

export const useOssAssetRegistry = (): OssAssetRegistry => {
    return useContext(OssAssetRegistryContext) ?? getOssAssetRegistry();
};
