import {NavLink} from "react-router-dom";

import {GITHUB_URL, PLAYGROUND_ROUTE} from "../content/links";

export function Nav() {
    return (
        <header className="nav">
            <div className="container nav-inner">
                <NavLink to="/" className="nav-brand">
                    <span className="nav-brand-mark" aria-hidden />
                    StemStudio
                </NavLink>
                <nav className="nav-links" aria-label="Primary">
                    <NavLink to={PLAYGROUND_ROUTE} className="nav-link">
                        Playground
                    </NavLink>
                    <NavLink to="/docs" className="nav-link">
                        Docs
                    </NavLink>
                    <a className="nav-link" href={`${GITHUB_URL}#features`}>
                        Features
                    </a>
                </nav>
                <div className="nav-right">
                    <a
                        className="btn btn-ghost"
                        href={GITHUB_URL}
                        target="_blank"
                        rel="noreferrer noopener"
                    >
                        GitHub
                    </a>
                    <NavLink to={PLAYGROUND_ROUTE} className="btn btn-primary">
                        Open Playground →
                    </NavLink>
                </div>
            </div>
        </header>
    );
}
