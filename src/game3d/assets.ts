import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { terrainBump } from "./textures";

// shared organic bump so the CC0 nature props (flat-shaded, no atlas) get some
// surface relief and read as textured rather than solid colour
let propBump: THREE.Texture | null = null;
function getPropBump() {
  if (!propBump) { propBump = terrainBump(3); propBump.needsUpdate = true; }
  return propBump;
}

export type ModelName =
  | "racer"
  | "treeA"
  | "treeB"
  | "treeDark"
  | "mushroom"
  | "mushroomTall"
  | "rockA"
  | "rockB";

const MODEL_PATHS: Record<ModelName, string> = {
  racer: "/models/race-future.glb",
  treeA: "/models/tree_pineRoundA.glb",
  treeB: "/models/tree_pineRoundB.glb",
  treeDark: "/models/tree_tall_dark.glb",
  mushroom: "/models/mushroom_red.glb",
  mushroomTall: "/models/mushroom_redTall.glb",
  rockA: "/models/rock_largeA.glb",
  rockB: "/models/rock_largeB.glb",
};

export type ModelLibrary = Record<ModelName, THREE.Group>;

// The car kit ships a real colormap atlas (car_colormap.png) that the racer's
// UVs map into — pointing the loader at it gives the car its proper livery.
// The nature kit bakes colors into materials and has no atlas, so we feed it a
// white 1px texture (colors multiply through unchanged, no 404s).
const WHITE_PIXEL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const CAR_ATLAS = "/models/Textures/car_colormap.png";

function makeLoader(colormapUrl: string): GLTFLoader {
  const manager = new THREE.LoadingManager();
  manager.setURLModifier((url) => (url.includes("colormap") ? colormapUrl : url));
  return new GLTFLoader(manager);
}

/** Convert prop meshes to a lit, lightly textured material (bump relief) so the
 *  flat CC0 nature kit reads as textured, preserving each part's colour. */
function relight(group: THREE.Group) {
  const bump = getPropBump();
  group.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      const src = obj.material as THREE.Material & {
        color?: THREE.Color;
        map?: THREE.Texture | null;
      };
      obj.material = new THREE.MeshStandardMaterial({
        color: src.color ?? new THREE.Color(0xffffff),
        map: src.map ?? null,
        bumpMap: bump,
        bumpScale: 0.25,
        metalness: 0.05,
        roughness: 0.9,
      });
      obj.castShadow = false;
      obj.receiveShadow = false;
    }
  });
}

export async function loadModels(): Promise<ModelLibrary> {
  const carLoader = makeLoader(CAR_ATLAS);
  const natureLoader = makeLoader(WHITE_PIXEL);
  const entries = await Promise.all(
    (Object.keys(MODEL_PATHS) as ModelName[]).map(async (name) => {
      const loader = name === "racer" ? carLoader : natureLoader;
      const gltf = await loader.loadAsync(MODEL_PATHS[name]);
      const group = gltf.scene;
      relight(group);
      return [name, group] as const;
    })
  );
  return Object.fromEntries(entries) as ModelLibrary;
}

/** Clone a library model, uniformly scaled so its largest XZ span is `size`. */
export function instantiate(library: ModelLibrary, name: ModelName, size: number): THREE.Group {
  const clone = library[name].clone(true);
  const box = new THREE.Box3().setFromObject(clone);
  const span = new THREE.Vector3();
  box.getSize(span);
  const scale = size / Math.max(span.x, span.z, 0.001);
  clone.scale.setScalar(scale);
  // rest the model's base on y=0
  const min = box.min.y * scale;
  clone.position.y = -min;
  return clone;
}
