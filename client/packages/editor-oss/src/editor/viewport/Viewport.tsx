/**
 * Module: Viewport.tsx
 * Purpose: Contains logic for viewport.
 */

import "./css/Viewport.css";
import {Component, createRef, RefObject} from "react";

import EngineRuntime from "@stem/editor-oss/EngineRuntime";
import global from "@stem/editor-oss/global";
import VRButton from "@stem/editor-oss/webvr/VRButton";

/**
 *
 * @autor tengge / https://github.com/tengge1
 */
interface ViewportProps {
    /**
     * Default Copilot workspace keeps controls above the canvas, so active
     * play mode should not shift or shrink the renderer container.
     */
    workspaceMode?: boolean;
}

interface ViewportState {
    isPlaying: boolean;
}

class Viewport extends Component<ViewportProps, ViewportState> {
    private viewportRef: RefObject<HTMLDivElement | null>;
    private editorRef: RefObject<HTMLDivElement | null>;
    private vrButton?: HTMLButtonElement;

    constructor(props: ViewportProps) {
        super(props);

        this.state = {isPlaying: false};

        this.viewportRef = createRef<HTMLDivElement>();
        this.editorRef = createRef<HTMLDivElement>();

        this.handleDrop = this.handleDrop.bind(this);
    }

    render() {
        const classNames = [
            "Viewport",
            this.props.workspaceMode ? "is-workspace" : "",
            this.state.isPlaying && !this.props.workspaceMode ? "is-playing" : "",
        ].filter(Boolean).join(" ");


        return (
            <div
                className={classNames}
                ref={this.viewportRef}
            >
                {this.props.workspaceMode && <div className="workspace-backdrop" />}
                <div
                    className="editor"
                    id={"scene-container"}
                    ref={this.editorRef}
                    tabIndex={0}
                    onDrop={this.handleDrop}
                    onDragOver={this.handleDragOver}
                />
            </div>
        );
    }

    componentDidMount() {
        if (global.app) {
            const app = global.app;

            const viewport = this.editorRef.current as HTMLElement;
            void app.start(viewport);

            app.on("appStarted.Viewport", this.handleAppStarted);
            app.on("enableVR.Viewport", this.handleEnableVR);
            app.on("playerStarted.Viewport", this.handlePlayerStarted);
            app.on("playerStopped.Viewport", this.handlePlayerStopped);
        }
    }

    componentWillUnmount() {
        const app = global.app as EngineRuntime;
        void app.stop().catch(error => {
            console.error("[Viewport] Could not stop editor after local save drain failed", error);
        });
        app.on("appStarted.Viewport", null);
        app.on("optionChange.Viewport", null);
        app.on("enableVR.Viewport", null);
        app.on("playerStarted.Viewport", null);
        app.on("playerStopped.Viewport", null);
    }

    handlePlayerStarted = () => {
        this.setState({isPlaying: true});
    };

    handlePlayerStopped = () => {
        this.setState({isPlaying: false});
    };

    handleAppStarted = () => {
        const app = global.app as EngineRuntime;
        this.handleEnableVR(app.options.enableVR);
    };

    handleEnableVR = (enabled: boolean) => {
        const app = global.app as EngineRuntime;
        const renderer = app.editor?.renderer;

        if (enabled) {
            if (!this.vrButton) {
                this.vrButton = VRButton.createButton(renderer) as HTMLButtonElement;
            }
            if (this.editorRef.current) {
                this.editorRef.current.appendChild(this.vrButton);
            }
        } else {
            if (this.vrButton && this.editorRef.current) {
                this.editorRef.current.removeChild(this.vrButton);
                delete this.vrButton;
            }
        }
    };

    handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        const assetId = event.dataTransfer.getData("asset-id");
        const assetType = event.dataTransfer.getData("asset-type");
        const app = global.app as EngineRuntime;
        if (assetId && app.editor && app.viewport) {
            const intersectPoint = app.editor.computeIntersectPoint(
                {x: event.clientX, y: event.clientY},
                app.sceneHelpers,
            );

            app.call("dragEnd", this, assetType, assetId, intersectPoint);
        }
    };

    handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
        event.preventDefault();
    };
}

export default Viewport;
