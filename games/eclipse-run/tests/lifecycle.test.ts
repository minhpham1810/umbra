import { expect, it } from 'vitest';
import { watchPageLifecycle } from '../src/lifecycle.js';
it('preserves the runtime in back-forward cache and resets timing when restored',()=>{
  const page=new EventTarget();let disposed=false,paused=false,resetCount=0;
  watchPageLifecycle(page,{pause:()=>{paused=true;},resetTiming:()=>{resetCount++;},dispose:()=>{disposed=true;}});
  const hide=new Event('pagehide');Object.defineProperty(hide,'persisted',{value:true});page.dispatchEvent(hide);
  expect(paused).toBe(true);expect(disposed).toBe(false);
  page.dispatchEvent(new Event('pageshow'));expect(resetCount).toBe(1);
  page.dispatchEvent(new Event('pagehide'));expect(disposed).toBe(true);
});
