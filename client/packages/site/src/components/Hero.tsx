import {useEffect, useRef} from "react";
import {Link} from "react-router-dom";
import {PLAYGROUND_ROUTE} from "../content/links";
import * as THREE from "three";

import {GITHUB_URL} from "../content/links";

export function Hero() {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const renderer = new THREE.WebGLRenderer({canvas, alpha: true, antialias: true});
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
        camera.position.set(0, 0, 5);

        const group = new THREE.Group();
        scene.add(group);

        const geo = new THREE.IcosahedronGeometry(1, 1);
        const mat = new THREE.MeshStandardMaterial({
            color: 0x7c5cff,
            roughness: 0.4,
            metalness: 0.2,
            flatShading: true,
        });
        const mesh = new THREE.Mesh(geo, mat);
        group.add(mesh);

        const wire = new THREE.LineSegments(
            new THREE.WireframeGeometry(geo),
            new THREE.LineBasicMaterial({color: 0x39d4a8, transparent: true, opacity: 0.5}),
        );
        wire.scale.setScalar(1.02);
        group.add(wire);

        scene.add(new THREE.AmbientLight(0xffffff, 0.6));
        const key = new THREE.DirectionalLight(0xffffff, 1.4);
        key.position.set(3, 5, 2);
        scene.add(key);
        const rim = new THREE.DirectionalLight(0x39d4a8, 0.8);
        rim.position.set(-3, 2, -3);
        scene.add(rim);

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
            const dt = timer.getDelta();
            group.rotation.y += dt * 0.45;
            group.rotation.x += dt * 0.18;
            renderer.render(scene, camera);
            raf = requestAnimationFrame(tick);
        };
        tick();

        return () => {
            cancelAnimationFrame(raf);
            ro.disconnect();
            geo.dispose();
            mat.dispose();
            (wire.geometry as THREE.BufferGeometry).dispose();
            (wire.material as THREE.Material).dispose();
            timer.dispose();
            renderer.dispose();
        };
    }, []);

    return (
        <section className="hero">
            <div className="hero-bg" aria-hidden />
            <canvas ref={canvasRef} className="hero-canvas" aria-hidden />
            <div className="container hero-content">
                <span className="eyebrow">
                    <span className="eyebrow-dot" aria-hidden />
                    Open source · MIT
                </span>
                <h1>
                    Build 3D games and apps <br />
                    <span className="grad">in your browser.</span>
                </h1>
                <p className="lead">
                    StemStudio is an open-source 3D editor and runtime built on Three.js.
                    Behaviors, ECS lambdas, physics, AI copilot, and multiplayer — all
                    local-first, with a UI you can ship.
                </p>
                <div className="hero-cta">
                    <Link to={PLAYGROUND_ROUTE} className="btn btn-primary">
                        Open the playground
                    </Link>
                    <a
                        className="btn btn-ghost"
                        href={GITHUB_URL}
                        target="_blank"
                        rel="noreferrer noopener"
                    >
                        ★ Star on GitHub
                    </a>
                    <Link to="/docs" className="btn">
                        Read the docs →
                    </Link>
                </div>
            </div>
        </section>
    );
}
