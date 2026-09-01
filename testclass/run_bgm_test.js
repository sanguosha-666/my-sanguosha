/**
 * BGM 引擎单测（Task1）
 * 11 条 check 对应 brief 断言
 */
var vm = require('vm');
var fs = require('fs');
var path = require('path');
var ROOT = path.join(__dirname, '..');
var passed = 0, failed = 0;
function check(name, fn){
  try { fn(); console.log('  PASS', name); passed++; }
  catch(e){ console.log('  FAIL', name, '-', (e && e.message) || e); failed++; }
}
function mkBgmPlayer(){
  return {
    muted: true, src: '', paused: true, volume: 1, style: {},
    _plays: 0, _pauses: 0, _ls: {},
    play: function(){ this.paused = false; this._plays = (this._plays||0)+1; return {catch: function(){}}; },
    pause: function(){ this.paused = true; this._pauses = (this._pauses||0)+1; },
    load: function(){},
    addEventListener: function(ev, fn){ (this._ls[ev] = this._ls[ev] || []).push(fn); },
    fire: function(ev){ (this._ls[ev]||[]).forEach(function(f){ f(); }); }
  };
}
function mkVideo(){
  return { muted: true, src: '', style:{visibility:'hidden'}, play:function(){ return {catch:function(){}}; }, pause:function(){}, load:function(){}, addEventListener:function(){}, removeAttribute:function(){} };
}
function loadEnv(){
  var bgmPlayer = mkBgmPlayer();
  var bgVideo = mkVideo();
  // 让 bgmPlayer 的 fire 能触发 bgm 引擎绑定的 ended/error
  // brief 中的 fire 是 bgmPlayer.fire('ended')
  var canvas = { width:300,height:150,clientWidth:800,clientHeight:600,getContext:function(){ return {clearRect:function(){},setTransform:function(){},save:function(){},restore:function(){},translate:function(){},rotate:function(){},beginPath:function(){},moveTo:function(){},lineTo:function(){},closePath:function(){},fill:function(){},stroke:function(){},fillText:function(){}}; }};
  var otherVideos = { deathFxVideo: mkVideo(), lightningFxVideo: mkVideo(), movieFxVideo: mkVideo(), girlFxVideo: mkVideo() };
  var listeners = { doc: {}, win: {} };
  var context = {
    Math: Math, console: console, Number: Number, String: String, Array: Array, Object: Object, Set: Set,
    document: {
      hidden: false,
      getElementById: function(id){
        if(id==='bgmPlayer') return bgmPlayer;
        if(id==='bgVideo') return bgVideo;
        if(id==='gameBgCanvas') return canvas;
        if(id==='bgVeil') return { style:{} };
        return otherVideos[id] || null;
      },
      addEventListener: function(ev,fn){ (listeners.doc[ev]=listeners.doc[ev]||[]).push(fn); },
      removeEventListener: function(){},
      body: { appendChild:function(){} },
      createElement: function(){ return { style:{}, classList:{add:function(){},remove:function(){}}, appendChild:function(){}, setAttribute:function(){}, getAttribute:function(){} }; },
      querySelector: function(){ return null; },
      querySelectorAll: function(){ return []; }
    },
    window: {
      devicePixelRatio: 1, innerWidth: 1400, innerHeight: 900,
      addEventListener: function(ev,fn){ (listeners.win[ev]=listeners.win[ev]||[]).push(fn); },
      removeEventListener: function(){},
      matchMedia: function(){ return {matches:false}; }
    },
    setTimeout: setTimeout, clearTimeout: clearTimeout,
    requestAnimationFrame: function(fn){ return 0; },
    cancelAnimationFrame: function(){}
  };
  context.window.document = context.document;
  context.global = context;
  var sandbox = vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(ROOT,'game-bg.js'),'utf8'), sandbox, {filename:'game-bg.js'});
  // 按 brief 改成短数组（TDD RED 阶段 BGM_TRACKS 尚不存在，守卫避免提前抛错）
  try { vm.runInContext("if(typeof BGM_TRACKS!=='undefined'){BGM_TRACKS.lobby=['a.mp3','b.mp3']; BGM_TRACKS.room=['r.mp3']; BGM_TRACKS.game=['g1.mp3','g2.mp3']; BGM_TRACKS.duel=['d.mp3'];}", sandbox); } catch(e) {}
  var get = function(expr){ return vm.runInContext(expr, sandbox); };
  var run = function(expr){ return vm.runInContext(expr, sandbox); };
  return { sandbox: sandbox, bgmPlayer: bgmPlayer, bgVideo: bgVideo, get: get, run: run };
}

console.log('\n== BGM 引擎 ==\n');

// 1
check('1 setBgmMode(game) -> src 为 g1/g2 且 play 被调', function(){
  var e = loadEnv();
  e.run("setBgmMode('game')");
  var src = e.get('bgmEl().src');
  if(src!=='g1.mp3' && src!=='g2.mp3') throw new Error('src='+src);
  if(e.bgmPlayer._plays < 1) throw new Error('_plays='+e.bgmPlayer._plays);
});

// 2
check('2 同模式不重载', function(){
  var e = loadEnv();
  e.run("setBgmMode('game')");
  var plays = e.bgmPlayer._plays;
  e.run("setBgmMode('game')");
  if(e.bgmPlayer._plays !== plays) throw new Error('plays '+plays+' -> '+e.bgmPlayer._plays);
});

// 3
check('3 setBgmMode(duel) -> d.mp3', function(){
  var e = loadEnv();
  e.run("setBgmMode('duel')");
  var src = e.get('bgmEl().src');
  if(src!=='d.mp3') throw new Error('src='+src);
});

// 4
check('4 setBgmMode(off) -> paused', function(){
  var e = loadEnv();
  e.run("setBgmMode('game')");
  e.run("setBgmMode('off')");
  if(e.bgmPlayer.paused !== true) throw new Error('paused='+e.bgmPlayer.paused);
});

// 5
check('5 game 池 ended 切另一首', function(){
  var e = loadEnv();
  e.run("setBgmMode('game')");
  var src1 = e.get('bgmEl().src');
  e.bgmPlayer.fire('ended');
  var src2 = e.get('bgmEl().src');
  if(src1===src2) throw new Error('ended 未换 src: '+src1);
  if(src2!=='g1.mp3' && src2!=='g2.mp3') throw new Error('src2='+src2);
});

// 6
check('6 lobby 两次 ended 后停，再 setBgmMode(lobby) 能再播', function(){
  var e = loadEnv();
  e.run("setBgmMode('lobby')");
  // 第一次 ended -> 播第2首
  e.bgmPlayer.fire('ended');
  if(e.bgmPlayer.paused) throw new Error('第一次 ended 后不应停');
  var src2 = e.get('bgmEl().src');
  if(src2!=='a.mp3' && src2!=='b.mp3') throw new Error('src2='+src2);
  // 第二次 ended -> off
  e.bgmPlayer.fire('ended');
  if(e.bgmPlayer.paused !== true) throw new Error('两次 ended 后应 paused');
  // 再 setBgmMode(lobby) 重置计数能再播
  e.run("setBgmMode('lobby')");
  if(e.bgmPlayer.paused !== false) throw new Error('重置后应播放');
  var src3 = e.get('bgmEl().src');
  if(src3!=='a.mp3' && src3!=='b.mp3') throw new Error('src3='+src3);
});

// 7
check('7 skipBgm 在 game 换另一首', function(){
  var e = loadEnv();
  e.run("setBgmMode('game')");
  var s1 = e.get('bgmEl().src');
  e.run('skipBgm()');
  var s2 = e.get('bgmEl().src');
  if(s1===s2) throw new Error('skip 未换 src '+s1);
});

// 8
check('8 setBgmMuted true->paused, false->再 play', function(){
  var e = loadEnv();
  e.run("setBgmMode('game')");
  var plays = e.bgmPlayer._plays;
  e.run('setBgmMuted(true)');
  if(e.bgmPlayer.paused !== true) throw new Error('muted true 应 paused');
  e.run('setBgmMuted(false)');
  if(e.bgmPlayer._plays <= plays) throw new Error('unmute 应 play, plays '+plays+' -> '+e.bgmPlayer._plays);
});

// 9
check('9 pauseBgmForFx/resumeBgmAfterFx', function(){
  var e = loadEnv();
  e.run("setBgmMode('game')");
  var src = e.get('bgmEl().src');
  var plays = e.bgmPlayer._plays;
  e.run('pauseBgmForFx()');
  if(e.bgmPlayer.paused !== true) throw new Error('pauseBgmForFx 应 paused');
  e.run('resumeBgmAfterFx()');
  if(e.bgmPlayer._plays <= plays) throw new Error('resume 应 play');
  if(e.get('bgmEl().src') !== src) throw new Error('resume 不应换 src');
});

// 10
check('10 空池不抛', function(){
  var e = loadEnv();
  e.run('BGM_TRACKS.game=[]; setBgmMode("game")');
  // 不抛即通过；此时应进入 off -> paused
});

// 11
check('11 unlockFxAudio 后 bgVideo 仍 muted, bgmPlayer 已 unmuted', function(){
  var e = loadEnv();
  if(e.bgVideo.muted !== true) throw new Error('前置 bgVideo 应 muted');
  if(e.bgmPlayer.muted !== true) throw new Error('前置 bgmPlayer 应 muted');
  e.run('unlockFxAudio()');
  if(e.bgVideo.muted !== true) throw new Error('bgVideo 应仍 true, 实际 '+e.bgVideo.muted);
  if(e.bgmPlayer.muted !== false) throw new Error('bgmPlayer 应 false, 实际 '+e.bgmPlayer.muted);
  // unmuteBgVideo 同样效果（先重置）
  e.bgVideo.muted = true; e.bgmPlayer.muted = true;
  e.run('unmuteBgVideo()');
  if(e.bgVideo.muted !== true) throw new Error('unmuteBgVideo 后 bgVideo 仍 true');
  if(e.bgmPlayer.muted !== false) throw new Error('unmuteBgVideo 后 bgmPlayer false');
});

console.log('\nBGM tests: '+passed+'/'+(passed+failed)+' passed');
if(failed) process.exit(1);
