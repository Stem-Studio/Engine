/**
 * Worker-driven quality assessment state machine.
 * Aggregates alarm signals, enforces hysteresis/cooldowns,
 * and recommends preset stepping.
 *
 * States: idle → monitoring → cooldown → monitoring
 *
 * Message protocol:
 * Inbound:  init, alarm, quality_applied, session_reset
 * Outbound: recommend_change, state_debug
 */

export type WorkerState = 'idle' | 'monitoring' | 'cooldown';

export interface WorkerInitMessage {
    type: 'init';
    windowSizeMs: number;
    downgradeThreshold: number;
    upgradeCheckpoints: number;
    cooldownMs: number;
}

export interface WorkerAlarmMessage {
    type: 'alarm';
    alarmType: string;
    negative: boolean;
    timestamp: number;
}

export interface WorkerQualityAppliedMessage {
    type: 'quality_applied';
    presetId: string;
    timestamp: number;
}

export interface WorkerSessionResetMessage {
    type: 'session_reset';
}

export type WorkerInboundMessage =
    | WorkerInitMessage
    | WorkerAlarmMessage
    | WorkerQualityAppliedMessage
    | WorkerSessionResetMessage;

export interface WorkerRecommendChangeMessage {
    type: 'recommend_change';
    direction: 'up' | 'down';
    timestamp: number;
}

export interface WorkerStateDebugMessage {
    type: 'state_debug';
    state: WorkerState;
    negativeCount: number;
    recoveryCount: number;
    cooldownRemainingMs: number;
}

export type WorkerOutboundMessage = WorkerRecommendChangeMessage | WorkerStateDebugMessage;

// --- State machine logic (usable both in worker and in tests) ---

export class QualityAssessmentStateMachine {
    state: WorkerState = 'idle';
    private windowSizeMs = 12000;
    private downgradeThreshold = 3;
    private upgradeCheckpoints = 3;
    private cooldownMs = 25000;

    private alarmWindow: { timestamp: number; negative: boolean }[] = [];
    private recoveryCount = 0;
    private cooldownEndTime = 0;
    private suppressed = false;

    private onRecommend: ((msg: WorkerRecommendChangeMessage) => void) | null = null;

    constructor(onRecommend?: (msg: WorkerRecommendChangeMessage) => void) {
        this.onRecommend = onRecommend ?? null;
    }

    init(config: Omit<WorkerInitMessage, 'type'>): void {
        this.windowSizeMs = config.windowSizeMs;
        this.downgradeThreshold = config.downgradeThreshold;
        this.upgradeCheckpoints = config.upgradeCheckpoints;
        this.cooldownMs = config.cooldownMs;
        this.state = 'monitoring';
        this.alarmWindow = [];
        this.recoveryCount = 0;
    }

    processAlarm(alarm: Omit<WorkerAlarmMessage, 'type'>): void {
        if (this.state === 'idle' || this.suppressed) return;

        const now = alarm.timestamp;

        // If in cooldown, check if cooldown expired
        if (this.state === 'cooldown') {
            if (now < this.cooldownEndTime) return;
            this.state = 'monitoring';
            this.alarmWindow = [];
            this.recoveryCount = 0;
        }

        // Add to rolling window
        this.alarmWindow.push({ timestamp: now, negative: alarm.negative });

        // Prune old entries
        const cutoff = now - this.windowSizeMs;
        const negativeCount = this.pruneAlarmWindowAndCountNegatives(cutoff);

        // Downgrade check
        if (negativeCount >= this.downgradeThreshold) {
            this.onRecommend?.({
                type: 'recommend_change',
                direction: 'down',
                timestamp: now,
            });
            this.enterCooldown(now);
            return;
        }

        // Recovery / upgrade tracking
        if (!alarm.negative) {
            this.recoveryCount++;
            if (this.recoveryCount >= this.upgradeCheckpoints) {
                // Only recommend upgrade if window has no recent negatives
                if (negativeCount === 0) {
                    this.onRecommend?.({
                        type: 'recommend_change',
                        direction: 'up',
                        timestamp: now,
                    });
                    this.enterCooldown(now);
                }
                this.recoveryCount = 0;
            }
        } else {
            this.recoveryCount = 0;
        }
    }

    qualityApplied(timestamp: number): void {
        this.enterCooldown(timestamp);
    }

    sessionReset(): void {
        this.state = 'idle';
        this.alarmWindow = [];
        this.recoveryCount = 0;
        this.cooldownEndTime = 0;
        this.suppressed = false;
    }

    setSuppressed(suppressed: boolean): void {
        this.suppressed = suppressed;
    }

    getDebugState(now: number): WorkerStateDebugMessage {
        const cutoff = now - this.windowSizeMs;
        return {
            type: 'state_debug',
            state: this.state,
            negativeCount: this.countActiveNegativeAlarms(cutoff),
            recoveryCount: this.recoveryCount,
            cooldownRemainingMs: Math.max(0, this.cooldownEndTime - now),
        };
    }

    private pruneAlarmWindowAndCountNegatives(cutoff: number): number {
        let writeIndex = 0;
        let negativeCount = 0;

        for (let readIndex = 0; readIndex < this.alarmWindow.length; readIndex++) {
            const entry = this.alarmWindow[readIndex]!;
            if (entry.timestamp <= cutoff) {
                continue;
            }

            this.alarmWindow[writeIndex++] = entry;
            if (entry.negative) {
                negativeCount++;
            }
        }

        this.alarmWindow.length = writeIndex;
        return negativeCount;
    }

    private countActiveNegativeAlarms(cutoff: number): number {
        let negativeCount = 0;
        for (let i = 0; i < this.alarmWindow.length; i++) {
            const entry = this.alarmWindow[i]!;
            if (entry.timestamp > cutoff && entry.negative) {
                negativeCount++;
            }
        }
        return negativeCount;
    }

    private enterCooldown(now: number): void {
        this.state = 'cooldown';
        this.cooldownEndTime = now + this.cooldownMs;
        this.alarmWindow = [];
        this.recoveryCount = 0;
    }
}

// --- Worker entry point ---
// When loaded as a Worker, wire up message handling.
const _self = typeof self !== 'undefined' ? self : undefined;
if (_self && typeof (_self as any).WorkerGlobalScope !== 'undefined' ||
    (typeof self !== 'undefined' && typeof (self as any).postMessage === 'function' && typeof (self as any).window === 'undefined')) {
    const machine = new QualityAssessmentStateMachine((msg) => {
        self.postMessage(msg);
    });

    self.onmessage = (event: MessageEvent<WorkerInboundMessage>) => {
        const data = event.data;
        switch (data.type) {
            case 'init':
                machine.init(data);
                break;
            case 'alarm':
                machine.processAlarm(data);
                break;
            case 'quality_applied':
                machine.qualityApplied(data.timestamp);
                break;
            case 'session_reset':
                machine.sessionReset();
                break;
        }
    };
}
