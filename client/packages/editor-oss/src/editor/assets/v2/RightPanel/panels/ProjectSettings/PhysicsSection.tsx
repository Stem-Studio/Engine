import { PhysicsEngineType } from '../../../../../../physics/common/types';
import { NumericInputRow } from '../../common/NumericInputRow';
import { SelectRow } from '../../common/SelectRow';

export interface PhysicsSettings {
    engine: PhysicsEngineType;
    gravity: number;
}

interface PhysicsSettingsProps {
    settings: PhysicsSettings;
    onChange: (physicsSettings: PhysicsSettings) => void;
}

const PHYSICS_ENGINES = [
    {
        key: PhysicsEngineType.Ammo,
        value: "Ammo",
    },
    {
        key: PhysicsEngineType.Rapier,
                value: "Rapier",
    },
];

export const PhysicsSection = ({
    settings,
    onChange,
}: PhysicsSettingsProps) => {
    const { engine, gravity } = settings;
    
    return (
        <>
            <SelectRow
                label="Engine"
                data={PHYSICS_ENGINES}
                value={PHYSICS_ENGINES.find(item => item.key === engine)}
                onChange={item => onChange({ ...settings, engine: item.key as PhysicsEngineType })}
                $margin="0"
                labelTooltip="Selects the runtime physics backend for simulation and collision solving. Ammo is the compatibility default; Rapier is the alternative supported backend."
            />
            <NumericInputRow
                label="Gravity"
                value={gravity}
                setValue={value => onChange({ ...settings, gravity: value })}
                rightAlign
                $margin="0"
                labelTooltip="Global gravity acceleration applied to dynamic rigid bodies. Earth-like gravity is about -9.81 m/s^2. Use values closer to 0 for floaty gameplay and more negative values for heavier or faster-falling worlds."
            />
        </>
    );
};
