import type {Object3D} from "three";

export function setRuntimeUserDataValue(object: Object3D, key: string, value: unknown): void {
    const userData = object.userData;
    try {
        const descriptor = Object.getOwnPropertyDescriptor(userData, key);
        if (descriptor?.enumerable === false) {
            if ("value" in descriptor) {
                if (descriptor.value === value) return;
                if (descriptor.writable) {
                    userData[key] = value;
                    return;
                }
            } else if (descriptor.set) {
                userData[key] = value;
                return;
            }
        }

        Object.defineProperty(userData, key, {
            value,
            configurable: true,
            enumerable: false,
            writable: true,
        });
    } catch {
        try {
            userData[key] = value;
        } catch {
            // Non-extensible userData still gets the computed value for the caller.
        }
    }
}

export function deleteRuntimeUserDataValue(object: Object3D, key: string): void {
    try {
        delete object.userData[key];
    } catch {
        setRuntimeUserDataValue(object, key, undefined);
    }
}
