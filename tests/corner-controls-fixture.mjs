import {build} from 'esbuild';
import {readFile} from 'node:fs/promises';
import path from 'node:path';

// Real settings stores, modal and corner controls; only the host/player/cache
// services are substituted. Custom namespaces avoid ancestor config discovery
// in restricted Windows checkouts and never load provider request code.
export async function buildCornerFixture(withModal = true) {
  const root = process.cwd();
  const result = await build({stdin: {contents: `
    export * from './Extension/Source/CornerControls.ts';
    export * from './Extension/Source/ViewSettingsControls.ts';
    export * from './Extension/Source/PresentationSettings.ts';
    export * from './Extension/Source/TimingSettings.ts';
    export * from '@Spices/Spicetify/Services/Player/mod.ts';
    ${withModal ? "export {SetupProviderControls,OpenProviderSettings} from './Extension/Source/ProviderControls.ts';" : ''}
  `, resolveDir: root}, bundle: true, write: false, format: 'iife', globalName: 'cornerModule',
  tsconfigRaw: {}, plugins: [{name: 'corner-host', setup(b) {
    b.onResolve({filter: /.*/}, args => {
      if (/Session\.ts$/.test(args.path)) return {path:'session',namespace:'host'};
      if (/Player\/mod\.ts$/.test(args.path)) return {path:'player',namespace:'host'};
      if (/LyricsCache\.ts$/.test(args.path)) return {path:'cache',namespace:'host'};
      let file = args.path.replace(/^@Spices\//, root + '/Extension/Spices/').replace(/^@Universal\//, root + '/Universal/');
      file = path.resolve(args.resolveDir || root, file);
      return {path:file,namespace:file.endsWith('.scss') ? 'style' : 'source'};
    });
    b.onLoad({filter:/.*/,namespace:'style'}, () => ({contents:''}));
    b.onLoad({filter:/.*/,namespace:'source'}, async args => ({contents:await readFile(args.path,'utf8'),loader:'ts',resolveDir:path.dirname(args.path)}));
    b.onLoad({filter:/.*/,namespace:'host'}, args => ({contents:args.path === 'session' ? `
      export const Spotify=globalThis.fixtureSpotify, IsDevelopment=false;
      export const GlobalMaid=globalThis.fixtureGlobalMaid || {Give:item=>item};
      export const OnSpotifyReady=new Promise(()=>{}),ShowNotification=()=>{};
    ` : args.path === 'cache' ? `
      export const LyricsCacheScopes=['All','Musixmatch','AMLL','LRCLIB','Spotify','Spicy'];
      export const GetLyricsCacheCounts=async()=>({All:0}),ClearLyricsCache=async()=>({removed:0,failed:0});
    ` : `
      function signal(){const listeners=new Set();return {Connect(fn){listeners.add(fn);return {Disconnect(){listeners.delete(fn)}}},fire(){for(const fn of listeners)fn()},get size(){return listeners.size}}}
      export const SongChanged=signal(),SongLyricsLoaded=signal();
      export let SongLyrics,SongLyricChoices=[];
      export const selected=[];
      export function SetSong(lyrics,choices=SongLyricChoices,event=SongChanged){SongLyrics=lyrics;SongLyricChoices=choices;event.fire()}
      export function SelectLyricsProvider(name){selected.push(name);SongLyrics=SongLyricChoices.find(lyrics=>lyrics.Source.Provider===name);SongLyricsLoaded.fire()}
      export const ReloadLyrics=()=>{throw Error('unexpected provider reload')};
      // Test-controlled song cache clear: availability, call count and the
      // pending promise of the latest call.
      export const clearSong={available:true,calls:0,resolve:undefined,reject:undefined};
      export const CanClearSongLyricsCache=()=>clearSong.available;
      export function ClearSongLyricsCache(){clearSong.calls++;return new Promise((resolve,reject)=>{clearSong.resolve=resolve;clearSong.reject=reject})}
    `}));
  }}]});
  return result.outputFiles[0].text;
}
