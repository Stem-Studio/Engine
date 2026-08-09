import {RefObject, useRef, useState} from "react";
import styled from "styled-components";
import {useOnClickOutside} from "usehooks-ts";

import {useAuthorizationContext} from "@stem/editor-oss/context/AuthorizationContext";
import {useHomepageContext} from "@stem/editor-oss/context/HomepageContext";
import {showToast} from "@stem/editor-oss/showToast";
import {ImportProgressDialog, type ImportProgress} from "../common/ImportProgressDialog";
import {MissingTextureDialog} from "../common/MissingTextureDialog";
import {TextureVariantDialog} from "../common/TextureVariantDialog";
import importIcon from "../icons/import-icon.svg";

export const ImportIcon = () => {
    const {isAdmin} = useAuthorizationContext();
    const {setShouldRefreshDashboard, setShowTemplatePanel} = useHomepageContext();

    const [optionsVisible, setOptionsVisible] = useState(false);
    const [isImporting, setIsImporting] = useState(false);
    const [importProgress, setImportProgress] = useState<ImportProgress | null>(null);
    const [importDialogTitle, setImportDialogTitle] = useState("Importing Scene");
    const [variantOptions, setVariantOptions] = useState<File[] | null>(null);
    const [variantResolver, setVariantResolver] = useState<((file: File | null) => void) | null>(null);
    const [texturePromptOpen, setTexturePromptOpen] = useState(false);
    const [textureResolver, setTextureResolver] = useState<((files: File[] | null) => void) | null>(null);

    const handleVariantConfirm = (file: File) => {
        variantResolver?.(file);
        setVariantOptions(null);
        setVariantResolver(null);
    };

    const handleVariantCancel = () => {
        variantResolver?.(null);
        setVariantOptions(null);
        setVariantResolver(null);
    };

    const handleTextureSelect = (files: File[]) => {
        textureResolver?.(files);
        setTexturePromptOpen(false);
        setTextureResolver(null);
    };

    const handleTextureContinue = () => {
        textureResolver?.(null);
        setTexturePromptOpen(false);
        setTextureResolver(null);
    };

    const ref = useRef<HTMLButtonElement>(null);

    useOnClickOutside(ref as RefObject<HTMLElement>, () => setOptionsVisible(false));

    const handleImportAssetPack = async () => {
        if (isImporting || !isAdmin) return;

        setImportDialogTitle("Importing Asset Pack");

        try {
            const {DashboardAssetPackImportUtils} = await import("@stem/editor-oss/utils/DashboardAssetPackImportUtils");
            DashboardAssetPackImportUtils.dashboardAssetPackImport(
                () => {
                    setIsImporting(true);
                    setImportProgress({
                        currentStep: "Initializing import...",
                    });
                },
                result => {
                    setIsImporting(false);
                    setImportProgress(null);

                    if (result.success) {
                        if (result.failedCount && result.failedCount > 0) {
                            const total = (result.successCount ?? 0) + result.failedCount;
                            const failedNames = result.failedAssets?.join(", ") ?? "";
                            showToast({
                                type: "warning",
                                title: `Imported ${result.successCount} of ${total} assets`,
                                body: `Failed: ${failedNames}`,
                            });
                        } else {
                            showToast({type: "success", title: "Asset pack imported and published"});
                            setShowTemplatePanel(false);
                        }
                        setShouldRefreshDashboard(true);
                    } else {
                        showToast({
                            type: "error",
                            body: result.error || "Asset pack import failed",
                        });
                        console.error("Asset pack import failed:", result.error);
                    }
                },
                progress => {
                    setImportProgress(progress);
                },
            );
        } catch (error) {
            showToast({type: "error", body: "Failed to load asset pack importer"});
            console.error("Failed to load asset pack importer:", error);
        }
    };

    const handleImportGame = async () => {
        if (isImporting) return;

        setImportDialogTitle("Importing Scene");

        try {
            const {DashboardImportUtils} = await import("@stem/editor-oss/utils/DashboardImportUtils");
            DashboardImportUtils.dashboardSceneImport(
                () => {
                    setIsImporting(true);
                    setImportProgress({
                        currentStep: "Initializing import...",
                    });
                },
                result => {
                    setIsImporting(false);
                    setImportProgress(null);

                    if (result.success) {
                        showToast({type: "success", title: "Scene imported successfully"});
                        // Refresh the dashboard to show the newly imported scene
                        setShouldRefreshDashboard(true);
                        setShowTemplatePanel(false);
                    } else {
                        showToast({
                            type: "error",
                            body: result.error || "Import failed",
                        });
                        console.error("Import failed:", result.error);
                    }
                },
                window.location.origin, // Use current domain as options server
                progress => {
                    setImportProgress(progress);
                },
                {isAdmin},
            );
        } catch (error) {
            showToast({type: "error", body: "Failed to load scene importer"});
            console.error("Failed to load scene importer:", error);
        }
    };

    const importOptions = [
        {label: "Import Game", handler: handleImportGame},
        {label: "Import Asset Pack", handler: handleImportAssetPack},
    ];

    return (
        <>
            <ImportProgressDialog
                isOpen={isImporting}
                progress={importProgress}
                title={importDialogTitle}
            />
            {variantOptions && (
                <TextureVariantDialog
                    variants={variantOptions}
                    onConfirm={handleVariantConfirm}
                    onCancel={handleVariantCancel}
                />
            )}

            {texturePromptOpen && (
                <MissingTextureDialog
                    onSelectTextures={handleTextureSelect}
                    onContinue={handleTextureContinue}
                    onCancel={handleTextureContinue}
                />
            )}
            <ImportButton
                type="button"
                aria-label="Import project"
                disabled={isImporting}
                $active={optionsVisible}
                onClick={isAdmin ? () => setOptionsVisible(true) : handleImportGame}
                ref={ref}
            >
                <img
                    src={importIcon}
                    alt=""
                    aria-hidden="true"
                />
                {optionsVisible && isAdmin && (
                    <Menu>
                        {importOptions.map(({label, handler}) => (
                            <MenuItem
                                type="button"
                                key={label}
                                disabled={isImporting}
                                onClick={handler}
                            >
                                {isImporting ? "Importing..." : label}
                            </MenuItem>
                        ))}
                    </Menu>
                )}
            </ImportButton>
        </>
    );
};

const ImportButton = styled.button<{$active?: boolean}>`
    position: relative;
    width: 32px;
    height: 32px;
    padding: 0;
    border: 1px solid ${({$active}) => ($active ? "rgba(248, 250, 252, 0.28)" : "transparent")};
    border-radius: 4px;
    background: ${({$active}) => ($active ? "rgba(248, 250, 252, 0.08)" : "transparent")};
    color: #f8fafc;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 auto;
    appearance: none;
    cursor: pointer;
    transition: background-color 0.15s ease, border-color 0.15s ease;

    img {
        width: 18px;
        height: 18px;
        display: block;
        object-fit: contain;
        pointer-events: none;
    }

    &:hover:not(:disabled) {
        border-color: rgba(248, 250, 252, 0.24);
        background: rgba(248, 250, 252, 0.08);
    }

    &:focus-visible {
        outline: 2px solid rgba(248, 250, 252, 0.42);
        outline-offset: 2px;
    }

    &:disabled {
        opacity: 0.55;
        cursor: wait;
    }
`;

const Menu = styled.div`
    position: absolute;
    bottom: 0;
    left: 50%;
    transform: translate(-50%, 100%);
    width: 135px;
    padding: 8px;

    background: var(--theme-container-secondary-dark);
    border-radius: 8px;
    box-shadow: 0px 4px 15px 0px rgba(0, 0, 0, 0.5);
    z-index: 1000;
    overflow: hidden;
`;
const MenuItem = styled.button`
    border: 0;
    background: transparent;
    padding: 12px 16px;
    font-size: var(--theme-font-size-s);
    font-weight: var(--theme-font-regular);
    color: white;
    cursor: pointer;
    transition: background-color 0.2s ease;
    width: 100%;
    padding: 4px 0 !important;
    border-radius: 4px;

    &:hover {
        background-color: #4f4f5d;
    }
`;
