import EventEmitter from "eventemitter3";

type EventBusPriority = "engine" | "game";

interface EventBusSubscribeOptions {
    priority?: EventBusPriority;
}

interface EventBusSubscription {
    topic: string;
    priority: EventBusPriority;
    handler: (data: any) => void;
}

interface EventBusEventNames {
    engine: string;
    game: string;
}

class EventBus {
    static instance: EventBus = new EventBus();

    private emitter = new EventEmitter();

    private tokens = new Map<string, EventBusSubscription>();

    private topicTokens = new Map<string, Set<string>>();

    private eventNames = new Map<string, EventBusEventNames>();

    private counter = 0;

    private constructor() {}

    private shouldTrace(topic?: string): boolean {
        const trace = (globalThis as any).__TRACE_EVENTBUS__;
        if (!trace) return false;
        if (trace === true) return true;
        if (!topic) return false;
        if (Array.isArray(trace)) return trace.includes(topic);
        if (typeof trace === "string") return trace.split(",").map((s: string) => s.trim()).includes(topic);
        return false;
    }

    reset() {
        this.tokens.forEach((_, token) => this.unsubscribe(token));
        this.tokens.clear();
        this.topicTokens.clear();
        this.eventNames.clear();
    }

    unsubscribe(tokenOrTopic: string) {
        const subscription = this.tokens.get(tokenOrTopic);
        if (subscription) {
            this.emitter.off(this.getEventNames(subscription.topic)[subscription.priority], subscription.handler);
            this.tokens.delete(tokenOrTopic);
            const topicSet = this.topicTokens.get(subscription.topic);
            topicSet?.delete(tokenOrTopic);
            if (topicSet?.size === 0) {
                this.topicTokens.delete(subscription.topic);
            }
            return;
        }

        const topicSet = this.topicTokens.get(tokenOrTopic);
        if (!topicSet) {
            return;
        }

        while (topicSet.size > 0) {
            const token = topicSet.values().next().value;
            if (!token) {
                break;
            }
            this.unsubscribe(token);
        }
    }

    subscribe(topic: string, callback: (msg: string, data: any) => void, options: EventBusSubscribeOptions = {}): string {
        const priority = options.priority ?? "game";
        const token = `eventbus.${++this.counter}`;

        const handler = (...args: any[]) => {
            if (args.length > 1) {
                callback(args[0], args[1]);
            } else {
                callback(topic, args[0]);
            }
        };

        this.emitter.on(this.getEventNames(topic)[priority], handler);
        this.tokens.set(token, {topic, priority, handler});
        if (!this.topicTokens.has(topic)) {
            this.topicTokens.set(topic, new Set());
        }
        this.topicTokens.get(topic)?.add(token);

        if (this.shouldTrace(topic)) {
            console.info(`[EventBus] subscribe topic=${topic} priority=${priority} token=${token}`);
        }

        return token;
    }

    send(topic: string, data: any = {}) {
        if (this.shouldTrace(topic)) {
            console.info(`[EventBus] send topic=${topic}`, data);
        }

        if (this.topicTokens.size === 0) {
            return;
        }

        // Emit exact match
        if (this.topicTokens.has(topic)) {
            const eventNames = this.getEventNames(topic);
            this.emitter.emit(eventNames.engine, data);
            this.emitter.emit(eventNames.game, data);
        }

        // Emit hierarchical parents
        let parentTopic = topic;
        while (parentTopic.includes(".")) {
            const index = parentTopic.lastIndexOf(".");
            parentTopic = parentTopic.substring(0, index);
            if (parentTopic && this.topicTokens.has(parentTopic)) {
                const eventNames = this.getEventNames(parentTopic);
                this.emitter.emit(eventNames.engine, topic, data);
                this.emitter.emit(eventNames.game, topic, data);
            }
        }
    }

    private getEventNames(topic: string): EventBusEventNames {
        let eventNames = this.eventNames.get(topic);
        if (!eventNames) {
            eventNames = {
                engine: `engine:${topic}`,
                game: `game:${topic}`,
            };
            this.eventNames.set(topic, eventNames);
        }
        return eventNames;
    }
}

export default EventBus;

export enum BEHAVIOR_EVENTS {
    DAY_NIGHT_CYCLE = "DayNightCycle",
}

export enum IN_GAME_EVENTS {
    GAME_LIVES_INC = "game.lives.inc",
    GAME_LIVES_DEC = "game.lives.dec",
    GAME_HEALTH_INC = "game.health.inc",
    GAME_HEALTH_DEC = "game.health.dec",
    GAME_SCORE_INC = "game.score.inc",
    GAME_SCORE_DEC = "game.score.dec",
    GAME_TIME_INC = "game.time.inc",
    GAME_TIME_DEC = "game.time.dec",
    GAME_LOGIN_SUCCESS = "game.loginSuccess",
    // Enemy events
    ENEMY_SPAWNED = "enemy.spawned",
    ENEMY_DIED = "enemy.died",
    ENEMY_GOT_HIT = "enemy.got.hit",
    ENEMY_STATE_CHANGED = "enemy.state.changed",
    ENEMY_PLAYER_DETECTED = "enemy.player.detected",
    ENEMY_PLAYER_LOST = "enemy.player.lost",
    ENEMY_ATTACK_STARTED = "enemy.attack.started",
    ENEMY_ATTACK = "enemy.attack",
    ENEMY_ATTACK_ENDED = "enemy.attack.ended",
    // Player events
    CHARACTER_IDLE = "character.motion.none",
    CHARACTER_ACTION_FALL_BACK = "character.action.fall_back",
    CHARACTER_ACTION_DEAD = "character.action.dead",
    CHARACTER_MOTION_START = "character.motion_start",
    CHARACTER_MOTION = "character.motion",
    CHARACTER_MOTION_END = "character.motion_end",
    CHARACTER_MOTION_WALK_START = "character.motion.walk_start",
    CHARACTER_MOTION_WALK = "character.motion.walk",
    CHARACTER_MOTION_WALK_END = "character.motion.walk_end",
    CHARACTER_MOTION_RUN_START = "character.motion.run_start",
    CHARACTER_MOTION_RUN = "character.motion.run",
    CHARACTER_MOTION_RUN_END = "character.motion.run_end",
    CHARACTER_ACTION_JUMP_START = "character.action.jump_start",
    CHARACTER_ACTION_JUMP = "character.action.jump",
    CHARACTER_ACTION_LAND = "character.action.land",
    CHARACTER_ACTION_CLIMB_START = "character.action.climb_start",
    CHARACTER_ACTION_CLIMB = "character.action.climb",
    CHARACTER_ACTION_CLIMB_END = "character.action.climb_end",
    CHARACTER_ACTION_CROUCH_START = "character.action.crouch_start",
    CHARACTER_ACTION_CROUCH = "character.action.crouch",
    CHARACTER_ACTION_CROUCH_END = "character.action.crouch_end",
    CHARACTER_ACTION_FALL_START = "character.action.fall_start",
    CHARACTER_ACTION_FALL = "character.action.fall",
    CHARACTER_ACTION_FALL_END = "character.action.fall_end",
    CHARACTER_ACTION_INTERACT = "character.action.interact",
    // Animation control events
    CHARACTER_ANIMATION_TRIGGER = "character.animation.trigger",
    CHARACTER_ANIMATION_STOP = "character.animation.stop",
    CHARACTER_ANIMATION_COMPLETE = "character.animation.complete",
    // Consumable events
    CONSUMABLE_IN_RANGE = "consumable.in.range",
    CONSUMABLE_NOT_IN_RANGE = "consumable.not.in.range",
    CONSUMABLE_COLLECTED = "consumable.collected",
    CONSUMABLE_COLLIDED = "consumable.collided",
    // Jumppad events
    JUMPPAD_ACTIVATED = "jumppad.activated",
    // Platform events
    PLATFORM_ACTIVATED = "platform.activated",
    PLATFORM_MOVING = "platform.moving",
    PLATFORM_DEACTIVATED = "platform.deactivated",
    // Volume events
    VOLUME_ACTIVATED = "volume.activated",
    // Randomized Spawner events
    RANDOMIZED_SPAWNER_ACTIVATED = "randomized.spawner.activated",
    // Spawn events
    SPAWN_ACTIVATED = "spawner.activated",
    // Teleport events
    TELEPORT_ACTIVATED = "teleport.activated",
    // NPC events
    NPC_INTERACTION_STARTED = "npc.interaction.started",
    NPC_INTERACTION_ENDED = "npc.interaction.ended",
    NPC_ACTION_STARTED = "npc.action.started",
    NPC_ACTION_ENDED = "npc.action.ended",
}
