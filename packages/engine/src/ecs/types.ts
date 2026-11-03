/** Entity is just an integer ID. */
export type EntityId = number & { readonly __brand: "EntityId" };

export function mkEntity(id: number): EntityId {
  return id as EntityId;
}

/** Component kinds — add new ones here as the engine grows. */
export type ComponentKind =
  | "transform"
  | "rigidbody"
  | "collider"
  | "player"
  | "health"
  | "trigger"
  | "navagent"
  | "pickup"
  | "goal";

/** A typed component record — concrete shapes live in their own files. */
export interface ComponentBase {
  readonly kind: ComponentKind;
}

/** World holds all entities and their components. */
export interface World {
  entities: Set<EntityId>;
  components: Map<EntityId, Map<ComponentKind, ComponentBase>>;
  /** Monotonically increasing tick counter. */
  tick: number;
}

export function createWorld(): World {
  return { entities: new Set(), components: new Map(), tick: 0 };
}

export function addComponent<C extends ComponentBase>(
  world: World,
  entity: EntityId,
  component: C,
): void {
  if (!world.components.has(entity)) {
    world.components.set(entity, new Map());
  }
  world.components.get(entity)!.set(component.kind, component);
}

export function getComponent<C extends ComponentBase>(
  world: World,
  entity: EntityId,
  kind: ComponentKind,
): C | undefined {
  return world.components.get(entity)?.get(kind) as C | undefined;
}

export function removeEntity(world: World, entity: EntityId): void {
  world.entities.delete(entity);
  world.components.delete(entity);
}
