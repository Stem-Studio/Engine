import { Object3D, Scene, Vector3, Box3 } from 'three';

import { ClimbingHelper } from './ClimbingHelper';
import { CollisionBehavior } from '../../../physics/common/types';
import { COLLISION_TYPE } from '@stem/editor-oss/types/editor';
import BoundingBoxUtil from '@stem/editor-oss/utils/BoundingBoxUtil';
import TagUtil from '@stem/editor-oss/utils/TagUtil';

vi.mock('../../../utils/BoundingBoxUtil');
vi.mock('../../../utils/TagUtil');

describe('ClimbingHelper', () => {
    const mockPhysics = {
        setPlayerGravity: vi.fn(),
        movePlayerObject: vi.fn(),
        setCollisionBehavior: vi.fn(),
    };

    const mockCollisionDetector = {
        addListener: vi.fn(() => 'listener-id'),
        deleteListener: vi.fn(),
    };

    const onClimbableCollision = vi.fn();

    let mockClimbable: Object3D;
    let mockCharacter: Object3D;
    let mockScene: Scene;
    let helper: ClimbingHelper;

    beforeEach(() => {
        vi.clearAllMocks();

        mockClimbable = new Object3D();
        mockCharacter = new Object3D();
        mockCharacter.uuid = 'player-1';

        mockScene = new Scene();
        mockScene.name = "ClimbingHelperTestScene";
        mockScene.add(mockClimbable);
        mockScene.add(mockCharacter);

        const mockCameraControl = {
            resetCamera: vi.fn(),
        };

        vi.mocked(TagUtil).getObjectsByTag.mockReturnValue([mockClimbable]);
        vi.mocked(TagUtil).hasTag.mockReturnValue(true);

        vi.mocked(BoundingBoxUtil).getBoxWithoutTransform.mockReturnValue(new Box3(
            new Vector3(-0.5, 0, -0.5),
            new Vector3(0.5, 2, 0.5),
        ));

        helper = new ClimbingHelper(
            mockScene,
            mockCharacter,
            // eslint-disable-next-line
            mockPhysics as any,
            mockCameraControl as any,
            // eslint-disable-next-line
            mockCollisionDetector as any,
            onClimbableCollision,
        );
    });

    it('should initialize not climbing', () => {
        expect(helper.isClimbing).toBe(false);
    });

    it('should add listeners to existing climbable objects', () => {
        helper.addLisiteners();
        expect(TagUtil.getObjectsByTag).toHaveBeenCalledWith(mockScene, ["climbable", "physics.climbable"]);
        expect(mockCollisionDetector.addListener).toHaveBeenCalledWith(
            mockClimbable,
            expect.objectContaining({ type: COLLISION_TYPE.WITH_PLAYER }),
            true,
        );
    });

    it('should add listeners to climbable objects added to the scene', () => {
        mockScene.remove(mockClimbable);
        vi.mocked(TagUtil).getObjectsByTag.mockReturnValue([]);
        helper.addLisiteners();
        expect(mockCollisionDetector.addListener).not.toHaveBeenCalled();
        mockScene.add(mockClimbable);
        expect(mockCollisionDetector.addListener).toHaveBeenCalledWith(
            mockClimbable,
            expect.objectContaining({ type: COLLISION_TYPE.WITH_PLAYER }),
            true,
        );
    });

    it('should remove listeners', () => {
        helper.addLisiteners();
        helper.removeLisiteners();
        expect(mockCollisionDetector.deleteListener).toHaveBeenCalledWith(mockClimbable, 'listener-id');
    });

    it('should remove listeners to climbable objects removed from the scene', () => {
        helper.addLisiteners();
        mockScene.remove(mockClimbable);
        expect(mockCollisionDetector.deleteListener).toHaveBeenCalledWith(mockClimbable, 'listener-id');
    });

    it('should start climbing if object is tagged as climbable', () => {
        helper.startClimbing(mockClimbable);
        expect(helper.isClimbing).toBe(true);
        expect(mockPhysics.setPlayerGravity).toHaveBeenCalledWith('player-1', { x: 0, y: 0, z: 0 });
        expect(mockPhysics.setCollisionBehavior).toHaveBeenCalledWith('player-1', CollisionBehavior.Ghost);
    });

    it('should stop climbing and restore gravity', () => {
        helper.startClimbing(mockClimbable);
        helper.stopClimbing();
        expect(helper.isClimbing).toBe(false);
        expect(mockPhysics.setPlayerGravity).toHaveBeenCalledWith(
            'player-1',
            expect.objectContaining({ y: helper.playerGravity }),
        );
        expect(mockPhysics.setCollisionBehavior).toHaveBeenCalledWith('player-1', CollisionBehavior.Regular);
    });

    it('should move up if climbing and not at top', () => {
        helper.startClimbing(mockClimbable);
        vi.spyOn(helper, 'isAtTop').mockReturnValue(false);
        helper.climbingSpeed = 5;
        helper.move(1, 0.1);
        expect(mockPhysics.movePlayerObject).toHaveBeenCalled();
    });

    it('should not move up if climbing and at top', () => {
        helper.startClimbing(mockClimbable);
        vi.spyOn(helper, 'isAtTop').mockReturnValue(true);
        helper.climbingSpeed = 5;
        helper.move(1, 0.1);
        expect(mockPhysics.movePlayerObject).toHaveBeenCalledWith(
            'player-1',
            expect.objectContaining({ x: 0, y: 0, z: 0 }),
            false,
        );
    });

    it('should move down if climbing and not at bottom', () => {
        helper.startClimbing(mockClimbable);
        vi.spyOn(helper, 'isAtBottom').mockReturnValue(false);
        helper.climbingSpeed = 5;
        helper.move(-1, 0.1);
        expect(mockPhysics.movePlayerObject).toHaveBeenCalled();
    });

    it('should stop climbing if at bottom', () => {
        helper.startClimbing(mockClimbable);
        vi.spyOn(helper, 'isAtBottom').mockReturnValue(true);
        helper.climbingSpeed = 5;
        helper.move(-1, 0.1);
        expect(helper.isClimbing).toBe(false);
    });

    it.skip('should stop movement if direction is zero', () => {
        helper.startClimbing(mockClimbable);
        helper.move(0, 0.1);
        expect(mockPhysics.movePlayerObject).toHaveBeenCalledWith('player-1', new Vector3(0, 0, 0), false);
    });

    it('should call onClimbableCollision on collision with climbable', () => {
        const climbable = new Object3D();
        climbable.uuid = 'climbable-123';
        mockScene.add(climbable);
        helper['onCollision']('climbable-123');
        expect(onClimbableCollision).toHaveBeenCalledWith(climbable);
    });

    it('should dispose and remove listeners', () => {
        helper.addLisiteners();
        helper.dispose();
        expect(mockCollisionDetector.deleteListener).toHaveBeenCalled();
    });
});
