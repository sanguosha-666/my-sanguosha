/**
 * CORE-141(issue #194): 手机端不跑全屏 Canvas 飘牌动画,平板/桌面维持现状。
 *
 * 覆盖:
 *  1. isPhoneLayout 的设备判定(含"手机横屏宽度落在平板区间"这个最容易做错的场景)
 *  2. JS 判定与 index.html 的 CSS 手机断点对账(防止以后改了 CSS 而 JS 不同步)
 *  3. 手机端 startGameBg 不起 rAF、不分配画布 backing store
 *  4. 平板/桌面逐字维持现状(起 rAF + 分配画布)
 *  5. 切后台暂停/回前台恢复(改动前的既有行为)不被破坏
 *  6. 方向/尺寸变化时判定跟着变(两个方向都测)
 *  7. stopGameBg 的特效视频清理在手机端仍然生效
 *  8. 破坏性验证:断言有鉴别力
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
  return { muted:true, src:'', style:{visibility:'hidden'}, _removed:0,
    play(){ return {catch(){}}; }, pause(){}, load(){},
    addEventListener(){}, removeAttribute(){ this._removed++; } };
}

// mkEnv:构造一个可控视口的沙箱。viewport={w,h,dpr}；hasMatchMedia=false 可测兜底分支。
function mkEnv(viewport, hasMatchMedia){
  const vp = Object.assign({ w:1400, h:900, dpr:1 }, viewport||{});
  const canvasCalls = { clearRect:0, setTransform:0 };
  const canvas = {
    width:300, height:150,           // <canvas> 未显式设置时的默认 backing store
    clientWidth: vp.w, clientHeight: vp.h,
    getContext(){ return {
      clearRect(){ canvasCalls.clearRect++; },
      setTransform(){ canvasCalls.setTransform++; },
      save(){}, restore(){}, translate(){}, rotate(){}, beginPath(){}, moveTo(){},
      lineTo(){}, quadraticCurveTo(){}, closePath(){}, fill(){}, stroke(){}, fillText(){},
      set font(v){}, get font(){ return ''; }
    }; }
  };
  const videos = { bgVideo:mkVideo(), deathFxVideo:mkVideo(), lightningFxVideo:mkVideo(), movieFxVideo:mkVideo() };
  const listeners = { window:{}, document:{} };
  let rafSeq = 0;
  const raf = { pending:new Set(), cancels:0, requests:0 };

  const context = {
    Math, console, Number, String, Array, Object, Set,
    document: {
      hidden: false,
      getElementById(id){ return id==='gameBgCanvas' ? canvas : (videos[id] || null); },
      addEventListener(ev, fn){ (listeners.document[ev]=listeners.document[ev]||[]).push(fn); },
      removeEventListener(){}, body:{}, createElement(){ return { style:{}, classList:{add(){},remove(){}}, appendChild(){}, }; },
      querySelector(){ return null; }, querySelectorAll(){ return []; }
    },
    window: {
      devicePixelRatio: vp.dpr, innerWidth: vp.w, innerHeight: vp.h,
      addEventListener(ev, fn){ (listeners.window[ev]=listeners.window[ev]||[]).push(fn); },
      removeEventListener(){},
      matchMedia: hasMatchMedia===false ? undefined : function(q){
        // 只实现本次用到的两条手机断点 + 解析它们的数值,行为等价于浏览器
        const mw = q.match(/max-width:\s*(\d+)px/);
        const mh = q.match(/max-height:\s*(\d+)px/);
        const wantLandscape = /orientation:\s*landscape/.test(q);
        let ok = true;
        if(mw) ok = ok && (context.window.innerWidth <= Number(mw[1]));
        if(mh) ok = ok && (context.window.innerHeight <= Number(mh[1]));
        if(wantLandscape) ok = ok && (context.window.innerWidth > context.window.innerHeight);
        return { matches: ok };
      },
      requestAnimationFrame(fn){ rafSeq++; raf.requests++; raf.pending.add(rafSeq); return rafSeq; },
      cancelAnimationFrame(id){ raf.cancels++; raf.pending.delete(id); }
    },
    setTimeout(){ return 0; }, clearTimeout(){}
  };
  context.window.document = context.document;
  context.requestAnimationFrame = context.window.requestAnimationFrame;
  context.cancelAnimationFrame = context.window.cancelAnimationFrame;
  context.global = context;
  const sandbox = vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(ROOT,'game-bg.js'),'utf8'), sandbox, {filename:'game-bg.js'});
  const get = expr => vm.runInContext(expr, sandbox);
  const run = expr => vm.runInContext(expr, sandbox);
  return { sandbox, get, run, canvas, videos, listeners, raf, canvasCalls,
    setViewport(w,h){ context.window.innerWidth=w; context.window.innerHeight=h;
      canvas.clientWidth=w; canvas.clientHeight=h; },
    fire(target, ev){ (listeners[target][ev]||[]).forEach(f=>f()); } };
}

console.log('\n' + '='.repeat(60));
console.log('  CORE-141:手机端不跑飘牌动画(平板/桌面不变)');
console.log('='.repeat(60) + '\n');

// ---------- 1. 设备判定 ----------
check('手机竖屏(390x844) → 判为手机', () => {
  const e = mkEnv({w:390,h:844,dpr:3});
  if(e.get('isPhoneLayout()') !== true) throw new Error('应判为手机');
});

check('★手机横屏(844x390,宽度落在平板区间) → 仍判为手机(本次最易做错的场景)', () => {
  const e = mkEnv({w:844,h:390,dpr:3});
  if(e.get('isPhoneLayout()') !== true)
    throw new Error('844px 宽落在平板断点(641~1199)内,必须靠 max-height:460 那条判成手机');
});

check('iPhone SE 横屏(667x375) → 判为手机', () => {
  const e = mkEnv({w:667,h:375,dpr:2});
  if(e.get('isPhoneLayout()') !== true) throw new Error('应判为手机');
});

check('平板横屏(1024x768) → 不是手机', () => {
  const e = mkEnv({w:1024,h:768,dpr:2});
  if(e.get('isPhoneLayout()') !== false) throw new Error('平板不应判为手机');
});

check('平板竖屏(768x1024) → 不是手机', () => {
  const e = mkEnv({w:768,h:1024,dpr:2});
  if(e.get('isPhoneLayout()') !== false) throw new Error('平板不应判为手机');
});

check('小平板(800x600,高度>460) → 不是手机', () => {
  const e = mkEnv({w:800,h:600,dpr:2});
  if(e.get('isPhoneLayout()') !== false) throw new Error('高度 600>460,不该被横屏那条命中');
});

check('桌面(1400x900) → 不是手机', () => {
  const e = mkEnv({w:1400,h:900,dpr:1});
  if(e.get('isPhoneLayout()') !== false) throw new Error('桌面不应判为手机');
});

check('无 matchMedia 的环境:兜底分支与 matchMedia 分支结论一致', () => {
  [[390,844,true],[844,390,true],[667,375,true],[1024,768,false],[800,600,false],[1400,900,false]]
    .forEach(([w,h,want]) => {
      const e = mkEnv({w,h,dpr:2}, false);
      if(e.get('isPhoneLayout()') !== want)
        throw new Error(w+'x'+h+' 兜底判定应为 '+want+',实际 '+e.get('isPhoneLayout()'));
    });
});

// ---------- 2. 与 CSS 断点对账 ----------
check('JS 判定用的媒体查询与 index.html 的手机断点逐字对账', () => {
  const html = fs.readFileSync(path.join(ROOT,'index.html'),'utf8');
  const e = mkEnv();
  const qs = e.get('JSON.stringify(BG_PHONE_MEDIA_QUERIES)');
  const list = JSON.parse(qs);
  if(list.length !== 2) throw new Error('应为两条断点,实际 ' + qs);
  // CSS 里这两条断点必须真实存在——否则说明 CSS 改了而这里没同步
  const norm = t => t.replace(/\s+/g,'');
  if(norm(html).indexOf(norm('@media (max-width:640px)')) < 0)
    throw new Error('index.html 里找不到手机竖屏断点 @media (max-width:640px)');
  if(norm(html).indexOf(norm('@media (max-height:460px) and (orientation:landscape)')) < 0)
    throw new Error('index.html 里找不到手机横屏断点 @media (max-height:460px) and (orientation:landscape)');
  list.forEach(q => {
    if(norm(html).indexOf(norm(q)) < 0)
      throw new Error('JS 用的查询「'+q+'」在 index.html 里不存在,两边口径已分叉');
  });
});

// ---------- 3. 手机端:不起 rAF、不分配画布 ----------
check('手机端 startGameBg:不起 rAF', () => {
  const e = mkEnv({w:844,h:390,dpr:3});
  e.run('startGameBg()');
  if(e.get('bgRafId') !== 0) throw new Error('手机端不应起 rAF,bgRafId=' + e.get('bgRafId'));
  if(e.raf.requests !== 0) throw new Error('不应调用 requestAnimationFrame,实际 ' + e.raf.requests + ' 次');
});

check('手机端 startGameBg:不分配画布 backing store(省 ~11.8MB)', () => {
  const e = mkEnv({w:844,h:390,dpr:3});
  e.run('startGameBg()');
  if(e.canvas.width !== 300 || e.canvas.height !== 150)
    throw new Error('手机端画布应保持默认 300x150,实际 ' + e.canvas.width + 'x' + e.canvas.height
      + '(844x390@DPR3 会分配 2532x1170 ≈ 11.8MB)');
});

check('手机端 bgRunning 仍为 true(在对局中这个语义不变,只是不画)', () => {
  const e = mkEnv({w:844,h:390,dpr:3});
  e.run('startGameBg()');
  if(e.get('bgRunning') !== true) throw new Error('bgRunning 应为 true');
});

// ---------- 4. 平板/桌面:逐字维持现状 ----------
check('平板 startGameBg:照常起 rAF(与改动前一致)', () => {
  const e = mkEnv({w:1024,h:768,dpr:2});
  e.run('startGameBg()');
  if(!e.get('bgRafId')) throw new Error('平板应起 rAF');
  if(e.raf.requests !== 1) throw new Error('应恰调用 1 次 rAF,实际 ' + e.raf.requests);
});

check('平板 startGameBg:照常按 DPR 分配画布(与改动前一致)', () => {
  const e = mkEnv({w:1024,h:768,dpr:2});
  e.run('startGameBg()');
  if(e.canvas.width !== 2048 || e.canvas.height !== 1536)
    throw new Error('应为 1024*2 x 768*2,实际 ' + e.canvas.width + 'x' + e.canvas.height);
});

check('桌面 startGameBg:照常起 rAF + 分配画布', () => {
  const e = mkEnv({w:1400,h:900,dpr:1});
  e.run('startGameBg()');
  if(!e.get('bgRafId')) throw new Error('桌面应起 rAF');
  if(e.canvas.width !== 1400 || e.canvas.height !== 900)
    throw new Error('实际 ' + e.canvas.width + 'x' + e.canvas.height);
});

// ---------- 5. 切后台/回前台(既有行为不被破坏) ----------
check('平板:切后台暂停 rAF、回前台恢复(改动前的既有行为)', () => {
  const e = mkEnv({w:1024,h:768,dpr:2});
  e.run('startGameBg()');
  if(!e.get('bgRafId')) throw new Error('前置:应已起 rAF');
  e.sandbox.document.hidden = true;
  e.fire('document','visibilitychange');
  if(e.get('bgRafId') !== 0) throw new Error('切后台应停 rAF');
  e.sandbox.document.hidden = false;
  e.fire('document','visibilitychange');
  if(!e.get('bgRafId')) throw new Error('回前台应恢复 rAF');
});

check('手机:回前台也不恢复 rAF(手机限制优先于可见性)', () => {
  const e = mkEnv({w:844,h:390,dpr:3});
  e.run('startGameBg()');
  e.sandbox.document.hidden = true;  e.fire('document','visibilitychange');
  e.sandbox.document.hidden = false; e.fire('document','visibilitychange');
  if(e.get('bgRafId') !== 0) throw new Error('手机端任何时候都不该起 rAF');
});

check('回大厅后(bgRunning=false)回前台不恢复 rAF', () => {
  const e = mkEnv({w:1024,h:768,dpr:2});
  e.run('startGameBg()'); e.run('stopGameBg()');
  e.sandbox.document.hidden = false;
  e.fire('document','visibilitychange');
  if(e.get('bgRafId') !== 0) throw new Error('不在对局中不该起 rAF');
});

// ---------- 6. 方向/尺寸变化 ----------
check('桌面窗口拉窄到手机宽度 → 停 rAF 并清屏', () => {
  const e = mkEnv({w:1400,h:900,dpr:1});
  e.run('startGameBg()');
  if(!e.get('bgRafId')) throw new Error('前置:应已起 rAF');
  const clearsBefore = e.canvasCalls.clearRect;
  e.setViewport(500, 900);           // 宽度 500 ≤ 640 → 手机
  e.fire('window','resize');
  if(e.get('bgRafId') !== 0) throw new Error('拉窄到手机宽度后应停 rAF');
  if(e.canvasCalls.clearRect <= clearsBefore) throw new Error('停下来时应清一次屏,避免最后一帧定格');
});

check('窗口从手机宽度拉回桌面 → 重新起 rAF 并补分配画布', () => {
  const e = mkEnv({w:500,h:900,dpr:2});
  e.run('startGameBg()');
  if(e.get('bgRafId') !== 0) throw new Error('前置:手机宽度不应起 rAF');
  if(e.canvas.width !== 300) throw new Error('前置:不应分配画布');
  e.setViewport(1400, 900);
  e.fire('window','resize');
  if(!e.get('bgRafId')) throw new Error('拉回桌面应重新起 rAF');
  if(e.canvas.width !== 2800 || e.canvas.height !== 1800)
    throw new Error('起循环前应补 sizeBgCanvas,实际 ' + e.canvas.width + 'x' + e.canvas.height);
});

check('orientationchange 同样触发重新评估(部分移动浏览器 resize 时机不可靠)', () => {
  const e = mkEnv({w:1400,h:900,dpr:1});
  e.run('startGameBg()');
  e.setViewport(844, 390);
  e.fire('window','orientationchange');
  if(e.get('bgRafId') !== 0) throw new Error('orientationchange 后应按手机停掉');
});

check('手机端 resize 不会分配画布(反复旋转也不占内存)', () => {
  const e = mkEnv({w:844,h:390,dpr:3});
  e.run('startGameBg()');
  e.setViewport(390, 844); e.fire('window','orientationchange');
  e.setViewport(844, 390); e.fire('window','orientationchange');
  if(e.canvas.width !== 300 || e.canvas.height !== 150)
    throw new Error('手机端反复旋转仍不应分配画布,实际 ' + e.canvas.width + 'x' + e.canvas.height);
});

check('applyBgAnimationPolicy 幂等:重复调用不会起多个循环', () => {
  const e = mkEnv({w:1400,h:900,dpr:1});
  e.run('startGameBg()');
  const n = e.raf.requests;
  e.run('applyBgAnimationPolicy(); applyBgAnimationPolicy(); applyBgAnimationPolicy();');
  if(e.raf.requests !== n) throw new Error('已在运行时不该重复起循环,多起了 ' + (e.raf.requests-n) + ' 次');
});

// ---------- 7. stopGameBg 的特效视频清理 ----------
check('★手机端 stopGameBg 仍然清理残留的全屏特效视频(不启动飘牌≠可以跳过清理)', () => {
  const e = mkEnv({w:844,h:390,dpr:3});
  e.run('startGameBg()');
  e.run('stopGameBg()');
  ['deathFxVideo','lightningFxVideo','movieFxVideo'].forEach(id => {
    if(e.videos[id]._removed < 1) throw new Error(id + ' 应被 hideFxVideo 清理(removeAttribute("src"))');
    if(e.videos[id].style.visibility !== 'hidden') throw new Error(id + ' 应被隐藏');
  });
});

check('手机端 stopGameBg 后 bgRunning=false、飘牌粒子清空', () => {
  const e = mkEnv({w:844,h:390,dpr:3});
  e.run('startGameBg()'); e.run('stopGameBg()');
  if(e.get('bgRunning') !== false) throw new Error('bgRunning 应为 false');
  if(e.get('fallingCards.length') !== 0) throw new Error('粒子应清空');
});

// ---------- 8. 破坏性验证 ----------
check('破坏性验证:让 isPhoneLayout 恒 false(=关掉本次限制),手机端断言确实会红', () => {
  const e = mkEnv({w:844,h:390,dpr:3});
  e.run('isPhoneLayout = function(){ return false; };');
  e.run('startGameBg()');
  if(e.get('bgRafId') === 0)
    throw new Error('关掉限制后手机端仍不起 rAF,说明手机端断言没有鉴别力');
  if(e.canvas.width !== 2532 || e.canvas.height !== 1170)
    throw new Error('关掉限制后应按 DPR 分配 2532x1170(= 改动前的行为),实际 '
      + e.canvas.width + 'x' + e.canvas.height);
  console.log('       ↳ 关掉限制后手机端确实会起 rAF 并分配 2532x1170 ≈ 11.8MB 画布(= 改动前行为)');
});

console.log('\n结果: ' + passed + ' 通过, ' + failed + ' 失败');
if(failed > 0) process.exit(1);
