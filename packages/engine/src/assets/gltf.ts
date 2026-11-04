/**
 * Triangles from a glTF 2.0 model (.glb, or .gltf JSON), for colliders and navigation.
 *
 * Pure JavaScript with no renderer, so a headless run builds the same collider from the
 * same file the browser draws: pass the bytes to gltfTriangles, and the result straight to
 * a mesh Collider or navBakeTriangles. Node transforms are applied (the model's own space,
 * as drawn at an identity Transform). Arithmetic is plain IEEE doubles, so every machine
 * gets the same numbers.
 */

export interface Triangles { vertices: number[]; indices: number[] }

export interface GltfOptions {
  /** Bytes of an external buffer (a .gltf's "scene.bin"); data: URIs and .glb need none. */
  buffer?(uri: string): Uint8Array;
  /** Only this node (by name) and its children, e.g. a simplified "collision" mesh. */
  node?: string;
}

interface Json {
  scene?: number;
  scenes?: { nodes?: number[] }[];
  nodes?: { name?: string; mesh?: number; children?: number[]; matrix?: number[]; translation?: number[]; rotation?: number[]; scale?: number[] }[];
  meshes?: { primitives: { attributes: Record<string, number>; indices?: number; mode?: number }[] }[];
  accessors?: { bufferView?: number; byteOffset?: number; componentType: number; count: number; type: string; sparse?: unknown }[];
  bufferViews?: { buffer: number; byteOffset?: number; byteLength: number; byteStride?: number }[];
  buffers?: { uri?: string; byteLength: number }[];
  extensionsRequired?: string[];
}

const SIZE: Record<number, number> = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const WIDTH: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** Read a model's triangles. Throws on files it cannot read exactly (compressed or sparse data). */
export function gltfTriangles(data: ArrayBuffer | Uint8Array, opts: GltfOptions = {}): Triangles {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const { json, bin } = split(bytes);
  for (const ext of json.extensionsRequired ?? []) throw new Error(`glTF needs extension ${ext}, which gltfTriangles cannot read`);
  const buffers = (json.buffers ?? []).map((b, i) => {
    if (b.uri === undefined) { if (i === 0 && bin) return bin; throw new Error(`glTF buffer ${i} has no data`); }
    if (b.uri.startsWith("data:")) return base64(b.uri.slice(b.uri.indexOf(",") + 1));
    if (!opts.buffer) throw new Error(`glTF buffer "${b.uri}" is external: pass opts.buffer to supply its bytes`);
    return opts.buffer(b.uri);
  });

  const read = (index: number): number[] => {
    const a = json.accessors?.[index];
    if (!a) throw new Error(`glTF accessor ${index} is missing`);
    if (a.sparse) throw new Error("sparse glTF accessors are not supported");
    const width = WIDTH[a.type]!, size = SIZE[a.componentType]!;
    const out = new Array<number>(a.count * width).fill(0);
    if (a.bufferView === undefined) return out;
    const v = json.bufferViews![a.bufferView]!;
    const buf = buffers[v.buffer]!;
    const view = new DataView(buf.buffer, buf.byteOffset + (v.byteOffset ?? 0) + (a.byteOffset ?? 0));
    const stride = v.byteStride ?? width * size;
    for (let i = 0; i < a.count; i++) for (let k = 0; k < width; k++) {
      const at = i * stride + k * size;
      out[i * width + k] = a.componentType === 5126 ? view.getFloat32(at, true) : a.componentType === 5125 ? view.getUint32(at, true)
        : a.componentType === 5123 ? view.getUint16(at, true) : a.componentType === 5122 ? view.getInt16(at, true)
        : a.componentType === 5121 ? view.getUint8(at) : view.getInt8(at);
    }
    return out;
  };

  const vertices: number[] = [], indices: number[] = [];
  const visit = (n: number, parent: number[], include: boolean) => {
    const node = json.nodes?.[n];
    if (!node) throw new Error(`glTF node ${n} is missing`);
    const m = mul(parent, local(node));
    const on = include || node.name === opts.node;
    if (on && node.mesh !== undefined) {
      const flip = det3(m) < 0; // mirrored nodes reverse winding
      for (const p of json.meshes![node.mesh]!.primitives) {
        const mode = p.mode ?? 4;
        if (mode < 4) continue; // points and lines have no surface
        if (mode !== 4) throw new Error("glTF triangle strips and fans are not supported; export plain triangles");
        const pos = read(p.attributes.POSITION!);
        const base = vertices.length / 3;
        for (let i = 0; i < pos.length; i += 3) {
          const [x, y, z] = [pos[i]!, pos[i + 1]!, pos[i + 2]!];
          vertices.push(m[0]! * x + m[4]! * y + m[8]! * z + m[12]!, m[1]! * x + m[5]! * y + m[9]! * z + m[13]!, m[2]! * x + m[6]! * y + m[10]! * z + m[14]!);
        }
        const idx = p.indices !== undefined ? read(p.indices) : Array.from({ length: pos.length / 3 }, (_, i) => i);
        for (let i = 0; i + 2 < idx.length; i += 3) indices.push(base + idx[i]!, base + idx[i + (flip ? 2 : 1)]!, base + idx[i + (flip ? 1 : 2)]!);
      }
    }
    for (const c of node.children ?? []) visit(c, m, on);
  };
  const roots = json.scenes?.[json.scene ?? 0]?.nodes ?? (json.nodes ?? []).map((_, i) => i);
  for (const r of roots) visit(r, IDENTITY, opts.node === undefined);
  if (opts.node !== undefined && !json.nodes?.some((n) => n.name === opts.node)) throw new Error(`glTF has no node named "${opts.node}"`);
  return { vertices, indices };
}

function split(bytes: Uint8Array): { json: Json; bin?: Uint8Array } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 12 || view.getUint32(0, true) !== 0x46546c67) return { json: JSON.parse(new TextDecoder().decode(bytes)) as Json };
  let json: Json | undefined, bin: Uint8Array | undefined;
  for (let at = 12; at + 8 <= bytes.byteLength;) {
    const len = view.getUint32(at, true), type = view.getUint32(at + 4, true);
    const chunk = bytes.subarray(at + 8, at + 8 + len);
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(chunk)) as Json;
    else if (type === 0x004e4942) bin = chunk;
    at += 8 + len;
  }
  if (!json) throw new Error("glb file has no JSON chunk");
  return { json, ...(bin ? { bin } : {}) };
}

function base64(s: string): Uint8Array {
  const raw = atob(s);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** A node's local matrix (column-major), from `matrix` or translation/rotation/scale. */
function local(n: NonNullable<Json["nodes"]>[number]): number[] {
  if (n.matrix) return n.matrix;
  const [tx, ty, tz] = n.translation ?? [0, 0, 0];
  const [x, y, z, w] = n.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = n.scale ?? [1, 1, 1];
  return [
    (1 - 2 * (y! * y! + z! * z!)) * sx!, 2 * (x! * y! + z! * w!) * sx!, 2 * (x! * z! - y! * w!) * sx!, 0,
    2 * (x! * y! - z! * w!) * sy!, (1 - 2 * (x! * x! + z! * z!)) * sy!, 2 * (y! * z! + x! * w!) * sy!, 0,
    2 * (x! * z! + y! * w!) * sz!, 2 * (y! * z! - x! * w!) * sz!, (1 - 2 * (x! * x! + y! * y!)) * sz!, 0,
    tx!, ty!, tz!, 1,
  ];
}

function mul(a: number[], b: number[]): number[] {
  const out = new Array<number>(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    out[c * 4 + r] = a[r]! * b[c * 4]! + a[4 + r]! * b[c * 4 + 1]! + a[8 + r]! * b[c * 4 + 2]! + a[12 + r]! * b[c * 4 + 3]!;
  }
  return out;
}

const det3 = (m: number[]) => m[0]! * (m[5]! * m[10]! - m[9]! * m[6]!) - m[4]! * (m[1]! * m[10]! - m[9]! * m[2]!) + m[8]! * (m[1]! * m[6]! - m[5]! * m[2]!);
