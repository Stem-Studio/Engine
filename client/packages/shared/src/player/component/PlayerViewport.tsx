import "./PlayerViewport.css";

import {Component, createRef, type RefObject} from "react";

import type EngineRuntime from "../../EngineRuntime";
import global from "../../global";
import VRButton from "../../webvr/VRButton";

class PlayerViewport extends Component {
    private sceneRef: RefObject<HTMLDivElement | null> = createRef<HTMLDivElement>();
    private vrButton?: HTMLButtonElement;

    render() {
        return (
            <div className="PlayerViewport">
                <div
                    className="PlayerViewport-scene"
                    id="scene-container"
                    ref={this.sceneRef}
                    tabIndex={0}
                />
            </div>
        );
    }

    componentDidMount() {
        const app = global.app as EngineRuntime | undefined;
        const viewport = this.sceneRef.current;
        if (!app || !viewport) return;

        void app.start(viewport);
        app.on("appStarted.PlayerViewport", this.handleAppStarted);
        app.on("enableVR.PlayerViewport", this.handleEnableVR);
    }

    componentWillUnmount() {
        const app = global.app as EngineRuntime | undefined;
        void app?.stop().catch(error => {
            console.error("[PlayerViewport] Could not stop runtime cleanly", error);
        });
        app?.on("appStarted.PlayerViewport", null);
        app?.on("enableVR.PlayerViewport", null);
    }

    private handleAppStarted = () => {
        const app = global.app as EngineRuntime | undefined;
        this.handleEnableVR(!!app?.options.enableVR);
    };

    private handleEnableVR = (enabled: boolean) => {
        const app = global.app as EngineRuntime | undefined;
        const viewport = this.sceneRef.current;
        if (!app || !viewport) return;

        if (enabled) {
            if (!this.vrButton) {
                this.vrButton = VRButton.createButton(app.renderer) as HTMLButtonElement;
            }
            viewport.appendChild(this.vrButton);
        } else if (this.vrButton) {
            viewport.removeChild(this.vrButton);
            delete this.vrButton;
        }
    };
}

export default PlayerViewport;
