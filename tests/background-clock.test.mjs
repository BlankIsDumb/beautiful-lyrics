import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const built = await build({entryPoints:['Extension/Source/Modules/Background/BackgroundClock.ts'],bundle:true,write:false,format:'esm'});
const {BackgroundClock,ShouldDraw,NextDrawTime} = await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));

test('virtual time preserves phase through freeze/resume, clamps dt and scales motion', () => {
  const clock = new BackgroundClock();
  assert.equal(clock.Step(100,'classic'),0);
  assert.equal(clock.Step(200,'classic'),100/3500);
  clock.Freeze(); const frozen = clock.Current();
  assert.equal(clock.Step(9000,'fast'),frozen);
  assert.equal(clock.Step(9100,'fast'),frozen+200/3500);
  const before=clock.Current(); assert.equal(clock.Step(20000,'slow'),before+125/3500);
});

for (const hz of [60,144]) for (const fps of ['30','60','15','uncapped']) {
  test(`${fps} cap accumulates intervals without drift on ${hz} Hz`, () => {
    let last, count=0;
    for (let frame=0;frame<hz*10;frame++) {
      const now=frame*1000/hz;
      if (ShouldDraw(now,last,fps)) {last=NextDrawTime(now,last,fps);count++;}
    }
    assert.ok(Math.abs(count-(fps==='uncapped'?hz:Number(fps))*10)<=1,`draws: ${count}`);
  });
}
