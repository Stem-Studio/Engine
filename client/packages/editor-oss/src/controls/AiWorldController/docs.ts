// DOCUMENATION FOR AI GENERATION METHODS
export const DOCS = `### Object Types

export enum IMAGE_TYPES {
  CHARACTER = "Character",
  OBJECT = "Object",
  BACKDROP = "Backdrop",
  SKYBOX = "Skybox",
}

export enum TEXTURE_QUALITY {
  STANDARD = "standard",
  DETAILED = "detailed",
}

export enum MODEL_VERSION {
  V_25 = "v2.5-20250123",
  V_20 = "v2.0-20240919",
  V_14 = "v1.4-20240625",
}

export type AIResponse = {
  name: string;
  prompt: string;
  width: number;
  height: number;
  story: string;
  behaviorName: string;
  traits: string[];
  ai_agent_prompt: string;
  animations: string[];
};

export type GenerationStep = {
    name: string;
    function: string;
    parameters: any[];
};


### Method Params Types
type EnchancePromptParams = {
  prompt: string;
  adjectives: string;
}

type AttachBehaviorsParams = {
  names?: string[];
}

type ModifyModelByCopilotParams = {
  prompt: string;
}
  
### Method Documentation

#### enchancePrompt
**Description:**
Enhances a given prompt using AI, with an optional parameter to specify whether the enhancement should be tailored for 3D assets.

**Parameters:**
EnchancePromptParams
- prompt: string - The user-provided prompt to enhance.
- adjectives: string - Optional adjectives to enhance the prompt. Should describe only visual attributes. Commas should separate multiple adjectives.

**Returns:**
- AIResponse - The AI-enhanced prompt.

---

#### generateModelImage
**Description:**
Generates an image based on an AI response and specified parameters.

**Returns:**
- Promise<{ aiResponse: AIResponse, url?: string, file?: File | null }> - The generated image data.

---

#### generate3dObject
**Description:**
Generates a 3D object from text or an image.

**Returns:**
- Promise<{ task_id: string; model: string; rendered_image: string; } | undefined> - The generated model data.

---

#### addSkybox
**Description:**
Adds a skybox to the scene.

**Returns:**
- Promise<string> - "Success" when completed.

---

### addBackdrop
**Description:**
Adds a backdrop to the scene.

---

#### attachBehaviors
**Description:**
Attaches a behavior to a 3D object based on its AI object type. This assigns predefined AI behaviors to game objects like NPCs, AiAgents, and other entities.
It has to be included in every model generation process.

**Parameters:** 
AttachBehaviorsParams
- names?: string[] - Names of AI behaviors to assign. If omitted, no behavior is attached.

**Returns:**
- void

#### modifyModelByCopilot
**Description:**
Modifies a 3D or 2D model after adding it to the scene. This method is used to adjust the position, scale, rotation. This method can also attach, detach or update Behaviors - check behaviors documentation for available properties.
For now it is disabled.

**Parameters:** 
ModifyModelByCopilotParams
- prompt: string - The prompt used to modify the model. This prompt should describe the desired changes to the model. Available modifications: changing the model's position, scale, rotation, or attaching/detaching/updating behaviors.

**Returns:**
- void
`;

export const PHYSICS_DOCS =
    "export interface IPhysics {\n" +
    "    //physics type\n" +
    "    isMultiplayer(): boolean;\n" +
    "    isWorker(): boolean;\n" +
    "    isLocal(): boolean;\n" +
    "    //local cache\n" +
    "    addObject(uuid: string, mass: number, collisionFlag: CollisionFlag, object: Object3D): CollisionFlag;\n" +
    "    removeObject(uuid: string): void;\n" +
    "    getDynamicBodyObject(uuid: string): Object3D | undefined;\n" +
    "    getKinematicBodyObjects(): Map<string, Object3D>;\n" +
    "    //generic\n" +
    "    start(): Promise<IPhysics>;\n" +
    "    terminate(): void;\n" +
    "    simulate(): void;\n" +
    "    pause(): void;\n" +
    "    resume(): void;\n" +
    "    initDebug(): Object3D | null;\n" +
    "    //objects\n" +
    "    addBox(object: Object3D, data: BoxData): void;\n" +
    "    addSphere(object: Object3D, data: SphereData): void;\n" +
    "    addConcaveHull(object: Object3D, data: ConcaveHullData): void;\n" +
    "    addConvexHull(object: Object3D, data: ConvexHullData): void;\n" +
    "    addCapsuleShape(object: Object3D, data: CapsuleData): void;\n" +
    "    addTerrain(object: Object3D, data: TerrainData): void;\n" +
    "    remove(uuid: string): void;\n" +
    "    //force, velocity, etc\n" +
    "    applyCentralImpulse(uuid: string, impulse: Vector3): void;\n" +
    "    //rotation, position\n" +
    "    setOrigin(uuid: string, position: Vector3): void;\n" +
    "    setRotation(uuid: string, quaternion: Quaternion): void;\n" +
    "    setLinearVelocity(uuid: string, velocity: Vector3): void;\n" +
    "    //character\n" +
    "    addPlayerObject(uuid: string, useController: boolean, options?: IPlayerOptions): Promise<Object3D | null>;\n" +
    "    removePlayerObject(uuid: string): void;\n" +
    "    movePlayerObject(uuid: string, walkDirection: Vector3, jump: boolean): void;\n" +
    "    setPlayerSpeedAdjustment(uuid: string, speedAdjustment: Vector3): void;\n" +
    "    setPlayerPosition(uuid: string, position: Vector3): void;\n" +
    "    applyImpulseToPlayer(uuid: string, impulse: Vector3): void;\n" +
    "    //collisions\n" +
    "    addCollidableObject(uuid: string): void;\n" +
    "    removeCollidableObject(uuid: string): void;\n" +
    "    detectCollisionsForObject(uuid: string, registration: CollisionRegistration, enable: boolean): void;\n" +
    "    //MP specific\n" +
    "    setCurrentAnimation(uuid: string, animation: string): void;\n" +
    "    addOtsShiftVector(otsShiftVector: Vector3): void;\n" +
    "}";

export const GAME_MANAGER_DOCS =
    "class GameManager {\n" +
    '    static TOPIC = "game";\n' +
    "\n" +
    "    app: Player;\n" +
    "\n" +
    "    //config\n" +
    "    isEnabled = false;\n" +
    "    initialLives = 3;\n" +
    "    maxScore = 500;\n" +
    "\n" +
    "    //current session\n" +
    "    state = GAME_STATE.NOT_STARTED;\n" +
    "    score = 0;\n" +
    "    lives = 0;\n" +
    "    pickedWeaponOrItem?: THREE.Object3D;\n" +
    "    playerWeapons: THREE.Object3D[] = [];\n" +
    "\n" +
    "    //after init\n" +
    "    physics?: IPhysics;\n" +
    "    player?: THREE.Object3D | null;\n" +
    "    scene?: THREE.Scene;\n" +
    "    camera?: THREE.Camera;\n" +
    "    renderer?: THREE.Renderer;\n" +
    "    control?: IControl;\n" +
    "    hud?: HUDManager;\n" +
    "    gameTimer?: number = 0;\n" +
    '    time_remaining?: string = "00:00:00";\n' +
    "    timerRunning? = false;\n" +
    "    timerRemainingTime: number = 0;\n" +
    "    playerStartingPosition?: THREE.Vector3;\n" +
    "    instancer?: Instancer;\n" +
    "    collisionDetector?: CollisionDetector;\n" +
    "    behaviorManager?: BehaviorManager;\n" +
    "    isMultiplayer: boolean = false;\n" +
    "    animations?: any;\n" +
    "    aiConversationManager: AIConversationManager | null = null;" +
    "}";
