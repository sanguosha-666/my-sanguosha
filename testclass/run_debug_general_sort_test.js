// run_debug_general_sort_test.js —— #101 选将阶段调试下拉框按武将名排序的回归测试
// 用法: node run_debug_general_sort_test.js
//
// 背景:render-controls.js 的"仅供调试测试使用"下拉框原来直接遍历 GENERAL_IDS
// (即 Object.keys(GENERALS),开发添加顺序),很难人肉查找。修复后先对 id 列表按
// 武将名(gen.name)字符串升序 .slice().sort() 再生成 option——只影响这一个调试
// 入口的展示顺序,GENERAL_IDS 本体及其它调用点(randomGeneralId/候选池排除等)不动。
const vm = require('vm');
const fs = require('fs');
const assert = require('assert');

// data.js 顶层有 firebase.initializeApp,给最小 stub 即可独立加载 config.js+data.js。
const fbRef = { on(){}, once(){}, transaction(){}, set(){}, update(){}, child(){ return fbRef; }, remove(){} };
const ctx = vm.createContext({
  console, Math, JSON, Object, Array, String, Number, parseInt, isNaN,
  firebase: { initializeApp(){ return { database(){ return { ref(){ return fbRef; } }; } }; }, database(){ return this.initializeApp().database(); } }
});
['config.js', 'data.js'].forEach(f => vm.runInContext(fs.readFileSync(f, 'utf8'), ctx, { filename: f }));
const run = code => vm.runInContext(code, ctx);

// 与 render-controls.js 里调试下拉框完全相同的比较器(逐字同步,防止两处漂移)。
const sortedIds = run('GENERAL_IDS.slice().sort(function(a,b){var na=(getGeneral(a)||{}).name||"";var nb=(getGeneral(b)||{}).name||"";return na.localeCompare(nb);})');
const nameOf = id => run('getGeneral("'+id+'").name');
const allIds = run('GENERAL_IDS');

let pass = 0, fail = 0;
function check(name, fn){
  try{ fn(); console.log('  PASS '+name); pass++; }
  catch(e){ console.log('  FAIL '+name+' - '+(e && e.message || e)); fail++; }
}

console.log('== 调试下拉框排序行为(#101) ==');
check('按武将名升序排列', function(){
  for(let i = 1; i < sortedIds.length; i++){
    const prev = nameOf(sortedIds[i-1]), cur = nameOf(sortedIds[i]);
    assert.ok(prev.localeCompare(cur) <= 0, sortedIds[i-1]+'('+prev+') 应排在 '+sortedIds[i]+'('+cur+') 之前');
  }
});
check('id 集合与 GENERAL_IDS 完全一致(不丢不增不重)', function(){
  assert.strictEqual(sortedIds.length, allIds.length, '数量应一致');
  assert.deepStrictEqual([...sortedIds].sort(), [...allIds].sort(), '集合应一致');
});
check('每个 option 的 value 仍是正确武将 id(值映射不随排序改变)', function(){
  sortedIds.forEach(id => {
    assert.strictEqual(nameOf(id), run('getGeneral("'+id+'").name'), id+' 应映射到同一个武将');
    assert.ok(!id.includes('·'), id+' 是纯 id,不应混入展示文本');
  });
});
check('GENERAL_IDS 本体与 randomGeneralId 未被改动', function(){
  const data = fs.readFileSync('data.js', 'utf8');
  assert.ok(data.includes('const GENERAL_IDS = Object.keys(GENERALS);'), 'GENERAL_IDS 定义应保留');
  assert.ok(data.includes('function randomGeneralId(){ return GENERAL_IDS[Math.floor(Math.random()*GENERAL_IDS.length)]; }'), 'randomGeneralId 应保留原实现');
});

console.log('== 源码结构守卫(#101:只动调试下拉框,不动其它调用点) ==');
check('调试下拉框先排序再生成 option', function(){
  const src = fs.readFileSync('render-controls.js', 'utf8');
  const start = src.indexOf('// ===== 调试选将入口');
  const end = src.indexOf('debugBox.appendChild(sel);', start);
  assert.ok(start >= 0 && end > start, '应能定位调试选将块');
  const block = src.slice(start, end);
  assert.ok(block.includes('GENERAL_IDS.slice().sort('), '应对 id 列表先 .slice().sort()');
  assert.ok(block.includes('(getGeneral(a)||{}).name') && block.includes('.localeCompare('), '应按武将名比较');
  assert.ok(block.includes('.forEach(id=>{'), '应遍历排序后的副本');
  assert.ok(!block.includes('GENERAL_IDS.forEach'), '不得再直接遍历 GENERAL_IDS');
  assert.ok(block.includes('opt.value=id'), 'option 的 value 仍应为正确武将 id');
});
check('GENERAL_IDS 其它调用点保持原样', function(){
  // 候选池排除(skills.js/room-lifecycle.js 的 huashen)与 render.js 帮助列表仍是直接遍历。
  const skills = fs.readFileSync('skills.js', 'utf8');
  const lifecycle = fs.readFileSync('room-lifecycle.js', 'utf8');
  const render = fs.readFileSync('render.js', 'utf8');
  assert.ok(skills.includes('GENERAL_IDS.filter(id=>!excluded.includes(id))'), 'skills.js 化身候选排除应保留原样');
  assert.ok(lifecycle.includes('GENERAL_IDS.filter(id=>!excluded.includes(id))'), 'room-lifecycle.js 化身候选排除应保留原样');
  assert.ok(render.includes('GENERAL_IDS.forEach(id=>{ const gg=getGeneral(id);'), 'render.js 帮助列表应保留直接遍历');
});

console.log('\ndebug general sort tests: '+pass+' passed, '+fail+' failed');
if(fail > 0) process.exit(1);
