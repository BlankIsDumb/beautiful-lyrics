import test from 'node:test';
import assert from 'node:assert/strict';
import {fixedAnchorTarget,edgeSpace,readableViewport} from '../Extension/Source/Modules/LyricsRenderer/FollowPosition.mjs';
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
