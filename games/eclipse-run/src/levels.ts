import { SceneSchema, type KitPiece, type Scene } from '@umbra/engine';
export interface RoutePoint { x: number; z: number; jump?: boolean; goal?: string; rideUntil?: number }
export interface Chapter { name: string; subtitle: string; hint: string; color: string; par: number; scene: Scene; route: RoutePoint[] }
const point = (x: number, z: number, goal?: string, jump = false): RoutePoint => ({x:x+.5,z:z+.5,jump,...(goal ? {goal} : {})});
function make(name: string, subtitle: string, hint: string, color: string, par: number,
  rects: number[][], spawn: number[], gems: number[][], exit: number[], route: RoutePoint[], ferry?: number[]): Chapter {
  const pieces: KitPiece[] = [];
  const occupied = new Set<string>();
  for (const [x1,x2,z1,z2,y=0] of rects) for (let x=x1!;x<=x2!;x++) for(let z=z1!;z<=z2!;z++) {
    const key=`${x},${y},${z}`; if(occupied.has(key)) continue; occupied.add(key);
    pieces.push({kind:'floor',pos:{x,y,z},rot:0});
  }
  if(ferry) for(let x=-1;x<=1;x++) pieces.push({kind:'moving_platform',pos:{x,y:0,z:ferry[0]!},rot:0,props:{axis:'z',distance:ferry[1]!,speed:2}});
  return {name,subtitle,hint,color,par,route,scene:SceneSchema.parse({
    pieces,spawn:{pos:{x:spawn[0]!+.5,y:spawn[2]??1.75,z:spawn[1]!+.5},yaw:128},
    goals:[...gems.map(([x,z,y=1],i)=>({id:`shard-${i}`,kind:'key',pos:{x,y,z}})),{id:'portal',kind:'exit',pos:{x:exit[0],y:exit[2]??1,z:exit[1]}}],
    meta:{name},
  })};
}
export const levels: Chapter[] = [
  make('The Awakening','A spark in the silence.','Move with WASD or arrows. Hold Space to jump across the breaks.','#a994ff',45,
    [[-2,2,12,18],[-2,2,5,9],[-2,2,-3,2]],[0,17],[[0,15],[0,7],[0,0]],[0,-2],
    [point(0,15,'shard-0'),point(0,12),point(0,7,'shard-1',true),point(0,5),point(0,0,'shard-2',true),point(0,-2,'portal')]),
  make('The Moon Garden','Follow what still remembers the light.','Follow the winding path. Jump onto the raised final garden.','#a7e8cd',60,
    [[-2,2,12,18],[1,7,10,12],[5,9,4,10],[-3,5,2,4],[-4,0,-4,2,1]],[0,17],[[0,14],[7,6],[-2,-1,2]],[-2,-3,2],
    [point(0,14,'shard-0'),point(1,12),point(6,11),point(7,6,'shard-1'),point(6,4),point(2,3),point(-2,3),point(-2,-1,'shard-2',true),point(-2,-3,'portal')]),
  make('The Quiet Crossing','Trust the things that move in the dark.','Wait on the glowing dock. Board the ferry, stay still, then step off at the far bank.','#83d9f7',65,
    [[-2,2,12,18],[-2,2,-4,5]],[0,17],[[0,15],[0,3],[0,-1]],[0,-3],
    [point(0,15,'shard-0'),point(0,12),{x:.5,z:12.5,rideUntil:5.5},point(0,3,'shard-1'),point(0,-1,'shard-2'),point(0,-3,'portal')],[6,5]),
  make('The Broken Stair','Every small light is a way forward.','Take your time. Line up each jump before crossing to the next island.','#ffc78d',65,
    [[-2,2,13,18],[0,4,7,10,1],[-2,2,1,4,1],[-4,0,-5,-2,2]],[0,17],[[0,15],[2,8,2],[0,2,2]],[-2,-4,3],
    [point(0,15,'shard-0'),point(1,13),point(2,8,'shard-1',true),point(1,7),point(0,2,'shard-2',true),point(-1,1),point(-2,-4,'portal',true)]),
  make('The Last Light','Bring the constellation home.','One last journey: cross the broken path, ride the ferry, restore the final light.','#ffb6e3',90,
    [[-2,2,20,25],[-2,2,12,17],[-2,2,-1,5],[0,5,-3,-1],[3,7,-8,-3,1]],[0,24],[[0,22],[0,14],[5,-5,2]],[5,-7,2],
    [point(0,22,'shard-0'),point(0,20),point(0,14,'shard-1',true),point(0,12),{x:.5,z:12.5,rideUntil:5.5},point(0,2),point(1,-1),point(4,-2),point(5,-5,'shard-2',true),point(5,-7,'portal')],[6,5]),
];
