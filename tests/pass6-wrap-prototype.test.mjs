import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {existsSync} from 'node:fs';
import {mkdtemp,writeFile,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {buildVocalFixture} from './renderer-fixture.mjs';
import {runFocusedFixture} from './chromium-focus-harness.mjs';
import {inflateSync} from 'node:zlib';

function rowLight(png, bounds) {
  const bytes=Buffer.from(png,'base64'),chunks=[];let width,height,type;
  for(let offset=8;offset<bytes.length;){const length=bytes.readUInt32BE(offset),name=bytes.toString('ascii',offset+4,offset+8),data=bytes.subarray(offset+8,offset+8+length);if(name==='IHDR'){width=data.readUInt32BE(0);height=data.readUInt32BE(4);type=data[9];assert.equal(data[8],8)}if(name==='IDAT')chunks.push(data);offset+=length+12}
  const channels=type===6?4:3;assert.ok(type===6||type===2,'supported screenshot RGB');
  const packed=inflateSync(Buffer.concat(chunks)),stride=width*channels,pixels=Buffer.alloc(height*stride);
  const paeth=(a,b,c)=>{const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);return pa<=pb&&pa<=pc?a:pb<=pc?b:c};
  for(let y=0;y<height;y++){const filter=packed[y*(stride+1)];for(let x=0;x<stride;x++){const left=x>=channels?pixels[y*stride+x-channels]:0,up=y?pixels[(y-1)*stride+x]:0,corner=y&&x>=channels?pixels[(y-1)*stride+x-channels]:0;pixels[y*stride+x]=(packed[y*(stride+1)+x+1]+(filter===0?0:filter===1?left:filter===2?up:filter===3?Math.floor((left+up)/2):paeth(left,up,corner)))&255}}
  return bounds.map(rect=>{let total=0,count=0;for(let y=Math.max(0,Math.ceil(rect.y));y<Math.min(height,Math.floor(rect.y+rect.height));y++)for(let x=Math.max(0,Math.ceil(rect.x));x<Math.min(width,Math.floor(rect.x+rect.width));x++){const value=pixels[y*stride+x*channels];if(value>20){total+=value;count++}}return total/count});
}

const chrome=process.env.CHROME_BIN||['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
// Technical gate before integrating typography: an inline painter is fragmented
// by the browser's text flow, while its outer canonical owner keeps its spring.
test('Pass6 prototype: single canonical painter wraps without repeating its gradient', {skip:!chrome},async()=>{
  const {code,css}=await buildVocalFixture();
  const script=`(()=>{${code}
    try{
      const {Current,LayoutSyllables}=fixtureModule;
      const check=(ok,message)=>{if(!ok)throw Error(message)};
      const lyrics=document.querySelector('.Lyrics'),group=document.querySelector('.VocalsGroup');
      const source=[{Text:'MMMMMMMMMMMMMMMMMMMMMMMMMM'.repeat(3),StartTime:1,EndTime:7,IsPartOfWord:false}];
      const vocal=new Current(group,source,false,false,LayoutSyllables(source));
      const owner=group.querySelector('.Syllable'),paint=owner.querySelector('.SourcePaint');
      check(paint,'actual production fragmented painter');
      vocal.PrepareSourceWrapping()?.();vocal.Animate(4,0,true);
      const range=document.createRange();range.selectNodeContents(paint);
      const rows=[...range.getClientRects()];
      check(rows.length>=3,'three-row canonical source owner');
      check(group.textContent===source[0].Text,'unchanged text');
      check(getComputedStyle(paint).boxDecorationBreak==='slice','one sliced gradient across inline fragments');
      check(owner.style.getPropertyValue('--gradient-progress')&&getComputedStyle(paint).getPropertyValue('--gradient-progress')===owner.style.getPropertyValue('--gradient-progress'),'one inherited canonical gradient clock');
      window.wrapPrototype={rows:rows.map(r=>({x:r.x,y:r.y,width:r.width,height:r.height})),owner,paint,vocal};
      jelTestComplete('WRAP_PROTOTYPE_PASS');
    }catch(error){jelTestComplete('WRAP_PROTOTYPE_FAIL: '+error.stack)}
  })();`;
  const directory=path.resolve(await mkdtemp(path.join(tmpdir(),'jel-pass6-wrap-')));
  try{
    const file=path.join(directory,'fixture.html');
    await writeFile(file,`<!doctype html><meta charset="utf-8"><body><style>${css}body{background:black;color:white;margin:0;font-family:monospace}.shell{width:220px;container-type:inline-size}.Lyrics{width:220px;height:600px;--minimum-lyrics-size:24px;--maximum-lyrics-size:24px}.Vocals{transition:none!important}</style><div class="shell"><div class="Lyrics NaturallyAlignedLeft"><div class="VocalsGroup"></div></div></div><script>${script.replaceAll('</script','<\\/script')}</script>`);
    assert.equal(await runFocusedFixture(chrome,file,path.join(directory,'profile'),async command=>{
      const result=await command('Runtime.evaluate',{expression:'wrapPrototype.rows',returnByValue:true});
      const shot=await command('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});
      const light=rowLight(shot.data,result.result.value);
      await command('Runtime.evaluate',{expression:"wrapPrototype.paint.style.display='block'"});
      const repeated=await command('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});
      const repeatedLight=rowLight(repeated.data,result.result.value);
      assert.ok(repeatedLight[0]<repeatedLight.at(-1)*1.3,'negative control rejects per-row repeated sweep: '+JSON.stringify(repeatedLight));
      if(process.env.JEL_PASS6_EVIDENCE){await mkdir(process.env.JEL_PASS6_EVIDENCE,{recursive:true});await writeFile(path.join(process.env.JEL_PASS6_EVIDENCE,'wrapped-owner.png'),Buffer.from(shot.data,'base64'));await writeFile(path.join(process.env.JEL_PASS6_EVIDENCE,'wrapped-owner-repeated-control.png'),Buffer.from(repeated.data,'base64'));await writeFile(path.join(process.env.JEL_PASS6_EVIDENCE,'wrapped-owner.json'),JSON.stringify({bounds:result.result.value,light,repeatedLight},null,2));}
      assert.ok(light[0]>light.at(-1)*1.3,'mid-progress paint advances across rows rather than repeating: '+JSON.stringify(light));
    }),'WRAP_PROTOTYPE_PASS');
  }finally{assert.ok(directory.startsWith(path.resolve(tmpdir())+path.sep)&&path.basename(directory).startsWith('jel-pass6-wrap-'));await rm(directory,{recursive:true,force:true,maxRetries:3})}
});
