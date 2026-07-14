import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

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

// Kenney nature-kit GLBs reference an external palette texture that isn't
// shipped in the pack; the real color lives in each material's
// baseColorFactor. Feed the loader a white 1px texture so colors multiply
// through unchanged (and no 404s are logged).
const WHITE_PIXEL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

export async function loadModels(): Promise<ModelLibrary> {
  const manager = new THREE.LoadingManager();
  manager.setURLModifier((url) =>
    url.includes("colormap") ? WHITE_PIXEL : url
  );
  const loader = new GLTFLoader(manager);
  const entries = await Promise.all(
    (Object.keys(MODEL_PATHS) as ModelName[]).map(async (name) => {
      const gltf = await loader.loadAsync(MODEL_PATHS[name]);
      const group = gltf.scene;
      group.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          // some kits use unlit materials; convert so our lights shade them
          const src = obj.material as THREE.Material & { color?: THREE.Color };
          if (src.color) {
            obj.material = new THREE.MeshLambertMaterial({ color: src.color });
          }
          obj.castShadow = false;
          obj.receiveShadow = false;
        }
      });
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
