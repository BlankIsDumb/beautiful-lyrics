import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {transform} from 'esbuild';
import * as follow from '../Extension/Source/Modules/LyricsRenderer/FollowPosition.mjs';

// Exercise the actual scroller decision with controlled, already-measured voice
// bounds. Native measurement/scrolling remains covered by the browser fixture.
const {code}=await transform(readFileSync('Extension/Source/Modules/LyricsRenderer/LyricsScroller.ts','utf8'),{loader:'ts',format:'cjs'});
const module={exports:{}};
new Function('require','exports','module',code)(name=>name.endsWith('FollowPosition.mjs')?follow:{},module.exports,module);
const {LyricsScroller}=module.exports;
function setup(definitions,lead=1,options={}) {
  const bounds=new Map(),groups=definitions.map((definition,group)=>({Role:definition.role??'source',GroupContainer:{group},Vocals:definition.voices.map((voice,index)=>{
    const vocal={IsActive:()=>voice.active===true};bounds.set(vocal,{top:voice.top,bottom:voice.bottom,start:voice.start??group,group,voice:index});return vocal;
  })}));
  const targets=[],scroller=Object.create(LyricsScroller.prototype);
  Object.assign(scroller,{LyricsAreSynced:true,OnScreen:true,Profile:{follow:true,anchor:0,resume:'classic'},GeometryValid:true,LayoutQueued:false,
    VocalGroups:groups,VoiceBounds:bounds,NavigationPending:false,AutoScrollBlocked:false,Scroller:{isScrolling:false},
    ScrollerObject:{scrollTop:0,clientHeight:100,scrollHeight:1100},options:{surface:'Card',followLead:()=>lead,...options},
    ScrollTo:target=>targets.push(target),ToggleAutoScrollBlock(value){this.AutoScrollBlocked=value}});
  return {scroller,groups,targets,move:()=>scroller.MoveToActiveLyrics()};
}
const earlier={voices:[{top:200,bottom:220}]},active={voices:[{top:240,bottom:260,active:true}]};

test('automatic lead includes all voices of nearest earlier source, skipping cues and using earliest contributing group',()=>{
  const s=setup([{voices:[{top:190,bottom:210},{top:215,bottom:235}]},{role:'cue',voices:[{top:235,bottom:240}]},active]);s.move();assert.deepEqual(s.targets,[182]);
  const overlap=setup([earlier,{...active,voices:[{top:240,bottom:250,active:true}]},{voices:[{top:260,bottom:270,active:true}]}]);overlap.move();assert.deepEqual(overlap.targets,[192]);
});

test('source, gap cue and navigation bounds share the same earlier-source union',()=>{
  for(const kind of ['source','cue','navigation']) {
    const s=setup([earlier,{role:kind==='cue'?'cue':'source',voices:[{top:240,bottom:260,active:kind!=='navigation'}]}]);
    if(kind==='navigation'){s.scroller.NavigationPending=true;s.scroller.options.navigationTargets=()=>[s.groups[1].GroupContainer]}
    s.move();assert.deepEqual(s.targets,[192],kind);
  }
});

test('disabled lead and first group preserve existing target; tall unions use newest voice fallback and clamp',()=>{
  const off=setup([earlier,active],0);off.move();assert.deepEqual(off.targets,[232]);
  const legacy=setup([earlier,active]);delete legacy.scroller.options.followLead;legacy.move();assert.deepEqual(legacy.targets,[232]);
  const first=setup([{voices:[{top:8,bottom:28,active:true}]}]);first.move();assert.deepEqual(first.targets,[0]);
  const tall=setup([{voices:[{top:100,bottom:200}]},{voices:[{top:300,bottom:330,active:true}]}]);tall.move();assert.deepEqual(tall.targets,[292]);
  const last=setup([{voices:[{top:940,bottom:960}]},{voices:[{top:1072,bottom:1092,active:true}]}]);last.move();assert.deepEqual(last.targets,[1000]);
});

test('classic resume reach check uses union bounds, agreeing with the follow target',()=>{
  for(const lead of [0,1]) {
    const s=setup([{voices:[{top:145,bottom:155}]},{voices:[{top:205,bottom:215,active:true}]}],lead);
    s.scroller.AutoScrollBlocked=true;s.scroller.ScrollerObject.scrollTop=100;
    s.move();assert.equal(s.scroller.AutoScrollBlocked,lead===0);assert.deepEqual(s.targets,lead?[137]:[]);
  }
});
