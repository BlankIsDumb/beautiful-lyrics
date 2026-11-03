import test from 'node:test';
import assert from 'node:assert/strict';
import {fixedAnchorTarget,edgeSpace,naturalEdgeSpace,readableViewport} from '../Extension/Source/Modules/LyricsRenderer/FollowPosition.mjs';
test('fixed anchor uses every visible line, union fit, semantic newest ties and oversized top',()=>{
 const H=800,A=readableViewport(H,45).anchor;
 for(const top of [400,470,540])assert.equal(fixedAnchorTarget([{top,bottom:top+40,start:0}],H,45,2000),top+20-A);
 assert.equal(fixedAnchorTarget([{top:400,bottom:440,start:0},{top:480,bottom:520,start:2}],H,45,2000),460-A);
 assert.equal(fixedAnchorTarget([{top:100,bottom:140,start:2,group:0},{top:1000,bottom:1040,start:2,group:1}],H,45,2000),1020-A);
 assert.equal(fixedAnchorTarget([{top:1000,bottom:2000,start:3}],H,45,3000),976);
 const U=readableViewport(H,45).usable;
 for(const delta of [-.01,0])assert.equal(fixedAnchorTarget([{top:100,bottom:100+U+delta,start:0}],H,45,2000),76);
 assert.equal(fixedAnchorTarget([{top:100,bottom:100+U+.01,start:0}],H,45,2000),76);
 assert.equal(fixedAnchorTarget([],H,45,1),undefined);
 for(const height of [0,.5,1,NaN])assert.equal(fixedAnchorTarget([{top:1,bottom:2}],height,45,100),undefined);
});
test('edge envelope permits first/last placement without accumulating previous spacers',()=>{
 for(const H of [120,300,800])for(const anchor of [0,45,50,73.25,100])for(const size of [20,80,900]){
  const raw=[{top:0,bottom:size,start:0},{top:1000,bottom:1000+size,start:1}];
  const spaces=edgeSpace(raw,H,anchor,1000+size);
  const shifted=raw.map(b=>({...b,top:b.top+spaces.leading,bottom:b.bottom+spaces.leading}));
  for(const b of shifted){const max=1000+size+spaces.leading+spaces.trailing-H,target=fixedAnchorTarget([b],H,anchor,max);assert.ok(target>=0&&target<=max);}
 }
});

test('Card natural edges reserve readable padding only, independently of anchor/context',()=>{
 for(const H of [96,280,840])for(const count of [1,2,30])for(const tall of [20,1000]){
  const bounds=Array.from({length:count},(_,i)=>({top:i*(tall+15),bottom:i*(tall+15)+tall,start:i}));
  const intrinsic=bounds.at(-1).bottom,spaces=naturalEdgeSpace(bounds,H,intrinsic),safe=readableViewport(H);
  assert.equal(spaces.leading,Math.ceil(safe.safeTop));assert.equal(spaces.trailing,Math.ceil(safe.safeBottom));
  const shifted=bounds.map(b=>({...b,top:b.top+spaces.leading,bottom:b.bottom+spaces.leading})),max=Math.max(0,intrinsic+spaces.leading+spaces.trailing-H);
  for(const anchor of [0,45,50,100]){
   assert.equal(fixedAnchorTarget([shifted[0]],H,anchor,max),0);
   const last=fixedAnchorTarget([shifted.at(-1)],H,anchor,max);
   if(intrinsic+spaces.leading+spaces.trailing<=H)assert.equal(last,0);
   else if(tall<=safe.usable)assert.equal(last,max);
  }
 }
 assert.deepEqual(naturalEdgeSpace([{top:30,bottom:80}],280,160),{leading:0,trailing:0});
 assert.equal(naturalEdgeSpace([],280,0),undefined);
});
