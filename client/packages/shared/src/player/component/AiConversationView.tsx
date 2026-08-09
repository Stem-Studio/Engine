import {createRoot} from "react-dom/client";

import {EButtonView} from "./EButtonView";
import PlayerComponent from "./PlayerComponent";

class AiConversationView extends PlayerComponent {
    container: any;
    hudWrapper: HTMLElement | null;
    constructor(app: any) {
        super(app);
        this.container = null;
        this.hudWrapper = null;
    }

    show(name: string, isBusy: boolean) {
        if (!this.container) {
            // Create a container element for the queue mask
            this.container = document.createElement("div");
            Object.assign(this.container.style, {
                position: "absolute",
                left: "50%",
                top: "16px",
                transform: "translateX(-50%)",
                zIndex: 1000,
            });

            // Render the React component inside the container
            const root = createRoot(this.container);
            root.render(<EButtonView name={name} />);

            // Attach container to the app's main container
            this.hudWrapper = document.getElementById("hud-wrapper");
            this.hudWrapper?.appendChild(this.container);
        }
        // Show the container
        this.container.style.display = "flex";
        this.container.style.opacity = isBusy ? 0.5 : 1;
    }

    hide() {
        if (this.container) {
            this.container.style.display = "none";
        }
    }

    dispose() {
        if (this.container) {
            this.hudWrapper?.removeChild(this.container);
            this.container = null;
        }
    }

    blur() {
        this.container.style.opacity = 0.5;
    }
}

export default AiConversationView;
