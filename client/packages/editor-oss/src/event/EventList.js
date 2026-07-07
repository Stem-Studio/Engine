/**
 * Custom Event List
 *
 */
const EventList = [
    // DOM events
    "click",
    "contextmenu",
    "dblclick",
    "keydown",
    "keyup",
    "mousedown",
    "mousemove",
    "mouseup",
    "mousewheel",
    "resize", // Window resize
    "dragover", // Drag over element
    "drop", // Drop onto element

    // App events
    "appStart", // Called before the application starts
    "appStarted", // Called after the application started
    "appStop", // Called before the program ends
    "appStoped", // Called after the program ended
    "showMask", // Show loader
    "maskProgress", // Loader progress
    "login", // Login successful
    "logout", // Logout successful
    "message", // Received a WebSocket message in the format: { type: 'Message Type', ... }
    "send", // Send message via WebSocket in the format: { type: 'Message Type', ... }
    "queryLoadAutoSceneScene", // Prompt to load automatically saved scene
    "scenePublishStateUpdated",

    "playerInit",
    "playerStarted",
    "playerStopped",
    "playmodeInspectorToggled",
    "playmodeInspectorObjectSelected",
    "workspaceStatusRequested",
    "copilotPreviewSaveBlocked",

    "editorStarted",
    "editorStopped",

    "gameUpdated",
    "gameCreated",
    "gameInitialized",
    "gameStarted",
    "gameEnded",
    "pauseGame",
    "gameTimerUpdate",
    "gameLogin_quit",
    "gameLogin_requested",
    "gameLogin_showReminder",
    "gameLogin_success",
    "scoreUpdated",
    "lockEvent",
    "gameResumed",
    "removeGunAimer",
    "playingGame",
    "stoppedPlayingGame",
    "playerFallBack",
    "playerDead",
    "enableInfiniteGrid",
    "disableInfiniteGrid",
    "disposeEffectOutliner",
    "updateInfiniteGrid",
    "startVehicle",
    "stopVehicle",
    "updateVehicle",
    "disposeVehicle",
    "update3RD",
    "chatActivated",
    "chatDeactivated",
    "agentRegistered",
    "agentUnregistered",

    "pauseRender",
    "resumeRender",

    "saveEditorCameraState",
    "restoreEditorCameraState",

    // Configuration
    "optionChange", // A configuration has changed
    "optionsChanged", // Configuration changed event (parameters: none)
    "storageChanged", // Storage changed event (parameters: key, value)

    // Toolbar events
    "changeMode", // Change mode (select, translate, rotate, scale, delete)
    "changeView", // Change view (perspective, front, side, top)
    "viewChanged",
    "toggleUI",

    // Editing toolbar
    "undo",
    "redo",
    "clearHistory",
    "copy",
    "clone",
    "delete",
    "clearTools",

    // Editor events
    "sceneSaveStart", // Scene save started
    "sceneSaveFailed", // Scene save failed
    "sceneSaved", // Scene saved successfully
    "scenePublished", // Scene published or unpublished ({sceneId, action: "publish"|"unpublish"})
    "select", // Select event
    "clear", // Clear scene
    "load", // Load scene (url, name, id)
    "loadSceneList", // Load scene list (list, name, id)
    "fetchArchivedScenes",
    "log",

    "editScript", // Edit script event (uuid, name, type, source)
    "editorCleared",

    "snapChanged",
    "snappingSettingsChanged", // Snapping settings changed event
    "focusProjectSettingsSection", // Request focus on a project settings section
    "angleUnitsSettingsChanged", // Angle units settings changed event
    "unitsSettingsChanged", // Units settings changed event
    "boundingBoxModeChanged", // Bounding box mode (OOBB/AABB) changed event
    "spaceChanged", // Coordinate system changed event

    "sceneGraphChanged",
    "cameraChanged",
    "rendererChanged",

    "geometryChanged",
    "cadModeChanged",
    "cadToolChanged",
    "cadSelectionModeChanged",
    "cadSelectionShapeChanged",
    "cadAxisConstraintChanged",
    "cadToolsSettingsChanged",
    "cadSelectionChanged",
    "planCadChanged",
    "quickBuildBatchStarted",
    "quickBuildBatchEnded",

    // Asset events
    "assetAdded",
    "assetRemoved",
    "assetChanged",
    "sceneAssetChanged",
    "prefabPasted",
    "generatingThumbnail",
    "generatingThumbnailDone",
    "autoCreateAssetReleases",

    "objectSelected", // Object selection changed
    "objectArraySelected",
    "objectFocused",
    "objectHovered",
    "objectOutlined",
    "objectUnoutlined",
    "objectUpdated",
    "obbLabelEdit",

    "outlineObjects",

    "emitterUpdate",
    "emitterPlay",

    "objectAdded",
    "objectChanged",
    "objectRemoved",
    "collabObjectRemoved",
    "objectLocked",
    "objectUnlocked",
    "objectCloned",

    "onAudiosLoaded",
    "onModelsLoaded",
    "onVideosLoaded",
    "onNPCsLoaded",
    "onMapsLoaded",
    "onSoundsLoaded",

    "addText",
    "removeText",

    "scriptChanged",
    "sceneNameUpdated",
    "projectOwnerChanged",
    "readOnlyChanged", // DOT-7545: editor.isReadOnly flipped (Create.tsx → TopMenu)

    "historyChanged",

    "postProcessingChanged", // Post processing settings changed
    "currentMaterialChange", // Current material changed
    "restartRenderer", // Restart renderer

    // Scene edit area NOT USED ANYWHERE
    // 'transformControlsChange', // Transform controls changed
    // 'transformControlsMouseDown', // Transform controls mouse down
    // 'transformControlsMouseUp', // Transform controls mouse up

    "raycast", // Raycast (triggered even if no object is hit)
    "intersect", // Intersect (triggered only when an object is hit)
    "gpuPick", // GPU pick for selecting an object using GPU, parameters: { object: hit object (null if no hit), point: hit coordinates (if no hit, intersection with y=0 plane), distance: distance from camera to hit point (0 if no hit) }
    "beforeRender", // Execute before rendering
    "afterRender", // Execute after rendering
    "animate",

    // revision
    "currentRevisionUpdated",

    // Sidebar
    "animationSelected",
    "animationChanged",
    "resetAnimation", // Reset animation timeline
    "startAnimation", // Start animation playback
    "animationTime", // Current animation time from timeline

    // Bottom panel events
    "selectBottomPanel", // Click to select a bottom panel
    "showBottomPanel", // After showing a bottom panel
    "selectModel",
    "selectMap",
    "selectMaterial",
    "selectAudio",
    "selectVideo",
    "selectAnimation",
    "selectParticle",
    "updateSelection",

    // Status bar events
    "enableThrowBall",
    "enableVR",

    "fetchModels",
    "fetchAudio",
    "modelsFetched",
    "finishedModelUpload",
    "fileUploadStarted",
    "fileUploadFinished",
    "refreshBillboardList",

    "refreshBehaviorsList",
    "refreshAiNpcsList",

    "updateToken", // Update firebase token
    "dragEnd",

    "behaviorAutoUpdate",
    "updateIndicator",
    "generationJobStarted",
    "init",
    "unlockEvent",
    "contextmenuHover",
    "contextmenuUnhover",

    "sceneLoaded",
    "sceneUpdated",
    "sceneClosed",
    "sceneTriggeredSelect",

    "appModeEntered",
    "appModeExited",

    "resizeCodeEditor", // Resize code editor

    //behavior/script registry
    "behaviorRegistered",
    "behaviorUnregistered",
    "behaviorUpdated",
    "scriptRegistered",
    "scriptUnregistered",
    "scriptUpdated",

    //lambda regestry
    "lambdaRegistered",
    "lambdaUnregistered",
    "lambdaUpdated",

    // Multiplayer
    "multiplayerConnected",
    "multiplayerHostStarted",

    "clearGameDebugLogs",

    // Loading progress
    "loadingStatus",

    // AI events
    "aiAssistantResponse", // AI assistant response, parameters: response text
    "aiImageGenerationResponse", // AI image generation response, parameters: response data
    "aiModelGenerationResponse", // AI model generation response, parameters: response data

    // Copilot
    "copilotTerminal",
    "copilotEditStart",
    "copilotEditEnd",

    // Rewards
    "rewardTrack",
    "rewardTracked",
    "rewardTrackFailed",
];

export default EventList;
