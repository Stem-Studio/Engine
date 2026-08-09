import * as THREE from "three";
import { AdditiveBlending, NormalBlending } from "three";
import { ParticleSystem } from "three.quarks";

import { Item } from "@stem/editor-oss/editor/assets/v2/common/BasicCombobox/BasicCombobox";

import { blendingOptions, booleanOptions } from "./ParticleRendererSection";
import { SelectRow } from "../../../common/SelectRow";

interface Props {
    particleSystem: ParticleSystem;
    updateProperties: () => void
}

const materialTypeOptions: Item[] = [
    { key: "Basic", value: "Basic" },
    { key: "Standard", value: "Standard" },
    { key: "Physical", value: "Physical" },
];

const sideOptions: Item[] = [
    { key: "Front", value: "FrontSide" },
    { key: "Back", value: "BackSide" },
    { key: "Double", value: "DoubleSide" },
];

export const SelectSettings = ({ particleSystem, updateProperties }: Props) => {
    const onChangeWorldSpace = (selectedItem: Item) => {
        const value = selectedItem.value;
        switch (value) {
            case "True":
                particleSystem.worldSpace = true;
                break;
            case "False":
                particleSystem.worldSpace = false;
                break;
        }
        updateProperties();
    };

    const onChangeBlending = (selectedItem: Item) => {
        const value = selectedItem.value;
        switch (value) {
            case "Normal":
                particleSystem.blending = NormalBlending;
                break;
            case "Additive":
                particleSystem.blending = AdditiveBlending;
                break;
        }
        updateProperties();
    };

    const onChangeSide = (selectedItem: Item) => {
        switch (selectedItem.value) {
            case "FrontSide":
                particleSystem.material.side = THREE.FrontSide;
                break;
            case "BackSide":
                particleSystem.material.side = THREE.BackSide;
                break;
            case "DoubleSide":
                particleSystem.material.side = THREE.DoubleSide;
                break;
        }
        updateProperties();
    };

    const getCurrentMaterialType = () => {
        const mat = particleSystem.material;
        if (!mat) return materialTypeOptions[0];
        if ((mat as {isMeshStandardMaterial?: boolean}).isMeshStandardMaterial) return materialTypeOptions[1];
        if ((mat as {isMeshPhysicalMaterial?: boolean}).isMeshPhysicalMaterial) return materialTypeOptions[2];
        return materialTypeOptions[0]; // fallback
    };

    const onChangeMaterialType = (selectedItem: Item) => {
        // Store current material properties before changing
        const oldMaterial = particleSystem.material;
        const previousProps = oldMaterial ? {
            transparent: oldMaterial.transparent,
            opacity: oldMaterial.opacity,
            blendColor: oldMaterial.blendColor?.clone(),
            side: oldMaterial.side,
            map: (oldMaterial as THREE.MeshBasicMaterial).map,
            depthWrite: oldMaterial.depthWrite,
            depthTest: oldMaterial.depthTest,
            userData: { ...oldMaterial.userData },
        } : {};

        switch (selectedItem.value) {
            case "Basic":
                particleSystem.material = new THREE.MeshBasicMaterial({ color: 0xffffff });
                break;
            case "Standard":
                particleSystem.material = new THREE.MeshStandardMaterial({ color: 0xffffff });
                break;
            case "Physical":
                particleSystem.material = new THREE.MeshPhysicalMaterial({ color: 0xffffff });
                break;
        }

        // Restore previous material properties
        if (particleSystem.material) {
            particleSystem.material.transparent = previousProps.transparent ?? false;
            particleSystem.material.opacity = previousProps.opacity ?? 1;
            if (previousProps.blendColor) {
                particleSystem.material.blendColor = previousProps.blendColor;
            }
            particleSystem.material.side = previousProps.side ?? THREE.FrontSide;
            if (previousProps.map) {
                (particleSystem.material as THREE.MeshBasicMaterial).map = previousProps.map;
            }
            particleSystem.material.depthWrite = previousProps.depthWrite ?? true;
            particleSystem.material.depthTest = previousProps.depthTest ?? true;
            if (previousProps.userData) {
                Object.assign(particleSystem.material.userData, previousProps.userData);
            }
            particleSystem.material.needsUpdate = true;
        }

        updateProperties();
    };

    const getCurrentSide = () => {
        switch (particleSystem.material?.side) {
            case THREE.FrontSide:
                return sideOptions[0];
            case THREE.BackSide:
                return sideOptions[1];
            case THREE.DoubleSide:
                return sideOptions[2];
            default:
                return sideOptions[0];
        }
    };

    const getValueOfBlending = (blending: THREE.Blending) => {
        switch (blending) {
            case NormalBlending:
                return "Normal";
            case AdditiveBlending:
                return "Additive";
        }
        return "Normal";
    };

    const getValueOfBoolean = (worldSpace: boolean) => {
        return worldSpace ? "True" : "False";
    };

    const currentBlending =
        blendingOptions.find(opt => opt.value === getValueOfBlending(particleSystem.blending)) || blendingOptions[0];
    const currentWorldSpace =
        booleanOptions.find(opt => opt.value === getValueOfBoolean(particleSystem.worldSpace)) || booleanOptions[1];

    const selectRows = [
        {
            label: "World Space",
            data: booleanOptions,
            value: currentWorldSpace,
            onChange: onChangeWorldSpace,
            margin: "0 0 8px 0",
        },
        {
            label: "Material Type",
            data: materialTypeOptions,
            value: getCurrentMaterialType(),
            onChange: onChangeMaterialType,
            margin: "0 0 8px 0",
        },
        {
            label: "Side",
            data: sideOptions,
            value: getCurrentSide(),
            onChange: onChangeSide,
            margin: "0 0 8px 0",
        },
        {
            label: "Blending",
            data: blendingOptions,
            value: currentBlending,
            onChange: onChangeBlending,
            margin: "0 0 8px 0",
        },
    ];

    return (
        <>
            {selectRows.map((row, index) => 
                <SelectRow
                    key={index}
                    label={row.label}
                    data={row.data}
                    value={row.value}
                    onChange={row.onChange}
                    $margin={row.margin}
                />,
            )}
        </>
    );

};
