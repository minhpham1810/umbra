/**
 * The deterministic world: entities, components, resources and events.
 *
 * - Entities are integers from 1 up, never reused, so ids are the same on every run.
 * - Components and resources are plain JSON data checked by a Zod schema when set. They
 *   may be mutated in place (get() returns the stored value); the state hash covers them.
 * - query() always yields entities in ascending id order.
 * - world.rng is the only randomness a game may use.
 */
import type { z } from "zod";
import { canonicalJson, fnvNumber, fnvStart, fnvString } from "./hash.js";
import { createRng, type Rng } from "./rng.js";

export type Entity = number;

/** A component type. Call it with a value to get an entry for `world.spawn`. */
// The `any` default lets registries hold component types of any value type (they are invariant).
export interface ComponentType<T = any> {
  (value: T): ComponentEntry<T>;
  readonly kind: "component";
  readonly name: string;
  readonly schema: z.ZodType<T, z.ZodTypeDef, unknown>;
}
export interface ComponentEntry<T = any> { readonly type: ComponentType<T>; readonly value: T }

export interface ResourceType<T = unknown> {
  readonly kind: "resource";
  readonly name: string;
  readonly schema: z.ZodType<T, z.ZodTypeDef, unknown>;
  /** Value when a world starts; a factory so each world gets its own copy. */
  readonly initial: () => T;
}

export interface EventType<T = unknown> {
  readonly kind: "event";
  readonly name: string;
  readonly schema: z.ZodType<T, z.ZodTypeDef, unknown>;
}

const NAME = /^[a-z][\w.-]*$/i;
const checkName = (what: string, name: string) => {
  if (!NAME.test(name)) throw new Error(`${what} name "${name}" must start with a letter and use letters, digits, _ . -`);
};

/** Define a component: a named piece of entity data, validated by `schema`. */
export function defineComponent<T>(name: string, schema: z.ZodType<T, z.ZodTypeDef, unknown>): ComponentType<T> {
  checkName("component", name);
  const type = ((value: T) => ({ type, value })) as ComponentType<T>;
  Object.defineProperties(type, {
    kind: { value: "component" }, name: { value: name }, schema: { value: schema },
  });
  return type;
}

/** Define a resource: one value per world (a score, a clock, game settings). */
export function defineResource<T>(name: string, schema: z.ZodType<T, z.ZodTypeDef, unknown>, initial: () => T): ResourceType<T> {
  checkName("resource", name);
  return { kind: "resource", name, schema, initial };
}

/** Define an event: data a system emits during a tick, for later systems and the caller. */
export function defineEvent<T>(name: string, schema: z.ZodType<T, z.ZodTypeDef, unknown>): EventType<T> {
  checkName("event", name);
  return { kind: "event", name, schema };
}

/** An event as recorded: which tick, which type, and its data. */
export interface EmittedEvent { tick: number; type: string; data: unknown }

type Values<Ts extends readonly ComponentType[]> = { [K in keyof Ts]: Ts[K] extends ComponentType<infer T> ? T : never };

/** Plain-data copy of a world's state, for snapshot/restore and checkpoints. */
export interface WorldState {
  tick: number;
  nextEntity: number;
  /** Live entities, ascending (some may have no components). */
  entities: Entity[];
  rng: number[];
  /** component name → [entity, value] pairs, ascending by entity. */
  components: Record<string, [Entity, unknown][]>;
  resources: Record<string, unknown>;
}

export class World {
  /** Ticks completed so far. */
  tick = 0;
  readonly rng: Rng;
  private nextEntity = 1;
  private readonly alive = new Set<Entity>();
  private readonly stores = new Map<string, Map<Entity, unknown>>();
  private readonly types = new Map<string, ComponentType>();
  private readonly resourceValues = new Map<string, unknown>();
  private readonly resourceTypes = new Map<string, ResourceType>();
  private readonly eventTypes = new Map<string, EventType>();
  private tickEvents: EmittedEvent[] = [];

  constructor(opts: { seed: number; components?: readonly ComponentType[]; resources?: readonly ResourceType[]; events?: readonly EventType[] }) {
    this.rng = createRng(opts.seed);
    for (const c of opts.components ?? []) this.register(c);
    for (const r of opts.resources ?? []) {
      const known = this.resourceTypes.get(r.name);
      if (known === r) continue;
      if (known) throw new Error(`two different resources are named "${r.name}"`);
      this.resourceTypes.set(r.name, r);
      this.resourceValues.set(r.name, r.schema.parse(r.initial()));
    }
    for (const e of opts.events ?? []) {
      const known = this.eventTypes.get(e.name);
      if (known === e) continue;
      if (known) throw new Error(`two different events are named "${e.name}"`);
      this.eventTypes.set(e.name, e);
    }
  }

  private register(c: ComponentType) {
    const known = this.types.get(c.name);
    if (known && known !== c) throw new Error(`two different components are named "${c.name}"`);
    if (!known) { this.types.set(c.name, c); this.stores.set(c.name, new Map()); }
  }

  private store(c: ComponentType): Map<Entity, unknown> {
    const s = this.stores.get(c.name);
    if (!s || this.types.get(c.name) !== c) throw new Error(`component "${c.name}" is not registered with this game`);
    return s;
  }

  /** Component type by name, e.g. when loading a scene file. */
  componentType(name: string): ComponentType | undefined { return this.types.get(name); }

  // ── entities ──────────────────────────────────────────────────────────────

  /** Create an entity with the given components; returns its id. */
  spawn(...entries: ComponentEntry[]): Entity {
    const e = this.nextEntity++;
    this.alive.add(e);
    for (const { type, value } of entries) this.set(e, type, value);
    return e;
  }

  /** Remove an entity and all its components. */
  despawn(e: Entity): void {
    if (!this.alive.delete(e)) return;
    for (const s of this.stores.values()) s.delete(e);
  }

  exists(e: Entity): boolean { return this.alive.has(e); }

  /** Every live entity, ascending. */
  entities(): Entity[] { return [...this.alive].sort((a, b) => a - b); }

  // ── components ────────────────────────────────────────────────────────────

  /** Add or replace a component (validated by its schema). */
  set<T>(e: Entity, c: ComponentType<T>, value: T): void {
    if (!this.alive.has(e)) throw new Error(`entity ${e} does not exist`);
    this.store(c).set(e, c.schema.parse(value));
  }

  /** The stored value (mutable in place), or undefined. */
  get<T>(e: Entity, c: ComponentType<T>): T | undefined { return this.store(c).get(e) as T | undefined; }

  has(e: Entity, c: ComponentType): boolean { return this.store(c).has(e); }

  remove(e: Entity, c: ComponentType): void { this.store(c).delete(e); }

  /** Entities with all the given components, ascending by id, with their values. */
  *query<Ts extends readonly ComponentType[]>(...cs: Ts): Generator<[Entity, ...Values<Ts>]> {
    if (!cs.length) throw new Error("query needs at least one component");
    const stores = cs.map((c) => this.store(c));
    const smallest = stores.reduce((a, b) => (b.size < a.size ? b : a));
    // shortcut: sorts the smallest store each call; keep sorted id lists if queries get hot.
    const ids = [...smallest.keys()].sort((a, b) => a - b);
    for (const e of ids) {
      if (!stores.every((s) => s.has(e))) continue;
      yield [e, ...stores.map((s) => s.get(e))] as unknown as [Entity, ...Values<Ts>];
    }
  }

  /** The lowest-id entity with all the given components, or undefined. */
  first<Ts extends readonly ComponentType[]>(...cs: Ts): [Entity, ...Values<Ts>] | undefined {
    for (const row of this.query(...cs)) return row;
    return undefined;
  }

  // ── resources ─────────────────────────────────────────────────────────────

  resource<T>(r: ResourceType<T>): T {
    if (this.resourceTypes.get(r.name) !== r) throw new Error(`resource "${r.name}" is not registered with this game`);
    return this.resourceValues.get(r.name) as T;
  }

  setResource<T>(r: ResourceType<T>, value: T): void {
    if (this.resourceTypes.get(r.name) !== r) throw new Error(`resource "${r.name}" is not registered with this game`);
    this.resourceValues.set(r.name, r.schema.parse(value));
  }

  // ── events ────────────────────────────────────────────────────────────────

  emit<T>(type: EventType<T>, data: T): void {
    if (this.eventTypes.get(type.name) !== type) throw new Error(`event "${type.name}" is not registered with this game`);
    this.tickEvents.push({ tick: this.tick, type: type.name, data: type.schema.parse(data) });
  }

  /** Events of one type emitted so far this tick (by earlier systems). */
  events<T>(type: EventType<T>): T[] {
    return this.tickEvents.filter((e) => e.type === type.name).map((e) => e.data as T);
  }

  /** @internal The runner collects a tick's events and starts the next tick. */
  takeEvents(): EmittedEvent[] { const out = this.tickEvents; this.tickEvents = []; return out; }

  // ── hash and state ────────────────────────────────────────────────────────

  /** Hash of everything that decides future ticks: tick, ids, rng, components, resources. */
  hash(): number {
    let h = fnvNumber(fnvNumber(fnvStart(), this.tick), this.nextEntity);
    for (const v of this.rng.state()) h = fnvNumber(h, v);
    for (const e of this.entities()) h = fnvNumber(h, e);
    for (const name of [...this.stores.keys()].sort()) {
      const s = this.stores.get(name)!;
      if (!s.size) continue;
      h = fnvString(h, name);
      for (const e of [...s.keys()].sort((a, b) => a - b)) h = fnvString(fnvNumber(h, e), canonicalJson(s.get(e)));
    }
    for (const name of [...this.resourceValues.keys()].sort()) h = fnvString(fnvString(h, name), canonicalJson(this.resourceValues.get(name)));
    return h >>> 0;
  }

  /** A deep, plain-data copy of the state. */
  save(): WorldState {
    const components: WorldState["components"] = {};
    for (const [name, s] of this.stores) {
      if (s.size) components[name] = [...s.entries()].sort((a, b) => a[0] - b[0]).map(([e, v]) => [e, structuredClone(v)]);
    }
    return { tick: this.tick, nextEntity: this.nextEntity, entities: this.entities(), rng: this.rng.state(), components,
      resources: Object.fromEntries([...this.resourceValues].map(([k, v]) => [k, structuredClone(v)])) };
  }

  /** Replace the state with a copy of `state` (from save()). Pending events are dropped. */
  load(state: WorldState): void {
    this.tick = state.tick;
    this.nextEntity = state.nextEntity;
    this.rng.setState(state.rng);
    this.alive.clear();
    for (const e of state.entities) this.alive.add(e);
    for (const s of this.stores.values()) s.clear();
    for (const [name, pairs] of Object.entries(state.components)) {
      const type = this.types.get(name);
      if (!type) throw new Error(`saved state has unknown component "${name}"`);
      for (const [e, v] of pairs) {
        if (!this.alive.has(e)) throw new Error(`saved state has component "${name}" on missing entity ${e}`);
        this.stores.get(name)!.set(e, type.schema.parse(structuredClone(v)));
      }
    }
    for (const [name, v] of Object.entries(state.resources)) {
      const r = this.resourceTypes.get(name);
      if (!r) throw new Error(`saved state has unknown resource "${name}"`);
      this.resourceValues.set(name, r.schema.parse(structuredClone(v)));
    }
    this.tickEvents = [];
  }
}
