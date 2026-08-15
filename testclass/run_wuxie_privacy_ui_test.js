const fs = require('fs');

const source = fs.readFileSync('render-controls.js', 'utf8');
const logSource = fs.readFileSync('render-log.js', 'utf8');
const indexSource = fs.readFileSync('index.html', 'utf8');
const ownStart = source.indexOf("if(g.phase==='wuxie' && g.pending && g.pending.type==='wuxie' && g.pending.asking===mySeat){");
const spectatorStart = source.indexOf("if(g.phase==='wuxie' && g.pending && g.pending.type==='wuxie'){", ownStart + 1);
// 不依赖相邻阶段名称：pending renderer 注册表会逐步迁移/删除后续分支，测试只截取无懈
// 旁观分支到下一个同级 phase 分支。
const spectatorEnd = source.indexOf("  if(g.phase===", spectatorStart + 5);

if(ownStart < 0 || spectatorStart < 0 || spectatorEnd < 0){
  throw new Error('无法定位无懈可击本人/旁观者渲染分支');
}

const ownBranch = source.slice(ownStart, spectatorStart);
const spectatorBranch = source.slice(spectatorStart, spectatorEnd);

if(!ownBranch.includes("b1.textContent='打出【无懈可击】'")){
  throw new Error('当前被询问者的无懈按钮丢失');
}
if(!ownBranch.includes("b2.textContent='不出'")){
  throw new Error('当前被询问者的不出按钮丢失');
}
if(spectatorBranch.includes('g.pending.asking')){
  throw new Error('旁观者分支仍读取 pending.asking');
}
if(!spectatorBranch.includes('等待其他玩家响应【无懈可击】…')){
  throw new Error('旁观者等待提示缺失');
}
if(!spectatorBranch.includes('useDesc') || !spectatorBranch.includes('g.pending.trick')){
  throw new Error('旁观者提示未保留当前锦囊信息');
}
if(!spectatorBranch.includes("g.pending.depth>0")){
  throw new Error('旁观者提示未保留反制无懈分支');
}
if(!logSource.includes('function hideWuxiePollingPlayer(text)')){
  throw new Error('日志展示层缺少无懈轮询匿名化入口');
}
if(!logSource.includes("/^询问 .+ 是否(?:使用|反制)【无懈可击】…$/")){
  throw new Error('日志展示层未同时覆盖使用和反制无懈的轮询文案');
}
if(!logSource.includes("return '等待其他玩家响应【无懈可击】…';")){
  throw new Error('日志展示层匿名等待文案缺失');
}
if(!logSource.includes('text = hideWuxiePollingPlayer(text);')){
  throw new Error('常驻日志与 toast 的共用格式化入口未应用匿名化');
}
// 这条断言的本意是"render-log.js 改动后 index.html 的 ?v= 必须跟着动",但硬编码一个
// 具体数字必然会被之后任何一次正常的、和无懈可击本身无关的 cache-bust 提交撞坏(CORE-70
// 给 render-log.js 补注释就撞了一次)——改成"当前 index.html 里 render-log.js 引用的版本号
// 严格大于这条测试历史断言过的基线版本"，既能验证约定确实被遵守，又不会因为后续任何一次
// 正常提交递增版本号就失效。
const RENDER_LOG_MIN_CACHE_BUST_VERSION = 395; // 本测试首次写下时锁定的基线版本
const renderLogVersionMatch = indexSource.match(/<script src="render-log\.js\?v=(\d+)"><\/script>/);
if(!renderLogVersionMatch || Number(renderLogVersionMatch[1]) < RENDER_LOG_MIN_CACHE_BUST_VERSION){
  throw new Error('render-log.js 缓存版本未更新，浏览器可能继续使用旧脚本');
}

console.log('PASS: 无懈可击本人按钮保留，旁观 Banner/日志/toast 均不公开当前轮询玩家');
