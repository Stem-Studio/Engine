import {QueryClientProvider} from "@tanstack/react-query";
import {lazy, Suspense, useEffect} from "react";

// Side-effect import: registers open-source browser integrations.
import "./bootstrap/oss";

import {AppRouter} from "./AppRouter";
import AppGlobalContextProvider from "./context/AppGlobalContext";
import AuthorizationContextProvider from "./context/AuthorizationContext";
import HomepageContextProvider from "./context/HomepageContext";
import {OssAssetRegistryProvider} from "./context/OssAssetRegistryContext";
import {isOSSBootstrapped} from "@stem/editor-oss/persistence/bootstrapState";
import {applyPlaygroundModeAttribute} from "./playgroundMode";
import "./playgroundMode.css";
import {queryClient} from "./queryClient";

const OSSBootstrapModal = lazy(() =>
    import("@stem/editor-oss/editor/assets/v2/OSSBootstrapModal/OSSBootstrapModal")
        .then(module => ({default: module.OSSBootstrapModal})),
);

// Tag <html data-playground-mode> before React renders so CSS selectors in
// playgroundMode.css apply on the first paint. Safe to call repeatedly.
applyPlaygroundModeAttribute();

const OSSPersistenceBootstrapper = () => {
    useEffect(() => {
        // Only rehydrate once the user has gone through the first-time modal.
        // Before that, the modal itself will register the chosen store on
        // confirm; rehydrating here too would race with that flow. Scene
        // loads on un-bootstrapped routes fall back to a lazy rehydration
        // via `ensureProjectStoreRehydrated()` in the scene loader.
        if (!isOSSBootstrapped()) return;
        void import("@stem/editor-oss/persistence/bootstrap")
            .then(({ensureProjectStoreRehydrated}) => ensureProjectStoreRehydrated());
    }, []);
    return null;
};

export const PublicAppContainerLite = () => {
    return (
        <AuthorizationContextProvider>
            <QueryClientProvider client={queryClient}>
                <OssAssetRegistryProvider>
                    <AppGlobalContextProvider>
                        <HomepageContextProvider>
                            <AppRouter />
                            <OSSPersistenceBootstrapper />
                            {!isOSSBootstrapped() ? (
                                <Suspense fallback={null}>
                                    <OSSBootstrapModal />
                                </Suspense>
                            ) : null}
                        </HomepageContextProvider>
                    </AppGlobalContextProvider>
                </OssAssetRegistryProvider>
            </QueryClientProvider>
        </AuthorizationContextProvider>
    );
};
