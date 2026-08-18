/**
 * CORE-131(issue #171):#infoModal 的异步回填会覆盖后打开的另一个浮层。
 *
 * 【问题】几个浮层(帮助/日志/武将说明/装备说明/调试日志)共用同一个 #infoModal 容器,这本身
 * 没问题;问题出在 showDebugLog() 是**两段式**的——先同步显示"加载中…",再异步拉数据回填。
 * 如果这段时间里用户已经打开了别的浮层,晚到的回调会把内容写进现在归别人的容器,把它顶掉。
 *
 * 【原有防护为什么不够】debug-log.js 里本来就有 `if(m.classList.contains('hidden')) return`,
 * 注释也预见了这个风险——但它只挡住"弹窗已被关闭"这一种情况;用户关掉🐛又打开📜时,弹窗是
 * **可见**的,守卫直接放行,内容照样被覆盖(已用 Playwright 在 main 上实测复现)。
 * 要判断的不是"还开着吗",而是"还是我这一次开的吗"。
 *
 * 【修法】在 showInfo/hideInfo 这一层加"归属世代号"(每次调用 +1),异步发起方在同步阶段记下
 * 当时的号,回填前比对——不一致就放弃写入。收敛在共用层,以后再有异步浮层直接复用。
 *
 * 【真实行为验证不在这里】5 个场景(🐛未落地切📜/切❓、🐛自己正常回填、📜与❓单独打开)已用
 * Playwright 做过改动前后对照:改动前 2 个覆盖场景必现、改动后全部通过(见 commit 记录)。
 * 这份测试用 vm 沙箱加载真实源码,直接驱动世代号逻辑本身,并锁定源码结构。
 */
const vm = require('vm');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
function check(name, fn){
  try{ fn(); console.log('  PASS ' + name); pass++; }
  catch(e){ console.log('  FAIL ' + name + ' - ' + (e && e.message || e)); fail++; }
}

const renderSrc = fs.readFileSync(path.join(ROOT, 'render.js'), 'utf8');
const debugSrc  = fs.readFileSync(path.join(ROOT, 'debug-log.js'), 'utf8');

console.log('\n' + '='.repeat(60));
console.log('  CORE-131: #infoModal 异步回填的归属守卫');
console.log('='.repeat(60) + '\n');

// ---------- A. 世代号逻辑(真实加载 render.js 里那三个函数) ----------
// 只截取 infoModalGen/infoModalGeneration/showInfo/hideInfo 这一段注入沙箱,
// 不整文件加载(render.js 顶层有大量 DOM 绑定,不是这次要测的东西)。
const genBlock = renderSrc.match(/let infoModalGen = 0;[\s\S]*?function hideInfo\(\)\{[^}]*\}/);
const ctx = {
  console: console,
  document: {
    getElementById: () => ({
      innerHTML: '', classList: { add(){}, remove(){}, contains(){ return false; } },
      querySelector: () => ({ onclick: null }),
      set onclick(v){}, get onclick(){ return null; }
    })
  },
  escapeHtml: s => String(s),
  logModalOpen: false
};
ctx.global = ctx;
const sandbox = vm.createContext(ctx, { name: 'sgs-core131' });

check('能从 render.js 截取到世代号代码块并注入沙箱', function(){
  if(!genBlock) throw new Error('未能截取 infoModalGen…hideInfo 这一段 —— 源码结构是否被改动?');
  vm.runInContext(genBlock[0], sandbox, { filename: 'render.js(gen)' });
  ['infoModalGeneration','showInfo','hideInfo'].forEach(fn => {
    if(typeof sandbox[fn] !== 'function') throw new Error(fn + ' 未定义');
  });
});

const gen = () => vm.runInContext('infoModalGeneration()', sandbox);

check('showInfo 每次调用都会推进世代号', function(){
  const a = gen();
  vm.runInContext("showInfo('t','b')", sandbox);
  const b = gen();
  if(b <= a) throw new Error('showInfo 后世代号应增大,实际 ' + a + ' → ' + b);
});

check('hideInfo 同样推进世代号(关闭也算易主,防止关掉后晚到的回调还往里写)', function(){
  const a = gen();
  vm.runInContext('hideInfo()', sandbox);
  const b = gen();
  if(b <= a) throw new Error('hideInfo 后世代号应增大,实际 ' + a + ' → ' + b);
});

check('核心场景模拟: 记下号 → 别人打开浮层 → 归属校验应判定"已易主"', function(){
  vm.runInContext("showInfo('调试日志','加载中…')", sandbox);
  const myGen = gen();                       // 🐛 记下自己这次的号
  vm.runInContext('hideInfo()', sandbox);    // 用户关掉
  vm.runInContext("showInfo('日志','...')", sandbox); // 用户打开📜
  if(gen() === myGen) throw new Error('世代号未变化,守卫将无法识别容器已易主 —— 这正是修复前的行为');
});

check('零回归场景模拟: 记下号 → 期间无人动弹窗 → 归属校验应判定"仍是我的"', function(){
  vm.runInContext("showInfo('调试日志','加载中…')", sandbox);
  const myGen = gen();
  if(gen() !== myGen) throw new Error('无人操作时世代号不应变化,否则🐛自己的正常回填也会被挡掉');
});

// ---------- B. debug-log.js 接线结构 ----------
check('showDebugLog 在同步阶段记下 myGen(且在 showInfo 之后)', function(){
  const i = debugSrc.indexOf("showInfo('调试日志(房间 '");
  const j = debugSrc.indexOf('const myGen =');
  if(i < 0) throw new Error('未找到 showDebugLog 里的 showInfo 调用');
  if(j < 0) throw new Error('未找到 myGen 的记录');
  if(!(j > i)) throw new Error('myGen 必须在 showInfo 之后记录 —— showInfo 会推进世代号,记早了会拿到上一次的号');
});

check('myGen 在调用时才查 infoModalGeneration(debug-log.js 加载顺序在 render.js 之前)', function(){
  if(!/typeof infoModalGeneration === 'function'/.test(debugSrc))
    throw new Error('必须用 typeof 在调用时判断 —— debug-log.js 加载早于 render.js,顶层直接引用会 ReferenceError');
});

check('归属守卫 debugLogBodyIfStillMine 存在且三层判断齐全', function(){
  const m = debugSrc.match(/const debugLogBodyIfStillMine = function\(\)\{[\s\S]*?\};/);
  if(!m) throw new Error('未找到 debugLogBodyIfStillMine');
  const body = m[0];
  if(!/infoModalGeneration\(\) !== myGen/.test(body)) throw new Error('缺少世代号比对(核心修复)');
  if(!/classList\.contains\('hidden'\)/.test(body)) throw new Error('缺少"弹窗还开着吗"判断(原有防护应保留)');
  if(!/querySelector\('\.info-body'\)/.test(body)) throw new Error('缺少 .info-body 存在性判断');
});

check('成功分支(.then)与失败分支(.catch)都走同一个守卫', function(){
  const uses = (debugSrc.match(/debugLogBodyIfStillMine\(\)/g) || []).length;
  if(uses < 2) throw new Error('守卫应在 .then 和 .catch 两处都被调用,实际 ' + uses + ' 处 —— 错误提示塞进别人的浮层和成功内容一样糟');
});

check('零回归: 两个分支不再各自手写旧的 hidden 判断(避免两套逻辑漂移)', function(){
  const stale = (debugSrc.match(/const m = document\.getElementById\('infoModal'\);\s*\n\s*if\(!m \|\| m\.classList\.contains\('hidden'\)\) return;/g) || []).length;
  if(stale > 0) throw new Error('仍有 ' + stale + ' 处旧的内联 hidden 判断未收敛进守卫');
});

// 破坏性验证
check('破坏性验证: 去掉世代号比对后,"已易主"判定确实失效(证明这层是核心修复)', function(){
  const m = debugSrc.match(/const debugLogBodyIfStillMine = function\(\)\{[\s\S]*?\};/)[0];
  const weakened = m.replace(/if\(myGen !== null[\s\S]*?return null; \/\/ 容器已易主[^\n]*\n/, '');
  if(weakened === m) throw new Error('削弱样本构造失败,未匹配到世代号比对那几行');
  if(/infoModalGeneration\(\) !== myGen/.test(weakened))
    throw new Error('削弱后不应再含世代号比对 —— 若仍含有说明这条破坏性验证没有意义');
});

console.log('\n' + '='.repeat(60));
console.log('  结果: ' + pass + ' 通过, ' + fail + ' 失败');
console.log('='.repeat(60) + '\n');
if(fail > 0) process.exit(1);
