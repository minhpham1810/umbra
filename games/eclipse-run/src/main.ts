import './style.css';
import { BUTTON, FIXED_DT, createSimulation } from '@umbra/engine';
import { levels } from './levels.js';
import { parseProgress, recordWin, formatTime } from './progress.js';
import { createView, loadAssets } from './world.js';
import { createAudio } from './audio.js';
import { watchPageLifecycle } from './lifecycle.js';
import * as THREE from 'three';
const $=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
const audio=createAudio();
const storageKey='umbra.eclipse-run.v1';
let progress=parseProgress(null);
try{progress=parseProgress(localStorage.getItem(storageKey));}catch{/* Private browsing can disable storage. */}
let mode:'home'|'playing'|'paused'|'won'|'lost'|'loading'|'error'='loading';
let chapter=0,deaths=0,eventCount=0,stageTicks=0;
let sim:Awaited<ReturnType<typeof createSimulation>>;
let view:ReturnType<typeof createView>;
let closed=false;let toastTimeout=0;let frameId=0;
const keys=new Set<string>();const pointers=new Map<number,string>();
const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
const current=new THREE.Vector3(),previous=new THREE.Vector3();
let platformNow:{x:number;y:number;z:number}[]=[],platformPrevious=platformNow;
let accumulator=0,lastTime=performance.now(),direction=0;
let returnMode:'home'|'paused'='home';
function toast(message:string){$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toastTimeout);toastTimeout=window.setTimeout(()=>$('toast').hidden=true,3500);}
function clearInput(){keys.clear();pointers.clear();accumulator=0;}
function hideModal(){$('modal').hidden=true;clearInput();}
function showModal(content:string,close=true){clearInput();$('modal-content').innerHTML=content;$('close').hidden=!close;$('modal').hidden=false;requestAnimationFrame(()=>{const first=$('modal').querySelector<HTMLButtonElement>('button:not([hidden]):not(:disabled)');first?.focus();});}
function menuTitle(eyebrow:string,title:string,description=''){return `<div class="eyebrow">${eyebrow}</div><h2 id="modal-title">${title}</h2>${description?`<p>${description}</p>`:''}`;}
function updateHome(){const complete=Object.keys(progress.best).length===5;$('play').innerHTML=`${complete?'Journey again':progress.unlocked>0?'Continue the journey':'Begin the journey'} <span>↗</span>`;}
function save(){try{localStorage.setItem(storageKey,JSON.stringify(progress));}catch{toast('Progress could not be saved on this device. You can still keep playing.');}}
async function loadChapter(index:number,playing=true,retry=false){
  if(mode==='loading'&&sim)return;
  mode='loading';clearInput();hideModal();$('loading').hidden=false;
  try{
    const level=levels[index]!;const next=await createSimulation(level.scene);
    if(closed){next.dispose();return;}
    sim?.dispose();sim=next;chapter=index;if(!retry)deaths=0;stageTicks=0;eventCount=0;
    view.load(level);current.copy(sim.position());previous.copy(current);platformPrevious=platformNow=sim.platforms();
    $('chapter-number').textContent=`CHAPTER ${String(index+1).padStart(2,'0')} / 05`;
    $('chapter-name').textContent=level.name;$('hint').textContent=level.hint;$('shards').textContent='◇ ◇ ◇';$('timer').textContent='0:00';
    $('home').hidden=playing;$('hud').hidden=!playing;$('pause').hidden=!playing;document.body.classList.toggle('playing',playing);
    mode=playing?'playing':'home';lastTime=performance.now();accumulator=0;updateHome();
    (document.activeElement as HTMLElement)?.blur();
  }catch(error){fail(error);}finally{$('loading').hidden=true;}
}
function fail(error:unknown){
  console.error(error);mode='error';$('loading').hidden=true;
  showModal(menuTitle('A LITTLE TECHNICAL HICCUP','The sky could not open.','This game needs WebGL. Try a recent browser with hardware acceleration enabled, then reload.')+'<button class="primary" id="reload">Reload game</button>',false);
  $('reload').onclick=()=>location.reload();
}
function pause(){if(mode!=='playing')return;mode='paused';clearInput();showPause();}
function resume(){if(mode!=='paused')return;hideModal();mode='playing';lastTime=performance.now();(document.activeElement as HTMLElement)?.blur();}
function showPause(){
  showModal('<div class="modal-symbol">☾</div>'+menuTitle('TAKE A BREATH','The stars can wait.','Your journey will be here when you are ready.')+'<button class="primary" id="resume">Keep going <span>→</span></button><button class="secondary" id="retry">Restart chapter</button><button class="secondary" id="select">Choose a chapter</button><button class="text-button" id="back-home">Return to title</button>');
  $('resume').onclick=resume;$('retry').onclick=()=>{deaths++;void loadChapter(chapter,true,true);};$('select').onclick=showChapters;$('back-home').onclick=()=>void loadChapter(0,false);
}
function showChapters(){
  if(mode==='playing')mode='paused';returnMode=mode==='home'?'home':'paused';
  showModal(menuTitle('THE CONSTELLATION','Five little journeys.','Each light you restore opens the way to the next.')+`<div class="chapter-list">${levels.map((l,i)=>`<button class="chapter-option" data-chapter="${i}" ${i>progress.unlocked?'disabled':''}><span class="number">0${i+1}</span><span><b>${l.name}</b><small>${progress.best[i]?`Best ${formatTime(progress.best[i]!)}`:i>progress.unlocked?'Finish the previous chapter':'Ready to explore'}</small></span><span class="check">${progress.best[i]?'✦':i>progress.unlocked?'·':'↗'}</span></button>`).join('')}</div>`);
  document.querySelectorAll<HTMLButtonElement>('[data-chapter]').forEach(button=>button.onclick=()=>void loadChapter(Number(button.dataset.chapter)));
}
function showHow(){
  if(mode==='playing')mode='paused';returnMode=mode==='home'?'home':'paused';
  showModal(menuTitle('A LITTLE GUIDANCE','Find your footing.','Collect all three fragments and touch the glowing portal in each chapter.')+`<div class="instructions"><div>Move <kbd>W A S D / ARROWS</kbd></div><div>Jump / keep hopping <kbd>HOLD SPACE</kbd></div><div>Restart chapter <kbd>R</kbd></div><div>Pause <kbd>ESC</kbd></div></div><p>On a phone, use the direction pad and jump button. The glowing ferry crosses the long gaps: board at the edge, stop moving while it carries you, then step off.</p><p>Falling costs only a retry. There is no time limit.</p><button id="got-it" class="primary">A little courage. Got it.</button>`);
  $('got-it').onclick=closeModal;
}
function showCredits(){
  returnMode=mode==='home'?'home':'paused';
  showModal(menuTitle('MADE OF SMALL THINGS','Standing on good shoulders.')+`<div class="credit-links"><a href="https://github.com/minhpham1810/umbra" target="_blank" rel="noopener">Umbra by Minh Pham · game engine ↗</a><a href="https://kenney.nl/assets/nature-kit" target="_blank" rel="noopener">Kenney Nature Kit · CC0 models ↗</a><a href="https://threejs.org" target="_blank" rel="noopener">Three.js · rendering ↗</a><a href="https://rapier.rs" target="_blank" rel="noopener">Rapier · physics ↗</a></div><p>Sound effects are synthesized in your browser.<br>Progress stays on this device. No account needed.</p>`);
}
function closeModal(){if(mode==='paused'){resume();}else if(mode==='home')hideModal();else if(mode==='won'||mode==='lost'){void loadChapter(0,false);}else if(returnMode==='home')hideModal();}
function finish(won:boolean){
  mode=won?'won':'lost';clearInput();
  if(!won){deaths++;audio.fall();showModal('<div class="modal-symbol">☾</div>'+menuTitle('STILL A LITTLE LIGHT','A fall, not the end.','The dark is patient. So are you. Try this chapter again.')+`<button class="primary" id="again">One more try <span>↗</span></button><button class="secondary" id="leave">Return to title</button>`,false);$('again').onclick=()=>void loadChapter(chapter,true,true);$('leave').onclick=()=>void loadChapter(0,false);return;}
  const oldBest=progress.best[chapter]??Infinity;progress=recordWin(progress,chapter,stageTicks);save();audio.win();
  const final=chapter===4;const stars=stageTicks<=levels[chapter]!.par*60?(deaths===0?3:2):1;
  showModal(`<div class="${final?'constellation':'modal-symbol'}">${final?'✦ ✦ ✦ ✦ ✦':'✧'}</div>`+menuTitle(final?'THE CONSTELLATION IS WHOLE':`CHAPTER 0${chapter+1} COMPLETE`,final?'You brought the stars home.':'A little brighter.',final?'Five islands. Fifteen little lights. And one traveler who kept going.<br>The night remembers you.':levels[chapter]!.subtitle)+`<div class="result-stats"><div><strong>${formatTime(stageTicks)}</strong><small>${stageTicks<oldBest?'Personal best':'Your time'}</small></div><div><strong>${'✦'.repeat(stars)}${'·'.repeat(3-stars)}</strong><small>Chapter rating</small></div></div><button id="next" class="primary">${final?'Explore the chapters':'Follow the next light'} <span>↗</span></button><button class="secondary" id="replay">Play this chapter again</button><button class="text-button" id="result-home">Return to title</button>`,false);
  $('next').onclick=()=>{if(final){mode='paused';showChapters();}else void loadChapter(chapter+1);};$('replay').onclick=()=>void loadChapter(chapter);$('result-home').onclick=()=>void loadChapter(0,false);
}
function getButtons(){
  let b=0;const held=(...codes:string[])=>codes.some(c=>keys.has(c)||[...pointers.values()].includes(c));
  if(held('KeyW','ArrowUp'))b|=BUTTON.FORWARD;if(held('KeyS','ArrowDown'))b|=BUTTON.BACK;
  // Camera faces -Z: screen-right is +X, so swap the engine's local strafe signs at yaw 128.
  if(held('KeyA','ArrowLeft'))b|=BUTTON.RIGHT;if(held('KeyD','ArrowRight'))b|=BUTTON.LEFT;
  if(held('Space'))b|=BUTTON.JUMP;return b;
}
function animate(now:number){
  if(closed)return;frameId=requestAnimationFrame(animate);
  const dt=Math.min((now-lastTime)/1000,.1);lastTime=now;
  if(!sim||!view)return;
  let moving=false;
  if(mode==='playing'&&!document.hidden){
    accumulator+=dt;
    while(accumulator>=FIXED_DT&&mode==='playing'){
      const buttons=getButtons();const jumping=(buttons&BUTTON.JUMP)!==0&&sim.grounded;
      previous.copy(current);platformPrevious=platformNow;
      sim.step({buttons,yaw:128});current.copy(sim.position());platformNow=sim.platforms();stageTicks++;accumulator-=FIXED_DT;
      if(jumping)audio.jump();
      if(sim.events.length>eventCount){
        for(const e of sim.events.slice(eventCount))if(e.kind==='goal_reached'&&e.goalId){view.collect(e.goalId);audio.collect();}
        eventCount=sim.events.length;
        const shards=sim.events.filter(e=>e.kind==='goal_reached'&&e.goalId?.startsWith('shard')).length;
        $('shards').textContent=Array.from({length:3},(_,i)=>i<shards?'◆':'◇').join(' ');$('shards').setAttribute('aria-label',`${shards} of 3 fragments collected`);
        if(shards===3)$('hint').textContent='All the light is yours. Find the glowing portal.';
        else if(sim.events.some(e=>e.goalId==='portal'))$('hint').textContent='Portal awakened. Find the remaining light fragments.';
      }
      if(sim.outcome!=='timeout'){finish(sim.outcome==='win');break;}
    }
    $('timer').textContent=formatTime(stageTicks);
    const velocity=sim.velocity();moving=Math.abs(velocity.x)+Math.abs(velocity.z)>.1;
    if(moving)direction=Math.atan2(velocity.x,velocity.z);
  }
  const alpha=mode==='playing'?accumulator/FIXED_DT:1;
  const position=new THREE.Vector3().lerpVectors(previous,current,alpha);
  const platforms=platformNow.map((p,i)=>{const a=platformPrevious[i]??p;return{x:a.x+(p.x-a.x)*alpha,y:a.y+(p.y-a.y)*alpha,z:a.z+(p.z-a.z)*alpha};});
  view.render(position,platforms,now/1000,dt,mode==='home',moving,direction,reduced);
}
$('play').onclick=()=>void loadChapter(Object.keys(progress.best).length===5?0:progress.unlocked);
$('chapters').onclick=showChapters;$('how').onclick=showHow;$('credits').onclick=showCredits;$('pause').onclick=pause;$('close').onclick=closeModal;
$('sound').onclick=()=>{const on=audio.toggle();$('sound-label').textContent=on?'ON':'OFF';$('sound').setAttribute('aria-label',on?'Mute sound':'Enable sound');};
document.querySelector<HTMLAnchorElement>('.brand')!.onclick=e=>{e.preventDefault();if(mode==='playing')pause();else if(mode!=='loading'&&mode!=='error')void loadChapter(0,false);};
window.addEventListener('keydown',e=>{
  if(e.code==='Tab'&&!$('modal').hidden){const focusable=[...$('modal').querySelectorAll<HTMLElement>('button:not([disabled]):not([hidden]),a[href]')];const first=focusable[0],last=focusable.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}return;}
  if(e.code==='Escape'){e.preventDefault();if(mode==='playing')pause();else if(mode==='paused')resume();else if(mode==='home')hideModal();return;}
  if(e.code==='KeyR'&&!e.repeat&&(mode==='playing'||mode==='lost')){e.preventDefault();deaths++;void loadChapter(chapter,true,true);return;}
  if(mode!=='playing')return;
  if(['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(e.code)){e.preventDefault();keys.add(e.code);}
});
window.addEventListener('keyup',e=>keys.delete(e.code));
window.addEventListener('blur',()=>{clearInput();pause();});
document.addEventListener('visibilitychange',()=>{clearInput();lastTime=performance.now();if(document.hidden)pause();});
document.querySelectorAll<HTMLButtonElement>('[data-key]').forEach(button=>{
  button.addEventListener('pointerdown',e=>{e.preventDefault();if(mode!=='playing')return;button.setPointerCapture(e.pointerId);pointers.set(e.pointerId,button.dataset.key!);});
  for(const type of ['pointerup','pointercancel','lostpointercapture'])button.addEventListener(type,e=>{pointers.delete((e as PointerEvent).pointerId);});
  button.addEventListener('contextmenu',e=>e.preventDefault());
});
$('world').addEventListener('webglcontextlost',e=>{e.preventDefault();pause();toast('Graphics were interrupted. Reload to resume the game.');});
watchPageLifecycle(window,{
  pause:()=>{clearInput();pause();},
  resetTiming:()=>{lastTime=performance.now();accumulator=0;},
  dispose:()=>{closed=true;cancelAnimationFrame(frameId);sim?.dispose();view?.dispose();audio.dispose();},
});
async function start(){try{view=createView($<HTMLCanvasElement>('world'));await loadAssets();await loadChapter(0,false);frameId=requestAnimationFrame(animate);}catch(e){fail(e);}}
void start();
