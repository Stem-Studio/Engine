type CloneContext = {
    stack: WeakSet<object>;
};

type EqualityContext = {
    leftStack: WeakSet<object>;
    rightStack: WeakSet<object>;
};

const OMIT_VALUE = Symbol("json-compatible-omit");

function cloneValue(value: unknown, context: CloneContext): unknown {
    if (value === null) {
        return null;
    }

    const valueType = typeof value;
    if (valueType === "string" || valueType === "boolean") {
        return value;
    }
    if (valueType === "number") {
        return Number.isFinite(value) ? value : null;
    }
    if (valueType === "undefined" || valueType === "function" || valueType === "symbol") {
        return undefined;
    }
    if (valueType === "bigint") {
        throw new TypeError("Do not know how to serialize a BigInt");
    }

    const source = value as Record<string, unknown>;
    const toJSON = source.toJSON;
    if (typeof toJSON === "function") {
        return cloneValue(toJSON.call(source, ""), context);
    }

    if (context.stack.has(source)) {
        throw new TypeError("Converting circular structure to JSON");
    }

    context.stack.add(source);
    try {
        if (Array.isArray(source)) {
            const clone = new Array(source.length);
            for (let i = 0; i < source.length; i++) {
                const item = cloneValue(source[i], context);
                clone[i] = item === undefined ? null : item;
            }
            return clone;
        }

        const clone: Record<string, unknown> = {};
        const keys = Object.keys(source);
        for (let i = 0; i < keys.length; i++) {
            const key = keys[i]!;
            const item = cloneValue(source[key], context);
            if (item !== undefined) {
                clone[key] = item;
            }
        }
        return clone;
    } finally {
        context.stack.delete(source);
    }
}

export function cloneJsonCompatible<T>(value: T): T {
    return cloneValue(value, {stack: new WeakSet()}) as T;
}

function prepareComparableValue(value: unknown, inArray: boolean): unknown | typeof OMIT_VALUE {
    if (value === null) {
        return null;
    }

    const valueType = typeof value;
    if (valueType === "string" || valueType === "boolean") {
        return value;
    }
    if (valueType === "number") {
        return Number.isFinite(value) ? value : null;
    }
    if (valueType === "undefined" || valueType === "function" || valueType === "symbol") {
        return inArray ? null : OMIT_VALUE;
    }
    if (valueType === "bigint") {
        throw new TypeError("Do not know how to serialize a BigInt");
    }

    const source = value as Record<string, unknown>;
    const toJSON = source.toJSON;
    if (typeof toJSON === "function") {
        return prepareComparableValue(toJSON.call(source, ""), inArray);
    }

    return source;
}

function comparableValuesEqual(
    left: unknown | typeof OMIT_VALUE,
    right: unknown | typeof OMIT_VALUE,
    context: EqualityContext,
): boolean {
    if (left === OMIT_VALUE || right === OMIT_VALUE) {
        return left === right;
    }

    if (left === right && (left === null || typeof left !== "object")) {
        return true;
    }

    if (Array.isArray(left) || Array.isArray(right)) {
        if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
            return false;
        }

        if (context.leftStack.has(left) || context.rightStack.has(right)) {
            throw new TypeError("Converting circular structure to JSON");
        }

        context.leftStack.add(left);
        context.rightStack.add(right);
        try {
            for (let i = 0; i < left.length; i++) {
                if (!comparableValuesEqual(
                    prepareComparableValue(left[i], true),
                    prepareComparableValue(right[i], true),
                    context,
                )) {
                    return false;
                }
            }
        } finally {
            context.leftStack.delete(left);
            context.rightStack.delete(right);
        }
        return true;
    }

    if (left && right && typeof left === "object" && typeof right === "object") {
        const leftObject = left as Record<string, unknown>;
        const rightObject = right as Record<string, unknown>;
        if (context.leftStack.has(leftObject) || context.rightStack.has(rightObject)) {
            throw new TypeError("Converting circular structure to JSON");
        }

        context.leftStack.add(leftObject);
        context.rightStack.add(rightObject);
        try {
            const leftComparableKeys = new Set<string>();
            const leftKeys = Object.keys(leftObject);
            for (let i = 0; i < leftKeys.length; i++) {
                const key = leftKeys[i]!;
                const leftValue = prepareComparableValue(leftObject[key], false);
                if (leftValue === OMIT_VALUE) {
                    continue;
                }

                if (!Object.prototype.hasOwnProperty.call(rightObject, key)) {
                    return false;
                }

                const rightValue = prepareComparableValue(rightObject[key], false);
                if (rightValue === OMIT_VALUE || !comparableValuesEqual(leftValue, rightValue, context)) {
                    return false;
                }
                leftComparableKeys.add(key);
            }

            const rightKeys = Object.keys(rightObject);
            for (let i = 0; i < rightKeys.length; i++) {
                const key = rightKeys[i]!;
                if (leftComparableKeys.has(key)) {
                    continue;
                }

                const rightValue = prepareComparableValue(rightObject[key], false);
                if (rightValue !== OMIT_VALUE) {
                    return false;
                }
            }

            return true;
        } finally {
            context.leftStack.delete(leftObject);
            context.rightStack.delete(rightObject);
        }
    }

    return false;
}

function valuesEqual(left: unknown, right: unknown): boolean {
    return comparableValuesEqual(
        prepareComparableValue(left, false),
        prepareComparableValue(right, false),
        {leftStack: new WeakSet(), rightStack: new WeakSet()},
    );
}

export function jsonCompatibleEquals(left: unknown, right: unknown): boolean {
    return valuesEqual(left, right);
}
