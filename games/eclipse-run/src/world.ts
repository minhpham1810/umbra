import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { Chapter } from './levels.js';
type Vec = {x:number;y:number;z:number};
const mat = (color: THREE.ColorRepresentation, emissive?: THREE.ColorRepresentation) => new THREE.MeshStandardMaterial({color,roughness:.86,...(emissive ? {emissive,emissiveIntensity:.7} : {})});
const assets = new Map<string, THREE.Object3D>();
export async function loadAssets() {
  const loader = new GLTFLoader();
  await Promise.all(['tree','rock','bush'].map(async name => {
    try { const model = await loader.loadAsync(`/assets/${name}.glb`); assets.set(name,model.scene); }
    catch { /* The game remains playable if a decorative asset cannot load. */ }
  }));
}
export function createView(canvas: HTMLCanvasElement) {
  const renderer = new THREE.WebGLRenderer({canvas,antialias:true,alpha:true});
  renderer.setPixelRatio(Math.min(devicePixelRatio,1.75));
  renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
  renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.25;
  const scene = new THREE.Scene();
  scene.background=new THREE.Color('#20152f');scene.fog=new THREE.FogExp2('#20152f',.013);
  scene.add(new THREE.HemisphereLight('#dcc5ff','#2b1445',2.5));
  const sun = new THREE.DirectionalLight('#f4dbff',3.5);sun.position.set(-10,22,14);sun.castShadow=true;
  sun.shadow.mapSize.set(2048,2048);sun.shadow.camera.left=-30;sun.shadow.camera.right=30;sun.shadow.camera.top=40;sun.shadow.camera.bottom=-40;sun.shadow.normalBias=.04;scene.add(sun,sun.target);
  const rim = new THREE.DirectionalLight('#8a6bf6',3);rim.position.set(7,8,-16);scene.add(rim);
  const camera = new THREE.OrthographicCamera(-15,15,10,-10,.1,150);
  const root = new THREE.Group();scene.add(root);
  const starsGeometry = new THREE.BufferGeometry();const starPositions=[];
  for(let i=0;i<220;i++)starPositions.push(Math.sin(i*76.31)*65,2+(Math.sin(i*15.7)+1)*20,Math.cos(i*13.17)*65);
  starsGeometry.setAttribute('position',new THREE.Float32BufferAttribute(starPositions,3));
  const stars=new THREE.Points(starsGeometry,new THREE.PointsMaterial({color:'#dfc6ff',size:.055,transparent:true,opacity:.65}));scene.add(stars);
  const moon = new THREE.Group();
  const moonRing=new THREE.Mesh(new THREE.TorusGeometry(3.3,.035,8,96),new THREE.MeshBasicMaterial({color:'#826299',transparent:true,opacity:.45}));moon.add(moonRing);
  const crescent=new THREE.Mesh(new THREE.TorusGeometry(2.8,.1,8,80,Math.PI*1.65),new THREE.MeshBasicMaterial({color:'#b195ce',transparent:true,opacity:.55}));crescent.rotation.z=-.9;moon.add(crescent);moon.position.set(11,10,-18);scene.add(moon);
  let stage:Chapter;let player:THREE.Group;let lamp:THREE.PointLight;let portal:THREE.Group;
  let platforms:THREE.Group[]=[];let gems=new Map<string,THREE.Group>();
  const effects:{mesh:THREE.Mesh;v:THREE.Vector3;life:number}[]=[];
  const follow=new THREE.Vector3();let initialized=false;
  const cube=new THREE.BoxGeometry(1,1,1);
  const jewelGeometry=new THREE.OctahedronGeometry(.23,0);
  const effectGeometry=new THREE.OctahedronGeometry(.055,0);
  const effectMaterial=new THREE.MeshBasicMaterial({color:'#ecd3ff'});
  function mesh(geo:THREE.BufferGeometry,material:THREE.Material,x=0,y=0,z=0,parent:THREE.Object3D=root) {
    const m=new THREE.Mesh(geo,material);m.position.set(x,y,z);m.castShadow=true;m.receiveShadow=true;parent.add(m);return m;
  }
  function decor(name:string,x:number,y:number,z:number,scale:number) {
    const original=assets.get(name);if(!original)return;
    const object=original.clone(true);const bounds=new THREE.Box3().setFromObject(object);const size=bounds.getSize(new THREE.Vector3());
    object.scale.setScalar(scale/Math.max(size.y,.01));object.position.set(x,y-bounds.min.y*object.scale.x,z);
    object.traverse(child=>{if(child instanceof THREE.Mesh){child.castShadow=true;child.receiveShadow=true;const source=Array.isArray(child.material)?child.material[0]:child.material;child.material=source.clone();child.material.color?.lerp(new THREE.Color(name==='tree'?'#9980bd':name==='bush'?'#ada2ca':'#87748f'),.7);}});
    root.add(object);
  }
  function disposeRoot() {
    const geometries=new Set<THREE.BufferGeometry>();const materials=new Set<THREE.Material>();
    root.traverse(obj=>{if(obj instanceof THREE.Mesh){if(![cube,jewelGeometry,effectGeometry].includes(obj.geometry))geometries.add(obj.geometry);for(const m of Array.isArray(obj.material)?obj.material:[obj.material]) if(m!==effectMaterial) materials.add(m);}});
    // Loaded model geometries are shared by clones and kept for future chapters.
    for(const original of assets.values()) original.traverse(o=>{if(o instanceof THREE.Mesh)geometries.delete(o.geometry);});
    geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());root.clear();effects.length=0;
  }
  function load(chapter:Chapter) {
    disposeRoot();stage=chapter;platforms=[];gems=new Map();initialized=false;
    const tiles=chapter.scene.pieces.filter(p=>p.kind==='floor');
    const tileKeys=new Set(tiles.map(p=>`${p.pos.x},${p.pos.z},${p.pos.y}`));
    const stone=mat('#655875'),stoneAlt=mat('#716280'),top=mat('#94829f');
    const edge=mat('#b59bbf');const underside=mat('#43354f');
    for(const [i,p]of tiles.entries()){
      const{x,y,z}=p.pos;const block=mesh(cube,i%5===0?stoneAlt:stone,x+.5,y+.45,z+.5);block.scale.set(1,.9,1);
      const cap=mesh(cube,top,x+.5,y+.96,z+.5);cap.scale.set(.98,.08,.98);
      const exposed=!tileKeys.has(`${x-1},${z},${y}`)||!tileKeys.has(`${x+1},${z},${y}`)||!tileKeys.has(`${x},${z-1},${y}`)||!tileKeys.has(`${x},${z+1},${y}`);
      if(exposed){
        const depth=1.2+(Math.sin(x*9+z*4)+1)*.8;const rock=mesh(new THREE.ConeGeometry(.72,depth,4),underside,x+.5,y-depth/2+.1,z+.5);rock.rotation.z=Math.PI;rock.rotation.y=Math.PI/4;
        if(i%3===0){const trim=mesh(cube,edge,x+.5,y+.82,z+.5);trim.scale.set(1.01,.08,1.01);}
      }
      // Decorative objects sit at the rim, leaving the central routes legible.
      if(exposed&&i%11===0){
        const away=chapter.scene.goals.every(g=>Math.hypot(g.pos.x-x,g.pos.z-z)>1.8)&&Math.hypot(chapter.scene.spawn.pos.x-x,chapter.scene.spawn.pos.z-z)>2;
        if(away)decor(i%2?'tree':'rock',x+.5,y+1,z+.5,i%2?1.7:.5);
      }
      if(exposed&&i%17===0)decor('bush',x+.7,y+1,z+.6,.3);
    }
    // Small floating satellites create depth without resembling playable paths.
    for(let i=0;i<12;i++){
      const x=(i%2?-1:1)*(7+(i%4)*2);const z=i*3-8;
      const rock=mesh(new THREE.IcosahedronGeometry(.6+(i%3)*.3,0),underside,x,-3-i%4,z);rock.scale.y=1.8;rock.rotation.z=i;
    }
    const platformMat=mat('#89b4c9','#3b647a');
    chapter.scene.pieces.filter(p=>p.kind==='moving_platform').sort((a,b)=>a.pos.x-b.pos.x||a.pos.y-b.pos.y||a.pos.z-b.pos.z).forEach(()=>{
      const group=new THREE.Group();root.add(group);const slab=mesh(cube,platformMat,0,0,0,group);slab.scale.set(1,.25,1);
      const band=mesh(cube,mat('#c3efff','#82d6ed'),0,.13,0,group);band.scale.set(.9,.025,.9);platforms.push(group);
    });
    if(platforms.length){
      for(const z of [12.15,5.85]){const marker=mesh(new THREE.TorusGeometry(.35,.025,5,32),mat('#bceeff','#83dcff'),.5,1.035,z);marker.rotation.x=-Math.PI/2;}
    }
    for(const goal of chapter.scene.goals){
      const group=new THREE.Group();group.position.set(goal.pos.x+.5,goal.pos.y+.5,goal.pos.z+.5);root.add(group);
      if(goal.kind==='exit'){
        portal=group;group.position.y=goal.pos.y+1.05;
        const stoneRing=mesh(new THREE.TorusGeometry(.85,.17,5,14),mat('#a08cb6'),0,0,0,group);
        stoneRing.rotation.z=Math.PI/14;
        mesh(new THREE.TorusGeometry(.7,.025,6,64),mat(chapter.color,chapter.color),0,0,.13,group);
        const membrane=mesh(new THREE.CircleGeometry(.69,48),new THREE.MeshBasicMaterial({color:chapter.color,transparent:true,opacity:.13,side:THREE.DoubleSide}),0,0,0,group);membrane.name='membrane';
        const base=mesh(cube,stoneAlt,0,-.9,0,group);base.scale.set(2,.3,1.3);
        const light=new THREE.PointLight(chapter.color,10,7);group.add(light);
      }else{
        mesh(jewelGeometry,mat('#fff0c9','#ffdaa1'),0,0,0,group);
        const halo=mesh(new THREE.TorusGeometry(.37,.012,4,32),mat('#d1a6e8','#b499d9'),0,0,0,group);halo.rotation.x=.5;
        const light=new THREE.PointLight('#ffdab5',1.5,3);group.add(light);gems.set(goal.id,group);
      }
    }
    player=new THREE.Group();root.add(player);
    const robe=mesh(new THREE.ConeGeometry(.33,.72,7),mat('#e6daf3'),0,-.25,0,player);robe.rotation.y=Math.PI/7;
    mesh(new THREE.SphereGeometry(.29,16,12),mat('#f7edf9'),0,.22,0,player);
    const face=mesh(new THREE.SphereGeometry(.21,12,8),mat('#3e2e54'),0,.22,.16,player);face.scale.set(1,.65,.45);
    for(const x of [-.07,.07])mesh(new THREE.SphereGeometry(.025,6,6),new THREE.MeshBasicMaterial({color:'#f8e8ff'}),x,.22,.258,player);
    const scarf=mesh(new THREE.TorusGeometry(.24,.07,4,12),mat('#b394e4'),0,-.015,0,player);scarf.rotation.x=Math.PI/2;
    const lantern=mesh(new THREE.OctahedronGeometry(.13,0),mat('#ffebbb','#ffd092'),.37,-.08,.1,player);
    const ring=mesh(new THREE.TorusGeometry(.16,.025,4,12),mat('#967246'),.37,-.08,.1,player);ring.rotation.y=Math.PI/2;
    lantern.name='lantern';lamp=new THREE.PointLight('#f6c7a1',6,5);lamp.position.set(0,.3,0);player.add(lamp);
    player.position.copy(chapter.scene.spawn.pos);
  }
  function burst(position:Vec) {
    for(let i=0;i<16;i++){
      const m=mesh(effectGeometry,effectMaterial,position.x,position.y,position.z);m.castShadow=false;
      effects.push({mesh:m,v:new THREE.Vector3(Math.sin(i*8)*1.8,1+(i%4)*.4,Math.cos(i*8)*1.8),life:1});
    }
  }
  function collect(id:string){const g=gems.get(id);if(g&&g.visible){g.visible=false;burst(g.position);}}
  let width=0,height=0;
  function render(pos:Vec,platformPositions:Vec[],time:number,delta:number,home:boolean,moving:boolean,direction:number,reduced:boolean){
    if(width!==innerWidth||height!==innerHeight){width=innerWidth;height=innerHeight;renderer.setSize(width,height,false);}
    const aspect=width/height;const size=home?14:(aspect<1?12:10);camera.left=-size*aspect;camera.right=size*aspect;camera.top=size;camera.bottom=-size;camera.updateProjectionMatrix();
    player.position.set(pos.x,pos.y+(moving&&!reduced?Math.sin(time*15)*.035:0),pos.z);
    if(moving)player.rotation.y=direction;
    lamp.intensity=6+(reduced?0:Math.sin(time*3)*.4);
    platforms.forEach((p,i)=>{if(platformPositions[i])p.position.copy(platformPositions[i]!);});
    gems.forEach((g,id)=>{const original=stage.scene.goals.find(goal=>goal.id===id)!;if(!reduced){g.rotation.y=time*.8;g.position.y=original.pos.y+.65+Math.sin(time*2+original.pos.z)*.12;}});
    if(portal&&!reduced){const membrane=portal.getObjectByName('membrane') as THREE.Mesh;const material=membrane.material as THREE.MeshBasicMaterial;material.opacity=.12+Math.sin(time*2)*.04;}
    for(let i=effects.length-1;i>=0;i--){const e=effects[i]!;e.life-=delta;e.mesh.position.addScaledVector(e.v,delta);e.mesh.scale.setScalar(Math.max(0,e.life));if(e.life<=0){root.remove(e.mesh);effects.splice(i,1);}}
    const target=home?new THREE.Vector3(-8,0,7):new THREE.Vector3(pos.x,Math.max(0,pos.y-1.7),pos.z-3);
    if(!initialized){follow.copy(target);initialized=true;}else follow.lerp(target,1-Math.exp(-delta*6));
    if(home){camera.position.set(follow.x+12,19,follow.z+23);camera.lookAt(follow.x,0,follow.z);}else {camera.position.set(follow.x,follow.y+15,follow.z+18);camera.lookAt(follow);}
    moon.position.set(home?10:pos.x+10,12,home?-12:pos.z-26);
    sun.position.set(follow.x-10,25,follow.z+10);sun.target.position.copy(follow);
    if(!reduced)stars.rotation.y=time*.002;
    renderer.render(scene,camera);
  }
  function dispose(){disposeRoot();cube.dispose();jewelGeometry.dispose();effectGeometry.dispose();effectMaterial.dispose();starsGeometry.dispose();renderer.dispose();}
  return{load,render,collect,burst,dispose};
}
