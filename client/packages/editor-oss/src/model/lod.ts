import {DetectDevice} from "../utils/DetectDevice";
import {LOD_LEVEL_DESKTOP, LOD_LEVEL_MOBILE} from "./lodLevels";

export {LOD_LEVEL_DESKTOP, LOD_LEVEL_MOBILE} from "./lodLevels";

export const getBestLodForPlatform = (): number => {
    return DetectDevice.isMobile() ? LOD_LEVEL_MOBILE : LOD_LEVEL_DESKTOP;
};
