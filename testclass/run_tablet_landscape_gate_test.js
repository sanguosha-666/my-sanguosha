// CORE-86(issue #133):平板端适配——强制横屏遮罩不再一刀切拦所有竖屏。
//
// 【锁定什么】
//  改动前 checkLandscapeGate 只看方向(isPortrait()),竖屏一律盖"请将设备横过来使用"
//  全屏遮罩,平板竖屏(iPad 768×1024 / iPad Pro 1024×1366)这种宽度完全够用的设备也被
//  挡死、完全不可玩。改动后引入 shouldShowLandscapeGate():方向 + 宽度双条件,只有
//  width<=640(和 index.html 手机竖屏断点 @media(max-width:640px) 严格互补)才提示横屏。
//
// 【为什么这份测试只测判定函数、不测真实渲染】遮罩的显隐是"一个纯函数判断 + 一次
//  classList.toggle",真正需要钉住的不变量就是这个判断本身在各档视口下的取值;真实
//  浏览器里的布局质量(座位卡尺寸/横向溢出/触控目标/手机零回归)由 Playwright 实机
//  验证覆盖(见 progress-log 对应条目,11 档视口全绿 + 两轮破坏性验证),那套依赖真实
//  浏览器二进制,不适合放进这个纯 Node 的常规测试套件里每次都跑。
const vm = require('vm');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
function check(name, fn){
  try{ fn(); console.log('  PASS ' + name); pass++; }
  catch(e){ console.log('  FAIL ' + name + ' - ' + (e && e.message || e)); fail++; }
}

// 只取 render.js 里这一段(遮罩判定),不加载整个渲染层——它依赖大量 DOM/游戏状态,
// 这里要验的只是纯判断逻辑,单独抽出来跑更稳、也不会被无关改动带红。
const src = fs.readFileSync(path.join(ROOT, 'render.js'), 'utf8');
const seg = src.match(/function isPortrait\(\)\{[\s\S]*?\nfunction checkLandscapeGate\(\)\{[\s\S]*?\n\}/);
if(!seg) { console.log('  FAIL 未能从 render.js 定位到遮罩判定代码段(函数被重命名/重构了?)'); process.exit(1); }

// forcePortrait:让 matchMedia('(orientation:portrait)') 强制报 portrait。用来构造
// "isPortrait() 为真、但 innerWidth 拿不到有效值"这个真实的兜底分支——不给这个开关的话
// 没法单独触达它(宽高无效时默认的宽>高比较本身就得不出 portrait)。
function mkSandbox(innerWidth, innerHeight, forcePortrait){
  const gate = { classList: { _hidden: false,
    contains(c){ return c==='hidden' ? this._hidden : false; },
    toggle(c, on){ if(c==='hidden') this._hidden = !!on; return this._hidden; },
    add(c){ if(c==='hidden') this._hidden = true; },
    remove(c){ if(c==='hidden') this._hidden = false; } } };
  const ctx = {
    window: {
      innerWidth, innerHeight,
      matchMedia(q){ return { matches: /portrait/.test(q) ? (forcePortrait || innerHeight > innerWidth) : false }; },
      addEventListener(){}, removeEventListener(){}
    },
    document: { getElementById(id){ return id==='landscapeGate' ? gate : null; } },
    Number, console
  };
  ctx.gate = gate;
  vm.createContext(ctx);
  vm.runInContext(seg[0], ctx);
  return ctx;
}
// gateShown(w,h):跑一次真实的 checkLandscapeGate,返回遮罩最终是否可见——不是直接读
// shouldShowLandscapeGate 的返回值,而是走完"判断→toggle('hidden')"整条链路,确保
// toggle 的取反方向也被钉住(写反了会让所有档位的结果整体颠倒,只测判定函数测不出来)。
function gateShown(w, h, forcePortrait){
  const ctx = mkSandbox(w, h, forcePortrait);
  vm.runInContext('checkLandscapeGate()', ctx);
  return !ctx.gate.classList._hidden;
}

console.log('\n' + '='.repeat(60));
console.log('  CORE-86:平板竖屏不再被强制横屏遮罩挡死');
console.log('='.repeat(60) + '\n');

// ---- 平板:竖屏横屏都应放行 ----
[
  ['iPad 竖屏',        768, 1024],
  ['iPad Pro 竖屏',   1024, 1366],
  ['安卓平板竖屏',      800, 1280],
  ['小平板竖屏(641)',   641, 1000],
].forEach(([name, w, h]) => {
  check(name+' ('+w+'x'+h+') 应放行,不显示横屏遮罩', function(){
    if(gateShown(w, h)) throw new Error('遮罩不应显示(平板竖屏宽度足够,可正常游玩)');
  });
});

// ---- 手机竖屏:必须仍被拦(零回归) ----
[
  ['iPhone SE 竖屏',   375, 667],
  ['iPhone ProMax竖屏', 430, 932],
  ['边界值 640 竖屏',   640, 960],
].forEach(([name, w, h]) => {
  check(name+' ('+w+'x'+h+') 应仍提示横屏(手机零回归)', function(){
    if(!gateShown(w, h)) throw new Error('遮罩应显示(手机竖屏太窄,仍需引导横屏)');
  });
});

// ---- 横屏一律放行(不管多宽) ----
[
  ['手机横屏 SE',      667, 375],
  ['iPad 横屏',       1024, 768],
  ['桌面',            1440, 900],
].forEach(([name, w, h]) => {
  check(name+' ('+w+'x'+h+') 横屏应放行', function(){
    if(gateShown(w, h)) throw new Error('横屏任何宽度都不该显示遮罩');
  });
});

// ---- 边界精确性:640/641 这一格必须真的分开(证明阈值不是写成 >= 或差一位) ----
check('阈值边界精确:640 拦、641 放(和 index.html 手机断点 max-width:640px 严格互补)', function(){
  if(!gateShown(640, 960)) throw new Error('640 应被拦(手机竖屏 CSS 生效范围的上界)');
  if(gateShown(641, 960)) throw new Error('641 应放行(平板 CSS 生效范围的下界)');
});

// ---- 兜底:已判定为竖屏、但拿不到有效宽度时,保守提示横屏,不能因为"量不到宽度"就放行 ----
// (这是 shouldShowLandscapeGate 里 `if(!Number.isFinite(w) || w<=0) return true;` 那一行;
//  必须强制 matchMedia 报 portrait 才能触达——宽高无效时 isPortrait 自己的宽>高比较得不出
//  portrait,会在更前面一步就返回 false,根本走不到这个分支。)
check('兜底:已是竖屏但 innerWidth 无效(0/NaN)时保守提示横屏,不默认放行', function(){
  if(!gateShown(0, 0, true)) throw new Error('宽度为 0 且是竖屏时应保守提示横屏');
  if(!gateShown(NaN, NaN, true)) throw new Error('宽度为 NaN 且是竖屏时应保守提示横屏');
});

// ---- 结构断言:index.html 的平板触控目标规则必须带高度门槛(防手机横屏被误抬) ----
check('index.html 平板触控目标规则带 min-height:521px 门槛(手机横屏不被误抬)', function(){
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const m = html.match(/@media[^{]*min-height:521px[^{]*\{\s*#controls button\{min-height:44px;\}/);
  if(!m) throw new Error('未找到带 (min-height:521px) 门槛的 #controls button 触控目标规则——'
    + '没有这道门槛,手机横屏(667×375,宽度落在平板区间内)会被一并抬高按钮、页面更溢出');
});

console.log('\n' + '='.repeat(60));
console.log('  结果: ' + pass + ' 通过, ' + fail + ' 失败');
console.log('='.repeat(60) + '\n');
if(fail > 0) process.exit(1);
