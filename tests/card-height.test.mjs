import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {transform} from 'esbuild';
import {buildCornerFixture} from './corner-controls-fixture.mjs';

const {code}=await transform(readFileSync('Extension/Source/LayoutSettings.ts','utf8'),{loader:'ts',format:'esm'});
const {AutoLeadActive,EffectiveLayout,DefaultLayouts,NormalizeLayout,LayoutFields}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));

test('Max automatic lead depends on the top anchor and preserves All/positive context and stored values',()=>{
  for(const cardHeight of ['default','extended','max']) {
    const full={...DefaultLayouts.FullLyrics,cardHeight,before:0};assert.equal(EffectiveLayout('FullLyrics',full),full);assert.equal(AutoLeadActive('FullLyrics',full),false);
  }
  for(const cardHeight of ['default','extended'])for(const before of [0,null,2]) {
    const card={...DefaultLayouts.NowPlaying,cardHeight,before};assert.equal(EffectiveLayout('NowPlaying',card),card);assert.equal(AutoLeadActive('NowPlaying',card),false);
  }
  for(const [anchor,before] of [[0,0],[20,0],[45,0],[0,1],[0,2],[20,2],[0,null],[20,null]]) {
    const stored={...DefaultLayouts.NowPlaying,cardHeight:'max',anchor,before},snapshot=structuredClone(stored);
    const effective=EffectiveLayout('NowPlaying',stored);
    const active=anchor===0,substituted=active&&before===0;
    assert.equal(AutoLeadActive('NowPlaying',stored),active);
    assert.deepEqual(effective,{...stored,before:substituted?1:before});assert.deepEqual(stored,snapshot);
    if(substituted)assert.notEqual(effective,stored);else assert.equal(effective,stored);
  }
});

test('height normalization and layout field notifications include height without schema migration',async()=>{
  for(const value of [undefined,'bad',null,1])assert.equal(NormalizeLayout({cardHeight:value}).cardHeight,'default');
  for(const value of ['default','extended','max'])assert.equal(NormalizeLayout({cardHeight:value}).cardHeight,value);
  assert.deepEqual(LayoutFields({...DefaultLayouts.NowPlaying},{...DefaultLayouts.NowPlaying,cardHeight:'max'}),['cardHeight']);
  const bundle=await buildCornerFixture(false),m=new Function(bundle+';return cornerModule')();
  const key='JustEnoughLyrics/Presentation';
  for(const cardHeight of [undefined,'invalid']) {
    const raw=JSON.stringify({version:12,profiles:{NowPlaying:{layout:{cardHeight}}}}),data=new Map([[key,raw]]),events=[];
    const p=m.CreatePresentationSettings({getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v)});
    assert.equal(p.getLayout('NowPlaying').cardHeight,'default');assert.equal(data.get(key),raw);
    p.subscribeLayout((...args)=>events.push(args));
    p.saveLayout('NowPlaying',{...p.getLayout('NowPlaying'),cardHeight:'max'});
    const before=data.get(key),stored=p.getLayout('NowPlaying');
    assert.equal(p.getEffectiveLayout('NowPlaying').anchor,0);assert.equal(p.getEffectiveLayout('NowPlaying').before,1);
    assert.deepEqual(p.getLayout('NowPlaying'),stored);assert.equal(data.get(key),before);assert.deepEqual(events,[['NowPlaying',['cardHeight']]]);
    p.saveLayout('NowPlaying',{...stored,cardHeight:'default'});assert.equal(p.getEffectiveLayout('NowPlaying').anchor,0);assert.equal(p.getEffectiveLayout('NowPlaying').before,0);
    for(const before of [null,2]) {
      p.saveLayout('NowPlaying',{...stored,cardHeight:'max',before});
      const saved=data.get(key),profile=p.getLayout('NowPlaying');
      assert.equal(AutoLeadActive('NowPlaying',profile),true);assert.deepEqual(p.getEffectiveLayout('NowPlaying'),profile);
      assert.equal(data.get(key),saved);assert.deepEqual(p.getLayout('NowPlaying'),profile);
    }
    assert.equal(JSON.parse(data.get(key)).version,12);
  }
});
