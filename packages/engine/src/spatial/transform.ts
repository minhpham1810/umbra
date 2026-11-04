/** Where an entity is: shared by physics, rendering and game code. */
import { z } from "zod";
import { defineComponent } from "../core/world.js";

const finite = z.number().finite();
export const Vec3 = z.object({ x: finite, y: finite, z: finite });
export type Vec3 = z.infer<typeof Vec3>;
/** A unit quaternion. */
export const Quat = z.object({ x: finite, y: finite, z: finite, w: finite });
export type Quat = z.infer<typeof Quat>;
export const IDENTITY: Quat = { x: 0, y: 0, z: 0, w: 1 };

/** Position and rotation (identity when omitted). Physics writes it for moving bodies. */
export const Transform = defineComponent("transform", z.object({ position: Vec3, rotation: Quat.optional() }));
