import {QueryClientProvider} from "@tanstack/react-query";
import React, {useEffect, useRef} from "react";
import {toast, Toaster} from "toastywave";

// Import for side effect: registers open-source browser integrations.
import "./bootstrap/oss";

import {AppRouter} from "./AppRouter";
import AppGlobalContextProvider from "./context/AppGlobalContext";
import AssetsTabContextProvider from "./context/AssetsTabContext";
import AuthorizationContextProvider from "./context/AuthorizationContext";
import {BatchLodGenerationContextProvider} from "./context/BatchLodGenerationContext";
import HomepageContextProvider from "./context/HomepageContext";
import HUDContextProvider from "./context/HUDContext";
import {OssAssetRegistryProvider} from "./context/OssAssetRegistryContext";
import ProjectStateContextProvider from "./context/ProjectStateContext";
import PublishingContextProvider from "./context/PublishingContext";
import {SceneAssetResolutionProvider} from "./context/SceneAssetResolutionContext";
import UIStateContextProvider from "./context/UIStateContext";
import {SceneRevisionsModalRenderer} from "@stem/editor-oss/editor/assets/v2/SceneRevisionsModalRenderer/SceneRevisionsModalRenderer";
import {queryClient} from "./queryClient";
import {LoadingAnimation} from "./ui/progress/LoadingAnimation";
import {AppUpdateManager} from "./update/AppUpdateManager";
import {OfflineIndicator} from "./update/OfflineIndicator";
import CSPMetaTag, {customCSPPolicies} from "./utils/CSPMetaTag";
import {logLevelMismatch} from "./utils/Logger";
import {WarningRenderer} from "./WarningService/WarningRenderer";

const LogLevelMismatchToast = () => {
    useEffect(() => {
        if (logLevelMismatch) {
            toast.warning(
                `Log level override: project uses "${logLevelMismatch.env}" (.env) but localStorage overrides to "${logLevelMismatch.stored}". ` +
                    `Reset via editor menu > Log Level, or clear localStorage key "logLevelOverride".`,
            );
        }
    }, []);
    return null;
};

export const AppContainer = () => {
    const toastContainerRef = useRef<HTMLDivElement>(null);

    // Register the local ProjectStore so the save/load flow can persist
    // scenes to IndexedDB or the picked filesystem folder. setProjectStore()
    // also installs the saveScene handler that routes every save through the
    // local store.
    useEffect(() => {
        void import("@stem/editor-oss/persistence/bootstrap")
            .then(({ensureProjectStoreRehydrated}) => ensureProjectStoreRehydrated());
    }, []);

    return (
        <>
            <CSPMetaTag customPolicies={customCSPPolicies} />
            <AuthorizationContextProvider>
                <QueryClientProvider client={queryClient}>
                    <SceneAssetResolutionProvider>
                        <BatchLodGenerationContextProvider>
                            <HUDContextProvider>
                                <OssAssetRegistryProvider>
                                    <AssetsTabContextProvider>
                                        <UIStateContextProvider>
                                            <ProjectStateContextProvider>
                                                <PublishingContextProvider>
                                                    <AppGlobalContextProvider>
                                                        <HomepageContextProvider>
                                                            <LoadingAnimation />
                                                            <AppUpdateManager />
                                                            <OfflineIndicator />
                                                            <AppRouter />
                                                            <WarningRenderer />
                                                            <SceneRevisionsModalRenderer />
                                                            <div
                                                                ref={toastContainerRef}
                                                                className="my-toaster"
                                                            >
                                                                <Toaster
                                                                    position="bottom-right"
                                                                    theme="dark"
                                                                    container={toastContainerRef as React.RefObject<HTMLElement>}
                                                                />
                                                                <LogLevelMismatchToast />
                                                            </div>
                                                        </HomepageContextProvider>
                                                    </AppGlobalContextProvider>
                                                </PublishingContextProvider>
                                            </ProjectStateContextProvider>
                                        </UIStateContextProvider>
                                    </AssetsTabContextProvider>
                                </OssAssetRegistryProvider>
                            </HUDContextProvider>
                        </BatchLodGenerationContextProvider>
                    </SceneAssetResolutionProvider>
                </QueryClientProvider>
            </AuthorizationContextProvider>
        </>
    );
};
