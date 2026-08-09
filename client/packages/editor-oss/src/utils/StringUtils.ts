
/**
 * Module: StringUtils.ts
 * Purpose: Contains logic for string utils.
 */


const link = document.createElement("a");
link.style.display = "none";
document.body.appendChild(link); // Firefox workaround, see #6594

const NUMBER_PRECISION = 6;

/**
 *
 * @param key
 * @param value
 */
function parseNumber(_key: string, value: unknown) {
    return typeof value === "number" ? parseFloat(value.toFixed(NUMBER_PRECISION)) : value;
}

/**
 *
 * @param num
 * @author mrdoob / http://mrdoob.com/
 *
 *
 *
 */
function makePowOfTwo(num: number) {
    var result = 1;
    while (result < num) {
        result = result * 2;
    }
    return result;
}

/**
 *
 * @param blob
 * @param filename
 */
function save(blob: Blob, filename: string) {
    link.href = URL.createObjectURL(blob);
    link.download = filename || "data.json";
    link.click();
    // URL.revokeObjectURL( url ); breaks Firefox...
}

/**
 *
 * @param text
 * @param filename
 */
function saveString(text: string, filename: string) {
    save(new Blob([text], {type: "text/plain"}), filename);
}

/**
 *
 * @param value
 */
function parseBoolean(value: string | undefined): boolean {
    switch (value?.toLowerCase().trim()) {
        case "true":
        case "1":
            return true;
        case "false":
        case "0":
            return false;
        default:
            return false;
    }
}

/**
 *
 * @param txt
 */
function isEmpty(txt: string | undefined) {
    return txt && txt.length > 0;
}

const StringUtils = {
    parseNumber,
    makePowOfTwo,
    save,
    saveString,
    parseBoolean,
    isEmpty,
};

export default StringUtils;
