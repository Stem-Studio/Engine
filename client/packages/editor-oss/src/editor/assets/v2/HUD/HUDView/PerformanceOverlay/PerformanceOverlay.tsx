import React, { useState, useEffect, useRef } from "react";
import i18n from "i18next";
import styled from "styled-components";

import type EngineRuntime from "@stem/editor-oss/EngineRuntime";
import global from "@stem/editor-oss/global";
import {
    runtimeFrameTelemetry,
    type RuntimeFrameTelemetrySnapshot,
} from "@stem/editor-oss/core/performance/RuntimeFrameTelemetry";
import {
    type GpuResourceOwnershipDiagnostics,
} from "@stem/editor-oss/core/resources/GpuResourceOwnership";
import type {RuntimeLodDiagnostics} from "@stem/editor-oss/core/lod/RuntimeLodController";
import {getRuntimeSubsystemDiagnostics} from "@stem/editor-oss/core/performance/RuntimeSubsystemDiagnostics";

const OverlayContainer = styled.div<{ $isVisible: boolean; $isCompact: boolean }>`
    position: fixed;
    top: 100px;
    right: 20px;
    width: ${props => props.$isCompact ? '200px' : '300px'};
    background: rgba(0, 0, 0, 0.9);
    border: 1px solid #444;
    border-radius: 8px;
    padding: 12px;
    color: white;
    font-family: 'Roboto', sans-serif;
    font-size: 12px;
    z-index: 15000;
    transform: ${props => props.$isVisible ? 'translateX(0)' : `translateX(${props.$isCompact ? '220px' : '320px'})`};
    transition: transform 0.3s ease-in-out;
    max-height: ${props => props.$isCompact ? '200px' : '400px'};
    overflow-y: auto;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    pointer-events: auto;
    
    &:hover {
        border-color: #666;
        box-shadow: 0 6px 16px rgba(0, 0, 0, 0.5);
    }
    
    @media (max-width: 768px) {
        top: 70px;
        right: 10px;
        left: 10px;
        width: auto;
        max-width: calc(100vw - 20px);
    }
    
    @media (max-height: 600px) {
        top: 60px;
        max-height: calc(100vh - 80px);
    }
`;

const ToggleButton = styled.button<{ $isVisible: boolean }>`
    position: fixed;
    top: 100px;
    right: ${props => props.$isVisible ? '340px' : '20px'};
    width: 40px;
    height: 40px;
    background: rgba(0, 0, 0, 0.8);
    border: 1px solid #444;
    border-radius: 50%;
    color: white;
    font-size: 16px;
    cursor: pointer;
    z-index: 15001;
    transition: right 0.3s ease-in-out, top 0.3s ease-in-out;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);

    &:hover {
        background: rgba(0, 0, 0, 0.95);
        border-color: #666;
        transform: scale(1.05);
    }
    
    @media (max-width: 768px) {
        top: 70px;
        right: ${props => props.$isVisible ? '10px' : '10px'};
        width: 35px;
        height: 35px;
        font-size: 14px;
    }
    
    @media (max-height: 600px) {
        top: 60px;
    }
`;

const Header = styled.div`
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 12px;
    border-bottom: 1px solid #333;
    padding-bottom: 8px;
`;

const Title = styled.h3`
    margin: 0;
    font-size: 14px;
    color: #fff;
`;

const CloseButton = styled.button`
    background: none;
    border: none;
    color: #888;
    font-size: 16px;
    cursor: pointer;
    padding: 0;
    width: 20px;
    height: 20px;

    &:hover {
        color: #fff;
    }
`;

const MetricsGrid = styled.div`
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
    margin-bottom: 12px;
`;

const MetricCard = styled.div<{ $color: string }>`
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid ${props => props.$color};
    border-radius: 4px;
    padding: 6px;
    text-align: center;
`;

const MetricValue = styled.div`
    font-size: 16px;
    font-weight: bold;
    color: #fff;
`;

const MetricLabel = styled.div`
    font-size: 9px;
    color: #aaa;
    margin-top: 2px;
`;

const Section = styled.div`
    margin-bottom: 12px;
`;

const SectionTitle = styled.div`
    font-size: 11px;
    color: #ccc;
    margin-bottom: 6px;
    font-weight: bold;
`;

const RecommendationCard = styled.div<{ $type: 'info' | 'warning' | 'success' }>`
    background: ${props => 
        props.$type === 'warning' ? 'rgba(255, 165, 0, 0.2)' : 
        props.$type === 'success' ? 'rgba(0, 255, 0, 0.2)' : 'rgba(0, 153, 255, 0.2)'
    };
    border: 1px solid ${props => 
        props.$type === 'warning' ? '#ffa500' : 
        props.$type === 'success' ? '#00ff00' : '#0099ff'
    };
    border-radius: 4px;
    padding: 6px;
    margin: 4px 0;
    font-size: 10px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
`;

const QuickFixButton = styled.button`
    background: rgba(255, 255, 255, 0.15);
    border: 1px solid rgba(255, 255, 255, 0.3);
    border-radius: 4px;
    color: white;
    font-size: 9px;
    padding: 4px 8px;
    cursor: pointer;
    white-space: nowrap;
    font-weight: 500;
    transition: all 0.2s ease;
    min-width: 60px;
    
    &:hover {
        background: rgba(255, 255, 255, 0.25);
        border-color: rgba(255, 255, 255, 0.5);
        transform: translateY(-1px);
    }
    
    &:active {
        transform: translateY(0);
    }
`;

const CompactToggle = styled.button`
    background: none;
    border: none;
    color: #888;
    font-size: 12px;
    cursor: pointer;
    padding: 0;
    margin-left: 8px;

    &:hover {
        color: #fff;
    }
`;

const FPSCounter = styled.div`
    position: fixed;
    top: 100px;
    left: 20px;
    background: rgba(0, 0, 0, 0.8);
    border: 1px solid #444;
    border-radius: 4px;
    padding: 8px 12px;
    color: white;
    font-family: 'Roboto', sans-serif;
    font-size: 14px;
    z-index: 14999;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
    pointer-events: none;
    
    @media (max-width: 768px) {
        top: 70px;
        left: 10px;
        font-size: 12px;
        padding: 6px 10px;
    }
    
    @media (max-height: 600px) {
        top: 60px;
    }
`;

interface PerformanceData {
    totalChecks: number;
    culledCount: number;
    throttledCount: number;
    cullingEfficiency: number;
    throttlingEfficiency: number;
    runTimeMs: number;
}

interface SubsystemDiagnostics {
    gpuResources: GpuResourceOwnershipDiagnostics;
    lod: RuntimeLodDiagnostics | null;
    renderer: RendererDiagnostics | null;
}

export interface RendererDiagnostics {
    calls: number;
    triangles: number;
    frameCalls: number | null;
    frameTriangles: number | null;
    counterScope: "cumulative" | "frame" | "unknown";
    geometries: number;
    textures: number;
    pixelRatio: number;
    drawingBufferWidth: number;
    drawingBufferHeight: number;
}

const finiteCounter = (value: unknown): number => {
    return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0;
};

const optionalFiniteCounter = (value: unknown): number | null => {
    return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : null;
};

/** Read renderer-owned counters without touching the scene or forcing layout. */
export function getRendererDiagnostics(app: EngineRuntime | null | undefined): RendererDiagnostics | null {
    const renderer = app?.renderer as (EngineRuntime["renderer"] & {
        info?: {
            autoReset?: boolean;
            render?: {calls?: number; triangles?: number};
            memory?: {geometries?: number; textures?: number};
        };
        getPixelRatio?: () => number;
        domElement?: {width?: number; height?: number};
    }) | undefined;
    if (!renderer?.info) return null;

    const frameInfo = (app as EngineRuntime & {
        lastRendererFrameInfo?: {calls?: number; triangles?: number} | null;
    } | null | undefined)?.lastRendererFrameInfo;
    const counterScope = renderer.info.autoReset === false
        ? "cumulative"
        : renderer.info.autoReset === true
            ? "frame"
            : "unknown";

    return {
        calls: finiteCounter(renderer.info.render?.calls),
        triangles: finiteCounter(renderer.info.render?.triangles),
        frameCalls: optionalFiniteCounter(frameInfo?.calls),
        frameTriangles: optionalFiniteCounter(frameInfo?.triangles),
        counterScope,
        geometries: finiteCounter(renderer.info.memory?.geometries),
        textures: finiteCounter(renderer.info.memory?.textures),
        pixelRatio: finiteCounter(renderer.getPixelRatio?.()),
        drawingBufferWidth: finiteCounter(renderer.domElement?.width),
        drawingBufferHeight: finiteCounter(renderer.domElement?.height),
    };
}

const PerformanceOverlayComponent: React.FC = () => {
    const app = global.app as EngineRuntime;
    const [isVisible, setIsVisible] = useState(() => {
        // Persist overlay visibility state
        const saved = localStorage.getItem('performanceOverlayVisible');
        return saved ? JSON.parse(saved) : false;
    });
    const [performanceData, setPerformanceData] = useState<PerformanceData | null>(null);
    const [frameTelemetry, setFrameTelemetry] = useState<RuntimeFrameTelemetrySnapshot>(
        () => runtimeFrameTelemetry.getSnapshot(),
    );
    const [subsystemDiagnostics, setSubsystemDiagnostics] = useState<SubsystemDiagnostics | null>(null);
    const [showFPS, setShowFPS] = useState(() => {
        // Persist FPS counter visibility state
        const saved = localStorage.getItem('performanceFPSVisible');
        return saved ? JSON.parse(saved) : true;
    });
    const [isCompactMode, setIsCompactMode] = useState(() => {
        // Persist compact mode state
        const saved = localStorage.getItem('performanceOverlayCompact');
        return saved ? JSON.parse(saved) : false;
    });
    const [appliedActions, setAppliedActions] = useState<Set<string>>(new Set());
    const intervalRef = useRef<NodeJS.Timeout | null>(null);

    // Persist state changes
    useEffect(() => {
        localStorage.setItem('performanceOverlayVisible', JSON.stringify(isVisible));
    }, [isVisible]);

    useEffect(() => {
        localStorage.setItem('performanceFPSVisible', JSON.stringify(showFPS));
    }, [showFPS]);

    useEffect(() => {
        localStorage.setItem('performanceOverlayCompact', JSON.stringify(isCompactMode));
    }, [isCompactMode]);

    useEffect(() => runtimeFrameTelemetry.subscribe(setFrameTelemetry), []);

    const updatePerformanceData = React.useCallback(() => {
        const metrics = app?.game?.behaviorManager?.getPerformanceMetrics();
        if (metrics) {
            setPerformanceData(metrics);
        }

        const {gpuResources, lod} = getRuntimeSubsystemDiagnostics(app);
        setSubsystemDiagnostics({gpuResources, lod, renderer: getRendererDiagnostics(app)});
    }, [app]);

    useEffect(() => {
        // The collapsed overlay must have zero polling cost. The FPS badge is
        // driven by render-loop telemetry and does not need this behavior poll.
        if (!isVisible) return;

        // Enable performance reporting when overlay is used
        if (app?.game?.behaviorManager) {
            app.game.behaviorManager.updateThrottlingConfig({
                enablePerformanceReporting: true,
            });
        }

        // Start monitoring
        updatePerformanceData();
        intervalRef.current = setInterval(updatePerformanceData, 1000);

        return () => {
            if (intervalRef.current) {
                clearInterval(intervalRef.current);
                intervalRef.current = null;
            }
        };
    }, [app, isVisible, updatePerformanceData]);

    // Handle keyboard shortcut and custom events
    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.ctrlKey && event.shiftKey && event.key === 'P') {
                event.preventDefault();
                setIsVisible(!isVisible);
            }
            if (event.ctrlKey && event.key === 'f') {
                event.preventDefault();
                setShowFPS(!showFPS);
            }
        };

        const handleToggleEvent = (event: Event) => {
            const customEvent = event as CustomEvent;
            const newVisibility = customEvent?.detail?.visible !== undefined ? customEvent.detail.visible : !isVisible;
            setIsVisible(newVisibility);
            
            // Sync with UI checkbox by dispatching an event back
            if (customEvent?.detail?.visible === undefined) {
                const syncEvent = new CustomEvent('syncPerformanceOverlayState', { detail: { visible: newVisibility } });
                window.dispatchEvent(syncEvent);
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('togglePerformanceOverlay', handleToggleEvent);
        
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('togglePerformanceOverlay', handleToggleEvent);
        };
    }, [isVisible, showFPS]);

    const getRecommendations = (): Array<{type: 'info' | 'warning' | 'success', message: string, action?: () => void, actionLabel?: string}> => {
        if (!performanceData) return [];

        const recommendations = [];
        const actualFPS = Math.round(frameTelemetry.fpsEma);
        if (actualFPS < 30) {
            recommendations.push({
                type: 'warning' as const,
                message: `Low FPS (${actualFPS}). Try performance preset.`,
                action: () => applyPerformancePreset('performanceFocused'),
                actionLabel: 'Apply High Performance',
            });
        } else if (actualFPS > 55) {
            recommendations.push({
                type: 'success' as const,
                message: `Great FPS (${actualFPS})! Performance optimized.`,
            });
        }

        if (performanceData.throttlingEfficiency > 40) {
            recommendations.push({
                type: 'success' as const,
                message: `Throttling working well (${performanceData.throttlingEfficiency.toFixed(0)}%).`,
            });
        }

        if (performanceData.throttlingEfficiency < 50 && performanceData.totalChecks > 5 && !appliedActions.has('balanced')) {
            recommendations.push({
                type: 'info' as const,
                message: `Throttling efficiency could be improved (${performanceData.throttlingEfficiency.toFixed(0)}%).`,
                action: () => applyPerformancePreset('balanced'),
                actionLabel: 'Optimize',
            });
        }

        // Always show at least one actionable recommendation for demo purposes
        if (recommendations.length === 1 && recommendations[0]?.type === 'success' && !appliedActions.has('performanceFocused')) {
            recommendations.push({
                type: 'info' as const,
                message: `Want even better performance?`,
                action: () => applyPerformancePreset('performanceFocused'),
                actionLabel: 'Max Performance',
            });
        }

        return recommendations.slice(0, 2); // Limit to 2 recommendations
    };

    const applyPerformancePreset = (presetType: 'balanced' | 'performanceFocused' | 'mobileOptimized') => {
        const presets = {
            balanced: {
                farDistanceSq: 2500,
                veryFarDistanceSq: 10000,
                farThrottleFactor: 3,
                veryFarThrottleFactor: 10,
                enableFrustumCulling: true,
                enableDistanceThrottling: true,
                enablePerformanceReporting: true,
                throttlingEnabled: true,
            },
            performanceFocused: {
                farDistanceSq: 1600,
                veryFarDistanceSq: 6400,
                farThrottleFactor: 4,
                veryFarThrottleFactor: 12,
                enableFrustumCulling: true,
                enableDistanceThrottling: true,
                enablePerformanceReporting: true,
                throttlingEnabled: true,
            },
            mobileOptimized: {
                farDistanceSq: 1225,
                veryFarDistanceSq: 4900,
                farThrottleFactor: 5,
                veryFarThrottleFactor: 15,
                enableFrustumCulling: true,
                enableDistanceThrottling: true,
                enablePerformanceReporting: true,
                throttlingEnabled: true,
            },
        };

        const preset = presets[presetType];
        
        // Apply to behavior manager
        if (app?.game?.behaviorManager) {
            app.game.behaviorManager.updateThrottlingConfig?.(preset);
        }
        
        // Save to scene data
        if (app?.editor?.scene) {
            if (!app.editor.scene.userData.game) {
                app.editor.scene.userData.game = {};
            }
            app.editor.scene.userData.game.behaviorThrottling = preset;
        }
        
        // Track that this action has been applied
        setAppliedActions(prev => new Set([...prev, presetType]));
    };

    const exportPerformanceData = () => {
        if (!performanceData) return;
        
        const exportData = {
            timestamp: new Date().toISOString(),
            fps: Math.round(frameTelemetry.fpsEma),
            frameTimeP95Ms: frameTelemetry.frameTimeP95Ms,
            frameTimeP99Ms: frameTelemetry.frameTimeP99Ms,
            renderedFrames: frameTelemetry.renderedFrames,
            skippedFrames: frameTelemetry.skippedFrames,
            skippedByReason: frameTelemetry.skippedByReason,
            simulation: {
                fixedSteps: frameTelemetry.lastSimulationFixedSteps,
                droppedSteps: frameTelemetry.lastSimulationDroppedSteps,
                droppedTimeMs: frameTelemetry.lastSimulationDroppedTimeMs,
                totalDroppedSteps: frameTelemetry.totalSimulationDroppedSteps,
                totalDroppedTimeMs: frameTelemetry.totalSimulationDroppedTimeMs,
            },
            lod: subsystemDiagnostics?.lod ?? null,
            gpuResources: subsystemDiagnostics?.gpuResources ?? null,
            behaviorDistribution: null,
            behaviorDistributionStatus: "Unavailable without a maintained behavior-priority index",
            cullingEfficiency: performanceData.cullingEfficiency,
            throttlingEfficiency: performanceData.throttlingEfficiency,
            runTimeMs: performanceData.runTimeMs,
            recommendations: getRecommendations().map(r => ({ type: r.type, message: r.message })),
        };
        
        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `performance-report-${new Date().toISOString().slice(0, 16)}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    return (
        <>
            {/* FPS Counter */}
            {showFPS && 
                <FPSCounter>
                    FPS: {Math.round(frameTelemetry.fpsEma)}
                </FPSCounter>
            }

            {/* Toggle Button */}
            <ToggleButton 
                $isVisible={isVisible}
                onClick={() => setIsVisible(!isVisible)}
                title={i18n.t("Toggle Performance Monitor ({{shortcut}})", {
                    shortcut: /Mac|iPod|iPhone|iPad/.test(navigator.platform) ? "⌘⇧P" : "Ctrl+Shift+P",
                })}
            >
                📊
            </ToggleButton>

            {/* Performance Overlay */}
            <OverlayContainer $isVisible={isVisible}
                $isCompact={isCompactMode}
            >
                <Header>
                    <Title>{i18n.t("Performance Monitor")}</Title>
                    <div style={{ display: 'flex', alignItems: 'center' }}>
                        <CompactToggle 
                            onClick={exportPerformanceData}
                            title={i18n.t("Export performance data")}
                        >
                            📊
                        </CompactToggle>
                        <CompactToggle 
                            onClick={() => setIsCompactMode(!isCompactMode)}
                            title={isCompactMode ? i18n.t("Expand overlay") : i18n.t("Compact mode")}
                        >
                            {isCompactMode ? '⤢' : '⤡'}
                        </CompactToggle>
                        <CloseButton onClick={() => setIsVisible(false)}>×</CloseButton>
                    </div>
                </Header>

                {performanceData && 
                    <>
                        <MetricsGrid>
                            <MetricCard $color="#00ff88">
                                <MetricValue>{performanceData.cullingEfficiency.toFixed(0)}%</MetricValue>
                                <MetricLabel>{i18n.t("Culling")}</MetricLabel>
                            </MetricCard>
                            
                            <MetricCard $color="#0088ff">
                                <MetricValue>{performanceData.throttlingEfficiency.toFixed(0)}%</MetricValue>
                                <MetricLabel>{i18n.t("Throttling")}</MetricLabel>
                            </MetricCard>
                            
                            <MetricCard $color="#ff8800">
                                <MetricValue>—</MetricValue>
                                <MetricLabel>{i18n.t("Behaviors")}</MetricLabel>
                            </MetricCard>
                            
                            <MetricCard $color="#ff4488">
                                <MetricValue>{Math.round(frameTelemetry.fpsEma)}</MetricValue>
                                <MetricLabel>{i18n.t("Real FPS")}</MetricLabel>
                            </MetricCard>

                            <MetricCard $color="#b084ff">
                                <MetricValue>{frameTelemetry.frameTimeP95Ms.toFixed(1)}ms</MetricValue>
                                <MetricLabel>{i18n.t("Frame p95")}</MetricLabel>
                            </MetricCard>

                            <MetricCard $color="#ff6677">
                                <MetricValue>{frameTelemetry.skippedFrames}</MetricValue>
                                <MetricLabel>{i18n.t("Skipped")}</MetricLabel>
                            </MetricCard>
                        </MetricsGrid>

                        {!isCompactMode && 
                            <Section>
                                <SectionTitle>{i18n.t("Priority Distribution")}</SectionTitle>
                                <div style={{fontSize: '10px', color: '#888'}}>
                                    {i18n.t("Unavailable until behavior priority indexing is enabled.")}
                                </div>
                            </Section>
                        }

                        {!isCompactMode &&
                            <Section data-testid="simulation-diagnostics">
                                <SectionTitle>{i18n.t("Authoritative Simulation")}</SectionTitle>
                                <MetricsGrid>
                                    <MetricCard $color="#36d399">
                                        <MetricValue>{frameTelemetry.lastSimulationFixedSteps}</MetricValue>
                                        <MetricLabel>{i18n.t("Fixed steps")}</MetricLabel>
                                    </MetricCard>
                                    <MetricCard $color={frameTelemetry.totalSimulationDroppedSteps > 0 ? "#ff6677" : "#36d399"}>
                                        <MetricValue>{frameTelemetry.totalSimulationDroppedSteps}</MetricValue>
                                        <MetricLabel>{i18n.t("Dropped steps")}</MetricLabel>
                                    </MetricCard>
                                    <MetricCard $color="#b084ff">
                                        <MetricValue>{frameTelemetry.totalSimulationDroppedTimeMs.toFixed(1)}ms</MetricValue>
                                        <MetricLabel>{i18n.t("Dropped time")}</MetricLabel>
                                    </MetricCard>
                                    <MetricCard $color="#5ea7ff">
                                        <MetricValue>{frameTelemetry.lastSimulationDroppedSteps}</MetricValue>
                                        <MetricLabel>{i18n.t("Last-frame drops")}</MetricLabel>
                                    </MetricCard>
                                </MetricsGrid>
                            </Section>
                        }

                        {!isCompactMode && subsystemDiagnostics?.lod &&
                            <Section data-testid="lod-diagnostics">
                                <SectionTitle>{i18n.t("Runtime LOD")}</SectionTitle>
                                <MetricsGrid>
                                    <MetricCard $color="#5ea7ff">
                                        <MetricValue>{subsystemDiagnostics.lod.registeredGroups}</MetricValue>
                                        <MetricLabel>{i18n.t("Groups")}</MetricLabel>
                                    </MetricCard>
                                    <MetricCard $color={subsystemDiagnostics.lod.pendingTransitions > 0 ? "#ffb020" : "#36d399"}>
                                        <MetricValue>{subsystemDiagnostics.lod.pendingTransitions}</MetricValue>
                                        <MetricLabel>{i18n.t("Pending")}</MetricLabel>
                                    </MetricCard>
                                    <MetricCard $color="#36d399">
                                        <MetricValue>{subsystemDiagnostics.lod.appliedTransitions}</MetricValue>
                                        <MetricLabel>{i18n.t("Applied")}</MetricLabel>
                                    </MetricCard>
                                    <MetricCard $color={subsystemDiagnostics.lod.residencyBlockedTransitions > 0 ? "#ff6677" : "#36d399"}>
                                        <MetricValue>{subsystemDiagnostics.lod.residencyBlockedTransitions}</MetricValue>
                                        <MetricLabel>{i18n.t("Residency blocked")}</MetricLabel>
                                    </MetricCard>
                                    <MetricCard $color="#b084ff">
                                        <MetricValue>{subsystemDiagnostics.lod.lastUpdateCostMs.toFixed(2)}ms</MetricValue>
                                        <MetricLabel>{i18n.t("Update cost")}</MetricLabel>
                                    </MetricCard>
                                    <MetricCard $color="#8f9bad">
                                        <MetricValue>{subsystemDiagnostics.lod.disabledGroups}</MetricValue>
                                        <MetricLabel>{i18n.t("Disabled")}</MetricLabel>
                                    </MetricCard>
                                </MetricsGrid>
                            </Section>
                        }

                        {!isCompactMode && subsystemDiagnostics &&
                            <Section data-testid="gpu-resource-diagnostics">
                                <SectionTitle>{i18n.t("Shared GPU Resources")}</SectionTitle>
                                <MetricsGrid>
                                    <MetricCard $color="#5ea7ff">
                                        <MetricValue>{subsystemDiagnostics.gpuResources.activeResources}</MetricValue>
                                        <MetricLabel>{i18n.t("Managed resources")}</MetricLabel>
                                    </MetricCard>
                                    <MetricCard $color="#36d399">
                                        <MetricValue>{subsystemDiagnostics.gpuResources.activeOwners}</MetricValue>
                                        <MetricLabel>{i18n.t("Owners")}</MetricLabel>
                                    </MetricCard>
                                    <MetricCard $color="#b084ff">
                                        <MetricValue>{subsystemDiagnostics.gpuResources.retainedResourceLinks}</MetricValue>
                                        <MetricLabel>{i18n.t("Owner links")}</MetricLabel>
                                    </MetricCard>
                                    <MetricCard $color="#8f9bad">
                                        <MetricValue>{subsystemDiagnostics.gpuResources.disposedManagedResources}</MetricValue>
                                        <MetricLabel>{i18n.t("Disposed")}</MetricLabel>
                                    </MetricCard>
                                </MetricsGrid>
                            </Section>
                        }

                        {!isCompactMode && subsystemDiagnostics?.renderer &&
                            <Section data-testid="renderer-diagnostics">
                                <SectionTitle>{i18n.t("Renderer")}</SectionTitle>
                                <MetricsGrid>
                                    <MetricCard $color="#5ea7ff">
                                        <MetricValue>
                                            {subsystemDiagnostics.renderer.frameCalls === null
                                                ? "—"
                                                : Math.round(subsystemDiagnostics.renderer.frameCalls)}
                                        </MetricValue>
                                        <MetricLabel>{i18n.t("Last frame calls")}</MetricLabel>
                                    </MetricCard>
                                    <MetricCard $color="#ffb020">
                                        <MetricValue>
                                            {subsystemDiagnostics.renderer.frameTriangles === null
                                                ? "—"
                                                : Math.round(subsystemDiagnostics.renderer.frameTriangles).toLocaleString()}
                                        </MetricValue>
                                        <MetricLabel>{i18n.t("Last frame triangles")}</MetricLabel>
                                    </MetricCard>
                                    <MetricCard $color="#5ea7ff">
                                        <MetricValue>{Math.round(subsystemDiagnostics.renderer.calls)}</MetricValue>
                                        <MetricLabel>
                                            {i18n.t(subsystemDiagnostics.renderer.counterScope === "cumulative"
                                                ? "Renderer total calls"
                                                : "Renderer calls")}
                                        </MetricLabel>
                                    </MetricCard>
                                    <MetricCard $color="#ffb020">
                                        <MetricValue>{Math.round(subsystemDiagnostics.renderer.triangles).toLocaleString()}</MetricValue>
                                        <MetricLabel>
                                            {i18n.t(subsystemDiagnostics.renderer.counterScope === "cumulative"
                                                ? "Renderer total triangles"
                                                : "Renderer triangles")}
                                        </MetricLabel>
                                    </MetricCard>
                                    <MetricCard $color="#b084ff">
                                        <MetricValue>{subsystemDiagnostics.renderer.pixelRatio.toFixed(2)}</MetricValue>
                                        <MetricLabel>{i18n.t("Pixel ratio")}</MetricLabel>
                                    </MetricCard>
                                    <MetricCard $color="#36d399">
                                        <MetricValue>
                                            {Math.round(subsystemDiagnostics.renderer.drawingBufferWidth)}×{Math.round(subsystemDiagnostics.renderer.drawingBufferHeight)}
                                        </MetricValue>
                                        <MetricLabel>{i18n.t("Draw buffer")}</MetricLabel>
                                    </MetricCard>
                                    <MetricCard $color="#8f9bad">
                                        <MetricValue>{Math.round(subsystemDiagnostics.renderer.geometries)}</MetricValue>
                                        <MetricLabel>{i18n.t("Geometries")}</MetricLabel>
                                    </MetricCard>
                                    <MetricCard $color="#8f9bad">
                                        <MetricValue>{Math.round(subsystemDiagnostics.renderer.textures)}</MetricValue>
                                        <MetricLabel>{i18n.t("Textures")}</MetricLabel>
                                    </MetricCard>
                                </MetricsGrid>
                            </Section>
                        }

                        <Section>
                            <SectionTitle>{i18n.t("Insights")}</SectionTitle>
                            {getRecommendations().map((rec, index) => 
                                <RecommendationCard key={index}
                                    $type={rec.type}
                                >
                                    <span>{rec.message}</span>
                                    {rec.action && rec.actionLabel && 
                                        <QuickFixButton onClick={rec.action}>
                                            {rec.actionLabel}
                                        </QuickFixButton>
                                    }
                                </RecommendationCard>,
                            )}
                            {getRecommendations().length === 0 && 
                                <RecommendationCard $type="info">
                                    <span>{i18n.t("Performance looks good!")}</span>
                                </RecommendationCard>
                            }
                        </Section>

                        <div style={{ fontSize: '9px', color: '#666', textAlign: 'center', marginTop: '8px' }}>
                            {i18n.t("Ctrl+Shift+P: Toggle • Ctrl+F: Toggle FPS")}
                        </div>
                    </>
                }

                {!performanceData && 
                    <div style={{ textAlign: 'center', color: '#888', padding: '20px' }}>
                        {i18n.t("Collecting performance data...")}
                    </div>
                }
            </OverlayContainer>
        </>
    );
};

export const PerformanceOverlay = React.memo(PerformanceOverlayComponent);
