"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { makeKart } from "@/src/game3d/cars";
import type { CarId } from "@/src/game/engine";

// A small studio "garage": one WebGL canvas that shows the selected car as a
// slowly-rotating, properly-lit 3D model with a soft contact shadow. This is a
// menu preview widget only — it reads a car id + livery and builds the same
// mesh the race uses (makeKart), so it never drifts from the in-game look and
// needs no pre-rendered thumbnails. (It touches three, never in-race state.)
interface Props {
  car: CarId;
  color: number;
}

export default function CarShowroom({ car, color }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  // stable refs to the long-lived three objects so a car change rebuilds only
  // the mesh, not the whole scene
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rimRef = useRef<THREE.PointLight | null>(null);
  const kartRef = useRef<THREE.Group | null>(null);
  const spinRef = useRef<THREE.Group | null>(null);
  const camRef = useRef<THREE.PerspectiveCamera | null>(null);

  // --- one-time scene setup ---
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    host.appendChild(renderer.domElement);
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.domElement.style.display = "block";

    const scene = new THREE.Scene();
    sceneRef.current = scene;

    const cam = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
    camRef.current = cam;

    // a turntable the car sits on; we rotate this so the car spins in place
    const spin = new THREE.Group();
    spinRef.current = spin;
    scene.add(spin);

    // lighting: soft ambient + a key from front-right + a cool fill + a livery
    // rim light behind for a premium glow rim
    scene.add(new THREE.HemisphereLight(0xcfe0ff, 0x2a2440, 1.0));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(4, 7, 6);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 30;
    key.shadow.camera.left = -8;
    key.shadow.camera.right = 8;
    key.shadow.camera.top = 8;
    key.shadow.camera.bottom = -8;
    key.shadow.bias = -0.0004;
    scene.add(key);
    const fill = new THREE.DirectionalLight(0x88aaff, 0.7);
    fill.position.set(-6, 3, -4);
    scene.add(fill);
    const rim = new THREE.PointLight(color, 6, 20, 2);
    rim.position.set(-2, 2.2, -4);
    rimRef.current = rim;
    scene.add(rim);

    // soft contact shadow catcher
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(40, 40),
      new THREE.ShadowMaterial({ opacity: 0.38 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    let raf = 0;
    let last = performance.now();
    let angle = 0.6;
    const tick = () => {
      const now = performance.now();
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      angle += dt * 0.5;
      if (spinRef.current) spinRef.current.rotation.y = angle;
      renderer.render(scene, cam);
      raf = requestAnimationFrame(tick);
    };

    const resize = () => {
      const w = host.clientWidth || 1;
      const h = host.clientHeight || 1;
      renderer.setSize(w, h, false);
      cam.aspect = w / h;
      cam.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(host);
    resize();
    raf = requestAnimationFrame(tick);

    const onVis = () => {
      if (document.hidden) {
        cancelAnimationFrame(raf);
      } else {
        last = performance.now();
        raf = requestAnimationFrame(tick);
      }
    };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", onVis);
      ro.disconnect();
      renderer.dispose();
      if (renderer.domElement.parentNode === host) host.removeChild(renderer.domElement);
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        const mat = m.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
        else if (mat) mat.dispose();
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- rebuild the car mesh whenever the pick or livery changes ---
  useEffect(() => {
    const spin = spinRef.current;
    const cam = camRef.current;
    if (!spin || !cam) return;

    // drop the previous kart
    if (kartRef.current) {
      spin.remove(kartRef.current);
      kartRef.current.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        const mat = m.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
        else if (mat) mat.dispose();
      });
    }

    const kart = makeKart(car, color);
    kart.traverse((o) => {
      o.castShadow = true;
      o.receiveShadow = true;
    });
    spin.add(kart);
    kartRef.current = kart;

    // frame the camera to the car's size (limo is long, monster truck is tall)
    const box = new THREE.Box3().setFromObject(kart);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);
    const reach = Math.max(size.x, size.z, size.y * 1.4);
    const dist = reach * 1.75 + 1.5;
    cam.position.set(dist * 0.62, center.y + size.y * 0.55 + 0.9, dist * 0.92);
    cam.lookAt(0, center.y * 0.82, 0);

    if (rimRef.current) rimRef.current.color.set(color);
  }, [car, color]);

  return <div ref={hostRef} className="showroom-canvas" aria-hidden="true" />;
}
