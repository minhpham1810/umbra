/** glTF models for the scene view, loaded with Three's GLTFLoader (one load per asset). */
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { ModelLoader } from "./scene-view.js";

/**
 * A ModelLoader for .glb/.gltf assets, resolved against `path` (e.g. "/models/").
 * Pass your own `loader` to add Draco or KTX2 support.
 */
export function gltfModels(opts: { path?: string; loader?: GLTFLoader } = {}): ModelLoader {
  const loader = opts.loader ?? new GLTFLoader();
  if (opts.path) loader.setPath(opts.path);
  return async (asset) => (await loader.loadAsync(asset)).scene;
}
