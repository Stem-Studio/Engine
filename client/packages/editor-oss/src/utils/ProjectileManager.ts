import * as THREE from "three";

import {createObjectPool, ObjectPool} from "./ObjectPool";

export interface ProjectileDefinition {
    id: string;
    speed: number;
    gravity?: number;
    lifetime?: number;
    spread?: number;
    damage?: number;
    radius?: number;
    onHit?: (hit: ProjectileHit) => void;
}

export interface ProjectileHit {
    point: THREE.Vector3;
    normal: THREE.Vector3;
    object: THREE.Object3D;
    projectileDefinition: ProjectileDefinition;
    damage: number;
}

export interface LaunchParams {
    definitionId: string;
    origin: THREE.Vector3;
    direction: THREE.Vector3;
    owner?: THREE.Object3D;
}

interface ActiveProjectile {
    mesh: THREE.Mesh;
    velocity: THREE.Vector3;
    prevPosition: THREE.Vector3;
    definition: ProjectileDefinition;
    elapsed: number;
    owner: THREE.Object3D | null;
}

export interface ProjectileManager {
    registerDefinition(def: ProjectileDefinition): void;
    launch(params: LaunchParams): void;
    update(dt: number): void;
    dispose(): void;
    getActiveCount(): number;
}

// Pre-allocated temp vectors to avoid per-frame GC
const _tempVec3A = new THREE.Vector3();
const _tempVec3B = new THREE.Vector3();
const _tempDirection = new THREE.Vector3();
const _raycaster = new THREE.Raycaster();
const _raycastHits: THREE.Intersection[] = [];
const _fallbackNormal = new THREE.Vector3(0, 1, 0);

/**
 *
 * @param scene
 */
export function createProjectileManager(scene: THREE.Scene): ProjectileManager {
    const definitions = new Map<string, ProjectileDefinition>();
    const active: ActiveProjectile[] = [];
    const projectilePool: ActiveProjectile[] = [];
    const projectileMeshes = new Set<THREE.Object3D>();
    const raycastTargets: THREE.Object3D[] = [];
    const maxPooledProjectiles = 256;

    const sharedGeometry = new THREE.SphereGeometry(0.05, 6, 4);
    const sharedMaterial = new THREE.MeshBasicMaterial({ color: 0xffaa00 });

    const meshPool: ObjectPool<THREE.Mesh> = createObjectPool({
        create: () => new THREE.Mesh(sharedGeometry, sharedMaterial),
        reset: (mesh) => {
            mesh.position.set(0, 0, 0);
            mesh.visible = false;
        },
        maxSize: maxPooledProjectiles,
    });

    function getProjectileState(mesh: THREE.Mesh, def: ProjectileDefinition, params: LaunchParams): ActiveProjectile {
        const projectile = projectilePool.pop() ?? {
            mesh,
            velocity: new THREE.Vector3(),
            prevPosition: new THREE.Vector3(),
            definition: def,
            elapsed: 0,
            owner: null,
        };

        projectile.mesh = mesh;
        projectile.velocity.copy(_tempDirection).multiplyScalar(def.speed);
        projectile.prevPosition.copy(params.origin);
        projectile.definition = def;
        projectile.elapsed = 0;
        projectile.owner = params.owner ?? null;
        return projectile;
    }

    /**
     *
     * @param index
     */
    function destroyProjectile(index: number): void {
        const proj = active[index]!;
        projectileMeshes.delete(proj.mesh);
        scene.remove(proj.mesh);
        proj.mesh.visible = false;
        meshPool.release(proj.mesh);

        // Swap-remove for O(1) deletion
        const last = active.pop()!;
        if (index < active.length) {
            active[index] = last;
        }
        proj.owner = null;
        proj.elapsed = 0;
        if (projectilePool.length < maxPooledProjectiles) {
            projectilePool.push(proj);
        }
    }

    function collectRaycastTargets(): THREE.Object3D[] {
        raycastTargets.length = 0;
        const children = scene.children;
        for (let i = 0, l = children.length; i < l; i++) {
            const child = children[i];
            if (child && !projectileMeshes.has(child)) {
                raycastTargets.push(child);
            }
        }
        return raycastTargets;
    }

    return {
        registerDefinition(def: ProjectileDefinition): void {
            definitions.set(def.id, def);
        },

        launch(params: LaunchParams): void {
            const def = definitions.get(params.definitionId);
            if (!def) return;

            const mesh = meshPool.get();
            mesh.position.copy(params.origin);
            mesh.scale.setScalar((def.radius ?? 0.1) / 0.05); // Scale relative to base geometry radius
            mesh.visible = true;
            scene.add(mesh);
            projectileMeshes.add(mesh);

            _tempDirection.copy(params.direction).normalize();

            // Apply spread
            if (def.spread && def.spread > 0) {
                _tempDirection.x += (Math.random() - 0.5) * def.spread;
                _tempDirection.y += (Math.random() - 0.5) * def.spread;
                _tempDirection.z += (Math.random() - 0.5) * def.spread;
                _tempDirection.normalize();
            }

            active.push(getProjectileState(mesh, def, params));
        },

        update(dt: number): void {
            for (let i = active.length - 1; i >= 0; i--) {
                const proj = active[i]!;
                const def = proj.definition;
                proj.elapsed += dt;

                // Lifetime check
                if (proj.elapsed >= (def.lifetime ?? 5)) {
                    destroyProjectile(i);
                    continue;
                }

                // Store previous position for raycast
                proj.prevPosition.copy(proj.mesh.position);

                // Apply gravity
                if (def.gravity && def.gravity > 0) {
                    proj.velocity.y -= def.gravity * dt;
                }

                // Move
                _tempVec3A.copy(proj.velocity).multiplyScalar(dt);
                proj.mesh.position.add(_tempVec3A);

                // Collision detection via raycast from prev to current position
                _tempVec3B.copy(proj.mesh.position).sub(proj.prevPosition);
                const distance = _tempVec3B.length();

                if (distance > 0.001) {
                    _raycaster.set(proj.prevPosition, _tempVec3B.normalize());
                    _raycaster.far = distance;

                    _raycastHits.length = 0;
                    const targets = collectRaycastTargets();
                    if (targets.length > 0) {
                        _raycaster.intersectObjects(targets, true, _raycastHits);
                    }
                    for (let j = 0; j < _raycastHits.length; j++) {
                        const hit = _raycastHits[j]!;
                        // Skip owner and projectile meshes
                        if (proj.owner && isChildOf(hit.object, proj.owner)) continue;
                        if (hit.object === proj.mesh) continue;

                        if (def.onHit) {
                            def.onHit({
                                point: hit.point,
                                normal: hit.face?.normal ?? _fallbackNormal,
                                object: hit.object,
                                projectileDefinition: def,
                                damage: def.damage ?? 1,
                            });
                        }

                        destroyProjectile(i);
                        break;
                    }
                    _raycastHits.length = 0;
                }
            }
        },

        dispose(): void {
            for (let i = active.length - 1; i >= 0; i--) {
                destroyProjectile(i);
            }
            meshPool.clear();
            projectilePool.length = 0;
            projectileMeshes.clear();
            raycastTargets.length = 0;
            sharedGeometry.dispose();
            sharedMaterial.dispose();
            definitions.clear();
        },

        getActiveCount(): number {
            return active.length;
        },
    };
}

/**
 *
 * @param object
 * @param parent
 */
function isChildOf(object: THREE.Object3D, parent: THREE.Object3D): boolean {
    let current: THREE.Object3D | null = object;
    while (current) {
        if (current === parent) return true;
        current = current.parent;
    }
    return false;
}
