import {useEffect, useRef} from "react";
import * as THREE from "three";

import {HERO_CODE} from "../content/features";

// Lightweight, syntax-class-only highlighter. Not a real parser — produces
// the same colour buckets as the prose around the showcase. Good enough for a
// static snippet, avoids pulling in a megabyte of Prism / Shiki.
//
// Single-pass tokenizer: each character is consumed exactly once, so later
// passes never re-scan (and corrupt) the markup emitted by earlier ones — the
// `class="tok-*"` attributes are not themselves re-tokenized.
const KEYWORDS = new Set([
    "import", "export", "from", "class", "extends", "return",
    "const", "let", "var", "if", "else", "new", "this", "async", "await",
]);

function escapeHtml(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function highlight(code: string): string {
    // Ordered alternation: comment | string | number | identifier | any char.
    const token = /(\/\/[^\n]*)|("[^"]*"|'[^']*')|(\d+(?:\.\d+)?)|([A-Za-z_$][\w$]*)|([\s\S])/g;
    let html = "";
    let match: RegExpExecArray | null;
    while ((match = token.exec(code))) {
        const [, comment, str, num, ident, other] = match;
        if (comment !== undefined) {
            html += `<span class="tok-comment">${escapeHtml(comment)}</span>`;
        } else if (str !== undefined) {
            html += `<span class="tok-string">${escapeHtml(str)}</span>`;
        } else if (num !== undefined) {
            html += `<span class="tok-num">${num}</span>`;
        } else if (ident !== undefined) {
            if (KEYWORDS.has(ident)) {
                html += `<span class="tok-keyword">${ident}</span>`;
            } else if (code[token.lastIndex] === "(") {
                html += `<span class="tok-fn">${ident}</span>`;
            } else {
                html += escapeHtml(ident);
            }
        } else {
            html += escapeHtml(other ?? "");
        }
    }
    return html;
}

export function CodeShowcase() {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const renderer = new THREE.WebGLRenderer({canvas, alpha: true, antialias: true});
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
        camera.position.set(0, 1.2, 4.2);

        scene.add(new THREE.AmbientLight(0xffffff, 0.55));
        const key = new THREE.DirectionalLight(0xffffff, 1.2);
        key.position.set(3, 5, 2);
        scene.add(key);
        const rim = new THREE.DirectionalLight(0x7c5cff, 0.9);
        rim.position.set(-3, 1, -2);
        scene.add(rim);

        const floor = new THREE.Mesh(
            new THREE.PlaneGeometry(20, 20),
            new THREE.MeshStandardMaterial({color: 0x121626, roughness: 0.9}),
        );
        floor.rotation.x = -Math.PI / 2;
        floor.position.y = -0.7;
        scene.add(floor);

        const box = new THREE.Mesh(
            new THREE.BoxGeometry(1.2, 1.2, 1.2),
            new THREE.MeshStandardMaterial({color: 0x39d4a8, roughness: 0.35, metalness: 0.15}),
        );
        scene.add(box);

        const torus = new THREE.Mesh(
            new THREE.TorusGeometry(0.45, 0.16, 16, 48),
            new THREE.MeshStandardMaterial({color: 0xff8a4c, roughness: 0.3, metalness: 0.4}),
        );
        scene.add(torus);

        const resize = () => {
            const w = canvas.clientWidth;
            const h = canvas.clientHeight;
            renderer.setSize(w, h, false);
            camera.aspect = w / h;
            camera.updateProjectionMatrix();
        };
        resize();
        const ro = new ResizeObserver(resize);
        ro.observe(canvas);

        let raf = 0;
        const timer = new THREE.Timer();
        const tick = () => {
            timer.update();
            const t = timer.getElapsed();
            const dt = timer.getDelta();
            box.rotation.y += dt * 1.4;
            box.position.y = Math.sin(t * 1.6) * 0.18;
            torus.position.x = Math.cos(t * 0.9) * 1.6;
            torus.position.z = Math.sin(t * 0.9) * 1.6;
            torus.rotation.x += dt * 0.8;
            torus.rotation.y += dt * 1.1;
            renderer.render(scene, camera);
            raf = requestAnimationFrame(tick);
        };
        tick();

        return () => {
            cancelAnimationFrame(raf);
            ro.disconnect();
            scene.traverse((obj) => {
                const mesh = obj as THREE.Mesh;
                if (mesh.geometry) mesh.geometry.dispose();
                const mat = mesh.material;
                if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
                else if (mat) (mat as THREE.Material).dispose();
            });
            timer.dispose();
            renderer.dispose();
        };
    }, []);

    return (
        <section className="section">
            <div className="container">
                <div className="section-head">
                    <h2>One behavior. A live scene.</h2>
                    <p>
                        Write a behavior, attach it to any object, and it runs every frame
                        inside the editor and in your shipped game. The same code drives
                        previews, exports, and the player.
                    </p>
                </div>
                <div className="showcase">
                    <div className="code-pane">
                        <div className="code-pane-head">
                            <span className="code-pane-dots">
                                <span />
                                <span />
                                <span />
                            </span>
                            SpinBehavior.ts
                        </div>
                        <pre dangerouslySetInnerHTML={{__html: highlight(HERO_CODE)}} />
                    </div>
                    <div className="preview-pane">
                        <canvas ref={canvasRef} aria-label="Live 3D preview" />
                    </div>
                </div>
            </div>
        </section>
    );
}
