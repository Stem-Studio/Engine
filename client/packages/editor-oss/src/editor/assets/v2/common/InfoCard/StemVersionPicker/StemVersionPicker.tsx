import {useEffect, useState} from "react";

import {PickerContainer, StickyBottom, Wrapper} from "./StemVersionPicker.style";
import {DomainAssetRevisionDto} from "@stem/network/api/client/api";
import {saveScene} from "@stem/network/api/scene";
import {resolveAssetRevisionId} from "@stem/editor-oss/asset-management/AssetResolutionContext";
import {useAssetResolutionContext} from "@stem/editor-oss/context/AssetResolutionContext";
import {AssetStateType} from "@stem/editor-oss/context/LibrariesContext";
import global from "@stem/editor-oss/global";
import {useCreateAssetRevision, useGetAssetRevision} from "../../../../../asset-management/hooks/assets";
import {useChangePrefabRevision} from "../../../../../asset-management/hooks/useChangePrefabRevision";
import {AssetDependenciesList} from "../../AssetDependenciesList/AssetDependenciesList";
import {RevisionSelect} from "../../RevisionSelect/RevisionSelect";
import {StyledButton} from "../../StyledButton";
import {PrimaryTextHelper, PrimaryText} from "../Info.style";

export interface IDependencyUpdate {
    assetId: string;
    selectedRevisionId: string;
}

export const StemVersionPicker = ({stem}: {stem: AssetStateType}) => {
    const app = global.app!;
    const {context: assetResolutionContext} = useAssetResolutionContext();
    const changePrefabRevision = useChangePrefabRevision();
    const createAssetRevision = useCreateAssetRevision();
    const [selectedRevisionId, setSelectedRevisionId] = useState<string>();
    const currentRevisionId = resolveAssetRevisionId(stem.id, assetResolutionContext);
    const getAssetRevision = useGetAssetRevision();
    const [currentRevisionData, setCurrentRevisionData] = useState<DomainAssetRevisionDto>();
    const [dependenciesToUpdate, setDependenciesToUpdate] = useState<IDependencyUpdate[]>([]);

    useEffect(() => {
        if (!currentRevisionId) return;
        const handleGetAssetRevision = async () => {
            const data = await getAssetRevision(stem.id, currentRevisionId, {includeDependencies: true});
            setCurrentRevisionData(data);
        };

        void handleGetAssetRevision();
    }, [currentRevisionId]);

    const buildDependenciesPayload = () => {
        const base = {...(currentRevisionData?.dependencies ?? {})};

        dependenciesToUpdate.forEach(dep => {
            base[dep.assetId] = dep.selectedRevisionId;
        });

        return base;
    };

    const handleAssetRevisionChange = async () => {
        if (!app.editor?.scene || !selectedRevisionId) return;

        if (dependenciesToUpdate.length > 0) {
            const asset = await createAssetRevision.mutateAsync({
                assetId: stem.id,
                parentRevisionId: selectedRevisionId,
                options: {
                    dependencies: buildDependenciesPayload(),
                },
            });
            await changePrefabRevision(stem.id, asset.id).catch(console.error);
        } else {
            await changePrefabRevision(stem.id, selectedRevisionId).catch(console.error);
        }

        saveScene().catch(console.error);
        app.call("objectChanged");
    };

    return (
        <PickerContainer>
            <Wrapper>
                <PrimaryText>Version in this Project</PrimaryText>
                <RevisionSelect
                    assetId={stem.id}
                    selectedRevisionId={selectedRevisionId}
                    onChange={setSelectedRevisionId}
                    currentRevisionId={currentRevisionId || ""}
                    creatingNewRevision={dependenciesToUpdate.length > 0}
                />
            </Wrapper>
            <Wrapper style={{padding: "0"}}>
                {!!currentRevisionData?.dependencies && (
                    <>
                        <PrimaryText>Dependencies</PrimaryText>
                        <PrimaryTextHelper>Editable only in the latest revision</PrimaryTextHelper>
                    </>
                )}
                {Object.entries(currentRevisionData?.dependencies ?? {}).map(([assetId, revisionId]) => (
                    <AssetDependenciesList
                        key={assetId}
                        assetId={assetId}
                        revisionId={revisionId}
                        setDependenciesToUpdate={setDependenciesToUpdate}
                        dependenciesLocked={selectedRevisionId !== stem.headRevisionId}
                    />
                ))}
            </Wrapper>
            <StickyBottom>
                <div className="text">Changes do not load until &quot;Update All Instances&quot;</div>
                <StyledButton
                    isBlue
                    width="169px"
                    height="24px"
                    onClick={handleAssetRevisionChange}
                >
                    Update All Instances
                </StyledButton>
            </StickyBottom>
        </PickerContainer>
    );
};
