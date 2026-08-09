import { BufferGeometry, Float32BufferAttribute, Group, Mesh, BoxGeometry, MeshBasicMaterial, Object3D, Scene } from 'three';
import { afterEach, vi } from 'vitest';

import { TemplateType } from '../types/TemplateType';
import { cloneObject, getObjectTemplateFromScene, getVertexCount, setObjectTemplate } from './ObjectUtils';

function addDeepChain(root: Object3D, depth = 12_000): Object3D {
    let cursor = root;
    for (let i = 0; i < depth; i++) {
        const child = new Object3D();
        cursor.add(child);
        cursor = child;
    }
    return cursor;
}

describe('cloneObject', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('should clone an object with new UUIDs', () => {
        const original = new Group();
        original.name = 'Parent';
        const child = new Mesh(new BoxGeometry(), new MeshBasicMaterial());
        child.name = 'Child';
        original.add(child);

        const clone = cloneObject(original);

        expect(clone.uuid).not.toBe(original.uuid);
        expect(clone.children[0]?.uuid).not.toBe(child.uuid);
        expect(clone.name).toBe('Parent');
        expect(clone.children[0]?.name).toBe('Child');
    });

    it('should remap behavior object attributes to cloned UUIDs', () => {
        const parent = new Group();
        const child1 = new Mesh(new BoxGeometry(), new MeshBasicMaterial());
        const child2 = new Mesh(new BoxGeometry(), new MeshBasicMaterial());
        parent.add(child1);
        parent.add(child2);

        // Add behavior with object attribute referencing child1
        child2.userData.behaviors = [{
            id: 'test-behavior',
            uuid: 'behavior-uuid',
            attributesData: {
                targetObject: child1.uuid,
            },
        }];

        const clone = cloneObject(parent);
        const clonedChild1 = clone.children[0];
        const clonedChild2 = clone.children[1];
        const clonedBehavior = clonedChild2?.userData.behaviors[0];

        // The attribute should now reference the cloned child1's UUID
        expect(clonedBehavior.attributesData.targetObject).toBe(clonedChild1?.uuid);
        expect(clonedBehavior.attributesData.targetObject).not.toBe(child1.uuid);
    });

    it('should remap behavior object attributes in arrays', () => {
        const parent = new Group();
        const child1 = new Mesh(new BoxGeometry(), new MeshBasicMaterial());
        const child2 = new Mesh(new BoxGeometry(), new MeshBasicMaterial());
        const child3 = new Mesh(new BoxGeometry(), new MeshBasicMaterial());
        parent.add(child1);
        parent.add(child2);
        parent.add(child3);

        // Add behavior with array of object references
        child3.userData.behaviors = [{
            id: 'test-behavior',
            uuid: 'behavior-uuid',
            attributesData: {
                targets: [child1.uuid, child2.uuid],
            },
        }];

        const clone = cloneObject(parent);
        const clonedChild1 = clone.children[0];
        const clonedChild2 = clone.children[1];
        const clonedChild3 = clone.children[2];
        const clonedBehavior = clonedChild3?.userData.behaviors[0];

        expect(clonedBehavior.attributesData.targets).toEqual([
            clonedChild1?.uuid,
            clonedChild2?.uuid,
        ]);
        expect(clonedBehavior.attributesData.targets[0]).not.toBe(child1.uuid);
        expect(clonedBehavior.attributesData.targets[1]).not.toBe(child2.uuid);
    });

    it('should remap behavior object attributes in nested objects', () => {
        const parent = new Group();
        const child1 = new Mesh(new BoxGeometry(), new MeshBasicMaterial());
        const child2 = new Mesh(new BoxGeometry(), new MeshBasicMaterial());
        parent.add(child1);
        parent.add(child2);

        // Add behavior with nested object containing UUID reference
        child2.userData.behaviors = [{
            id: 'test-behavior',
            uuid: 'behavior-uuid',
            attributesData: {
                group: {
                    obj: child1.uuid,
                },
            },
        }];

        const clone = cloneObject(parent);
        const clonedChild1 = clone.children[0];
        const clonedChild2 = clone.children[1];
        const clonedBehavior = clonedChild2?.userData.behaviors[0];

        expect(clonedBehavior.attributesData.group.obj).toBe(clonedChild1?.uuid);
        expect(clonedBehavior.attributesData.group.obj).not.toBe(child1.uuid);
    });

    it('should remap behavior object attributes in arrays of objects', () => {
        const parent = new Group();
        const child1 = new Mesh(new BoxGeometry(), new MeshBasicMaterial());
        const child2 = new Mesh(new BoxGeometry(), new MeshBasicMaterial());
        const child3 = new Mesh(new BoxGeometry(), new MeshBasicMaterial());
        parent.add(child1);
        parent.add(child2);
        parent.add(child3);

        // Add behavior with array of objects containing UUID references
        child3.userData.behaviors = [{
            id: 'test-behavior',
            uuid: 'behavior-uuid',
            attributesData: {
                targets: [
                    { obj: child1.uuid, weight: 1.0 },
                    { obj: child2.uuid, weight: 0.5 },
                ],
            },
        }];

        const clone = cloneObject(parent);
        const clonedChild1 = clone.children[0];
        const clonedChild2 = clone.children[1];
        const clonedChild3 = clone.children[2];
        const clonedBehavior = clonedChild3?.userData.behaviors[0];

        expect(clonedBehavior.attributesData.targets[0].obj).toBe(clonedChild1?.uuid);
        expect(clonedBehavior.attributesData.targets[1].obj).toBe(clonedChild2?.uuid);
        expect(clonedBehavior.attributesData.targets[0].weight).toBe(1.0);
        expect(clonedBehavior.attributesData.targets[1].weight).toBe(0.5);
    });

    it('should populate provided uuidMap with old-to-new mappings', () => {
        const parent = new Group();
        const child = new Mesh(new BoxGeometry(), new MeshBasicMaterial());
        parent.add(child);

        const uuidMap = new Map<string, string>();
        const clone = cloneObject(parent, { uuidMap });

        expect(uuidMap.get(parent.uuid)).toBe(clone.uuid);
        expect(uuidMap.get(child.uuid)).toBe(clone.children[0]?.uuid);
    });

    it('should preserve non-UUID string values in behavior attributes', () => {
        const parent = new Group();
        parent.userData.behaviors = [{
            id: 'test-behavior',
            uuid: 'behavior-uuid',
            attributesData: {
                stringValue: 'hello-world',
                numberValue: 42,
                boolValue: true,
            },
        }];

        const clone = cloneObject(parent);
        const clonedBehavior = clone.userData.behaviors[0];

        expect(clonedBehavior.attributesData.stringValue).toBe('hello-world');
        expect(clonedBehavior.attributesData.numberValue).toBe(42);
        expect(clonedBehavior.attributesData.boolValue).toBe(true);
    });

    it('should assign new UUIDs to behaviors', () => {
        const object = new Group();
        object.userData.behaviors = [{
            id: 'test-behavior',
            uuid: 'original-behavior-uuid',
            attributesData: {},
        }];

        const clone = cloneObject(object);

        expect(clone.userData.behaviors[0].uuid).not.toBe('original-behavior-uuid');
        expect(clone.userData.behaviors[0].uuid).toMatch(
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
        );
    });

    it('should clone userData without stringifying the source payload', () => {
        const stringify = vi.spyOn(JSON, 'stringify');
        const object = new Group();
        object.userData = {
            label: 'clone-source',
            nested: { count: 2 },
            list: [1, { enabled: true }],
        };

        const clone = cloneObject(object);

        expect(stringify.mock.calls.some(call => call[0] === object.userData)).toBe(false);
        expect(clone.userData).toEqual(object.userData);
        expect(clone.userData).not.toBe(object.userData);
        expect(clone.userData.nested).not.toBe(object.userData.nested);
        expect(clone.userData.list).not.toBe(object.userData.list);
    });

    it('should reuse cloned material and geometry for repeated source references', () => {
        const parent = new Group();
        const geometry = new BoxGeometry();
        const material = new MeshBasicMaterial();
        const first = new Mesh(geometry, material);
        const second = new Mesh(geometry, material);
        parent.add(first, second);

        const clone = cloneObject(parent, {cloneMaterials: true, cloneGeometry: true});
        const firstClone = clone.children[0] as Mesh;
        const secondClone = clone.children[1] as Mesh;

        expect(firstClone.material).not.toBe(material);
        expect(firstClone.geometry).not.toBe(geometry);
        expect(firstClone.material).toBe(secondClone.material);
        expect(firstClone.geometry).toBe(secondClone.geometry);
    });

    it('should clone deep non-skinned hierarchies without recursive traversal', () => {
        const root = new Group();
        root.userData.children = [];
        const leaf = addDeepChain(root);
        leaf.userData.behaviors = [{
            id: 'deep-behavior',
            uuid: 'deep-behavior-uuid',
            attributesData: {
                target: root.uuid,
            },
        }];
        const traverse = vi.spyOn(root, 'traverse');

        const clone = cloneObject(root);

        let clonedLeaf: Object3D = clone;
        for (let i = 0; i < 12_000; i++) {
            clonedLeaf = clonedLeaf.children[0]!;
        }

        expect(traverse).not.toHaveBeenCalled();
        expect(clone.uuid).not.toBe(root.uuid);
        expect(clone.userData.children).toHaveLength(1);
        expect(clonedLeaf.userData.behaviors[0].attributesData.target).toBe(clone.uuid);
        expect(clonedLeaf.userData.behaviors[0].uuid).not.toBe('deep-behavior-uuid');
    });
});

describe('getVertexCount', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('should count vertices in deep hierarchies without recursive traversal', () => {
        const root = new Object3D();
        const leaf = addDeepChain(root);
        const geometry = new BufferGeometry();
        geometry.setAttribute("position", new Float32BufferAttribute([
            0, 0, 0,
            1, 0, 0,
            0, 1, 0,
        ], 3));
        leaf.add(new Mesh(geometry, new MeshBasicMaterial()));
        const traverse = vi.spyOn(root, 'traverse');

        expect(getVertexCount(root)).toBe(3);
        expect(traverse).not.toHaveBeenCalled();
    });
});

describe('getObjectTemplateFromScene', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('should find UUID templates in deep scenes without recursive Three lookups', () => {
        const scene = new Scene();
        const target = addDeepChain(scene);
        const object = new Object3D();
        setObjectTemplate(object, TemplateType.UUID, target.uuid);
        const getObjectByProperty = vi.spyOn(scene, 'getObjectByProperty').mockImplementation(() => {
            throw new Error('recursive object lookup should not be used');
        });
        const traverse = vi.spyOn(scene, 'traverse').mockImplementation(() => {
            throw new Error('recursive traversal should not be used');
        });

        expect(getObjectTemplateFromScene(object, scene)).toBe(target);
        expect(getObjectByProperty).not.toHaveBeenCalled();
        expect(traverse).not.toHaveBeenCalled();
    });
});
