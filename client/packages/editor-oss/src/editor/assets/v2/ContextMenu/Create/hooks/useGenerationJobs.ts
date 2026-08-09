import {useQueryClient} from "@tanstack/react-query";
import {useEffect, useRef} from "react";
import * as THREE from "three";

import EngineRuntime from "@stem/editor-oss/EngineRuntime";
import {Add3dObjectCommand} from "@stem/editor-oss/command/objects/Add3dObjectCommand";
import {useAssetSource} from "@stem/editor-oss/context/AssetSourceContext";
import {addIndicator, removeIndicator} from "../../../../../../controls/AiWorldController/AiWorldController.utils";
import {refreshEditorAssets} from "../../../../../../editor/asset-management/hooks/assets";
import global from "@stem/editor-oss/global";
import {showToast} from "@stem/editor-oss/showToast";

type JobStatusDTO = {
    jobId: string;
    name: string;
    stage: string;
    progress: number;
    assetId?: string;
    error?: string;
};

const POLL_INTERVAL_MS = 10000;
// Backend may not have registered a freshly-submitted job by the time the next poll fires.
// Keep polling for at least this long after a user submission before deciding the scene is idle.
const SUBMIT_GRACE_MS = 30000;

export const useGenerationJobs = (sceneId: string | undefined) => {
    const queryClient = useQueryClient();
    const assetSource = useAssetSource();
    const seenJobStages = useRef<Map<string, string>>(new Map());
    const indicators = useRef<Map<string, THREE.Group>>(new Map());

    useEffect(() => {
        if (!sceneId) {
            return;
        }

        let active = true;
        let interval: ReturnType<typeof setInterval> | null = null;
        let lastSubmitAt = 0;

        const stopPolling = () => {
            if (interval) {
                clearInterval(interval);
                interval = null;
            }
        };

        const startPolling = () => {
            if (interval || !active) return;
            interval = setInterval(() => { void pollJobs(); }, POLL_INTERVAL_MS);
        };

        const processJobs = (jobs: JobStatusDTO[]) => {
            for (const job of jobs) {
                const prevStage = seenJobStages.current.get(job.jobId);

                if (prevStage === undefined && job.stage !== "complete" && job.stage !== "failed") {
                    const center = {x: window.innerWidth / 2, y: window.innerHeight / 2};
                    const {indicator} = addIndicator(job.jobId, center, new THREE.Vector3(0, 0, 0), job.progress);
                    indicators.current.set(job.jobId, indicator);
                }

                if (indicators.current.has(job.jobId)) {
                    global.app?.call("updateIndicator", null, {progress: job.progress, uuid: job.jobId});
                }

                if (job.stage === "complete" && job.assetId) {
                    const isFirstSeen = prevStage === undefined;
                    const justCompleted = prevStage !== undefined && prevStage !== "complete";

                    if ((isFirstSeen || justCompleted) && assetSource) {
                        refreshEditorAssets(queryClient, assetSource).catch(console.error);
                    }

                    if (justCompleted) {
                        const indicator = indicators.current.get(job.jobId);
                        if (indicator) {
                            removeIndicator(indicator);
                            indicators.current.delete(job.jobId);
                        }
                        const app = global.app as EngineRuntime;
                        if (app?.editor) {
                            const cmd = new Add3dObjectCommand(
                                job.assetId,
                                job.name,
                                "local",
                                "",
                                new THREE.Vector3(0, 0, 0),
                                1,
                                1,
                            );
                            void cmd.execute().then(() => {
                                showToast({type: "success", title: `"${job.name}" added to scene`});
                            });
                        }
                    }
                } else if (job.stage === "failed" && prevStage !== "failed") {
                    const indicator = indicators.current.get(job.jobId);
                    if (indicator) {
                        removeIndicator(indicator);
                        indicators.current.delete(job.jobId);
                    }
                    showToast({type: "error", title: `"${job.name}" generation failed`});
                }

                seenJobStages.current.set(job.jobId, job.stage);
            }
        };

        const fetchJobs = async (): Promise<JobStatusDTO[] | null> => {
            return [];
        };

        const pollJobs = async () => {
            const jobs = await fetchJobs();
            if (!active || jobs === null) return;

            processJobs(jobs);

            const hasActive = jobs.some(j => j.stage !== "complete" && j.stage !== "failed");
            const withinGrace = Date.now() - lastSubmitAt < SUBMIT_GRACE_MS;
            if (!hasActive && !withinGrace) {
                stopPolling();
            }
        };

        const onJobStarted = () => {
            lastSubmitAt = Date.now();
            startPolling();
            void pollJobs();
        };

        const app = global.app;
        app?.on("generationJobStarted.generationJobsMonitor", onJobStarted);

        // Initial scene-load check: only start polling if the server reports active jobs
        // (e.g., a generation a collaborator started or the local user kicked off in a previous session).
        void fetchJobs().then(jobs => {
            if (!active || jobs === null) return;
            processJobs(jobs);
            const hasActive = jobs.some(j => j.stage !== "complete" && j.stage !== "failed");
            if (hasActive) startPolling();
        });

        return () => {
            active = false;
            stopPolling();
            app?.on("generationJobStarted.generationJobsMonitor", null);
            seenJobStages.current.clear();
            indicators.current.forEach(indicator => removeIndicator(indicator));
            indicators.current.clear();
        };
    }, [sceneId, queryClient, assetSource]);
};
