/**
 * CORE-144(issue #197): 手机端不播大厅背景视频(平板/桌面维持现状)。
 *
 * 覆盖:
 *  1. 手机端:不设 src(连下载都不发生)、不播放、视频与遮罩都收起
 *  2. 平板/桌面:逐字维持现状(设 src + load + play + 显示视频与遮罩)
 *  3. 进房/回大厅往返:手机端始终不播,平板端照常恢复
 *  4. ★音轨解锁不被破坏(手机端不播大厅视频 ≠ 特效变哑)
 *  5. 已下载过的 src 会被释放(跨断点时不残留内存)
 *  6. pauseBgVideo 既有行为不变
 *  7. 破坏性验证:断言有鉴别力
 */
const vm = require('vm');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;
function check(name, fn){
  try { fn(); console.log('  PASS', name); passed++; }
  catch(e){ console.log('  FAIL', name, '-', (e && e.message) || e); failed++; }
}

function mkVideo(){
  const attrs = {};
  return {
    muted: true, _src: '', style: { visibility: 'hidden' },
    _plays: 0, _pauses: 0, _loads: 0, _removes: 0,
    get src(){ return this._src; },
    set src(v){ this._src = v; attrs.src = v; },
    getAttribute(k){ return k==='src' ? (attrs.src || '') : (attrs[k] || null); },
    setAttribute(k,v){ attrs[k]=v; if(k==='src') this._src=v; },
    removeAttribute(k){ delete attrs[k]; if(k==='src') this._src=''; this._removes++; },
    play(){ this._plays++; return { catch(){} }; },
    pause(){ this._pauses++; },
    load(){ this._loads++; },
    addEventListener(){}
  };
}

function mkEnv(viewport){
  const vp = Object.assign({ w:1400, h:900, dpr:1 }, viewport||{});
  const els = {
    bgVideo: mkVideo(), deathFxVideo: mkVideo(),
    lightningFxVideo: mkVideo(), movieFxVideo: mkVideo(),
    bgVeil: { style:{ visibility:'hidden' } },
    gameBgCanvas: { width:300, height:150, clientWidth:vp.w, clientHeight:vp.h,
      getContext(){ return { clearRect(){}, setTransform(){}, save(){}, restore(){},
        translate(){}, rotate(){}, beginPath(){}, moveTo(){}, lineTo(){},
        quadraticCurveTo(){}, closePath(){}, fill(){}, stroke(){}, fillText(){},
        set font(v){}, get font(){ return ''; } }; } }
  };
  const docListeners = {};
  const context = {
    Math, console, Number, String, Array, Object, Set, JSON,
    document: {
      hidden:false,
      getElementById(id){ return els[id] || null; },
      addEventListener(ev,fn){ (docListeners[ev]=docListeners[ev]||[]).push(fn); },
      removeEventListener(ev,fn){
        if(!docListeners[ev]) return;
        docListeners[ev] = docListeners[ev].filter(f => f!==fn);
      },
      body:{}, createElement(){ return { style:{}, classList:{add(){},remove(){}}, appendChild(){} }; },
      querySelector(){ return null; }, querySelectorAll(){ return []; }
    },
    window: {
      devicePixelRatio:vp.dpr, innerWidth:vp.w, innerHeight:vp.h,
      addEventListener(){}, removeEventListener(){},
      matchMedia(q){
        const mw = q.match(/max-width:\s*(\d+)px/);
        const mh = q.match(/max-height:\s*(\d+)px/);
        const wantLandscape = /orientation:\s*landscape/.test(q);
        let ok = true;
        if(mw) ok = ok && (context.window.innerWidth <= Number(mw[1]));
        if(mh) ok = ok && (context.window.innerHeight <= Number(mh[1]));
        if(wantLandscape) ok = ok && (context.window.innerWidth > context.window.innerHeight);
        return { matches: ok };
      },
      requestAnimationFrame(){ return 1; }, cancelAnimationFrame(){}
    },
    setTimeout(){ return 0; }, clearTimeout(){}
  };
  context.window.document = context.document;
  context.requestAnimationFrame = context.window.requestAnimationFrame;
  context.cancelAnimationFrame = context.window.cancelAnimationFrame;
  context.global = context;
  const sandbox = vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(ROOT,'game-bg.js'),'utf8'), sandbox, {filename:'game-bg.js'});
  return {
    sandbox, els, docListeners,
    get: e => vm.runInContext(e, sandbox),
    run: e => vm.runInContext(e, sandbox),
    fireDoc(ev){ (docListeners[ev]||[]).slice().forEach(f => f()); }
  };
}

console.log('\n' + '='.repeat(60));
console.log('  CORE-144:手机端不播大厅背景视频(平板/桌面不变)');
console.log('='.repeat(60) + '\n');

// 注意:game-bg.js 末尾有 `if(typeof document!=='undefined') pickRandomBgVideo();`
// ——加载即执行一次,所以下面多数用例直接看加载后的状态即可(等同"页面首次进大厅")。

// ---------- 1. 手机端 ----------
check('手机横屏(844x390):页面加载后不设 src(连下载都不发生)', () => {
  const e = mkEnv({w:844,h:390,dpr:3});
  if(e.els.bgVideo.src) throw new Error('不应设置 src,实际 ' + e.els.bgVideo.src);
});

check('手机横屏:不调用 play()', () => {
  const e = mkEnv({w:844,h:390,dpr:3});
  if(e.els.bgVideo._plays !== 0) throw new Error('不应播放,实际 play ' + e.els.bgVideo._plays + ' 次');
});

check('手机竖屏(390x844):同样不设 src、不播放', () => {
  const e = mkEnv({w:390,h:844,dpr:3});
  if(e.els.bgVideo.src) throw new Error('不应设置 src');
  if(e.els.bgVideo._plays !== 0) throw new Error('不应播放');
});

check('手机端:视频与遮罩都收起(回到 body 默认渐变背景)', () => {
  const e = mkEnv({w:844,h:390,dpr:3});
  if(e.els.bgVideo.style.visibility !== 'hidden') throw new Error('视频应隐藏');
  if(e.els.bgVeil.style.visibility !== 'hidden') throw new Error('遮罩应隐藏');
});

// ---------- 2. 平板/桌面维持现状 ----------
check('平板(1024x768):照常设 src + load + play(与改动前一致)', () => {
  const e = mkEnv({w:1024,h:768,dpr:2});
  if(!/assets\/video\/bg-[123]\.mp4/.test(e.els.bgVideo.src))
    throw new Error('应设置随机背景视频 src,实际 ' + e.els.bgVideo.src);
  if(e.els.bgVideo._plays !== 1) throw new Error('应播放 1 次,实际 ' + e.els.bgVideo._plays);
  if(e.els.bgVideo._loads < 1) throw new Error('应调用 load()');
});

check('平板:视频可见(与改动前一致)', () => {
  const e = mkEnv({w:1024,h:768,dpr:2});
  if(e.els.bgVideo.style.visibility !== 'visible') throw new Error('视频应可见');
});

check('桌面(1400x900):照常设 src + play', () => {
  const e = mkEnv({w:1400,h:900,dpr:1});
  if(!e.els.bgVideo.src) throw new Error('应设置 src');
  if(e.els.bgVideo._plays !== 1) throw new Error('应播放');
});

check('小平板(800x600,高度>460):不被手机横屏那条误命中,照常播放', () => {
  const e = mkEnv({w:800,h:600,dpr:2});
  if(!e.els.bgVideo.src) throw new Error('800x600 是平板,应照常播放');
});

// ---------- 3. 进房/回大厅往返 ----------
check('平板:进房 pauseBgVideo 暂停并隐藏,回大厅 resumeBgVideo 恢复播放', () => {
  const e = mkEnv({w:1024,h:768,dpr:2});
  e.run('pauseBgVideo()');
  if(e.els.bgVideo._pauses !== 1) throw new Error('应暂停');
  if(e.els.bgVideo.style.visibility !== 'hidden') throw new Error('应隐藏');
  if(e.els.bgVeil.style.visibility !== 'hidden') throw new Error('遮罩应隐藏');
  const playsBefore = e.els.bgVideo._plays;
  e.run('resumeBgVideo()');
  if(e.els.bgVideo._plays !== playsBefore + 1) throw new Error('回大厅应重新播放');
  if(e.els.bgVideo.style.visibility !== 'visible') throw new Error('视频应恢复可见');
  if(e.els.bgVeil.style.visibility !== 'visible') throw new Error('遮罩应恢复可见');
});

check('手机:回大厅 resumeBgVideo 仍不播放、遮罩不显示', () => {
  const e = mkEnv({w:844,h:390,dpr:3});
  e.run('pauseBgVideo()');
  e.run('resumeBgVideo()');
  if(e.els.bgVideo._plays !== 0) throw new Error('手机端任何时候都不该播放,实际 ' + e.els.bgVideo._plays);
  if(e.els.bgVideo.src) throw new Error('不该设 src');
  if(e.els.bgVeil.style.visibility !== 'hidden')
    throw new Error('没有视频时遮罩不该显示(否则只是把默认渐变再压暗一层)');
});

check('手机:反复往返多次都不播放、不下载', () => {
  const e = mkEnv({w:844,h:390,dpr:3});
  for(let i=0;i<5;i++){ e.run('pauseBgVideo()'); e.run('resumeBgVideo()'); }
  if(e.els.bgVideo._plays !== 0) throw new Error('实际播放 ' + e.els.bgVideo._plays + ' 次');
  if(e.els.bgVideo.src) throw new Error('不该设 src');
});

// ---------- 4. ★音轨解锁不被破坏 ----------
check('★手机端首次交互仍解锁全部特效音轨(不播大厅视频≠特效变哑)', () => {
  const e = mkEnv({w:844,h:390,dpr:3});
  ['bgVideo','deathFxVideo','lightningFxVideo','movieFxVideo'].forEach(id => {
    if(e.els[id].muted !== true) throw new Error('前置:' + id + ' 初始应静音');
  });
  e.fireDoc('click');   // 模拟首次用户手势
  ['deathFxVideo','lightningFxVideo','movieFxVideo'].forEach(id => {
    if(e.els[id].muted !== false)
      throw new Error(id + ' 应被解锁为有声——手机端不播大厅视频不该影响特效音轨');
  });
  if(e.get('fxAudioUnlocked') !== true) throw new Error('fxAudioUnlocked 应为 true');
});

check('手机端 applyFxAudio 在解锁后仍能给特效视频取消静音', () => {
  const e = mkEnv({w:844,h:390,dpr:3});
  e.fireDoc('click');
  const v = { muted:true };
  e.sandbox.__v = v;
  e.run('applyFxAudio(__v)');
  if(v.muted !== false) throw new Error('applyFxAudio 应取消静音');
});

// ---------- 5. 释放已下载的 src ----------
check('已设过 src 后走收起分支:会 removeAttribute("src")+load() 释放', () => {
  const e = mkEnv({w:1024,h:768,dpr:2});   // 先按平板加载,src 已设
  if(!e.els.bgVideo.src) throw new Error('前置:平板应已设 src');
  const removesBefore = e.els.bgVideo._removes;
  e.sandbox.window.innerWidth = 844; e.sandbox.window.innerHeight = 390;  // 变成手机
  e.run('pickRandomBgVideo()');
  if(e.els.bgVideo._removes <= removesBefore) throw new Error('应释放已下载的 src');
  if(e.els.bgVideo.src) throw new Error('src 应被清空');
});

check('从未设过 src 时不调 load()(避免无源警告)', () => {
  const e = mkEnv({w:844,h:390,dpr:3});
  // 加载即执行过一次 pickRandomBgVideo,走的是收起分支且 src 从未设过
  if(e.els.bgVideo._loads !== 0)
    throw new Error('没有 src 时不该调 load(),实际 ' + e.els.bgVideo._loads + ' 次');
});

// ---------- 6. pauseBgVideo 既有行为不变 ----------
check('pauseBgVideo 源码未被本次改动触碰(仍是 pause+隐藏视频+隐藏遮罩)', () => {
  const e = mkEnv();
  const src = e.get('String(pauseBgVideo)');
  if(!/pause\(\)/.test(src)) throw new Error('应仍调用 pause()');
  if(!/visibility = 'hidden'/.test(src)) throw new Error('应仍隐藏视频');
  if(!/bgVeil/.test(src)) throw new Error('应仍隐藏遮罩');
  if(/shouldPlayLobbyVideo|isPhoneLayout/.test(src))
    throw new Error('pauseBgVideo 不应引入本次新增的判定(它对所有设备行为一致)');
});

// ---------- 7. 破坏性验证 ----------
check('破坏性验证:让 shouldPlayLobbyVideo 恒 true(=关掉本次限制),手机端断言确实会红', () => {
  const e = mkEnv({w:844,h:390,dpr:3});
  e.run('shouldPlayLobbyVideo = function(){ return true; };');
  e.run('pickRandomBgVideo()');
  if(!e.els.bgVideo.src)
    throw new Error('关掉限制后手机端仍不设 src,说明手机端断言没有鉴别力');
  if(e.els.bgVideo._plays === 0)
    throw new Error('关掉限制后手机端应播放(= 改动前行为)');
  console.log('       ↳ 关掉限制后手机端确实会加载 ' + e.els.bgVideo.src + ' 并播放(= 改动前行为)');
});

console.log('\n结果: ' + passed + ' 通过, ' + failed + ' 失败');
if(failed > 0) process.exit(1);
