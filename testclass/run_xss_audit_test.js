/**
 * CORE-110(issue #110):渲染层 XSS 转义审计。
 *
 * 【本文件锁定什么】issue 要求"全量扫描 setBanner/innerHTML/insertAdjacentHTML 调用点,
 * 逐一确认拼接变量来源",这次审计用脚本(而不是人工逐条读)提取了 render-controls.js 里
 * 全部 155 处 setBanner(...) 调用的完整参数文本 + render-controls.js/render.js/
 * render-table.js/render-hand.js/render-log.js/render-discard.js 里全部 55 处
 * .innerHTML=/.insertAdjacentHTML(...) 语句,用"是否存在未被 escapeHtml(...) 包裹的
 * <标识符>.name 引用"这条规则做自动分类——`.name` 是玩家名/武将名/牌名的共同后缀,
 * 逐一核实来源后确认:玩家名(g.players[...].name)是真正的用户输入,必须转义;
 * 武将名(getGeneral(...).name)/牌名(card.name)是固定数据表内容,不是用户输入,
 * 天然安全。
 *
 * 审计结论:155处setBanner里19处命中"未转义.name"规则,逐一核实来源后,17处是玩家名
 * (真实风险,已修复)、2处是固定数据(武将名/牌名,无需修复)。55处innerHTML/
 * insertAdjacentHTML里2处命中,均为固定的card.name,无需修复。
 *
 * 【两层验证,不只是静态文本匹配】
 *  ① 静态扫描规则本身做成可执行断言(下方"规则A"),扫描 render-controls.js 全部
 *     setBanner调用,断言"零处未转义玩家名"——这是**穷尽式**回归:以后任何人新增一处
 *     setBanner(xxx.name+...)忘了转义,这条断言会自动抓到,不需要重新人工审计一遍。
 *  ② 挑几个真实修复过的render函数,用含 <script>/<img onerror>/引号 的恶意玩家名
 *     构造g,真正调用render函数、捕获setBanner写入banner元素的innerHTML,断言恶意
 *     payload被转义成实体、不会被浏览器当成可执行标签解析——这是**端到端**验证,
 *     证明escapeHtml真的在运行时生效,不只是"代码里有转义函数"这种表面正确。
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

console.log('\n' + '='.repeat(64));
console.log('  CORE-110:渲染层XSS转义审计');
console.log('='.repeat(64) + '\n');

// ============ 规则A:穷尽式静态扫描(不依赖真的调用每个render函数) ============
function extractSetBannerCalls(src){
  const out = [];
  const re = /setBanner\(/g;
  let m;
  while((m = re.exec(src))){
    let i = m.index + 'setBanner('.length;
    let depth = 1, inStr = null;
    while(i < src.length && depth > 0){
      const c = src[i];
      if(inStr){
        if(c === '\\'){ i += 2; continue; }
        if(c === inStr) inStr = null;
      } else {
        if(c === '"' || c === "'" || c === '`') inStr = c;
        else if(c === '(') depth++;
        else if(c === ')') depth--;
      }
      i++;
    }
    const arg = src.slice(m.index + 'setBanner('.length, i - 1);
    const lineNo = src.slice(0, m.index).split('\n').length;
    out.push({ line: lineNo, arg });
  }
  return out;
}
function findUnescapedNameRefs(arg){
  const refs = [];
  const re = /([A-Za-z_$][A-Za-z0-9_$.\[\]]*)\.name\b/g;
  let m;
  while((m = re.exec(arg))){
    const idx = m.index;
    const before = arg.slice(0, idx);
    const ehIdx = before.lastIndexOf('escapeHtml(');
    let wrapped = false;
    if(ehIdx >= 0){
      let depth = 1;
      let ok = true;
      for(let i = ehIdx + 'escapeHtml('.length; i < idx; i++){
        if(arg[i] === '(') depth++;
        else if(arg[i] === ')') depth--;
        if(depth <= 0){ ok = false; break; }
      }
      wrapped = ok;
    }
    if(!wrapped) refs.push(m[0]);
  }
  return refs;
}
// 已核实为"固定数据、非玩家名"的白名单——只允许这两个具体位置存在,新增的裸露
// .name 引用一律必须被 escapeHtml 包裹,不允许悄悄再加一条白名单绕过。
const KNOWN_SAFE = { 'genForPick.name':true, 'd.claimedCard.name':true };

check('规则A:render-controls.js 全部 setBanner 调用,零处存在未转义的玩家名引用', function(){
  const src = fs.readFileSync(path.join(ROOT, 'render-controls.js'), 'utf8');
  const calls = extractSetBannerCalls(src);
  if(calls.length < 100) throw new Error('提取到的setBanner调用数异常偏少(' + calls.length + '),提取逻辑可能失效');
  const bad = [];
  calls.forEach(function(c){
    const refs = findUnescapedNameRefs(c.arg);
    const real = refs.filter(function(r){ return !KNOWN_SAFE[r]; });
    if(real.length) bad.push('L' + c.line + ': ' + real.join(',') + ' -- ' + c.arg.slice(0,80));
  });
  if(bad.length) throw new Error('发现未转义的玩家名引用:\n    ' + bad.join('\n    '));
  console.log('    (共扫描 ' + calls.length + ' 处 setBanner 调用,零处未转义)');
});

check('规则A反向:白名单里的两个例外确实还在(genForPick.name=武将名、d.claimedCard.name=牌名,均非玩家名)', function(){
  const src = fs.readFileSync(path.join(ROOT, 'render-controls.js'), 'utf8');
  const calls = extractSetBannerCalls(src);
  const foundKeys = new Set();
  calls.forEach(function(c){
    findUnescapedNameRefs(c.arg).forEach(function(r){ foundKeys.add(r); });
  });
  Object.keys(KNOWN_SAFE).forEach(function(k){
    if(!foundKeys.has(k)) throw new Error('白名单项 "' + k + '" 未在源码里找到——如果这个技能被删除或改写,应同步从白名单移除,不能留着变成"允许任意未来的xxx.name不检查"的空洞');
  });
});

// ============ 断言A的鉴别力验证(CLAUDE.md第20条):故意构造一个会被漏检的case ============
check('规则A的扫描函数有鉴别力:故意构造未转义的player.name会被抓出来', function(){
  const bad = "player.name+' 你好'";
  const refs = findUnescapedNameRefs(bad);
  if(refs.length !== 1) throw new Error('应识别出1处未转义引用,实际 ' + refs.length);
  const good = "escapeHtml(player.name)+' 你好'";
  const refs2 = findUnescapedNameRefs(good);
  if(refs2.length !== 0) throw new Error('escapeHtml包裹的引用不应被误报,实际 ' + refs2.length);
});

// ============ 规则B:端到端真实渲染验证(几个代表性函数,真实调用+捕获innerHTML) ============
const bannerEl = { innerHTML: '' };
const domStub = {
  getElementById: function(id){
    if(id === 'banner') return bannerEl;
    return { onclick:null, innerHTML:'', style:{}, className:'', classList:{ add(){}, remove(){}, toggle(){}, contains(){ return false; } }, appendChild(){ return {}; }, remove(){}, setAttribute(){}, getAttribute(){ return null; }, addEventListener(){}, removeEventListener(){} };
  },
  createElement: function(){
    const el = { style:{}, classList:{ add(){}, remove(){}, toggle(){}, contains(){ return false; } }, children:[],
      appendChild(child){ this.children.push(child); return child; },
      setAttribute(){}, getAttribute(){ return null; }, addEventListener(){} };
    return el;
  },
  body:{ appendChild(){ return {}; } }, querySelector(){ return null; }, querySelectorAll(){ return []; },
  addEventListener(){}, removeEventListener(){}
};
const context = {
  gameRef: { transaction: function(fn){ return fn(context.g || {}); } },
  firebase: { initializeApp:()=>({database:()=>({ref:()=>({on(){},once(){},push:()=>({set(){},key:'k'}),transaction(fn){var cb=fn(function(){});if(cb)cb();return {};},set(){},update(){},child(){return {};},remove(){},get(){return{val(){return null;}};}})})}), database:()=>({ref:()=>({on(){},once(){},push:()=>({set(){},key:'k'}),transaction(){return {};},set(){},child(){return {};},remove(){}})}) },
  document: domStub,
  window: { location:{search:'',href:'http://x'}, localStorage:{getItem(){return null;},setItem(){},removeItem(){}}, addEventListener(){}, removeEventListener(){}, navigator:{userAgent:'x'}, aiConversations:{} },
  mySeat: 0, myClientId:'xss-test',
  setTimeout: function(f,t){ return setTimeout(f,t); }, clearTimeout: function(t){ return clearTimeout(t); },
  console, Math, Date, JSON, RegExp, Promise
};
context.window.firebase = context.firebase;
context.window.document = context.document;
context.global = context;
const sandbox = vm.createContext(context, { name:'core110-xss-sandbox' });

const LOAD = ['config.js','data.js','stages/stage-table.js','debug-log.js','room-lifecycle.js','game.js',
  'sha/sha-resolution.js','weapons.js','skills.js','skills/late-generals.js','bot-ai-bus.js','bot.js',
  'ai-bot.js','render.js','render-table.js','render-hand.js','render-controls.js','render-log.js'];
try{
  LOAD.forEach(function(f){ vm.runInContext(fs.readFileSync(path.join(ROOT,f),'utf8'), sandbox, { filename:f }); });
  vm.runInContext('mySeat = 0; roomId = "xss-room"; currentG = null;', sandbox);
  console.log('  OK 全部源文件加载完成\n');
}catch(e){
  console.log('  FAIL 加载源文件: ' + (e && e.stack || e));
  process.exit(1);
}

const MALICIOUS_NAME = '<img src=x onerror=alert(1)>"\'<script>alert(2)</script>';

function mkPlayers(overrides){
  const base = [
    { name:'甲', general:'liubei', isBot:false, alive:true, hp:4, maxHp:4, hand:[{name:'杀',suit:'♠',rank:3}], equips:{}, delays:[] },
    { name:'乙', general:'caocao', isBot:true, alive:true, hp:4, maxHp:4, hand:[], equips:{}, delays:[] }
  ];
  Object.keys(overrides||{}).forEach(function(i){ Object.assign(base[i], overrides[i]); });
  return base;
}

function runRenderCall(fnName, g){
  bannerEl.innerHTML = '';
  vm.runInContext('currentG = ' + 'undefined;', sandbox); // 占位,真正的g通过下面注入
  context.g = g;
  const containerStub = { appendChild(){}, children:[] };
  vm.runInContext(fnName + '(g, containerStub)', Object.assign(sandbox, {}));
  return bannerEl.innerHTML;
}

// vm.runInContext 里的代码引用的是沙箱全局的 g/containerStub,这里显式注入到沙箱。
function callRenderFn(fnName, gObj){
  bannerEl.innerHTML = '';
  vm.runInContext('var __g = ' + JSON.stringify(gObj) + ';', sandbox);
  vm.runInContext('var __c = { appendChild:function(){}, children:[] };', sandbox);
  vm.runInContext(fnName + '(__g, __c);', sandbox);
  return bannerEl.innerHTML;
}

check('端到端:renderPendingEnyuanChoose 对恶意玩家名(source)转义,banner不含可执行标签', function(){
  const g = { pending: { type:'enyuanChoose', sourceSeat:1 }, players: mkPlayers({1:{name:MALICIOUS_NAME}}) };
  const html = callRenderFn('renderPendingEnyuanChoose', g);
  if(html.indexOf('<img') >= 0 || html.indexOf('<script') >= 0)
    throw new Error('banner innerHTML 仍含可执行标签,转义未生效: ' + html);
  if(html.indexOf('&lt;img') < 0) throw new Error('应能看到转义后的实体编码,实际: ' + html);
});

check('端到端:renderPendingShensuChoose1 对恶意玩家名(mySeat自己)转义,banner不含可执行标签', function(){
  const g = { pending:{type:'shensuChoose1'}, players: mkPlayers({0:{name:MALICIOUS_NAME}}) };
  const html = callRenderFn('renderPendingShensuChoose1', g);
  if(html.indexOf('<img') >= 0 || html.indexOf('<script') >= 0)
    throw new Error('banner innerHTML 仍含可执行标签,转义未生效: ' + html);
  if(html.indexOf('&lt;img') < 0) throw new Error('应能看到转义后的实体编码,实际: ' + html);
});

check('端到端:renderPendingLuanwuChoose 对恶意玩家名(source)转义,banner不含可执行标签', function(){
  const g = { pending:{type:'luanwuChoose', sourceSeat:1, targetMap:{}}, players: mkPlayers({1:{name:MALICIOUS_NAME}}) };
  const html = callRenderFn('renderPendingLuanwuChoose', g);
  if(html.indexOf('<img') >= 0 || html.indexOf('<script') >= 0)
    throw new Error('banner innerHTML 仍含可执行标签,转义未生效: ' + html);
  if(html.indexOf('&lt;img') < 0) throw new Error('应能看到转义后的实体编码,实际: ' + html);
});

// 反向验证:确认这套"端到端"检测方式本身有鉴别力——如果escapeHtml被不小心删掉,
// 这条测试真的会抓到(而不是因为mock/stub问题导致恒过)。
check('端到端检测有鉴别力:如果不转义,恶意payload确实会原样出现在innerHTML里(用setBanner直接验证)', function(){
  bannerEl.innerHTML = '';
  vm.runInContext('setBanner(' + JSON.stringify(MALICIOUS_NAME) + ' + " 测试");', sandbox);
  if(bannerEl.innerHTML.indexOf('<img') < 0)
    throw new Error('setBanner本身不转义是预期行为(由调用方负责),但这里没看到原样注入,说明sandbox/mock有问题,不能证明上面几条端到端测试的可信度');
});

console.log('\n' + '='.repeat(64));
console.log('  结果: ' + pass + ' 通过, ' + fail + ' 失败');
console.log('='.repeat(64) + '\n');
process.exit(fail > 0 ? 1 : 0);
