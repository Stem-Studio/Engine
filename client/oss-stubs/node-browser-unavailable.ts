const unavailable = (): never => {
    throw new Error("Node.js modules are unavailable in the browser runtime");
};

export const createRequire = unavailable;
export const fileURLToPath = unavailable;
export const inspect = unavailable;
export const readFileSync = unavailable;
export const writeSync = unavailable;
export const Worker = undefined;
export const workerData = undefined;

export default {
    createRequire,
    fileURLToPath,
    inspect,
    readFileSync,
    writeSync,
    Worker,
    workerData,
};
