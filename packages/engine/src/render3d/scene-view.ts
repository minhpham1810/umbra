/**
 * A Three.js scene that mirrors a world's Mesh, Camera and Light components.
 *
 * Call capture() after each simulation tick and sync(alpha) before each frame: objects
 * are drawn between the last two ticks (alpha 0 = previous tick, 1 = latest), so motion
 * stays smooth at any frame rate while the simulation keeps its fixed tick. The view
 * only reads the world; it never changes game state.
 */
import * as THREE from "three";
import { canonicalJson } from "../core/hash.js";
import type { Entity, World } from "../core/world.js";
import { Camera, Light, Mesh, type Geometry } from "../render/components.js";
import { IDENTITY, Transform, type Quat, type Vec3 } from "../spatial/transform.js";

/** Loads a model asset (e.g. a glTF file) into an object the view can clone per entity. */
export type ModelLoader = (asset: string) => Promise<THREE.Object3D>;

export interface SceneViewOptions {
  /** Needed for Mesh components with `{ type: "model" }` geometry. */
  models?: ModelLoader;
  background?: THREE.ColorRepresentation;
  /** Used when no entity has an active Camera. */
  fallbackCamera?: THREE.PerspectiveCamera;
}

export interface SceneView {
  readonly scene: THREE.Scene;
  /** The camera to render with: the active Camera entity with the lowest id. */
  readonly camera: THREE.PerspectiveCamera;
  /** Record transforms after a tick, for smoothing. */
  capture(): void;
  /** Bring the scene up to date and place objects between the last two ticks. */
  sync(alpha?: number): void;
  /** The Three.js object drawn for an entity (e.g. to add effects to it). */
  objectOf(e: Entity): THREE.Object3D | undefined;
  /** Set the camera's aspect ratio, e.g. on resize. */
  setAspect(aspect: number): void;
  dispose(): void;
}

interface Pose { position: Vec3; rotation: Quat }
interface Drawn { object: THREE.Object3D; key: string; kind: "mesh" | "camera" | "light"; dispose(): void }

const color = (c: string | number) => new THREE.Color(c);
const poseOf = (world: World, e: Entity): Pose | undefined => {
  const t = world.get(e, Transform);
  return t && { position: t.position, rotation: t.rotation ?? IDENTITY };
};

function geometry(g: Exclude<Geometry, { type: "model" }>): THREE.BufferGeometry {
  switch (g.type) {
    case "box": return new THREE.BoxGeometry(g.half.x * 2, g.half.y * 2, g.half.z * 2);
    case "sphere": return new THREE.SphereGeometry(g.radius, 24, 16);
    case "capsule": return new THREE.CapsuleGeometry(g.radius, g.halfHeight * 2, 6, 16);
    case "cylinder": return new THREE.CylinderGeometry(g.radius, g.radius, g.halfHeight * 2, 24);
    case "plane": return new THREE.PlaneGeometry(g.width, g.depth).rotateX(-Math.PI / 2);
    case "mesh": {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(g.vertices, 3));
      geo.setIndex(g.indices);
      geo.computeVertexNormals();
      return geo;
    }
  }
}

export function createSceneView(world: World, opts: SceneViewOptions = {}): SceneView {
  const scene = new THREE.Scene();
  if (opts.background !== undefined) scene.background = new THREE.Color(opts.background);
  const fallback = opts.fallbackCamera ?? new THREE.PerspectiveCamera(60, 1, 0.1, 500);
  let camera = fallback;
  let aspect = 1;
  const drawn = new Map<Entity, Drawn[]>();
  const before = new Map<Entity, Pose>();
  const after = new Map<Entity, Pose>();
  const models = new Map<string, Promise<THREE.Object3D>>();
  let disposed = false;

  const buildMesh = (e: Entity, m: z_out<typeof Mesh>): Drawn => {
    const holder = new THREE.Group();
    const inner = new THREE.Group();
    holder.add(inner);
    if (m.offset) inner.position.set(m.offset.x, m.offset.y, m.offset.z);
    if (m.scale) inner.scale.set(m.scale.x, m.scale.y, m.scale.z);
    const shadows = (o: THREE.Object3D) => o.traverse((c) => {
      if (c instanceof THREE.Mesh) { c.castShadow = m.castShadow === true; c.receiveShadow = m.receiveShadow === true; }
    });
    let free = () => {};
    if (m.geometry.type === "model") {
      const asset = m.geometry.asset;
      if (!opts.models) throw new Error(`entity ${e} draws model "${asset}" but the view has no model loader`);
      let p = models.get(asset);
      if (!p) { p = opts.models(asset); models.set(asset, p); }
      p.then((model) => { if (!disposed && holder.parent) { const c = model.clone(true); shadows(c); inner.add(c); } },
        (err: unknown) => console.error(`model "${asset}" failed to load:`, err));
    } else {
      const geo = geometry(m.geometry);
      const mat = new THREE.MeshStandardMaterial({
        color: color(m.material.color),
        ...(m.material.roughness !== undefined ? { roughness: m.material.roughness } : {}),
        ...(m.material.metalness !== undefined ? { metalness: m.material.metalness } : {}),
        ...(m.material.emissive !== undefined ? { emissive: color(m.material.emissive) } : {}),
        ...(m.material.emissiveIntensity !== undefined ? { emissiveIntensity: m.material.emissiveIntensity } : {}),
        ...(m.material.opacity !== undefined && m.material.opacity < 1 ? { transparent: true, opacity: m.material.opacity } : {}),
        ...(m.material.wireframe ? { wireframe: true } : {}),
      });
      const mesh = new THREE.Mesh(geo, mat);
      shadows(mesh);
      inner.add(mesh);
      free = () => { geo.dispose(); mat.dispose(); };
    }
    holder.visible = m.visible;
    return { object: holder, key: "", kind: "mesh", dispose: free };
  };

  const buildLight = (l: z_out<typeof Light>): Drawn => {
    let light: THREE.Light;
    switch (l.type) {
      case "ambient": light = new THREE.AmbientLight(color(l.color), l.intensity); break;
      case "hemisphere": light = new THREE.HemisphereLight(color(l.sky), color(l.ground), l.intensity); break;
      case "directional": {
        const d = new THREE.DirectionalLight(color(l.color), l.intensity);
        if (l.target) d.target.position.set(l.target.x, l.target.y, l.target.z);
        d.castShadow = l.castShadow === true;
        // Three's default shadow area is 10 m across; cover a typical level instead.
        Object.assign(d.shadow.camera, { left: -25, right: 25, top: 25, bottom: -25, far: 100 });
        d.shadow.mapSize.set(2048, 2048);
        scene.add(d.target);
        light = d; break;
      }
      case "point": {
        const p = new THREE.PointLight(color(l.color), l.intensity, l.distance ?? 0);
        p.castShadow = l.castShadow === true;
        light = p; break;
      }
      case "spot": {
        const s = new THREE.SpotLight(color(l.color), l.intensity, l.distance ?? 0, l.angle);
        if (l.target) s.target.position.set(l.target.x, l.target.y, l.target.z);
        s.castShadow = l.castShadow === true;
        scene.add(s.target);
        light = s; break;
      }
    }
    return { object: light, key: "", kind: "light", dispose: () => {
      if (light instanceof THREE.DirectionalLight || light instanceof THREE.SpotLight) scene.remove(light.target);
      light.dispose();
    } };
  };

  const buildCamera = (c: z_out<typeof Camera>): Drawn => {
    const cam = new THREE.PerspectiveCamera(c.fov, aspect, c.near, c.far);
    return { object: cam, key: "", kind: "camera", dispose: () => {} };
  };

  /** Add, rebuild and remove objects to match the components. */
  const reconcile = () => {
    const seen = new Set<Entity>();
    for (const e of world.entities()) {
      const parts: [Drawn["kind"], unknown][] = [];
      const m = world.get(e, Mesh), l = world.get(e, Light), c = world.get(e, Camera);
      if (m) parts.push(["mesh", m]);
      if (l) parts.push(["light", l]);
      if (c) parts.push(["camera", c]);
      if (!parts.length || (!world.has(e, Transform) && !(l && (l.type === "ambient" || l.type === "hemisphere")))) continue;
      seen.add(e);
      const key = canonicalJson(parts);
      const current = drawn.get(e);
      if (current && current[0]?.key === key) continue;
      for (const d of current ?? []) { d.object.removeFromParent(); d.dispose(); }
      const built = parts.map(([kind, v]) => {
        const d = kind === "mesh" ? buildMesh(e, v as z_out<typeof Mesh>) : kind === "light" ? buildLight(v as z_out<typeof Light>) : buildCamera(v as z_out<typeof Camera>);
        d.key = key;
        scene.add(d.object);
        return d;
      });
      drawn.set(e, built);
    }
    for (const [e, ds] of drawn) {
      if (seen.has(e)) continue;
      for (const d of ds) { d.object.removeFromParent(); d.dispose(); }
      drawn.delete(e); before.delete(e); after.delete(e);
    }
  };

  const q1 = new THREE.Quaternion(), q2 = new THREE.Quaternion();
  const place = (e: Entity, alpha: number) => {
    const a = before.get(e) ?? after.get(e), b = after.get(e);
    if (!a || !b) return;
    for (const d of drawn.get(e) ?? []) {
      d.object.position.set(a.position.x + (b.position.x - a.position.x) * alpha,
        a.position.y + (b.position.y - a.position.y) * alpha, a.position.z + (b.position.z - a.position.z) * alpha);
      q1.set(a.rotation.x, a.rotation.y, a.rotation.z, a.rotation.w);
      q2.set(b.rotation.x, b.rotation.y, b.rotation.z, b.rotation.w);
      d.object.quaternion.slerpQuaternions(q1, q2, alpha);
    }
  };

  const view: SceneView = {
    scene,
    get camera() { return camera; },
    capture() {
      for (const e of world.entities()) {
        const p = poseOf(world, e);
        if (!p) continue;
        const prev = after.get(e);
        before.set(e, prev ?? structuredClone(p));
        after.set(e, structuredClone(p));
      }
    },
    sync(alpha = 1) {
      reconcile();
      for (const e of drawn.keys()) {
        if (!after.has(e)) { const p = poseOf(world, e); if (p) { after.set(e, structuredClone(p)); before.set(e, structuredClone(p)); } }
        place(e, Math.min(1, Math.max(0, alpha)));
      }
      camera = fallback;
      for (const [e, c] of world.query(Camera)) {
        if (!c.active) continue;
        const cam = drawn.get(e)?.find((d) => d.kind === "camera")?.object as THREE.PerspectiveCamera | undefined;
        if (!cam) continue;
        if (c.lookAt) cam.lookAt(c.lookAt.x, c.lookAt.y, c.lookAt.z);
        camera = cam;
        break;
      }
      if (camera.aspect !== aspect) { camera.aspect = aspect; camera.updateProjectionMatrix(); }
    },
    objectOf: (e) => drawn.get(e)?.[0]?.object,
    setAspect(a) { aspect = a; },
    dispose() {
      disposed = true;
      for (const ds of drawn.values()) for (const d of ds) { d.object.removeFromParent(); d.dispose(); }
      drawn.clear();
    },
  };
  return view;
}

/** A component's stored value type. */
type z_out<C> = C extends { schema: { _output: infer T } } ? T : never;
