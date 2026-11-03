/** Preserve live GPU/physics state when the browser caches the page for Back. */
export function watchPageLifecycle(page: EventTarget, actions: {pause():void;resetTiming():void;dispose():void}) {
  const hide=(event:Event)=>{
    actions.pause();
    if(!(event as PageTransitionEvent).persisted)actions.dispose();
  };
  const show=()=>actions.resetTiming();
  page.addEventListener('pagehide',hide);page.addEventListener('pageshow',show);
  return ()=>{page.removeEventListener('pagehide',hide);page.removeEventListener('pageshow',show);};
}
