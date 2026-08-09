import BaseSerializer from "../BaseSerializer";
import Object3DSerializer from "../core/Object3DSerializer";
import MaterialsSerializer from "../material/MaterialsSerializer";

const fontCache = new Map();
let fontLoaderPromise = null;
let fontConfigPromise = null;
let text3DConstructorPromise = null;

function getFontLoader() {
    if (!fontLoaderPromise) {
        fontLoaderPromise = import("three/addons/loaders/FontLoader.js")
            .then(({FontLoader}) => new FontLoader());
    }

    return fontLoaderPromise;
}

function getFontConfig() {
    if (!fontConfigPromise) {
        fontConfigPromise = import("@web-shared/object/geometry/fontMap");
    }

    return fontConfigPromise;
}

function getText3DConstructor() {
    if (!text3DConstructorPromise) {
        text3DConstructorPromise = import("@web-shared/object/geometry/Text3D")
            .then(({default: Text3D}) => Text3D);
    }

    return text3DConstructorPromise;
}

/**
 *
 * @param path
 * @param cacheKey
 */
async function loadFontCached(path, cacheKey) {
    if (fontCache.has(cacheKey)) {
        return Promise.resolve(fontCache.get(cacheKey));
    }
    const fontLoader = await getFontLoader();
    return new Promise((resolve, reject) => {
        fontLoader.load(
            path,
            font => {
                fontCache.set(cacheKey, font);
                resolve(font);
            },
            undefined,
            reject,
        );
    });
}

class Text3DSerializer extends BaseSerializer {
    toJSON(obj, options = {}) {
        const json = Object3DSerializer.prototype.toJSON.call(this, obj);

        if (options.saveMaterial) {
            json.material = new MaterialsSerializer().toJSON(obj.material);
        } else {
            json.material = null;
        }

        json.textConfig = obj.userData.textConfig;
        return json;
    }

    async fromJSON(json, parent, options) {
        if (parent !== undefined) {
            Object3DSerializer.prototype.fromJSON.call(this, json, parent);
            return parent;
        }

        const textConfig = json.textConfig || {};
        const [fontConfig, Text3D] = await Promise.all([
            getFontConfig(),
            getText3DConstructor(),
        ]);
        const {DEFAULT_FONT, DEFAULT_WEIGHT, FONT_MAP, resolveFontPath} = fontConfig;

        // Reset to default if font is not in FONT_MAP
        const fontName = FONT_MAP[textConfig.fontName] ? textConfig.fontName : DEFAULT_FONT;
        const weight = (textConfig.weight === "bold") ? "bold" : DEFAULT_WEIGHT;
        const fontPath = resolveFontPath(fontName, weight);
        const cacheKey = `${fontName}_${weight}`;

        let font;
        try {
            font = await loadFontCached(fontPath, cacheKey);
        } catch (error) {
            console.warn(`Failed to load font ${fontPath}, falling back to default:`, error);
            const defaultPath = resolveFontPath(DEFAULT_FONT, DEFAULT_WEIGHT);
            try {
                font = await loadFontCached(defaultPath, `${DEFAULT_FONT}_${DEFAULT_WEIGHT}`);
            } catch (defaultError) {
                console.error("Failed to load default font:", defaultError);
                return null;
            }
        }

        const material = json.material
            ? new MaterialsSerializer().fromJSON(json.material, undefined, options)
            : undefined;

        // Ensure textConfig stores clean fontName/weight for future saves
        textConfig.fontName = fontName;
        textConfig.weight = weight;

        const obj = new Text3D(textConfig.text || "Text", font, textConfig, material);
        Object3DSerializer.prototype.fromJSON.call(this, json, obj);

        return obj;
    }
}

export default Text3DSerializer;
