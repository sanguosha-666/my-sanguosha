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

// ---- Task 2 DOM + lifecycle 源码断言（Step1 TDD: 预期 FAIL 直到 HTML/lifecycle 落地） ----
check('12 index.html 存在 <audio id="bgmPlayer"', function(){
  var html = fs.readFileSync(path.join(ROOT,'index.html'),'utf8');
  if(html.indexOf('<audio id="bgmPlayer"') < 0) throw new Error('未找到 <audio id="bgmPlayer"');
});
check('13 index.html 存在 id="bgmSkipBtn" 且 onclick="skipBgm()"', function(){
  var html = fs.readFileSync(path.join(ROOT,'index.html'),'utf8');
  if(html.indexOf('id="bgmSkipBtn"') < 0) throw new Error('未找到 bgmSkipBtn');
  if(html.indexOf('onclick="skipBgm()"') < 0) throw new Error('未找到 onclick="skipBgm()"');
});
check('14 #bgmSkipBtn 在 fullscreenBtn 与 closeRoomBtn 之间', function(){
  var html = fs.readFileSync(path.join(ROOT,'index.html'),'utf8');
  var a = html.indexOf('id="fullscreenBtn"');
  var b = html.indexOf('id="bgmSkipBtn"');
  var c = html.indexOf('id="closeRoomBtn"');
  if(a < 0 || b < 0 || c < 0) throw new Error('缺按钮 '+a+','+b+','+c);
  if(!(a < b && b < c)) throw new Error('顺序不对 fullscreen='+a+' skip='+b+' close='+c);
});
check('15 enterGame 含 setBgmMode(room) 且 backToLobby 含 setBgmMode(lobby)', function(){
  var rl = fs.readFileSync(path.join(ROOT,'room-lifecycle.js'),'utf8');
  if(rl.indexOf("setBgmMode('room')") < 0 && rl.indexOf('setBgmMode("room")') < 0) throw new Error('enterGame 未找到 setBgmMode(room)');
  if(rl.indexOf("setBgmMode('lobby')") < 0 && rl.indexOf('setBgmMode("lobby")') < 0) throw new Error('backToLobby 未找到 setBgmMode(lobby)');
  // 粗略校验位置：enterGame 在 pauseBgVideo 之后
  var enterIdx = rl.indexOf('function enterGame');
  var pauseIdx = rl.indexOf('pauseBgVideo', enterIdx);
  var roomIdx = rl.indexOf("setBgmMode('room')", enterIdx);
  if(!(pauseIdx > 0 && roomIdx > pauseIdx)) throw new Error('setBgmMode(room) 不在 pauseBgVideo 之后');
  var backIdx = rl.indexOf('function backToLobby');
  var resumeIdx = rl.indexOf('resumeBgVideo', backIdx);
  var lobbyIdx = rl.indexOf("setBgmMode('lobby')", backIdx);
  if(!(resumeIdx > 0 && lobbyIdx > resumeIdx)) throw new Error('setBgmMode(lobby) 不在 resumeBgVideo 之后');
});
check('16 #bgmPlayer 紧跟 #bgVideo 之后', function(){
  var html = fs.readFileSync(path.join(ROOT,'index.html'),'utf8');
  var v = html.indexOf('id="bgVideo"');
  var a = html.indexOf('id="bgmPlayer"');
  if(v < 0 || a < 0) throw new Error('缺 bgVideo/bgmPlayer');
  if(!(v < a)) throw new Error('bgmPlayer 应在 bgVideo 之后');
  // 确保 audio 在 veil 之前或紧邻视频（简单校验距离 < 500 字符）
  if(a - v > 500) throw new Error('bgmPlayer 离 bgVideo 过远 '+(a-v));
});

// ---- Extra: consecutive-error fuse ----
check('17 单轨缺失连续 error 两次后熔断 off（room 单轨）', function(){
  var e = loadEnv();
  // 覆盖为单轨缺失
  e.run("BGM_TRACKS.room=['missing.mp3'];");
  e.run("setBgmMode('room')");
  var plays1 = e.bgmPlayer._plays;
  if(plays1 < 1) throw new Error('首播未触发 plays='+plays1);
  // 第一次 error -> 应重播同一首（还有一次机会）
  e.bgmPlayer.fire('error');
  var plays2 = e.bgmPlayer._plays;
  if(plays2 <= plays1) throw new Error('第一次 error 后应重播 plays '+plays1+'->'+plays2);
  if(e.bgmPlayer.paused) throw new Error('第一次 error 后不应 paused');
  // 第二次 error -> 熔断 off
  e.bgmPlayer.fire('error');
  if(e.bgmPlayer.paused !== true) throw new Error('第二次 error 后应 paused 熔断');
  var plays3 = e.bgmPlayer._plays;
  // 不应再有第三次 play
  e.bgmPlayer.fire('error');
  if(e.bgmPlayer._plays !== plays3) throw new Error('熔断后不应再 play '+plays3+'->'+e.bgmPlayer._plays);
});

console.log('\nBGM tests: '+passed+'/'+(passed+failed)+' passed');
if(failed) process.exit(1);
