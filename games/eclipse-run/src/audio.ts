export function createAudio() {
  let context:AudioContext|undefined;
  let enabled=false;
  function tone(frequency:number,duration=.16,offset=0,volume=.04){
    if(!enabled||!context)return;
    const oscillator=context.createOscillator(),gain=context.createGain();const start=context.currentTime+offset;
    oscillator.type='sine';oscillator.frequency.setValueAtTime(frequency,start);
    gain.gain.setValueAtTime(0,start);gain.gain.linearRampToValueAtTime(volume,start+.015);gain.gain.exponentialRampToValueAtTime(.001,start+duration);
    oscillator.connect(gain);gain.connect(context.destination);oscillator.start(start);oscillator.stop(start+duration+.02);
  }
  return {
    get enabled(){return enabled;},
    toggle(){try{context??=new AudioContext();void context.resume().catch(()=>{});enabled=!enabled;if(enabled)tone(440);}catch{enabled=false;}return enabled;},
    collect(){tone(659,.3);tone(988,.5,.09);},jump(){tone(290,.1,0,.018);tone(440,.1,.04,.012);},
    win(){[523,659,784,1047].forEach((f,i)=>tone(f,.65,i*.14));},fall(){tone(196,.3);tone(147,.4,.1);},
    dispose(){void context?.close();},
  };
}
