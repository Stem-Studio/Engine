import {useRef, useEffect} from "react";
import * as THREE from "three";
import { EXRLoader } from 'three/addons/loaders/EXRLoader.js';
import { HDRLoader } from "three/addons/loaders/HDRLoader.js";

export const TexturePreview = ({ url }: { url: string }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        if (!canvasRef.current) return;

        const canvas = canvasRef.current;
        const renderer = new THREE.WebGLRenderer({ 
            canvas, 
            alpha: true,
            antialias: true, 
        });
        
        // Fixed resolution for preview (2:1 aspect ratio)
        const width = 256;
        const height = 128;
        renderer.setSize(width, height, false);
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.0;
        renderer.outputColorSpace = THREE.SRGBColorSpace;

        const scene = new THREE.Scene();
        scene.name = "TexturePreviewScene";
        // Setup ortho camera to cover full [-1, 1] range
        const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

        const loader = url.toLowerCase().endsWith('.exr') ? new EXRLoader() : new HDRLoader();
        let isMounted = true;

        loader.load(url, (texture) => {
            if (!isMounted) {
                texture.dispose();
                return;
            }

            texture.minFilter = THREE.LinearFilter;
            texture.magFilter = THREE.LinearFilter;
            texture.mapping = THREE.EquirectangularReflectionMapping;

            const plane = new THREE.Mesh(
                new THREE.PlaneGeometry(2, 2),
                new THREE.MeshBasicMaterial({ map: texture }),
            );
            scene.add(plane);

            renderer.render(scene, camera);
        });

        return () => {
            isMounted = false;
            renderer.dispose();
            scene.traverse((o: any) => {
                if (o.geometry) o.geometry.dispose();
                if (o.material) {
                    if (o.material.map) o.material.map.dispose();
                    o.material.dispose();
                }
            });
        };
    }, [url]);

    return (
        <canvas 
            ref={canvasRef} 
            style={{ 
                width: '100%', 
                height: '100%', 
                objectFit: 'cover', 
            }} 
        />
    );
};
