import {
	BufferGeometry,
	Controls,
	CylinderGeometry,
	DoubleSide,
	Euler,
	Float32BufferAttribute,
	Line,
	LineBasicMaterial,
	Matrix4,
	Mesh,
	MeshBasicMaterial,
	Object3D,
	OctahedronGeometry,
	PlaneGeometry,
	Quaternion,
	Raycaster,
	Shape,
	ShapeGeometry,
	SphereGeometry,
	TorusGeometry,
	Vector3,
	Sprite,
	SpriteMaterial,
	CanvasTexture,
} from 'three';

import BufferGeometryUtils from '../utils/BufferGeometryUtils.js';

const _raycaster = new Raycaster();

const _tempVector = new Vector3();
const _tempVector2 = new Vector3();
const _tempQuaternion = new Quaternion();
const _unit = {
	X: new Vector3( 1, 0, 0 ),
	Y: new Vector3( 0, 1, 0 ),
	Z: new Vector3( 0, 0, 1 ),
};

/**
 * Fires if any type of change (object or property change) is performed. Property changes
 * are separate events you can add event listeners to. The event type is "propertyname-changed".
 *
 * @event TransformControls#change
 * @type {Object}
 */
const _changeEvent = { type: 'change' };

/**
 * Fires if a pointer (mouse/touch) becomes active.
 *
 * @event TransformControls#mouseDown
 * @type {Object}
 */
const _mouseDownEvent = { type: 'mouseDown', mode: null };

/**
 * Fires if a pointer (mouse/touch) is no longer active.
 *
 * @event TransformControls#mouseUp
 * @type {Object}
 */
const _mouseUpEvent = { type: 'mouseUp', mode: null };

/**
 * Fires if the controlled 3D object is changed.
 *
 * @event TransformControls#objectChange
 * @type {Object}
 */
const _objectChangeEvent = { type: 'objectChange' };

const RENDER_ORDER = {
	HELPER: Number.MAX_SAFE_INTEGER,
	GIZMO: Number.MAX_SAFE_INTEGER + 1,
	TEXT: Number.MAX_SAFE_INTEGER + 1000,
};

/**
 * This class can be used to transform objects in 3D space by adapting a similar interaction model
 * of DCC tools like Blender. Unlike other controls, it is not intended to transform the scene's camera.
 *
 * `TransformControls` expects that its attached 3D object is part of the scene graph.
 *
 * @augments Controls
 * @three_import import { TransformControls } from 'three/addons/controls/TransformControls.js';
 */
class TransformControls extends Controls {

	/**
	 * Constructs a new controls instance.
	 *
	 * @param {Camera} camera - The camera of the rendered scene.
	 * @param {?HTMLElement} domElement - The HTML element used for event listeners.
	 */
	constructor( camera, domElement = null ) {

		super( undefined, domElement );

		const root = new TransformControlsRoot( this );
		this._root = root;

		const gizmo = new TransformControlsGizmo( this );
		this._gizmo = gizmo;
		root.add( gizmo );

		const plane = new TransformControlsPlane( this );
		this._plane = plane;
		root.add( plane );

		// Defined getter, setter and store for a property
		const defineProperty = ( propName, defaultValue ) => {

			let propValue = defaultValue;

			Object.defineProperty( this, propName, {

				get: function () {

					return propValue !== undefined ? propValue : defaultValue;

				},

				set: ( value ) => {

					if ( propValue !== value ) {

						propValue = value;
						plane[ propName ] = value;
						gizmo[ propName ] = value;

						this.dispatchEvent( { type: propName + '-changed', value: value } );
						this.dispatchEvent( _changeEvent );

					}

				},

			} );

			this[ propName ] = defaultValue;
			plane[ propName ] = defaultValue;
			gizmo[ propName ] = defaultValue;

		};

		// Define properties with getters/setter
		// Setting the defined property will automatically trigger change event
		// Defined properties are passed down to gizmo and plane

		/**
		 * The camera of the rendered scene.
		 *
		 * @name TransformControls#camera
		 * @type {Camera}
		 */
		defineProperty( 'camera', camera );
		defineProperty( 'object', undefined );
		defineProperty( 'enabled', true );

		/**
		 * The current transformation axis.
		 *
		 * @name TransformControls#axis
		 * @type {string}
		 */
		defineProperty( 'axis', null );

		/**
		 * The current transformation axis.
		 *
		 * @name TransformControls#mode
		 * @type {('translate'|'rotate'|'scale'|'all')}
		 * @default 'all'
		 */
		defineProperty( 'mode', 'all' );

		/**
		 * By default, 3D objects are continuously translated. If you set this property to a numeric
		 * value (world units), you can define in which steps the 3D object should be translated.
		 *
		 * @name TransformControls#translationSnap
		 * @type {?number}
		 * @default null
		 */
		defineProperty( 'translationSnap', null );

		/**
		 * By default, 3D objects are continuously rotated. If you set this property to a numeric
		 * value (radians), you can define in which steps the 3D object should be rotated.
		 *
		 * @name TransformControls#rotationSnap
		 * @type {?number}
		 * @default null
		 */
		defineProperty( 'rotationSnap', null );
		defineProperty( 'rotationDisplayUnit', 'degrees' );

		/**
		 * By default, 3D objects are continuously scaled. If you set this property to a numeric
		 * value, you can define in which steps the 3D object should be scaled.
		 *
		 * @name TransformControls#scaleSnap
		 * @type {?number}
		 * @default null
		 */
		defineProperty( 'scaleSnap', null );

		/**
		 * The current transformation sub mode.
		 *
		 * @name TransformControls#subMode
		 * @type {('translate'|'rotate'|'scale')}
		 * @default 'translate'
		 */
		defineProperty( 'subMode', 'translate' );

		/**
		 * Defines in which coordinate space transformations should be performed.
		 *
		 * @name TransformControls#space
		 * @type {('world'|'local')}
		 * @default 'world'
		 */
		defineProperty( 'space', 'world' );

		/**
		 * The size of the helper UI (axes/planes).
		 *
		 * @name TransformControls#size
		 * @type {number}
		 * @default 1
		 */
		defineProperty( 'size', 1 );

		/**
		 * Whether dragging is currently performed or not.
		 *
		 * @name TransformControls#dragging
		 * @type {boolean}
		 * @readonly
		 * @default false
		 */
		defineProperty( 'dragging', false );

		/**
		 * Whether the x-axis helper should be visible or not.
		 *
		 * @name TransformControls#showX
		 * @type {boolean}
		 * @default true
		 */
		defineProperty( 'showX', true );

		/**
		 * Whether the y-axis helper should be visible or not.
		 *
		 * @name TransformControls#showY
		 * @type {boolean}
		 * @default true
		 */
		defineProperty( 'showY', true );

		/**
		 * Whether the z-axis helper should be visible or not.
		 *
		 * @name TransformControls#showZ
		 * @type {boolean}
		 * @default true
		 */
		defineProperty( 'showZ', true );

		/**
		 * The minimum allowed X position during translation.
		 *
		 * @name TransformControls#minX
		 * @type {number}
		 * @default -Infinity
		 */
		defineProperty( 'minX', - Infinity );

		/**
		 * The maximum allowed X position during translation.
		 *
		 * @name TransformControls#maxX
		 * @type {number}
		 * @default Infinity
		 */
		defineProperty( 'maxX', Infinity );

		/**
		 * The minimum allowed y position during translation.
		 *
		 * @name TransformControls#minY
		 * @type {number}
		 * @default -Infinity
		 */
		defineProperty( 'minY', - Infinity );

		/**
		 * The maximum allowed Y position during translation.
		 *
		 * @name TransformControls#maxY
		 * @type {number}
		 * @default Infinity
		 */
		defineProperty( 'maxY', Infinity );

		/**
		 * The minimum allowed z position during translation.
		 *
		 * @name TransformControls#minZ
		 * @type {number}
		 * @default -Infinity
		 */
		defineProperty( 'minZ', - Infinity );

		/**
		 * The maximum allowed Z position during translation.
		 *
		 * @name TransformControls#maxZ
		 * @type {number}
		 * @default Infinity
		 */
		defineProperty( 'maxZ', Infinity );

		/**
		 * Whether the translate helper should be visible or not.
		 *
		 * @name TransformControls#showTranslate
		 * @type {boolean}
		 * @default true
		 */
		defineProperty( 'showTranslate', true );

		/**
		 * Whether the rotate helper should be visible or not.
		 *
		 * @name TransformControls#showRotate
		 * @type {boolean}
		 * @default true
		 */
		defineProperty( 'showRotate', true );

		/**
		 * Whether the scale helper should be visible or not.
		 *
		 * @name TransformControls#showScale
		 * @type {boolean}
		 * @default true
		 */
		defineProperty( 'showScale', true );

		// Reusable utility variables

		const worldPosition = new Vector3();
		const worldPositionStart = new Vector3();
		const worldQuaternion = new Quaternion();
		const worldQuaternionStart = new Quaternion();
		const cameraPosition = new Vector3();
		const cameraQuaternion = new Quaternion();
		const pointStart = new Vector3();
		const pointEnd = new Vector3();
		const rotationAxis = new Vector3();
		const rotationAngle = 0;
		const eye = new Vector3();

		// TODO: remove properties unused in plane and gizmo

		defineProperty( 'worldPosition', worldPosition );
		defineProperty( 'worldPositionStart', worldPositionStart );
		defineProperty( 'worldQuaternion', worldQuaternion );
		defineProperty( 'worldQuaternionStart', worldQuaternionStart );
		defineProperty( 'cameraPosition', cameraPosition );
		defineProperty( 'cameraQuaternion', cameraQuaternion );
		defineProperty( 'pointStart', pointStart );
		defineProperty( 'pointEnd', pointEnd );
		defineProperty( 'rotationAxis', rotationAxis );
		defineProperty( 'rotationAngle', rotationAngle );
		defineProperty( 'eye', eye );

		this._offset = new Vector3();
		this._startNorm = new Vector3();
		this._endNorm = new Vector3();
		this._cameraScale = new Vector3();

		this._parentPosition = new Vector3();
		this._parentQuaternion = new Quaternion();
		this._parentQuaternionInv = new Quaternion();
		this._parentScale = new Vector3();

		this._worldScaleStart = new Vector3();
		this._worldQuaternionInv = new Quaternion();
		this._worldScale = new Vector3();

		this._positionStart = new Vector3();
		this._quaternionStart = new Quaternion();
		this._scaleStart = new Vector3();
		this._shouldRaycastAttachedObject = false;

		this._getPointer = getPointer.bind( this );
		this._onPointerDown = onPointerDown.bind( this );
		this._onPointerHover = onPointerHover.bind( this );
		this._onPointerMove = onPointerMove.bind( this );
		this._onPointerUp = onPointerUp.bind( this );
		this._onKeyDown = onKeyDown.bind( this );
		this._onKeyUp = onKeyUp.bind( this );

		this.addEventListener( 'mode-changed', ( event ) => {

			if ( event.value === 'all' ) {

				this.space = 'local';

			}

		} );

		if ( this.mode === 'all' ) {

			this.space = 'local';

		}

		if ( domElement !== null ) {

			this.connect( domElement );

		}

	}

	connect( element ) {

		super.connect( element );

		this.domElement.addEventListener( 'pointerdown', this._onPointerDown );
		this.domElement.addEventListener( 'pointermove', this._onPointerHover );
		this.domElement.addEventListener( 'pointerup', this._onPointerUp );
		this.domElement.ownerDocument.addEventListener( 'keydown', this._onKeyDown );
		this.domElement.ownerDocument.addEventListener( 'keyup', this._onKeyUp );

		this.domElement.style.touchAction = 'none'; // disable touch scroll

	}

	disconnect() {

		this.domElement.removeEventListener( 'pointerdown', this._onPointerDown );
		this.domElement.removeEventListener( 'pointermove', this._onPointerHover );
		this.domElement.removeEventListener( 'pointermove', this._onPointerMove );
		this.domElement.removeEventListener( 'pointerup', this._onPointerUp );
		this.domElement.ownerDocument.removeEventListener( 'keydown', this._onKeyDown );
		this.domElement.ownerDocument.removeEventListener( 'keyup', this._onKeyUp );

		this.domElement.style.touchAction = 'auto';

	}

	/**
	 * Returns the visual representation of the controls. Add the helper to your scene to
	 * visually transform the attached  3D object.
	 *
	 * @return {TransformControlsRoot} The helper.
	 */
	getHelper() {

		return this._root;

	}

	_alignPointToAxis( point, axis, space ) {

		_tempVector.copy( _unit[ axis ] );

		if ( space === 'local' ) {

			_tempVector.applyQuaternion( this.worldQuaternionStart );

		}

		_v1.copy( _raycaster.ray.direction );
		_v2.copy( _tempVector );
		_v3.copy( _raycaster.ray.origin ).sub( this.worldPositionStart );

		const d1343 = _v1.dot( _v2 );
		const d2233 = _v1.dot( _v1 );
		const d2333 = _v2.dot( _v2 );
		const d1344 = _v1.dot( _v3 );
		const d1234 = _v2.dot( _v3 );

		const denom = d2233 * d2333 - d1343 * d1343;

		if ( denom !== 0 ) {

			const t = ( d2233 * d1234 - d1343 * d1344 ) / denom;
			point.copy( this.worldPositionStart ).addScaledVector( _v2, t );

		}

	}

	pointerHover( pointer ) {

		if ( this.object === undefined || this.dragging === true ) return;

		if ( pointer !== null ) _raycaster.setFromCamera( pointer, this.camera );

		let intersect = null;

		if ( this.mode === 'all' ) {

			const intersects = [];

			const intersectTranslate = intersectObjectWithRay( this._gizmo.picker[ 'translate' ], _raycaster );
			if ( intersectTranslate ) intersects.push( intersectTranslate );

			const intersectRotate = intersectObjectWithRay( this._gizmo.picker[ 'rotate' ], _raycaster );
			if ( intersectRotate ) intersects.push( intersectRotate );

			const intersectScale = intersectObjectWithRay( this._gizmo.picker[ 'scale' ], _raycaster );
			if ( intersectScale ) intersects.push( intersectScale );

			if ( intersects.length > 0 ) {

				intersects.sort( ( a, b ) => a.distance - b.distance );
				intersect = intersects[ 0 ];

			}

		} else {

			intersect = intersectObjectWithRay( this._gizmo.picker[ this.mode ], _raycaster );

		}

		let intersectObject = null;
		if ( ! intersect && this._shouldRaycastAttachedObject && this.object ) {

			if ( this.object.userData.controlledObjects ) {

				for ( const obj of this.object.userData.controlledObjects ) {

					intersectObject = intersectObjectWithRay( obj, _raycaster );
					if ( intersectObject ) break;

				}

			} else {

				intersectObject = intersectObjectWithRay( this.object, _raycaster );

			}

		}

		if ( intersect ) {

			this.axis = intersect.object.name;

			if ( intersect.object.userData.mode ) {

				this.subMode = intersect.object.userData.mode;

			}

		} else if ( intersectObject ) {

			this.axis = 'XYZ';
			if ( this.mode === 'all' ) this.subMode = 'translate';

		} else {

			this.axis = null;

		}

	}

	pointerDown( pointer ) {

		if ( this.object === undefined || this.dragging === true ||  pointer !== null && pointer.button !== 0  ) return;

		if ( this.axis !== null ) {

			if ( pointer !== null ) _raycaster.setFromCamera( pointer, this.camera );

			// Update matrices to ensure accurate intersection
			if ( this.camera ) {

				this.camera.updateMatrixWorld();
				this.camera.getWorldPosition( this.cameraPosition );
				this.camera.getWorldQuaternion( this.cameraQuaternion );

			}

			this._root.updateMatrixWorld();
			this._plane.updateMatrixWorld();
			const planeIntersect = intersectObjectWithRay( this._plane, _raycaster, true );

			if ( planeIntersect ) {

				let mode = this.mode;
				if ( mode === 'all' ) mode = this.subMode;

				if ( ( mode === 'scale' || mode === 'translate' ) && this.space === 'world' ) {

					this.object.quaternion.identity();
					this.object.updateMatrixWorld();

					this.object.matrixWorld.decompose( this.worldPosition, this.worldQuaternion, _tempVector );

					this._plane.updateMatrixWorld();

					const newIntersect = intersectObjectWithRay( this._plane, _raycaster, true );
					if ( newIntersect ) planeIntersect.point.copy( newIntersect.point );

				}

				this.object.updateMatrixWorld();
				this.object.parent.updateMatrixWorld();

				this._positionStart.copy( this.object.position );
				this._quaternionStart.copy( this.object.quaternion );
				this._scaleStart.copy( this.object.scale );

				this.object.matrixWorld.decompose( this.worldPositionStart, this.worldQuaternionStart, this._worldScaleStart );

				// Align pointStart to the axis for precise single-axis translation
				if ( ( this.mode === 'translate' ||  this.mode === 'all' && this.subMode === 'translate'  ) && ( this.axis === 'X' || this.axis === 'Y' || this.axis === 'Z' ) ) {

					this._alignPointToAxis( planeIntersect.point, this.axis, this.space );

				}

				this.pointStart.copy( planeIntersect.point ).sub( this.worldPositionStart );

				this.dragging = true;
				this.rotationAngle = 0;

				if ( this.axis === 'X' || this.axis === 'Y' || this.axis === 'Z' ) {

					this.rotationAxis.copy( _unit[ this.axis ] );

				}

				_mouseDownEvent.mode = this.mode === 'all' ? this.subMode : this.mode;
				this.dispatchEvent( _mouseDownEvent );

			}

		}

	}

	pointerMove( pointer ) {

		const axis = this.axis;
		let mode = this.mode === 'all' ? this.subMode : this.mode;
		const object = this.object;
		let space = this.space;

		if ( axis === 'XYZ' ) {

			mode = 'translate';

		}

		if ( axis === 'E' || axis === 'XYZE' || axis === 'XYZ' ) {

			space = 'world';

		}

		if ( object === undefined || axis === null || this.dragging === false ||  pointer !== null && pointer.button !== - 1  ) return;

		if ( pointer !== null ) _raycaster.setFromCamera( pointer, this.camera );

		const planeIntersect = intersectObjectWithRay( this._plane, _raycaster, true );

		if ( ! planeIntersect ) return;

		// Align pointEnd to the axis for precise single-axis translation
		if ( ( mode === 'translate' ||  mode === 'all' && this.subMode === 'translate'  ) && ( axis === 'X' || axis === 'Y' || axis === 'Z' ) ) {

			this._alignPointToAxis( planeIntersect.point, axis, space );

		}

		this.pointEnd.copy( planeIntersect.point ).sub( this.worldPositionStart );

		if ( mode === 'translate' ) {

			// Apply translate

			this._offset.copy( this.pointEnd ).sub( this.pointStart );

			if ( space === 'local' && axis !== 'XYZ' ) {

				this._offset.applyQuaternion( this._worldQuaternionInv );

			}

			if ( axis.indexOf( 'X' ) === - 1 ) this._offset.x = 0;
			if ( axis.indexOf( 'Y' ) === - 1 ) this._offset.y = 0;
			if ( axis.indexOf( 'Z' ) === - 1 ) this._offset.z = 0;

			if ( space === 'local' && axis !== 'XYZ' ) {

				this._offset.applyQuaternion( this._quaternionStart ).divide( this._parentScale );

			} else {

				this._offset.applyQuaternion( this._parentQuaternionInv ).divide( this._parentScale );

			}

			object.position.copy( this._offset ).add( this._positionStart );

			// Apply translation snap

			if ( this.translationSnap ) {

				if ( space === 'local' ) {

					object.position.applyQuaternion( _tempQuaternion.copy( this._quaternionStart ).invert() );

					if ( axis.search( 'X' ) !== - 1 ) {

						object.position.x = Math.round( object.position.x / this.translationSnap ) * this.translationSnap;

					}

					if ( axis.search( 'Y' ) !== - 1 ) {

						object.position.y = Math.round( object.position.y / this.translationSnap ) * this.translationSnap;

					}

					if ( axis.search( 'Z' ) !== - 1 ) {

						object.position.z = Math.round( object.position.z / this.translationSnap ) * this.translationSnap;

					}

					object.position.applyQuaternion( this._quaternionStart );

				}

				if ( space === 'world' ) {

					if ( object.parent ) {

						object.position.add( _tempVector.setFromMatrixPosition( object.parent.matrixWorld ) );

					}

					if ( axis.search( 'X' ) !== - 1 ) {

						object.position.x = Math.round( object.position.x / this.translationSnap ) * this.translationSnap;

					}

					if ( axis.search( 'Y' ) !== - 1 ) {

						object.position.y = Math.round( object.position.y / this.translationSnap ) * this.translationSnap;

					}

					if ( axis.search( 'Z' ) !== - 1 ) {

						object.position.z = Math.round( object.position.z / this.translationSnap ) * this.translationSnap;

					}

					if ( object.parent ) {

						object.position.sub( _tempVector.setFromMatrixPosition( object.parent.matrixWorld ) );

					}

				}

			}

			object.position.x = Math.max( this.minX, Math.min( this.maxX, object.position.x ) );
			object.position.y = Math.max( this.minY, Math.min( this.maxY, object.position.y ) );
			object.position.z = Math.max( this.minZ, Math.min( this.maxZ, object.position.z ) );

		} else if ( mode === 'scale' ) {

			const uniformScale = isUniformScaleActive( this );

			if ( uniformScale ) {

				let d = this.pointEnd.length() / this.pointStart.length();

				if ( this.pointEnd.dot( this.pointStart ) < 0 ) d *= - 1;

				_tempVector2.set( d, d, d );

			} else {

				_tempVector.copy( this.pointStart );
				_tempVector2.copy( this.pointEnd );

				_tempVector.applyQuaternion( this._worldQuaternionInv );
				_tempVector2.applyQuaternion( this._worldQuaternionInv );

				_tempVector2.divide( _tempVector );

				if ( axis.search( 'X' ) === - 1 ) {

					_tempVector2.x = 1;

				}

				if ( axis.search( 'Y' ) === - 1 ) {

					_tempVector2.y = 1;

				}

				if ( axis.search( 'Z' ) === - 1 ) {

					_tempVector2.z = 1;

				}

			}

			// Apply scale

			if ( space === 'local' || axis === 'XYZ' ) {

				object.scale.copy( this._scaleStart ).multiply( _tempVector2 );

			} else {

				_v1.set( 1, 0, 0 ).applyQuaternion( this._quaternionStart );
				_v2.set( 0, 1, 0 ).applyQuaternion( this._quaternionStart );
				_v3.set( 0, 0, 1 ).applyQuaternion( this._quaternionStart );

				const sx = 1 + Math.abs( _v1.dot( _unitX ) ) * ( _tempVector2.x - 1 ) + Math.abs( _v1.dot( _unitY ) ) * ( _tempVector2.y - 1 ) + Math.abs( _v1.dot( _unitZ ) ) * ( _tempVector2.z - 1 );
				const sy = 1 + Math.abs( _v2.dot( _unitX ) ) * ( _tempVector2.x - 1 ) + Math.abs( _v2.dot( _unitY ) ) * ( _tempVector2.y - 1 ) + Math.abs( _v2.dot( _unitZ ) ) * ( _tempVector2.z - 1 );
				const sz = 1 + Math.abs( _v3.dot( _unitX ) ) * ( _tempVector2.x - 1 ) + Math.abs( _v3.dot( _unitY ) ) * ( _tempVector2.y - 1 ) + Math.abs( _v3.dot( _unitZ ) ) * ( _tempVector2.z - 1 );

				object.scale.copy( this._scaleStart );
				object.scale.x *= sx;
				object.scale.y *= sy;
				object.scale.z *= sz;

			}

			if ( this.scaleSnap ) {

				if ( uniformScale ) {

					const snapAxis = getUniformScaleSnapAxis( axis, this._scaleStart, object.scale );
					const snapAxisKey = snapAxis.toLowerCase();
					const scaleStart = this._scaleStart[ snapAxisKey ];
					const snappedScale = Math.round( object.scale[ snapAxisKey ] / this.scaleSnap ) * this.scaleSnap || this.scaleSnap;

					if ( scaleStart !== 0 ) {

						object.scale.copy( this._scaleStart ).multiplyScalar( snappedScale / scaleStart );

					} else {

						object.scale.setScalar( snappedScale );

					}

				} else {

					if ( axis.search( 'X' ) !== - 1 ) {

						object.scale.x = Math.round( object.scale.x / this.scaleSnap ) * this.scaleSnap || this.scaleSnap;

					}

					if ( axis.search( 'Y' ) !== - 1 ) {

						object.scale.y = Math.round( object.scale.y / this.scaleSnap ) * this.scaleSnap || this.scaleSnap;

					}

					if ( axis.search( 'Z' ) !== - 1 ) {

						object.scale.z = Math.round( object.scale.z / this.scaleSnap ) * this.scaleSnap || this.scaleSnap;

					}

				}

			}

		} else if ( mode === 'rotate' ) {

			this._offset.copy( this.pointEnd ).sub( this.pointStart );

			const ROTATION_SPEED = 20 / this.worldPosition.distanceTo( _tempVector.setFromMatrixPosition( this.camera.matrixWorld ) );

			let _inPlaneRotation = false;

			if ( axis === 'XYZE' ) {

				this.rotationAxis.copy( this._offset ).cross( this.eye ).normalize();
				this.rotationAngle = this._offset.dot( _tempVector.copy( this.rotationAxis ).cross( this.eye ) ) * ROTATION_SPEED;

			} else if ( axis === 'X' || axis === 'Y' || axis === 'Z' ) {

				this.rotationAxis.copy( _unit[ axis ] );

				this.rotationAngle = this.pointEnd.angleTo( this.pointStart );

				this._startNorm.copy( this.pointStart ).normalize();
				this._endNorm.copy( this.pointEnd ).normalize();

				const axisVector = _v1.copy( _unit[ axis ] );

				if ( space === 'local' ) {

					axisVector.applyQuaternion( this.worldQuaternionStart );

				}

				this.rotationAngle *=  this._endNorm.cross( this._startNorm ).dot( axisVector ) < 0 ? 1 : - 1;

			}

			if ( axis === 'E' || _inPlaneRotation ) {

				this.rotationAxis.copy( this.eye );
				this.rotationAngle = this.pointEnd.angleTo( this.pointStart );

				this._startNorm.copy( this.pointStart ).normalize();
				this._endNorm.copy( this.pointEnd ).normalize();

				this.rotationAngle *=  this._endNorm.cross( this._startNorm ).dot( this.eye ) < 0 ? 1 : - 1;

			}

			// Apply rotation snap

			if ( this.rotationSnap ) this.rotationAngle = Math.round( this.rotationAngle / this.rotationSnap ) * this.rotationSnap;

			// Apply rotate
			if ( space === 'local' && axis !== 'E' && axis !== 'XYZE' ) {

				object.quaternion.copy( this._quaternionStart );
				object.quaternion.multiply( _tempQuaternion.setFromAxisAngle( this.rotationAxis, this.rotationAngle ) ).normalize();

			} else {

				this.rotationAxis.applyQuaternion( this._parentQuaternionInv );
				object.quaternion.copy( _tempQuaternion.setFromAxisAngle( this.rotationAxis, this.rotationAngle ) );
				object.quaternion.multiply( this._quaternionStart ).normalize();

			}

		}

		this.dispatchEvent( _changeEvent );
		this.dispatchEvent( _objectChangeEvent );

	}

	pointerUp( pointer ) {

		if ( pointer !== null && pointer.button !== 0 ) return;

		if ( this.dragging &&  this.axis !== null  ) {

			_mouseUpEvent.mode = this.mode === 'all' ? this.subMode : this.mode;
			this.dispatchEvent( _mouseUpEvent );

		}

		this.dragging = false;
		this.axis = null;

	}

	dispose() {

		this.disconnect();

		this._root.dispose();

	}

	/**
	 * Sets the 3D object that should be transformed and ensures the controls UI is visible.
	 *
	 * @param {Object3D} object -  The 3D object that should be transformed.
	 * @return {TransformControls} A reference to this controls.
	 */
	attach( object ) {

		this.object = object;
		this._root.visible = true;

		return this;

	}

	/**
	 * Removes the current 3D object from the controls and makes the helper UI invisible.
	 *
	 * @return {TransformControls} A reference to this controls.
	 */
	detach() {

		this.object = undefined;
		this.axis = null;

		this._root.visible = false;

		return this;

	}

	/**
	 * Resets the object's position, rotation and scale to when the current transform began.
	 */
	reset() {

		if ( ! this.enabled ) return;

		if ( this.dragging ) {

			this.object.position.copy( this._positionStart );
			this.object.quaternion.copy( this._quaternionStart );
			this.object.scale.copy( this._scaleStart );

			this.dispatchEvent( _changeEvent );
			this.dispatchEvent( _objectChangeEvent );

			this.pointStart.copy( this.pointEnd );

		}

	}

	/**
	 * Returns the raycaster that is used for user interaction. This object is shared between all
	 * instances of `TransformControls`.
	 *
	 * @returns {Raycaster} The internal raycaster.
	 */
	getRaycaster() {

		return _raycaster;

	}

	/**
	 * Returns the transformation mode.
	 *
	 * @returns {'translate'|'rotate'|'scale'} The transformation mode.
	 */
	getMode() {

		return this.mode;

	}

	/**
	 * Sets the given transformation mode.
	 *
	 * @param {'translate'|'rotate'|'scale'} mode - The transformation mode to set.
	 */
	setMode( mode ) {

		this.mode = mode;

	}

	/**
	 * Sets the translation snap.
	 *
	 * @param {?number} translationSnap - The translation snap to set.
	 */
	setTranslationSnap( translationSnap ) {

		this.translationSnap = translationSnap;

	}

	/**
	 * Sets the rotation snap.
	 *
	 * @param {?number} rotationSnap - The rotation snap to set.
	 */
	setRotationSnap( rotationSnap ) {

		this.rotationSnap = rotationSnap;

	}

	/**
	 * Sets the display unit used by rotation helper overlays.
	 *
	 * @param {'degrees'|'radians'} rotationDisplayUnit - The rotation display unit to set.
	 */
	setRotationDisplayUnit( rotationDisplayUnit ) {

		this.rotationDisplayUnit = rotationDisplayUnit;

	}

	/**
	 * Sets the scale snap.
	 *
	 * @param {?number} scaleSnap - The scale snap to set.
	 */
	setScaleSnap( scaleSnap ) {

		this.scaleSnap = scaleSnap;

	}

	/**
	 * Sets the size of the helper UI.
	 *
	 * @param {number} size - The size to set.
	 */
	setSize( size ) {

		this.size = size;

	}

	/**
	 * Sets the coordinate space in which transformations are applied.
	 *
	 * @param {'world'|'local'} space - The space to set.
	 */
	setSpace( space ) {

		this.space = space;

	}

	/**
	 * Sets the colors of the control's gizmo.
	 *
	 * @param {number|Color|string} xAxis - The x-axis color.
	 * @param {number|Color|string} yAxis - The y-axis color.
	 * @param {number|Color|string} zAxis - The z-axis color.
	 * @param {number|Color|string} active - The color for active elements.
	 */
	setColors( xAxis, yAxis, zAxis, active ) {

		const materialLib = this._gizmo.materialLib;

		materialLib.xAxis.color.set( xAxis );
		materialLib.yAxis.color.set( yAxis );
		materialLib.zAxis.color.set( zAxis );
		materialLib.active.color.set( active );
		materialLib.xAxisTransparent.color.set( xAxis );
		materialLib.yAxisTransparent.color.set( yAxis );
		materialLib.zAxisTransparent.color.set( zAxis );
		materialLib.activeTransparent.color.set( active );

		// update color caches

		if ( materialLib.xAxis._color ) materialLib.xAxis._color.set( xAxis );
		if ( materialLib.yAxis._color ) materialLib.yAxis._color.set( yAxis );
		if ( materialLib.zAxis._color ) materialLib.zAxis._color.set( zAxis );
		if ( materialLib.active._color ) materialLib.active._color.set( active );
		if ( materialLib.xAxisTransparent._color ) materialLib.xAxisTransparent._color.set( xAxis );
		if ( materialLib.yAxisTransparent._color ) materialLib.yAxisTransparent._color.set( yAxis );
		if ( materialLib.zAxisTransparent._color ) materialLib.zAxisTransparent._color.set( zAxis );
		if ( materialLib.activeTransparent._color ) materialLib.activeTransparent._color.set( active );

	}

}

// mouse / touch event handlers

/**
 *
 * @param event
 */
function getPointer( event ) {

	if ( this.domElement.ownerDocument.pointerLockElement ) {

		return {
			x: 0,
			y: 0,
			button: event.button,
		};

	} else {

		const rect = this.domElement.getBoundingClientRect();

		return {
			x: ( event.clientX - rect.left ) / rect.width * 2 - 1,
			y: - ( event.clientY - rect.top ) / rect.height * 2 + 1,
			button: event.button,
		};

	}

}

/**
 *
 * @param event
 */
function onPointerHover( event ) {

	if ( ! this.enabled ) return;

	switch ( event.pointerType ) {

		case 'mouse':
		case 'pen':
			this.pointerHover( this._getPointer( event ) );
			break;

	}

}

/**
 *
 * @param event
 */
function onPointerDown( event ) {

	if ( ! this.enabled ) return;
	const pointer = this._getPointer( event );

	if ( ! document.pointerLockElement ) {

		this.domElement.setPointerCapture( event.pointerId );

	}

	this.domElement.addEventListener( 'pointermove', this._onPointerMove );

	this._shouldRaycastAttachedObject = true;
	this.pointerHover( pointer );
	this._shouldRaycastAttachedObject = false;
	this.pointerDown( pointer );

}

/**
 *
 * @param event
 */
function onPointerMove( event ) {

	if ( ! this.enabled ) return;

	this.pointerMove( this._getPointer( event ) );

}

/**
 *
 * @param event
 */
function onPointerUp( event ) {

	if ( ! this.enabled ) return;

	this.domElement.releasePointerCapture( event.pointerId );

	this.domElement.removeEventListener( 'pointermove', this._onPointerMove );

	this.pointerUp( this._getPointer( event ) );

}

/**
 *
 * @param event
 */
function onKeyDown( event ) {

	if ( ! this.enabled ) return;

	if ( event.metaKey || event.ctrlKey ) {

		const prev = this.ctrlDown;
		this.ctrlDown = true;
		if ( prev !== this.ctrlDown ) {

			this.dispatchEvent( _changeEvent );

		}

	}

	if ( event.shiftKey ) {

		const prev = this.shiftDown;
		this.shiftDown = true;
		if ( prev !== this.shiftDown ) {

			this.dispatchEvent( _changeEvent );

		}

	}

}

/**
 *
 * @param event
 */
function onKeyUp( event ) {

	if ( ! this.enabled ) return;

	if ( ! event.metaKey && ! event.ctrlKey ) {

		const prev = this.ctrlDown;
		this.ctrlDown = false;
		if ( prev !== this.ctrlDown ) {

			this.dispatchEvent( _changeEvent );

		}

	}

	if ( ! event.shiftKey ) {

		const prev = this.shiftDown;
		this.shiftDown = false;
		if ( prev !== this.shiftDown ) {

			this.dispatchEvent( _changeEvent );

		}

	}

}

/**
 *
 * @param object
 * @param raycaster
 * @param includeInvisible
 */
function intersectObjectWithRay( object, raycaster, includeInvisible ) {

	const allIntersections = raycaster.intersectObject( object, true );

	for ( let i = 0; i < allIntersections.length; i ++ ) {

		if ( allIntersections[ i ].object.visible || includeInvisible ) {

			return allIntersections[ i ];

		}

	}

	return false;

}

/**
 *
 * @param controls
 */
function isUniformScaleActive( controls ) {

	return controls.shiftDown === true;

}

/**
 *
 * @param axis
 * @param scaleStart
 * @param scaleEnd
 */
function getUniformScaleSnapAxis( axis, scaleStart, scaleEnd ) {

	const axes = [ 'X', 'Y', 'Z' ].filter( ( key ) => axis.indexOf( key ) !== - 1 );

	if ( axes.length === 0 ) {

		return 'X';

	}

	if ( axes.length === 1 ) {

		return axes[ 0 ];

	}

	let snapAxis = axes[ 0 ];
	let maxDelta = - Infinity;

	for ( let i = 0; i < axes.length; i ++ ) {

		const key = axes[ i ].toLowerCase();
		const delta = Math.abs( scaleEnd[ key ] - scaleStart[ key ] );

		if ( delta > maxDelta ) {

			maxDelta = delta;
			snapAxis = axes[ i ];

		}

	}

	return snapAxis;

}

//

// Reusable utility variables

const _tempEuler = new Euler();
const _alignVector = new Vector3( 0, 1, 0 );
const _zeroVector = new Vector3( 0, 0, 0 );
const _lookAtMatrix = new Matrix4();
const _identityQuaternion = new Quaternion();
const _dirVector = new Vector3();
const _tempMatrix = new Matrix4();

const _unitX = new Vector3( 1, 0, 0 );
const _unitY = new Vector3( 0, 1, 0 );
const _unitZ = new Vector3( 0, 0, 1 );

const _v1 = new Vector3();
const _v2 = new Vector3();
const _v3 = new Vector3();

class TransformControlsRoot extends Object3D {

	constructor( controls ) {

		super();

		this.isTransformControlsRoot = true;

		this.controls = controls;
		this.visible = false;

	}

	// updateMatrixWorld updates key transformation variables
	updateMatrixWorld( force ) {

		const controls = this.controls;

		if ( controls.object !== undefined ) {

			controls.object.updateMatrixWorld();

			if ( controls.object.parent === null ) {

				console.error( 'TransformControls: The attached 3D object must be a part of the scene graph.' );

			} else {

				controls.object.parent.matrixWorld.decompose( controls._parentPosition, controls._parentQuaternion, controls._parentScale );

			}

			controls.object.matrixWorld.decompose( controls.worldPosition, controls.worldQuaternion, controls._worldScale );

			controls._parentQuaternionInv.copy( controls._parentQuaternion ).invert();
			controls._worldQuaternionInv.copy( controls.worldQuaternion ).invert();

		}

		controls.camera.updateMatrixWorld();
		controls.camera.matrixWorld.decompose( controls.cameraPosition, controls.cameraQuaternion, controls._cameraScale );

		if ( controls.camera.isOrthographicCamera ) {

			controls.camera.getWorldDirection( controls.eye ).negate();

		} else {

			controls.eye.copy( controls.cameraPosition ).sub( controls.worldPosition ).normalize();

		}

		super.updateMatrixWorld( force );

	}

	dispose() {

		this.traverse( function ( child ) {

			if ( child.geometry ) child.geometry.dispose();
			if ( child.material ) child.material.dispose();

		} );

	}

}

class TransformControlsGizmo extends Object3D {

	constructor( controls ) {

		super();
		this.controls = controls;

		this.isTransformControlsGizmo = true;

		this.type = 'TransformControlsGizmo';

		// shared materials

		const gizmoMaterial = new MeshBasicMaterial( {
			depthTest: false,
			depthWrite: false,
			fog: false,
			toneMapped: false,
			transparent: true,
			side: DoubleSide,
		} );

		const gizmoLineMaterial = new LineBasicMaterial( {
			depthTest: false,
			depthWrite: false,
			fog: false,
			toneMapped: false,
			transparent: true,
		} );

		// Make unique material for each axis/color

		const matInvisible = gizmoMaterial.clone();
		matInvisible.opacity = 0.15;

		const matHelper = gizmoLineMaterial.clone();
		matHelper.opacity = 0.8;

		const matRed = gizmoMaterial.clone();
		matRed.color.setHex( 0xbc2701 );

		const matGreen = gizmoMaterial.clone();
		matGreen.color.setHex( 0x6aa200 );

		const matBlue = gizmoMaterial.clone();
		matBlue.color.setHex( 0x427ef0 );

		const matRedTransparent = gizmoMaterial.clone();
		matRedTransparent.color.setHex( 0xbc2701 );
		matRedTransparent.opacity = 0.8;

		const matGreenTransparent = gizmoMaterial.clone();
		matGreenTransparent.color.setHex( 0x6aa200 );
		matGreenTransparent.opacity = 0.8;

		const matBlueTransparent = gizmoMaterial.clone();
		matBlueTransparent.color.setHex( 0x427ef0 );
		matBlueTransparent.opacity = 0.8;

		const matWhiteTransparent = gizmoMaterial.clone();
		matWhiteTransparent.opacity = 0.8;

		const matYellowTransparent = gizmoMaterial.clone();
		matYellowTransparent.color.setHex( 0xf5f801 );
		matYellowTransparent.opacity = 0.8;

		const matYellow = gizmoMaterial.clone();
		matYellow.color.setHex( 0xf5f801 );

		const matGray = gizmoMaterial.clone();
		matGray.color.setHex( 0x787878 );

		const matSector = gizmoMaterial.clone();
		matSector.color.setHex( 0xf5f801 );
		matSector.opacity = 0.25;

		const matLineRed = gizmoLineMaterial.clone();
		matLineRed.color.setHex( 0xbc2701 );

		const matLineGreen = gizmoLineMaterial.clone();
		matLineGreen.color.setHex( 0x6aa200 );

		const matLineBlue = gizmoLineMaterial.clone();
		matLineBlue.color.setHex( 0x427ef0 );

		// materials in the below property are configurable via setColors()

		this.materialLib = {
			xAxis: matRed,
			yAxis: matGreen,
			zAxis: matBlue,
			active: matYellow,
			xAxisTransparent: matRedTransparent,
			yAxisTransparent: matGreenTransparent,
			zAxisTransparent: matBlueTransparent,
			activeTransparent: matYellowTransparent,
		};

		// reusable geometry

		const arrowCylinder = new CylinderGeometry( 0.015, 0.04, 0.1, 12 );
		arrowCylinder.translate( 0, 0.05, 0 );

		const arrowTop = new SphereGeometry( 0.015, 12, 12 );
		arrowTop.translate( 0, 0.1, 0 );

		const arrowBottom = new TorusGeometry( 0.03, 0.01, 12, 12 );
		arrowBottom.rotateX( Math.PI / 2 );

		const arrowGeometry = BufferGeometryUtils.mergeBufferGeometries( [ arrowCylinder, arrowTop, arrowBottom ] );

		const scaleHandleGeometry = new SphereGeometry( 0.04, 16, 16 );
		scaleHandleGeometry.translate( 0, 0.04, 0 );

		const lineGeometry = new BufferGeometry();
		lineGeometry.setAttribute( 'position', new Float32BufferAttribute( [ 0, 0, 0,	1, 0, 0 ], 3 ) );

		const lineGeometry2 = new CylinderGeometry( 0.0075, 0.0075, 0.5, 3 );
		lineGeometry2.translate( 0, 0.25, 0 );

		/**
		 *
		 * @param radius
		 * @param arc
		 */
		function CircleGeometry( radius, arc ) {

			const geometry = new TorusGeometry( radius, 0.0075, 3, 64, arc * Math.PI * 2 );
			geometry.rotateY( Math.PI / 2 );
			geometry.rotateX( Math.PI / 2 );
			return geometry;

		}

		// Special geometry for transform helper. If scaled with position vector it spans from [0,0,0] to position

		/**
		 *
		 */
		function TranslateHelperGeometry() {

			const geometry = new BufferGeometry();

			geometry.setAttribute( 'position', new Float32BufferAttribute( [ 0, 0, 0, 1, 1, 1 ], 3 ) );

			return geometry;

		}

		/**
		 * @param {number} radius
		 * @param {number} cornerRadius
		 */
		function RoundedSectorGeometry( radius, cornerRadius ) {

			const shape = new Shape();
			const angle = Math.PI / 2;
			const r = radius;
			const cr = cornerRadius;

			if ( r <= cr ) {

				return new ShapeGeometry( new Shape(), 64 );

			}

			const cd = r - cr;
			const delta = Math.asin( cr / cd );

			// Inner corner rounded
			shape.absarc( cr, cr, cr, Math.PI, Math.PI * 1.5, false );

			// Start Edge Fillet
			const startCenter = { x: cd * Math.cos( delta ), y: cd * Math.sin( delta ) };
			shape.absarc( startCenter.x, startCenter.y, cr, - Math.PI / 2, delta, false );

			// Main Arc
			shape.absarc( 0, 0, r, delta, angle - delta, false );

			// End Edge Fillet
			const endFilletAngle = angle - delta;
			const endCenter = { x: cd * Math.cos( endFilletAngle ), y: cd * Math.sin( endFilletAngle ) };
			shape.absarc( endCenter.x, endCenter.y, cr, endFilletAngle, angle + Math.PI / 2, false );

			return new ShapeGeometry( shape, 64 );

		}

		/**
		 *
		 * @param text
		 */
		function createTextSprite( text ) {

			const canvas = document.createElement( 'canvas' );
			const context = canvas.getContext( '2d' );
			const W = 512;
			const H = 64;
			canvas.width = W;
			canvas.height = H;

			/**
			 *
			 * @param str
			 */
			function draw( str ) {

				context.clearRect( 0, 0, W, H );
				context.font = 'bold 32px Arial';

				if ( str ) {

					context.clearRect( 0, 0, W, H );
				}

				context.fillStyle = 'white';
				context.textAlign = 'center';
				context.textBaseline = 'middle';
				context.fillText( str, W / 2, H / 2 + 2 );

			}

			draw( text );

			const texture = new CanvasTexture( canvas );
			const material = new SpriteMaterial( { map: texture, depthTest: false, depthWrite: false, transparent: true } );
			const sprite = new Sprite( material );
			sprite.renderOrder = RENDER_ORDER.TEXT;
			sprite.scale.set( 2, 0.5, 1 );

			sprite.userData.updateText = function ( newText ) {

				draw( newText );
				texture.needsUpdate = true;

			};

			return sprite;

		}

		// Gizmo definitions - custom hierarchy definitions for setupGizmo() function

		const gizmoTranslate = {
			X: [
				[ new Mesh( arrowGeometry, matRed ), [ 0.5, 0, 0 ], [ 0, 0, - Math.PI / 2 ], null, 'arrow' ],
				[ new Mesh( arrowGeometry, matRed ), [ - 0.5 - 0.075, 0, 0 ], [ 0, 0, -Math.PI / 2 ], null, 'arrow' ],
				[ new Mesh( lineGeometry2, matRed ), [ 0, 0, 0 ], [ 0, 0, - Math.PI / 2 ], null, 'line' ],
				[ new Line( lineGeometry, matLineRed ), [ 0.0, 0, 0 ], null, [ 0.2, 0.2, 0.2 ], 'thin_line' ],
			],
			Y: [
				[ new Mesh( arrowGeometry, matGreen ), [ 0, 0.5, 0 ], null, null, 'arrow' ],
				[ new Mesh( arrowGeometry, matGreen ), [ 0, - 0.5 - 0.075, 0 ], null, null, 'arrow' ],
				[ new Mesh( lineGeometry2, matGreen ), null, null, null, 'line' ],
				[ new Line( lineGeometry, matLineGreen ), [ 0, 0.0, 0 ], [ 0, 0, Math.PI / 2 ], [ 0.2, 0.2, 0.2 ], 'thin_line' ],
			],
			Z: [
				[ new Mesh( arrowGeometry, matBlue ), [ 0, 0, 0.5 ], [ Math.PI / 2, 0, 0 ], null, 'arrow' ],
				[ new Mesh( arrowGeometry, matBlue ), [ 0, 0, - 0.5 - 0.075], [ Math.PI / 2, 0, 0 ], null, 'arrow' ],
				[ new Mesh( lineGeometry2, matBlue ), null, [ Math.PI / 2, 0, 0 ], null, 'line' ],
				[ new Line( lineGeometry, matLineBlue ), [ 0, 0, 0.0 ], [ 0, -Math.PI / 2, 0 ], [ 0.2, 0.2, 0.2 ], 'thin_line' ],
			],
			// XYZ: [
			// 	[ Object.assign( new Mesh( new SphereGeometry( 0.04, 16, 16 ), matWhiteTransparent ), { renderOrder: Infinity } ), [ 0, 0, 0 ]],
			// ],
			XY: [
				[ new Mesh( new RoundedSectorGeometry( 0.15, 0.05 ), matBlueTransparent ), [ 0, 0, 0 ]],
			],
			YZ: [
				[ new Mesh( new RoundedSectorGeometry( 0.15, 0.05 ), matRedTransparent ), [ 0, 0, 0 ], [ 0, Math.PI / 2, 0 ]],
			],
			XZ: [
				[ new Mesh( new RoundedSectorGeometry( 0.15, 0.05 ), matGreenTransparent ), [ 0, 0, 0 ], [ Math.PI / 2, 0, 0 ]],
			],
		};

		const pickerTranslate = {
			X: [
				[ new Mesh( new CylinderGeometry( 0.075, 0, 0.6, 4 ), matInvisible ), [ 0.3, 0, 0 ], [ 0, 0, - Math.PI / 2 ]],
				[ new Mesh( new CylinderGeometry( 0.075, 0, 0.6, 4 ), matInvisible ), [ - 0.3, 0, 0 ], [ 0, 0, Math.PI / 2 ]],
			],
			Y: [
				[ new Mesh( new CylinderGeometry( 0.075, 0, 0.6, 4 ), matInvisible ), [ 0, 0.3, 0 ]],
				[ new Mesh( new CylinderGeometry( 0.075, 0, 0.6, 4 ), matInvisible ), [ 0, - 0.3, 0 ], [ 0, 0, Math.PI ]],
			],
			Z: [
				[ new Mesh( new CylinderGeometry( 0.075, 0, 0.6, 4 ), matInvisible ), [ 0, 0, 0.3 ], [ Math.PI / 2, 0, 0 ]],
				[ new Mesh( new CylinderGeometry( 0.075, 0, 0.6, 4 ), matInvisible ), [ 0, 0, - 0.3 ], [ - Math.PI / 2, 0, 0 ]],
			],
			// XYZ: [
			// 	[ new Mesh( new OctahedronGeometry( 0.05, 0 ), matInvisible ) ],
			// ],
			XY: [
				[ new Mesh( new RoundedSectorGeometry( 0.15, 0.05 ), matInvisible ), [ 0, 0, 0 ]],
			],
			YZ: [
				[ new Mesh( new RoundedSectorGeometry( 0.15, 0.05 ), matInvisible ), [ 0, 0, 0 ], [ 0, Math.PI / 2, 0 ]],
			],
			XZ: [
				[ new Mesh( new RoundedSectorGeometry( 0.15, 0.05 ), matInvisible ), [ 0, 0, 0 ], [ Math.PI / 2, 0, 0 ]],
			],
		};

		const helperTranslate = {
			START: [
				[ new Mesh( new OctahedronGeometry( 0.01, 2 ), matYellow ), null, null, null, 'helper' ],
			],
			END: [
				[ new Mesh( new OctahedronGeometry( 0.01, 2 ), matYellow ), null, null, null, 'helper' ],
			],
			DELTA: [
				[ new Line( TranslateHelperGeometry(), matHelper ), null, null, null, 'helper' ],
				[ createTextSprite( '' ), [ 0, 0, 0 ], null, [ 1, 1, 1 ], 'text_helper' ],
			],
			X: [
				[ new Line( lineGeometry, matHelper ), [ - 1e3, 0, 0 ], null, [ 1e6, 1, 1 ], 'helper' ],
			],
			Y: [
				[ new Line( lineGeometry, matHelper ), [ 0, - 1e3, 0 ], [ 0, 0, Math.PI / 2 ], [ 1e6, 1, 1 ], 'helper' ],
			],
			Z: [
				[ new Line( lineGeometry, matHelper ), [ 0, 0, - 1e3 ], [ 0, - Math.PI / 2, 0 ], [ 1e6, 1, 1 ], 'helper' ],
			],
		};

		const gizmoRotate = {
			XYZE: [
				[ new Mesh( CircleGeometry( 0.4, 1 ), matGray ), null, [ 0, Math.PI / 2, 0 ]],
			],
			X: [
				[ new Mesh( CircleGeometry( 0.4, 1 ), matRed ) ],
			],
			Y: [
				[ new Mesh( CircleGeometry( 0.4, 1 ), matGreen ), null, [ 0, 0, - Math.PI / 2 ]],
			],
			Z: [
				[ new Mesh( CircleGeometry( 0.4, 1 ), matBlue ), null, [ 0, Math.PI / 2, 0 ]],
			],
			E: [
				// [ new Mesh( CircleGeometry( 0.75, 1 ), matYellowTransparent ), null, [ 0, Math.PI / 2, 0 ]]
			],
		};

		const gizmoRotateAll = {
			XYZE: [
				// [ new Mesh( CircleGeometry( 0.4, 1 ), matGray ), null, [ 0, Math.PI / 2, 0 ]]
			],
			X: [
				[ new Mesh( CircleGeometry( 0.4, 0.25 ), matRed ), null, [ 0, 0, 0 ] ],
			],
			Y: [
				[ new Mesh( CircleGeometry( 0.4, 0.25 ), matGreen ), null, [ 0, 0, - Math.PI / 2 ]],
			],
			Z: [
				[ new Mesh( CircleGeometry( 0.4, 0.25 ), matBlue ), null, [ 0, Math.PI / 2, 0 ]],
			],
			E: [
				// [ new Mesh( CircleGeometry( 0.75, 1 ), matYellowTransparent ), null, [ 0, Math.PI / 2, 0 ]]
			],
		};

		const helperRotate = {
			AXIS: [
				[ new Line( lineGeometry, matHelper ), [ - 1e3, 0, 0 ], null, [ 1e6, 1, 1 ], 'helper' ],
			],
			SECTOR: [
				[ new Mesh( new CylinderGeometry( 0, 0, 0, 12, 1, false ), matSector ), null, null, null, 'helper' ],
			],
			START: [
				[ new Mesh( new SphereGeometry( 0.02, 12, 12 ), matYellow ), null, null, null, 'helper' ],
			],
			END: [
				[ new Mesh( new SphereGeometry( 0.02, 12, 12 ), matYellow ), null, null, null, 'helper' ],
			],
			TEXT: [
				[ createTextSprite( '' ), [ 0, 0, 0 ], null, [ 1, 1, 1 ], 'text_helper' ],
			],
		};

		const pickerRotate = {
			XYZE: [
				// [ new Mesh( new SphereGeometry( 0.25, 10, 8 ), matInvisible ) ]
			],
			X: [
				[ new Mesh( new TorusGeometry( 0.4, 0.05, 4, 24, Math.PI / 2), matGray ), [ 0, 0, 0 ], [ Math.PI / 2, Math.PI / 2, 0 ]],
			],
			Y: [
				[ new Mesh( new TorusGeometry( 0.4, 0.05, 4, 24, Math.PI / 2), matGray ), [ 0, 0, 0 ], [ Math.PI / 2, 0, 0 ]],
			],
			Z: [
				[ new Mesh( new TorusGeometry( 0.4, 0.05, 4, 24, Math.PI / 2), matGray ), [ 0, 0, 0 ], [ 0, Math.PI, Math.PI / 2 ]],
			],
			E: [
				// [ new Mesh( new TorusGeometry( 0.75, 0.1, 2, 24 ), matInvisible ) ]
			],
		};

		const gizmoScale = {
			X: [
				[ new Mesh( scaleHandleGeometry, matRed ), [ 0.65, 0, 0 ], [ 0, 0, - Math.PI / 2 ]],
				// [ new Mesh( lineGeometry2, matRed ), [ 0, 0, 0 ], [ 0, 0, - Math.PI / 2 ]],
				[ new Mesh( scaleHandleGeometry, matRed ), [ - 0.65, 0, 0 ], [ 0, 0, Math.PI / 2 ]],
			],
			Y: [
				[ new Mesh( scaleHandleGeometry, matGreen ), [ 0, 0.65, 0 ]],
				// [ new Mesh( lineGeometry2, matGreen ) ],
				[ new Mesh( scaleHandleGeometry, matGreen ), [ 0, - 0.65, 0 ], [ 0, 0, Math.PI ]],
			],
			Z: [
				[ new Mesh( scaleHandleGeometry, matBlue ), [ 0, 0, 0.65 ], [ Math.PI / 2, 0, 0 ]],
				// [ new Mesh( lineGeometry2, matBlue ), [ 0, 0, 0 ], [ Math.PI / 2, 0, 0 ]],
				[ new Mesh( scaleHandleGeometry, matBlue ), [ 0, 0, - 0.65 ], [ - Math.PI / 2, 0, 0 ]],
			],
			XY: [
				// [ new Mesh( new BoxGeometry( 0.15, 0.15, 0.01 ), matBlueTransparent ), [ 0.15, 0.15, 0 ]]
			],
			YZ: [
				// [ new Mesh( new BoxGeometry( 0.15, 0.15, 0.01 ), matRedTransparent ), [ 0, 0.15, 0.15 ], [ 0, Math.PI / 2, 0 ]]
			],
			XZ: [
				// [ new Mesh( new BoxGeometry( 0.15, 0.15, 0.01 ), matGreenTransparent ), [ 0.15, 0, 0.15 ], [ - Math.PI / 2, 0, 0 ]]
			],
			XYZ: [
				// [ new Mesh( new SphereGeometry( 0.075, 16, 16 ), matWhiteTransparent ) ],
			],
		};

		const pickerScale = {
			X: [
				[ new Mesh( scaleHandleGeometry, matInvisible ), [ 0.65, 0, 0 ], [ 0, 0, - Math.PI / 2 ]],
				[ new Mesh( scaleHandleGeometry, matInvisible ), [ - 0.65, 0, 0 ], [ 0, 0, Math.PI / 2 ]],
				// [ new Mesh( new CylinderGeometry( 0.2, 0, 0.6, 4 ), matInvisible ), [ 0.3, 0, 0 ], [ 0, 0, - Math.PI / 2 ]],
				// [ new Mesh( new CylinderGeometry( 0.2, 0, 0.6, 4 ), matInvisible ), [ - 0.3, 0, 0 ], [ 0, 0, Math.PI / 2 ]]
			],
			Y: [
				[ new Mesh( scaleHandleGeometry, matInvisible ), [ 0, 0.65, 0 ]],
				[ new Mesh( scaleHandleGeometry, matInvisible ), [ 0, - 0.65, 0 ], [ 0, 0, Math.PI ]],
				// [ new Mesh( new CylinderGeometry( 0.2, 0, 0.6, 4 ), matInvisible ), [ 0, 0.3, 0 ]],
				// [ new Mesh( new CylinderGeometry( 0.2, 0, 0.6, 4 ), matInvisible ), [ 0, - 0.3, 0 ], [ 0, 0, Math.PI ]]
			],
			Z: [
				[ new Mesh( scaleHandleGeometry, matInvisible ), [ 0, 0, 0.65 ], [ Math.PI / 2, 0, 0 ]],
				[ new Mesh( scaleHandleGeometry, matInvisible ), [ 0, 0, - 0.65 ], [ - Math.PI / 2, 0, 0 ]],
				// [ new Mesh( new CylinderGeometry( 0.2, 0, 0.6, 4 ), matInvisible ), [ 0, 0, 0.3 ], [ Math.PI / 2, 0, 0 ]],
				// [ new Mesh( new CylinderGeometry( 0.2, 0, 0.6, 4 ), matInvisible ), [ 0, 0, - 0.3 ], [ - Math.PI / 2, 0, 0 ]]
			],
			XY: [
				// [ new Mesh( new BoxGeometry( 0.2, 0.2, 0.01 ), matInvisible ), [ 0.15, 0.15, 0 ]],
			],
			YZ: [
				// [ new Mesh( new BoxGeometry( 0.2, 0.2, 0.01 ), matInvisible ), [ 0, 0.15, 0.15 ], [ 0, Math.PI / 2, 0 ]],
			],
			XZ: [
				// [ new Mesh( new BoxGeometry( 0.2, 0.2, 0.01 ), matInvisible ), [ 0.15, 0, 0.15 ], [ - Math.PI / 2, 0, 0 ]],
			],
			XYZ: [
				// [ new Mesh( new SphereGeometry( 0.08, 16, 16 ), matInvisible ), [ 0, 0, 0 ]],
			],
		};

		const helperScale = {
			X: [
				[ new Line( lineGeometry, matHelper ), [ - 1e3, 0, 0 ], null, [ 1e6, 1, 1 ], 'helper' ],
			],
			Y: [
				[ new Line( lineGeometry, matHelper ), [ 0, - 1e3, 0 ], [ 0, 0, Math.PI / 2 ], [ 1e6, 1, 1 ], 'helper' ],
			],
			Z: [
				[ new Line( lineGeometry, matHelper ), [ 0, 0, - 1e3 ], [ 0, - Math.PI / 2, 0 ], [ 1e6, 1, 1 ], 'helper' ],
			],
			TEXT: [
				[ createTextSprite( '' ), [ 0, 0, 0 ], null, [ 1, 1, 1 ], 'text_helper' ],
			],
		};

		// Creates an Object3D with gizmos described in custom hierarchy definition.

		/**
		 *
		 * @param gizmoMap
		 */
		function setupGizmo( gizmoMap ) {

			const gizmo = new Object3D();

			for ( const name in gizmoMap ) {

				for ( let i = gizmoMap[ name ].length; i --; ) {

					const object = gizmoMap[ name ][ i ][ 0 ].clone();
					const isHelper = object.material === matHelper;
					object.material = object.material.clone();
					const position = gizmoMap[ name ][ i ][ 1 ];
					const rotation = gizmoMap[ name ][ i ][ 2 ];
					const scale = gizmoMap[ name ][ i ][ 3 ];
					const tag = gizmoMap[ name ][ i ][ 4 ];

					// name and tag properties are essential for picking and updating logic.
					object.name = name;
					object.tag = tag;
					object.userData.tag = tag;
					if ( gizmoMap[ name ][ i ][ 0 ].userData && gizmoMap[ name ][ i ][ 0 ].userData.updateText ) {

						object.userData.updateText = gizmoMap[ name ][ i ][ 0 ].userData.updateText;

					}

					if ( position ) {

						object.position.set( position[ 0 ], position[ 1 ], position[ 2 ] );
						object.userData.dir = new Vector3( position[ 0 ], position[ 1 ], position[ 2 ] ).normalize();

					}

					if ( rotation ) {

						object.rotation.set( rotation[ 0 ], rotation[ 1 ], rotation[ 2 ] );

					}

					if ( scale ) {

						object.scale.set( scale[ 0 ], scale[ 1 ], scale[ 2 ] );

					}

					object.updateMatrix();

					const tempGeometry = object.geometry.clone();
					tempGeometry.applyMatrix4( object.matrix );
					object.geometry = tempGeometry;

					if ( gizmoMap[ name ][ i ][ 0 ].renderOrder !== 0 ) {

						object.renderOrder = gizmoMap[ name ][ i ][ 0 ].renderOrder;

					} else {

						object.renderOrder = isHelper ? RENDER_ORDER.HELPER : RENDER_ORDER.GIZMO;

					}

					object.position.set( 0, 0, 0 );
					object.rotation.set( 0, 0, 0 );
					object.scale.set( 1, 1, 1 );

					gizmo.add( object );

				}

			}

			return gizmo;

		}

		// Gizmo creation

		this.gizmo = {};
		this.picker = {};
		this.helper = {};

		this.add( this.gizmo[ 'translate' ] = setupGizmo( gizmoTranslate ) );
		this.add( this.gizmo[ 'rotate' ] = setupGizmo( gizmoRotate ) );
		this.add( this.gizmo[ 'rotateAll' ] = setupGizmo( gizmoRotateAll ) );
		this.add( this.gizmo[ 'scale' ] = setupGizmo( gizmoScale ) );
		this.add( this.picker[ 'translate' ] = setupGizmo( pickerTranslate ) );
		this.add( this.picker[ 'rotate' ] = setupGizmo( pickerRotate ) );
		this.add( this.picker[ 'scale' ] = setupGizmo( pickerScale ) );
		this.add( this.helper[ 'translate' ] = setupGizmo( helperTranslate ) );
		this.add( this.helper[ 'rotate' ] = setupGizmo( helperRotate ) );
		this.add( this.helper[ 'scale' ] = setupGizmo( helperScale ) );

		const applyUserData = ( mode, gizmo ) => {

			gizmo[ mode ].traverse( ( child ) => child.userData.mode = mode );

		};

		applyUserData( 'translate', this.gizmo );
		applyUserData( 'rotate', this.gizmo );
		this.gizmo[ 'rotateAll' ].traverse( ( child ) => {

			child.userData.mode = 'rotate';

		} );
		applyUserData( 'scale', this.gizmo );
		applyUserData( 'translate', this.picker );
		applyUserData( 'rotate', this.picker );
		applyUserData( 'scale', this.picker );
		applyUserData( 'translate', this.helper );
		applyUserData( 'rotate', this.helper );
		applyUserData( 'scale', this.helper );

		// Pickers should be hidden always

		this.picker[ 'translate' ].visible = false;
		this.picker[ 'rotate' ].visible = false;
		this.picker[ 'scale' ].visible = false;

	}

	// updateMatrixWorld will update transformations and appearance of individual handles

	updateMatrixWorld( force ) {

		const mode = this.mode === 'all' ? this.subMode : this.mode;
		const space = this.space; // scale always oriented to local rotation

		const quaternion =  space === 'local' && this.object  ?  this.dragging ? this.parent.controls.worldQuaternionStart : this.parent.controls.worldQuaternion  : _identityQuaternion;

		const isDraggingRotationAll = this.mode === 'all' && this.dragging && ( this.axis === 'X' || this.axis === 'Y' || this.axis === 'Z' );

		// Show only gizmos for current transform mode

		this.gizmo[ 'translate' ].visible = ( this.mode === 'translate' || this.mode === 'all' ) && this.showTranslate;
		this.gizmo[ 'rotate' ].visible =  ( this.mode === 'rotate' || isDraggingRotationAll ) && this.showRotate;
		this.gizmo[ 'rotateAll' ].visible =   this.mode === 'all' && ! isDraggingRotationAll  && this.showRotate;
		this.gizmo[ 'scale' ].visible = ( this.mode === 'scale' || this.mode === 'all' ) && this.showScale;

		this.helper[ 'translate' ].visible = ( this.mode === 'translate' || this.mode === 'all' ) && this.showTranslate;
		this.helper[ 'rotate' ].visible = ( this.mode === 'rotate' || this.mode === 'all' ) && this.showRotate;
		this.helper[ 'scale' ].visible = ( this.mode === 'scale' || this.mode === 'all' ) && this.showScale;

		if ( isDraggingRotationAll ) {

			this.gizmo[ 'rotate' ].children.forEach( child => {

				child.visible = false;

			} );

		}

		let handles = [];

		if ( this.mode === 'all' ) {

			if ( this.showTranslate ) {
				handles = handles.concat( this.picker[ 'translate' ].children );
				handles = handles.concat( this.gizmo[ 'translate' ].children );
				handles = handles.concat( this.helper[ 'translate' ].children );
			}

			if ( this.showRotate ) {
				handles = handles.concat( this.picker[ 'rotate' ].children );

				if ( isDraggingRotationAll ) {

					const activeHandle = this.gizmo[ 'rotate' ].children.find( child => child.name === this.axis );
					if ( activeHandle ) handles.push( activeHandle );

				} else {

					handles = handles.concat( this.gizmo[ 'rotateAll' ].children );

				}

				handles = handles.concat( this.helper[ 'rotate' ].children );
			}

			if ( this.showScale ) {
				handles = handles.concat( this.picker[ 'scale' ].children );
				handles = handles.concat( this.gizmo[ 'scale' ].children );
				handles = handles.concat( this.helper[ 'scale' ].children );
			}

		} else {

			handles = handles.concat( this.picker[ this.mode ].children );
			handles = handles.concat( this.gizmo[ this.mode ].children );
			handles = handles.concat( this.helper[ this.mode ].children );

		}

		for ( let i = 0; i < handles.length; i ++ ) {

			const handle = handles[ i ];

			handle.visible = true;
			handle.rotation.set( 0, 0, 0 );
			handle.position.copy( this.worldPosition );

			let factor;

			if ( this.camera.isOrthographicCamera ) {
				factor = ( this.camera.top - this.camera.bottom ) / this.camera.zoom;
			} else {
				factor = this.worldPosition.distanceTo( this.cameraPosition ) * Math.min( 1.9 * Math.tan( Math.PI * this.camera.fov / 360 ) / this.camera.zoom, 7 );
			}

			// Do not scale helperTranslate:START handle
			if (!(handle.tag === 'helper' && handle.name === 'START')) {
				handle.scale.set( 1, 1, 1 ).multiplyScalar( factor * this.size / 4 );
			}

			if ( handle.name === 'XY' || handle.name === 'YZ' || handle.name === 'XZ' ) {

				_tempQuaternion.copy( quaternion ).invert();
				_alignVector.copy( this.eye ).applyQuaternion( _tempQuaternion );

				if ( ! this.dragging ) {

					if ( ! handle.userData.lastAlignVector ) handle.userData.lastAlignVector = new Vector3();
					handle.userData.lastAlignVector.copy( _alignVector );

				} else if ( handle.userData.lastAlignVector ) {

					_alignVector.copy( handle.userData.lastAlignVector );

				}

				if ( handle.name === 'XY' ) {

					const sx = _alignVector.x < 0 ? - 1 : 1;
					const sy = _alignVector.y < 0 ? - 1 : 1;

					// mirror
					handle.scale.multiply( _tempVector.set( sx, sy, 1 ) );

					// shift off the origin
					const offset = 0.05 * factor * this.size / 4;
					_tempVector.set( sx * offset, sy * offset, 0 );
					handle.position.add( _tempVector.applyQuaternion( quaternion ) );

				} else if ( handle.name === 'YZ' ) {

					const sy = _alignVector.y < 0 ? - 1 : 1;
					const sz = _alignVector.z < 0 ? - 1 : 1;

					// mirror
					handle.scale.multiply( _tempVector.set( 1, sy, - sz ) );

					// shift off the origin
					const offset = 0.05 * factor * this.size / 4;
					_tempVector.set( 0, sy * offset, sz * offset );
					handle.position.add( _tempVector.applyQuaternion( quaternion ) );

				} else if ( handle.name === 'XZ' ) {

					const sx = _alignVector.x < 0 ? - 1 : 1;
					const sz = _alignVector.z < 0 ? - 1 : 1;

					// mirror
					handle.scale.multiply( _tempVector.set( sx, 1, sz ) );

					// shift off the origin
					const offset = 0.05 * factor * this.size / 4;
					_tempVector.set( sx * offset, 0, sz * offset );
					handle.position.add( _tempVector.applyQuaternion( quaternion ) );

				}

			}

			if ( handle.userData.mode === 'rotate' && ( handle.name === 'X' || handle.name === 'Y' || handle.name === 'Z' ) ) {

				const isRotateAll = handle.parent === this.gizmo[ 'rotateAll' ];
				const isPicker = handle.parent === this.picker[ 'rotate' ];

				if ( isRotateAll || isPicker ) {

					let tempVector = _tempVector;

					if ( ! this.dragging ) {

						_tempQuaternion.copy( quaternion ).invert();
						_alignVector.copy( this.eye ).applyQuaternion( _tempQuaternion );

						if ( handle.name === 'X' ) {

							// Matches YZ plane logic
							const sy = _alignVector.y < 0 ? - 1 : 1;
							const sz = _alignVector.z < 0 ? - 1 : 1;
							tempVector.set( 1, sy, sz );

						} else if ( handle.name === 'Y' ) {

							// Matches XZ plane logic
							const sx = _alignVector.x < 0 ? - 1 : 1;
							const sz = _alignVector.z < 0 ? - 1 : 1;
							tempVector.set( sx, 1, sz );

						} else if ( handle.name === 'Z' ) {

							// Matches XY plane logic
							const sx = _alignVector.x < 0 ? - 1 : 1;
							const sy = _alignVector.y < 0 ? - 1 : 1;
							tempVector.set( sx, sy, 1 );

						}

						if ( ! handle.userData.lastScaleFlip ) handle.userData.lastScaleFlip = new Vector3();
						handle.userData.lastScaleFlip.copy( tempVector );

					} else if ( handle.userData.lastScaleFlip ) {

						tempVector = handle.userData.lastScaleFlip;

					}

					handle.scale.multiply( tempVector );

				}
			}

			if ( handle.userData.mode === 'translate' && ( handle.name === 'X' || handle.name === 'Y' || handle.name === 'Z' ) ) {

				if ( handle.userData.tag !== 'arrow' && handle.userData.tag !== 'thin_line' ) {

					let tempVector = _tempVector;

					if ( ! this.dragging ) {

						_tempQuaternion.copy( quaternion ).invert();
						_alignVector.copy( this.eye ).applyQuaternion( _tempQuaternion );

						if ( handle.name === 'X' ) {

							const sx = _alignVector.x < 0 ? - 1 : 1;
							tempVector.set( sx, 1, 1 );

						} else if ( handle.name === 'Y' ) {

							const sy = _alignVector.y < 0 ? - 1 : 1;
							tempVector.set( 1, sy, 1 );

						} else if ( handle.name === 'Z' ) {

							const sz = _alignVector.z < 0 ? - 1 : 1;
							tempVector.set( 1, 1, sz );

						}

						if ( ! handle.userData.lastScaleFlip ) handle.userData.lastScaleFlip = new Vector3();
						handle.userData.lastScaleFlip.copy( tempVector );

					} else if ( handle.userData.lastScaleFlip ) {

						tempVector = handle.userData.lastScaleFlip;

					}

					handle.scale.multiply( tempVector );

				}
			}

			if ( handle.tag === 'helper' || handle.tag === 'text_helper' || handle.userData.tag === 'helper' || handle.userData.tag === 'text_helper' ) {

				handle.visible = false;

				if ( handle.name === 'SECTOR' ||  handle.parent === this.helper[ 'rotate' ] && ( handle.name === 'START' || handle.name === 'END' || handle.name === 'TEXT' )  ) {

					const isRotating = mode === 'rotate';

					handle.visible = isRotating && this.dragging && ( this.axis === 'X' || this.axis === 'Y' || this.axis === 'Z' );

					if ( handle.visible ) {

						const controls = this.parent.controls;
						const start = controls.pointStart;
						const worldPos = controls.worldPosition;
						let rotationAngle = controls.rotationAngle;
						const rotationAxis = controls.rotationAxis;

						_tempVector.copy( start ).add( worldPos ).sub( controls.cameraPosition );
						_alignVector.copy( controls.cameraPosition ).sub( worldPos );
						const num = - _alignVector.dot( rotationAxis );
						const den = _tempVector.dot( rotationAxis );
						if ( Math.abs( den ) > 1e-6 ) {
							const t = num / den;
							_v1.copy( _alignVector ).addScaledVector( _tempVector, t );
						} else {
							_v1.copy( start );
						}

						_v1.projectOnPlane( rotationAxis ).normalize();
						_v2.copy( rotationAxis ).normalize();
						_v3.crossVectors( _v2, _v1 ).normalize(); // Tangent Vector

						if ( handle.name === 'START' ) {

							handle.position.copy( _v1 ).multiplyScalar( 0.1 * factor * this.size ).add( worldPos );
							handle.scale.setScalar( 0.25 * factor * this.size );

						} else if ( handle.name === 'END' ) {

							_tempVector.copy( _v1 ).applyAxisAngle( _v2, rotationAngle );
							handle.position.copy( _tempVector ).multiplyScalar( 0.1 * factor * this.size ).add( worldPos );
							handle.scale.setScalar( 0.25 * factor * this.size );

						} else if ( handle.name === 'SECTOR' ) {

							const startOffset = rotationAngle < 0 ? rotationAngle : 0;
							const length = Math.abs( rotationAngle );

							if ( handle.userData.startOffset !== startOffset || handle.userData.length !== length ) {

								handle.geometry.dispose();
								handle.geometry = new CylinderGeometry( 0, 0.4, 0, Math.max(12, Math.abs(32 * rotationAngle / Math.PI)), 1, false, startOffset, length );
								handle.userData.startOffset = startOffset;
								handle.userData.length = length;
								handle.rotation.set( 0, 0, 0 );

							}

							_tempMatrix.makeBasis( _v3, _v2, _v1 );
							handle.quaternion.setFromRotationMatrix( _tempMatrix );

						} else if ( handle.name === 'TEXT' ) {

							_tempVector.copy( _v1 ).applyAxisAngle( _v2, rotationAngle );
							handle.position.copy( _tempVector ).multiplyScalar( 0.1 * factor * this.size ).add( worldPos );

							// Recalculate factor for this specific handle position to keep text size constant
							let textFactor = factor;
							if ( ! this.camera.isOrthographicCamera ) {

								textFactor = handle.position.distanceTo( this.cameraPosition ) * Math.min( 1.9 * Math.tan( Math.PI * this.camera.fov / 360 ) / this.camera.zoom, 7 );

							}

							handle.scale.set( 1, 1, 1 ).multiplyScalar( textFactor * this.size * 0.15 );
							handle.scale.x *= 2;
							handle.scale.y *= 0.25;

							_v3.set( 0, 1, 0 ).applyQuaternion( this.cameraQuaternion );
							handle.position.addScaledVector( _v3, textFactor * this.size * 0.05 );

							if ( handle.userData.updateText ) {

								if ( controls.rotationDisplayUnit === 'radians' ) {

									handle.userData.updateText( `${rotationAngle.toFixed( 4 )} rad` );

								} else {

									const deg = ( rotationAngle * 180 / Math.PI ).toFixed( 2 );
									handle.userData.updateText( deg + "°" );

								}

							}

						}

					}

				} else if ( handle.name === 'AXIS' ) {

					handle.visible = !! this.axis;

					if ( this.axis === 'X' ) {

						_tempQuaternion.setFromEuler( _tempEuler.set( 0, 0, 0 ) );
						handle.quaternion.copy( quaternion ).multiply( _tempQuaternion );

						if ( Math.abs( _alignVector.copy( _unitX ).applyQuaternion( quaternion ).dot( this.eye ) ) > 0.9 ) {

							handle.visible = false;

						}

					}

					if ( this.axis === 'Y' ) {

						_tempQuaternion.setFromEuler( _tempEuler.set( 0, 0, Math.PI / 2 ) );
						handle.quaternion.copy( quaternion ).multiply( _tempQuaternion );

						if ( Math.abs( _alignVector.copy( _unitY ).applyQuaternion( quaternion ).dot( this.eye ) ) > 0.9 ) {

							handle.visible = false;

						}

					}

					if ( this.axis === 'Z' ) {

						_tempQuaternion.setFromEuler( _tempEuler.set( 0, Math.PI / 2, 0 ) );
						handle.quaternion.copy( quaternion ).multiply( _tempQuaternion );

						if ( Math.abs( _alignVector.copy( _unitZ ).applyQuaternion( quaternion ).dot( this.eye ) ) > 0.9 ) {

							handle.visible = false;

						}

					}

					if ( this.axis === 'XYZE' ) {

						_tempQuaternion.setFromEuler( _tempEuler.set( 0, Math.PI / 2, 0 ) );
						_alignVector.copy( this.rotationAxis );
						handle.quaternion.setFromRotationMatrix( _lookAtMatrix.lookAt( _zeroVector, _alignVector, _unitY ) );
						handle.quaternion.multiply( _tempQuaternion );
						handle.visible = this.dragging;

					}

					if ( this.axis === 'E' ) {

						handle.visible = false;

					}


				} else if ( handle.name === 'START' ) {

					handle.position.copy( this.worldPositionStart );
					handle.visible = this.dragging &&  mode === 'translate';

				} else if ( handle.name === 'END' ) {

					handle.position.copy( this.worldPosition );
					handle.visible = this.dragging &&  mode === 'translate';

				} else if ( handle.name === 'DELTA' ) {

					if ( handle.tag === 'text_helper' || handle.userData.tag === 'text_helper' ) {

						handle.visible = false;

						if ( this.dragging &&  mode === 'translate'  ) {

							const distance = this.worldPositionStart.distanceTo( this.worldPosition );

							if ( distance > 1e-4 ) {

								handle.visible = true;
								let text = distance.toFixed( 2 );

								if ( this.axis === 'X' || this.axis === 'Y' || this.axis === 'Z' ) {

									_alignVector.copy( this.axis === 'X' ? _unitX :  this.axis === 'Y' ? _unitY : _unitZ  );
									_alignVector.applyQuaternion( quaternion );
									_tempVector.copy( this.worldPosition ).sub( this.worldPositionStart );
									text = ( _tempVector.dot( _alignVector ) < 0 ? '-' : '' ) + text;

								} else if ( this.axis === 'XYZ' ) {

									handle.visible = false;

								}

								handle.position.copy( this.worldPositionStart ).lerp( this.worldPosition, 0.5 );
								handle.scale.set( 1, 1, 1 ).multiplyScalar( factor * this.size * 0.15 );
								handle.scale.x *= 2;
								handle.scale.y *= 0.25;

								// Recalculate factor for this specific handle position to keep text size constant
								let textFactor = factor;
								if ( ! this.camera.isOrthographicCamera ) {

									textFactor = handle.position.distanceTo( this.cameraPosition ) * Math.min( 1.9 * Math.tan( Math.PI * this.camera.fov / 360 ) / this.camera.zoom, 7 );

								}

								handle.scale.set( 1, 1, 1 ).multiplyScalar( textFactor * this.size * 0.15 );
								handle.scale.x *= 2;
								handle.scale.y *= 0.25;

								_v3.set( 0, 1, 0 ).applyQuaternion( this.cameraQuaternion );
								handle.position.addScaledVector( _v3, textFactor * this.size * 0.02 );

								if ( handle.userData.updateText ) {

									// Calculate signed translation delta
									const delta = _v1.copy( this.worldPosition ).sub( this.worldPositionStart );

									// Format value with explicit + for positive numbers
									const formatValue = ( val ) => {

										const fixed = val.toFixed( 2 );
										return val >= 0 ? '+' + fixed : fixed;

									};

									let text = '';

									// Build text based on active axis
									if ( this.axis ) {

										if ( this.axis.indexOf( 'X' ) !== - 1 ) text += `X: ${formatValue( delta.x )} `;
										if ( this.axis.indexOf( 'Y' ) !== - 1 ) text += `Y: ${formatValue( delta.y )} `;
										if ( this.axis.indexOf( 'Z' ) !== - 1 ) text += `Z: ${formatValue( delta.z )} `;

									} else {

										// Fallback to showing all axes if no specific axis
										text = `X: ${formatValue( delta.x )} Y: ${formatValue( delta.y )} Z: ${formatValue( delta.z )}`;

									}

									handle.userData.updateText( text.trim() );

								}

							}

						}

					} else {

						handle.position.copy( this.worldPositionStart );
						handle.quaternion.copy( this.worldQuaternionStart );
						_tempVector.set( 1e-10, 1e-10, 1e-10 ).add( this.worldPositionStart ).sub( this.worldPosition ).multiplyScalar( - 1 );
						_tempVector.applyQuaternion( this.worldQuaternionStart.clone().invert() );
						handle.scale.copy( _tempVector );
						handle.visible = this.dragging &&  mode === 'translate';

					}

				} else if ( handle.name === 'TEXT' ) {

					handle.visible = false;

					// Only show scale text when dragging in scale mode
					if ( this.dragging && mode === 'scale' && this.space === 'local' ) {

						handle.visible = true;
						handle.position.copy( this.worldPosition );
						handle.scale.set( 1, 1, 1 ).multiplyScalar( factor * this.size * 0.15 );
						handle.scale.x *= 2;
						handle.scale.y *= 0.25;

						_v3.set( 0, 1, 0 ).applyQuaternion( this.cameraQuaternion );
						handle.position.addScaledVector( _v3, factor * this.size * 0.1 );

						if ( handle.userData.updateText ) {

							let text = '';
							const s = this.object.scale;
							const uniformScale = isUniformScaleActive( this.parent.controls );

							if ( uniformScale ) {

								text = `X: ${s.x.toFixed( 2 )} Y: ${s.y.toFixed( 2 )} Z: ${s.z.toFixed( 2 )}`;

							} else if ( this.axis ) {

								if ( this.axis.indexOf( 'X' ) !== - 1 ) text += `X: ${s.x.toFixed( 2 )} `;
								if ( this.axis.indexOf( 'Y' ) !== - 1 ) text += `Y: ${s.y.toFixed( 2 )} `;
								if ( this.axis.indexOf( 'Z' ) !== - 1 ) text += `Z: ${s.z.toFixed( 2 )} `;

							}

							handle.userData.updateText( text.trim() );

						}

					}

				} else {

					handle.quaternion.copy( quaternion );

					if ( this.dragging ) {

						handle.position.copy( this.worldPositionStart );

					} else {

						handle.position.copy( this.worldPosition );

					}

					if ( this.axis ) {

						handle.visible = this.axis.search( handle.name ) !== - 1;

					}

				}

				continue;

			}

			handle.quaternion.copy( quaternion );

			if ( handle.userData.tag === 'thin_line' ) {

				handle.visible = true;
				handle.visible = handle.visible && ( handle.name.indexOf( 'X' ) === - 1 || this.showX );
				handle.visible = handle.visible && ( handle.name.indexOf( 'Y' ) === - 1 || this.showY );
				handle.visible = handle.visible && ( handle.name.indexOf( 'Z' ) === - 1 || this.showZ );
				continue;

			}

			if ( handle.userData.mode === 'translate' || handle.userData.mode === 'scale' ) {

				// Hide parts that are not in current quadrant
				const isPickerTranslate = handle.parent === this.picker[ 'translate' ];
				const isGizmoTranslate = handle.parent === this.gizmo[ 'translate' ];
				const isPickerScale = handle.parent === this.picker[ 'scale' ];
				const isGizmoScale = handle.parent === this.gizmo[ 'scale' ];

				if ( handle.userData.dir && ( isPickerTranslate || isGizmoTranslate || isPickerScale || isGizmoScale ) ) {

					_tempQuaternion.copy( quaternion ).invert();
					_alignVector.copy( this.eye ).applyQuaternion( _tempQuaternion );

					let hide = _alignVector.dot( handle.userData.dir ) < 0;

					if ( hide ) {

						if ( isPickerTranslate ) {

							if ( handle.name === 'X' && handle.userData.dir.x > 0 ) hide = false;
							if ( handle.name === 'Y' && handle.userData.dir.y > 0 ) hide = false;
							if ( handle.name === 'Z' && handle.userData.dir.z > 0 ) hide = false;

						}

					}

					if ( ! this.dragging ) {

						handle.userData.lastHide = hide;

					} else if ( handle.userData.lastHide !== undefined ) {

						hide = handle.userData.lastHide;

					}

					if ( hide ) {

						handle.visible = false;

					}

				}

				const AXIS_HIDE_THRESHOLD = 0.99;
				const PLANE_HIDE_THRESHOLD = 0.2;

				if ( handle.name === 'X' ) {

					if ( Math.abs( _alignVector.copy( _unitX ).applyQuaternion( quaternion ).dot( this.eye ) ) > AXIS_HIDE_THRESHOLD ) {

						handle.scale.set( 1e-10, 1e-10, 1e-10 );
						handle.visible = false;

					}

				}

				if ( handle.name === 'Y' ) {

					if ( Math.abs( _alignVector.copy( _unitY ).applyQuaternion( quaternion ).dot( this.eye ) ) > AXIS_HIDE_THRESHOLD ) {

						handle.scale.set( 1e-10, 1e-10, 1e-10 );
						handle.visible = false;

					}

				}

				if ( handle.name === 'Z' ) {

					if ( Math.abs( _alignVector.copy( _unitZ ).applyQuaternion( quaternion ).dot( this.eye ) ) > AXIS_HIDE_THRESHOLD ) {

						handle.scale.set( 1e-10, 1e-10, 1e-10 );
						handle.visible = false;

					}

				}

				if ( handle.name === 'XY' ) {

					if ( Math.abs( _alignVector.copy( _unitZ ).applyQuaternion( quaternion ).dot( this.eye ) ) < PLANE_HIDE_THRESHOLD ) {

						if ( ! this.dragging || this.axis !== 'XY' ) {

							handle.scale.set( 1e-10, 1e-10, 1e-10 );
							handle.visible = false;

						}

					}

				}

				if ( handle.name === 'YZ' ) {

					if ( Math.abs( _alignVector.copy( _unitX ).applyQuaternion( quaternion ).dot( this.eye ) ) < PLANE_HIDE_THRESHOLD ) {

						if ( ! this.dragging || this.axis !== 'YZ' ) {

							handle.scale.set( 1e-10, 1e-10, 1e-10 );
							handle.visible = false;

						}

					}

				}

				if ( handle.name === 'XZ' ) {

					if ( Math.abs( _alignVector.copy( _unitY ).applyQuaternion( quaternion ).dot( this.eye ) ) < PLANE_HIDE_THRESHOLD ) {

						if ( ! this.dragging || this.axis !== 'XZ' ) {

							handle.scale.set( 1e-10, 1e-10, 1e-10 );
							handle.visible = false;

						}

					}

				}

			} else if ( handle.userData.mode === 'rotate' ) {

				_alignVector.copy( this.eye ).applyQuaternion( _tempQuaternion.copy( quaternion ).invert() );

				const ROTATION_AXIS_HIDE_THRESHOLD = 0.99;
				if ( handle.name === 'X' ) {

					if ( Math.abs( _alignVector.y ) > ROTATION_AXIS_HIDE_THRESHOLD || Math.abs( _alignVector.z ) > ROTATION_AXIS_HIDE_THRESHOLD ) {

						handle.visible = false;

					}

				}

				if ( handle.name === 'Y' ) {

					if ( Math.abs( _alignVector.x ) > ROTATION_AXIS_HIDE_THRESHOLD || Math.abs( _alignVector.z ) > ROTATION_AXIS_HIDE_THRESHOLD ) {

						handle.visible = false;

					}

				}

				if ( handle.name === 'Z' ) {

					if ( Math.abs( _alignVector.x ) > ROTATION_AXIS_HIDE_THRESHOLD || Math.abs( _alignVector.y ) > ROTATION_AXIS_HIDE_THRESHOLD ) {

						handle.visible = false;

					}

				}

			}

			handle.visible = handle.visible && ( handle.name.indexOf( 'X' ) === - 1 || this.showX );
			handle.visible = handle.visible && ( handle.name.indexOf( 'Y' ) === - 1 || this.showY );
			handle.visible = handle.visible && ( handle.name.indexOf( 'Z' ) === - 1 || this.showZ );
			handle.visible = handle.visible && ( handle.name.indexOf( 'E' ) === - 1 ||  this.showX && this.showY && this.showZ  );

			if ( this.dragging && this.axis ) {

				if ( handle.userData.mode !== mode && handle.tag !== 'helper' ) {

					handle.visible = false;

				}

				if ( mode === 'translate' && handle.userData.mode === 'translate' && handle.tag !== 'helper' ) {

					if ( this.axis === 'X' || this.axis === 'Y' || this.axis === 'Z' ) {

						if ( this.axis !== handle.name ) {

							handle.visible = false;

						}

					} else if ( this.axis === 'XY' || this.axis === 'YZ' || this.axis === 'XZ' ) {

						if ( this.axis !== handle.name && this.axis.indexOf( handle.name ) === - 1 ) {

							handle.visible = false;

						}

					} else if ( this.axis === 'XYZ' ) {

						handle.visible = false;

					}

				}

			}

			handle.material._color = handle.material._color || handle.material.color.clone();
			handle.material._opacity = handle.material._opacity || handle.material.opacity;

			handle.material.color.copy( handle.material._color );
			handle.material.opacity = handle.material._opacity;

			if ( this.enabled && this.axis ) {

				if ( handle.userData.mode === mode ) {

					const uniformScale = mode === 'scale' && isUniformScaleActive( this.parent.controls );

					if ( handle.name === this.axis ) {

						handle.material.color.copy( this.materialLib.active.color );
						handle.material.opacity = 1.0;

					} else if ( this.axis !== 'XYZ' && this.axis.split( '' ).includes( handle.name ) ) {

						handle.material.color.copy( this.materialLib.active.color );
						handle.material.opacity = 1.0;

					} else if ( uniformScale && handle.tag !== 'helper' && handle.name.length === 1 ) {

						handle.material.color.copy( this.materialLib.active.color );
						handle.material.opacity = 1.0;

					}

				}

			}

		}

		super.updateMatrixWorld( force );

	}

}

//

class TransformControlsPlane extends Mesh {

	constructor( controls ) {

		super(
			new PlaneGeometry( 100000, 100000, 2, 2 ),
			new MeshBasicMaterial( { visible: false, wireframe: true, side: DoubleSide, transparent: true, opacity: 0.1, toneMapped: false } ),
		);
		this.controls = controls;
		// The plane is an interaction surface only. Object-level visibility keeps
		// WebGPU from submitting it even if material visibility is bypassed.
		// Raycaster intentionally still intersects invisible Object3D instances.
		this.visible = false;

		this.isTransformControlsPlane = true;

		this.type = 'TransformControlsPlane';

	}

	updateMatrixWorld( force ) {

		if ( this.worldPosition === undefined ) {

			if ( this.controls && this.controls.worldPosition ) {

				this.worldPosition = this.controls.worldPosition;

			} else {

				return;

			}

		}

		const mode = this.mode === 'all' ? this.subMode : this.mode;
		let space = this.space;

		this.position.copy( this.worldPosition );

		if ( this.mode === 'scale' || this.mode === 'all' ) space = 'local'; // scale always oriented to local rotation

		let unitX = _unitX;
		let unitY = _unitY;
		let unitZ = _unitZ;
		let eye = this.eye;

		if ( this.dragging ) {

			this.position.copy( this.worldPositionStart );
			eye = _tempVector.copy( this.cameraPosition ).sub( this.worldPositionStart ).normalize();

		}

		const quaternion = space === 'local' ?  this.dragging ? this.worldQuaternionStart : this.worldQuaternion  : _identityQuaternion;

		_v1.copy( unitX ).applyQuaternion( quaternion );
		_v2.copy( unitY ).applyQuaternion( quaternion );
		_v3.copy( unitZ ).applyQuaternion( quaternion );

		// Align the plane for current transform mode, axis and space.

		_alignVector.copy( _v2 );

		switch ( mode ) {

			case 'translate':
			case 'scale':
				switch ( this.axis ) {

					case 'X':
						_alignVector.copy( eye ).cross( _v1 );
						_dirVector.copy( _v1 ).cross( _alignVector );
						break;
					case 'Y':
						_alignVector.copy( eye ).cross( _v2 );
						_dirVector.copy( _v2 ).cross( _alignVector );
						break;
					case 'Z':
						_alignVector.copy( eye ).cross( _v3 );
						_dirVector.copy( _v3 ).cross( _alignVector );
						break;
					case 'XY':
						_dirVector.copy( _v3 );
						break;
					case 'YZ':
						_dirVector.copy( _v1 );
						break;
					case 'XZ':
						_alignVector.copy( _v3 );
						_dirVector.copy( _v2 );
						break;
					case 'XYZ':
					case 'E':
						_dirVector.set( 0, 0, 0 );
						break;

				}

				break;
			case 'rotate':
				switch ( this.axis ) {
					case 'X':
						_alignVector.copy( _unitY );
						_dirVector.copy( _unitX );
						break;
					case 'Y':
						_alignVector.copy( _unitX );
						_dirVector.copy( _unitY );
						break;
					case 'Z':
						_alignVector.copy( _unitY );
						_dirVector.copy( _unitZ );
						break;
					default:
						_dirVector.set( 0, 0, 0 );
				}
				break;
			default:
				// special case for rotate
				_dirVector.set( 0, 0, 0 );

		}

		if ( _dirVector.lengthSq() < 1e-10 ) {

			// If in rotate mode, make the plane parallel to camera
			_tempQuaternion.copy( this.cameraQuaternion );

			// Check if we can rotate around camera Z
			if ( mode === 'translate' && ( this.axis === 'X' || this.axis === 'Y' || this.axis === 'Z' ) ) {
				const axis =  this.axis === 'X'  ? _v1 :   this.axis === 'Y'  ? _v2 : _v3;
				const dot = axis.dot( eye );
				// If axis is parallel to view, use standard billboard
				if ( Math.abs( dot ) > 0.99 ) {
					// Fallback to camera plane
				} else {
					// Axis is not parallel (should not happen if dirVector is 0)
				}
			}
			
			this.quaternion.copy( _tempQuaternion );

		} else {

			_tempMatrix.lookAt( _tempVector.set( 0, 0, 0 ), _dirVector, _alignVector );

			this.quaternion.setFromRotationMatrix( _tempMatrix );

		}

		super.updateMatrixWorld( force );

	}

}

export { TransformControls, TransformControlsGizmo, TransformControlsPlane };
