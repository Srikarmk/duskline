import * as THREE from "three";

// --- environment ----------------------------------------------------------

export function makeSkyDome(): THREE.Mesh {
  const c = document.createElement("canvas");
  c.width = 1024;
  c.height = 512;
  const ctx = c.getContext("2d")!;

  const grad = ctx.createLinearGradient(0, 0, 0, 512);
  grad.addColorStop(0, "#0d0821");
  grad.addColorStop(0.45, "#1a1033");
  grad.addColorStop(0.75, "#4a2d6e");
  grad.addColorStop(1, "#6d4a9e");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 1024, 512);

  // stars in the upper sky
  let seed = 7;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  ctx.fillStyle = "#e8e0ff";
  for (let i = 0; i < 260; i++) {
    const x = rand() * 1024;
    const y = rand() * 300;
    const r = rand() * 1.8 + 0.4;
    ctx.globalAlpha = 0.3 + rand() * 0.7;
    ctx.fillRect(x, y, r, r);
  }
  ctx.globalAlpha = 1;

  // twin moons
  const moon = (x: number, y: number, r: number, tint: string) => {
    const halo = ctx.createRadialGradient(x, y, r * 0.5, x, y, r * 2.4);
    halo.addColorStop(0, "rgba(232,224,255,0.35)");
    halo.addColorStop(1, "rgba(232,224,255,0)");
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(x, y, r * 2.4, 0, Math.PI * 2);
    ctx.fill();
    const face = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.2, x, y, r);
    face.addColorStop(0, "#f5f0ff");
    face.addColorStop(1, tint);
    ctx.fillStyle = face;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  };
  moon(700, 130, 34, "#c7b8f5");
  moon(240, 180, 14, "#9ad5d0");

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const geo = new THREE.SphereGeometry(900, 32, 16);
  const mat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false });
  return new THREE.Mesh(geo, mat);
}

export function makeGround(): THREE.Mesh {
  const geo = new THREE.CircleGeometry(1200, 48);
  const mat = new THREE.MeshLambertMaterial({ color: 0x14532d });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = -0.02;
  return mesh;
}

// --- pickups & obstacles ---------------------------------------------------

export function makeGem(air: boolean): THREE.Mesh {
  const geo = new THREE.OctahedronGeometry(0.45);
  geo.scale(0.7, 1, 0.7);
  const mat = new THREE.MeshStandardMaterial({
    color: air ? 0xfbbf24 : 0x22d3ee,
    emissive: air ? 0xb45309 : 0x0e7490,
    emissiveIntensity: 1.4,
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
  const group = new THREE.Group();
  const core = new THREE.Mesh(
    new THREE.SphereGeometry(0.55, 20, 16),
    new THREE.MeshStandardMaterial({
      color: 0xd946ef,
      emissive: 0xd946ef,
      emissiveIntensity: 1.6,
      transparent: true,
      opacity: 0.9,
    })
  );
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.85, 0.06, 8, 32),
    new THREE.MeshStandardMaterial({ color: 0x22d3ee, emissive: 0x22d3ee, emissiveIntensity: 1.2 })
  );
  ring.rotation.x = Math.PI / 2.4;
  group.add(core, ring);
  group.position.y = 1.1;
  const wrapper = new THREE.Group();
  wrapper.add(group);
  return wrapper;
}

export function makeRamp(): THREE.Mesh {
  // wedge rising toward +z (direction of travel)
  const w = 1.6, l = 2.8, h = 1.5;
  const geo = new THREE.BufferGeometry();
  const verts = new Float32Array([
    // slope
    -w, 0, -l,  w, 0, -l,  w, h, l,
    -w, 0, -l,  w, h, l,  -w, h, l,
    // back face
    -w, 0, l,  -w, h, l,  w, h, l,
    -w, 0, l,  w, h, l,  w, 0, l,
    // left side
    -w, 0, -l,  -w, h, l,  -w, 0, l,
    // right side
    w, 0, -l,  w, 0, l,  w, h, l,
  ]);
  geo.setAttribute("position", new THREE.BufferAttribute(verts, 3));
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({
    color: 0xd97706,
    emissive: 0x92400e,
    emissiveIntensity: 0.5,
  });
  return new THREE.Mesh(geo, mat);
}

export function makeCrystalCluster(rand: () => number): THREE.Group {
  const group = new THREE.Group();
  const shards = 2 + Math.floor(rand() * 2);
  for (let i = 0; i < shards; i++) {
    const height = 1.2 + rand() * 2.6;
    const geo = new THREE.ConeGeometry(0.35 + rand() * 0.3, height, 5);
    const shade = [0x7c3aed, 0xa855f7, 0xc084fc][Math.floor(rand() * 3)];
    const mat = new THREE.MeshStandardMaterial({
      color: shade,
      emissive: shade,
      emissiveIntensity: 0.55,
      roughness: 0.3,
    });
    const shard = new THREE.Mesh(geo, mat);
    shard.position.set((rand() - 0.5) * 1.4, height / 2, (rand() - 0.5) * 1.4);
    shard.rotation.z = (rand() - 0.5) * 0.35;
    group.add(shard);
  }
  return group;
}

// --- the transformer mech ---------------------------------------------------

export interface MechRig {
  group: THREE.Group;
  wings: THREE.Group;
  core: THREE.Mesh;
}

export function makeMech(): MechRig {
  const group = new THREE.Group();
  const cyan = new THREE.MeshStandardMaterial({ color: 0x0891b2, metalness: 0.5, roughness: 0.4 });
  const darkCyan = new THREE.MeshStandardMaterial({ color: 0x155e75, metalness: 0.5, roughness: 0.5 });

  const torso = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.5, 0.9), cyan);
  torso.position.y = 2.1;

  const head = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.55, 0.6), darkCyan);
  head.position.y = 3.15;
  const visor = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.14, 0.1),
    new THREE.MeshStandardMaterial({ color: 0xf0abfc, emissive: 0xf0abfc, emissiveIntensity: 2 })
  );
  visor.position.set(0, 3.18, 0.32);

  const pauldronL = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.5, 0.8), darkCyan);
  pauldronL.position.set(-1.05, 2.7, 0);
  const pauldronR = pauldronL.clone();
  pauldronR.position.x = 1.05;

  const armL = new THREE.Mesh(new THREE.BoxGeometry(0.35, 1.3, 0.45), cyan);
  armL.position.set(-1.05, 1.8, 0);
  const armR = armL.clone();
  armR.position.x = 1.05;

  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.4, 0.6), darkCyan);
  legL.position.set(-0.42, 0.7, 0);
  const legR = legL.clone();
  legR.position.x = 0.42;

  const core = new THREE.Mesh(
    new THREE.SphereGeometry(0.28, 16, 12),
    new THREE.MeshStandardMaterial({ color: 0xf0abfc, emissive: 0xf0abfc, emissiveIntensity: 2.4 })
  );
  core.position.set(0, 2.2, 0.5);

  // wings (visible while flying)
  const wings = new THREE.Group();
  const wingMat = new THREE.MeshStandardMaterial({
    color: 0x22d3ee,
    emissive: 0x0e7490,
    emissiveIntensity: 0.9,
    side: THREE.DoubleSide,
  });
  const wingShape = new THREE.Shape();
  wingShape.moveTo(0, 0);
  wingShape.lineTo(2.4, 0.7);
  wingShape.lineTo(2.1, 1.1);
  wingShape.lineTo(0, 0.5);
  wingShape.closePath();
  const wingGeo = new THREE.ShapeGeometry(wingShape);
  const wingL = new THREE.Mesh(wingGeo, wingMat);
  wingL.position.set(0.4, 2.3, -0.5);
  wingL.rotation.y = Math.PI * 0.12;
  const wingR = new THREE.Mesh(wingGeo, wingMat);
  wingR.scale.x = -1;
  wingR.position.set(-0.4, 2.3, -0.5);
  wingR.rotation.y = -Math.PI * 0.12;
  wings.add(wingL, wingR);
  wings.visible = false;

  group.add(torso, head, visor, pauldronL, pauldronR, armL, armR, legL, legR, core, wings);
  return { group, wings, core };
}

// --- effects ---------------------------------------------------------------

export function makeFlame(): THREE.Mesh {
  const geo = new THREE.ConeGeometry(0.22, 1.2, 8);
  const mat = new THREE.MeshBasicMaterial({
    color: 0xfb923c,
    transparent: true,
    opacity: 0.85,
  });
  const flame = new THREE.Mesh(geo, mat);
  flame.rotation.x = Math.PI / 2; // point backwards along -z
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
  const mat = new THREE.MeshBasicMaterial({
    map: tex,
    transparent: true,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  return mesh;
}
