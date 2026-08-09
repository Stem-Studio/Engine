import {useCallback, useEffect, useState} from "react";
import {Link} from "react-router-dom";

import {GITHUB_URL, PLAYGROUND_APP_URL} from "../content/links";

// A built deployment also emits this direct dashboard entrypoint. It is a
// compatibility fallback for hosts that do not expose the root app shell.
const STATIC_PLAYGROUND_APP_URL = "/dashboard/index.html?mode=playground";

export function Playground() {
    const [iframeSrc, setIframeSrc] = useState(PLAYGROUND_APP_URL);
    const [fallbackAttempted, setFallbackAttempted] = useState(false);

    const fallbackToLegacyDashboardRoute = useCallback(() => {
        if (fallbackAttempted || iframeSrc === STATIC_PLAYGROUND_APP_URL) return;
        setFallbackAttempted(true);
        setIframeSrc(STATIC_PLAYGROUND_APP_URL);
    }, [fallbackAttempted, iframeSrc]);

    const inspectIframe = useCallback((iframe: HTMLIFrameElement) => {
        try {
            // A stale static deployment can return the public site shell with
            // HTTP 200 for the dashboard entrypoint. That shell contains its
            // own playground iframe, so detect it before recursive nesting.
            if (iframe.contentDocument?.querySelector(".playground-page")) {
                fallbackToLegacyDashboardRoute();
            }
        } catch {
            // Cross-origin hosts cannot be inspected; the normal load remains
            // valid and the iframe's own error handler still provides a path
            // back to the legacy route.
        }
    }, [fallbackToLegacyDashboardRoute]);

    useEffect(() => {
        let cancelled = false;
        // An iframe can still fire `load` for an HTML 404 fallback, so probe
        // the canonical app-shell route before it starts a potentially
        // misleading public-site shell. This is same-origin and intentionally
        // only runs once.
        void fetch(PLAYGROUND_APP_URL, {cache: "no-store"})
            .then((response) => {
                if (!response.ok && !cancelled) fallbackToLegacyDashboardRoute();
            })
            .catch(() => {
                if (!cancelled) fallbackToLegacyDashboardRoute();
            });
        return () => {
            cancelled = true;
        };
    }, [fallbackToLegacyDashboardRoute]);

    return (
        <div className="playground-page">
            <div className="playground-bar">
                <span className="pill">Playground mode</span>
                <span className="playground-capabilities">
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
                src={iframeSrc}
                onError={fallbackToLegacyDashboardRoute}
                onLoad={(event) => {
                    // Let the embedded app finish its first React commit before
                    // checking for the recursive public-shell failure mode.
                    const iframe = event.currentTarget;
                    window.setTimeout(() => inspectIframe(iframe), 250);
                }}
                allow="clipboard-read; clipboard-write; cross-origin-isolated; xr-spatial-tracking; gamepad; fullscreen; autoplay"
            />
        </div>
    );
}
