import {Link} from "react-router-dom";

import {GITHUB_URL, PLAYGROUND_APP_URL} from "../content/links";

export function Playground() {
    return (
        <div className="playground-page">
            <div className="playground-bar">
                <span className="pill">Playground mode</span>
                <span style={{color: "var(--text-dim)"}}>
                    Dashboard · Editor · AI Copilot · Player
                </span>
                <div className="playground-actions">
                    <Link to="/docs" className="btn btn-ghost playground-action">
                        Docs
                    </Link>
                    <a
                        className="btn btn-ghost playground-action"
                        href={GITHUB_URL}
                        target="_blank"
                        rel="noreferrer noopener"
                    >
                        GitHub
                    </a>
                </div>
            </div>
            <iframe
                className="playground-frame"
                title="StemStudio playground"
                src={PLAYGROUND_APP_URL}
                allow="clipboard-read; clipboard-write; cross-origin-isolated; xr-spatial-tracking; gamepad; fullscreen; autoplay"
            />
        </div>
    );
}
