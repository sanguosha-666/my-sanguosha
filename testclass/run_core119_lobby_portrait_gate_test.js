// CORE-119(issue #151):手机竖屏强制横屏遮罩拦截大厅表单。
//
// 【锁定什么】
//  改动前 shouldShowLandscapeGate() 对大厅和对局一视同仁——只要竖屏+窄宽度就拦,
//  连房间号/昵称这两个输入框都点不了,用户必须先转横屏才能填表单。改动后按 #game 是否
//  带 .hidden class(项目里现成的"是否已经进入对局"信号)分流:大厅阶段(#game 仍隐藏)
//  直接放行,不拦截;进入对局(#game 可见)后行为不变,继续拦手机竖屏。
//  同时 enterGame()/backToLobby() 补了 checkLandscapeGate() 调用——单纯切 class 不会
//  触发 resize/orientationchange,不补这一步遮罩不会在"进入/离开对局"这个时刻感知变化。
const vm = require('vm');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
function check(name, fn){
  try{ fn(); console.log('  PASS ' + name); pass++; }
  catch(e){ console.log('  FAIL ' + name + ' - ' + (e && e.message || e)); fail++; }
}

const src = fs.readFileSync(path.join(ROOT, 'render.js'), 'utf8');
const seg = src.match(/function isPortrait\(\)\{[\s\S]*?\nfunction checkLandscapeGate\(\)\{[\s\S]*?\n\}/);
if(!seg) { console.log('  FAIL 未能从 render.js 定位到遮罩判定代码段(函数被重命名/重构了?)'); process.exit(1); }

// mkSandbox:同时模拟 #landscapeGate 和 #game 两个元素,#game 的 hidden 状态可控——
// 这是和 run_tablet_landscape_gate_test.js 的关键差异,那份测试里 document.getElementById
// 对 'game' 返回 null(gameEl 拿不到时按"极端环境保持旧行为"处理,天然不受这次改动影响,
// 已用那份测试的13/13全过验证过零回归)。这里要专门测"#game 存在且状态可控"这条新路径。
function mkSandbox(innerWidth, innerHeight, gameHidden, forcePortrait){
  const gate = { classList: { _hidden: false,
    contains(c){ return c==='hidden' ? this._hidden : false; },
    toggle(c, on){ if(c==='hidden') this._hidden = !!on; return this._hidden; },
    add(c){ if(c==='hidden') this._hidden = true; },
    remove(c){ if(c==='hidden') this._hidden = false; } } };
  const gameEl = { classList: { _hidden: !!gameHidden,
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
    document: { getElementById(id){
      if(id==='landscapeGate') return gate;
      if(id==='game') return gameEl;
      return null;
    } },
    Number, console
  };
  ctx.gate = gate; ctx.gameEl = gameEl;
  vm.createContext(ctx);
  vm.runInContext(seg[0], ctx);
  return ctx;
}
function gateShown(w, h, gameHidden, forcePortrait){
  const ctx = mkSandbox(w, h, gameHidden, forcePortrait);
  vm.runInContext('checkLandscapeGate()', ctx);
  return !ctx.gate.classList._hidden;
}

console.log('\n' + '='.repeat(60));
console.log('  CORE-119:大厅阶段手机竖屏不再被强制横屏遮罩拦截');
console.log('='.repeat(60) + '\n');

// ---- 核心场景:大厅阶段(#game.hidden=true),手机竖屏应放行 ----
[
  ['iPhone SE 竖屏', 375, 667],
  ['iPhone ProMax竖屏', 430, 932],
  ['边界值 640 竖屏', 640, 960],
].forEach(([name, w, h]) => {
  check('大厅阶段:' + name + ' (' + w + 'x' + h + ') 应放行,不拦大厅表单', function(){
    if(gateShown(w, h, /*gameHidden=*/true)) throw new Error('大厅阶段不应拦截,即使是窄屏竖屏');
  });
});

// ---- 零回归:进入对局(#game.hidden=false)后,手机竖屏必须仍被拦 ----
[
  ['iPhone SE 竖屏', 375, 667],
  ['iPhone ProMax竖屏', 430, 932],
  ['边界值 640 竖屏', 640, 960],
].forEach(([name, w, h]) => {
  check('对局中:' + name + ' (' + w + 'x' + h + ') 应仍提示横屏(零回归)', function(){
    if(!gateShown(w, h, /*gameHidden=*/false)) throw new Error('进入对局后手机竖屏仍应被拦截,行为不能变');
  });
});

// ---- 零回归:平板竖屏无论大厅/对局都应放行 ----
[
  ['iPad 竖屏', 768, 1024],
  ['iPad Pro 竖屏', 1024, 1366],
].forEach(([name, w, h]) => {
  check('平板:' + name + ' (' + w + 'x' + h + ') 大厅/对局均应放行(零回归)', function(){
    if(gateShown(w, h, true)) throw new Error('大厅阶段平板竖屏不应拦截');
    if(gateShown(w, h, false)) throw new Error('对局中平板竖屏也不应拦截(CORE-86既有行为)');
  });
});

// ---- #game 元素拿不到时(极端/测试环境):保守按旧行为处理,不放宽 ----
check('极端环境:#game 元素不存在时,手机竖屏仍按旧行为拦截(保守兜底,不因为拿不到状态就放行)', function(){
  const gate = { classList: { _hidden: false,
    contains(c){ return c==='hidden' ? this._hidden : false; },
    toggle(c, on){ if(c==='hidden') this._hidden = !!on; return this._hidden; },
    add(c){ if(c==='hidden') this._hidden = true; },
    remove(c){ if(c==='hidden') this._hidden = false; } } };
  const ctx = {
    window: {
      innerWidth: 375, innerHeight: 667,
      matchMedia(q){ return { matches: /portrait/.test(q) }; },
      addEventListener(){}, removeEventListener(){}
    },
    document: { getElementById(id){ return id==='landscapeGate' ? gate : null; } }, // 'game' 返回 null
    Number, console
  };
  vm.createContext(ctx);
  vm.runInContext(seg[0], ctx);
  vm.runInContext('checkLandscapeGate()', ctx);
  if(gate.classList._hidden) throw new Error('#game 拿不到时应保守按旧行为拦截,不应该放行');
});

// ---- 结构断言:enterGame()/backToLobby() 必须显式调用 checkLandscapeGate() ----
// 单测判定函数本身测不出"切class的那一刻遮罩没有被重新求值"这类接线遗漏——
// shouldShowLandscapeGate()本身逻辑正确,不代表实际调用链路正确接上了它。
check('room-lifecycle.js: enterGame() 应显式调用 checkLandscapeGate()(否则进入对局时遮罩不会重新求值)', function(){
  const rlSrc = fs.readFileSync(path.join(ROOT, 'room-lifecycle.js'), 'utf8');
  const fnMatch = rlSrc.match(/function enterGame\(\)\{[\s\S]*?\n\}\n/);
  if(!fnMatch) throw new Error('未能在room-lifecycle.js里定位到enterGame()函数');
  if(!/checkLandscapeGate\(\)/.test(fnMatch[0]))
    throw new Error('enterGame()函数体内未找到checkLandscapeGate()调用');
});
check('room-lifecycle.js: backToLobby() 应显式调用 checkLandscapeGate()(否则离开对局时遮罩不会重新求值)', function(){
  const rlSrc = fs.readFileSync(path.join(ROOT, 'room-lifecycle.js'), 'utf8');
  const fnMatch = rlSrc.match(/function backToLobby\(\)\{[\s\S]*?\n\}\n/);
  if(!fnMatch) throw new Error('未能在room-lifecycle.js里定位到backToLobby()函数');
  if(!/checkLandscapeGate\(\)/.test(fnMatch[0]))
    throw new Error('backToLobby()函数体内未找到checkLandscapeGate()调用');
});

// ---- 破坏性验证:还原成"不区分大厅/对局"的旧写法,证明上面的核心断言确实会报红 ----
check('破坏性验证:还原成旧写法(不判断#game状态),大厅阶段手机竖屏确实会被错误拦截(证明断言有鉴别力)', function(){
  const oldSeg = seg[0].replace(
    /const gameEl = document\.getElementById\('game'\);\s*\n\s*if\(gameEl && gameEl\.classList\.contains\('hidden'\)\) return false; \/\/ 大厅阶段,不拦截\s*\n\s*/,
    ''
  );
  if(oldSeg === seg[0]) throw new Error('未能从当前代码段里剔除#game判断分支,还原文本没有生效,检查正则是否需要同步更新');
  const gate = { classList: { _hidden: false,
    contains(c){ return c==='hidden' ? this._hidden : false; },
    toggle(c, on){ if(c==='hidden') this._hidden = !!on; return this._hidden; },
    add(c){ if(c==='hidden') this._hidden = true; },
    remove(c){ if(c==='hidden') this._hidden = false; } } };
  const gameEl = { classList: { _hidden: true, // 大厅阶段
    contains(c){ return c==='hidden' ? this._hidden : false; } } };
  const ctx = {
    window: {
      innerWidth: 375, innerHeight: 667,
      matchMedia(q){ return { matches: /portrait/.test(q) }; },
      addEventListener(){}, removeEventListener(){}
    },
    document: { getElementById(id){
      if(id==='landscapeGate') return gate;
      if(id==='game') return gameEl;
      return null;
    } },
    Number, console
  };
  vm.createContext(ctx);
  vm.runInContext(oldSeg, ctx);
  vm.runInContext('checkLandscapeGate()', ctx);
  if(gate.classList._hidden)
    throw new Error('旧写法下大厅阶段应该(错误地)被拦截,如果没有说明上面的断言对这段逻辑没有鉴别力');
});

console.log('\n' + '='.repeat(60));
console.log('  结果: ' + pass + ' 通过, ' + fail + ' 失败');
console.log('='.repeat(60) + '\n');
if(fail > 0) process.exit(1);
