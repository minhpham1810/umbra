/**
 * Device input for a game loop: keys, mouse buttons, pointer movement and gamepads.
 * Edges ("pressed this tick") and pointer deltas collect between ticks; the loop calls
 * endTick() after each tick reads them, so a press shorter than a tick is never lost.
 */

/** Something that dispatches DOM-style input events (window, a canvas, or a test double). */
export interface InputTarget {
  addEventListener(type: string, listener: (event: Event) => void, options?: AddEventListenerOptions): void;
}

export interface PointerState {
  /** Position in CSS pixels relative to the target (last known). */
  x: number;
  y: number;
  /** Movement since the last tick (works under pointer lock). */
  dx: number;
  dy: number;
  /** Pressed buttons: bit 0 primary, 1 secondary, 2 middle. */
  buttons: number;
}

export interface InputState {
  /** Held now. Keys use KeyboardEvent.code ("KeyW", "Space", "ArrowLeft"); mouse buttons are "Mouse0"–"Mouse2". */
  down(code: string): boolean;
  /** Went down since the last tick. */
  pressed(code: string): boolean;
  /** Went up since the last tick. */
  released(code: string): boolean;
  readonly pointer: PointerState;
  /** A connected gamepad, or undefined. Polled when read. */
  gamepad(index?: number): Gamepad | undefined;
  /** Called by the loop after each tick: clears edges and deltas. */
  endTick(): void;
  /** Forget everything held (e.g. when the window loses focus). */
  clear(): void;
  dispose(): void;
}

/** Keys the browser would otherwise act on (scrolling, page find). */
const CLAIMED = new Set(["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Tab", "Slash", "Quote"]);

export function createInput(target: InputTarget = globalThis as unknown as InputTarget, opts: { preventDefaults?: boolean } = {}): InputState {
  const held = new Set<string>(), pressed = new Set<string>(), released = new Set<string>();
  const pointer: PointerState = { x: 0, y: 0, dx: 0, dy: 0, buttons: 0 };
  const abort = new AbortController();
  const on = (type: string, fn: (e: Event) => void) => target.addEventListener(type, fn, { signal: abort.signal });
  const press = (code: string) => { if (!held.has(code)) { held.add(code); pressed.add(code); } };
  const release = (code: string) => { if (held.delete(code)) released.add(code); };
  const clear = () => { for (const c of held) released.add(c); held.clear(); pointer.buttons = 0; };

  on("keydown", (e) => {
    const k = e as KeyboardEvent;
    if (opts.preventDefaults !== false && CLAIMED.has(k.code) && !(k.target instanceof Element && k.target.closest("input, textarea, select, button"))) k.preventDefault();
    press(k.code);
  });
  on("keyup", (e) => release((e as KeyboardEvent).code));
  on("blur", clear);
  on("pointerdown", (e) => { const p = e as PointerEvent; press(`Mouse${p.button}`); pointer.buttons = p.buttons; });
  on("pointerup", (e) => { const p = e as PointerEvent; release(`Mouse${p.button}`); pointer.buttons = p.buttons; });
  on("pointermove", (e) => {
    const p = e as PointerEvent;
    pointer.x = p.offsetX ?? p.clientX; pointer.y = p.offsetY ?? p.clientY;
    pointer.dx += p.movementX ?? 0; pointer.dy += p.movementY ?? 0;
  });

  return {
    down: (c) => held.has(c),
    pressed: (c) => pressed.has(c),
    released: (c) => released.has(c),
    pointer,
    gamepad(i = 0) {
      const pads = typeof navigator !== "undefined" && navigator.getGamepads ? navigator.getGamepads() : [];
      return pads[i] ?? undefined;
    },
    endTick() { pressed.clear(); released.clear(); pointer.dx = 0; pointer.dy = 0; },
    clear,
    dispose() { abort.abort(); },
  };
}
