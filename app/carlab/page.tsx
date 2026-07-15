"use client";

// TEMPORARY dev-only inspection page for the car mesh overhaul. Renders all 8
// cars on a turntable grid from a consistent angle so the meshes can be compared
// at a glance. Delete before shipping.

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { makeKart } from "@/src/game3d/cars";
import { CAR_SPECS, CAR_IDS } from "@/src/game3d/carData";

export default function CarLab() {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.setClearColor(0x0d1020, 1);
    host.appendChild(renderer.domElement);
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.domElement.style.display = "block";

    const scene = new THREE.Scene();
    const cam = new THREE.PerspectiveCamera(50, 1, 0.1, 300);

    scene.add(new THREE.HemisphereLight(0xcfe0ff, 0x2a2440, 1.0));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(8, 12, 10);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 80;
    Object.assign(key.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30 });
    scene.add(key);
    const fill = new THREE.DirectionalLight(0x88aaff, 0.7);
    fill.position.set(-10, 5, -6);
    scene.add(fill);

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(200, 200),
      new THREE.MeshStandardMaterial({ color: 0x14182b, roughness: 1 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    // single row of all 8 cars, each on its own turntable
    const gapX = 6;
    const spins: THREE.Group[] = [];
    CAR_IDS.forEach((id, i) => {
      const spin = new THREE.Group();
      spin.position.set((i - (CAR_IDS.length - 1) / 2) * gapX, 0, 0);
      const kart = makeKart(id, CAR_SPECS[id].color);
      kart.traverse((o) => { o.castShadow = true; o.receiveShadow = true; });
      spin.add(kart);
      scene.add(spin);
      spins.push(spin);
    });
    console.log("[carlab] cars:", spins.map((s) => s.position.x.toFixed(1)).join(","));

    let raf = 0;
    let last = performance.now();
    let angle = 0.5;
    const tick = () => {
      const now = performance.now();
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      angle += dt * 0.35;
      for (const s of spins) s.rotation.y = angle;
      renderer.render(scene, cam);
      raf = requestAnimationFrame(tick);
    };

    const resize = () => {
      const w = window.innerWidth || 1;
      const h = window.innerHeight || 1;
      renderer.setSize(w, h, false);
      cam.aspect = w / h;
      cam.updateProjectionMatrix();
      // frame the whole row
      cam.position.set(0, 8, 30);
      cam.lookAt(0, 0.3, 0);
      console.log("[carlab] resize", w, h, "aspect", (w / h).toFixed(2));
    };
    window.addEventListener("resize", resize);
    resize();
    setTimeout(resize, 100);
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      renderer.dispose();
      if (renderer.domElement.parentNode === host) host.removeChild(renderer.domElement);
    };
  }, []);

  return <div ref={hostRef} style={{ position: "fixed", inset: 0, width: "100vw", height: "100vh" }} />;
}
