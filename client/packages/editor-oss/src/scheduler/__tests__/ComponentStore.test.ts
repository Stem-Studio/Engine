import {Object3D} from "three";
import {describe, expect, it} from "vitest";

import {ComponentStore, type ComponentFieldSchema} from "../data/ComponentStore";

const schema: ComponentFieldSchema[] = [
    {name: "x", type: "f32", default: 1.5},
    {name: "state", type: "i32", default: -1},
    {name: "visible", type: "u8", default: 1},
];

function createObject(uuid: string): Object3D {
    const object = new Object3D();
    object.uuid = uuid;
    return object;
}

describe("ComponentStore", () => {
    it("normalizes zero initial capacity and grows on demand", () => {
        const store = new ComponentStore(schema, 0);
        const first = createObject("first");
        const second = createObject("second");

        expect(store.capacity).toBe(1);
        expect(store.addEntity(first.uuid, first, {x: 2})).toBe(0);
        expect(store.addEntity(second.uuid, second, {state: 7, visible: 0})).toBe(1);

        expect(store.count).toBe(2);
        expect(store.capacity).toBeGreaterThanOrEqual(2);
        expect(store.getFieldValue(first.uuid, "x")).toBeCloseTo(2);
        expect(store.getFieldValue(first.uuid, "state")).toBe(-1);
        expect(store.getFieldValue(second.uuid, "state")).toBe(7);
        expect(store.getFieldValue(second.uuid, "visible")).toBe(0);

        store.dispose();
    });

    it("keeps duplicate entity registration stable", () => {
        const store = new ComponentStore(schema, 1);
        const object = createObject("same");

        expect(store.addEntity(object.uuid, object, {x: 4})).toBe(0);
        expect(store.addEntity(object.uuid, object, {x: 9})).toBe(0);

        expect(store.count).toBe(1);
        expect(store.getFieldValue(object.uuid, "x")).toBe(4);

        store.dispose();
    });

    it("swap-removes entities while preserving moved field data and refs", () => {
        const store = new ComponentStore(schema, 3);
        const first = createObject("first");
        const second = createObject("second");
        const third = createObject("third");
        const firstData = {x: 1, state: 10};
        const secondData = {x: 2, state: 20};
        const thirdData = {x: 3, state: 30};

        store.addEntity(first.uuid, first, firstData);
        store.addEntity(second.uuid, second, secondData);
        store.addEntity(third.uuid, third, thirdData);

        store.removeEntity(second.uuid);

        expect(store.count).toBe(2);
        expect(store.hasEntity(second.uuid)).toBe(false);
        expect(store.getIndex(third.uuid)).toBe(1);
        expect(store.getObject(1)).toBe(third);
        expect(store.getData(1)).toBe(thirdData);
        expect(store.getFieldValue(third.uuid, "x")).toBe(3);
        expect(store.getFieldValue(third.uuid, "state")).toBe(30);
        expect(store.getObject(2)).toBeNull();
        expect(store.getData(2)).toBeNull();

        store.dispose();
    });

    it("exposes live object and data refs for hot SoA loops without copying", () => {
        const store = new ComponentStore(schema, 2);
        const first = createObject("first");
        const second = createObject("second");
        const firstData = {};
        const secondData = {};

        store.addEntity(first.uuid, first, firstData);
        const refs = store.getObjectRefs();
        const dataRefs = store.getDataRefs();
        store.addEntity(second.uuid, second, secondData);

        expect(refs[0]).toBe(first);
        expect(refs[1]).toBe(second);
        expect(dataRefs[0]).toBe(firstData);
        expect(dataRefs[1]).toBe(secondData);

        store.removeEntity(first.uuid);

        expect(refs[0]).toBe(second);
        expect(refs[1]).toBeNull();
        expect(dataRefs[0]).toBe(secondData);
        expect(dataRefs[1]).toBeNull();

        store.dispose();
    });

    it("keeps live object and data refs valid when growth increases capacity", () => {
        const store = new ComponentStore(schema, 1);
        const first = createObject("first");
        const second = createObject("second");
        const firstData = {};
        const secondData = {};

        store.addEntity(first.uuid, first, firstData);
        const refs = store.getObjectRefs();
        const dataRefs = store.getDataRefs();

        store.addEntity(second.uuid, second, secondData);

        expect(store.capacity).toBeGreaterThanOrEqual(2);
        expect(store.getObjectRefs()).toBe(refs);
        expect(store.getDataRefs()).toBe(dataRefs);
        expect(refs[0]).toBe(first);
        expect(refs[1]).toBe(second);
        expect(dataRefs[0]).toBe(firstData);
        expect(dataRefs[1]).toBe(secondData);

        store.removeEntity(first.uuid);

        expect(refs[0]).toBe(second);
        expect(refs[1]).toBeNull();
        expect(dataRefs[0]).toBe(secondData);
        expect(dataRefs[1]).toBeNull();

        store.dispose();
    });

    it("can refresh a tracked entity's component data reference", () => {
        const store = new ComponentStore(schema, 1);
        const object = createObject("entity");
        const firstData = {x: 2};
        const secondData = {x: 8};

        store.addEntity(object.uuid, object, firstData);
        store.setEntityData(object.uuid, secondData);

        expect(store.getData(0)).toBe(secondData);
        expect(store.getDataRefs()[0]).toBe(secondData);

        store.dispose();
    });
});
