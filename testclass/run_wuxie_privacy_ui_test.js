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
// CORE-148(issue #205)起,**脱敏规则本体已从展示层上移到规则层 game.js 的
// redactWuxiePollingLog**:"正在问谁"等价于暴露那个人的隐藏持牌/响应能力,这是
// "什么信息不该公开"的规则层事实,不是展示细节;上移之后展示层(本文件断言的
// hideWuxiePollingPlayer)和 AI 可见状态(bot.js 的 buildBotKeyEvents)共用同一条,
// 不会再出现"只有 UI 脱敏、AI 投影绕过"的缺口(那正是 #205 的根因)。
// 【这两条断言因此改为指向 game.js】它们原本要求正则与文案字面出现在 render-log.js 里
// —— 那是在钉**实现位置**。UI 的**行为**没有变(下面仍然断言展示层入口存在且被调用),
// 变的是规则住在哪儿。继续按旧位置断言的话,等于强迫规则留在展示层、堵死这次修复。
const gameSource = fs.readFileSync('game.js', 'utf8');
if(!gameSource.includes("/^询问 .+ 是否(?:使用|反制)【无懈可击】…$/")){
  throw new Error('规则层 redactWuxiePollingLog 未同时覆盖使用和反制无懈的轮询文案');
}
if(!gameSource.includes("const WUXIE_POLLING_PUBLIC_TEXT = '等待其他玩家响应【无懈可击】…';")){
  throw new Error('规则层匿名等待文案缺失');
}
if(!gameSource.includes('function redactWuxiePollingLog(text)')){
  throw new Error('规则层缺少无懈轮询脱敏入口 redactWuxiePollingLog');
}
// 展示层必须**委托**给规则层,而不是自己再抄一份正则(抄一份就会两处漂移)
if(!logSource.includes('redactWuxiePollingLog(text)')){
  throw new Error('展示层未委托给规则层的 redactWuxiePollingLog');
}
// AI 可见状态也必须走同一条规则 —— 这是 #205 的核心验收
const botSource = fs.readFileSync('bot.js', 'utf8');
if(!botSource.includes('redactWuxiePollingLog')){
  throw new Error('AI 可见日志投影(buildBotKeyEvents)未应用无懈轮询脱敏');
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
