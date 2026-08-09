import {DefaultLoadingManager} from "three";
import React from "react";
import {createRoot} from "react-dom/client";
import {GradientSpinner} from "./GradientSpinner.tsx";
import PlayerComponent from "./PlayerComponent";

class PlayerLoadMask extends PlayerComponent {
    constructor(app) {
        super(app);
        this.container = null;
        this.loaderContainer = null;
        this.status = null;
    }

    show(options = {}) {
        const revealScene = options?.revealScene === true;
        if (!this.container) {
            // load mask
            this.container = document.createElement("div");
            Object.assign(this.container.style, {
                position: "absolute",
                left: 0,
                top: 0,
                width: "100%",
                height: "100%",
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
                background: "rgba(3, 7, 15, 0.96)",
                backdropFilter: "blur(6px) saturate(1.08)",
                zIndex: 10000,
                pointerEvents: "auto",
            });

            this.loaderContainer = document.createElement("div");
            Object.assign(this.loaderContainer.style, {
                position: "absolute",
                inset: 0,
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
                pointerEvents: "none",
            });
            this.container.appendChild(this.loaderContainer);

            const loader = React.createElement(GradientSpinner, {
                height: 80,
                width: 80,
                color: "#7dd3fc",
                ariaLabel: "loading",
                secondaryColor: "#38bdf8",
                strokeWidth: 2,
                strokeWidthSecondary: 2,
                bg: "transparent",
            });
            const root = createRoot(this.loaderContainer);
            root.render(loader);

            this.app.container.appendChild(this.container);

            this.message = document.createElement("div");
            Object.assign(this.message.style, {
                position: "absolute",
                left: "50%",
                top: "calc(50% + 58px)",
                transform: "translateX(-50%)",
                maxWidth: "min(82vw, 420px)",
                padding: "8px 16px",
                border: "1px solid rgba(125, 211, 252, 0.24)",
                borderRadius: "999px",
                background: "rgba(8, 20, 35, 0.72)",
                color: "#e0f2fe",
                fontFamily: "Inter, system-ui, sans-serif",
                fontSize: "14px",
                fontWeight: "600",
                letterSpacing: "0.01em",
                lineHeight: "20px",
                textAlign: "center",
                whiteSpace: "nowrap",
                textOverflow: "ellipsis",
                overflow: "hidden",
                boxShadow: "0 8px 30px rgba(0, 0, 0, 0.26)",
            });
            this.message.setAttribute("role", "status");
            this.message.setAttribute("aria-live", "polite");
            this.container.appendChild(this.message);

            // load status
            this.status = document.createElement("div");
            Object.assign(this.status.style, {
                position: "absolute",
                left: "5%",
                right: "5%",
                bottom: "5%",
                fontSize: "14px",
                lineHeight: "20px",
                color: "rgba(224, 242, 254, 0.76)",
                textAlign: "center",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
            });
            this.app.container.appendChild(this.status);

            DefaultLoadingManager.onProgress = url => {
                url = url.replaceAll(this.app.options.server, "");
                this.status.innerHTML = "Loading " + url;
            };
        }
        Object.assign(this.container.style, revealScene ? {
            background: "radial-gradient(circle at 50% 42%, rgba(20, 74, 106, 0.28), rgba(3, 7, 15, 0.48) 58%, rgba(3, 7, 15, 0.72))",
            backdropFilter: "blur(2px) saturate(1.15)",
        } : {
            background: "rgba(3, 7, 15, 0.96)",
            backdropFilter: "blur(6px) saturate(1.08)",
        });
        this.container.dataset.maskMode = revealScene ? "runtime" : "loading";
        if (this.message) {
            this.message.textContent = options?.message || (revealScene ? "Preparing your world" : "Loading scene");
        }
        this.container.style.display = "flex";
        this.status.innerHTML = "";
        this.status.style.display = "inline-block";
    }

    hide() {
        if (!this.container || !this.status) {
            return;
        }
        this.container.style.display = "none";
        this.container.dataset.maskMode = "hidden";
        this.status.style.display = "none";
        this.status.innerHTML = "";
        if (this.message) this.message.textContent = "";
    }

    dispose() {}
}

export default PlayerLoadMask;
