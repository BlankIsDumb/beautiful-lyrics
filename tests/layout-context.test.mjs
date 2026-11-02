import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const result=await build({stdin:{contents:`export * from './Extension/Source/LayoutSettings.ts';export * from './Extension/Source/HorizontalSpacing.ts';export * from './Extension/Source/PresentationSettings.ts';export * from './Extension/Source/Modules/LyricsRenderer/LyricContext.ts';export * from './Extension/Source/Modules/LyricsRenderer/RenderScheduler.ts';`,resolveDir:process.cwd()},bundle:true,write:false,format:'esm'});
const {ResolveHorizontalSpacing,NormalizeHorizontalSpacing,ClassicLayout,NormalizeLayout,ApplyLayoutStyle,CreatePresentationSettings,ContextWindow,LyricContext,RenderScheduler}=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
const key='JustEnoughLyrics/Presentation';
test('schema9 isolates two layouts/shared family, exact7 recovery, stale legacy adapters and failures',()=>{
 const seed=JSON.stringify({version:7,profiles:{NowPlaying:{conversions:{enabled:false}},FullLyrics:{}}},null,3),data=new Map([[key,seed]]),events=[];
 let fail=false;const storage={getItem:k=>data.get(k)||null,setItem:(k,v)=>{if(fail)throw Error('quota');data.set(k,v)}};
 const settings=CreatePresentationSettings(storage),old=settings.getProfile('NowPlaying');
 settings.getLayout('NowPlaying').primaryRatio=2;
 assert.equal(settings.getLayout('NowPlaying').primaryRatio,1);assert.equal(data.get(key),seed);
 settings.subscribeLayout((...args)=>events.push(['layout',...args]));settings.subscribeFontFamily(()=>events.push(['family']));settings.subscribe(()=>events.push(['conversion']));
 settings.saveLayout('NowPlaying',{...settings.getLayout('NowPlaying'),primaryRatio:1.35,before:1,after:2});
 assert.equal(data.get(key+'/Migration/schema7'),seed);assert.equal(JSON.parse(data.get(key)).version,9);
 settings.saveProfile('NowPlaying',old);assert.equal(settings.getLayout('NowPlaying').primaryRatio,1.35);
 assert.equal(settings.getLayout('FullLyrics').primaryRatio,1);
 assert.equal(events.length,1);assert.equal(events[0][0],'layout');
 settings.saveFontFamily('"Local Font", sans-serif');assert.equal(events.at(-1)[0],'family');
 const count=events.length;settings.saveFontFamily('"Local Font", sans-serif');assert.equal(events.length,count);
 fail=true;assert.throws(()=>settings.saveLayout('FullLyrics',{...settings.getLayout('FullLyrics'),follow:false}));assert.equal(settings.getLayout('FullLyrics').follow,true);assert.equal(events.length,count);
 const reopened=CreatePresentationSettings({getItem:k=>data.get(k)||null,setItem(){}});assert.equal(reopened.getFontFamily(),'"Local Font", sans-serif');assert.equal(reopened.getLayout('NowPlaying').after,2);
});
test('layout normalization rejects nonfinite, fractional context, ranges and clones defaults',()=>{
 assert.deepEqual(NormalizeLayout({primaryRatio:NaN,before:1.2,after:-1,anchor:101,resumeDelay:Infinity}),ClassicLayout);
 const p=NormalizeLayout({before:0,after:Number.MAX_SAFE_INTEGER,anchor:0,resumeDelay:0,inset:128,groupGap:0});assert.equal(p.before,0);assert.equal(p.anchor,0);assert.equal(p.inset,undefined);assert.equal(NormalizeLayout({anchor:null}).anchor,45);assert.equal(NormalizeLayout({anchor:47.125}).anchor,47.125);
});

test('custom font selector state changes only with family presence and blank removes the override',()=>{
 const properties=new Map(),classes=new Set(),familyChanges=[];
 const root={style:{getPropertyValue:key=>properties.get(key)||'',setProperty:(key,value)=>properties.set(key,value),removeProperty:key=>properties.delete(key)},classList:{contains:key=>classes.has(key),toggle:(key,value)=>{if(key==='CustomFontFamily')familyChanges.push(value);if(value)classes.add(key);else classes.delete(key)}}};
 ApplyLayoutStyle(root,{...ClassicLayout},'');assert.equal(classes.has('CustomFontFamily'),false);assert.deepEqual(familyChanges,[]);
 ApplyLayoutStyle(root,{...ClassicLayout},'monospace');assert.equal(properties.get('--jel-family'),'monospace');assert.equal(classes.has('CustomFontFamily'),true);
 ApplyLayoutStyle(root,{...ClassicLayout,primaryRatio:1.2},'serif');assert.equal(properties.get('--jel-family'),'serif');assert.deepEqual(familyChanges,[true]);
 ApplyLayoutStyle(root,{...ClassicLayout},'');assert.equal(properties.has('--jel-family'),false);assert.equal(classes.has('CustomFontFamily'),false);assert.deepEqual(familyChanges,[true,false]);
});
test('logical context protects complete active span, keeps silence and reconstructs unequal tails after seeks',()=>{
 assert.deepEqual(ContextWindow(30,[10,20],1,1),[9,21]);assert.deepEqual(ContextWindow(5,[1,2],1,1),[0,3]);assert.deepEqual(ContextWindow(5,[1,2],0,0),[1,2]);
 const profile={...ClassicLayout,before:0,after:0},context=new LyricContext(3,[1,2,15],[{index:0,start:1,end:10},{index:1,start:2,end:3},{index:2,start:15,end:17}]);
 assert.deepEqual(context.select([],0,true,profile,false),[0,0]);assert.deepEqual(context.select([0,1],2,false,profile,false),[0,1]);assert.deepEqual(context.select([0],4,false,profile,false),[0,0]);assert.deepEqual(context.select([],11,false,profile,false),[0,0]);
 context.select([2],16,false,profile,false);assert.deepEqual(context.select([],11,true,profile,false),[0,0]);assert.deepEqual(context.select([],11,false,profile,true),[0,2]);assert.deepEqual(context.select([],11,false,{...profile,follow:false},false),[0,2]);
 const point=new LyricContext(3,[1,2,10],[{index:0,start:1,end:10},{index:1,start:2,end:3},{index:2,start:10,end:10}]);
 point.select([0],9.9,false,profile,false);assert.deepEqual(point.select([],10.1,false,profile,false),[0,2]);assert.deepEqual(point.select([],10.1,true,profile,false),[0,2]);
});
test('indexed hidden owners stop continuous/settling work, reconcile only reveals at paused timestamp and keep logical activity',()=>{
 const calls=[],logical=[],visible=[];const visuals=new Map(['a','b'].map(id=>[id,{Animate:(...args)=>calls.push([id,...args]),NeedsFrame:()=>true,RequiresContinuous:()=>true,SetLogicalActivity:value=>logical.push([id,value]),SetPresentationVisible:value=>visible.push([id,value])}]));
 let scheduler;const activity=(active)=>{scheduler.setVisible(new Set(active.has('b')?['b']:['a']))};
 scheduler=new RenderScheduler(visuals,[{id:'0',start:0,end:2},{id:'1',start:3,end:5}],new Map([['0','a'],['1','b']]),undefined,activity);
 scheduler.update(1,1/60,true);calls.length=0;scheduler.update(1.1,1/60);assert.deepEqual(calls.map(c=>c[0]),['a']);
 calls.length=0;scheduler.update(3.2,1/60);assert.deepEqual(calls.map(c=>c[0]),['b']);assert.equal(calls[0][3],true);assert.ok(logical.some(([id,state])=>id==='b'&&state));
 calls.length=0;scheduler.setVisible(new Set(['a','b']));scheduler.update(3.2,0);assert.equal(calls.find(c=>c[0]==='a')[3],true);assert.equal(calls.find(c=>c[0]==='b')[3],undefined);
 calls.length=0;scheduler.setVisible(new Set());scheduler.update(3.3,1/60);assert.deepEqual(calls,[]);
});


test('schema1-8 lazy exact migration, backup collision/retry and horizontal preview isolation',()=>{
 for(let version=1;version<=8;version++){
  const raw=JSON.stringify({version,fontFamily:'serif',profiles:{NowPlaying:{layout:{inset:72,anchor:null}},FullLyrics:{layout:{inset:128,anchor:42.125}}}},null,2);
  const data=new Map([[key,raw],[key+'/Migration/schema'+version,'OLDER RAW']]),writes=[],events=[];let failMain=false,failBackup=false;
  const store=CreatePresentationSettings({getItem:k=>data.get(k)??null,setItem:(k,v)=>{writes.push(k);if(k===key&&failMain||k!==key&&failBackup)throw Error('quota');data.set(k,v)}});
  store.subscribeHorizontalSpacing(surface=>events.push(surface));
  assert.equal(store.getHorizontalSpacing('Card'),0);assert.equal(store.getLayout('NowPlaying').anchor,45);
  if(version===8)assert.equal(store.getLayout('FullLyrics').anchor,42.125);
  const preview=store.createHorizontalPreview('Card');for(let i=0;i<30;i++)preview.set(i);
  assert.equal(writes.length,0);assert.equal(store.getHorizontalSpacing('Card'),0);assert.equal(store.getEffectiveHorizontalSpacing('Card'),29);assert.equal(store.getEffectiveHorizontalSpacing('Contained'),0);
  preview.cancel();assert.equal(store.getEffectiveHorizontalSpacing('Card'),0);
  store.saveHorizontalSpacing('Card',0);assert.equal(writes.length,0);
  failBackup=true;assert.throws(()=>store.saveFontFamily('monospace'));assert.equal(data.get(key),raw);
  const retryKey=writes.at(-1);failBackup=false;failMain=true;
  assert.throws(()=>store.saveHorizontalSpacing('Fullscreen',-100));assert.equal(store.getHorizontalSpacing('Fullscreen'),0);assert.equal(data.get(key),raw);
  failMain=false;store.saveHorizontalSpacing('Fullscreen',-100);
  assert.equal(data.get(retryKey),raw);assert.equal(data.get(key+'/Migration/schema'+version),'OLDER RAW');assert.equal(JSON.parse(data.get(key)).version,9);
  assert.equal(store.getHorizontalSpacing('Fullscreen'),-100);assert.equal(store.getHorizontalSpacing('Card'),0);
  preview.dispose();const reopened=CreatePresentationSettings({getItem:k=>data.get(k)??null,setItem(){}});assert.equal(reopened.getHorizontalSpacing('Fullscreen'),-100);
 }
});


test('signed responsive interpolation preserves asymmetric default and four-em source minimum',()=>{
 const metrics={rootLeft:0,rootRight:1000,defaultLeft:175,defaultRight:850,safeLeft:0,safeRight:1000,primary:48,fontFraction:.95};
 const expected=[[-100,0,1000],[-50,87.5,925],[0,175,850],[50,293.2236842105263,731.7763157894738],[100,411.4473684210526,613.5526315789474]];
 for(const [adjustment,left,right] of expected){const value=ResolveHorizontalSpacing({...metrics,adjustment});assert.ok(Math.abs(value.left-left)<.00001);assert.ok(Math.abs(value.right-right)<.00001);}
 assert.equal(ResolveHorizontalSpacing({...metrics,safeLeft:1000,adjustment:0}),undefined);
 for(const invalid of [NaN,Infinity,1.5,101,-101,'20'])assert.equal(NormalizeHorizontalSpacing(invalid),0);
 const constrained=ResolveHorizontalSpacing({...metrics,safeLeft:500,adjustment:0});assert.equal(constrained.left,500);assert.equal(constrained.right,850);
});


test('typography reset publishes profile and associated spacing atomically on storage success',()=>{
 const data=new Map(),events=[];let fail=false,writes=0;
 const store=CreatePresentationSettings({getItem:k=>data.get(k)??null,setItem:(k,v)=>{writes++;if(fail)throw Error('quota');data.set(k,v)}});
 store.saveLayout('FullLyrics',{...store.getLayout('FullLyrics'),primaryRatio:1.4});store.saveHorizontalSpacing('Contained',-70);store.saveHorizontalSpacing('Fullscreen',60);store.saveHorizontalSpacing('Card',20);
 store.subscribeHorizontalSpacing(surface=>events.push(surface));store.subscribeLayout(()=>events.push('layout'));
 const before=data.get(key);fail=true;assert.throws(()=>store.resetLayout('FullLyrics','typography'));assert.equal(data.get(key),before);assert.equal(store.getLayout('FullLyrics').primaryRatio,1.4);assert.equal(store.getHorizontalSpacing('Fullscreen'),60);assert.deepEqual(events,[]);
 fail=false;const count=writes;store.resetLayout('FullLyrics','typography');assert.equal(writes-count,1);assert.equal(store.getLayout('FullLyrics').primaryRatio,1);assert.equal(store.getHorizontalSpacing('Contained'),0);assert.equal(store.getHorizontalSpacing('Fullscreen'),0);assert.equal(store.getHorizontalSpacing('Card'),20);assert.deepEqual(events,['Contained','Fullscreen','layout']);
});
