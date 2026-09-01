/**
 * 全屏 mp4 特效音轨：首次用户手势后取消 muted。
 * 大厅 #bgVideo 原本就会 unmute；死亡/闪电/过场三条此前一直 muted。
 */
const vm = require('vm');
const fs = require('fs');
const assert = require('assert');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;
function check(name, fn){
  try { fn(); console.log('  PASS', name); passed++; }
  catch(e){ console.log('  FAIL', name, '-', e.message); failed++; }
}

function mkVideo(){
  return {
    muted: true,
    src: '',
    style: { visibility: 'hidden' },
    play(){ return { catch(){} }; },
    pause(){},
    load(){},
    addEventListener(){},
    removeAttribute(){}
  };
}

function loadBg(){
  const videos = {
    bgVideo: mkVideo(),
    deathFxVideo: mkVideo(),
    lightningFxVideo: mkVideo(),
    movieFxVideo: mkVideo()
  };
  const bgmPlayer = mkVideo();
  // bgmPlayer mock for BGM联动
  bgmPlayer.muted = true;
  const context = {
    document: {
      getElementById(id){
        if(id==='bgmPlayer') return bgmPlayer;
        return videos[id] || null;
      },
      addEventListener(){},
      removeEventListener(){},
      body: {}
    },
    window: { addEventListener(){}, devicePixelRatio:1, innerWidth:800, innerHeight:600 },
    Math, console
  };
  context.window.document = context.document;
  context.global = context;
  const sandbox = vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(ROOT,'game-bg.js'),'utf8'), sandbox, {filename:'game-bg.js'});
  return { sandbox, videos, bgmPlayer };
}

console.log('\n== 特效视频音轨 ==\n');

check('unmuteBgVideo 后 bgVideo 仍 muted，bgmPlayer 已 unmuted；死亡/闪电/过场已 unmuted', ()=>{
  const { sandbox, videos, bgmPlayer } = loadBg();
  vm.runInContext('unmuteBgVideo()', sandbox);
  assert.strictEqual(videos.bgVideo.muted, true, 'bgVideo 应仍 true');
  if(bgmPlayer) assert.strictEqual(bgmPlayer.muted, false, 'bgmPlayer 应 false');
  assert.strictEqual(videos.deathFxVideo.muted, false, 'deathFxVideo');
  assert.strictEqual(videos.lightningFxVideo.muted, false, 'lightningFxVideo');
  assert.strictEqual(videos.movieFxVideo.muted, false, 'movieFxVideo');
});

check('手势解锁后 triggerMovieFx 播放时保持有声', ()=>{
  const { sandbox, videos } = loadBg();
  vm.runInContext('unmuteBgVideo()', sandbox);
  videos.movieFxVideo.muted = true; // 模拟换 src 后被浏览器重新静音
  vm.runInContext('triggerMovieFx("fanWin")', sandbox);
  assert.strictEqual(videos.movieFxVideo.muted, false);
});

check('手势解锁后 triggerLightningFx / triggerDeathFx 播放时保持有声', ()=>{
  const { sandbox, videos } = loadBg();
  vm.runInContext('unmuteBgVideo()', sandbox);
  videos.lightningFxVideo.muted = true;
  videos.deathFxVideo.muted = true;
  vm.runInContext('triggerLightningFx(true)', sandbox);
  vm.runInContext('triggerDeathFx("self")', sandbox);
  assert.strictEqual(videos.lightningFxVideo.muted, false, 'lightning');
  assert.strictEqual(videos.deathFxVideo.muted, false, 'death');
});

console.log('\nfx video audio tests: '+passed+'/'+(passed+failed)+' passed');
if(failed) process.exit(1);
