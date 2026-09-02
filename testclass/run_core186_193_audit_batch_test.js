// CORE-186~193(issue #248~#255):全项目审查批次的回归锁定。
//   186 consumePendingHookQueue 取到最后一项并跳过时读 null.length 崩溃
//   187 resumeAfterInterrupt 缺 resume 空值防护(刚烈恢复链递归传 undefined)
//   188 雌雄双股剑 cixiongChoice 无超时保守动作
//   189 左慈 huashenPick 无超时保守动作
//   190 马谡【散谣】加回化身表
//   191 主公技/限定技/觉醒技分类 + 移除化身表里 3 条违规条目
//   192 死函数清理(悬空引用检查)
//   193 文档事实性描述(仓库地址/人数上限)
const vm=require('vm');
const fs=require('fs');
const assert=require('assert');
const context={
  firebase:{initializeApp(){return{database(){return{ref(){return{on(){},once(){},transaction(){},set(){},update(){},child(){return this;},remove(){}};}};}};},database(){return this.initializeApp().database();}},
  document:{getElementById(){return{onclick:null,onchange:null,style:{},innerHTML:'',textContent:'',value:'',classList:{add(){},remove(){},toggle(){}}};},querySelector(){return null;},querySelectorAll(){return[];},addEventListener(){},createElement(){return{style:{},classList:{add(){},remove(){}}};}},
  window:{location:{search:'',href:''},localStorage:{getItem(){return null;},setItem(){}},addEventListener(){},setTimeout,clearTimeout,alert(){}},
  console,Math,Date,JSON,RegExp,Array,Object,String,Number,Boolean,parseInt,isNaN,setTimeout,clearTimeout
};
context.window.document=context.document; context.window.firebase=context.firebase; context.global=context;
const sandbox=vm.createContext(context);
['config.js','data.js','stages/stage-table.js','room-lifecycle.js','game.js','sha/sha-resolution.js','weapons.js','skills.js','skills/late-generals.js','bot-ai-bus.js'].forEach(f=>vm.runInContext(fs.readFileSync(f,'utf8'),sandbox,{filename:f}));
const R=code=>vm.runInContext(code,sandbox);
R('tx=function(fn){return fn(__g);};');
const eq=()=>R('emptyEquips')();
const card=(id,name='杀')=>({id,name,suit:'♠',rank:7});
const mkP=(n,gen,hand)=>({name:n,general:gen,hp:4,maxHp:4,hand:hand||[],equips:eq(),delays:[],alive:true});
const mkG=(extra)=>Object.assign({players:[mkP('甲','caocao'),mkP('乙','guojia'),mkP('丙','liubei')],
  deck:[card('d1'),card('d2')],discard:[],log:[],phase:'play',turn:0,roundNum:1,gameMode:'ffa',pending:null},extra||{});
let pass=0;
const check=(name,fn)=>{ fn(); console.log('  PASS '+name); pass++; };

// ================= CORE-186 =================
check('CORE-186 队列最后一项因座位阵亡被跳过时不崩溃',()=>{
  const g=mkG({pendingHookQueue:[{seat:1,hookName:'onDamaged',source:'own',ctx:{amount:1}}]});
  g.players[1].alive=false;
  sandbox.__g=g;
  const r=R('consumePendingHookQueue(__g,{type:"sha"})');
  assert.strictEqual(r,false,'没有挂起新 pending,应返回 false');
  assert.strictEqual(g.pendingHookQueue,null,'队列消费完应回落 null(不留空数组)');
});
check('CORE-186 队列最后一项因借用武将无该 hook 被跳过时不崩溃',()=>{
  const g=mkG({pendingHookQueue:[{seat:1,hookName:'onDamaged',source:'borrowed',ctx:{amount:1}}]});
  g.players[1].huashenGeneral='zhaoyun';   // 龙胆:纯被动,没有 onDamaged hook
  sandbox.__g=g;
  assert.strictEqual(R('consumePendingHookQueue(__g,{type:"sha"})'),false);
  assert.strictEqual(g.pendingHookQueue,null);
});
check('CORE-186 中间项被跳过后,后续项仍能正常消费(CORE-168 队列语义不回归)',()=>{
  const g=mkG({pendingHookQueue:[
    {seat:0,hookName:'onDamaged',source:'own',ctx:{amount:1}},   // 曹操奸雄:无 sourceCard 时直接 return,不开 pending
    {seat:1,hookName:'onDamaged',source:'own',ctx:{amount:1,srcType:'sha'}}   // 郭嘉遗计:会开 yijiAsk
  ]});
  g.players[0].alive=false;                                      // 第一项被跳过
  sandbox.__g=g;
  const r=R('consumePendingHookQueue(__g,{type:"sha"})');
  assert.strictEqual(r,true,'第二项开出了新 pending,应返回 true');
  assert.strictEqual(g.pending.type,'yijiAsk','被跳过的第一项不得吞掉后面的项');
});

// ================= CORE-187 =================
check('CORE-187 resume 为 undefined 时不崩溃,且落到 default 分支(回合玩家存活→play)',()=>{
  const g=mkG({phase:'dying'}); sandbox.__g=g;
  R('resumeAfterInterrupt(__g, undefined, 0)');
  assert.strictEqual(g.phase,'play','应回到出牌阶段,不是崩溃、也不是停在原地');
});
check('CORE-187 刚烈包装缺内层 resume 时不崩溃',()=>{
  const g=mkG({phase:'dying'}); sandbox.__g=g;
  R("resumeAfterInterrupt(__g, {type:'ganglie', seat:0}, 0)");
  assert.strictEqual(g.phase,'play');
});
check('CORE-187 resume 缺失且回合玩家已阵亡时推进回合(不卡在死人的出牌阶段)',()=>{
  const g=mkG({phase:'dying',turn:0}); g.players[0].alive=false; sandbox.__g=g;
  R('resumeAfterInterrupt(__g, undefined, 0)');
  assert.notStrictEqual(g.turn,0,'回合应推进到下一个存活玩家');
  assert.ok(g.players[g.turn].alive);
});
check('CORE-187 正常 resume 行为不回归(aoe 仍走 aoeAdvance 而不是落 default)',()=>{
  const g=mkG({phase:'dying',aoe:{trick:'南蛮入侵',from:0,order:[1,2],idx:2}}); sandbox.__g=g;
  R("resumeAfterInterrupt(__g, {type:'aoe'}, 1)");
  assert.notStrictEqual(g.phase,'dying','aoe 分支应被正常处理');
});

// ================= CORE-188 / 189:超时保守动作已登记 =================
const ST=R('STAGE_TABLE');
check('CORE-188 cixiongChoice 已登记超时保守动作',()=>{
  assert.strictEqual(typeof ST.cixiongChoice.timeoutAction,'function');
});
check('CORE-189 huashenPick 已登记超时保守动作',()=>{
  assert.strictEqual(typeof ST.huashenPick.timeoutAction,'function');
});
check('CORE-188/189 两个阶段现在都能解析出保守动作(autoRespondAction 不再返回 null)',()=>{
  const g1=mkG({phase:'cixiongChoice',pending:{type:'cixiongChoice',from:0,to:1,askedAt:1}});
  assert.strictEqual(typeof R('autoRespondAction')(g1),'function','cixiongChoice');
  const g2=mkG({phase:'huashenPick',pending:{type:'huashenPick',seat:2,askedAt:1}});
  g2.players[2].huashenPool=['guanyu']; g2.players[2].huashenGeneral=null;
  assert.strictEqual(typeof R('autoRespondAction')(g2),'function','huashenPick');
});
check('CORE-188 超时保守动作选 draw(不动响应者手牌)且杀的结算继续',()=>{
  const g=mkG({phase:'cixiongChoice',turn:0,
    pending:{type:'cixiongChoice',from:0,to:1,askedAt:1,noShan:false,shaColor:'black'}});
  g.players[1].hand=[card('h1','闪'),card('h2','桃')];
  const handBefore=g.players[1].hand.length;
  const attackerHandBefore=g.players[0].hand.length;
  sandbox.__g=g; R('mySeat=1');
  R('STAGE_TABLE.cixiongChoice.timeoutAction(__g)()');
  assert.strictEqual(g.players[1].hand.length,handBefore,'不得弃掉超时者自己的手牌');
  assert.strictEqual(g.players[0].hand.length,attackerHandBefore+1,'保守选项是"令使用者摸一张牌"');
  assert.notStrictEqual(g.phase,'cixiongChoice','应离开雌雄选择阶段');
  // 关键:不是"把 pending 清掉了事",而是杀的结算真的继续往下走了
  // (continueAfterCixiong 会接着问被杀方出不出闪 -> phase 变成 respond)
  assert.strictEqual(g.phase,'respond','杀的后续结算应继续,而不是被拦腰截断');
});
check('CORE-189 超时保守动作会替左慈完成声明并推进开局',()=>{
  const g=mkG({phase:'huashenPick',started:false,
    pending:{type:'huashenPick',seat:2,askedAt:1}});
  g.players[2].general='zuoci'; g.players[2].huashenPool=['guanyu']; g.players[2].huashenGeneral=null;
  g.players[2].huashenSkillName=null;
  sandbox.__g=g; R('mySeat=2');
  R('STAGE_TABLE.huashenPick.timeoutAction(__g)()');
  assert.strictEqual(g.players[2].huashenGeneral,'guanyu','应替他声明 pool 里第一个可用武将');
  assert.strictEqual(g.players[2].huashenSkillName,'武圣');
  assert.notStrictEqual(g.phase,'huashenPick','不应再悬在声明阶段');
});
check('CORE-189 超时自动声明的日志不泄露具体武将/技能(隐藏信息窗口期)',()=>{
  const g=mkG({phase:'huashenPick',started:false,pending:{type:'huashenPick',seat:2,askedAt:1}});
  g.players[2].general='zuoci'; g.players[2].huashenPool=['guanyu']; g.players[2].huashenGeneral=null;
  sandbox.__g=g; R('mySeat=2');
  R('STAGE_TABLE.huashenPick.timeoutAction(__g)()');
  const text=(g.log||[]).map(e=>(e&&e.text)||String(e)).join('\n');
  assert.ok(!/关羽|武圣/.test(text),'开局声明阶段的日志不得出现具体武将名/技能名');
});

// ================= CORE-190 / 191:化身可借用范围 =================
const H=R('HUASHEN_SKILL_TABLE');
const validate=R('validateHuashenPick');
check('CORE-190 马谡【散谣】已加回化身表且可通过校验',()=>{
  assert.ok((H.masu||[]).some(e=>e.name==='散谣'));
  assert.strictEqual(validate(['masu'],'masu','散谣'),true);
});
check('CORE-191 限定技/觉醒技分类名单已建立(与主公技同款 seam)',()=>{
  // 注意:vm 沙箱里的数组来自另一个 realm,原型不同,deepStrictEqual 会误判为不等,
  // 所以统一比较字符串形式(这不是放宽断言,元素与顺序仍然被完整钉住)。
  assert.strictEqual(Array.from(R('LIMIT_SKILL_CAPS')).sort().join(','),'luanwu,niepan');
  assert.strictEqual(Array.from(R('AWAKEN_SKILL_CAPS')).sort().join(','),'hunzi,zhiji');
  assert.strictEqual(typeof R('huashenForbiddenCap'),'function');
});
check('CORE-191 三类禁用 cap 都被 huashenForbiddenCap 识别',()=>{
  const f=R('huashenForbiddenCap');
  ['jijiang','hujia','jiuyuan','zhiba','xueyi','huangtian'].forEach(c=>assert.ok(f(c),'主公技 '+c));
  ['niepan','luanwu'].forEach(c=>assert.ok(f(c),'限定技 '+c));
  ['zhiji','hunzi'].forEach(c=>assert.ok(f(c),'觉醒技 '+c));
  ['wusheng','tiaoxin','lianhuan','wansha','sanyao'].forEach(c=>assert.ok(!f(c),'普通技能 '+c+' 不应被禁'));
});
check('CORE-191 三条违规条目已移出化身表',()=>{
  assert.ok(!(H.pangtong||[]).some(e=>e.name==='涅槃'),'涅槃(限定技)');
  assert.ok(!(H.jiaxu||[]).some(e=>e.name==='乱武'),'乱武(限定技)');
  assert.ok(!(H.jiangwei||[]).some(e=>e.name==='志继'),'志继(觉醒技)');
  assert.ok(!(H.sunce||[]).some(e=>e.name==='魂姿'),'魂姿(觉醒技,本来就不在)');
});
check('CORE-191 同武将的其它技能不受牵连,仍可借用',()=>{
  assert.strictEqual(validate(['pangtong'],'pangtong','连环'),true);
  assert.strictEqual(validate(['jiaxu'],'jiaxu','完杀'),true);
  assert.strictEqual(validate(['jiaxu'],'jiaxu','帷幕'),true);
  assert.strictEqual(validate(['jiangwei'],'jiangwei','挑衅'),true);
  assert.strictEqual(validate(['sunce'],'sunce','激昂'),true);
});
check('CORE-191 第二道防线:即使表里被加回违规条目,服务端校验仍拒绝',()=>{
  H.pangtong.push({name:'涅槃', caps:['niepan']});          // 模拟以后有人误加回来
  try{
    assert.strictEqual(validate(['pangtong'],'pangtong','涅槃'),false,'validateHuashenPick 必须拒绝');
  } finally {
    H.pangtong.pop();
  }
});
check('CORE-191 全表零违规:没有任何条目含禁用 cap',()=>{
  const bad=[];
  Object.entries(H).forEach(([id,entries])=>(entries||[]).forEach(e=>{
    if(R('huashenEntryForbidden')(e)) bad.push(id+'/'+e.name);
  }));
  assert.strictEqual(bad.join(','),'','化身表里不应残留任何主公技/限定技/觉醒技,实际残留: '+bad.join(','));
});
check('CORE-191 分类名单与 desc 标注一致(不是凭印象列的)',()=>{
  const G=R('GENERALS');
  const declared=[];
  Object.entries(G).forEach(([id,gen])=>{
    (gen.skill||'').split('/').map(s=>s.trim()).filter(Boolean).forEach(name=>{
      if(new RegExp(name+'\\s*[:：]\\s*(限定技|觉醒技)').test(gen.desc||'')) declared.push(id+'/'+name);
    });
  });
  assert.strictEqual(declared.sort().join('|'),
    ['jiangwei/志继','jiaxu/乱武','pangtong/涅槃','sunce/魂姿'].sort().join('|'),
    'desc 里标注为限定技/觉醒技的技能集合应与名单覆盖范围一一对应');
});

// ================= CORE-192:死函数已删,且无悬空引用 =================
check('CORE-192 已删除的函数确实不存在,且全项目无人再引用',()=>{
  const SRC=['game.js','bot.js','render-controls.js','render.js','skills.js','weapons.js','room-lifecycle.js','stages/stage-table.js','data.js'];
  // 剔除行注释再匹配:本次改动在删除处留了说明注释,里面会提到这些函数名,
  // 不剔除的话断言会被自己的注释误伤(这不是放宽——真实调用不会写在 // 之后)。
  const strip=t=>t.split('\n').map(l=>l.replace(/\/\/.*$/,'')).join('\n');
  const all=SRC.map(f=>strip(fs.readFileSync(f,'utf8'))).join('\n')
    +'\n'+strip(fs.readFileSync('index.html','utf8'))
    +'\n'+fs.readdirSync('testclass').filter(f=>f.endsWith('.js')&&f!=='run_core186_193_audit_batch_test.js')
        .map(f=>strip(fs.readFileSync('testclass/'+f,'utf8'))).join('\n');
  ['chooseXuanfengDiscardCount','buildBotGuhuoUserPrompt','buildBotGanglieUserPrompt','buildBotGuicaiUserPrompt']
    .forEach(n=>assert.ok(!new RegExp('(^|[^A-Za-z0-9_$.])'+n+'\\s*\\(').test(all), n+' 不应还有任何调用/定义'));
});
check('CORE-192 保留下来的 resetLuanwu 仍在(reset* 系列形状一致性)',()=>{
  assert.strictEqual(typeof R('typeof resetLuanwu'),'string');
  assert.ok(/function resetLuanwu\(\)\{\}/.test(fs.readFileSync('render-controls.js','utf8')));
});

// ================= CORE-193:文档事实性描述 =================
check('CORE-193 CLAUDE.md 不再残留旧仓库地址',()=>{
  const md=fs.readFileSync('CLAUDE.md','utf8');
  assert.ok(!/zjc-taikutu/.test(md),'CLAUDE.md 不应再出现旧仓库名');
});
check('CORE-193 CLAUDE.md 的人数描述与 data.js 的 SEATS 一致',()=>{
  const md=fs.readFileSync('CLAUDE.md','utf8');
  const seats=R('SEATS');
  assert.strictEqual(seats,9);
  assert.ok(md.includes('`SEATS=9` 是**容量上限**'),'SEATS 描述应与常量一致');
  assert.ok(!md.includes('`SEATS=3`'),'不应残留旧的 SEATS=3 说法');
});
check('CORE-193 已作废的 run_startgame_wiring_test 记录已删除,且该文件确实不存在',()=>{
  const md=fs.readFileSync('CLAUDE.md','utf8');
  assert.ok(!md.includes('run_startgame_wiring_test'),'那条自述作废的记录应已整条删除');
  assert.ok(!fs.existsSync('testclass/run_startgame_wiring_test.js'));
});

console.log('CORE-186~193 审查批次 tests: '+pass+'/'+pass+' passed');
