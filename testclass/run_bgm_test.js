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
// CORE-194:BGM 静音改成有自己的 localStorage 键(sgs_bgm_muted)+顶栏按钮(#bgmMuteBtn),
// 所以沙箱要能注入这两样。opts.store 为初始 localStorage 内容,opts.withBtn 决定是否提供按钮。
function mkStore(init){
  var data = Object.assign({}, init||{});
  return {
    data: data,
    getItem: function(k){ return Object.prototype.hasOwnProperty.call(data,k) ? data[k] : null; },
    setItem: function(k,v){ data[k] = String(v); },
    removeItem: function(k){ delete data[k]; }
  };
}
function mkMuteBtn(){
  return { id:'bgmMuteBtn', textContent:'', title:'', _attrs:{},
    setAttribute:function(k,v){ this._attrs[k]=v; }, getAttribute:function(k){ return this._attrs[k]; } };
}
function loadEnv(opts){
  opts = opts || {};
  var bgmPlayer = mkBgmPlayer();
  var bgVideo = mkVideo();
  // 让 bgmPlayer 的 fire 能触发 bgm 引擎绑定的 ended/error
  // brief 中的 fire 是 bgmPlayer.fire('ended')
  var canvas = { width:300,height:150,clientWidth:800,clientHeight:600,getContext:function(){ return {clearRect:function(){},setTransform:function(){},save:function(){},restore:function(){},translate:function(){},rotate:function(){},beginPath:function(){},moveTo:function(){},lineTo:function(){},closePath:function(){},fill:function(){},stroke:function(){},fillText:function(){}}; }};
  var otherVideos = { deathFxVideo: mkVideo(), lightningFxVideo: mkVideo(), movieFxVideo: mkVideo(), girlFxVideo: mkVideo() };
  var listeners = { doc: {}, win: {} };
  var muteBtn = (opts.withBtn===false) ? null : mkMuteBtn();
  var store = mkStore(opts.store);
  var context = {
    localStorage: store,
    Math: Math, console: console, Number: Number, String: String, Array: Array, Object: Object, Set: Set,
    document: {
      hidden: false,
      getElementById: function(id){
        if(id==='bgmPlayer') return bgmPlayer;
        if(id==='bgVideo') return bgVideo;
        if(id==='gameBgCanvas') return canvas;
        if(id==='bgVeil') return { style:{} };
        if(id==='bgmMuteBtn') return muteBtn;
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
  // 首页 initLobbyBgm 会在加载时起播；单测要干净起点，清掉自动 lobby
  try { vm.runInContext("bgmMode=null; bgmLobbyPlays=0; bgmLastSrc=null; bgmHold=false;", sandbox); } catch(e) {}
  bgmPlayer.src=''; bgmPlayer._plays=0; bgmPlayer.paused=true;
  var get = function(expr){ return vm.runInContext(expr, sandbox); };
  var run = function(expr){ return vm.runInContext(expr, sandbox); };
  return { sandbox: sandbox, bgmPlayer: bgmPlayer, bgVideo: bgVideo, get: get, run: run,
           store: store, muteBtn: muteBtn };
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

check('18 render.js 含 maybeUpdateBgm', function(){
  var src = fs.readFileSync(path.join(ROOT,'render.js'),'utf8');
  if(src.indexOf('function maybeUpdateBgm') < 0) throw new Error('未找到 maybeUpdateBgm');
  if(src.indexOf('maybeUpdateBgm(g)') < 0 && src.indexOf('maybeUpdateBgm(') < 0) throw new Error('render 未调用 maybeUpdateBgm');
});
// 【19 号用例已按 CORE-194(issue #256)改写】原断言是"toggleChatVoice 必须含 setBgmMuted"
// ——它钉住的正是被拆掉的那处耦合(聊天语音开关顺带静音背景音乐),命题已经反过来了,
// 不能留着继续绿。现在只保留"聊天语音开关本身还在、状态仍持久化"这部分仍然成立的语义;
// "不得再调用 setBgmMuted" 这条反向断言在下面的 22j。
check('19 render-log.js toggleChatVoice 仍在且仍持久化聊天语音开关(与BGM无关的那部分)', function(){
  var src = fs.readFileSync(path.join(ROOT,'render-log.js'),'utf8');
  var idx = src.indexOf('function toggleChatVoice');
  if(idx < 0) throw new Error('未找到 toggleChatVoice');
  var snippet = src.slice(idx, idx+800);
  if(snippet.indexOf('chatVoiceEnabled') < 0) throw new Error('未切换 chatVoiceEnabled');
  if(snippet.indexOf("sgs_chat_voice") < 0) throw new Error('未持久化聊天语音开关');
});
check('20 hold 期间 maybeUpdateBgm 不切档（真实现）', function(){
  var e = loadEnv();
  // 从 render.js 抽取真实 maybeUpdateBgm 实现（防拷贝漂移）
  var src = fs.readFileSync(path.join(ROOT,'render.js'),'utf8');
  var start = src.indexOf('function maybeUpdateBgm');
  var end = src.indexOf('function resetRenderSentinels');
  if(start < 0 || end < 0 || end <= start) throw new Error('未找到 maybeUpdateBgm 真实现切片');
  var fnSrc = src.slice(start, end);
  e.run(fnSrc);
  // 注入 inGame DOM 桩：默认 inGame=true（避免切 lobby）
  e.sandbox.document.getElementById = (function(orig){
    return function(id){
      if(id==='game') return { classList:{ contains:function(c){ return c!=='hidden'?false:true; } } };
      return orig.call(this, id);
    };
  })(e.sandbox.document.getElementById);
  // 需额外绑定 bgmEl 指向的 bgmPlayer 保持不变（复用 orig）
  e.run("setBgmMode('game')");
  if(e.get('bgmMode')!=='game') throw new Error('前置 game 失败 '+e.get('bgmMode'));
  e.run("beginBgmHold()");
  // 尝试切 duel（hold 期间应被短路）
  e.run("maybeUpdateBgm({started:true, players:[{alive:true},{alive:true}]})");
  if(e.get('bgmMode')!=='game') throw new Error('hold 时不应切档，实际 '+e.get('bgmMode'));
});
check('21 hold 期间 ended 应切回 room', function(){
  var e = loadEnv();
  e.run("setBgmMode('game')");
  e.run("beginBgmHold()");
  if(!e.get('bgmHold')) throw new Error('hold 未生效');
  e.bgmPlayer.fire('ended');
  if(e.get('bgmMode')!=='room') throw new Error('ended 后应 room，实际 '+e.get('bgmMode'));
  if(e.get('bgmHold')) throw new Error('ended 后 hold 应清除');
});
// ============ CORE-194(issue #256):BGM 静音与聊天语音解耦 + 顶栏静音按钮 ============
// 【为什么原来的 22 号用例被整体改写】它断言的是"chatVoiceEnabled=false 时 game-bg.js 加载
// 即静音"——那正是 CORE-194 要拆掉的耦合(背景音乐和聊天语音播报两条互不相关的通道共用一个
// 开关)。断言的命题本身已经不成立,不能让它继续绿着,所以按新设计整体重写:静音状态改由
// 自己的 localStorage 键 sgs_bgm_muted 决定,只在该键从未设置过时一次性继承老用户的
// sgs_chat_voice(迁移),此后完全独立。
check('22a 默认(无任何存储)不静音', function(){
  var e = loadEnv();
  if(e.get('bgmMuted')!==false) throw new Error('默认应不静音,实际 '+e.get('bgmMuted'));
});
check('22b sgs_bgm_muted="1" 时初始即静音', function(){
  var e = loadEnv({ store:{ sgs_bgm_muted:'1' } });
  if(e.get('bgmMuted')!==true) throw new Error('应静音,实际 '+e.get('bgmMuted'));
});
check('22c sgs_bgm_muted="0" 时不静音(显式设置优先)', function(){
  var e = loadEnv({ store:{ sgs_bgm_muted:'0' } });
  if(e.get('bgmMuted')!==false) throw new Error('应不静音,实际 '+e.get('bgmMuted'));
});
check('22d 老用户迁移:只有 sgs_chat_voice="0"(BGM 键未设置过)时继承为静音', function(){
  var e = loadEnv({ store:{ sgs_chat_voice:'0' } });
  if(e.get('bgmMuted')!==true) throw new Error('老用户应继承静音,实际 '+e.get('bgmMuted'));
});
check('22e 一旦显式设置过 BGM 键,就不再看聊天语音(两者独立)', function(){
  var e = loadEnv({ store:{ sgs_chat_voice:'0', sgs_bgm_muted:'0' } });
  if(e.get('bgmMuted')!==false) throw new Error('显式的 BGM 偏好应优先于聊天语音,实际 '+e.get('bgmMuted'));
});
check('22f toggleBgmMute 切换状态、暂停/恢复播放、并写入 localStorage', function(){
  var e = loadEnv();
  e.run("setBgmMode('game')");
  var pausesBefore = e.bgmPlayer._pauses;
  if(e.run('toggleBgmMute()')!==true) throw new Error('第一次点击应变为静音');
  if(e.get('bgmMuted')!==true) throw new Error('bgmMuted 应为 true');
  if(e.bgmPlayer._pauses <= pausesBefore) throw new Error('静音应 pause(不是仅仅音量为0)');
  if(e.store.getItem('sgs_bgm_muted')!=='1') throw new Error('应写入 localStorage,实际 '+e.store.getItem('sgs_bgm_muted'));
  var playsBefore = e.bgmPlayer._plays;
  if(e.run('toggleBgmMute()')!==false) throw new Error('第二次点击应恢复');
  if(e.bgmPlayer._plays <= playsBefore) throw new Error('取消静音应恢复播放');
  if(e.store.getItem('sgs_bgm_muted')!=='0') throw new Error('应写入 0,实际 '+e.store.getItem('sgs_bgm_muted'));
});
check('22g 按钮图标/title/aria-pressed 随状态同步', function(){
  var e = loadEnv();
  if(e.muteBtn.textContent!=='🔊') throw new Error('初始应为 🔊,实际 '+e.muteBtn.textContent);
  e.run('toggleBgmMute()');
  if(e.muteBtn.textContent!=='🔇') throw new Error('静音后应为 🔇,实际 '+e.muteBtn.textContent);
  if(e.muteBtn.getAttribute('aria-pressed')!=='true') throw new Error('aria-pressed 应为 true');
  if(e.muteBtn.title.indexOf('背景音乐')<0) throw new Error('title 应点明是背景音乐,实际 '+e.muteBtn.title);
  e.run('toggleBgmMute()');
  if(e.muteBtn.textContent!=='🔊') throw new Error('恢复后应为 🔊');
  if(e.muteBtn.getAttribute('aria-pressed')!=='false') throw new Error('aria-pressed 应为 false');
});
check('22h 静音状态跨切档保持(lobby/room/game/duel 切换不会把音乐放出来)', function(){
  var e = loadEnv({ store:{ sgs_bgm_muted:'1' } });
  ['lobby','room','game','duel'].forEach(function(m){
    e.run("setBgmMode('"+m+"')");
    if(e.get('bgmMuted')!==true) throw new Error(m+' 档后静音状态丢失');
    if(e.bgmPlayer.paused!==true) throw new Error(m+' 档后不应在播放');
  });
});
check('22i 没有按钮元素时不报错(脚本先于 DOM 加载 / 大厅页面)', function(){
  var e = loadEnv({ withBtn:false });
  e.run('toggleBgmMute()');   // 不应抛异常
  if(e.get('bgmMuted')!==true) throw new Error('无按钮时状态仍应切换');
});
check('22j 聊天语音开关不再影响背景音乐(解耦)', function(){
  var src = fs.readFileSync(path.join(ROOT,'render-log.js'),'utf8');
  var body = src.slice(src.indexOf('function toggleChatVoice()'));
  body = body.slice(0, body.indexOf('\n}'));
  // 剔除注释行再检查:改动处留了说明注释,里面会提到 setBgmMuted
  var code = body.split('\n').map(function(l){ return l.replace(/\/\/.*$/,''); }).join('\n');
  if(/setBgmMuted/.test(code)) throw new Error('toggleChatVoice 不应再调用 setBgmMuted');
});
check('22k index.html 里静音按钮已接线到 toggleBgmMute', function(){
  var html = fs.readFileSync(path.join(ROOT,'index.html'),'utf8');
  if(html.indexOf('id="bgmMuteBtn"')<0) throw new Error('顶栏缺少 #bgmMuteBtn');
  var seg = html.slice(html.indexOf('id="bgmMuteBtn"'));
  seg = seg.slice(0, seg.indexOf('</button>'));
  if(seg.indexOf('toggleBgmMute()')<0) throw new Error('按钮未接线到 toggleBgmMute');
  if(seg.indexOf('icon-btn')<0) throw new Error('应沿用既有 .icon-btn 样式(触屏点击区)');
});

check('23 首页加载 initLobbyBgm 进入 lobby 档', function(){
  var e = loadEnv();
  e.run("if(typeof initLobbyBgm==='function') initLobbyBgm(); else setBgmMode('lobby');");
  var mode = e.get('bgmMode');
  if(mode!=='lobby') throw new Error('mode='+mode);
  var src = e.bgmPlayer.src;
  if(src!=='a.mp3' && src!=='b.mp3') throw new Error('src='+src);
});

check('24 unmuteBgVideo 在 autoplay 被拒后补 play', function(){
  var e = loadEnv();
  e.run("setBgmMode('lobby')");
  e.bgmPlayer.paused = true;
  var plays = e.bgmPlayer._plays;
  e.run('unmuteBgVideo()');
  if(e.bgmPlayer.paused) throw new Error('手势解锁后应 play');
  if(e.bgmPlayer._plays <= plays) throw new Error('应再调 play');
});

check('25 unmuteBgVideo 可反复补 play（keydown 用掉手势后点击还能救）', function(){
  var e = loadEnv();
  e.run("setBgmMode('lobby')");
  e.bgmPlayer.paused = true;
  e.run('unmuteBgVideo()');
  e.bgmPlayer.paused = true;
  var plays = e.bgmPlayer._plays;
  e.run('unmuteBgVideo()');
  if(e.bgmPlayer._plays <= plays) throw new Error('第二次仍应 play, plays '+plays+' -> '+e.bgmPlayer._plays);
});

console.log('\nBGM tests: '+passed+'/'+(passed+failed)+' passed');
if(failed) process.exit(1);
