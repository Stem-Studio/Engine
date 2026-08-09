import OutlineNode from "three/addons/tsl/display/OutlineNode.js";

/**
 * Local factory retained for API compatibility with the previous outline
 * integration. OutlineNode must produce its own non-selected-object depth pass:
 * the main scene depth includes selected surfaces and is not a valid substitute.
 */
class SharedDepthOutlineNode extends OutlineNode {}

export function outline(scene, camera, params = {}) {
    return new SharedDepthOutlineNode(scene, camera, params);
}

export default SharedDepthOutlineNode;
