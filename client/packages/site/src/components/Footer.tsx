import {Link} from "react-router-dom";
import {PLAYGROUND_ROUTE} from "../content/links";

import {COC_URL, CONTRIBUTING_URL, GITHUB_URL, ISSUES_URL, LICENSE_URL, SECURITY_URL} from "../content/links";

export function Footer() {
    return (
        <footer className="footer">
            <div className="container">
                <div className="footer-grid">
                    <div>
                        <div className="nav-brand" style={{marginBottom: 12}}>
                            <span className="nav-brand-mark" aria-hidden />
                            StemStudio
                        </div>
                        <p style={{maxWidth: 360, margin: 0}}>
                            Open-source 3D editor, engine, and AI copilot. Build games and interactive 3D
                            apps in the browser. MIT-licensed.
                        </p>
                    </div>
                    <div>
                        <h4>Product</h4>
                        <ul>
                            <li><Link to={PLAYGROUND_ROUTE}>Playground</Link></li>
                            <li><Link to="/docs">Docs</Link></li>
                            <li><Link to="/docs/exporting-a-game">Export a game</Link></li>
                        </ul>
                    </div>
                    <div>
                        <h4>Community</h4>
                        <ul>
                            <li><a href={GITHUB_URL} target="_blank" rel="noreferrer noopener">GitHub</a></li>
                            <li><a href={ISSUES_URL} target="_blank" rel="noreferrer noopener">Issues</a></li>
                            <li><a href={CONTRIBUTING_URL} target="_blank" rel="noreferrer noopener">Contributing</a></li>
                            <li><a href={COC_URL} target="_blank" rel="noreferrer noopener">Code of conduct</a></li>
                        </ul>
                    </div>
                    <div>
                        <h4>Legal</h4>
                        <ul>
                            <li><a href={LICENSE_URL} target="_blank" rel="noreferrer noopener">MIT license</a></li>
                            <li><a href={SECURITY_URL} target="_blank" rel="noreferrer noopener">Security</a></li>
                        </ul>
                    </div>
                </div>
                <div className="footer-bottom">
                    <span>© {new Date().getFullYear()} StemStudio contributors.</span>
                    <span>
                        <a href={GITHUB_URL} target="_blank" rel="noreferrer noopener">
                            github.com/Stem-Studio/Engine
                        </a>
                    </span>
                </div>
            </div>
        </footer>
    );
}
