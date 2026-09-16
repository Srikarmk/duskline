import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/**
 * Collapse every static part of a built prop into one mesh PER MATERIAL.
 *
 * Written for cars — the detail pass took one from ~130 meshes to 167, and a
 * ten-car grid is 1,670 objects to cull and sort every frame — but the same
 * problem shows up anywhere a prop is assembled from many small primitives.
 * Neo-Tokyo towers are the extreme case: ~100 boxes each, 176 of them, and the
 * Neon Run scene graph was **21,151 meshes**, of which 18,066 were plain
 * 24-vertex boxes. Most are culled, but every one still costs a matrix update
 * and a frustum test on the CPU each frame, and this renderer has been
 * draw-call bound before.
 *
 * Nothing that MOVES may be merged: wheels spin and steer, and foliage sways,
 * so merging across props is what broke the wind animation the last time this
 * was tried. Within a single static prop it is free.
 *
 * Merging is attempted per material and quietly leaves a material's meshes
 * alone if it fails, because mergeGeometries refuses a set whose attributes do
 * not match exactly — a real risk with a UV-mapped lofted body sitting
 * alongside primitives.
 *
 * @param root the prop's own group. Anything with `userData.wheel` or
 *   `userData.noMerge` is skipped, along with its descendants.
 */
export function mergeStaticParts(root: THREE.Group): void {
  const byMat = new Map<THREE.Material, THREE.Mesh[]>();
  const skip = new Set<THREE.Object3D>();
  root.traverse((o) => {
    if (o.userData.wheel || o.userData.noMerge) o.traverse((c) => skip.add(c));
  });
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || skip.has(m) || Array.isArray(m.material)) return;
    const mat = m.material as THREE.Material;
    const list = byMat.get(mat);
    if (list) list.push(m); else byMat.set(mat, [m]);
  });

  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  for (const [mat, meshes] of byMat) {
    if (meshes.length < 2) continue;
    const geos: THREE.BufferGeometry[] = [];
    let ok = true;
    for (const m of meshes) {
      const gm = m.geometry.clone();
      // bake the mesh's placement, expressed in the car root's frame
      gm.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
      // strip anything not shared by all of them, so the attribute sets line up
      for (const name of Object.keys(gm.attributes)) {
        if (name !== "position" && name !== "normal" && name !== "uv") gm.deleteAttribute(name);
      }
      if (!gm.getAttribute("uv")) {
        const n = gm.getAttribute("position").count;
        gm.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(n * 2), 2));
      }
      geos.push(gm.index ? gm.toNonIndexed() : gm);
    }
    let merged: THREE.BufferGeometry | null = null;
    try { merged = mergeGeometries(geos, false); } catch { ok = false; }
    if (!ok || !merged) continue;
    for (const m of meshes) m.removeFromParent();
    root.add(new THREE.Mesh(merged, mat));
  }
}
