import {ISoundSettings} from "@stem/editor-oss/types/editor";

export interface IHUDManager {
    create(emptyHUD?: boolean): void;
    clear(): void;
    loadSounds(sounds: ISoundSettings[]): void;
    playSound(id: string): void;
    stopSound(soundId: string): void;
    clearSounds(): void;
    update?(delta: number): void;
}
