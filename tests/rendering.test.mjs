import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const result = await build({stdin:{contents:`export * from './Extension/Source/RenderingSettings.ts';
  export * from './Extension/Source/Modules/LyricsRenderer/RenderScheduler.ts';
  export * from './Extension/Source/Modules/RenderProjection.ts';`,resolveDir:process.cwd()},bundle:true,write:false,format:'esm'});
const {ClassicRendering,ApplyTextPreset,NormalizeRendering,CreateRenderingCounters,RenderScheduler,ResolveDetail} =
  await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));

test('editable text presets preserve detail, canonicalize tags and do not lock independent effects', () => {
  const minimal=ApplyTextPreset({...ClassicRendering,detail:'line'},'minimal');
  assert.equal(minimal.detail,'line'); assert.equal(minimal.highlight,'off');
  for(const key of ['scale','verticalMotion','glow','blur','emphasis'])assert.equal(minimal[key],false);
  const custom=NormalizeRendering({...minimal,glow:true});
  assert.equal(custom.preset,'custom');assert.equal(custom.glow,true);assert.equal(custom.highlight,'off');
  assert.deepEqual(ApplyTextPreset(custom,'classic'),{...ClassicRendering,detail:'line'});
  assert.equal(NormalizeRendering({...minimal,detail:'word'}).preset,'minimal');
  assert.equal(ResolveDetail({type:'Syllable',precision:'line'},'word'),'line');
  assert.equal(ResolveDetail({type:'Syllable',precision:'line'},'auto'),'line'); // actual source precision bounds operational detail
  assert.equal(ResolveDetail({type:'Static',precision:'static'},'word'),'plain');
});

test('boundary scheduler skips normal ticks, respects inclusive points and sweeps only on discontinuity', () => {
  const counters=CreateRenderingCounters(),calls=[],visual={Animate:(...args)=>calls.push(args),RequiresContinuous:()=>false,NeedsFrame:()=>false};
  const scheduler=new RenderScheduler(new Map([['voice',visual]]),[{id:'a',start:1,end:1},{id:'b',start:3,end:4}],new Map([['a','voice'],['b','voice']]),counters);
  scheduler.update(0,.1,true);calls.length=0;
  for(const t of [.1,.2,.3,.9])scheduler.update(t,.1);
  assert.equal(calls.length,0);assert.equal(counters.timelineEvaluations,1);
  scheduler.update(1,.1);assert.equal(calls.length,1);
  scheduler.update(1,.1);assert.equal(calls.length,1); // paused equal timestamp
  scheduler.update(1.001,.001);assert.equal(calls.length,2); // strict endpoint exit
  scheduler.update(2,.1);assert.equal(calls.length,2);
  scheduler.update(1.5,.1);assert.equal(calls.at(-1)[2],true); // backward inside same gap
  scheduler.update(-.5,0,true);assert.equal(calls.at(-1)[0],-.5); // positive offset intro
  scheduler.update(5,.1);assert.equal(calls.at(-1)[0],5); // cross a complete interval/song end
  assert.equal(counters.continuousUpdates,0);
});

test('active capabilities and actual settling select work, without a guessed timeout', () => {
  const counters=CreateRenderingCounters();let continuous=true,remaining=0;
  const calls=[],visual={Animate:(...args)=>{calls.push(args);if(remaining)remaining--},RequiresContinuous:()=>continuous,NeedsFrame:()=>remaining>0};
  const scheduler=new RenderScheduler(new Map([['voice',visual]]),[{id:'v',start:0,end:1}],new Map([['v','voice']]),counters);
  scheduler.update(0,0,true);scheduler.update(.1,.1);assert.equal(calls.length,2);
  remaining=3;scheduler.update(1.1,.1);scheduler.update(1.2,.1);scheduler.update(1.3,.1);
  const settled=calls.length;scheduler.update(1.4,.1);assert.equal(calls.length,settled);
  continuous=false;scheduler.update(.2,0,true);scheduler.update(.3,.1);assert.equal(calls.length,settled+1);
  remaining=2;scheduler.refresh();scheduler.update(.4,.1);scheduler.update(.5,.1);
  assert.equal(remaining,0);
});


test('equal transport timestamps continue actual settling then become an idle no-op', () => {
  let remaining=0,calls=0;
  const visual={Animate:()=>{calls++;if(remaining)remaining--},RequiresContinuous:()=>false,NeedsFrame:()=>remaining>0};
  const scheduler=new RenderScheduler(new Map([['v',visual]]),[{id:'v',start:0,end:1}],new Map([['v','v']]));
  scheduler.update(0,0,true);remaining=4;scheduler.refresh();
  for(let i=0;i<4;i++)scheduler.update(0,1/60);
  assert.equal(remaining,0);assert.equal(calls,5);
  scheduler.update(0,1/60);assert.equal(calls,5);
});

test('cue interval edits at a paused timestamp reconcile the changed owner without a source repaint or seek', () => {
  const calls=[], activity=[];
  const visual=id=>({Animate:(time,_delta,seek)=>calls.push([id,time,seek]),RequiresContinuous:()=>false,NeedsFrame:()=>false});
  const source={id:'word',start:10,end:20}, cue={id:'cue',start:1,end:9.75};
  const scheduler=new RenderScheduler(new Map([['word',visual('word')],['cue',visual('cue')]]),[source,cue],
    new Map([['word','word'],['cue','cue']]),undefined,(active,time,seek)=>activity.push([[...active],time,seek]));
  scheduler.update(4,0,true);calls.length=0;
  scheduler.replaceIntervals([source,{...cue,start:6}]);scheduler.update(4,0);
  assert.deepEqual(calls,[['cue',4,undefined]]);assert.deepEqual(activity.at(-1),[[],4,false]);
  calls.length=0;scheduler.update(5,1);assert.deepEqual(calls,[]);
  scheduler.update(6,1);assert.deepEqual(calls,[['cue',6,undefined]]);
  calls.length=0;scheduler.replaceIntervals([source]);scheduler.update(10,0);
  assert.deepEqual(calls.map(call=>call[0]).sort(),['cue','word']);assert.deepEqual(activity.at(-1),[['word'],10,false]);
});
