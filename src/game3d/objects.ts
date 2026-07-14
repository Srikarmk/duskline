import * as THREE from "three";
import type { RealmPalette } from "./realms";

// --- sky ------------------------------------------------------------------

export function makeSkyDome(pal: RealmPalette): THREE.Mesh {
  const c = document.createElement("canvas");
  c.width = 1024;
  c.height = 512;
  const ctx = c.getContext("2d")!;

  const grad = ctx.createLinearGradient(0, 0, 0, 512);
  grad.addColorStop(0, pal.sky[0]);
  grad.addColorStop(0.45, pal.sky[1]);
  grad.addColorStop(0.75, pal.sky[2]);
  grad.addColorStop(1, pal.sky[3]);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 1024, 512);

  if (pal.stars) {
    let seed = 7;
    const rand = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    ctx.fillStyle = "#ffffff";
    for (let i = 0; i < 280; i++) {
      const x = rand() * 1024;
      const y = rand() * 300;
      const r = rand() * 1.8 + 0.4;
      ctx.globalAlpha = 0.25 + rand() * 0.7;
      ctx.fillRect(x, y, r, r);
    }
    ctx.globalAlpha = 1;
  }

  for (const m of pal.moons) {
    const halo = ctx.createRadialGradient(m.x, m.y, m.r * 0.5, m.x, m.y, m.r * 2.4);
    halo.addColorStop(0, "rgba(255,255,255,0.3)");
    halo.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(m.x, m.y, m.r * 2.4, 0, Math.PI * 2);
    ctx.fill();
    const face = ctx.createRadialGradient(m.x - m.r * 0.3, m.y - m.r * 0.3, m.r * 0.2, m.x, m.y, m.r);
    face.addColorStop(0, "#ffffff");
    face.addColorStop(1, m.tint);
    ctx.fillStyle = face;
    ctx.beginPath();
    ctx.arc(m.x, m.y, m.r, 0, Math.PI * 2);
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const geo = new THREE.SphereGeometry(900, 32, 16);
  const mat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false });
  return new THREE.Mesh(geo, mat);
}

// --- ground / grass -------------------------------------------------------

function noiseTexture(base: string, speck: string, dark: string, tile: number): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 1400; i++) {
    ctx.fillStyle = Math.random() < 0.5 ? speck : dark;
    const s = 1 + Math.random() * 3;
    ctx.globalAlpha = 0.3 + Math.random() * 0.5;
    ctx.fillRect(Math.random() * 128, Math.random() * 128, s, s);
  }
  ctx.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(tile, tile);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function makeGroundTexture(pal: RealmPalette): THREE.Texture {
  return noiseTexture(pal.groundBase, pal.groundSpeck, pal.groundDark, 120);
}

export function makeGrassTexture(pal: RealmPalette): THREE.Texture {
  return noiseTexture(pal.groundBase, pal.groundSpeck, pal.groundDark, 40);
}

export function makeGround(groundTex: THREE.Texture): THREE.Mesh {
  const geo = new THREE.CircleGeometry(1400, 64);
  const mat = new THREE.MeshLambertMaterial({ map: groundTex });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = -0.05;
  return mesh;
}

export interface Placement { x: number; z: number; y: number; s: number; r: number; }

export function makeGrassField(pal: RealmPalette, pts: Placement[]): THREE.InstancedMesh {
  const geo = new THREE.ConeGeometry(0.16, 0.7, 4);
  geo.translate(0, 0.35, 0);
  const mat = new THREE.MeshLambertMaterial({ color: pal.clutter });
  const mesh = new THREE.InstancedMesh(geo, mat, pts.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  const col = new THREE.Color();
  const base = new THREE.Color(pal.clutter);
  pts.forEach((pt, i) => {
    p.set(pt.x, pt.y, pt.z);
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), pt.r);
    s.set(pt.s, pt.s * (0.7 + Math.random() * 0.9), pt.s);
    m.compose(p, q, s);
    mesh.setMatrixAt(i, m);
    col.copy(base).offsetHSL(0, 0, (Math.random() - 0.5) * 0.18);
    mesh.setColorAt(i, col);
  });
  mesh.instanceMatrix.needsUpdate = true;
  return mesh;
}

export function makeRockField(pal: RealmPalette, pts: Placement[]): THREE.InstancedMesh {
  const geo = new THREE.DodecahedronGeometry(0.4, 0);
  const mat = new THREE.MeshLambertMaterial({ color: pal.mountainDark });
  const mesh = new THREE.InstancedMesh(geo, mat, pts.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  pts.forEach((pt, i) => {
    p.set(pt.x, pt.y + 0.1, pt.z);
    q.setFromEuler(new THREE.Euler(pt.r, pt.r * 2, pt.r * 0.5));
    s.setScalar(pt.s);
    m.compose(p, q, s);
    mesh.setMatrixAt(i, m);
  });
  mesh.instanceMatrix.needsUpdate = true;
  return mesh;
}

export function makeMountainRing(pal: RealmPalette, cx: number, cz: number, radius: number): THREE.Group {
  const group = new THREE.Group();
  const rand = (() => { let s = 99; return () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; })();
  const rings = [
    { r: radius, color: pal.mountainDark, count: 26, h: [40, 90], fog: true },
    { r: radius * 0.82, color: pal.mountain, count: 20, h: [30, 70], fog: true },
  ];
  for (const ring of rings) {
    for (let i = 0; i < ring.count; i++) {
      const a = (i / ring.count) * Math.PI * 2 + rand() * 0.2;
      const h = ring.h[0] + rand() * (ring.h[1] - ring.h[0]);
      const rad = h * (0.7 + rand() * 0.5);
      const geo = new THREE.ConeGeometry(rad, h, 5);
      const mat = new THREE.MeshLambertMaterial({ color: ring.color });
      const peak = new THREE.Mesh(geo, mat);
      peak.position.set(cx + Math.cos(a) * ring.r, h / 2 - 6, cz + Math.sin(a) * ring.r);
      peak.rotation.y = rand() * Math.PI;
      group.add(peak);
    }
  }
  return group;
}

// --- pickups & obstacles ---------------------------------------------------

export function makeGem(color: number, air: boolean): THREE.Mesh {
  const geo = new THREE.OctahedronGeometry(0.45);
  geo.scale(0.7, 1, 0.7);
  const mat = new THREE.MeshStandardMaterial({
    color: air ? 0xfbbf24 : color,
    emissive: air ? 0xb45309 : color,
    emissiveIntensity: 1.3,
    metalness: 0.3,
    roughness: 0.2,
  });
  return new THREE.Mesh(geo, mat);
}

export function makeNitroCan(): THREE.Group {
  const group = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.32, 0.32, 1, 12),
    new THREE.MeshStandardMaterial({ color: 0x0ea5e9, emissive: 0x0e7490, emissiveIntensity: 0.8 })
  );
  body.position.y = 0.5;
  const cap = new THREE.Mesh(
    new THREE.CylinderGeometry(0.14, 0.2, 0.25, 12),
    new THREE.MeshStandardMaterial({ color: 0x67e8f9, emissive: 0x67e8f9, emissiveIntensity: 1 })
  );
  cap.position.y = 1.1;
  group.add(body, cap);
  return group;
}

export function makeOrb(): THREE.Group {
  const inner = new THREE.Group();
  const core = new THREE.Mesh(
    new THREE.SphereGeometry(0.55, 20, 16),
    new THREE.MeshStandardMaterial({
      color: 0xd946ef, emissive: 0xd946ef, emissiveIntensity: 1.6,
      transparent: true, opacity: 0.9,
    })
  );
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.85, 0.06, 8, 32),
    new THREE.MeshStandardMaterial({ color: 0x22d3ee, emissive: 0x22d3ee, emissiveIntensity: 1.2 })
  );
  ring.rotation.x = Math.PI / 2.4;
  inner.add(core, ring);
  inner.position.y = 1.1;
  const wrapper = new THREE.Group();
  wrapper.add(inner);
  return wrapper;
}

export function makeRamp(): THREE.Group {
  const group = new THREE.Group();
  const w = 2.3, l = 3.0, h = 2.0;

  // solid wedge body (slope rises toward +z / the direction of travel)
  const verts = new Float32Array([
    -w, 0, -l, w, 0, -l, w, h, l, -w, 0, -l, w, h, l, -w, h, l, // slope
    -w, 0, l, -w, h, l, w, h, l, -w, 0, l, w, h, l, w, 0, l,     // back wall
    -w, 0, -l, -w, 0, l, w, 0, l, -w, 0, -l, w, 0, l, w, 0, -l,   // bottom
    -w, 0, -l, -w, h, l, -w, 0, l,                                // left side
    w, 0, -l, w, 0, l, w, h, l,                                   // right side
  ]);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(verts, 3));
  geo.computeVertexNormals();
  const body = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({ color: 0x5a2c0e, metalness: 0.4, roughness: 0.6 })
  );
  group.add(body);

  const pitch = Math.atan2(h, 2 * l);
  const slopeLen = Math.hypot(2 * l, h);
  const glow = new THREE.MeshStandardMaterial({
    color: 0xfde68a, emissive: 0xf59e0b, emissiveIntensity: 1.3,
  });

  // glowing launch strip down the middle of the slope
  const strip = new THREE.Mesh(new THREE.BoxGeometry(w * 0.55, 0.14, slopeLen * 0.96), glow);
  strip.position.set(0, h / 2 + 0.12, 0);
  strip.rotation.x = -pitch;
  group.add(strip);

  // glowing chevrons pointing up the ramp
  const chevMat = new THREE.MeshStandardMaterial({
    color: 0xfef3c7, emissive: 0xfbbf24, emissiveIntensity: 1.6,
  });
  for (let i = 0; i < 3; i++) {
    const t = 0.28 + i * 0.22;
    const chev = new THREE.Mesh(new THREE.ConeGeometry(w * 0.4, 0.5, 3), chevMat);
    chev.position.set(0, h * t + 0.22, -l + 2 * l * t);
    chev.rotation.x = -pitch; // lie on the slope, tip pointing up-ramp
    group.add(chev);
  }

  // glowing side rails
  for (const sx of [-1, 1]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, slopeLen), glow);
    rail.position.set(sx * w, h / 2 + 0.06, 0);
    rail.rotation.x = -pitch;
    group.add(rail);
  }

  return group;
}

export function makeCrystalCluster(rand: () => number, colors: number[]): THREE.Group {
  const group = new THREE.Group();
  const shards = 2 + Math.floor(rand() * 3);
  for (let i = 0; i < shards; i++) {
    const height = 1.2 + rand() * 3;
    const geo = new THREE.ConeGeometry(0.35 + rand() * 0.3, height, 5);
    const shade = colors[Math.floor(rand() * colors.length)];
    const mat = new THREE.MeshStandardMaterial({
      color: shade, emissive: shade, emissiveIntensity: 0.6, roughness: 0.25, metalness: 0.2,
    });
    const shard = new THREE.Mesh(geo, mat);
    shard.position.set((rand() - 0.5) * 1.6, height / 2, (rand() - 0.5) * 1.6);
    shard.rotation.z = (rand() - 0.5) * 0.4;
    group.add(shard);
  }
  return group;
}

// --- monsters (transformer combat) -----------------------------------------

export function makeMonster(rand: () => number): THREE.Group {
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x3b0764, roughness: 0.8, metalness: 0.1 });
  const spikeMat = new THREE.MeshStandardMaterial({ color: 0x1e1b2e, roughness: 0.7 });
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0xef4444, emissive: 0xef4444, emissiveIntensity: 2 });

  const body = new THREE.Mesh(new THREE.IcosahedronGeometry(1.1, 0), bodyMat);
  body.scale.set(1, 0.85, 1);
  body.position.y = 1.1;

  // horns
  for (const sx of [-0.5, 0.5]) {
    const horn = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.9, 6), spikeMat);
    horn.position.set(sx, 2, 0.2);
    horn.rotation.z = sx * -0.3;
    group.add(horn);
  }
  // back spikes
  for (let i = 0; i < 4; i++) {
    const spike = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.7, 5), spikeMat);
    spike.position.set((rand() - 0.5) * 1, 1.6, -0.5 - i * 0.2);
    group.add(spike);
  }
  // eyes
  for (const sx of [-0.35, 0.35]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), eyeMat);
    eye.position.set(sx, 1.25, 0.85);
    group.add(eye);
  }
  // stubby legs
  for (const sx of [-0.5, 0.5]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.6, 6), bodyMat);
    leg.position.set(sx, 0.3, 0);
    group.add(leg);
  }
  group.add(body);
  return group;
}

// --- the transformer mech --------------------------------------------------

export interface MechRig {
  group: THREE.Group;
  wings: THREE.Group;
  core: THREE.Mesh;
  armR: THREE.Group;
  sword: THREE.Group;
}

export function makeMech(): MechRig {
  const group = new THREE.Group();
  const steel = new THREE.MeshStandardMaterial({ color: 0x1f6f8b, metalness: 0.8, roughness: 0.3 });
  const steelDark = new THREE.MeshStandardMaterial({ color: 0x0d3b4a, metalness: 0.8, roughness: 0.4 });
  const trim = new THREE.MeshStandardMaterial({ color: 0x67e8f9, emissive: 0x22d3ee, emissiveIntensity: 0.6, metalness: 0.6, roughness: 0.3 });

  const box = (w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    return m;
  };

  // legs
  group.add(box(0.55, 1.2, 0.6, steelDark, -0.42, 0.6, 0));
  group.add(box(0.55, 1.2, 0.6, steelDark, 0.42, 0.6, 0));
  group.add(box(0.65, 0.3, 0.9, steel, -0.42, 0.15, 0.1)); // feet
  group.add(box(0.65, 0.3, 0.9, steel, 0.42, 0.15, 0.1));
  group.add(box(1.1, 0.5, 0.7, steelDark, 0, 1.35, 0)); // pelvis

  // torso
  const torso = box(1.5, 1.4, 0.85, steel, 0, 2.25, 0);
  group.add(torso);
  group.add(box(1.2, 0.5, 0.9, trim, 0, 2.9, 0.05)); // collar
  group.add(box(0.9, 0.6, 0.1, steelDark, 0, 2.2, 0.45)); // chest plate

  // head
  group.add(box(0.7, 0.6, 0.65, steelDark, 0, 3.5, 0));
  const visor = box(0.55, 0.16, 0.12, new THREE.MeshStandardMaterial({ color: 0xf0abfc, emissive: 0xf0abfc, emissiveIntensity: 2 }), 0, 3.55, 0.34);
  group.add(visor);
  group.add(box(0.08, 0.4, 0.08, trim, 0.28, 3.95, 0)); // antenna
  group.add(box(0.08, 0.3, 0.08, trim, -0.28, 3.9, 0));

  // shoulders (pauldrons)
  group.add(box(0.7, 0.55, 0.9, steelDark, -1.15, 2.75, 0));
  group.add(box(0.7, 0.55, 0.9, steelDark, 1.15, 2.75, 0));

  // left arm (static)
  const armL = new THREE.Group();
  armL.position.set(-1.15, 2.5, 0);
  armL.add(box(0.4, 1.3, 0.45, steel, 0, -0.65, 0));
  armL.add(box(0.45, 0.4, 0.5, trim, 0, -1.35, 0));
  group.add(armL);

  // right arm (swings) with energy sword
  const armR = new THREE.Group();
  armR.position.set(1.15, 2.5, 0);
  armR.add(box(0.4, 1.3, 0.45, steel, 0, -0.65, 0));
  armR.add(box(0.45, 0.4, 0.5, trim, 0, -1.35, 0)); // fist

  const sword = new THREE.Group();
  sword.position.set(0, -1.5, 0.2);
  const hilt = box(0.16, 0.5, 0.16, steelDark, 0, 0, 0);
  const guard = box(0.5, 0.12, 0.16, trim, 0, 0.28, 0);
  const blade = new THREE.Mesh(
    new THREE.BoxGeometry(0.22, 2.6, 0.08),
    new THREE.MeshStandardMaterial({ color: 0xe0f7ff, emissive: 0x22d3ee, emissiveIntensity: 1.8, transparent: true, opacity: 0.92 })
  );
  blade.position.y = 1.6;
  sword.add(hilt, guard, blade);
  armR.add(sword);
  armR.rotation.x = -0.5; // rest: sword raised
  group.add(armR);

  // core
  const core = new THREE.Mesh(
    new THREE.SphereGeometry(0.28, 16, 12),
    new THREE.MeshStandardMaterial({ color: 0xf0abfc, emissive: 0xf0abfc, emissiveIntensity: 2.4 })
  );
  core.position.set(0, 2.3, 0.5);
  group.add(core);

  // back thrusters
  group.add(box(0.3, 0.7, 0.3, steelDark, -0.45, 2.2, -0.5));
  group.add(box(0.3, 0.7, 0.3, steelDark, 0.45, 2.2, -0.5));

  // wings (flight)
  const wings = new THREE.Group();
  const wingMat = new THREE.MeshStandardMaterial({ color: 0x22d3ee, emissive: 0x0e7490, emissiveIntensity: 1, side: THREE.DoubleSide });
  const wingShape = new THREE.Shape();
  wingShape.moveTo(0, 0);
  wingShape.lineTo(2.6, 0.8);
  wingShape.lineTo(2.2, 1.3);
  wingShape.lineTo(0, 0.6);
  wingShape.closePath();
  const wingGeo = new THREE.ShapeGeometry(wingShape);
  const wingL = new THREE.Mesh(wingGeo, wingMat);
  wingL.position.set(0.4, 2.6, -0.55);
  wingL.rotation.y = Math.PI * 0.12;
  const wingR = new THREE.Mesh(wingGeo, wingMat);
  wingR.scale.x = -1;
  wingR.position.set(-0.4, 2.6, -0.55);
  wingR.rotation.y = -Math.PI * 0.12;
  wings.add(wingL, wingR);
  wings.visible = false;
  group.add(wings);

  return { group, wings, core, armR, sword };
}

export function makeSlash(): THREE.Mesh {
  const geo = new THREE.TorusGeometry(1.4, 0.14, 6, 20, Math.PI * 1.1);
  const mat = new THREE.MeshBasicMaterial({ color: 0x67e8f9, transparent: true, opacity: 0.9 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.visible = false;
  return mesh;
}

// --- effects ---------------------------------------------------------------

export function makeFlame(): THREE.Mesh {
  const geo = new THREE.ConeGeometry(0.22, 1.2, 8);
  const mat = new THREE.MeshBasicMaterial({ color: 0xfb923c, transparent: true, opacity: 0.85 });
  const flame = new THREE.Mesh(geo, mat);
  flame.rotation.x = Math.PI / 2;
  return flame;
}

export function makeUnderGlow(): THREE.Mesh {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext("2d")!;
  const grad = ctx.createRadialGradient(64, 64, 6, 64, 64, 62);
  grad.addColorStop(0, "rgba(103,232,249,0.8)");
  grad.addColorStop(1, "rgba(103,232,249,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  const geo = new THREE.PlaneGeometry(3.4, 3.4);
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  return mesh;
}

/** Uniformly tint every mesh in a cloned model, for opponent team colors. */
export function tintModel(obj: THREE.Object3D, hex: number) {
  obj.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      (o as THREE.Mesh).material = new THREE.MeshStandardMaterial({
        color: hex, metalness: 0.4, roughness: 0.5,
      });
    }
  });
}
