import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const result=await build({stdin:{contents:`export * from './Extension/Source/LayoutSettings.ts';export * from './Extension/Source/PresentationSettings.ts';export * from './Extension/Source/Modules/LyricsRenderer/LyricContext.ts';export * from './Extension/Source/Modules/LyricsRenderer/RenderScheduler.ts';`,resolveDir:process.cwd()},bundle:true,write:false,format:'esm'});
const {ClassicLayout,NormalizeLayout,ApplyLayoutStyle,CreatePresentationSettings,ContextWindow,LyricContext,RenderScheduler}=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
const key='JustEnoughLyrics/Presentation';
test('schema8 isolates two layouts/shared family, exact7 recovery, stale legacy adapters and failures',()=>{
 const seed=JSON.stringify({version:7,profiles:{NowPlaying:{conversions:{enabled:false}},FullLyrics:{}}},null,3),data=new Map([[key,seed]]),events=[];
 let fail=false;const storage={getItem:k=>data.get(k)||null,setItem:(k,v)=>{if(fail)throw Error('quota');data.set(k,v)}};
 const settings=CreatePresentationSettings(storage),old=settings.getProfile('NowPlaying');
 settings.getLayout('NowPlaying').primaryRatio=2;
 assert.equal(settings.getLayout('NowPlaying').primaryRatio,1);assert.equal(data.get(key),seed);
 settings.subscribeLayout((...args)=>events.push(['layout',...args]));settings.subscribeFontFamily(()=>events.push(['family']));settings.subscribe(()=>events.push(['conversion']));
 settings.saveLayout('NowPlaying',{...settings.getLayout('NowPlaying'),primaryRatio:1.35,before:1,after:2});
 assert.equal(data.get(key+'/Migration/schema7'),seed);assert.equal(JSON.parse(data.get(key)).version,8);
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
 const p=NormalizeLayout({before:0,after:Number.MAX_SAFE_INTEGER,anchor:0,resumeDelay:0,inset:128,groupGap:0});assert.equal(p.before,0);assert.equal(p.anchor,0);assert.equal(p.inset,128);
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
