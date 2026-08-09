import * as THREE from "three";
import {FBXLoader} from "three/addons/loaders/FBXLoader.js";
import {clone as cloneWithSkeleton} from "three/addons/utils/SkeletonUtils.js";

/**
 * Runtime humanoid rigging for static avatar GLBs.
 *
 * Many premade avatars in this codebase ship without an embedded
 * skeleton (no SkinnedMesh, no bones), so no animation clip can drive
 * them. This module loads a Mixamo template skeleton (from the
 * Idle/Walking/Slow Run/Jumping FBX files bundled under
 * `/assets/animations/mixamo/`), clones it, and re-binds every static
 * mesh on the avatar to that skeleton using simple inverse-distance
 * proximity weights. The result is a SkinnedMesh chain that the
 * Mixamo clips can play directly — their track names already match
 * the Mixamo bone names.
 *
 * Quality note: proximity weighting produces functional but visually
 * coarse deformation, especially around joints. Long-term, avatars
 * should be exported with proper skinning + their own clips; this is
 * a runtime stopgap.
 */

const MIXAMO_CLIPS: ReadonlyArray<{file: string; name: string}> = [
    {file: "Idle", name: "idle"},
    {file: "Walking", name: "walk"},
    {file: "Slow Run", name: "run"},
    {file: "Jumping", name: "jump"},
];

interface MixamoTemplate {
    /**
     * Live reference to the loaded Idle FBX scene root. We deep-clone
     * this with `SkeletonUtils.clone` whenever a new avatar needs to
     * be rigged so each rig gets its own independent skeleton.
     */
    sceneTemplate: THREE.Object3D;
    /** Name of the Hips bone inside `sceneTemplate`. */
    hipsBoneName: string;
    /** Idle / Walking / Slow Run / Jumping clips re-keyed to short names. */
    animations: THREE.AnimationClip[];
    /**
     * Total bind-pose skeleton extent (top-of-head to foot) in world
     * units. Used to scale the clone to fit the avatar 1:1.
     */
    totalHeight: number;
    /**
     * Distance from Hips world Y down to the lowest foot world Y, in
     * world units. Used to position the cloned skeleton so its feet
     * land on the avatar's floor.
     */
    hipsToFoot: number;
}

let cachedTemplate: Promise<MixamoTemplate> | null = null;

async function loadOneFbx(file: string): Promise<THREE.Group> {
    const url = `/assets/animations/mixamo/${encodeURIComponent(file)}.fbx`;
    console.debug(`[runtimeRig] FBX load start: ${url}`);
    const loader = new FBXLoader();
    return new Promise((resolve, reject) => {
        loader.load(
            url,
            group => {
                console.debug(`[runtimeRig] FBX load success: ${file}`, {
                    children: (group).children.length,
                    animations: (group).animations?.length ?? 0,
                });
                resolve(group);
            },
            progress => {
                if (progress.lengthComputable) {
                    const pct = ((progress.loaded / progress.total) * 100).toFixed(0);
                    console.debug(`[runtimeRig] FBX progress ${file}: ${pct}%`);
                }
            },
            err => {
                console.error(`[runtimeRig] FBX load FAILED: ${url}`, err);
                reject(err);
            },
        );
    });
}

function findFirstBone(group: THREE.Object3D, matcher: RegExp): THREE.Bone | null {
    let found: THREE.Bone | null = null;
    group.traverse(node => {
        if (found) return;
        if ((node as THREE.Bone).isBone && matcher.test(node.name)) found = node as THREE.Bone;
    });
    return found;
}

function collectBonesFromHierarchy(root: THREE.Object3D): THREE.Bone[] {
    const bones: THREE.Bone[] = [];
    root.traverse(n => {
        if ((n as THREE.Bone).isBone) bones.push(n as THREE.Bone);
    });
    return bones;
}

/**
 * Strip translation tracks from the clip except for the root (Hips),
 * and squash any remaining hips-translation amplitude so we don't
 * teleport the rigged avatar across the scene.
 *
 * Mixamo FBX clips encode positions in centimeters relative to the
 * FBX's native skeleton. Applying those values to our cloned bones
 * (which sit at avatar scale) flings limbs off-screen. Rotations are
 * unit-independent and carry all the visible articulation we want.
 */
function sanitizeClipForRuntimeRig(clip: THREE.AnimationClip): THREE.AnimationClip {
    const filtered = clip.tracks.filter(track => {
        const dotIdx = track.name.indexOf(".");
        if (dotIdx < 0) return true;
        const property = track.name.slice(dotIdx + 1);
        // Keep all rotations and scales. Drop every position track —
        // Mixamo's positions are non-trivial root-motion and per-bone
        // bind translations that don't survive our scale remap.
        return property !== "position";
    });
    return new THREE.AnimationClip(clip.name, clip.duration, filtered);
}

function loadTemplate(): Promise<MixamoTemplate> {
    if (cachedTemplate) {
        console.debug("[runtimeRig] loadTemplate() returning cached template");
        return cachedTemplate;
    }
    console.debug("[runtimeRig] loadTemplate() starting fresh load of all Mixamo FBX files");
    cachedTemplate = (async () => {
        const idleFbx = await loadOneFbx("Idle");

        // Mixamo animation-only FBX files have a bone hierarchy but
        // no SkinnedMesh. Walk the scene graph to find any Bone nodes
        // directly; we don't need a SkinnedMesh from the template.
        const hipsBone = findFirstBone(idleFbx, /hips$/i);
        if (!hipsBone) {
            // Log the full structure so we can see what's in here.
            const structure: string[] = [];
            idleFbx.traverse(n => structure.push(`${n.type}:${n.name || "<noname>"}`));
            console.error(
                "[runtimeRig] No Hips bone in Idle.fbx. Scene contents:",
                structure.slice(0, 30),
            );
            throw new Error("[runtimeRig] No Hips bone in Idle.fbx");
        }

        const templateBones = collectBonesFromHierarchy(idleFbx);
        if (templateBones.length === 0) {
            console.error("[runtimeRig] Hips bone found but no bones in scene graph");
            throw new Error("[runtimeRig] Empty bone hierarchy in Idle.fbx");
        }

        const hipsWorld = new THREE.Vector3();
        const headWorld = new THREE.Vector3();
        const footWorld = new THREE.Vector3();
        idleFbx.updateMatrixWorld(true);
        hipsBone.getWorldPosition(hipsWorld);
        const headBone = findFirstBone(idleFbx, /head$/i) ?? hipsBone;
        headBone.getWorldPosition(headWorld);
        // Lowest foot Y across both feet — closest to true bind-pose
        // ground plane.
        const leftFoot = findFirstBone(idleFbx, /leftfoot$/i);
        const rightFoot = findFirstBone(idleFbx, /rightfoot$/i);
        if (leftFoot) {
            leftFoot.getWorldPosition(footWorld);
        } else if (rightFoot) {
            rightFoot.getWorldPosition(footWorld);
        } else {
            footWorld.copy(hipsWorld);
        }
        if (rightFoot) {
            const tmp = new THREE.Vector3();
            rightFoot.getWorldPosition(tmp);
            if (tmp.y < footWorld.y) footWorld.copy(tmp);
        }
        const totalHeight = Math.abs(headWorld.y - footWorld.y) || 1;
        const hipsToFoot = Math.abs(hipsWorld.y - footWorld.y) || totalHeight * 0.55;

        const animations: THREE.AnimationClip[] = [];
        if (idleFbx.animations[0]) {
            const rawClip = idleFbx.animations[0].clone();
            rawClip.name = "idle";
            const clip = sanitizeClipForRuntimeRig(rawClip);
            clip.name = "idle";
            animations.push(clip);
            console.debug("[runtimeRig] idle clip tracks (post-sanitize):", {
                originalCount: rawClip.tracks.length,
                sanitizedCount: clip.tracks.length,
                first5: clip.tracks.slice(0, 5).map(t => t.name),
            });
        }
        console.debug(
            "[runtimeRig] template bones (first 12):",
            templateBones.slice(0, 12).map(b => b.name),
            "total:",
            templateBones.length,
        );
        for (const {file, name} of MIXAMO_CLIPS.slice(1)) {
            try {
                const fbx = await loadOneFbx(file);
                if (fbx.animations[0]) {
                    const rawClip = fbx.animations[0].clone();
                    rawClip.name = name;
                    const clip = sanitizeClipForRuntimeRig(rawClip);
                    clip.name = name;
                    animations.push(clip);
                }
            } catch (err) {
                console.warn(`[runtimeRig] Failed to load ${file}.fbx`, err);
            }
        }

        console.debug("[runtimeRig] template measurements", {
            totalHeight,
            hipsToFoot,
            hipsWorldY: hipsWorld.y,
            headWorldY: headWorld.y,
            footWorldY: footWorld.y,
        });

        return {
            sceneTemplate: idleFbx,
            hipsBoneName: hipsBone.name,
            animations,
            totalHeight,
            hipsToFoot,
        };
    })();
    return cachedTemplate;
}

export interface RigResult {
    /**
     * User-facing "skeleton root" pivot. Wraps the cloned FBX scene
     * and is where artists adjust placement via TransformControls.
     * Persisted overrides store this pivot's transform, not the
     * inner Hips bone (which keeps the FBX's native local scale).
     */
    rigPivot: THREE.Object3D;
    /** The Hips bone inside the cloned scene; useful for debugging. */
    rootBone: THREE.Bone;
    /** The shared skeleton driving every SkinnedMesh in this rig. */
    skeleton: THREE.Skeleton;
    /** Standard locomotion clips, named `idle` / `walk` / `run` / `jump`. */
    animations: THREE.AnimationClip[];
    /** SkinnedMesh nodes that replaced the avatar's original static meshes. */
    skinnedMeshes: THREE.SkinnedMesh[];
    /** True when a persisted override was applied (skip auto-Smart-Fit). */
    hasOverride: boolean;
    /** Pivot transform captured right after the initial auto-fit; used by Reset. */
    defaultPivotTransform: {
        position: [number, number, number];
        quaternion: [number, number, number, number];
        scale: number;
    };
}

/**
 * Persistent override for the cloned skeleton's root transform.
 * The avatar test loop runs in the browser, so we persist via
 * localStorage keyed by the caller's `rigKey` (collection name,
 * avatar style, etc.). When an entry exists, the rig honours it
 * instead of the auto-fit calculation, letting an artist dial the
 * skeleton onto an avatar manually during onboarding.
 */
export interface SkeletonOverride {
    /** Top-level pivot transform (whole skeleton placement). */
    position: [number, number, number];
    quaternion: [number, number, number, number];
    scale: number;
    /**
     * Optional per-bone transform overrides, keyed by bone name.
     * When present, each entry replaces the bone's local
     * position/quaternion/scale before the bind pose is captured.
     */
    bones?: Record<
        string,
        {
            position: [number, number, number];
            quaternion: [number, number, number, number];
            scale: [number, number, number];
        }
    >;
}

// Bump the prefix when the Smart-Fit defaults change in a way that
// makes previously-saved overrides land in the wrong place. Stale
// entries from earlier sessions stay in localStorage but are
// effectively ignored.
const OVERRIDE_KEY_PREFIX = "stemstudio.avatarCreator.skeletonOverride.v4.";

export function loadSkeletonOverride(rigKey: string): SkeletonOverride | null {
    try {
        const raw = localStorage.getItem(OVERRIDE_KEY_PREFIX + rigKey);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as SkeletonOverride;
        if (
            !Array.isArray(parsed.position) ||
            !Array.isArray(parsed.quaternion) ||
            typeof parsed.scale !== "number"
        ) {
            return null;
        }
        return parsed;
    } catch {
        return null;
    }
}

export function saveSkeletonOverride(rigKey: string, override: SkeletonOverride): void {
    try {
        localStorage.setItem(OVERRIDE_KEY_PREFIX + rigKey, JSON.stringify(override));
    } catch (e) {
        console.warn("[runtimeRig] Failed to persist skeleton override", e);
    }
}

export function clearSkeletonOverride(rigKey: string): void {
    try {
        localStorage.removeItem(OVERRIDE_KEY_PREFIX + rigKey);
    } catch {
        /* noop */
    }
}

/**
 * Reshape the cloned skeleton from Mixamo's T-pose bind into A-pose.
 * A-pose drapes more naturally over avatars whose meshes were
 * authored at-rest with arms at the sides.
 *
 * Mixamo arm bones have their local +Y axis pointing down the bone
 * (from shoulder toward elbow), so rotating around local Z swings
 * the arm in the shoulder plane. The signs below come out of the
 * Mixamo retargeting cookbook: +Z for left arm bends the arm down,
 * -Z for right arm does the mirror.
 *
 * We rotate Arm (upper arm) by ~50° and ForeArm by ~5° so the
 * forearm doesn't end up sticking out at a right angle once the
 * upper arm drops. Shoulders are left alone — Mixamo's shoulder
 * bones are already neutral.
 */
function applyAPoseToBones(bones: THREE.Bone[]): void {
    const findEndsWith = (suffix: string): THREE.Bone | undefined => {
        const s = suffix.toLowerCase();
        return bones.find(b => b.name.toLowerCase().endsWith(s));
    };

    const rotateLocalZ = (bone: THREE.Bone | undefined, degrees: number) => {
        if (!bone) return;
        const q = new THREE.Quaternion().setFromAxisAngle(
            new THREE.Vector3(0, 0, 1),
            THREE.MathUtils.degToRad(degrees),
        );
        bone.quaternion.multiply(q);
    };

    rotateLocalZ(findEndsWith("LeftArm"), 50);
    rotateLocalZ(findEndsWith("RightArm"), -50);
    rotateLocalZ(findEndsWith("LeftForeArm"), 5);
    rotateLocalZ(findEndsWith("RightForeArm"), -5);
}

/**
 * Clone the source scene's bone hierarchy by leaning on
 * `SkeletonUtils.clone`, which is the standard three.js helper for
 * duplicating skinned/boned hierarchies. It preserves local
 * positions, quaternions, and scales consistently — earlier hand-
 * rolled clone attempts mixed world-frame positions with local-frame
 * rotations and produced inverted limbs (legs ending up above the
 * head). The cloned hierarchy keeps the Mixamo FBX's native scale,
 * so callers must compute their own fit transform on top of it.
 */
function cloneBoneHierarchy(
    sceneTemplate: THREE.Object3D,
    hipsBoneName: string,
): {root: THREE.Bone; bones: THREE.Bone[]; clonedScene: THREE.Object3D} {
    const clonedScene = cloneWithSkeleton(sceneTemplate);
    clonedScene.updateMatrixWorld(true);

    let root: THREE.Bone | null = null;
    clonedScene.traverse(n => {
        if (!root && (n as THREE.Bone).isBone && n.name === hipsBoneName) {
            root = n as THREE.Bone;
        }
    });
    if (!root) {
        throw new Error(`[runtimeRig] Hips bone "${hipsBoneName}" not found in cloned scene`);
    }

    const bones: THREE.Bone[] = [];
    (root as THREE.Bone).traverse(n => {
        if ((n as THREE.Bone).isBone) bones.push(n as THREE.Bone);
    });
    return {root, bones, clonedScene};
}

/**
 * Replace every static mesh on `avatar` with a SkinnedMesh bound to a
 * fresh clone of the Mixamo template skeleton. Returns the bones and
 * clips so the caller can play animations on the result.
 */
export async function rigStaticAvatar(
    avatar: THREE.Object3D,
    options: {
        rigKey?: string;
        /**
         * External override blob, typically fetched from the
         * per-collection backend store. When present it takes
         * precedence over any localStorage entry under `rigKey`.
         */
        externalOverride?: SkeletonOverride | null;
    } = {},
): Promise<RigResult> {
    console.debug("[runtimeRig] rigStaticAvatar() entry", {
        avatarName: avatar.name,
        avatarType: avatar.type,
        avatarPosition: avatar.position.toArray(),
        avatarScale: avatar.scale.toArray(),
        childCount: avatar.children.length,
    });

    // Walk avatar BEFORE rigging to log structure.
    const inventory: {meshes: string[]; skinnedMeshes: string[]; bones: string[]; groups: string[]} = {
        meshes: [],
        skinnedMeshes: [],
        bones: [],
        groups: [],
    };
    avatar.traverse(n => {
        const asMesh = n as THREE.Mesh;
        const asSkinned = n as THREE.SkinnedMesh;
        const asBone = n as THREE.Bone;
        if (asSkinned.isSkinnedMesh) inventory.skinnedMeshes.push(n.name || "<unnamed>");
        else if (asMesh.isMesh) inventory.meshes.push(n.name || "<unnamed>");
        else if (asBone.isBone) inventory.bones.push(n.name || "<unnamed>");
        else if (n.type === "Group" || n.type === "Object3D") inventory.groups.push(n.name || "<unnamed>");
    });
    console.debug("[runtimeRig] pre-rig avatar inventory", inventory);

    const template = await loadTemplate();

    // Snapshot avatar bounds before mutating the hierarchy.
    const box = new THREE.Box3().setFromObject(avatar);
    const avatarHeight = box.max.y - box.min.y || 1;
    console.debug("[runtimeRig] avatar bounds", {
        min: box.min.toArray(),
        max: box.max.toArray(),
        height: avatarHeight,
        templateTotalHeight: template.totalHeight,
        templateHipsToFoot: template.hipsToFoot,
    });
    // Don't trust the source-measured height — the FBX Armature
    // scale lives in a different transform chain than our cloned
    // scene's. We'll re-measure after parenting and apply scale then.
    void template;
    const placeholderScale = 1;

    const {
        root: clonedRoot,
        bones: clonedBones,
        clonedScene,
    } = cloneBoneHierarchy(template.sceneTemplate, template.hipsBoneName);

    // Apply A-pose rotations BEFORE capturing bind inverses so the
    // bind pose IS A-pose. Animations rotate relative to bind, so
    // playing T-pose-keyed Mixamo clips on an A-pose bind still gives
    // a usable result; meshes authored at-rest with arms at the side
    // deform much better against A-pose.
    applyAPoseToBones(clonedBones);

    // Wrap the cloned FBX scene in our own pivot. The clonedScene
    // keeps the FBX's internal Armature scale (which converts cm →
    // meters), so the bones come out at human size. The pivot applies
    // a uniform avatar-fit scale + position on top, and is the
    // single Object3D the user manipulates via TransformControls.
    const rigPivot = new THREE.Group();
    rigPivot.name = "RuntimeRigPivot";
    rigPivot.add(clonedScene);

    // External override (backend, per-collection) takes precedence
    // over localStorage. localStorage is now strictly a workspace for
    // admin-side detection that hasn't been saved yet — non-admin
    // users get their fit from the backend.
    //
    // We only consume the PER-BONE part of the override here. The
    // rigPivot's position / scale are always recomputed by the
    // measure-then-fit step below — that way the rig is always
    // anchored to the avatar's actual bbox even when the override
    // was authored against a slightly different mesh (different
    // body shape, different camera-positioned teleporter, ...).
    // Persisting an absolute rigPivot.position made saved overrides
    // place the skeleton metres away from any new avatar.
    const override =
        options.externalOverride ??
        (options.rigKey ? loadSkeletonOverride(options.rigKey) : null);
    if (override?.bones) {
        for (const bone of clonedBones) {
            const entry = override.bones[bone.name];
            if (!entry) continue;
            bone.position.fromArray(entry.position);
            bone.quaternion.fromArray(entry.quaternion);
            bone.scale.fromArray(entry.scale);
        }
        console.debug("[runtimeRig] using saved per-bone override", {
            rigKey: options.rigKey,
            boneOverrideCount: Object.keys(override.bones).length,
        });
    } else if (override) {
        console.debug("[runtimeRig] saved override has no per-bone data; using auto-fit only", {
            rigKey: options.rigKey,
        });
    }
    rigPivot.scale.setScalar(placeholderScale);
    rigPivot.position.set(0, 0, 0);

    avatar.add(rigPivot);
    avatar.updateMatrixWorld(true);

    // The measure-then-fit step ALWAYS runs now (even when there's
    // an override), so the rig anchors to the live avatar bbox.
    {
        // === Measure-then-fit ===
        // Now that the cloned scene is parented under rigPivot and
        // matrices are flushed, measure the skeleton's actual world
        // extent (head Y down to lowest foot Y). This combines every
        // intrinsic transform in the chain — FBX Armature scale,
        // any per-bone scale — into a single world value we can
        // divide into for a true 1:1 fit.

        // Measure the FULL bone extent — every bone's world Y goes
        // into a min/max. Using just Head bone (base of skull, at the
        // chin) → LeftFoot bone (ankle) made the skeleton ~25 cm too
        // tall because SkeletonHelper draws all the way to
        // HeadTop_End and Toe_End, which are above / below those
        // reference bones.
        const tmp = new THREE.Vector3();
        let topY = -Infinity;
        let botY = Infinity;
        for (const b of clonedBones) {
            b.getWorldPosition(tmp);
            if (tmp.y > topY) topY = tmp.y;
            if (tmp.y < botY) botY = tmp.y;
        }
        if (!Number.isFinite(topY) || !Number.isFinite(botY)) {
            clonedRoot.getWorldPosition(tmp);
            topY = tmp.y + 1;
            botY = tmp.y;
        }

        const clonedTotalHeight = Math.max(topY - botY, 1e-3);
        const fitScale = avatarHeight / clonedTotalHeight;
        rigPivot.scale.setScalar(fitScale);
        avatar.updateMatrixWorld(true);

        // Re-resolve foot bones (used below for floor alignment).
        const leftFootClone = clonedBones.find(b => /leftfoot$/i.test(b.name));
        const rightFootClone = clonedBones.find(b => /rightfoot$/i.test(b.name));

        // After scaling, find the LOWEST bone-tip world Y (covers
        // Toe_End, not just Foot/ankle) so the rig actually sits on
        // the avatar floor instead of floating above it.
        let lowestBoneY = Infinity;
        for (const b of clonedBones) {
            b.getWorldPosition(tmp);
            if (tmp.y < lowestBoneY) lowestBoneY = tmp.y;
        }

        const feetXs: number[] = [];
        const feetZs: number[] = [];
        for (const foot of [leftFootClone, rightFootClone]) {
            if (!foot) continue;
            foot.getWorldPosition(tmp);
            feetXs.push(tmp.x);
            feetZs.push(tmp.z);
        }
        if (Number.isFinite(lowestBoneY) && feetXs.length > 0) {
            const center = new THREE.Vector3();
            box.getCenter(center);
            const avgFootX = feetXs.reduce((s, x) => s + x, 0) / feetXs.length;
            const avgFootZ = feetZs.reduce((s, z) => s + z, 0) / feetZs.length;
            rigPivot.position.x += center.x - avgFootX;
            rigPivot.position.y += box.min.y - lowestBoneY;
            rigPivot.position.z += center.z - avgFootZ;
            avatar.updateMatrixWorld(true);
        }

        console.debug("[runtimeRig] auto-fit (full-extent)", {
            avatarHeight,
            measuredBoneSpan: clonedTotalHeight,
            fitScale,
            lowestBoneY,
            finalPivotPosition: rigPivot.position.toArray(),
        });
    }

    const boneInverses = clonedBones.map(b => new THREE.Matrix4().copy(b.matrixWorld).invert());
    const skeleton = new THREE.Skeleton(clonedBones, boneInverses);

    // Pre-compute world-space bone positions for weighting.
    const bonePositions = clonedBones.map(b => {
        const p = new THREE.Vector3();
        b.getWorldPosition(p);
        return p;
    });

    // Pre-compute world-space bone SEGMENTS for weighting. A bone's
    // segment runs from its own world position to its first bone-child's
    // world position. Vertices weight against the closest point on this
    // segment, not against the bone's origin. This fixes the classic
    // "shoulder blob" / "chest follows the upper-spine point" failure
    // modes of pure point-distance proximity skinning — vertices on the
    // upper arm now belong to the upper arm bone, not whichever of
    // {shoulder, elbow} happens to be a few millimetres closer.
    interface BoneSegment {
        start: THREE.Vector3;
        end: THREE.Vector3;
        dir: THREE.Vector3; // end - start (NOT normalized)
        lenSq: number;      // |end - start|^2; 0 for leaf bones
    }
    const boneSegments: BoneSegment[] = clonedBones.map((bone, idx) => {
        const start = bonePositions[idx]!.clone();
        let end = start.clone();
        // First BONE child gives us the natural bone segment.
        for (const c of bone.children) {
            if ((c as THREE.Bone).isBone) {
                (c as THREE.Bone).getWorldPosition(end);
                break;
            }
        }
        const dir = end.clone().sub(start);
        return {start, end, dir, lenSq: dir.lengthSq()};
    });

    // Closest distance squared from a point to a bone segment.
    // For zero-length (leaf) segments this falls back to point distance.
    const distSqToSegment = (() => {
        const ap = new THREE.Vector3();
        return (p: THREE.Vector3, seg: BoneSegment): number => {
            if (seg.lenSq < 1e-12) return p.distanceToSquared(seg.start);
            ap.copy(p).sub(seg.start);
            // t = clamp((p - start) · dir / |dir|^2, 0, 1)
            let t = ap.dot(seg.dir) / seg.lenSq;
            if (t < 0) t = 0;
            else if (t > 1) t = 1;
            // closest = start + dir * t
            ap.copy(seg.dir).multiplyScalar(t).add(seg.start);
            return ap.distanceToSquared(p);
        };
    })();

    console.debug("[runtimeRig] skeleton placed", {
        rootPosition: clonedRoot.position.toArray(),
        rootScale: clonedRoot.scale.toArray(),
        firstBoneName: clonedBones[0]?.name,
        firstBoneWorldPos: bonePositions[0]?.toArray(),
        lastBoneName: clonedBones[clonedBones.length - 1]?.name,
        lastBoneWorldPos: bonePositions[bonePositions.length - 1]?.toArray(),
        boneYRange: {
            min: Math.min(...bonePositions.map(p => p.y)),
            max: Math.max(...bonePositions.map(p => p.y)),
        },
    });

    // Gather static meshes (skip any pre-existing SkinnedMeshes — the
    // avatar might already be partly rigged).
    const staticMeshes: THREE.Mesh[] = [];
    avatar.traverse(n => {
        const asMesh = n as THREE.Mesh;
        const asSkinned = n as THREE.SkinnedMesh;
        if (asMesh.isMesh && !asSkinned.isSkinnedMesh) staticMeshes.push(asMesh);
    });

    console.debug("[runtimeRig] static meshes to rig:", staticMeshes.length, staticMeshes.map(m => ({
        name: m.name || "<unnamed>",
        vertices: m.geometry?.attributes.position?.count ?? 0,
    })));

    const skinnedMeshes: THREE.SkinnedMesh[] = [];
    const tmpVert = new THREE.Vector3();

    for (const mesh of staticMeshes) {
        if (!mesh.geometry || !mesh.geometry.attributes.position) {
            console.warn(`[runtimeRig] skipping mesh "${mesh.name}" — no geometry/position attr`);
            continue;
        }

        mesh.updateMatrixWorld(true);

        const geo = mesh.geometry.clone();
        const pos = geo.attributes.position;
        if (!pos) continue;
        const count = pos.count;
        const skinIndices = new Uint16Array(count * 4);
        const skinWeights = new Float32Array(count * 4);

        // Weight against world-space bone-segment distances, but keep
        // the geometry in its original local space so the SkinnedMesh
        // can replace the static mesh in-place (same parent, same
        // local transform).
        //
        // FALLOFF=4 is softer than the old point-distance loop's 6
        // because segment distance already concentrates weight along
        // the right bone — we don't need an extra-sharp curve on top
        // to keep neighbour bones from leaking. Softer falloff =
        // smoother blends at joints (shoulder, elbow, hip) which look
        // far more natural under animation.
        const FALLOFF = 4;
        const EPS = 1e-4;
        for (let i = 0; i < count; i++) {
            tmpVert.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);

            // Top-4 nearest BONE SEGMENTS by squared distance to the
            // segment (not the bone origin).
            let i0 = 0, i1 = 0, i2 = 0, i3 = 0;
            let d0 = Infinity, d1 = Infinity, d2 = Infinity, d3 = Infinity;
            for (let b = 0; b < boneSegments.length; b++) {
                const d = distSqToSegment(tmpVert, boneSegments[b]!);
                if (d < d0) {
                    d3 = d2; i3 = i2;
                    d2 = d1; i2 = i1;
                    d1 = d0; i1 = i0;
                    d0 = d; i0 = b;
                } else if (d < d1) {
                    d3 = d2; i3 = i2;
                    d2 = d1; i2 = i1;
                    d1 = d; i1 = b;
                } else if (d < d2) {
                    d3 = d2; i3 = i2;
                    d2 = d; i2 = b;
                } else if (d < d3) {
                    d3 = d; i3 = b;
                }
            }

            const w0 = 1 / Math.pow(Math.sqrt(d0) + EPS, FALLOFF);
            const w1 = 1 / Math.pow(Math.sqrt(d1) + EPS, FALLOFF);
            const w2 = 1 / Math.pow(Math.sqrt(d2) + EPS, FALLOFF);
            const w3 = 1 / Math.pow(Math.sqrt(d3) + EPS, FALLOFF);
            const wt = w0 + w1 + w2 + w3;

            const base = i * 4;
            skinIndices[base] = i0;
            skinIndices[base + 1] = i1;
            skinIndices[base + 2] = i2;
            skinIndices[base + 3] = i3;
            skinWeights[base] = w0 / wt;
            skinWeights[base + 1] = w1 / wt;
            skinWeights[base + 2] = w2 / wt;
            skinWeights[base + 3] = w3 / wt;
        }

        geo.setAttribute("skinIndex", new THREE.BufferAttribute(skinIndices, 4));
        geo.setAttribute("skinWeight", new THREE.BufferAttribute(skinWeights, 4));

        const skinnedMesh = new THREE.SkinnedMesh(geo, mesh.material);
        skinnedMesh.castShadow = mesh.castShadow;
        skinnedMesh.receiveShadow = mesh.receiveShadow;
        skinnedMesh.name = mesh.name;

        // In-place replacement: keep the original mesh's parent and
        // its local transform. The SkinnedMesh will then sit exactly
        // where the static mesh was, and `bind(skeleton)` (no explicit
        // bind matrix) will capture the SkinnedMesh's world transform
        // as its bind matrix — so skinning displacements happen in the
        // correct space for that mesh.
        skinnedMesh.position.copy(mesh.position);
        skinnedMesh.quaternion.copy(mesh.quaternion);
        skinnedMesh.scale.copy(mesh.scale);

        const parent = mesh.parent ?? avatar;
        parent.add(skinnedMesh);
        skinnedMesh.updateMatrixWorld(true);
        skinnedMesh.bind(skeleton);

        parent.remove(mesh);

        // Frustum culling uses the geometry's bounding sphere, which
        // is computed at bind pose. Animated skinning can push verts
        // beyond that sphere; disable culling for safety so we never
        // accidentally hide the avatar mid-animation.
        skinnedMesh.frustumCulled = false;

        skinnedMeshes.push(skinnedMesh);

        // Sanity sample: log first vertex's bone assignment.
        console.debug(`[runtimeRig] skinned mesh "${mesh.name}"`, {
            vertices: count,
            parentName: parent.name,
            localPosition: skinnedMesh.position.toArray().map(v => v.toFixed(3)),
            worldPosition: (() => {
                const p = new THREE.Vector3();
                skinnedMesh.getWorldPosition(p);
                return p.toArray().map(v => v.toFixed(3));
            })(),
            firstVertexBones: [
                skinIndices[0],
                skinIndices[1],
                skinIndices[2],
                skinIndices[3],
            ],
            firstVertexWeights: [
                skinWeights[0]?.toFixed(3),
                skinWeights[1]?.toFixed(3),
                skinWeights[2]?.toFixed(3),
                skinWeights[3]?.toFixed(3),
            ],
            firstVertexBoneNames: [
                clonedBones[skinIndices[0]!]?.name,
                clonedBones[skinIndices[1]!]?.name,
                clonedBones[skinIndices[2]!]?.name,
                clonedBones[skinIndices[3]!]?.name,
            ],
        });
    }

    console.debug("[runtimeRig] rigged avatar", {
        avatarHeight,
        finalPivotScale: rigPivot.scale.x,
        finalPivotPosition: rigPivot.position.toArray(),
        boneCount: clonedBones.length,
        clonedBones: clonedBones.slice(0, 6).map(b => b.name),
        skinnedMeshCount: skinnedMeshes.length,
        clipCount: template.animations.length,
        clipNames: template.animations.map(c => c.name),
    });

    const defaultPivotTransform = {
        position: rigPivot.position.toArray(),
        quaternion: rigPivot.quaternion.toArray(),
        scale: rigPivot.scale.x,
    };

    return {
        rigPivot,
        rootBone: clonedRoot,
        skeleton,
        animations: template.animations,
        skinnedMeshes,
        hasOverride: !!override,
        defaultPivotTransform,
    };
}
