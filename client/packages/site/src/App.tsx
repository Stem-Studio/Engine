import {Route, Routes, useLocation} from "react-router-dom";

import {Footer} from "./components/Footer";
import {Nav} from "./components/Nav";
import {Docs} from "./routes/Docs";
import {Landing} from "./routes/Landing";
import {NotFound} from "./routes/NotFound";
import {Playground} from "./routes/Playground";

export function App() {
    // The playground route renders its own `playground-bar` and fills the
    // viewport with the editor iframe. The marketing nav and footer would just
    // be redundant chrome around it (and the footer would push the iframe up),
    // so hide both there — the playground bar carries the GitHub link.
    const {pathname} = useLocation();
    const isPlayground = pathname === "/playground" || pathname.startsWith("/playground/");

    return (
        <div className="site-shell">
            {!isPlayground && <Nav />}
            <main className="site-main">
                <Routes>
                    <Route path="/" element={<Landing />} />
                    <Route path="/playground" element={<Playground />} />
                    <Route path="/playground/index.html" element={<Playground />} />
                    <Route path="/docs" element={<Docs />} />
                    <Route path="/docs/:slug" element={<Docs />} />
                    <Route path="*" element={<NotFound />} />
                </Routes>
            </main>
            {!isPlayground && <Footer />}
        </div>
    );
}
