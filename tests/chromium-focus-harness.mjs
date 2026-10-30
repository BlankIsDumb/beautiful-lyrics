import {spawn} from 'node:child_process';
import {StringDecoder} from 'node:string_decoder';
import {pathToFileURL} from 'node:url';

// One owned headless target, with CDP focus emulation before page construction.
// OS focus is nondeterministic when Node launches several browser tests at once.
// The page still uses real element.focus()/trusted native focus events; no fake
// FocusEvent is dispatched. A pipe works on supported Node20 without WebSocket.
export async function runFocusedFixture(chrome, file, profile, hook) {
  const child = spawn(chrome, ['--headless=new', '--disable-gpu', '--disable-background-networking',
    '--no-first-run', '--no-default-browser-check', '--remote-debugging-pipe', '--user-data-dir=' + profile, 'about:blank'],
  {stdio:['ignore','ignore','pipe','pipe','pipe'],windowsHide:true});
  const pending = new Map(), events = new Set();
  let nextId=0, buffer='', stderr='', exited=false;
  const decoder=new StringDecoder('utf8');
  const fail = error => { for(const request of pending.values())request.reject(error); pending.clear(); };
  child.stdio[3].on('error',fail);child.stdio[4].on('error',fail);
  child.stderr.on('data',chunk=>{stderr=(stderr+chunk.toString()).slice(-4000)});
  const exit=new Promise(resolve=>{
    child.once('error',error=>{exited=true;fail(error);resolve()});
    child.once('exit',(code,signal)=>{exited=true;fail(Error('Owned Chromium exited: '+code+' '+signal+' '+stderr));resolve()});
  });
  child.stdio[4].on('data',chunk=>{
    buffer+=decoder.write(chunk);
    let boundary;
    while((boundary=buffer.indexOf('\0'))!==-1){
      const raw=buffer.slice(0,boundary);buffer=buffer.slice(boundary+1);
      if(!raw)continue;
      const message=JSON.parse(raw);
      if(message.id){
        const request=pending.get(message.id);if(!request)continue;
        pending.delete(message.id);
        if(message.error)request.reject(Error(message.error.message));else request.resolve(message.result);
      }else for(const listener of events)listener(message);
    }
  });
  const send=(method,params={},sessionId)=>new Promise((resolve,reject)=>{
    const id=++nextId;
    const timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout: '+method));},15000);
    pending.set(id,{resolve:value=>{clearTimeout(timer);resolve(value)},reject:error=>{clearTimeout(timer);reject(error)}});
    child.stdio[3].write(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})})+'\0',error=>{if(error){pending.delete(id);clearTimeout(timer);reject(error)}});
  });
  let completionTimer;
  try{
    await send('Browser.getVersion');
    const {targetId}=await send('Target.createTarget',{url:'about:blank'});
    const {sessionId}=await send('Target.attachToTarget',{targetId,flatten:true});
    await send('Page.enable',{},sessionId);
    await send('Runtime.enable',{},sessionId);
    await send('Emulation.setFocusEmulationEnabled',{enabled:true},sessionId);
    await send('Page.bringToFront',{},sessionId);
    await send('Runtime.addBinding',{name:'jelTestComplete'},sessionId);
    const completed=new Promise((resolve,reject)=>{
      const listener=message=>{
        if(message.sessionId===sessionId&&message.method==='Runtime.bindingCalled'&&message.params.name==='jelTestComplete'){
          clearTimeout(completionTimer);events.delete(listener);resolve(message.params.payload);
        }
      };
      events.add(listener);
      completionTimer=setTimeout(()=>{events.delete(listener);reject(Error('Focused fixture did not complete'));},15000);
    });
    // Attach rejection handling before navigation so a launch failure cannot
    // leave an unhandled pending completion promise during cleanup.
    const observed=completed.then(value=>({value}),error=>({error}));
    await send('Page.navigate',{url:pathToFileURL(file).href},sessionId);
    // Optional owned-target protocol hook for tests needing real pseudo states.
    if(hook) await hook((method,params={})=>send(method,params,sessionId));
    const result=await observed;
    if(result.error)throw result.error;
    return result.value;
  }finally{
    clearTimeout(completionTimer);events.clear();
    if(!exited){
      try{await send('Browser.close')}catch{ /* Closing Chrome can close its pipe before its reply. */ }
      if(!exited)child.kill();
    }
    let exitTimer;
    const closed=await Promise.race([exit.then(()=>true),new Promise(resolve=>{exitTimer=setTimeout(()=>resolve(false),5000)})]);
    clearTimeout(exitTimer);
    if(!closed){
      child.kill();for(const stream of child.stdio)stream?.destroy();child.unref();
      throw Error('Owned Chromium did not exit within cleanup deadline');
    }
    fail(Error('Owned Chromium fixture closed'));
  }
}
