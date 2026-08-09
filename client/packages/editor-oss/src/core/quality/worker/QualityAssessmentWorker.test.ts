import { describe, expect, it } from "vitest";

import { QualityAssessmentStateMachine } from "./QualityAssessmentWorker";
import type { WorkerRecommendChangeMessage } from "./QualityAssessmentWorker";

/**
 *
 */
function createMachine() {
    const recommendations: WorkerRecommendChangeMessage[] = [];
    const machine = new QualityAssessmentStateMachine((msg) => {
        recommendations.push(msg);
    });
    machine.init({
        windowSizeMs: 12000,
        downgradeThreshold: 3,
        upgradeCheckpoints: 3,
        cooldownMs: 25000,
    });
    return { machine, recommendations };
}

describe("QualityAssessmentStateMachine", () => {
    it("3 negative alarms trigger one-step downgrade", () => {
        const { machine, recommendations } = createMachine();

        for (let i = 0; i < 3; i++) {
            machine.processAlarm({ alarmType: "render_pressure", negative: true, timestamp: 1000 + i * 1000 });
        }

        expect(recommendations).toHaveLength(1);
        expect(recommendations[0]!.direction).toBe("down");
    });

    it("1-2 negatives do not trigger changes", () => {
        const { machine, recommendations } = createMachine();

        machine.processAlarm({ alarmType: "render_pressure", negative: true, timestamp: 1000 });
        machine.processAlarm({ alarmType: "render_pressure", negative: true, timestamp: 2000 });

        expect(recommendations).toHaveLength(0);
    });

    it("recovery requires 3 positive checkpoints with no negatives in window", () => {
        const { machine, recommendations } = createMachine();

        // First downgrade
        for (let i = 0; i < 3; i++) {
            machine.processAlarm({ alarmType: "render_pressure", negative: true, timestamp: 1000 + i * 1000 });
        }
        expect(recommendations).toHaveLength(1);

        // Wait out cooldown (25s)
        const afterCooldown = 1000 + 3000 + 25001;

        // 3 positive checkpoints
        for (let i = 0; i < 3; i++) {
            machine.processAlarm({ alarmType: "render_pressure", negative: false, timestamp: afterCooldown + i * 1000 });
        }

        expect(recommendations).toHaveLength(2);
        expect(recommendations[1]!.direction).toBe("up");
    });

    it("cooldown blocks repeated changes", () => {
        const { machine, recommendations } = createMachine();

        // Trigger downgrade
        for (let i = 0; i < 3; i++) {
            machine.processAlarm({ alarmType: "render_pressure", negative: true, timestamp: 1000 + i * 1000 });
        }
        expect(recommendations).toHaveLength(1);

        // More negatives during cooldown should be ignored
        for (let i = 0; i < 5; i++) {
            machine.processAlarm({ alarmType: "render_pressure", negative: true, timestamp: 5000 + i * 1000 });
        }
        expect(recommendations).toHaveLength(1);
    });

    it("pressure oscillation does not flicker presets", () => {
        const { machine, recommendations } = createMachine();

        // Alternate positive/negative - should never trigger
        for (let i = 0; i < 20; i++) {
            machine.processAlarm({
                alarmType: "render_pressure",
                negative: i % 2 === 0,
                timestamp: 1000 + i * 500,
            });
        }

        // At most 1 downgrade if 3 negatives happened to land in window
        // but with alternation, recovery resets on each negative
        expect(recommendations.length).toBeLessThanOrEqual(1);
    });

    it("session reset clears all state", () => {
        const { machine, recommendations } = createMachine();

        machine.processAlarm({ alarmType: "render_pressure", negative: true, timestamp: 1000 });
        machine.processAlarm({ alarmType: "render_pressure", negative: true, timestamp: 2000 });
        machine.sessionReset();
        machine.init({ windowSizeMs: 12000, downgradeThreshold: 3, upgradeCheckpoints: 3, cooldownMs: 25000 });

        // Previous negatives should not carry over
        machine.processAlarm({ alarmType: "render_pressure", negative: true, timestamp: 30000 });
        expect(recommendations).toHaveLength(0);
    });

    it("suppressed state ignores alarms", () => {
        const { machine, recommendations } = createMachine();

        machine.setSuppressed(true);
        for (let i = 0; i < 5; i++) {
            machine.processAlarm({ alarmType: "render_pressure", negative: true, timestamp: 1000 + i * 1000 });
        }
        expect(recommendations).toHaveLength(0);

        machine.setSuppressed(false);
        for (let i = 0; i < 3; i++) {
            machine.processAlarm({ alarmType: "render_pressure", negative: true, timestamp: 10000 + i * 1000 });
        }
        expect(recommendations).toHaveLength(1);
    });

    it("getDebugState returns current state info", () => {
        const { machine } = createMachine();

        machine.processAlarm({ alarmType: "render_pressure", negative: true, timestamp: 1000 });
        const debug = machine.getDebugState(1500);

        expect(debug.state).toBe("monitoring");
        expect(debug.negativeCount).toBe(1);
        expect(debug.recoveryCount).toBe(0);
    });

    it("getDebugState counts only alarms still inside the rolling window", () => {
        const { machine } = createMachine();

        machine.processAlarm({ alarmType: "render_pressure", negative: true, timestamp: 1000 });
        machine.processAlarm({ alarmType: "render_pressure", negative: false, timestamp: 2000 });

        const debug = machine.getDebugState(14000);

        expect(debug.negativeCount).toBe(0);
    });

    it("old alarms outside window are pruned", () => {
        const { machine, recommendations } = createMachine();

        // 2 negatives at t=0
        machine.processAlarm({ alarmType: "render_pressure", negative: true, timestamp: 0 });
        machine.processAlarm({ alarmType: "render_pressure", negative: true, timestamp: 1000 });

        // Wait beyond window (12s)
        // 1 more negative at t=15000 — should NOT trigger since old ones are pruned
        machine.processAlarm({ alarmType: "render_pressure", negative: true, timestamp: 15000 });

        expect(recommendations).toHaveLength(0);
    });
});
