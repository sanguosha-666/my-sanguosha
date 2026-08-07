// render-controls.js — 响应/目标选择 UI 层,从 render.js 拆分出来(纯重构第五步,行为零变化,
// 这次范围目前最大:renderControls 本体 + 它的两个专属子渲染(renderGuanxing/
// renderPickGeneral,只被 renderControls 调用,render() 从不直接调用它们) + 一批只被
// renderControls 用到的 helper(waitAskBanner/fangtianSuffix/qiaobianSources/
// qiaobianTargets/jijiuChoices/guanshifuOptions/EQUIP_SLOT_LABEL) + 全部约30个客户端
// 选牌/选目标状态机变量(selectedCardIdx/zhangbaMode/duanliangMode/jiedaoSeatA/
// qiaobianMode 等)及其 reset* 函数。
//
// 【这次接受的跨文件调用,不是破例】confirmAndPlay(render.js)的跨技能 cleanup 闭包、
// render()(render.js)主循环里"离开对应阶段就清空客户端状态"的兜底代码块,两者都会
// 直接调用这里定义的 reset* 函数——这是刻意接受的结果,不是遗漏。原因:①这批状态变量的
// 唯一存在目的就是给 renderControls 的目标选择UI用,是它的私有状态，不该为了凑单文件
// 硬拆成两半；②confirmAndPlay 本身经核实是三方共用(render()/renderControls/
// render-hand.js 都调用它)，必须留在 render.js core，不能跟着这批状态变量搬过来；
// ③"core 调用某个专属域暴露出来的清理/入口函数"这个模式，weapons.js(respondShan 调用
// maybeStartQilin)、render-table.js(render()调用renderTableCard)都已验证过安全，
// 全局作用域下没有加载顺序问题，这次只是同一模式的第三次应用，不是新引入的例外。
//
// 【留在 render.js 的三方共用函数，不在这里】showConfirm/confirmAndPlay/resolveActionId/
// canShuangxiongDuelCard/playConfirmMsg/seatColor/setBanner——这些都被 render()/
// renderControls/render-hand.js 三者中的至少两个共用，经核实后确认留在 core。
// seatSlot(旧版环绕布局的槽位分配函数)已在骨架级重建(landscape-ui)里删除——对手行
// 改用简单的回合顺序线性排列(见 render.js 的 oppOrder),不再需要按象限分配槽位。

// 技能目标按钮共用的轻量座位校验。旧代码留下了六处调用却从未定义此函数；一进入眩惑等
// 目标阶段，renderControls 就会抛 ReferenceError，连取消按钮也无法完成挂载，界面因此锁死。
// 角色是否存在及存活仍由各调用处校验，这里只拒绝非法座位值。
function isSeatClickable(seat){
  return Number.isInteger(seat) && seat >= 0;
}


// ---------- helper functions ----------
// hasWeaponToDiscard: 典韦【强袭】—— 检查玩家是否有可弃置的武器牌（装备区或手牌）
function hasWeaponToDiscard(player) {
  if (!player || !player.alive) return false;
  
  // 检查装备区
  if (player.equips && player.equips.weapon) return true;
  
  // 检查手牌中的装备牌（所有装备牌，包括武器、防具、马匹等）
  const hand = player.hand || [];
  for (let i = 0; i < hand.length; i++) {
    if (hand[i] && EQUIPS[hand[i].name]) {
      return true;
    }
  }
  
  return false;
}

// ---------- targeting UI state ----------
// 大厅对战模式选择(纯客户端,点开始时写入 g.gameMode):'ffa'|'identity'|null
let selectedGameMode = null;
let selectedCardIdx = null;
// 响应阶段"多候选可选"(respondShan出闪/aoeRespond南蛮万箭响应):候选>1(真实牌+龙胆/武圣/
// 倾国转化)时,玩家先点选具体一张手牌,记下标;候选<=1时不使用这个变量,维持原有"按钮直接
// 生效"的简化体验(见 render-hand.js 的 respondRole/respondCandidateCount 判断)。纯客户端
// 状态,不入库,和 selectedCardIdx 同款同步在离开对应 phase 时清空(见 render.js 的单点兜底)。
let selectedResponseCardIdx = null;
function resetSelectedResponseCard(){ selectedResponseCardIdx = null; }
// 弃牌阶段:已勾选待弃置的手牌下标集合,纯客户端状态,不提交服务端直到点"确认弃牌"
// (多选后统一确认,和之前"点一张立即弃一张"的旧交互不同,见discardCards)。
let discardSelectedSet = new Set();
function resetDiscardSelected(){ discardSelectedSet = new Set(); }
// 丈八蛇矛「两张牌当杀」的纯客户端选牌状态(和 selectedCardIdx 互斥,从不入库)。
let zhangbaMode = false;
// 鬼才改判:点"发动"进入选牌模式(纯客户端,不入库),再点一张手牌确认替换;与 zhangbaMode 同款但各自独立。
let guicaiMode = false;
function resetGuicai(){ guicaiMode=false; }
let zhangbaPicks = [];          // 已选手牌下标,最多 2 个
function resetZhangba(){ zhangbaMode=false; zhangbaPicks=[]; }
// 张辽【突袭】:摸牌阶段点"发动突袭"进选目标模式(纯客户端,不入库),选 1~2 名座位后点"确认"才发动。
// 和 zhangbaMode 的关键区别:数量可变(1或2都合法),不能靠"选满自动触发",必须有独立确认按钮。
let tuxiMode = false;
let tuxiPicks = [];              // 已选目标座位号,最多 2 个
function resetTuxi(){ tuxiMode=false; tuxiPicks=[]; }
// 方天画戟:锁定技,手牌只剩最后一张且能当杀时才出现"追加目标"入口(仿张辽突袭同款
// "数量可变、不能靠选满自动触发、需要独立确认按钮"的交互)。因为触发条件已经限定"只有这一张
// 手牌",不需要像丈八/断粮那样先选牌——cardIdx 恒为 0,点入口直接进选目标模式。
let fangtianMode = false;
let fangtianPicks = [];          // 已选额外目标座位号,最多 3 个(含最少1个,不强制选满)
function resetFangtian(){ fangtianMode=false; fangtianPicks=[]; }
// 徐晃【断粮】:出牌阶段点"发动断粮"进选牌+选目标模式(纯客户端,不入库)。
// 先点一张黑色基本牌/黑色装备牌(官方规则,不是任意牌)选中,再点距离2以内的一名其他玩家
// 座位提交;和普通出牌选目标的交互很像,但不走 CARD_PLAYS/playCard(断粮是独立的技能动作,
// 选中的这张牌本身当【兵粮寸断】使用,不是弃置)。
let duanliangMode = false;
let duanliangCardIdx = null;    // 已选中要当兵粮寸断使用的手牌下标(单选)
function resetDuanliang(){ duanliangMode=false; duanliangCardIdx=null; }
// 甘宁【奇袭】:出牌阶段点"发动奇袭"进选牌+选目标模式,任意黑色手牌当【过河拆桥】使用。
let qixiMode = false;
let qixiCardIdx = null;
function resetQixi(){ qixiMode=false; qixiCardIdx=null; }
// 鲁肃【缔盟】:出牌阶段限一次,选择两名其他角色并弃置X张牌,令他们交换手牌。
let dimengMode = false;
let dimengSeatA = null;
let dimengSeatB = null;
function resetDimeng(){ dimengMode=false; dimengSeatA=null; dimengSeatB=null; }
// 陈宫【明策】:重置明策状态
function resetMingce(){} // 明策不需要额外的状态变量，只需要重置pending即可
// 丁奉【奋迅】:重置函数
function resetFenxun(){} // 奋迅状态存储在玩家对象上，只需要重置pending即可
let guoseMode = false;
let guoseCardIdx = null;
function resetGuose(){ guoseMode=false; guoseCardIdx=null; }
let lianhuanMode = false;
let lianhuanCardIdx = null;
let lianhuanTargets = [];
let tiesuoTargets = [];
function resetLianhuan(){ lianhuanMode=false; lianhuanCardIdx=null; lianhuanTargets=[]; }
function resetTiesuo(){ tiesuoTargets=[]; }
let qingnangMode = false;
let qingnangCardIdx = null;
function resetQingnang(){ qingnangMode=false; qingnangCardIdx=null; }
let zhihengMode = false;
let zhihengPicks = [];
function resetZhiheng(){ zhihengMode=false; zhihengPicks=[]; }
// 乐进【骁果】:点"发动"进选牌模式(纯客户端,不入库),只有基本牌可点,点了直接提交(仿鬼才)。
let xiaoguoMode = false;
function resetXiaoguo(){ xiaoguoMode=false; }
// 青龙偃月刀:杀被闪抵消后,装备者(攻击者)点"发动"进选牌模式(纯客户端,不入库),能当杀的
// 牌都可点,点了直接提交(和骁果同一个"点发动进选牌模式,选牌即提交"的单步交互模式)。
let qinglongMode = false;
function resetQinglong(){ qinglongMode=false; }
// 雌雄双股剑:目标选「弃一张手牌」时进入选手牌模式
let cixiongDiscardMode = false;
function resetCixiongDiscard(){ cixiongDiscardMode=false; }
// 贯石斧:杀被闪抵消后,装备者(攻击者)可选弃自己2张牌(手牌/装备混合)令这张杀依然造成伤害。
// 不需要"发动"这一步单独确认——直接列出自己所有可弃项(手牌+非武器槽装备)供toggle多选,
// 选够恰好2项才出现"确认发动",同屏始终有"不发动"按钮。guanshiPicks 存编码字符串
// ('hand:idx' / 'equip:slot'),纯客户端不入库。
let guanshiPicks = [];
function resetGuanshi(){ guanshiPicks=[]; }
// 庞德【猛进】:不需要额外客户端状态,直接使用 pending
// 郭嘉【遗计】分配阶段:yijiPicks 依次记录"第i张牌分配给哪个座位号",纯客户端不入库。
// 每次点一个座位号就 push 进去(允许重复,如都给自己/都给同一人),攒够 cards.length 张就提交。
let yijiPicks = [];
function resetYiji(){ yijiPicks=[]; }
// 夏侯惇【刚烈】惩罚选择:伤害来源可点选两张手牌弃置,纯客户端暂存下标。
let gangliePicks = [];
function resetGanglie(){ gangliePicks=[]; }
let quhuMode = false;
let quhuCardIdx = null;
function resetQuhu(){ quhuMode=false; quhuCardIdx=null; }
// 太史慈【天义】:拼点模式
let tianyiMode = false;
let tianyiCardIdx = null;
let tianyiTargetSeat = null;
function resetTianyi(){ tianyiMode=false; tianyiCardIdx=null; tianyiTargetSeat=null; }
// 孙策【制霸】:出牌阶段限一次,选目标后拼点(客户端本地模式,仿 tianyiMode 一套)
let zhibaMode = false;
function resetZhiba(){ zhibaMode=false; }
let lijianMode = false;
let lijianCardIdx = null;
let lijianFromSeat = null;
function resetLijian(){ lijianMode=false; lijianCardIdx=null; lijianFromSeat=null; }
let fanjianMode = false;
function resetFanjian(){ fanjianMode=false; }
// 姜维【挑衅】:出牌阶段限一次,选一个目标角色
let tiaoxinMode = false;
let tiaoxinTarget = null;
function resetTiaoxin(){ tiaoxinMode=false; tiaoxinTarget=null; }
// 贾诩【乱武】:乱武选择阶段
function resetLuanwu(){} // 乱武不需要额外的客户端状态,使用pending存储
let lirangPicks = [];
function resetLirang(){ lirangPicks=[]; }
// guanshifuOptions: 攻击者自己当前可弃的项(手牌逐张 + 非空装备槽逐件,武器槽排除——那就是
// 贯石斧本身)。返回 {key,label} 列表,供 UI 渲染 toggle 按钮。
function guanshifuOptions(p){
  const list=[];
  (p.hand||[]).forEach((c,idx)=>{ list.push({key:'hand:'+idx, label:'手牌【'+c.name+'】'}); });
  EQUIP_SLOTS.forEach(slot=>{ if(slot!=='weapon' && p.equips && p.equips[slot]){
    list.push({key:'equip:'+slot, label:EQUIP_SLOT_LABEL[slot]+'【'+p.equips[slot].name+'】'});
  }});
  return list;
}
// 马谡【散谣】第二步(UI接入):第一步已经把 sanyaoOptions(p) 实现在 skills.js 里(和贯石斧
// guanshifuOptions 同款 key 编码,只是不排除武器槽——散谣没有"这个装备就是它自己"这种自指
// 问题),这里不重复实现,直接复用。全程只有马谡一人决定弃哪张牌、平局选哪个目标,不需要
// 其它玩家响应,按张郃【巧变】已经确立的既有规则走"客户端本地累积选择、最后一次性原子提交":
// sanyaoMode(bool,是否处于发动流程)+ sanyaoCostKey(已选的弃牌 key)+ sanyaoTarget(仅平局时
// 需要,单一候选时不需要玩家选、由 UI 自动带上)。
let sanyaoMode = false;
let sanyaoCostKey = null;
let sanyaoTarget = null;
function resetSanyao(){ sanyaoMode=false; sanyaoCostKey=null; sanyaoTarget=null; }
// 张郃【巧变】完整版:回合开始服务端问"是否发动"(g.phase==='qiaobianTurnStart'),点"发动"后
// 客户端进入纯本地状态机(不入库,不需要其他玩家响应)——① 'choosePhase':选一张手牌+选一个
// 阶段(判定/摸牌/出牌/弃牌),一次性提交 qiaobianDeclare(cardIdx, phaseChoice);
// ② 若选的是"出牌阶段",服务端会开新 pending qiaobianMove,客户端接着走 'source'/'target'
// 两步(和简化版的移动 UI 完全一样)选装备/判定牌来源和目的地,或直接"不移动",提交
// respondQiaobianMove(move)。
let qiaobianMode = false;        // false | 'choosePhase' | 'source' | 'target'
let qiaobianCardIdx = null;      // 已选中要弃置的手牌下标
let qiaobianPhaseChoice = null;  // 已选中的阶段:'judge'|'draw'|'play'|'discard'
let qiaobianSrc = null;          // 已选中的来源 {kind:'equip'|'delay', seat, slot|idx, name}
function resetQiaobian(){ qiaobianMode=false; qiaobianCardIdx=null; qiaobianPhaseChoice=null; qiaobianSrc=null; }
// 诸葛亮【观星】:纯客户端两个数组(不入库),分别存"放牌堆顶"/"放牌堆底"的牌下标(下标指向
// g.pending.cards),点击顺序即最终顺序(不用拖拽库)。UI 里这两个数组按"自然阅读顺序"维护
// (先点的排在前面、代表玩家想让它更早被摸到/判定到);提交给 respondGuanxing 前,top 数组要
// 整体 reverse 一次——服务端约定"topOrder 最后一个元素=牌堆顶(最先翻到)",这是因为 g.deck
// 数组尾部才是真正的"牌堆顶"(judge()/drawN() 都用 pop() 从尾部取牌),和这里"数组前面=先摸到"
// 这套面向玩家的直觉顺序方向相反,必须翻转对齐,不能直接把UI数组传过去。
let guanxingTop = [];
let guanxingBottom = [];
function resetGuanxing(){ guanxingTop=[]; guanxingBottom=[]; }

// 左慈【化身】两级选择("选武将→选技能")的客户端状态,huashenPick(开局初次声明)/
// huashenChangePickStart(回合开始更改)/huashenChangePickEnd(回合结束更改)三个服务端
// 阶段共用同一份客户端选择状态——同一时刻只可能处于其中一个阶段,不会冲突。
let huashenPickGeneral = null;
function resetHuashenPick(){ huashenPickGeneral=null; }
// 李典【恂恂】: 选择获得哪些牌和置于底部的顺序。和观星类似,但语义不同:
// xunxunKeep = 要获得的牌的下标数组, xunxunBottom = 其余牌置于底部的顺序
let xunxunKeep = [];
let xunxunBottom = [];
function resetXunxun(){ xunxunKeep=[]; xunxunBottom=[]; }
// 借刀杀人:两步选目标(先选 A:有武器的角色,再选 B:A 攻击范围内的其他角色),与常规单目标出牌
// 走的 selectedCardIdx 通用块互斥(见 render 里 isJiedaoSel 的排除条件)。jiedaoSeatA===null 时选 A,
// 选中后 jiedaoSeatA 存座位号,再点一次选 B 才真正提交。
let jiedaoSeatA = null;
function resetJiedao(){ jiedaoSeatA=null; }

// waitAskBanner: 旁观者视角"等待 XX 决定是否发动【技能】…"这句在 renderControls 里重复十余处、
// 形状完全一致的提示,集中成一个函数,避免每处手拼、措辞漂移。name 由调用点算好后传入(兼容各分支
// 原有的 p / (p?p.name:'默认名') 兜底写法),skill 传技能名(不含书名号,函数内部补【】)。
function waitAskBanner(name, skill){
  setBanner('等待 '+escapeHtml(name||'')+' 决定是否发动【'+skill+'】…');
}
// renderHuashenTwoStepPick: 左慈"选武将→选技能"两级选择的共用UI,availGenerals(实时传入
// 的候选武将id数组,如 p.huashenPool)第一步点选武将,第二步(HUASHEN_SKILL_TABLE[general]
// 只有1个技能时跳过、直接进第二步收尾)点选具体技能名,respondFn(generalId,skillName)
// 是最终提交函数——huashenPick/respondHuashenChangePickStart/respondHuashenChangePickEnd
// 三个服务端阶段各自传各自的respondFn,UI层完全共用。titlePrefix仅用于banner文案区分
// 场景(如"化身"/"更改化身")。
function renderHuashenTwoStepPick(g, c, availGenerals, respondFn, titlePrefix){
  const pool = Array.isArray(availGenerals) ? availGenerals : [];
  if(huashenPickGeneral===null){
    // 第一步(选武将):每个候选武将各是不同的武将,desc各不相同——每个候选按钮各自配
    // 一段完整的GENERALS[gid].desc说明(不裁剪到单条技能),让玩家在选之前就能看清楚
    // 整个武将的完整技能说明。按钮+说明包成一个小容器一起appendChild,保持"这段说明
    // 属于哪个候选"视觉上一一对应,不和其它候选的按钮/说明混在一起。
    pool.forEach(gid=>{
      const gen=getGeneral(gid); if(!gen) return;
      const wrap=document.createElement('div'); wrap.className='huashen-candidate';
      const b=document.createElement('button');
      b.textContent=gen.name+'('+gen.skill+')';
      b.onclick=()=>{ huashenPickGeneral=gid; render(g); };
      wrap.appendChild(b);
      const desc=document.createElement('div'); desc.className='huashen-candidate-desc';
      desc.textContent=gen.desc||'(暂无说明)';
      wrap.appendChild(desc);
      c.appendChild(wrap);
    });
    setBanner('【'+titlePrefix+'】请选择要借用的武将…');
    return;
  }
  const entries = HUASHEN_SKILL_TABLE[huashenPickGeneral] || [];
  if(entries.length===1){
    const gid=huashenPickGeneral, skillName=entries[0].name;
    resetHuashenPick();
    respondFn(gid, skillName);
    return;
  }
  // 第二步(选技能):这几个按钮全部属于同一个武将(huashenPickGeneral),desc是
  // 同一份文本,不需要在每个技能按钮下都重复贴一遍——统一在按钮上方展示这一个武将的
  // 完整desc一次,和第一步"每个候选各自一份"的处理方式不同,是因为第二步候选数量
  // 少但内容重复,重复展示反而是视觉噪音。
  const genForPick = getGeneral(huashenPickGeneral);
  const descBlock=document.createElement('div'); descBlock.className='huashen-candidate-desc';
  descBlock.style.cssText='flex-basis:100%;margin-bottom:4px;';
  descBlock.textContent=(genForPick&&genForPick.desc)||'(暂无说明)';
  c.appendChild(descBlock);
  entries.forEach(e=>{
    const b=document.createElement('button');
    b.textContent=e.name;
    b.onclick=()=>{ const gid=huashenPickGeneral; resetHuashenPick(); respondFn(gid, e.name); };
    c.appendChild(b);
  });
  const back=document.createElement('button'); back.className='ghost';
  back.textContent='重新选武将'; back.onclick=()=>{ huashenPickGeneral=null; render(g); };
  c.appendChild(back);
  setBanner('【'+titlePrefix+'】请选择借用 '+(genForPick?genForPick.name:'')+' 的哪个技能…');
}
// renderHuashenChangeAsk: 回合开始/结束"是否更改化身"的二选一询问,respondFn 是各自的
// respondHuashenChangeAskStart/respondHuashenChangeAskEnd。
function renderHuashenChangeAsk(g, c, respondFn){
  const b1=document.createElement('button'); b1.className='primary';
  b1.textContent='更改【化身】'; b1.onclick=()=>respondFn(true);
  c.appendChild(b1);
  const b2=document.createElement('button');
  b2.textContent='不更改'; b2.onclick=()=>respondFn(false);
  c.appendChild(b2);
  setBanner('是否更改【化身】声明的技能?');
}
// fangtianSuffix: 方天画戟排队中的目标提示后缀(如"(方天画戟 目标2/3)"),没有排队则返回空串。
// 附加在响应阶段(respond/tieqi/liegong)的 banner 末尾,帮旁观者看懂"这是第几个目标"。
function fangtianSuffix(g){
  const q=g.fangtianQueue;
  if(!q) return '';
  const label=q.kind==='duanbing' ? '短兵' : '方天画戟';
  return '（'+label+' 目标'+(q.idx+1)+'/'+q.targets.length+'）';
}

// ===== 张郃【巧变】:动态扫描整个牌桌,现算"可选来源"/"合法目的地"清单(不预存进 pending) =====
const EQUIP_SLOT_LABEL={ weapon:'武器', armor:'防具', plus1:'防御马', minus1:'进攻马' };
// qiaobianSources: 所有存活玩家的非空装备槽 + 判定区里的每张延时锦囊,各生成一条来源记录。
function qiaobianSources(g){
  const list=[];
  g.players.forEach((p,i)=>{
    if(!p || !p.alive) return;
    EQUIP_SLOTS.forEach(slot=>{ if(p.equips && p.equips[slot]){
      list.push({kind:'equip', seat:i, slot, name:p.equips[slot].name, label:p.name+' 的'+EQUIP_SLOT_LABEL[slot]+'【'+p.equips[slot].name+'】'});
    }});
    (p.delays||[]).forEach((c,idx)=>{
      list.push({kind:'delay', seat:i, idx, name:c.name, label:p.name+' 判定区的【'+c.name+'】'});
    });
  });
  return list;
}
// qiaobianTargets: 给定一条来源,列出合法的目的地玩家(排除来源本人)——
// 装备要求该玩家对应槽为空;延时锦囊要求该玩家判定区没有同名的牌。
function qiaobianTargets(g, src){
  return g.players.map((p,i)=>({p,i})).filter(o=>{
    if(!o.p || !o.p.alive || o.i===src.seat) return false;
    if(src.kind==='equip') return !o.p.equips[src.slot];
    return !(o.p.delays||[]).some(c=>c.name===src.name);
  }).map(o=>({seat:o.i, label:o.p.name}));
}
function jijiuChoices(p){
  const out=[];
  (p.hand||[]).forEach((card,idx)=>{ if(isRed(card)) out.push({kind:'hand', idx, label:'手牌【'+card.name+'】'}); });
  EQUIP_SLOTS.forEach(slot=>{ const card=p.equips&&p.equips[slot]; if(card&&isRed(card)) out.push({kind:'equip', slot, label:slotLabel[slot]+'【'+card.name+'】'}); });
  return out;
}
function addGuhuoResponseButtons(container, g, me, role){
  if(!hasCap(me,'guhuo') || g.guhuoUsed) return 0;
  const names=guhuoResponseNamesForRole(role);
  if(names.length===0) return 0;
  let count=0;
  (me.hand||[]).forEach((card, idx)=>{
    names.forEach(name=>{
      const b=document.createElement('button');
      b.className='ghost';
      b.textContent='蛊惑:手牌【'+card.name+'】当【'+name+'】';
      b.onclick=()=>{ confirmAndPlay('扣置这张手牌发动【蛊惑】,声明为【'+name+'】？', ()=>startGuhuoResponse(idx, name)); };
      container.appendChild(b);
      count++;
    });
  });
  return count;
}

// renderPickGeneral: g.phase==='pickingGeneral' 阶段的UI。两种状态——①自己的
// generalChoices 还有值(还没选):展示3个候选武将卡片(头像+武将名·技能名+完整desc说明
// 文字),点击提交respondPickGeneral;②自己已经选定(generalChoices已清空、general有值):
// 展示banner"你已选择:XX,等待其他玩家…"+其他玩家的选择进度(只显示已选/未选状态,不暴露
// 别人的候选内容——候选本身也是隐藏信息,武将确定前不该被别人看到)。
// 布局:候选卡片纵向堆叠(不是横排3列)——desc完整说明文字通常有一两句话,比单纯技能名长
// 不少,三张卡片横排会挤得每张都很窄导致文字换行挤压变形,纵向堆叠让每张卡片都能占满宽度、
// 有足够空间完整展示说明文字。
// renderGuanxing: g.phase==='guanxingReview' 阶段的UI。只有 g.pending.seat===mySeat 才把
// g.pending.cards 的真实牌面画出来(隐藏信息,和郭嘉【遗计】看牌同一原则);其余客户端只显示
// 不剧透的banner。每张牌两个按钮"放牌堆顶"/"放牌堆底",点一次就分到对应堆(按钮上显示这张牌
// 在该堆里的序号,方便玩家确认顺序),已分配的牌可以点"移出"重新选择。两堆牌数之和等于总牌数
// 时才出现"确认"按钮,点击后把 guanxingTop 整体 reverse(UI是"先点=更早摸到"的直觉顺序,
// 服务端 respondGuanxing 约定"topOrder最后一个=最先摸到",两者方向相反,这里做一次转换)。
function renderGuanxing(g, c){
  const seat = g.pending.seat;
  if(seat!==mySeat){
    setBanner(escapeHtml(g.players[seat].name)+' 正在观星…');
    return;
  }
  const cards = g.pending.cards || [];
  setBanner('【观星】查看牌堆顶 '+cards.length+' 张牌,为每张牌选择放到牌堆顶还是牌堆底');
  const list=document.createElement('div'); list.className='general-pick-list'; // 复用三选一那套纵向列表样式,不用重新写一套
  cards.forEach((card,idx)=>{
    const inTop = guanxingTop.includes(idx);
    const inBottom = guanxingBottom.includes(idx);
    const row=document.createElement('div'); row.className='general-pick-card';
    row.style.cursor='default';
    const topPos = inTop ? (guanxingTop.indexOf(idx)+1) : null;
    const bottomPos = inBottom ? (guanxingBottom.indexOf(idx)+1) : null;
    row.innerHTML =
      '<div class="general-pick-info">'
        +'<div class="general-pick-name">'+(cardFace(card)||'')+' '+escapeHtml(card.name)+'</div>'
        +'<div class="general-pick-desc">'+(inTop?'已放牌堆顶（第'+topPos+'个摸到）':inBottom?'已放牌堆底（第'+bottomPos+'个）':'尚未分配')+'</div>'
      +'</div>';
    const btnBox=document.createElement('div'); btnBox.style.display='flex'; btnBox.style.gap='8px';
    if(!inTop && !inBottom){
      const bTop=document.createElement('button'); bTop.className='ghost'; bTop.textContent='放牌堆顶';
      bTop.onclick=(e)=>{ e.stopPropagation(); guanxingTop.push(idx); render(g); };
      const bBottom=document.createElement('button'); bBottom.className='ghost'; bBottom.textContent='放牌堆底';
      bBottom.onclick=(e)=>{ e.stopPropagation(); guanxingBottom.push(idx); render(g); };
      btnBox.appendChild(bTop); btnBox.appendChild(bBottom);
    } else {
      const bUndo=document.createElement('button'); bUndo.className='ghost'; bUndo.textContent='移出重选';
      bUndo.onclick=(e)=>{ e.stopPropagation(); guanxingTop=guanxingTop.filter(x=>x!==idx); guanxingBottom=guanxingBottom.filter(x=>x!==idx); render(g); };
      btnBox.appendChild(bUndo);
    }
    row.appendChild(btnBox);
    list.appendChild(row);
  });
  c.appendChild(list);
  if(guanxingTop.length + guanxingBottom.length === cards.length && cards.length>0){
    const ok=document.createElement('button'); ok.className='primary';
    ok.textContent='确认';
    ok.onclick=()=>{
      // topOrder 传给服务端前整体 reverse——UI是"先点=更早摸到"的直觉顺序,respondGuanxing
      // 约定"数组最后一个元素=最先摸到"(和 g.deck 用 pop() 从尾部取牌的方向对齐),两者方向
      // 相反,这里必须转换,不能直接把 guanxingTop 原样传过去。
      const top=[...guanxingTop].reverse(), bottom=[...guanxingBottom];
      resetGuanxing();
      respondGuanxing(top, bottom);
    };
    c.appendChild(ok);
  }
}
// renderXunxun: 李典【恂恂】选择阶段的UI。类似观星,但语义不同:
// - 需要选择 takeN 张牌获得（按 UI 点击顺序,最后点的最后获得）
// - 剩余的牌按玩家指定的顺序置于牌堆底（xunxunBottom 存下标,按点击顺序,先点=更靠近牌堆底）
function renderXunxun(g, c){
  const seat = g.pending.seat;
  const cards = g.pending.cards || [];
  const takeN = g.pending.takeN || 2;
  const isMe = seat===mySeat;
  
  if(!isMe){
    // 公开亮牌：所有玩家都能看到亮出的牌
    setBanner(escapeHtml(g.players[seat].name)+' 发动【恂恂】,亮出的牌:');
    const list=document.createElement('div'); list.className='general-pick-list';
    cards.forEach((card,idx)=>{
      const row=document.createElement('div'); row.className='general-pick-card';
      row.style.cursor='default';
      row.innerHTML =
        '<div class="general-pick-info">'
          +'<div class="general-pick-name">'+(cardFace(card)||'')+' '+escapeHtml(card.name)+'</div>'
          +'<div class="general-pick-desc">公开亮牌</div>'
        +'</div>';
      list.appendChild(row);
    });
    c.appendChild(list);
    return;
  }
  
  setBanner('【恂恂】已亮出牌堆顶'+cards.length+'张牌,请选择获得其中'+takeN+'张,其余牌将按指定顺序置于牌堆底');
  const list=document.createElement('div'); list.className='general-pick-list';
  
  cards.forEach((card,idx)=>{
    const inKeep = xunxunKeep.includes(idx);
    const inBottom = xunxunBottom.includes(idx);
    const row=document.createElement('div'); row.className='general-pick-card';
    row.style.cursor='default';
    
    const keepPos = inKeep ? (xunxunKeep.indexOf(idx)+1) : null;
    const bottomPos = inBottom ? (xunxunBottom.indexOf(idx)+1) : null;
    
    row.innerHTML =
      '<div class="general-pick-info">'
        +'<div class="general-pick-name">'+(cardFace(card)||'')+' '+escapeHtml(card.name)+'</div>'
        +'<div class="general-pick-desc">'+(inKeep?'已选择获得（第'+keepPos+'张）':inBottom?'已选择置底（第'+bottomPos+'个）':'尚未选择')+'</div>'
      +'</div>';
    
    const btnBox=document.createElement('div'); btnBox.style.display='flex'; btnBox.style.gap='8px';
    
    if(!inKeep && !inBottom){
      // 如果还没选择够takeN张,可以选择获得
      if(xunxunKeep.length < takeN){
        const bKeep=document.createElement('button'); bKeep.className='primary';
        bKeep.textContent='获得';
        bKeep.onclick=(e)=>{ e.stopPropagation(); xunxunKeep.push(idx); render(g); };
        btnBox.appendChild(bKeep);
      }
      // 可以选择置底
      const bBottom=document.createElement('button'); bBottom.className='ghost';
      bBottom.textContent='置底';
      bBottom.onclick=(e)=>{ e.stopPropagation(); xunxunBottom.push(idx); render(g); };
      btnBox.appendChild(bBottom);
    } else {
      const bUndo=document.createElement('button'); bUndo.className='ghost'; bUndo.textContent='移出重选';
      bUndo.onclick=(e)=>{ e.stopPropagation(); 
        xunxunKeep=xunxunKeep.filter(x=>x!==idx); 
        xunxunBottom=xunxunBottom.filter(x=>x!==idx); 
        render(g); 
      };
      btnBox.appendChild(bUndo);
    }
    
    row.appendChild(btnBox);
    list.appendChild(row);
  });
  c.appendChild(list);
  
  // 检查是否所有牌都已经分配完毕
  if(xunxunKeep.length + xunxunBottom.length === cards.length && cards.length>0 && xunxunKeep.length===takeN){
    const ok=document.createElement('button'); ok.className='primary';
    ok.textContent='确认';
    // 恂恂的语义: keepIdxs 是获得的牌的下标（按玩家点击顺序,服务端会 reverse 处理）
    // bottomOrder 是置底的牌的下标（按玩家点击顺序,先点=更靠近牌堆底）
    ok.onclick=()=>{
      const keepIdxs=[...xunxunKeep], bottomOrder=[...xunxunBottom];
      resetXunxun();
      respondXunxun(keepIdxs, bottomOrder);
    };
    c.appendChild(ok);
  }
}

// opts.lordPick=true: 身份局主公 5 选 1,onclick 走 respondPickLordGeneral
function renderPickGeneral(g, c, opts){
  const lordPick = !!(opts && opts.lordPick);
  const me = g.players[mySeat];
  if(!me){ setBanner('选将阶段…'); return; }
  if(Array.isArray(me.generalChoices) && me.generalChoices.length>0){
    const nChoice = me.generalChoices.length;
    setBanner(lordPick
      ? ('主公选将:请从下面'+nChoice+'名候选武将中选择一名')
      : ('选将阶段:请从下面'+nChoice+'名候选武将中选择一名'));
    const list=document.createElement('div'); list.className='general-pick-list';
    me.generalChoices.forEach(id=>{
      const gen=getGeneral(id); if(!gen) return;
      const card=document.createElement('div'); card.className='general-pick-card';
      // 势力标识(第3步·3c):放进 .general-pick-info 文字区,不叠在 .avatar-box 缩略图上——
      // 这张卡的头像是独立侧边缩略图、文字信息区背景是卡片自己的纯色(#1d1916),不是文字叠图片
      // (和座位卡 .seat-art 那套刻意不共用,见上面已有的注释)。选将阶段还没正式声明技能借用,
      // 直接查 gen.faction(候选武将自己的势力),不经过 generalFaction(player)——这里描述的是
      // "这张候选卡代表的武将",不是"me 当前生效的武将",语义和 showGeneralInfo(id) 那次的
      // 判断是一样的:调用方已经用具体 id 定死了要描述谁,不存在跟随化身的二义性。
      const factionKey = gen.faction && FACTION_LABEL[gen.faction] ? gen.faction : null;
      const factionChip = factionKey ? '<span class="inline-faction faction-'+factionKey+'">'+FACTION_LABEL[factionKey]+'</span>' : '';
      card.innerHTML =
        '<div class="avatar-box">'
          +'<img class="avatar" src="'+generalAvatarSrc(gen.id)+'" onerror="avatarError(this)" alt="">'
          +'<div class="avatar-placeholder" style="display:none">'+escapeHtml(gen.name)+'</div>'
        +'</div>'
        +'<div class="general-pick-info">'
          +'<div class="general-pick-name">'+escapeHtml(gen.name)+factionChip+' · '+escapeHtml(gen.skill)+'</div>'
          +'<div class="general-pick-desc">'+escapeHtml(gen.desc||'(暂无说明)')+'</div>'
        +'</div>';
      card.onclick=()=> lordPick ? respondPickLordGeneral(id) : respondPickGeneral(id); // 正式入口:两者都校验候选池
      list.appendChild(card);
    });
    c.appendChild(list);
    // ===== 调试选将入口:仅供测试用,不是正式游戏机制 =====
    // 不受三选一候选池(me.generalChoices)限制,可以直接指定任意已实现的武将,方便测试某个
    // 具体武将不用靠随机等它出现在候选池里。视觉上刻意和上面正式的候选卡片区分开(警示色
    // 虚线边框+⚠️字样),避免正常玩家误触把它当成正式流程的一部分。
    const debugBox=document.createElement('div');
    debugBox.style.cssText='margin-top:16px;padding:12px;border:2px dashed #d4a017;border-radius:10px;background:rgba(212,160,23,.08);';
    const warn=document.createElement('div');
    warn.style.cssText='color:#d4a017;font-weight:700;margin-bottom:8px;font-size:13px;';
    warn.textContent='⚠️ 仅供调试测试使用：自由选择任意武将（不受候选池限制，不是正式游戏功能）';
    debugBox.appendChild(warn);
    const sel=document.createElement('select');
    sel.style.cssText='width:100%;margin-bottom:8px;background:#15120f;color:var(--paper);border:1px solid var(--line);border-radius:8px;padding:8px;';
    GENERAL_IDS.forEach(id=>{
      const gen=getGeneral(id); if(!gen) return;
      const opt=document.createElement('option');
      opt.value=id; opt.textContent=gen.name+' · '+gen.skill;
      sel.appendChild(opt);
    });
    debugBox.appendChild(sel);
    const debugBtn=document.createElement('button');
    debugBtn.style.cssText='border:1px solid #d4a017;color:#d4a017;background:transparent;';
    debugBtn.textContent='【测试】确认选择';
    // 调试入口:主公选将阶段走 debugPickLordGeneral(不受候选池限制),他人阶段走 debugPickGeneral——
    // 两条路径各自独立,不再共用正式入口(respondPickLordGeneral/respondPickGeneral 只接受候选池内的id)
    debugBtn.onclick=()=> lordPick ? debugPickLordGeneral(sel.value) : debugPickGeneral(sel.value);
    debugBox.appendChild(debugBtn);
    c.appendChild(debugBox);
    return;
  }
  // 自己已经选完,等待其他玩家
  const myGen = getGeneral(me.general);
  setBanner('你已选择：'+escapeHtml(myGen?myGen.name:'')+'，等待其他玩家选择…');
  const prog=document.createElement('div'); prog.className='pick-progress';
  g.players.forEach(p=>{
    if(!p) return;
    const done = !!p.general;
    const row=document.createElement('div'); row.className='pick-progress-row';
    row.innerHTML = escapeHtml(p.name)+'：'+(done?'<span style="color:var(--jade)">已选择</span>':'<span style="color:var(--paper-dim)">等待中…</span>');
    prog.appendChild(row);
  });
  c.appendChild(prog);
}
function renderControls(g){
  const c=document.getElementById('controls'); c.innerHTML='';
  setBanner(''); // 唯一重置点:每次重渲染先清空,下面每个分支各写各的一句
  const me=g.players[mySeat];
  const myTurn = g.turn===mySeat;
  
  // 蔡文姬【悲歌】UI
  const beigeHtml = renderBeigeChoose(g) || renderBeigeDiscard(g) || renderBeigeJudge(g);
  if(beigeHtml) {
    c.innerHTML = beigeHtml;
    return;
  }
  
  // 曹冲【称象】和【仁心】UI
  const caochongHtml = renderCaochong(g);
  if(caochongHtml) {
    c.innerHTML = caochongHtml;
    return;
  }
  
  // 翻面状态提示——不再在这里提前短路。上一版"只在!myTurn时短路"的写法有一个遗留缺口:
  // !myTurn 覆盖了"当前不是我的回合"的绝大多数时间,包括我此刻正好需要响应别人操作(比如
  // 对我出的杀,该不该出闪)的这些时刻——那些响应界面全都定义在这个函数后面几千行的
  // g.pending 分派链条里,提前短路会把它们全部盖住,导致翻面玩家"无法看到任何响应按钮"。
  // 官方规则本身也只管"轮到自己回合开始时被跳过",完全不影响响应别人操作的正常询问。
  // 真正的修复点在下面的 `if(!myTurn){ setBanner('等待…'); return; }` 那个通用兜底
  // 分支——不是函数末尾(那里试过一次,但函数在到达末尾之前早就 return 了,是死代码,已
  // 撤回)。那个 `if(!myTurn)` 分支的位置本身就是这条分派链条天然确立的"真正空闲"边界:
  // 它排在几千行 `g.pending.xxx===mySeat` 判断的最后面,只要前面任何一个分支命中过(说明
  // 确实有什么东西需要这个玩家响应/关注),函数早就在到达这里之前 return 了;真正走到这里
  // 就意味着——不需要在这里逐一枚举 pending 类型/字段名,直接复用分派链条本身已经做过的
  // 判断——此刻既不是我的回合,也没有任何 pending 需要我响应。是我自己当前回合
  // (myTurn===true)时,分派链条压根不会进入这个分支,同样天然不受影响。

  // 智迟状态提示
  const zhichiHtml = renderZhichiStatus(g);
  if(zhichiHtml) {
    c.innerHTML = zhichiHtml;
    return;
  }

  // pickingGeneral 阶段发生在 g.started 真正置 true(finishGeneralAssign)之前,必须在
  // "!g.started" 这个判断之前先检查,否则会被下面那个分支提前拦截、永远进不到这里。
  if(g.phase==='pickingGeneral'){
    renderPickGeneral(g, c);
    return;
  }
  // 左慈【化身】开局初次声明(huashenPick)同样发生在 g.started 置 true(finishGeneralAssign)
  // 之前——和 pickingGeneral 同一类问题,必须同样提前到"!g.started"判断之前检查,否则会被
  // 下面的"!g.started"分支提前拦截、永远进不到 huashenPick 这条渲染逻辑(真实bug:此前这
  // 两个分支写在函数末尾2177行附近,导致左慈化身声明期间UI一直显示"开始游戏"按钮而不是
  // 化身候选,只有直接手工构造g.started=true的合成测试数据才会掩盖这个问题,真实点击流程
  // 里 g.started 在huashenPick阶段确实是false——这是真实端到端点击测试才抓到的回归,vm
  // 沙箱/合成状态的UI测试测不到)。回合中途的huashenChangeAskStart/PickStart/AskEnd/
  // PickEnd四个阶段都发生在g.started已经为true之后,不受这个问题影响,不需要挪。
  if(g.phase==='huashenPick' && g.pending && g.pending.type==='huashenPick' && g.pending.seat===mySeat){
    const me=g.players[mySeat];
    renderHuashenTwoStepPick(g, c, me.huashenPool, respondHuashenPick, '化身');
    return;
  }
  if(g.phase==='huashenPick' && g.pending && g.pending.type==='huashenPick'){
    const p=g.players[g.pending.seat];
    waitAskBanner(p?p.name:'左慈', '化身');
    return;
  }
  // 鲁肃【好施】:选择目标
  if(g.phase==='haoshiPick' && g.pending && g.pending.type==='haoshiPick' && g.pending.seat===mySeat){
    const half = g.pending.half;
    const candidates = g.pending.candidates || [];
    setBanner('【好施】选择一个角色,将'+half+'张手牌交给他。');
    candidates.forEach(seat=>{
      const p = g.players[seat];
      if(p && p.alive){
        const b=document.createElement('button'); b.className='primary';
        b.textContent='交给 '+p.name;
        b.onclick=()=>respondHaoshi(seat);
        c.appendChild(b);
      }
    });
    return;
  }
  if(g.phase==='haoshiPick' && g.pending && g.pending.type==='haoshiPick'){
    const p = g.players[g.pending.seat];
    waitAskBanner(p ? p.name : '鲁肃', '好施');
    return;
  }

  // 凌统【旋风】:选择目标阶段
  if(g.pending && g.pending.type === 'xuanfengPick' && g.pending.from === mySeat && g.pending.stage === 'selecting') {
    const div = document.createElement('div'); div.className = 'centered';
    const h4 = document.createElement('h4'); h4.textContent = '【旋风】发动';
    const p = document.createElement('p'); 
    p.textContent = `请选择目标角色（可选择多个，共计弃置至多${g.pending.maxRemaining}张牌）`;
    
    div.appendChild(h4);
    div.appendChild(p);
    
    // 显示所有可选目标
    g.players.forEach((target, i) => {
      if (i === mySeat || !target || !target.alive) return;
      const available = (target.hand || []).length +
        Object.values(target.equips || {}).filter(Boolean).length +
        (target.delays || []).length;
      if (i !== mySeat && target.alive && available > 0) {
        const b = document.createElement('button');
        b.className = 'target-btn';
        b.textContent = '选择 ' + escapeHtml(target.name);
        b.onclick = () => pickXuanfengTarget(i);
        div.appendChild(b);
      }
    });

    const selectedCount = Array.isArray(g.pending.selections) && g.pending.selections.length
      ? g.pending.selections.length
      : (g.pending.discardedCounts || []).reduce((sum, count) => sum + count, 0);
    if(selectedCount > 0){
      const finishBtn = document.createElement('button');
      finishBtn.className = 'primary';
      finishBtn.textContent = `完成发动（弃置${selectedCount}张）`;
      finishBtn.onclick = finishXuanfengSelection;
      div.appendChild(finishBtn);
    }
    
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'cancel-btn';
    cancelBtn.textContent = selectedCount > 0 ? '取消整次旋风' : '不发动';
    cancelBtn.onclick = cancelXuanfeng;
    div.appendChild(cancelBtn);
    
    c.appendChild(div);
    return;
  }

  // 凌统【旋风】:逐张选择牌（手牌随机，装备/判定牌可指定）
  if(g.pending && g.pending.type === 'xuanfengPick' && g.pending.from === mySeat && g.pending.stage === 'chooseCard') {
    const div=document.createElement('div'); div.className='centered';
    const targetSeat=g.pending.currentTargetSeat;
    const target=g.players[targetSeat];
    const selected=g.pending.selections||[];
    const h4=document.createElement('h4'); h4.textContent='【旋风】选择一张牌';
    const p=document.createElement('p'); p.textContent=`选择弃置 ${escapeHtml(target.name)} 的哪张牌`;
    div.appendChild(h4); div.appendChild(p);
    const selectedHands=selected.filter(s=>s.targetSeat===targetSeat&&s.kind==='hand').length;
    if((target.hand||[]).length>selectedHands){
      const b=document.createElement('button'); b.className='primary';
      b.textContent='弃随机一张手牌'; b.onclick=()=>pickXuanfengCard('hand'); div.appendChild(b);
    }
    EQUIP_SLOTS.forEach(slot=>{
      const card=target.equips&&target.equips[slot];
      if(!card||selected.some(s=>s.targetSeat===targetSeat&&s.kind==='equip'&&s.value===slot)) return;
      const b=document.createElement('button'); b.className='primary';
      b.textContent='弃装备【'+card.name+'】'; b.onclick=()=>pickXuanfengCard('equip',slot); div.appendChild(b);
    });
    (target.delays||[]).forEach((card,idx)=>{
      if(selected.some(s=>s.targetSeat===targetSeat&&s.kind==='delay'&&s.value===idx)) return;
      const b=document.createElement('button'); b.className='primary';
      b.textContent='弃判定区【'+card.name+'】'; b.onclick=()=>pickXuanfengCard('delay',idx); div.appendChild(b);
    });
    const cancelBtn=document.createElement('button'); cancelBtn.className='cancel-btn';
    cancelBtn.textContent='返回选择目标';
    cancelBtn.onclick=()=>{ tx(g=>{ if(g.pending&&g.pending.type==='xuanfengPick'&&g.pending.from===mySeat){ g.pending.stage='selecting'; g.pending.currentTargetSeat=null; } return g; }); };
    div.appendChild(cancelBtn); c.appendChild(div); return;
  }

  // 徐庶【举荐】:选非基本牌
  if(g.phase==='jujianPickCard' && g.pending && g.pending.type==='jujianPickCard' && g.pending.sourceSeat===mySeat){
    const me=g.players[mySeat];
    const div=document.createElement('div'); div.className='centered';
    const h4=document.createElement('h4'); h4.textContent='【举荐】弃置一张非基本牌';
    div.appendChild(h4);
    (me.hand||[]).forEach((card, idx)=>{
      if(!card || BASIC_CARDS.includes(card.name)) return;
      const b=document.createElement('button');
      b.className='skill-btn';
      b.textContent=card.name+(card.suit||'')+(card.rank!=null?rankText(card.rank):'');
      b.onclick=()=>respondJujianPickCard(idx);
      div.appendChild(b);
    });
    const cancel=document.createElement('button'); cancel.className='cancel'; cancel.textContent='取消';
    cancel.onclick=cancelJujian;
    div.appendChild(cancel);
    c.appendChild(div);
    return;
  }
  if(g.phase==='jujianPickCard' && g.pending && g.pending.type==='jujianPickCard'){
    const p=g.players[g.pending.sourceSeat];
    waitAskBanner(p?p.name:'徐庶', '举荐');
    return;
  }
  // 徐庶【举荐】:选目标
  if(g.phase==='jujianPickTarget' && g.pending && g.pending.type==='jujianPickTarget' && g.pending.sourceSeat===mySeat){
    const div=document.createElement('div'); div.className='centered';
    const h4=document.createElement('h4'); h4.textContent='【举荐】选择一名其他角色';
    div.appendChild(h4);
    (g.pending.candidates||[]).forEach(seat=>{
      const tp=g.players[seat];
      if(!tp) return;
      const b=document.createElement('button');
      b.className='skill-btn';
      b.textContent=tp.name;
      b.onclick=()=>respondJujianPickTarget(seat);
      div.appendChild(b);
    });
    const cancel=document.createElement('button'); cancel.className='cancel'; cancel.textContent='取消';
    cancel.onclick=cancelJujian;
    div.appendChild(cancel);
    c.appendChild(div);
    return;
  }
  if(g.phase==='jujianPickTarget' && g.pending && g.pending.type==='jujianPickTarget'){
    const p=g.players[g.pending.sourceSeat];
    waitAskBanner(p?p.name:'徐庶', '举荐');
    return;
  }
  // 徐庶【举荐】:被举荐者选效果
  if(g.phase==='jujianChooseEffect' && g.pending && g.pending.type==='jujianChooseEffect' && g.pending.targetSeat===mySeat){
    const src=g.players[g.pending.sourceSeat];
    const div=document.createElement('div'); div.className='centered';
    const h4=document.createElement('h4'); h4.textContent=(src?src.name:'徐庶')+' 举荐你,请选择一项';
    div.appendChild(h4);
    [['draw','摸两张牌'],['recover','回复1点体力'],['reset','复原武将牌']].forEach(([k,txt])=>{
      const b=document.createElement('button');
      b.className='skill-btn';
      b.textContent=txt;
      b.onclick=()=>respondJujianEffect(k);
      div.appendChild(b);
    });
    c.appendChild(div);
    return;
  }
  if(g.phase==='jujianChooseEffect' && g.pending && g.pending.type==='jujianChooseEffect'){
    const p=g.players[g.pending.targetSeat];
    setBanner('等待 '+(p?p.name:'目标')+' 选择【举荐】效果…');
    return;
  }

  // 曹彰【将驰】
  if(g.phase==='jiangchiAsk' && g.pending && g.pending.type==='jiangchiAsk' && g.pending.seat===mySeat){
    const base=Number.isInteger(g.pending.baseDraw)?g.pending.baseDraw:2;
    const div=document.createElement('div'); div.className='centered';
    const h4=document.createElement('h4'); h4.textContent='【将驰】请选择';
    div.appendChild(h4);
    [
      ['more', '多摸1张(共'+(base+1)+'张),本回合不能用/打出杀'],
      ['less', '少摸1张(共'+Math.max(0,base-1)+'张),杀无距且可多出1张杀'],
      ['skip', '不发动,摸'+base+'张']
    ].forEach(([id,txt])=>{
      const b=document.createElement('button');
      b.className='skill-btn';
      b.textContent=txt;
      b.onclick=()=>respondJiangchi(id);
      div.appendChild(b);
    });
    c.appendChild(div);
    return;
  }
  if(g.phase==='jiangchiAsk' && g.pending && g.pending.type==='jiangchiAsk'){
    const p=g.players[g.pending.seat];
    waitAskBanner(p?p.name:'曹彰', '将驰');
    return;
  }

  // 曹植【落英】
  if(g.phase==='luoyingAsk' && g.pending && g.pending.type==='luoyingAsk' && g.pending.seat===mySeat){
    const n=(g.pending.cardIds||[]).length;
    const div=document.createElement('div'); div.className='centered';
    const h4=document.createElement('h4'); h4.textContent='【落英】获得梅花牌';
    div.appendChild(h4);
    const p=document.createElement('p');
    p.textContent='可获得 '+(n||0)+' 张梅花牌';
    div.appendChild(p);
    if(Array.isArray(g.pending.cardsPreview)){
      g.pending.cardsPreview.forEach(card=>{
        const span=document.createElement('span');
        span.style.margin='0 4px';
        span.textContent='【'+(card.name||'?')+'】'+(card.suit||'');
        div.appendChild(span);
      });
    }
    const ok=document.createElement('button'); ok.className='primary'; ok.textContent='获得';
    ok.onclick=()=>respondLuoying(true);
    const no=document.createElement('button'); no.className='cancel'; no.textContent='不获得';
    no.onclick=()=>respondLuoying(false);
    div.appendChild(document.createElement('br'));
    div.appendChild(ok); div.appendChild(no);
    c.appendChild(div);
    return;
  }
  if(g.phase==='luoyingAsk' && g.pending && g.pending.type==='luoyingAsk'){
    const p=g.players[g.pending.seat];
    waitAskBanner(p?p.name:'曹植', '落英');
    return;
  }

  // 曹植【酒诗②】
  if(g.phase==='jiushiFlipAsk' && g.pending && g.pending.type==='jiushiFlipAsk' && g.pending.seat===mySeat){
    const div=document.createElement('div'); div.className='centered';
    const h4=document.createElement('h4'); h4.textContent='【酒诗】翻面';
    div.appendChild(h4);
    const p=document.createElement('p'); p.textContent='你受到伤害且武将牌背面朝上,可以翻回正面';
    div.appendChild(p);
    const ok=document.createElement('button'); ok.className='primary'; ok.textContent='翻回正面';
    ok.onclick=()=>respondJiushiFlip(true);
    const no=document.createElement('button'); no.className='cancel'; no.textContent='不发动';
    no.onclick=()=>respondJiushiFlip(false);
    div.appendChild(ok); div.appendChild(no);
    c.appendChild(div);
    return;
  }
  if(g.phase==='jiushiFlipAsk' && g.pending && g.pending.type==='jiushiFlipAsk'){
    const p=g.players[g.pending.seat];
    waitAskBanner(p?p.name:'曹植', '酒诗');
    return;
  }

  // 曹仁【据守】:选择阶段
  if(g.phase==='jushouChoose' && g.pending && g.pending.type==='jushouChoose' && g.pending.seat===mySeat){
    const div = document.createElement('div'); div.className = 'centered';
    const h4 = document.createElement('h4'); h4.textContent = '【据守】发动';
    const p = document.createElement('p'); p.textContent = '是否摸三张牌并翻面?';
    const btnConfirm = document.createElement('button'); btnConfirm.className = 'primary';
    btnConfirm.textContent = '确认发动';
    btnConfirm.onclick = confirmJushou;
    const btnCancel = document.createElement('button'); btnCancel.className = 'cancel';
    btnCancel.textContent = '取消';
    btnCancel.onclick = cancelJushou;
    div.appendChild(h4);
    div.appendChild(p);
    div.appendChild(btnConfirm);
    div.appendChild(btnCancel);
    c.appendChild(div);
    return;
  }
  if(g.phase==='jushouChoose' && g.pending && g.pending.type==='jushouChoose'){
    const p = g.players[g.pending.seat];
    waitAskBanner(p ? p.name : '曹仁', '据守');
    return;
  }
  
  // 公孙瓒【趫猛】:伤害结算后的触发选择
  if(g.phase==='qiaomengChoose' && g.pending && g.pending.type==='qiaomengChoose' && g.pending.sourceSeat===mySeat){
    const target = g.players[g.pending.targetSeat];
    const div=document.createElement('div'); div.className='centered';
    const h4=document.createElement('h4'); h4.textContent='【趫猛】发动';
    div.appendChild(h4);
    const p1=document.createElement('p'); p1.textContent='你使用黑色【杀】对 '+escapeHtml(target?target.name:'目标')+' 造成了伤害';
    div.appendChild(p1);
    const p2=document.createElement('p'); p2.textContent='可以选择其装备区里的一张牌';
    div.appendChild(p2);
    const b1=document.createElement('button'); b1.className='skill-btn'; b1.style.background='#d4a762';
    b1.textContent='选择装备牌';
    b1.onclick=()=>triggerQiaomeng();
    div.appendChild(b1);
    const b2=document.createElement('button'); b2.className='cancel-btn';
    b2.textContent='不发动';
    b2.onclick=()=>cancelQiaomeng();
    div.appendChild(b2);
    c.appendChild(div);
    return;
  }
  if(g.phase==='qiaomengChoose' && g.pending && g.pending.type==='qiaomengChoose'){
    const source = g.players[g.pending.sourceSeat];
    const target = g.players[g.pending.targetSeat];
    setBanner(escapeHtml(source?source.name:'?')+' 发动【趫猛】,正在选择 '+escapeHtml(target?target.name:'?')+' 的装备牌…');
    return;
  }
  // 公孙瓒【趫猛】:选择装备牌
  if(g.phase==='qiaomengPickEquip' && g.pending && g.pending.type==='qiaomengPickEquip' && g.pending.sourceSeat===mySeat){
    const target = g.players[g.pending.targetSeat];
    const div=document.createElement('div'); div.className='centered';
    const h4=document.createElement('h4'); h4.textContent='【趫猛】选择装备牌';
    div.appendChild(h4);
    const p1=document.createElement('p'); p1.textContent='选择 '+escapeHtml(target?target.name:'目标')+' 的一张装备牌：';
    div.appendChild(p1);
    const equipDiv=document.createElement('div'); equipDiv.className='equip-options';
    
    const equips = target.equips || {};
    const equipNames = { weapon:'武器', armor:'防具', plus1:'防御马', minus1:'进攻马' };
    const availableSlots = g.pending.availableSlots || [];
    
    availableSlots.forEach(slot=>{
      const card = equips[slot];
      if(card){
        const isMount = isMountCard(card);
        const b=document.createElement('button');
        b.className='equip-btn';
        b.textContent=(equipNames[slot]||slot)+'【'+escapeHtml(card.name)+'】'+(isMount?' (坐骑-获得)':' (弃置)');
        b.onclick=()=>pickQiaomengEquip(slot);
        equipDiv.appendChild(b);
      }
    });
    div.appendChild(equipDiv);
    const cb=document.createElement('button'); cb.className='cancel-btn';
    cb.textContent='取消'; cb.onclick=()=>cancelQiaomeng();
    div.appendChild(cb);
    c.appendChild(div);
    return;
  }
  if(g.phase==='qiaomengPickEquip' && g.pending && g.pending.type==='qiaomengPickEquip'){
    const source = g.players[g.pending.sourceSeat];
    const target = g.players[g.pending.targetSeat];
    setBanner(escapeHtml(source?source.name:'?')+' 正在选择 '+escapeHtml(target?target.name:'?')+' 的装备牌…');
    return;
  }

  // 陈宫【明策】:选择牌阶段
  if(g.phase==='mingcePickCard' && g.pending && g.pending.type==='mingcePickCard' && g.pending.sourceSeat===mySeat){
    const div=document.createElement('div'); div.className='centered';
    const h4=document.createElement('h4'); h4.textContent='【明策】选择牌';
    div.appendChild(h4);
    const p1=document.createElement('p'); p1.textContent='请选择一张装备牌或【杀】';
    div.appendChild(p1);
    
    // 显示可选的手牌
    if(me && me.hand) {
      const handDiv=document.createElement('div'); handDiv.className='card-options';
      me.hand.forEach((card, i) => {
        if(card && (isEquipment(card) || canUseAs(me, card, '杀'))) {
          const b=document.createElement('button');
          b.className='card-btn';
          b.textContent='【'+escapeHtml(card.name)+'】';
          b.onclick=()=>pickMingceCard(i, false);
          handDiv.appendChild(b);
        }
      });
      div.appendChild(handDiv);
    }
    
    // 显示可选的装备
    if(me && me.equips) {
      const equipDiv=document.createElement('div'); equipDiv.className='equip-options';
      const equips = me.equips;
      const equipSlots = ['weapon', 'armor', 'plus1', 'minus1'];
      const equipNames = { weapon:'武器', armor:'防具', plus1:'+1马', minus1:'-1马' };
      
      equipSlots.forEach((slot, idx) => {
        const equip = equips[slot];
        if(equip) {
          const b=document.createElement('button');
          b.className='equip-btn';
          b.textContent=(equipNames[slot]||slot)+'【'+escapeHtml(equip.name)+'】';
          b.onclick=()=>pickMingceCard(idx, true);
          equipDiv.appendChild(b);
        }
      });
      div.appendChild(equipDiv);
    }
    
    const cb=document.createElement('button'); cb.className='cancel-btn';
    cb.textContent='取消'; cb.onclick=()=>cancelMingce();
    div.appendChild(cb);
    c.appendChild(div);
    return;
  }
  if(g.phase==='mingcePickCard' && g.pending && g.pending.type==='mingcePickCard'){
    const p = g.players[g.pending.sourceSeat];
    setBanner(escapeHtml(p?p.name:'?')+' 正在选择【明策】的牌…');
    return;
  }
  
  // 陈宫【明策】:选择接收牌的目标阶段
  if(g.phase==='mingcePickTarget' && g.pending && g.pending.type==='mingcePickTarget' && g.pending.sourceSeat===mySeat){
    const div=document.createElement('div'); div.className='centered';
    const h4=document.createElement('h4'); h4.textContent='【明策】选择目标';
    div.appendChild(h4);
    const p1=document.createElement('p'); p1.textContent='请选择接收 【'+escapeHtml(g.pending.cardName)+'】 的角色';
    div.appendChild(p1);
    
    // 显示所有其他存活角色
    for (let i = 0; i < g.players.length; i++) {
      if(i === mySeat) continue;
      const target = g.players[i];
      if(target && target.alive && isSeatClickable(i)) {
        const b=document.createElement('button');
        b.className='target-btn';
        b.textContent='选择 '+escapeHtml(target.name);
        b.onclick=()=>pickMingceTarget(i);
        div.appendChild(b);
      }
    }
    const cb=document.createElement('button'); cb.className='cancel-btn';
    cb.textContent='取消'; cb.onclick=()=>cancelMingce();
    div.appendChild(cb);
    c.appendChild(div);
    return;
  }
  
  // 法正【恩怨】:伤害后的触发阶段
  if(g.pending && g.pending.type==='enyuanChoose' && g.pending.damagerSeat===mySeat){
    const source = g.players[g.pending.sourceSeat];
    const div = document.createElement('div'); div.className = 'centered';
    const h4 = document.createElement('h4'); h4.textContent = '【恩怨】触发';
    div.appendChild(h4);
    const p = document.createElement('p'); p.textContent = source.name + ' 受到你的伤害，你需要选择';
    div.appendChild(p);
    const btn = document.createElement('button'); btn.className='skill-btn'; btn.style.background='#d4a762';
    btn.textContent='进行选择'; btn.onclick=()=>triggerEnyuan();
    div.appendChild(btn);
    c.appendChild(div);
    setBanner('你对 ' + source.name + ' 造成了伤害，需要选择【恩怨】效果');
    return;
  }

  // 法正【恩怨】:选择交♥手牌或失去体力阶段
  if(g.pending && g.pending.type==='enyuanChooseOption' && g.pending.damagerSeat===mySeat){
    const source = g.players[g.pending.sourceSeat];
    const div = document.createElement('div'); div.className = 'centered';
    const h4 = document.createElement('h4'); h4.textContent = '【恩怨】选择';
    div.appendChild(h4);
    const p = document.createElement('p'); p.textContent = '你需要选择：';
    div.appendChild(p);
    const hasHeart = g.pending.heartCards && g.pending.heartCards.length > 0;
    if(hasHeart) {
      const btn1 = document.createElement('button'); btn1.className='skill-btn';
      btn1.textContent='交一张♥手牌给' + source.name;
      btn1.onclick=()=>chooseEnyuanOption('giveCard');
      div.appendChild(btn1);
    }
    const btn2 = document.createElement('button'); btn2.className='skill-btn';
    btn2.textContent='失去1点体力';
    btn2.onclick=()=>chooseEnyuanOption('loseHp');
    div.appendChild(btn2);
    c.appendChild(div);
    setBanner('你需要选择：交一张♥手牌给' + source.name + '，或失去1点体力');
    return;
  }

  // 法正【恩怨】:选择要交的♥手牌阶段
  if(g.pending && g.pending.type==='enyuanGiveCard' && g.pending.damagerSeat===mySeat){
    const source = g.players[g.pending.sourceSeat];
    const div = document.createElement('div'); div.className = 'centered';
    const h4 = document.createElement('h4'); h4.textContent = '【恩怨】选择♥手牌';
    div.appendChild(h4);
    const p = document.createElement('p'); p.textContent = '选择要交给 ' + source.name + ' 的一张♥手牌：';
    div.appendChild(p);
    const cardDiv = document.createElement('div'); cardDiv.className = 'card-options';
    (g.players[mySeat].hand||[]).forEach((card, i) => {
      if(!card || card.suit!=='♥') return;
      const cb = document.createElement('button'); cb.className='card-btn';
      cb.textContent='【'+card.name+'】';
      cb.onclick=()=>giveEnyuanCard(i);
      cardDiv.appendChild(cb);
    });
    div.appendChild(cardDiv);
    c.appendChild(div);
    setBanner('选择要交给 ' + source.name + ' 的一张♥手牌');
    return;
  }

  if(g.phase==='mingcePickTarget' && g.pending && g.pending.type==='mingcePickTarget'){
    const source = g.players[g.pending.sourceSeat];
    setBanner(escapeHtml(source?source.name:'?')+' 正在选择【明策】的目标…');
    return;
  }
  
  // 陈宫【明策】:选择第二个目标阶段
  if(g.phase==='mingcePickTarget2' && g.pending && g.pending.type==='mingcePickTarget2' && g.pending.sourceSeat===mySeat){
    const target1 = g.players[g.pending.targetSeat];
    const div=document.createElement('div'); div.className='centered';
    const h4=document.createElement('h4'); h4.textContent='【明策】选择攻击目标';
    div.appendChild(h4);
    const p1=document.createElement('p'); p1.textContent='请选择 '+escapeHtml(target1?target1.name:'目标')+' 攻击范围内的角色作为【杀】的目标';
    div.appendChild(p1);
    
    // 显示可选的目标
    const candidates = g.pending.candidates || [];
    candidates.forEach(seat => {
      const target = g.players[seat];
      if(target && target.alive && isSeatClickable(seat)) {
        const b=document.createElement('button');
        b.className='target-btn';
        b.textContent='选择 '+escapeHtml(target.name);
        b.onclick=()=>pickMingceTarget2(seat);
        div.appendChild(b);
      }
    });
    const cb=document.createElement('button'); cb.className='cancel-btn';
    cb.textContent='取消'; cb.onclick=()=>cancelMingce();
    div.appendChild(cb);
    c.appendChild(div);
    return;
  }
  
  // 法正【眩惑】:选择目标阶段
  if(g.pending && g.pending.type==='huanhuoPick' && g.pending.sourceSeat===mySeat){
    const div = document.createElement('div'); div.className = 'centered';
    const h4 = document.createElement('h4'); h4.textContent = '【眩惑】选择目标';
    div.appendChild(h4);
    const p = document.createElement('p'); p.textContent = '选择要交♥手牌的角色：';
    div.appendChild(p);
    const targetDiv = document.createElement('div'); targetDiv.className = 'target-options';
    g.pending.candidates.forEach(seat => {
      const target = g.players[seat];
      if(target && target.alive && isSeatClickable(seat)) {
        const b = document.createElement('button'); b.className='target-btn';
        b.textContent=target.name;
        b.onclick=()=>pickHuanhuoTarget(seat);
        targetDiv.appendChild(b);
      }
    });
    div.appendChild(targetDiv);
    const cb = document.createElement('button'); cb.className='cancel-btn';
    cb.textContent='取消'; cb.onclick=()=>cancelHuanhuo();
    div.appendChild(cb);
    c.appendChild(div);
    setBanner('选择要交♥手牌的角色');
    return;
  }
  
  // 法正【眩惑】:选择♥手牌阶段
  if(g.pending && g.pending.type==='huanhuoPickCard' && g.pending.sourceSeat===mySeat){
    const target = g.players[g.pending.targetSeat];
    const div = document.createElement('div'); div.className = 'centered';
    const h4 = document.createElement('h4'); h4.textContent = '【眩惑】选择♥手牌';
    div.appendChild(h4);
    const p = document.createElement('p'); p.textContent = '直接点击下方手牌区的一张♥牌，或点击这里的快捷按钮：';
    div.appendChild(p);
    const cardDiv = document.createElement('div'); cardDiv.className = 'card-options';
    // game.js 的 huanhuoPickCard 只保存座位号；这里必须读取法正当前真实手牌，不能再访问
    // 已删除的 pending.heartCards，否则该阶段渲染会直接抛错，整个操作区变成空白。
    (g.players[mySeat].hand||[]).forEach((card, i) => {
      if(!card || card.suit!=='♥') return;
      const cb = document.createElement('button'); cb.className='card-btn';
      cb.textContent='【'+card.name+'】';
      cb.onclick=()=>pickHuanhuoHeartCard(i);
      cardDiv.appendChild(cb);
    });
    div.appendChild(cardDiv);
    const cb = document.createElement('button'); cb.className='cancel-btn';
    cb.textContent='取消发动【眩惑】'; cb.onclick=()=>cancelHuanhuo();
    div.appendChild(cb);
    c.appendChild(div);
    setBanner('选择要交给 ' + target.name + ' 的一张♥手牌（可直接点击下方手牌）');
    return;
  }

  // 法正【眩惑】:选择要获得的牌阶段
  if(g.pending && g.pending.type==='huanhuoPickGotCard' && g.pending.sourceSeat===mySeat){
    const target = g.players[g.pending.targetSeat];
    const div = document.createElement('div'); div.className = 'centered';
    const h4 = document.createElement('h4'); h4.textContent = '【眩惑】选择获得的牌';
    div.appendChild(h4);
    const p = document.createElement('p'); p.textContent = '获得 ' + target.name + ' 的一张牌（手牌暗置随机，装备可指定）：';
    div.appendChild(p);
    const cardDiv = document.createElement('div'); cardDiv.className = 'card-options';
    if((target.hand||[]).length){
      const cb = document.createElement('button'); cb.className='card-btn';
      cb.textContent='随机获得一张手牌（共'+target.hand.length+'张）';
      cb.onclick=()=>pickHuanhuoGotCard('hand');
      cardDiv.appendChild(cb);
    }
    const slotNames={weapon:'武器',armor:'防具',plus1:'+1马',minus1:'-1马'};
    EQUIP_SLOTS.forEach(slot=>{
      const card=target.equips && target.equips[slot];
      if(!card) return;
      const cb=document.createElement('button'); cb.className='card-btn';
      cb.textContent=slotNames[slot]+'【'+card.name+'】';
      cb.onclick=()=>pickHuanhuoGotCard('equip',slot);
      cardDiv.appendChild(cb);
    });
    div.appendChild(cardDiv);
    // 眩惑实质性结算已开始，不提供取消按钮
    c.appendChild(div);
    setBanner('获得 ' + target.name + ' 的一张手牌或装备');
    return;
  }

  // 法正【眩惑】:选择第二个目标阶段
  if(g.pending && g.pending.type==='huanhuoPickSecond' && g.pending.sourceSeat===mySeat){
    const div = document.createElement('div'); div.className = 'centered';
    const h4 = document.createElement('h4'); h4.textContent = '【眩惑】选择交给的角色';
    div.appendChild(h4);
    const p = document.createElement('p'); p.textContent = '选择要将获得的牌交给的角色：';
    div.appendChild(p);
    const targetDiv = document.createElement('div'); targetDiv.className = 'target-options';
    g.pending.candidates.forEach(seat => {
      const target = g.players[seat];
      if(target && target.alive && isSeatClickable(seat)) {
        const b = document.createElement('button'); b.className='target-btn';
        b.textContent=target.name;
        b.onclick=()=>pickHuanhuoSecondTarget(seat);
        targetDiv.appendChild(b);
      }
    });
    div.appendChild(targetDiv);
    // 眩惑实质性结算已开始，不提供取消按钮
    c.appendChild(div);
    setBanner('选择要将获得的牌交给的角色');
    return;
  }

  if(g.phase==='mingcePickTarget2' && g.pending && g.pending.type==='mingcePickTarget2'){
    const source = g.players[g.pending.sourceSeat];
    const target1 = g.players[g.pending.targetSeat];
    setBanner(escapeHtml(source?source.name:'?')+' 正在选择【明策】的第二个目标…');
    return;
  }
  
  // 陈宫【明策】:接收牌的角色选择阶段
  if(g.phase==='mingceChoice' && g.pending && g.pending.type==='mingceChoice' && g.pending.targetSeat===mySeat){
    const source = g.players[g.pending.sourceSeat];
    const target2 = g.pending.target2Seat !== null ? g.players[g.pending.target2Seat] : null;
    const div=document.createElement('div'); div.className='centered';
    const h4=document.createElement('h4'); h4.textContent=escapeHtml(source?source.name:'?')+' 发动【明策】';
    div.appendChild(h4);
    
    if(target2 && target2.alive) {
      const p1=document.createElement('p'); p1.textContent=escapeHtml(source?source.name:'?')+' 将 【'+escapeHtml(g.pending.cardName)+'】 交给你,并选择了 '+escapeHtml(target2.name)+' 为目标';
      div.appendChild(p1);
      const p2=document.createElement('p'); p2.textContent='请选择：';
      div.appendChild(p2);
      
      const b1=document.createElement('button'); b1.className='skill-btn'; b1.style.background='#e74c3c';
      b1.textContent='对 '+escapeHtml(target2.name)+' 使用普通【杀】';
      b1.onclick=()=>chooseMingceOption('sha');
      div.appendChild(b1);
      
      const b2=document.createElement('button'); b2.className='skill-btn'; b2.style.background='#4a90d9';
      b2.textContent='摸一张牌';
      b2.onclick=()=>chooseMingceOption('draw');
      div.appendChild(b2);
    } else {
      const p1=document.createElement('p'); p1.textContent=escapeHtml(source?source.name:'?')+' 将 【'+escapeHtml(g.pending.cardName)+'】 交给你,其攻击范围内无其他角色';
      div.appendChild(p1);
      const p2=document.createElement('p'); p2.textContent='请选择：';
      div.appendChild(p2);
      
      const b2=document.createElement('button'); b2.className='skill-btn'; b2.style.background='#4a90d9';
      b2.textContent='摸一张牌';
      b2.onclick=()=>chooseMingceOption('draw');
      div.appendChild(b2);
    }
    c.appendChild(div);
    return;
  }
  if(g.phase==='mingceChoice' && g.pending && g.pending.type==='mingceChoice'){
    const source = g.players[g.pending.sourceSeat];
    const target = g.players[g.pending.targetSeat];
    setBanner(escapeHtml(source?source.name:'?')+' 发动【明策】,等待 '+escapeHtml(target?target.name:'?')+' 选择…');
    return;
  }

  // 袁绍【乱击】:选择牌对阶段。【渲染层bug修复】这四个 luanji 分支原来嵌套在
  // }else if(g.phase==='play'){ 大分支内部——但 startLuanji() 把 g.phase 切到
  // 'luanjiChoose'/confirmLuanji 切到'luanjiConfirm'之后,g.phase 就不再是'play'了,
  // 外层 else-if 链条永远进不来这四个分支,导致选牌/确认面板对任何人(真人和机器人)都
  // 渲染不出来。修法是挪出 play 分支、改成独立的 g.phase==='luanjiChoose'/'luanjiConfirm'
  // 顶层判断(和 mingceChoice/qiaomengChoose 等其它独立单角色技能同一种写法),不改
  // startLuanji()/confirmLuanji() 本身的 phase 切换(game.js/skills.js 里 normalize 和
  // 各响应函数的守卫都只认 pending.type,不认 g.phase,唯一依赖 g.phase 语义的是
  // botSeatForState 的 Category A 短路——如果反过来让 startLuanji() 保持 g.phase='play'
  // 不切换,会让机器人调度错误地把这两步当成"正常出牌阶段决策"处理,绕开
  // BOT_PHASE_ACTOR.luanjiChoose/luanjiConfirm 已经注册好的专用分支,这条路更危险,
  // 故选择挪渲染代码而不是改 phase 切换)。
  if(g.phase==='luanjiChoose' && g.pending && g.pending.type==='luanjiChoose' && g.pending.sourceSeat===mySeat){
    const availablePairs = g.pending.availablePairs || [];
    const hand = me.hand || [];
    const div = document.createElement('div'); div.className = 'centered';
    const h4 = document.createElement('h4'); h4.textContent = '【乱击】选择牌对';
    div.appendChild(h4);
    const p = document.createElement('p'); p.textContent = '请选择两张花色相同的手牌当【万箭齐发】使用';
    div.appendChild(p);

    // 按花色分组显示
    const suitGroups = {};
    for (let i = 0; i < hand.length; i++) {
      const card = hand[i];
      const suit = card.suit;
      if (!suitGroups[suit]) {
        suitGroups[suit] = [];
      }
      suitGroups[suit].push({ index: i, card: card });
    }

    // 为每个花色组显示可选的牌对
    for (const [suit, cards] of Object.entries(suitGroups)) {
      if (cards.length >= 2) {
        const suitHeader = document.createElement('h5');
        suitHeader.textContent = suit + '花色组:';
        div.appendChild(suitHeader);

        // 显示所有可能的牌对
        for (let i = 0; i < cards.length; i++) {
          for (let j = i + 1; j < cards.length; j++) {
            const pairIndex = availablePairs.findIndex(
              pair => pair[0] === cards[i].index && pair[1] === cards[j].index
            );

            const b = document.createElement('button');
            b.className = 'card-btn';
            b.textContent = '【' + cards[i].card.name + '】+【' + cards[j].card.name + '】';
            b.onclick = () => pickLuanjiPair(pairIndex);
            div.appendChild(b);
          }
        }
      }
    }

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'ghost';
    cancelBtn.textContent = '取消';
    cancelBtn.onclick = () => cancelLuanji();
    div.appendChild(cancelBtn);

    c.appendChild(div);
    setBanner('请选择两张花色相同的手牌当【万箭齐发】使用');
    return;
  }

  // 袁绍【乱击】:确认阶段
  if(g.phase==='luanjiConfirm' && g.pending && g.pending.type==='luanjiConfirm' && g.pending.sourceSeat===mySeat){
    const cardIndices = g.pending.cardIndices;
    const hand = me.hand || [];
    const cards = [hand[cardIndices[0]], hand[cardIndices[1]]];

    const div = document.createElement('div'); div.className = 'centered';
    const h4 = document.createElement('h4'); h4.textContent = '【乱击】确认使用';
    div.appendChild(h4);
    const p = document.createElement('p');
    p.textContent = '确认使用【' + cards[0].name + '】和【' + cards[1].name + '】当【万箭齐发】使用吗?';
    div.appendChild(p);

    const confirmBtn = document.createElement('button');
    confirmBtn.className = 'primary';
    confirmBtn.textContent = '确认';
    confirmBtn.onclick = () => confirmLuanji();
    div.appendChild(confirmBtn);

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'ghost';
    cancelBtn.textContent = '取消';
    cancelBtn.onclick = () => cancelLuanji();
    div.appendChild(cancelBtn);

    c.appendChild(div);
    setBanner('确认使用乱击吗?');
    return;
  }

  // 袁绍【乱击】:观察者界面（其他玩家发动乱击时）
  if(g.phase==='luanjiChoose' && g.pending && g.pending.type==='luanjiChoose' && g.pending.sourceSeat!==mySeat){
    const source = g.players[g.pending.sourceSeat];
    setBanner(source ? source.name + ' 正在选择【乱击】的牌…' : '有人正在选择【乱击】的牌…');
    return;
  }
  if(g.phase==='luanjiConfirm' && g.pending && g.pending.type==='luanjiConfirm' && g.pending.sourceSeat!==mySeat){
    const source = g.players[g.pending.sourceSeat];
    setBanner(source ? source.name + ' 正在确认【乱击】…' : '有人正在确认【乱击】…');
    return;
  }

  // 法正【恩怨】:其他玩家选择阶段
  if(g.phase==='enyuanChoose' && g.pending && g.pending.type==='enyuanChoose' && g.pending.damagerSeat!==mySeat){
    const damager = g.players[g.pending.damagerSeat];
    const source = g.players[g.pending.sourceSeat];
    setBanner((damager ? damager.name : '?') + ' 需要选择【恩怨】效果…');
    return;
  }
  if(g.phase==='enyuanChooseOption' && g.pending && g.pending.type==='enyuanChooseOption' && g.pending.damagerSeat!==mySeat){
    const damager = g.players[g.pending.damagerSeat];
    const source = g.players[g.pending.sourceSeat];
    setBanner((damager ? damager.name : '?') + ' 正在选择【恩怨】的处理方式…');
    return;
  }
  if(g.phase==='enyuanGiveCard' && g.pending && g.pending.type==='enyuanGiveCard' && g.pending.damagerSeat!==mySeat){
    const damager = g.players[g.pending.damagerSeat];
    const source = g.players[g.pending.sourceSeat];
    setBanner((damager ? damager.name : '?') + ' 正在选择交给 ' + (source ? source.name : '?') + ' 的♥手牌…');
    return;
  }
  
  // 法正【眩惑】:其他玩家选择阶段
  if(g.phase==='huanhuoPick' && g.pending && g.pending.type==='huanhuoPick' && g.pending.sourceSeat!==mySeat){
    const source = g.players[g.pending.sourceSeat];
    setBanner((source ? source.name : '?') + ' 正在选择【眩惑】的目标…');
    return;
  }
  if(g.phase==='huanhuoPickCard' && g.pending && g.pending.type==='huanhuoPickCard' && g.pending.sourceSeat!==mySeat){
    const source = g.players[g.pending.sourceSeat];
    const target = g.players[g.pending.targetSeat];
    setBanner((source ? source.name : '?') + ' 正在选择要交给 ' + (target ? target.name : '?') + ' 的♥手牌…');
    return;
  }
  if(g.phase==='huanhuoPickGotCard' && g.pending && g.pending.type==='huanhuoPickGotCard' && g.pending.sourceSeat!==mySeat){
    const source = g.players[g.pending.sourceSeat];
    const target = g.players[g.pending.targetSeat];
    setBanner((source ? source.name : '?') + ' 正在选择从 ' + (target ? target.name : '?') + ' 获得的牌…');
    return;
  }
  if(g.phase==='huanhuoPickSecond' && g.pending && g.pending.type==='huanhuoPickSecond' && g.pending.sourceSeat!==mySeat){
    const source = g.players[g.pending.sourceSeat];
    setBanner((source ? source.name : '?') + ' 正在选择要交给的角色…');
    return;
  }
  
  // 祝融【烈刃】:伤害结算后的触发选择
  if(g.phase==='lieRenChoose' && g.pending && g.pending.type==='lieRenChoose' && g.pending.sourceSeat===mySeat){
    const target = g.players[g.pending.targetSeat];
    const div=document.createElement('div'); div.className='centered';
    const h4=document.createElement('h4'); h4.textContent='【烈刃】发动';
    div.appendChild(h4);
    const p1=document.createElement('p'); p1.textContent='你使用【杀】对 '+escapeHtml(target?target.name:'目标')+' 造成了伤害';
    div.appendChild(p1);
    const p2=document.createElement('p'); p2.textContent='可以与其拼点，若你赢，你获得其一张牌';
    div.appendChild(p2);
    const b1=document.createElement('button'); b1.className='skill-btn'; b1.style.background='#e74c3c';
    b1.textContent='发动烈刃';
    b1.onclick=()=>triggerLieRen();
    div.appendChild(b1);
    const b2=document.createElement('button'); b2.className='cancel-btn';
    b2.textContent='不发动';
    b2.onclick=()=>cancelLieRen();
    div.appendChild(b2);
    c.appendChild(div);
    return;
  }
  if(g.phase==='lieRenChoose' && g.pending && g.pending.type==='lieRenChoose'){
    const source = g.players[g.pending.sourceSeat];
    const target = g.players[g.pending.targetSeat];
    setBanner(escapeHtml(source?source.name:'?')+' 可以发动【烈刃】,与 '+escapeHtml(target?target.name:'?')+' 拼点…');
    return;
  }
  
  // 祝融【烈刃】:选择拼点牌
  if(g.phase==='lieRenPickCard' && g.pending && g.pending.type==='lieRenPickCard' && g.pending.sourceSeat===mySeat){
    const target = g.players[g.pending.targetSeat];
    const div=document.createElement('div'); div.className='centered';
    const h4=document.createElement('h4'); h4.textContent='【烈刃】选择拼点牌';
    div.appendChild(h4);
    const p1=document.createElement('p'); p1.textContent='请选择一张手牌用于拼点';
    div.appendChild(p1);
    const handDiv=document.createElement('div'); handDiv.className='hand-options';
    
    const hand = me.hand || [];
    hand.forEach((card, idx)=>{
      const b=document.createElement('button');
      b.className='card-btn';
      b.textContent='【'+escapeHtml(card.name)+'】'+card.suit+rankText(card.rank);
      b.onclick=()=>pickLieRenCard(idx);
      handDiv.appendChild(b);
    });
    div.appendChild(handDiv);
    const cb=document.createElement('button'); cb.className='cancel-btn';
    cb.textContent='取消'; cb.onclick=()=>cancelLieRen();
    div.appendChild(cb);
    c.appendChild(div);
    return;
  }
  if(g.phase==='lieRenPickCard' && g.pending && g.pending.type==='lieRenPickCard'){
    const source = g.players[g.pending.sourceSeat];
    const target = g.players[g.pending.targetSeat];
    setBanner(escapeHtml(source?source.name:'?')+' 发动【烈刃】,等待 '+escapeHtml(target?target.name:'?')+' 选择拼点牌…');
    return;
  }
  
  // 祝融【烈刃】:目标响应拼点
  if(g.phase==='lieRenRespond' && g.pending && g.pending.type==='lieRenRespond' && g.pending.targetSeat===mySeat){
    const source = g.players[g.pending.sourceSeat];
    const div=document.createElement('div'); div.className='centered';
    const h4=document.createElement('h4'); h4.textContent='【烈刃】拼点响应';
    div.appendChild(h4);
    const p1=document.createElement('p'); p1.textContent=escapeHtml(source?source.name:'祝融')+' 对你发动【烈刃】,请选择一张手牌拼点';
    div.appendChild(p1);
    const handDiv=document.createElement('div'); handDiv.className='hand-options';
    
    const hand = me.hand || [];
    hand.forEach((card, idx)=>{
      const b=document.createElement('button');
      b.className='card-btn';
      b.textContent='【'+escapeHtml(card.name)+'】'+card.suit+rankText(card.rank);
      b.onclick=()=>respondLieRen(idx);
      handDiv.appendChild(b);
    });
    div.appendChild(handDiv);
    c.appendChild(div);
    return;
  }
  if(g.phase==='lieRenRespond' && g.pending && g.pending.type==='lieRenRespond'){
    const source = g.players[g.pending.sourceSeat];
    const target = g.players[g.pending.targetSeat];
    setBanner(escapeHtml(source?source.name:'?')+' 对 '+escapeHtml(target?target.name:'?')+' 发动【烈刃】,等待 '+escapeHtml(target?target.name:'?')+' 选择拼点牌…');
    return;
  }

  // 张角【雷击】:使用或打出闪后的触发选择
  if(g.phase==='leijiChoose' && g.pending && g.pending.type==='leijiChoose' && g.pending.sourceSeat===mySeat){
    const div=document.createElement('div'); div.className='centered';
    const h4=document.createElement('h4'); h4.textContent='【雷击】发动';
    div.appendChild(h4);
    const p1=document.createElement('p'); p1.textContent='你使用或打出了【闪】,可以选择一名角色进行判定';
    div.appendChild(p1);
    const p2=document.createElement('p'); p2.textContent='若判定为♠黑桃,你将对其造成2点雷电伤害';
    div.appendChild(p2);
    const targetDiv=document.createElement('div'); targetDiv.className='target-options';
    
    (g.pending.availableTargets||[]).forEach(targetSeat=>{
      const target = g.players[targetSeat];
      if(target && target.alive){
        const b=document.createElement('button');
        b.className='target-btn';
        b.textContent='选择 '+escapeHtml(target.name);
        b.onclick=()=>triggerLeiji(targetSeat);
        targetDiv.appendChild(b);
      }
    });
    div.appendChild(targetDiv);
    const cb=document.createElement('button'); cb.className='cancel-btn';
    cb.textContent='不发动'; cb.onclick=()=>cancelLeiji();
    div.appendChild(cb);
    c.appendChild(div);
    return;
  }
  if(g.phase==='leijiChoose' && g.pending && g.pending.type==='leijiChoose'){
    const source = g.players[g.pending.sourceSeat];
    setBanner(escapeHtml(source?source.name:'?')+' 可以发动【雷击】,选择一名角色进行判定…');
    return;
  }
  
  // 张角【雷击】:雷击判定阶段
  if(g.phase==='leijiJudge' && g.pending && g.pending.type==='leijiJudge' && g.pending.sourceSeat===mySeat){
    const target = g.players[g.pending.targetSeat];
    const div=document.createElement('div'); div.className='centered';
    const h4=document.createElement('h4'); h4.textContent='【雷击】判定中';
    div.appendChild(h4);
    const p1=document.createElement('p'); p1.textContent='等待 '+escapeHtml(target?target.name:'目标')+' 的判定结果...';
    div.appendChild(p1);
    const b1=document.createElement('button'); b1.className='skill-btn'; b1.style.background='#f39c12';
    b1.textContent='进行判定';
    b1.onclick=()=>doLeijiJudge();
    div.appendChild(b1);
    c.appendChild(div);
    return;
  }
  if(g.phase==='leijiJudge' && g.pending && g.pending.type==='leijiJudge'){
    const source = g.players[g.pending.sourceSeat];
    const target = g.players[g.pending.targetSeat];
    setBanner(escapeHtml(source?source.name:'?')+' 对 '+escapeHtml(target?target.name:'?')+' 发动【雷击】,进行判定中…');
    return;
  }

  // 张角【鬼道】:询问是否发动鬼道
  if(g.phase==='guiduAsk' && g.pending && g.pending.type==='guiduAsk' && g.pending.sourceSeat===mySeat){
    const judgedPlayer = g.players[g.pending.judgedSeat];
    const judgeCard = g.pending.judgeCard;
    const div=document.createElement('div'); div.className='centered';
    const h4=document.createElement('h4'); h4.textContent='【鬼道】发动';
    div.appendChild(h4);
    const p1=document.createElement('p'); p1.textContent=escapeHtml(judgedPlayer?judgedPlayer.name:'?')+' 判定得到 '+judgeCard.suit+rankText(judgeCard.rank);
    div.appendChild(p1);
    const p2=document.createElement('p'); p2.textContent='你可以打出一张黑色牌替换之';
    div.appendChild(p2);
    const handDiv=document.createElement('div'); handDiv.className='hand-options';
    
    const hand = me.hand || [];
    hand.forEach((card, i) => {
      if(card && (card.suit === '♠' || card.suit === '♣')){
        const b=document.createElement('button');
        b.className='card-btn';
        b.style.background='#2c3e50'; b.style.color='white';
        b.textContent='打出【'+escapeHtml(card.name)+'】('+card.suit+rankText(card.rank)+')';
        b.onclick=()=>triggerGuidu(i);
        handDiv.appendChild(b);
      }
    });
    div.appendChild(handDiv);
    const cb=document.createElement('button'); cb.className='cancel-btn';
    cb.textContent='不发动'; cb.onclick=()=>cancelGuidu();
    div.appendChild(cb);
    c.appendChild(div);
    return;
  }
  if(g.phase==='guiduAsk' && g.pending && g.pending.type==='guiduAsk'){
    const source = g.players[g.pending.sourceSeat];
    const judgedPlayer = g.players[g.pending.judgedSeat];
    setBanner(escapeHtml(source?source.name:'?')+' 正在决定是否发动【鬼道】替换 '+escapeHtml(judgedPlayer?judgedPlayer.name:'?')+' 的判定牌…');
    return;
  }

  // 夏侯渊【神速】UI
  // 神速1：在判定阶段开始前的触发点
  if(g.phase==='shensuChoose1' && g.pending && g.pending.type==='shensuChoose1' && g.pending.seat===mySeat){
    const p = g.players[mySeat];
    const div=document.createElement('div'); div.className='centered';
    const h4=document.createElement('h4'); h4.textContent='【神速】发动时机';
    div.appendChild(h4);
    const p1=document.createElement('p'); p1.textContent='你可以发动【神速1】跳过判定和摸牌阶段，视为使用一张无距离限制的【杀】';
    div.appendChild(p1);
    const b1=document.createElement('button'); b1.className='skill-btn'; b1.style.background='#d4a762';
    b1.textContent='发动神速1';
    b1.onclick=()=>triggerShensu1();
    div.appendChild(b1);
    const b2=document.createElement('button'); b2.className='cancel-btn';
    b2.textContent='不发动';
    b2.onclick=()=>skipShensu1();
    div.appendChild(b2);
    c.appendChild(div);
    setBanner(p.name + ' 可以发动【神速1】跳过判定和摸牌阶段');
    return;
  }
  if(g.phase==='shensuChoose1' && g.pending && g.pending.type==='shensuChoose1'){
    const p = g.players[g.pending.seat];
    waitAskBanner(p ? p.name : '夏侯渊', '神速1');
    return;
  }
  
  // 神速2：在摸牌结束后的触发点
  if(g.phase==='shensuChoose2' && g.pending && g.pending.type==='shensuChoose2' && g.pending.seat===mySeat){
    const p = g.players[mySeat];
    const div=document.createElement('div'); div.className='centered';
    const h4=document.createElement('h4'); h4.textContent='【神速】发动时机';
    div.appendChild(h4);
    const p1=document.createElement('p'); p1.textContent='你可以发动【神速2】跳过出牌阶段并弃置一张装备牌，视为使用一张无距离限制的【杀】';
    div.appendChild(p1);
    const b1=document.createElement('button'); b1.className='skill-btn'; b1.style.background='#d4a762';
    b1.textContent='发动神速2';
    b1.onclick=()=>triggerShensu2();
    div.appendChild(b1);
    const b2=document.createElement('button'); b2.className='cancel-btn';
    b2.textContent='不发动';
    b2.onclick=()=>skipShensu2();
    div.appendChild(b2);
    c.appendChild(div);
    setBanner(p.name + ' 可以发动【神速2】跳过出牌阶段并弃置装备牌');
    return;
  }
  if(g.phase==='shensuChoose2' && g.pending && g.pending.type==='shensuChoose2'){
    const p = g.players[g.pending.seat];
    waitAskBanner(p ? p.name : '夏侯渊', '神速2');
    return;
  }
  
  // 神速杀目标选择
  if(g.pending && g.pending.type==='shensuSha' && g.pending.seat===mySeat){
    const p = g.players[mySeat];
    const remaining = g.pending.remaining || 1;
    const shensuShaRemaining = g.shensuShaRemaining || remaining;
    const div=document.createElement('div'); div.className='centered';
    const h4=document.createElement('h4'); h4.textContent='选择【神速】的目标';
    div.appendChild(h4);
    const p1=document.createElement('p'); p1.textContent='请选择第' + (shensuShaRemaining - remaining + 1) + '张无距离限制的普通【杀】的目标（还需' + remaining + '次）';
    div.appendChild(p1);
    
    // 添加目标选择按钮
    g.players.forEach((tgt, seat) => {
      if(!tgt || !tgt.alive || seat === mySeat) return;
      const b=document.createElement('button');
      b.className='target-btn';
      b.textContent='攻击 ' + tgt.name;
      b.onclick=()=>respondShensuSha(seat);
      div.appendChild(b);
    });
    
    const cancelBtn=document.createElement('button'); cancelBtn.className='cancel-btn';
    cancelBtn.textContent='取消';
    cancelBtn.onclick=()=>cancelShensuSha();
    div.appendChild(cancelBtn);
    c.appendChild(div);
    setBanner(p.name + ' 选择【神速】的【杀】目标');
    return;
  }
  if(g.pending && g.pending.type==='shensuSha'){
    const p = g.players[g.pending.seat];
    const remaining = g.pending.remaining || 1;
    setBanner((p?p.name:'夏侯渊') + ' 正在选择第' + (g.shensuShaRemaining - remaining + 1) + '张无距离限制的【杀】目标（还需' + remaining + '次）…');
    return;
  }
  
  // 马谡【散谣】UI 已改为客户端本地状态机(sanyaoMode,见下方"出牌阶段按钮"区块的
  // else-if 分支),不再经过服务端 pending,这里不需要任何分派——旧的 renderSanyao/
  // renderSanyaoChooseTarget 两个函数(判断的是已作废的 sanyao/sanyaoChooseTarget 服务端
  // pending 类型,且调用着第一步就已删除的 respondSanyao/respondSanyaoTarget)已一并删除。

  // 马谡【制蛮】UI
  const zhimengAskHtml = renderZhimengAsk(g);
  if(zhimengAskHtml) { c.innerHTML = zhimengAskHtml; return; }
  const zhimengPickHtml = renderZhimengPick(g);
  if(zhimengPickHtml) { c.innerHTML = zhimengPickHtml; return; }
  
  // 周泰【不屈】UI:体力降到0时是否放置不屈牌
  if(g.phase==='buquAsk' && g.pending && g.pending.type==='buquAsk' && g.pending.seat===mySeat){
    const div=document.createElement('div'); div.className='centered';
    const p=document.createElement('p'); p.textContent='是否发动【不屈】,放置一张不屈牌？';
    div.appendChild(p);
    
    const btnUse=document.createElement('button');
    btnUse.textContent='放置不屈牌';
    btnUse.onclick=()=>respondBuqu(true);
    div.appendChild(btnUse);
    
    const btnSkip=document.createElement('button');
    btnSkip.textContent='不发动';
    btnSkip.onclick=()=>respondBuqu(false);
    div.appendChild(btnSkip);
    
    c.appendChild(div);
    setBanner('请选择是否发动【不屈】');
    return;
  }
  
  // 身份局主公选将(须在 !g.started 通用大厅分支之前)
  if(g.phase==='pickingLordGeneral'){
    const lord = getLordSeat(g);
    if(lord===mySeat){
      renderPickGeneral(g, c, { lordPick:true });
    } else {
      const lordP = g.players[lord];
      setBanner('等待主公 '+(lordP?escapeHtml(lordP.name):'')+' 选将…');
    }
    return;
  }
  if(!g.started){
    const cnt=(g.players||[]).filter(Boolean).length;
    const botCnt=(g.players||[]).filter(p=>p&&p.isBot).length;
    if(mySeat===0){
      const add=document.createElement('button');
      add.className='ghost'; add.textContent='添加机器人（当前 '+botCnt+'）';
      // handleAddBotClick(ai-bot.js)包装了 addBot——第一次点击(这个会话内还没设置
      // 过密钥、也没点过跳过)会先弹出 AI 密钥询问弹窗,回应(填密钥或跳过)后再真正
      // 调用 addBot();已经回应过一次之后,后续点击直接 addBot(),不再重复打断。
      add.disabled=cnt>=SEATS; add.onclick=handleAddBotClick; c.appendChild(add);
      if(botCnt>0){
        const remove=document.createElement('button');
        remove.className='ghost'; remove.textContent='移除机器人';
        remove.onclick=removeBot; c.appendChild(remove);
      }
      // AI机器人设置入口(ai-bot.js)——和上面添加/移除机器人按钮同一个身份边界
      // (mySeat===0,持有密钥的只有触发 addBot() 的这个人),常驻小按钮,随时可点开
      // 密钥弹窗查看/修改当前配置,不受"这个会话是否已经回应过密钥询问"影响。留空
      // 则机器人保持现有的本地规则行为,不接入任何游戏逻辑(见 ai-bot.js 文件头部
      // 范围声明)。
      renderAiStatusButton(c);
    }
    // 1) 对战模式:乱斗 / 主公局
    const mkModeBtn=(label, mode)=>{
      const b=document.createElement('button');
      b.className = selectedGameMode===mode ? 'primary' : 'ghost';
      b.textContent = label;
      b.onclick=()=>{ selectedGameMode=mode; if(typeof currentG!=='undefined' && currentG) render(currentG); else render(g); };
      c.appendChild(b);
    };
    mkModeBtn('乱斗', 'ffa');
    mkModeBtn('主公局', 'identity');

    // 2) 开局方式(依赖已选模式)
    if(selectedGameMode==='ffa'){
      const btnRandom=document.createElement('button');
      btnRandom.className='ghost'; btnRandom.textContent='开始游戏(随机武将)（'+cnt+'/'+SEATS+'）';
      btnRandom.disabled = cnt<MIN_PLAYERS;
      btnRandom.onclick=()=>startGame('random','ffa');
      c.appendChild(btnRandom);
      const btnPick=document.createElement('button');
      btnPick.className='ghost'; btnPick.textContent='开始游戏(三选一)（'+cnt+'/'+SEATS+'）';
      btnPick.disabled = cnt<MIN_PLAYERS;
      btnPick.onclick=()=>startGame('pick','ffa');
      c.appendChild(btnPick);
    } else if(selectedGameMode==='identity'){
      // 主公局仅三选一,不提供随机武将
      const btnPick=document.createElement('button');
      btnPick.className='ghost';
      btnPick.textContent='开始身份局(三选一)（'+cnt+'/'+SEATS+'）';
      btnPick.disabled = cnt<1; // 可点,人数不足在 onclick 拦截(规格 B)
      btnPick.onclick=()=>{
        if(cnt<4){ alert('主公局至少需要 4 名玩家'); return; }
        if(cnt>8){ alert('主公局最多 8 名玩家'); return; }
        startGame('pick','identity');
      };
      c.appendChild(btnPick);
    } else {
      const tip=document.createElement('button');
      tip.className='ghost'; tip.disabled=true;
      tip.textContent='请先选择对战模式';
      c.appendChild(tip);
    }

    if(!selectedGameMode) setBanner('请先选择对战模式：乱斗 或 主公局');
    else if(selectedGameMode==='identity'){
      if(cnt<4) setBanner('主公局需 4~8 人，还差 '+(4-cnt)+' 人…');
      else if(cnt<SEATS) setBanner('身份局已可开始（'+cnt+' 人），主公将先选将（5 选 1）');
      else setBanner('身份局已满员，可开始');
    } else if(cnt<MIN_PLAYERS) setBanner('至少 '+MIN_PLAYERS+' 人即可开始,还差 '+(MIN_PLAYERS-cnt)+' 人…');
    else if(cnt<SEATS) setBanner('已可开始（'+cnt+' 人),也可等满 '+SEATS+' 人。');
    return;
  }
  if(g.phase==='over'){
    const btn=document.createElement('button'); btn.className='primary';
    btn.textContent='再来一局'; btn.onclick=()=>{ selectedGameMode=null; newGame(); }; c.appendChild(btn);
    // "结束并清理房间"这个按钮已经统一到页面左上角常驻的 #closeRoomBtn(cleanupRoom),
    // 不再在这里重复渲染同一个功能,避免游戏结束时同时出现两个功能一样的按钮让玩家困惑。
    const winText = g.gameMode==='identity'
      ? ('胜方：'+(g.winner||'无'))
      : ('胜者：'+(g.winner||''));
    setBanner('🏆 '+escapeHtml(winText)+' · 大家看完结果后,可点左上角「关闭房间」删除本房间数据。', 'border-color:var(--gold);color:var(--gold)');
    return;
  }
  if(g.phase==='tieqi' && g.pending && g.pending.type==='tieqi' && g.pending.from===mySeat){
    const b1=document.createElement('button'); b1.className='primary';
    b1.textContent='发动【铁骑】判定'; b1.onclick=()=>respondTieqi(true);
    c.appendChild(b1);
    const b2=document.createElement('button');
    b2.textContent='不发动'; b2.onclick=()=>respondTieqi(false);
    c.appendChild(b2);
    const to=g.players[g.pending.to].name;
    setBanner('你对 '+escapeHtml(to)+' 出【杀】,是否发动【铁骑】判定?若为红色则此杀不可被闪抵消。'+fangtianSuffix(g));
    return;
  }
  if(g.phase==='tieqi' && g.pending && g.pending.type==='tieqi'){
    const from=g.players[g.pending.from].name, to=g.players[g.pending.to].name;
    setBanner(escapeHtml(from)+' 对 '+escapeHtml(to)+' 出【杀】,'+escapeHtml(from)+' 是否发动【铁骑】进行判定…'+fangtianSuffix(g));
    return;
  }
  if(g.phase==='shuangxiongAsk' && g.pending && g.pending.type==='shuangxiongAsk' && g.pending.seat===mySeat){
    const b1=document.createElement('button'); b1.className='primary';
    b1.textContent='发动【双雄】判定';
    b1.onclick=()=>respondShuangxiong(true);
    c.appendChild(b1);
    const b2=document.createElement('button');
    b2.textContent='不发动';
    b2.onclick=()=>respondShuangxiong(false);
    c.appendChild(b2);
    setBanner('摸牌阶段,是否发动【双雄】?发动后不摸牌,改为判定并获得判定牌。');
    return;
  }
  if(g.phase==='shuangxiongAsk' && g.pending && g.pending.type==='shuangxiongAsk'){
    const p=g.players[g.pending.seat];
    waitAskBanner(p?p.name:'颜良文丑', '双雄');
    return;
  }
  if(g.phase==='liegong' && g.pending && g.pending.type==='liegong' && g.pending.from===mySeat){
    const b1=document.createElement('button'); b1.className='primary';
    b1.textContent='发动【烈弓】'; b1.onclick=()=>respondLiegong(true);
    c.appendChild(b1);
    const b2=document.createElement('button');
    b2.textContent='不发动'; b2.onclick=()=>respondLiegong(false);
    c.appendChild(b2);
    const to=g.players[g.pending.to].name;
    setBanner('你对 '+escapeHtml(to)+' 出【杀】,是否发动【烈弓】?令此杀不可被闪抵消。'+fangtianSuffix(g));
    return;
  }
  if(g.phase==='liegong' && g.pending && g.pending.type==='liegong'){
    const from=g.players[g.pending.from].name, to=g.players[g.pending.to].name;
    setBanner(escapeHtml(from)+' 对 '+escapeHtml(to)+' 出【杀】,'+escapeHtml(from)+' 是否发动【烈弓】…'+fangtianSuffix(g));
    return;
  }
  // 青龙偃月刀:杀被闪抵消,装备者(攻击者)是否发动再使用一张杀(固定同一目标,不需要选目标)。
  if(g.phase==='qinglong' && g.pending && g.pending.type==='qinglong' && g.pending.from===mySeat){
    const to=g.players[g.pending.to].name;
    if(qinglongMode){
      setBanner('【青龙偃月刀】选择一张能当【杀】的手牌,对 '+escapeHtml(to)+' 再次使用。');
      const cb=document.createElement('button'); cb.className='ghost';
      cb.textContent='取消'; cb.onclick=()=>{ resetQinglong(); render(g); }; c.appendChild(cb);
    } else {
      const b1=document.createElement('button'); b1.className='primary';
      b1.textContent='发动【青龙偃月刀】'; b1.onclick=()=>{ qinglongMode=true; render(g); };
      c.appendChild(b1);
      const b2=document.createElement('button');
      b2.textContent='不发动'; b2.onclick=()=>respondQinglong(false);
      c.appendChild(b2);
      setBanner('你对 '+escapeHtml(to)+' 的【杀】被【闪】抵消,是否发动【青龙偃月刀】再使用一张【杀】?');
    }
    return;
  }
  if(g.phase==='qinglong' && g.pending && g.pending.type==='qinglong'){
    const from=g.players[g.pending.from].name, to=g.players[g.pending.to].name;
    setBanner(escapeHtml(from)+' 对 '+escapeHtml(to)+' 的【杀】被【闪】抵消,'+escapeHtml(from)+' 是否发动【青龙偃月刀】…');
    return;
  }
  // 陆逊【连营】:失去最后1张手牌时是否发动（merge from wenwen_dev；main 曾 revert，本支保留）
  if(g.phase==='lianyingAsk' && g.pending && g.pending.type==='lianyingAsk' && g.pending.seat===mySeat){
    const b1=document.createElement('button'); b1.className='primary';
    b1.textContent='发动【连营】'; b1.onclick=()=>respondLianying(true);
    c.appendChild(b1);
    const b2=document.createElement('button');
    b2.textContent='不发动'; b2.onclick=()=>respondLianying(false);
    c.appendChild(b2);
    setBanner('你失去了最后一张手牌,是否发动【连营】,摸1张牌…');
    return;
  }
  if(g.phase==='lianyingAsk' && g.pending && g.pending.type==='lianyingAsk'){
    const p=g.players[g.pending.seat];
    setBanner((p?p.name:'?')+' 是否发动【连营】…');
    return;
  }
  // 贯石斧:杀被闪抵消,装备者(攻击者)可弃自己2张牌(手牌/装备混合toggle多选)令这张杀依然
  // 造成伤害。恰好选够2项才出现"确认发动";同屏始终有"不发动"。
  if(g.phase==='guanshi' && g.pending && g.pending.type==='guanshi' && g.pending.from===mySeat){
    const to=g.players[g.pending.to].name;
    const opts=guanshifuOptions(g.players[mySeat]);
    opts.forEach(o=>{
      const picked=guanshiPicks.includes(o.key);
      const b=document.createElement('button');
      if(picked) b.className='primary';
      b.textContent=(picked?'✓ ':'')+o.label;
      b.onclick=()=>{
        if(picked) guanshiPicks=guanshiPicks.filter(x=>x!==o.key);
        else if(guanshiPicks.length<2) guanshiPicks=[...guanshiPicks, o.key];
        render(g);
      };
      c.appendChild(b);
    });
    if(guanshiPicks.length===2){
      const ok=document.createElement('button'); ok.className='primary';
      ok.textContent='确认发动【贯石斧】'; ok.onclick=()=>{ const picks=guanshiPicks.slice(); resetGuanshi(); respondGuanshi(picks); };
      c.appendChild(ok);
    }
    const nb=document.createElement('button');
    nb.textContent='不发动'; nb.onclick=()=>{ resetGuanshi(); respondGuanshi(null); };
    c.appendChild(nb);
    setBanner('你对 '+escapeHtml(to)+' 的【杀】被【闪】抵消,是否弃2张牌(已选 '+guanshiPicks.length+'/2)发动【贯石斧】令此【杀】依然造成伤害?');
    return;
  }
  if(g.phase==='guanshi' && g.pending && g.pending.type==='guanshi'){
    const from=g.players[g.pending.from].name, to=g.players[g.pending.to].name;
    setBanner(escapeHtml(from)+' 对 '+escapeHtml(to)+' 的【杀】被【闪】抵消,'+escapeHtml(from)+' 是否发动【贯石斧】…');
    return;
  }
  // 杀被抵消后的效果选择(猛进/青龙/贯石斧)
  if(g.phase==='shaOffsetChoice' && g.pending && g.pending.type==='shaOffsetChoice' && g.pending.from===mySeat){
    const {from, to, available} = g.pending;
    const fromName = g.players[from].name;
    const toName = g.players[to].name;
    
    available.forEach(effectId => {
      const b=document.createElement('button'); b.className='primary';
      if(effectId === 'mengjin') b.textContent='发动【猛进】';
      else if(effectId === 'qinglong') b.textContent='发动【青龙偃月刀】';
      else if(effectId === 'guanshifu') b.textContent='发动【贯石斧】';
      
      if(effectId === 'mengjin') b.onclick=()=>respondShaOffsetChoice('mengjin');
      else if(effectId === 'qinglong') b.onclick=()=>respondShaOffsetChoice('qinglong');
      else if(effectId === 'guanshifu') b.onclick=()=>respondShaOffsetChoice('guanshifu');
      c.appendChild(b);
    });
    
    const endBtn=document.createElement('button'); endBtn.className='ghost';
    endBtn.textContent='结束'; 
    endBtn.onclick=()=>respondShaOffsetChoice(null);
    c.appendChild(endBtn);
    
    setBanner('你对 '+escapeHtml(toName)+' 的【杀】被【闪】抵消,选择发动效果…');
    return;
  }
  if(g.phase==='shaOffsetChoice' && g.pending && g.pending.type==='shaOffsetChoice'){
    const fromName = g.players[g.pending.from]?.name || '某玩家';
    const toName = g.players[g.pending.to]?.name || '某玩家';
    setBanner('等待 '+escapeHtml(fromName)+' 选择杀被抵消后的效果…');
    return;
  }
  // 庞德【猛进】:选择弃置目标的牌
  if(g.phase==='mengjin' && g.pending && g.pending.type==='mengjin' && g.pending.from===mySeat){
    const {from, to, available} = g.pending;
    const fromName = g.players[from].name;
    const toName = g.players[to].name;
    const target = g.players[to];
    
    // 手牌选项
    if(available.includes('hand')){
      const hb=document.createElement('button'); hb.className='primary';
      hb.textContent='弃置一张手牌(随机)';
      hb.onclick=()=>mengjinPick('hand');
      c.appendChild(hb);
    }
    
    // 装备选项
    available.forEach(opt => {
      if(opt !== 'hand'){
        const eb=document.createElement('button'); eb.className='primary';
        const equip = target.equips[opt];
        if(equip) eb.textContent='弃置装备【'+equip.name+'】';
        else eb.textContent='弃置装备槽('+opt+')';
        eb.onclick=()=>mengjinPick(opt);
        c.appendChild(eb);
      }
    });
    
    setBanner(fromName+' 发动【猛进】,选择弃置 '+toName+' 的一张牌…');
    return;
  }
  if(g.phase==='mengjin' && g.pending && g.pending.type==='mengjin'){
    const fromName = g.players[g.pending.from]?.name || '某玩家';
    const toName = g.players[g.pending.to]?.name || '某玩家';
    setBanner('等待 '+escapeHtml(fromName)+' 选择弃置 '+toName+' 的牌(猛进)…');
    return;
  }
  // 郭嘉【遗计】:受伤后是否发动,看牌堆顶2张(不足2张时可能只有1张)分给任意角色(含自己)。
  if(g.phase==='yijiAsk' && g.pending && g.pending.type==='yijiAsk' && g.pending.seat===mySeat){
    const b1=document.createElement('button'); b1.className='primary';
    b1.textContent='发动【遗计】'; b1.onclick=()=>respondYijiAsk(true);
    c.appendChild(b1);
    const b2=document.createElement('button');
    b2.textContent='不发动'; b2.onclick=()=>respondYijiAsk(false);
    c.appendChild(b2);
    setBanner('你受到了伤害,是否发动【遗计】,观看牌堆顶两张牌并分配?');
    return;
  }
  if(g.phase==='yijiAsk' && g.pending && g.pending.type==='yijiAsk'){
    const p=g.players[g.pending.seat].name;
    waitAskBanner(p, '遗计'); // 不剧透是否受伤/发动详情之外的任何牌面信息
    return;
  }
  // 郭嘉【遗计】分配阶段:g.pending.cards 是共享状态里的真实牌面,理论上任何客户端都能读到——
  // 必须严格只在 mySeat===pending.seat 时才把牌面画出来,其余客户端只看不剧透的 banner,
  // 和现有对手手牌只显示牌背的处理原则一致(见 CLAUDE.md 的技术债提示)。
  if(g.phase==='yijiAssign' && g.pending && g.pending.type==='yijiAssign' && g.pending.seat===mySeat){
    const cards=g.pending.cards;
    const alivePlayers=g.players.map((p,i)=>({p,i})).filter(o=>o.p && o.p.alive);
    const idx=yijiPicks.length; // 当前正在为第几张牌选接收者(0-based),渲染这一刻冻结,不在 onclick 里读可变的 yijiPicks
    const isLast=(idx===cards.length-1);
    const card=cards[idx];
    const cardBox=document.createElement('div'); cardBox.className='card '+(card.name==='杀'?'sha':card.name==='桃'?'tao':card.name==='闪'?'shan':'trick');
    cardBox.style.display='inline-block'; cardBox.style.marginRight='10px';
    cardBox.innerHTML='<div class="corner">'+(cardFace(card)||card.name)+'</div><div class="big">'+card.name+'</div><div class="corner br">'+card.name+'</div>';
    c.appendChild(cardBox);
    alivePlayers.forEach(o=>{
      const b=document.createElement('button');
      b.textContent='给 '+(o.i===mySeat?'自己':o.p.name);
      // 选到最后一张牌时,这次点击就直接提交(不是"选满再点确认"那套,少一步交互);
      // 不是最后一张就只是累积选择、留在同一 tx 之外继续问下一张。
      b.onclick = isLast
        ? ()=>{ const picks=[...yijiPicks, o.i]; resetYiji(); respondYijiAssign(picks); }
        : ()=>{ yijiPicks=[...yijiPicks, o.i]; render(g); };
      c.appendChild(b);
    });
    if(idx>0){
      const back=document.createElement('button'); back.className='ghost';
      back.textContent='上一步(重选)'; back.onclick=()=>{ yijiPicks=yijiPicks.slice(0,-1); render(g); };
      c.appendChild(back);
    }
    setBanner('【遗计】选择第'+(idx+1)+'/'+cards.length+'张牌交给谁?');
    return;
  }
  if(g.phase==='yijiAssign' && g.pending && g.pending.type==='yijiAssign'){
    const p=g.players[g.pending.seat].name;
    setBanner(escapeHtml(p)+' 正在分配【遗计】看到的牌…'); // 不渲染牌面,严格保密
    return;
  }
  if(g.phase==='ganglieAsk' && g.pending && g.pending.type==='ganglieAsk' && g.pending.seat===mySeat){
    const source=g.players[g.pending.sourceSeat];
    const b1=document.createElement('button'); b1.className='primary';
    b1.textContent='发动【刚烈】'; b1.onclick=()=>respondGanglieAsk(true);
    c.appendChild(b1);
    const b2=document.createElement('button');
    b2.textContent='不发动'; b2.onclick=()=>respondGanglieAsk(false);
    c.appendChild(b2);
    setBanner('你受到伤害,是否对 '+escapeHtml(source?source.name:'伤害来源')+' 发动【刚烈】进行判定?');
    return;
  }
  if(g.phase==='ganglieAsk' && g.pending && g.pending.type==='ganglieAsk'){
    const p=g.players[g.pending.seat].name;
    waitAskBanner(p, '刚烈');
    return;
  }
  if(g.phase==='ganglieChoice' && g.pending && g.pending.type==='ganglieChoice' && g.pending.sourceSeat===mySeat){
    const victim=g.players[g.pending.seat];
    const hand=me.hand||[];
    if(hand.length>=2){
      hand.forEach((card, idx)=>{
        const picked=gangliePicks.includes(idx);
        const b=document.createElement('button');
        if(picked) b.className='primary';
        b.textContent=(picked?'✓ ':'')+'弃【'+card.name+'】';
        b.onclick=()=>{
          if(picked) gangliePicks=gangliePicks.filter(x=>x!==idx);
          else if(gangliePicks.length<2) gangliePicks=[...gangliePicks, idx];
          render(g);
        };
        c.appendChild(b);
      });
      if(gangliePicks.length===2){
        const ok=document.createElement('button'); ok.className='primary';
        ok.textContent='确认弃置2张';
        ok.onclick=()=>{ const picks=gangliePicks.slice(); resetGanglie(); respondGanglieChoice('discard', picks); };
        c.appendChild(ok);
      }
    }
    const hurt=document.createElement('button');
    hurt.textContent='受到1点伤害';
    hurt.onclick=()=>{ resetGanglie(); respondGanglieChoice('damage'); };
    c.appendChild(hurt);
    const discardText=hand.length>=2 ? '可弃置2张手牌或' : '手牌不足2张,只能';
    setBanner('【刚烈】判定不为红桃,'+discardText+'受到 '+escapeHtml(victim?victim.name:'夏侯惇')+' 造成的1点伤害。已选 '+gangliePicks.length+'/2');
    return;
  }
  if(g.phase==='ganglieChoice' && g.pending && g.pending.type==='ganglieChoice'){
    const source=g.players[g.pending.sourceSeat], victim=g.players[g.pending.seat];
    setBanner('【刚烈】判定不为红桃,等待 '+escapeHtml(source?source.name:'伤害来源')+' 选择弃牌或受到 '+escapeHtml(victim?victim.name:'夏侯惇')+' 造成的1点伤害…');
    return;
  }
  // 华雄【耀武】:伤害来源选择回复体力或摸牌
  if(g.phase==='yaowu_choose' && g.pending && g.pending.type==='yaowu_choose' && g.pending.seat===mySeat){
    const b1=document.createElement('button'); b1.className='primary';
    const src = g.players[g.pending.seat];
    const disabledRecover = src && src.hp >= src.maxHp;
    if (!disabledRecover) {
      b1.textContent='回复1点体力';
      b1.onclick=()=>respondYaowu('recover');
      c.appendChild(b1);
    }
    const b2=document.createElement('button');
    b2.textContent='摸一张牌';
    b2.onclick=()=>respondYaowu('draw');
    c.appendChild(b2);
    const tgt = g.players[g.pending.target];
    setBanner('【耀武】 '+escapeHtml(src?src.name:'你')+' 选择：'+(disabledRecover?'摸一张牌':'回复1点体力 或 摸一张牌')+'（由 '+escapeHtml(tgt?tgt.name:'华雄')+' 受到红色【杀】伤害触发）');
    return;
  }
  if(g.phase==='yaowu_choose' && g.pending && g.pending.type==='yaowu_choose'){
    const chooser = g.players[g.pending.seat];
    const target = g.players[g.pending.target];
    setBanner('【耀武】 等待 '+escapeHtml(chooser?chooser.name:'伤害来源')+' 选择…（由 '+escapeHtml(target?target.name:'华雄')+' 受到红色【杀】伤害触发）');
    return;
  }
  // 李典【忘隙】:伤害后可选发动,双方各摸牌
  if(g.phase==='wangxiAsk' && g.pending && g.pending.type==='wangxiAsk' && g.pending.seat===mySeat){
    const b1=document.createElement('button'); b1.className='primary';
    b1.textContent='发动【忘隙】'; b1.onclick=()=>respondWangxi(true);
    c.appendChild(b1);
    const b2=document.createElement('button');
    b2.textContent='不发动'; b2.onclick=()=>respondWangxi(false);
    c.appendChild(b2);
    const otherP = g.players[g.pending.otherSeat];
    const amount = g.pending.amount || 1;
    if(g.pending.death){
      setBanner('你造成了致命伤害,是否发动【忘隙】?你将摸'+amount+'张牌。');
    } else {
      const desc = otherP ? '你与 '+escapeHtml(otherP.name) : '你与伤害来源';
      setBanner(desc+' 各摸'+amount+'张牌,是否发动【忘隙】?');
    }
    return;
  }
  if(g.phase==='wangxiAsk' && g.pending && g.pending.type==='wangxiAsk'){
    const p=g.players[g.pending.seat];
    waitAskBanner(p?p.name:'李典', '忘隙');
    return;
  }
  if(g.phase==='luoyiAsk' && g.pending && g.pending.type==='luoyiAsk' && g.pending.seat===mySeat){
    const b1=document.createElement('button'); b1.className='primary';
    b1.textContent='发动【裸衣】'; b1.onclick=()=>respondLuoyi(true);
    c.appendChild(b1);
    const b2=document.createElement('button');
    b2.textContent='不发动'; b2.onclick=()=>respondLuoyi(false);
    c.appendChild(b2);
    setBanner('摸牌阶段,是否发动【裸衣】少摸1张牌? 若如此做,本回合你使用【杀】或【决斗】造成的伤害+1。');
    return;
  }
  if(g.phase==='luoyiAsk' && g.pending && g.pending.type==='luoyiAsk'){
    const p=g.players[g.pending.seat];
    waitAskBanner(p?p.name:'许褚', '裸衣');
    return;
  }
  // 李典【恂恂】选择阶段:选择获得的牌和置底顺序
  if(g.phase==='xunxunPick' && g.pending && g.pending.type==='xunxunPick'){
    renderXunxun(g, c);
    return;
  }
  if(g.phase==='lirangAsk' && g.pending && g.pending.type==='lirangAsk' && g.pending.from===mySeat){
    const to=g.players[g.pending.to];
    if(lirangPicks.length===2){
      const ok=document.createElement('button'); ok.className='primary';
      ok.textContent='发动【礼让】';
      const picks=lirangPicks.slice();
      ok.onclick=()=>{ confirmAndPlay('将选中的两张牌交给 '+(to?to.name:'目标')+' 发动【礼让】？', ()=>respondLiRang(true, picks)); };
      c.appendChild(ok);
    }
    const nb=document.createElement('button'); nb.className='ghost';
    nb.textContent='不发动';
    nb.onclick=()=>respondLiRang(false, []);
    c.appendChild(nb);
    setBanner('是否发动【礼让】,交给 '+escapeHtml(to?to.name:'目标')+' 两张手牌? 已选 '+lirangPicks.length+'/2。');
    return;
  }
  if(g.phase==='lirangAsk' && g.pending && g.pending.type==='lirangAsk'){
    const from=g.players[g.pending.from], to=g.players[g.pending.to];
    setBanner(escapeHtml(to?to.name:'目标')+' 的摸牌阶段开始,等待 '+escapeHtml(from?from.name:'孔融')+' 决定是否发动【礼让】…');
    return;
  }
  if(g.phase==='lirangRecover' && g.pending && g.pending.type==='lirangRecover' && g.pending.from===mySeat){
    const target=g.players[g.pending.to];
    const count=(g.pending.cards||[]).length;
    const b1=document.createElement('button'); b1.className='primary';
    b1.textContent='获得弃牌';
    b1.onclick=()=>respondLiRangRecover(true);
    c.appendChild(b1);
    const b2=document.createElement('button');
    b2.textContent='不获得';
    b2.onclick=()=>respondLiRangRecover(false);
    c.appendChild(b2);
    setBanner('是否发动【礼让】,获得 '+escapeHtml(target?target.name:'目标')+' 本弃牌阶段弃置的 '+count+' 张牌?');
    return;
  }
  if(g.phase==='lirangRecover' && g.pending && g.pending.type==='lirangRecover'){
    const from=g.players[g.pending.from];
    setBanner('等待 '+escapeHtml(from?from.name:'孔融')+' 决定是否回收【礼让】弃牌…');
    return;
  }
  if(g.phase==='zhengyi' && g.pending && g.pending.type==='zhengyi' && g.pending.asking===mySeat){
    const kong=g.players[g.pending.seat];
    const b1=document.createElement('button'); b1.className='primary';
    b1.textContent='发动【争义】';
    b1.onclick=()=>respondZhengyi(true);
    c.appendChild(b1);
    const b2=document.createElement('button');
    b2.textContent='不发动';
    b2.onclick=()=>respondZhengyi(false);
    c.appendChild(b2);
    setBanner(escapeHtml(kong?kong.name:'孔融')+' 即将受到'+g.pending.amount+'点伤害,是否发动【争义】替其承受?');
    return;
  }
  if(g.phase==='zhengyi' && g.pending && g.pending.type==='zhengyi'){
    const asking=g.players[g.pending.asking], kong=g.players[g.pending.seat];
    setBanner('等待 '+escapeHtml(asking?asking.name:'礼让对象')+' 决定是否发动【争义】替 '+escapeHtml(kong?kong.name:'孔融')+' 承伤…');
    return;
  }
  if(g.phase==='quhuRespond' && g.pending && g.pending.type==='quhuRespond' && g.pending.targetSeat===mySeat){
    (me.hand||[]).forEach((card, idx)=>{
      const b=document.createElement('button');
      b.textContent='拼点【'+card.name+'】'+card.suit+rankText(card.rank);
      b.onclick=()=>respondQuhu(idx);
      c.appendChild(b);
    });
    const xun=g.players[g.pending.seat];
    setBanner(escapeHtml(xun?xun.name:'荀彧')+' 对你发动【驱虎】,选择一张手牌拼点。');
    return;
  }
  if(g.phase==='quhuRespond' && g.pending && g.pending.type==='quhuRespond'){
    const xun=g.players[g.pending.seat], target=g.players[g.pending.targetSeat];
    setBanner(escapeHtml(xun?xun.name:'荀彧')+' 发动【驱虎】,等待 '+escapeHtml(target?target.name:'目标')+' 选择拼点牌…');
    return;
  }
  // 太史慈【天义】拼点响应
  if(g.phase==='tianyiRespond' && g.pending && g.pending.type==='tianyiRespond' && g.pending.targetSeat===mySeat){
    const source = g.players[g.pending.seat];
    (me.hand||[]).forEach((card, idx)=>{
      const b=document.createElement('button');
      b.textContent='拼点【'+card.name+'】'+card.suit+rankText(card.rank);
      b.onclick=()=>respondTianyi(idx);
      c.appendChild(b);
    });
    setBanner(escapeHtml(source?source.name:'太史慈')+' 对你发动【天义】,选择一张手牌拼点。');
    return;
  }
  if(g.phase==='tianyiRespond' && g.pending && g.pending.type==='tianyiRespond'){
    const source = g.players[g.pending.seat], target = g.players[g.pending.targetSeat];
    setBanner(escapeHtml(source?source.name:'太史慈')+' 发动【天义】,等待 '+escapeHtml(target?target.name:'目标')+' 选择拼点牌…');
    return;
  }
  // 孙策【制霸】拼点响应(镜像天义同款:目标逐张列手牌按钮)
  if(g.phase==='zhibaAsk' && g.pending && g.pending.type==='zhibaAsk' && g.pending.targetSeat===mySeat){
    const lord = g.players[g.pending.lordSeat];
    (me.hand||[]).forEach((card, idx)=>{
      const b=document.createElement('button');
      b.textContent='拼点【'+card.name+'】'+card.suit+rankText(card.rank);
      b.onclick=()=>respondZhiba(idx);
      c.appendChild(b);
    });
    setBanner(escapeHtml(lord?lord.name:'孙策')+' 对你发动【制霸】,选择一张手牌拼点。');
    return;
  }
  if(g.phase==='zhibaAsk' && g.pending && g.pending.type==='zhibaAsk'){
    const lord = g.players[g.pending.lordSeat], target = g.players[g.pending.targetSeat];
    setBanner(escapeHtml(lord?lord.name:'孙策')+' 发动【制霸】,等待 '+escapeHtml(target?target.name:'目标')+' 选择拼点牌…');
    return;
  }
  if(g.phase==='quhuDamageChoice' && g.pending && g.pending.type==='quhuDamageChoice' && g.pending.seat===mySeat){
    const source=g.players[g.pending.targetSeat];
    (g.pending.targets||[]).forEach(seat=>{
      const target=g.players[seat];
      if(!target || !target.alive) return;
      const b=document.createElement('button');
      b.textContent='令 '+source.name+' 对 '+target.name+' 造成1点伤害';
      b.onclick=()=>respondQuhuDamage(seat);
      c.appendChild(b);
    });
    setBanner('【驱虎】拼点赢,选择 '+escapeHtml(source?source.name:'目标')+' 攻击范围内一名角色受到1点伤害。');
    return;
  }
  if(g.phase==='quhuDamageChoice' && g.pending && g.pending.type==='quhuDamageChoice'){
    const xun=g.players[g.pending.seat], source=g.players[g.pending.targetSeat];
    setBanner(escapeHtml(xun?xun.name:'荀彧')+' 【驱虎】拼点赢,正在选择 '+escapeHtml(source?source.name:'目标')+' 造成伤害的对象…');
    return;
  }
  if(g.phase==='fanjianSuit' && g.pending && g.pending.type==='fanjianSuit' && g.pending.targetSeat===mySeat){
    const zhou=g.players[g.pending.seat];
    ['♠','♥','♣','♦'].forEach(suit=>{
      const b=document.createElement('button');
      b.textContent='选择 '+suit;
      b.onclick=()=>respondFanjianSuit(suit);
      c.appendChild(b);
    });
    setBanner(escapeHtml(zhou?zhou.name:'周瑜')+' 对你发动【反间】,请选择一种花色。');
    return;
  }
  if(g.phase==='fanjianSuit' && g.pending && g.pending.type==='fanjianSuit'){
    const zhou=g.players[g.pending.seat], target=g.players[g.pending.targetSeat];
    setBanner(escapeHtml(zhou?zhou.name:'周瑜')+' 发动【反间】,等待 '+escapeHtml(target?target.name:'目标')+' 选择花色…');
    return;
  }
  if(g.phase==='jiemingAsk' && g.pending && g.pending.type==='jiemingAsk' && g.pending.seat===mySeat){
    g.players.forEach((p,i)=>{
      if(!p || !p.alive) return;
      const limit=Math.min(p.maxHp,5);
      const need=Math.max(0, limit-(p.hand||[]).length);
      const b=document.createElement('button');
      b.textContent='节命: '+p.name+(need>0?' 摸'+need+'张':' 不摸牌');
      b.onclick=()=>respondJieming(i);
      c.appendChild(b);
    });
    const nb=document.createElement('button'); nb.className='ghost';
    nb.textContent='不发动'; nb.onclick=()=>respondJieming(null);
    c.appendChild(nb);
    setBanner('你受到伤害,是否发动【节命】令一名角色摸牌? 剩余 '+g.pending.remaining+' 次。');
    return;
  }
  if(g.phase==='jiemingAsk' && g.pending && g.pending.type==='jiemingAsk'){
    const p=g.players[g.pending.seat];
    waitAskBanner(p?p.name:'荀彧', '节命');
    return;
  }
  // 左慈【新生】:简单的"是否发动"二选一(参照寒冰剑respondHanbingAsk同款写法),
  // 每受到1点伤害问一次,g.pending.remaining 提示还剩几次。
  if(g.phase==='xinshengAsk' && g.pending && g.pending.type==='xinshengAsk' && g.pending.seat===mySeat){
    const b1=document.createElement('button'); b1.className='primary';
    b1.textContent='发动【新生】'; b1.onclick=()=>respondXinshengAsk(true);
    c.appendChild(b1);
    const b2=document.createElement('button');
    b2.textContent='不发动'; b2.onclick=()=>respondXinshengAsk(false);
    c.appendChild(b2);
    setBanner('你受到伤害,是否发动【新生】获得一个新的武将? 剩余 '+g.pending.remaining+' 次。');
    return;
  }
  if(g.phase==='xinshengAsk' && g.pending && g.pending.type==='xinshengAsk'){
    const p=g.players[g.pending.seat];
    waitAskBanner(p?p.name:'左慈', '新生');
    return;
  }
  if(g.phase==='liuli' && g.pending && g.pending.type==='liuli' && g.pending.to===mySeat){
    const opts=liuliDiscardOptions(me);
    const targets=g.pending.targets||[];
    opts.forEach(opt=>{
      targets.forEach(t=>{
        const target=g.players[t];
        if(!target || !target.alive) return;
        const b=document.createElement('button');
        b.textContent='弃'+opt.label+' → '+target.name;
        b.onclick=()=>respondLiuli(opt, t);
        c.appendChild(b);
      });
    });
    const nb=document.createElement('button'); nb.className='ghost';
    nb.textContent='不发动'; nb.onclick=()=>respondLiuli(null, null);
    c.appendChild(nb);
    const from=g.players[g.pending.from];
    setBanner(escapeHtml(from?from.name:'对方')+' 对你使用【杀】,是否发动【流离】弃一张牌转移目标?');
    return;
  }
  if(g.phase==='liuli' && g.pending && g.pending.type==='liuli'){
    const p=g.players[g.pending.to];
    waitAskBanner(p?p.name:'大乔', '流离');
    return;
  }
  if(g.phase==='tianxiang' && g.pending && g.pending.type==='tianxiang' && g.pending.seat===mySeat){
    const opts=tianxiangHeartOptions(me);
    const targets=g.pending.targets||[];
    opts.forEach(opt=>{
      targets.forEach(t=>{
        const target=g.players[t];
        if(!target || !target.alive) return;
        const b=document.createElement('button');
        b.className='ghost';
        b.textContent='弃【'+opt.card.name+'】 → '+target.name;
        b.onclick=()=>respondTianxiang({idx:opt.idx}, t);
        c.appendChild(b);
      });
    });
    const nb=document.createElement('button'); nb.className='ghost';
    nb.textContent='不发动'; nb.onclick=()=>respondTianxiang(null, null);
    c.appendChild(nb);
    setBanner('你即将受到'+g.pending.amount+'点伤害,是否发动【天香】转移给其他角色?');
    return;
  }
  if(g.phase==='tianxiang' && g.pending && g.pending.type==='tianxiang'){
    const p=g.players[g.pending.seat];
    waitAskBanner(p?p.name:'小乔', '天香');
    return;
  }
  // ===== 左慈【化身】:回合开始/结束更改(huashenChange*)——huashenPick(开局初次声明)
  // 已经挪到上面 pickingGeneral 旁边,这里不再重复 =====
  if(g.phase==='huashenChangeAskStart' && g.pending && g.pending.type==='huashenChangeAskStart' && g.pending.seat===mySeat){
    renderHuashenChangeAsk(g, c, respondHuashenChangeAskStart);
    return;
  }
  if(g.phase==='huashenChangeAskStart' && g.pending && g.pending.type==='huashenChangeAskStart'){
    const p=g.players[g.pending.seat];
    waitAskBanner(p?p.name:'左慈', '化身');
    return;
  }
  if(g.phase==='huashenChangePickStart' && g.pending && g.pending.type==='huashenChangePickStart' && g.pending.seat===mySeat){
    const me=g.players[mySeat];
    renderHuashenTwoStepPick(g, c, me.huashenPool, respondHuashenChangePickStart, '化身');
    return;
  }
  if(g.phase==='huashenChangePickStart' && g.pending && g.pending.type==='huashenChangePickStart'){
    const p=g.players[g.pending.seat];
    waitAskBanner(p?p.name:'左慈', '化身');
    return;
  }
  if(g.phase==='huashenChangeAskEnd' && g.pending && g.pending.type==='huashenChangeAskEnd' && g.pending.seat===mySeat){
    renderHuashenChangeAsk(g, c, respondHuashenChangeAskEnd);
    return;
  }
  if(g.phase==='huashenChangeAskEnd' && g.pending && g.pending.type==='huashenChangeAskEnd'){
    const p=g.players[g.pending.seat];
    waitAskBanner(p?p.name:'左慈', '化身');
    return;
  }
  if(g.phase==='huashenChangePickEnd' && g.pending && g.pending.type==='huashenChangePickEnd' && g.pending.seat===mySeat){
    const me=g.players[mySeat];
    renderHuashenTwoStepPick(g, c, me.huashenPool, respondHuashenChangePickEnd, '化身');
    return;
  }
  if(g.phase==='huashenChangePickEnd' && g.pending && g.pending.type==='huashenChangePickEnd'){
    const p=g.players[g.pending.seat];
    waitAskBanner(p?p.name:'左慈', '化身');
    return;
  }
  if(g.phase==='biyue' && g.pending && g.pending.type==='biyue' && g.pending.seat===mySeat){
    const b1=document.createElement('button'); b1.className='primary';
    b1.textContent='发动【闭月】';
    b1.onclick=()=>respondBiyue(true);
    c.appendChild(b1);
    const b2=document.createElement('button');
    b2.textContent='不发动';
    b2.onclick=()=>respondBiyue(false);
    c.appendChild(b2);
    setBanner('结束阶段,是否发动【闭月】摸1张牌?');
    return;
  }
  if(g.phase==='biyue' && g.pending && g.pending.type==='biyue'){
    const p=g.players[g.pending.seat];
    waitAskBanner(p?p.name:'貂蝉', '闭月');
    return;
  }
  // 雌雄双股剑:攻击者是否发动
  if(g.phase==='cixiongAsk' && g.pending && g.pending.type==='cixiongAsk' && g.pending.from===mySeat){
    const to=g.players[g.pending.to]&&g.players[g.pending.to].name;
    const b1=document.createElement('button'); b1.className='primary';
    b1.textContent='发动【雌雄双股剑】'; b1.onclick=()=>respondCixiongAsk(true);
    c.appendChild(b1);
    const b2=document.createElement('button');
    b2.textContent='不发动'; b2.onclick=()=>respondCixiongAsk(false);
    c.appendChild(b2);
    setBanner('对 '+escapeHtml(to||'目标')+' 使用【杀】,是否发动【雌雄双股剑】?');
    return;
  }
  if(g.phase==='cixiongAsk' && g.pending && g.pending.type==='cixiongAsk'){
    const from=g.players[g.pending.from]&&g.players[g.pending.from].name;
    const to=g.players[g.pending.to]&&g.players[g.pending.to].name;
    setBanner(escapeHtml(from||'')+' 对 '+escapeHtml(to||'')+' 使用【杀】,是否发动【雌雄双股剑】…');
    return;
  }
  // 雌雄双股剑:目标二选一
  if(g.phase==='cixiongChoice' && g.pending && g.pending.type==='cixiongChoice' && g.pending.to===mySeat){
    const fromName=g.players[g.pending.from]&&g.players[g.pending.from].name;
    if(cixiongDiscardMode){
      setBanner('【雌雄双股剑】请选择一张手牌弃置(点牌即弃)。');
      const cb=document.createElement('button'); cb.className='ghost';
      cb.textContent='取消选牌'; cb.onclick=()=>{ resetCixiongDiscard(); render(g); }; c.appendChild(cb);
    } else {
      const b1=document.createElement('button'); b1.className='primary';
      b1.textContent='弃一张手牌'; b1.onclick=()=>{ cixiongDiscardMode=true; render(g); };
      c.appendChild(b1);
      const b2=document.createElement('button');
      b2.textContent='令对方摸一张牌'; b2.onclick=()=>{ resetCixiongDiscard(); respondCixiongChoice('draw'); };
      c.appendChild(b2);
      setBanner(escapeHtml(fromName||'')+' 发动【雌雄双股剑】:弃一张手牌,或令其摸一张牌。');
    }
    return;
  }
  if(g.phase==='cixiongChoice' && g.pending && g.pending.type==='cixiongChoice'){
    const from=g.players[g.pending.from]&&g.players[g.pending.from].name;
    const to=g.players[g.pending.to]&&g.players[g.pending.to].name;
    setBanner(escapeHtml(from||'')+' 发动了【雌雄双股剑】,等待 '+escapeHtml(to||'')+' 选择…');
    return;
  }
  // 寒冰剑:杀命中前,装备者(攻击者)是否发动"防止伤害、改为弃置目标两张牌"。
  if(g.phase==='hanbingAsk' && g.pending && g.pending.type==='hanbingAsk' && g.pending.from===mySeat){
    const to=g.players[g.pending.to].name;
    const b1=document.createElement('button'); b1.className='primary';
    b1.textContent='发动【寒冰剑】'; b1.onclick=()=>respondHanbingAsk(true);
    c.appendChild(b1);
    const b2=document.createElement('button');
    b2.textContent='不发动'; b2.onclick=()=>respondHanbingAsk(false);
    c.appendChild(b2);
    setBanner('你的【杀】命中 '+escapeHtml(to)+',是否发动【寒冰剑】?防止伤害,改为弃置对方两张牌。');
    return;
  }
  if(g.phase==='hanbingAsk' && g.pending && g.pending.type==='hanbingAsk'){
    const from=g.players[g.pending.from].name, to=g.players[g.pending.to].name;
    setBanner(escapeHtml(from)+' 的【杀】命中 '+escapeHtml(to)+','+escapeHtml(from)+' 是否发动【寒冰剑】…');
    return;
  }
  // 寒冰剑弃牌子阶段:和 pick 阶段同一套"随机手牌+具名装备"选项列表,只是这次响应函数是
  // hanbingPick,弃完一张可能还会自动/再问下一轮(由 startHanbingRound 决定,不在这里判断)。
  if(g.phase==='hanbing' && g.pending && g.pending.from===mySeat){
    const tgt=g.players[g.pending.to];
    if(tgt && (tgt.hand||[]).length>0){
      const b=document.createElement('button'); b.className='primary';
      b.textContent='弃随机一张手牌'; b.onclick=()=>hanbingPick('hand'); c.appendChild(b);
    }
    if(tgt) EQUIP_SLOTS.forEach(s=>{ if(tgt.equips[s]){
      const b=document.createElement('button');
      b.textContent='弃装备【'+tgt.equips[s].name+'】'; b.onclick=()=>hanbingPick(s); c.appendChild(b);
    }});
    setBanner('【寒冰剑】选择弃置 '+escapeHtml(tgt?tgt.name:'目标')+' 的第'+((g.pending.round||0)+1)+'张牌（手牌随机、装备可指定）。');
    return;
  }
  if(g.phase==='hanbing' && g.pending){
    const from=g.players[g.pending.from].name, to=g.players[g.pending.to].name;
    setBanner(escapeHtml(from)+' 发动了【寒冰剑】,正在选择弃置 '+escapeHtml(to)+' 的第'+((g.pending.round||0)+1)+'张牌…');
    return;
  }
  if(g.phase==='xiaoguo' && g.pending && g.pending.type==='xiaoguo' && g.pending.asking===mySeat){
    const endingName=g.players[g.pending.endingSeat].name;
    if(xiaoguoMode){
      setBanner(escapeHtml(endingName)+' 结束阶段,发动【骁果】:选择一张基本牌(杀/闪/桃)弃置(或点已选中的牌取消)。');
      const cb=document.createElement('button'); cb.className='ghost';
      cb.textContent='取消'; cb.onclick=()=>{ resetXiaoguo(); render(g); }; c.appendChild(cb);
    } else {
      const b1=document.createElement('button'); b1.className='primary';
      b1.textContent='发动【骁果】'; b1.onclick=()=>{ xiaoguoMode=true; render(g); };
      c.appendChild(b1);
      const b2=document.createElement('button');
      b2.textContent='不发动'; b2.onclick=()=>respondXiaoguo(false);
      c.appendChild(b2);
      setBanner(escapeHtml(endingName)+' 结束阶段,是否弃一张基本牌发动【骁果】?');
    }
    return;
  }
  if(g.phase==='xiaoguo' && g.pending && g.pending.type==='xiaoguo'){
    const ending=g.players[g.pending.endingSeat].name, asker=g.players[g.pending.asking].name;
    setBanner(escapeHtml(ending)+' 结束阶段,正在询问 '+escapeHtml(asker)+' 是否发动【骁果】…');
    return;
  }
  if(g.phase==='xiaoguoChoice' && g.pending && g.pending.type==='xiaoguoChoice' && g.pending.to===mySeat){
    const target=g.players[mySeat], askerName=g.players[g.pending.from].name;
    const slotLabel={ weapon:'武器', armor:'防具', plus1:'防御马', minus1:'进攻马' };
    EQUIP_SLOTS.forEach(s=>{ if(target.equips[s]){
      const b=document.createElement('button');
      b.textContent='弃置'+slotLabel[s]+'【'+target.equips[s].name+'】'; b.onclick=()=>respondXiaoguoChoice(s); c.appendChild(b);
    }});
    const db=document.createElement('button'); db.className='primary';
    db.textContent='受到1点伤害'; db.onclick=()=>respondXiaoguoChoice('damage'); c.appendChild(db);
    setBanner(escapeHtml(askerName)+' 发动【骁果】,请选择:弃置一件装备(对方摸一张牌),或受到1点伤害。');
    return;
  }
  if(g.phase==='xiaoguoChoice' && g.pending && g.pending.type==='xiaoguoChoice'){
    const from=g.players[g.pending.from].name, ending=g.players[g.pending.endingSeat].name;
    setBanner(escapeHtml(from)+' 发动【骁果】,'+escapeHtml(ending)+' 选择弃装备或受到1点伤害…');
    return;
  }
  if(g.phase==='jiedaoChoice' && g.pending && g.pending.type==='jiedaoChoice' && g.pending.seatA===mySeat){
    const A=g.players[mySeat], B=g.players[g.pending.seatB], askerName=g.players[g.pending.from].name;
    const shaCandidates = (A.hand||[]).filter(card=>canUseAs(A, card, '杀'));
    // 曹彰【将驰】选项1 期间不能打出杀,服务端 respondJiedao 会直接拒绝 —— 这里必须一并
    // 不渲染"使用【杀】"按钮,否则真人点了毫无反应(只能自己改点"弃置武器"绕开)。
    // 曾经 jiangchiNoSlash 只影响下面的 shaNeedsPick(要不要先点一张牌),没管按钮出不出现。
    const canSha = shaCandidates.length>0 && !A.jiangchiNoSlash;
    // 候选>1时先在手牌区点选一张再出现按钮(和respondShan同一风格);候选<=1时行为不变。
    const shaNeedsPick = canSha && shaCandidates.length>1;
    if(canSha && (!shaNeedsPick || selectedResponseCardIdx!==null)){
      const chosenIdx = selectedResponseCardIdx; // 挂载onclick这一刻冻结,遵循CLAUDE.md规则14
      const b1=document.createElement('button'); b1.className='primary';
      b1.textContent='对 '+B.name+' 使用【杀】';
      // 提交后立刻清空选中状态:下标是"这一刻手牌数组的下标",牌一旦离手数组就 splice 了,
      // 留着会指向另一张牌(见 duelResponse 那处的详细说明)。chosenIdx 已在上面冻结,先清空再提交是安全的。
      b1.onclick = shaNeedsPick ? (()=>{ resetSelectedResponseCard(); respondJiedao(true, chosenIdx); }) : (()=>respondJiedao(true));
      c.appendChild(b1);
    }
    const b2=document.createElement('button');
    b2.textContent='弃置武器【'+A.equips.weapon.name+'】'; b2.onclick=()=>respondJiedao(false); c.appendChild(b2);
    const jiedaoPickHint = (shaNeedsPick && selectedResponseCardIdx===null) ? '你有多张牌可以当【杀】使用,请先在手牌区选择一张。' : '';
    setBanner(escapeHtml(askerName)+' 对你使用【借刀杀人】,目标 '+escapeHtml(B.name)+',请选择:对其使用【杀】,或弃置你的武器。'+jiedaoPickHint);
    return;
  }
  if(g.phase==='jiedaoChoice' && g.pending && g.pending.type==='jiedaoChoice'){
    const seatA=g.players[g.pending.seatA].name, seatB=g.players[g.pending.seatB].name;
    setBanner('等待 '+escapeHtml(seatA)+' 选择对 '+escapeHtml(seatB)+' 使用【杀】或弃置武器…');
    return;
  }
  // 姜维【志继】:觉醒后选择回复体力或摸牌
  if(g.phase==='zhijiChoice' && g.pending && g.pending.type==='zhijiChoice' && g.pending.seat===mySeat){
    const pName = g.players[mySeat].name;
    const b1=document.createElement('button'); b1.className='primary';
    b1.textContent='回复1点体力'; b1.onclick=()=>respondZhijiChoice(true); c.appendChild(b1);
    const b2=document.createElement('button');
    b2.textContent='摸两张牌'; b2.onclick=()=>respondZhijiChoice(false); c.appendChild(b2);
    setBanner(escapeHtml(pName)+' 【志继】觉醒,体力上限已-1,请选择:回复1点体力或摸两张牌');
    return;
  }
  if(g.phase==='zhijiChoice' && g.pending && g.pending.type==='zhijiChoice'){
    const pName = g.players[g.pending.seat].name;
    setBanner('等待 '+escapeHtml(pName)+' 选择【志继】觉醒效果…');
    return;
  }
  // 姜维【挑衅】:目标角色选择如何响应
  if(g.phase==='tiaoxinChoice' && g.pending && g.pending.type==='tiaoxinChoice' && g.pending.to===mySeat){
    const from=g.players[g.pending.from].name, to=g.players[mySeat].name;
    const shaCandidates=(me.hand||[]).filter(card=>canUseAs(me, card, '杀'));
    const canSha=shaCandidates.length>0 && canReachSha(g, mySeat, g.pending.from);
    // 候选>1时先在手牌区点选一张再出现按钮(和respondShan同一风格);候选<=1时行为不变。
    const shaNeedsPick = canSha && shaCandidates.length>1;
    if(canSha && (!shaNeedsPick || selectedResponseCardIdx!==null)){
      const chosenIdx = selectedResponseCardIdx; // 挂载onclick这一刻冻结,遵循CLAUDE.md规则14
      const b1=document.createElement('button'); b1.className='primary';
      b1.textContent='对其使用【杀】';
      // 提交后立刻清空选中状态(理由同 duelResponse 那处)
      b1.onclick = shaNeedsPick ? (()=>{ resetSelectedResponseCard(); respondTiaoxinChoice(true, chosenIdx); }) : (()=>respondTiaoxinChoice(true));
      c.appendChild(b1);
    }
    const b2=document.createElement('button');
    b2.textContent='被弃置一张牌'; b2.onclick=()=>respondTiaoxinChoice(false); c.appendChild(b2);
    const tiaoxinPickHint = (shaNeedsPick && selectedResponseCardIdx===null) ? '你有多张牌可以当【杀】使用,请先在手牌区选择一张。' : '';
    setBanner(escapeHtml(from)+' 发动【挑衅】,'+(canSha?'请选择:对其使用一张【杀】,或被弃置一张牌。'+tiaoxinPickHint:'你没有可用的【杀】,只能选择被弃置一张牌。'));
    return;
  }
  if(g.phase==='tiaoxinChoice' && g.pending && g.pending.type==='tiaoxinChoice'){
    const from=g.players[g.pending.from].name, to=g.players[g.pending.to].name;
    setBanner('等待 '+escapeHtml(to)+' 选择对 '+escapeHtml(from)+' 使用【杀】或被弃置一张牌…');
    return;
  }
  if(g.phase==='tiaoxinDiscard' && g.pending && g.pending.type==='tiaoxinDiscard' && g.pending.from===mySeat){
    const target=g.players[g.pending.to];
    const from=g.players[g.pending.from];
    const div=document.createElement('div'); div.className='centered';
    const h4=document.createElement('h4'); h4.textContent='【挑衅】弃置一张牌';
    div.appendChild(h4);
    (target.hand||[]).forEach((card, idx)=>{
      const b=document.createElement('button'); b.className='ghost';
      b.textContent='弃置手牌 '+(idx+1);
      b.onclick=()=>pickTiaoxinDiscard('hand', idx);
      div.appendChild(b);
    });
    EQUIP_SLOTS.forEach(slot=>{
      const card=target.equips && target.equips[slot];
      if(!card) return;
      const b=document.createElement('button'); b.className='ghost';
      b.textContent='弃置装备【'+card.name+'】';
      b.onclick=()=>pickTiaoxinDiscard('equip', slot);
      div.appendChild(b);
    });
    c.appendChild(div);
    setBanner(escapeHtml(from?from.name:'姜维')+' 选择弃置 '+escapeHtml(target?target.name:'目标')+' 的一张牌。');
    return;
  }
  if(g.phase==='tiaoxinDiscard' && g.pending && g.pending.type==='tiaoxinDiscard'){
    const from=g.players[g.pending.from].name, to=g.players[g.pending.to].name;
    setBanner('等待 '+escapeHtml(from)+' 选择弃置 '+escapeHtml(to)+' 的一张牌…');
    return;
  }
  if(g.phase==='wugu' && g.pending && g.pending.type==='wugu'){
    const picker=g.pending.order[g.pending.idx];
    if(picker===mySeat){
      setBanner('【五谷丰登】轮到你挑选，请直接点击中央牌池中的一张牌。');
    } else {
      setBanner('【五谷丰登】等待 '+escapeHtml(g.players[picker].name)+' 从中央牌池挑选。');
    }
    return;
  }
  // ===== 诸葛亮【观星】:准备阶段,仅本人可见牌面(和郭嘉【遗计】看牌同一隐藏信息原则),
  // 其余客户端只看到不剧透的banner。UI:每张牌两个按钮"放牌堆顶"/"放牌堆底",点击顺序即
  // 排列顺序(不用拖拽库);两堆牌数之和等于总牌数时才出现"确认"。 =====
  if(g.phase==='guanxingReview' && g.pending && g.pending.type==='guanxingReview'){
    renderGuanxing(g, c);
    return;
  }
  if(g.phase==='luoshen' && g.pending && g.pending.type==='luoshen' && g.pending.seat===mySeat){
    const b1=document.createElement('button'); b1.className='primary';
    b1.textContent='发动【洛神】判定'; b1.onclick=()=>respondLuoshen(true);
    c.appendChild(b1);
    const b2=document.createElement('button');
    b2.textContent='不再发动'; b2.onclick=()=>respondLuoshen(false);
    c.appendChild(b2);
    setBanner('是否发动【洛神】进行判定?黑色可获得判定牌并继续发动,红色则结束。');
    return;
  }
  if(g.phase==='luoshen' && g.pending && g.pending.type==='luoshen'){
    const p=g.players[g.pending.seat];
    setBanner(escapeHtml(p.name)+' 是否发动【洛神】进行判定…');
    return;
  }
  // ===== 张郃【巧变】完整版:回合开始"是否发动"→"选牌+选阶段"→(仅出牌阶段)"是否移动一张牌" =====
  if(g.phase==='qiaobianTurnStart' && g.pending && g.pending.type==='qiaobianTurnStart' && g.pending.seat===mySeat){
    if(qiaobianMode!=='choosePhase'){
      const b1=document.createElement('button'); b1.className='primary';
      b1.textContent='发动【巧变】'; b1.onclick=()=>{ qiaobianMode='choosePhase'; qiaobianCardIdx=null; qiaobianPhaseChoice=null; render(g); };
      c.appendChild(b1);
      const b2=document.createElement('button');
      b2.textContent='不发动'; b2.onclick=()=>qiaobianDecline();
      c.appendChild(b2);
      setBanner('是否发动【巧变】,弃一张手牌并跳过判定/摸牌/出牌/弃牌阶段之一?');
      return;
    }
    // choosePhase 模式:手牌区选一张牌(见 renderHand 里的 qiaobianMode==='choosePhase' 分支)+
    // 这里选一个要跳过的阶段,两者都选好才出现"确认"。
    const phases=[['judge','判定阶段'],['draw','摸牌阶段'],['play','出牌阶段'],['discard','弃牌阶段']];
    phases.forEach(([key,label])=>{
      const b=document.createElement('button');
      if(qiaobianPhaseChoice===key) b.className='primary';
      b.textContent=label; b.onclick=()=>{ qiaobianPhaseChoice=key; render(g); };
      c.appendChild(b);
    });
    if(qiaobianCardIdx!==null && qiaobianPhaseChoice){
      const ok=document.createElement('button'); ok.className='primary';
      ok.textContent='确认'; ok.onclick=()=>{ const idx=qiaobianCardIdx, ph=qiaobianPhaseChoice; resetQiaobian(); qiaobianDeclare(idx, ph); };
      c.appendChild(ok);
    }
    const cb=document.createElement('button'); cb.className='ghost';
    cb.textContent='取消'; cb.onclick=()=>{ resetQiaobian(); render(g); }; c.appendChild(cb);
    setBanner('【巧变】选择一张要弃置的手牌(下方手牌区点选)，再选一个要跳过的阶段'+
      (qiaobianCardIdx===null?'（还没选牌）':'')+(qiaobianPhaseChoice?'':'（还没选阶段）')+'。');
    return;
  }
  if(g.phase==='qiaobianTurnStart' && g.pending && g.pending.type==='qiaobianTurnStart'){
    setBanner(escapeHtml(g.players[g.pending.seat].name)+' 是否发动【巧变】…');
    return;
  }
  if(g.phase==='qiaobianMove' && g.pending && g.pending.type==='qiaobianMove' && g.pending.seat===mySeat){
    if(qiaobianSrc){
      const targets=qiaobianTargets(g, qiaobianSrc);
      targets.forEach(t=>{
        const b=document.createElement('button');
        b.textContent='移动到 '+t.label; b.onclick=()=>{
          const src=qiaobianSrc; resetQiaobian();
          respondQiaobianMove({kind:src.kind, srcSeat:src.seat, slot:src.slot, idx:src.idx, dstSeat:t.seat});
        };
        c.appendChild(b);
      });
      const back=document.createElement('button'); back.className='ghost';
      back.textContent='重新选来源'; back.onclick=()=>{ qiaobianSrc=null; render(g); }; c.appendChild(back);
      const skip=document.createElement('button'); skip.className='ghost';
      skip.textContent='不移动'; skip.onclick=()=>{ resetQiaobian(); respondQiaobianMove(null); }; c.appendChild(skip);
      setBanner('【巧变】把'+escapeHtml(qiaobianSrc.label)+'移动到哪位角色?'+(targets.length===0?'(没有合法的目的地)':''));
      return;
    }
    const sources=qiaobianSources(g);
    sources.forEach(s=>{
      const b=document.createElement('button');
      b.textContent=s.label; b.onclick=()=>{ qiaobianSrc=s; render(g); };
      c.appendChild(b);
    });
    const skip=document.createElement('button'); skip.className='primary';
    skip.textContent='不移动'; skip.onclick=()=>{ resetQiaobian(); respondQiaobianMove(null); };
    c.appendChild(skip);
    setBanner('【巧变】跳过出牌阶段成功,是否移动一张装备/判定牌?');
    return;
  }
  if(g.phase==='qiaobianMove' && g.pending && g.pending.type==='qiaobianMove'){
    setBanner(escapeHtml(g.players[g.pending.seat].name)+' 正在决定是否移动一张装备/判定牌…');
    return;
  }
  if(g.phase==='respond' && g.pending && g.pending.to===mySeat){
    // 马超【铁骑】判红:此杀不可被闪抵消,连按钮都不给("没有可用手段就不渲染"的一贯风格)
    const shanCandidates = me.hand.filter(card=>canUseAs(me,card,'闪'));
    const hasShan = !g.pending.noShan && shanCandidates.length>0;
    // 候选>1(真实闪+龙胆/倾国转化)时需要先在手牌区点选具体一张(见render-hand.js),这里只有
    // 已经选中时才渲染"出【闪】"按钮(和guanshi/tuxi等"选够条件才出现确认按钮"同一风格,不
    // 渲染禁用态按钮);候选<=1时维持原有"按钮直接生效"行为,不强迫多点一步。
    const shanNeedsPick = hasShan && shanCandidates.length>1;
    if(hasShan && (!shanNeedsPick || selectedResponseCardIdx!==null)){
      const chosenIdx = selectedResponseCardIdx; // 挂载onclick这一刻冻结,遵循CLAUDE.md规则14
      const b1=document.createElement('button'); b1.className='primary';
      b1.textContent='出【闪】';
      // 提交后立刻清空选中状态(理由同 duelResponse 那处:吕布【无双】要连续两张闪,打出第一张后
      // pending 仍停在同一个人身上,兜底清理不会触发,残留的旧下标会指向另一张牌)
      b1.onclick = shanNeedsPick ? (()=>{ resetSelectedResponseCard(); respondShan(true, chosenIdx); }) : (()=>respondShan(true));
      c.appendChild(b1);
    }
    const guhuoShanCount = !g.pending.noShan ? addGuhuoResponseButtons(c, g, me, '闪') : 0;
    const b2=document.createElement('button');
    b2.textContent='不闪（受伤）'; b2.onclick=()=>respondShan(false);
    c.appendChild(b2);
    // 吕布【无双】:攻击者是吕布时需要连续两张闪,shanCount 记已打出几张
    const shanNeeded = hasCap(g.players[g.pending.from],'wushuang') ? 2 : 1;
    const from=g.players[g.pending.from].name;
    const lead = escapeHtml(from)+' 对你出【杀】,';
    let tail;
    if(g.pending.noShan) tail='对方发动了【铁骑】且判定为红,此杀不可被闪抵消,只能受到伤害。';
    else if(!hasShan && guhuoShanCount===0) tail='你没有【闪】,只能受到伤害。';
    else if(!hasShan) tail='你没有【闪】,可以发动【蛊惑】声明【闪】,或选择受到伤害。';
    else if(shanNeedsPick && selectedResponseCardIdx===null) tail='你有多张牌可以当【闪】使用,请先在手牌区选择一张。';
    else if(shanNeeded>1 && g.pending.shanCount>0) tail='对方是吕布【无双】,已打出'+g.pending.shanCount+'/'+shanNeeded+'张【闪】,还需再打出一张才能抵消!';
    else if(shanNeeded>1) tail='对方是吕布【无双】,需要连续打出2张【闪】才能抵消。';
    else tail='是否打出【闪】?';
    setBanner(lead+tail+fangtianSuffix(g));
    return;
  }
  if(g.phase==='respond' && g.pending){
    const to=g.players[g.pending.to].name, from=g.players[g.pending.from].name;
    // 攻击者/目标名字各自染身份色(按座位号,不按名字,避免撞色),一眼看出"谁在打谁"
    // (仅此 banner;日志是纯文本存储,escapeHtml 后无法带色,不做)
    const fromSpan='<span style="color:'+seatColor(g.pending.from)+'">'+escapeHtml(from)+'</span>';
    const toSpan='<span style="color:'+seatColor(g.pending.to)+'">'+escapeHtml(to)+'</span>';
    const noShanTag = g.pending.noShan ? '(【铁骑】判红,不可被闪抵消)' : '';
    setBanner(fromSpan+' 对 '+toSpan+' 出【杀】'+noShanTag+',等待'+toSpan+'响应…'+fangtianSuffix(g));
    return;
  }
  if(g.phase==='duel' && g.pending && g.pending.active===mySeat){
    const shaCandidates=me.hand.filter(card=>canUseAs(me,card,'杀'));
    const hasSha=shaCandidates.length>0;
    // 候选>1(真实杀+龙胆/武圣转化)时需要先在手牌区点选具体一张(见render-hand.js),这里只有
    // 已经选中时才渲染"打出【杀】"按钮(和respondShan同一风格,不渲染禁用态按钮);候选<=1时
    // 维持原有"按钮直接生效"行为,不强迫多点一步。曹彰【将驰】禁杀时手牌区不给点选,
    // shaNeedsPick 也不成立,按钮维持原有行为(服务端仍会拒绝)。
    const shaNeedsPick = hasSha && shaCandidates.length>1 && !me.jiangchiNoSlash;
    if(hasSha && (!shaNeedsPick || selectedResponseCardIdx!==null)){
      const chosenIdx = selectedResponseCardIdx; // 挂载onclick这一刻冻结,遵循CLAUDE.md规则14
      const b1=document.createElement('button'); b1.className='primary';
      b1.textContent='打出【杀】';
      // 提交后立刻清空选中状态。selectedResponseCardIdx 是"这一刻手牌数组的下标",牌一旦
      // 离手,数组就 splice 了、后面的牌下标全部前移,同一个数字指向的已经是另一张牌。
      // 平时靠 render() 的兜底清理(离开这个 phase 就清空)覆盖,但吕布【无双】要连续两张杀:
      // 打出第一张后 pending 仍停在同一个人身上(phase/active 都不变),兜底条件不成立、不会
      // 清空,残留的旧下标如果恰好还指向另一张能当杀的牌,第二次点按钮就会静默打出玩家这一轮
      // 并没有选过的那张牌。所以必须在提交这一刻自己清掉,让每一轮都重新选(遵循CLAUDE.md规则14
      // "确认类操作点确定后也应立即清理,别让旧状态留到下一次交互")。chosenIdx 已冻结,先清空再提交是安全的。
      b1.onclick = shaNeedsPick ? (()=>{ resetSelectedResponseCard(); duelResponse(true, chosenIdx); }) : (()=>duelResponse(true));
      c.appendChild(b1);
    }
    addGuhuoResponseButtons(c, g, me, '杀');
    const b2=document.createElement('button');
    b2.textContent='认输（受伤）'; b2.onclick=()=>duelResponse(false);
    c.appendChild(b2);
    // 吕布【无双】:跟吕布决斗的对方每轮需连续两张杀,吕布自己始终只需一张——不是"涉及吕布就双方都2张"。
    // 这里渲染的是"该 mySeat 出杀"的按钮/提示,所以判定要看 mySeat 自己是不是吕布,不是看决斗双方。
    const oppSeat = (mySeat===g.pending.from)?g.pending.to:g.pending.from;
    const shaNeeded = (!hasCap(me,'wushuang') && hasCap(g.players[oppSeat],'wushuang')) ? 2 : 1;
    let tail;
    if(!hasSha) tail='你没有【杀】,只能受到伤害。';
    else if(shaNeedsPick && selectedResponseCardIdx===null) tail='你有多张牌可以当【杀】使用,请先在手牌区选择一张。';
    else if(shaNeeded>1 && g.pending.shaCount>0) tail='决斗涉及吕布【无双】,这一轮已打出'+g.pending.shaCount+'/'+shaNeeded+'张【杀】,还需再打出一张!';
    else if(shaNeeded>1) tail='决斗涉及吕布【无双】,这一轮需要连续打出2张【杀】。';
    else tail='是否打出【杀】?';
    setBanner('【决斗】进行中,轮到你打出【杀】,'+tail);
    return;
  }
  if(g.phase==='huogongReveal' && g.pending && g.pending.type==='huogongReveal' && g.pending.to===mySeat){
    setBanner('【火攻】请选择一张手牌展示。');
    (me.hand||[]).forEach((card, idx)=>{
      const b=document.createElement('button');
      b.className='primary';
      b.innerHTML='展示 '+cardFace(card)+'【'+escapeHtml(card.name)+'】';
      b.onclick=()=>respondHuogongReveal(idx);
      c.appendChild(b);
    });
    return;
  }
  if(g.phase==='huogongReveal' && g.pending && g.pending.type==='huogongReveal'){
    const p=g.players[g.pending.to];
    setBanner('等待 '+escapeHtml(p?p.name:'目标')+' 为【火攻】展示一张手牌…');
    return;
  }
  if(g.phase==='huogong' && g.pending && g.pending.type==='huogong' && g.pending.from===mySeat){
    setBanner('【火攻】请选择一张 '+g.pending.suit+' 手牌弃置,或不弃牌。');
    const choices=(me.hand||[]).map((card,idx)=>({card,idx})).filter(o=>cardSuitForPlayer(me,o.card)===g.pending.suit);
    choices.forEach(o=>{
      const b=document.createElement('button');
      b.className='primary';
      b.innerHTML='弃置 '+cardFace(o.card)+'【'+escapeHtml(o.card.name)+'】';
      b.onclick=()=>respondHuogong(true, o.idx);
      c.appendChild(b);
    });
    const pass=document.createElement('button');
    pass.className='ghost';
    pass.textContent='不弃牌';
    pass.onclick=()=>respondHuogong(false);
    c.appendChild(pass);
    return;
  }
  if(g.phase==='duel' && g.pending){
    const a=g.players[g.pending.active].name;
    setBanner('【决斗】进行中,轮到 '+escapeHtml(a)+' 打出【杀】…');
    return;
  }
  if(g.phase==='wuxie' && g.pending && g.pending.type==='wuxie' && g.pending.asking===mySeat){
    // 此分支只在"被询问者本人"的客户端渲染(旁观者走下面 asking!==mySeat 分支,只看到等待提示、
    // 完全不渲染这两个按钮),所以按钮是否 disable 只影响本人自己的界面,不会向其他人泄露谁有无懈。
    const hasWuxie = me.hand.some(card=>card.name==='无懈可击');
    const guhuoWuxieCount = addGuhuoResponseButtons(c, g, me, '无懈可击');
    const b1=document.createElement('button'); b1.className='primary';
    b1.textContent='打出【无懈可击】';
    b1.disabled = !hasWuxie;
    b1.onclick=()=>{
      if(!hasWuxie) return; // 双重保险:即便被点到也不生效,不改共享状态
      respondWuxie(true);
    };
    const b2=document.createElement('button');
    b2.textContent='不出'; b2.onclick=()=>respondWuxie(false);
    c.appendChild(b1); c.appendChild(b2);
    const tgtDesc = g.pending.from===g.pending.to ? g.players[g.pending.from].name+' 的【'+g.pending.trick+'】' : g.players[g.pending.from].name+' 对 '+g.players[g.pending.to].name+' 的【'+g.pending.trick+'】';
    const askText = g.pending.depth>0
      ? '是否用【无懈可击】反制 '+(g.players[g.pending.exclude]?g.players[g.pending.exclude].name:'?')+' 的【无懈可击】?'
      : '是否对 '+tgtDesc+' 打出【无懈可击】?';
    setBanner((hasWuxie || guhuoWuxieCount>0) ? escapeHtml(askText) : '你没有【无懈可击】,只能点「不出」。');
    return;
  }
  if(g.phase==='wuxie' && g.pending && g.pending.type==='wuxie'){
    const from=g.players[g.pending.from].name;
    // 目标是使用者自己(如无中生有)时,"对 X 使用"会念成"对自己使用",措辞改成"使用【trick】"更自然
    const useDesc = g.pending.from===g.pending.to ? from+' 使用【'+g.pending.trick+'】' : from+' 对 '+g.players[g.pending.to].name+' 使用【'+g.pending.trick+'】';
    const asking=g.players[g.pending.asking]?g.players[g.pending.asking].name:'?';
    const text = g.pending.depth>0
      ? (g.players[g.pending.exclude]?g.players[g.pending.exclude].name:'?')+' 的【无懈可击】,正在询问 '+asking+' 是否用【无懈可击】反制…'
      : useDesc+',正在询问 '+asking+' 是否使用【无懈可击】…';
    setBanner(escapeHtml(text));
    return;
  }
  if(g.phase==='guicai' && g.pending && g.pending.type==='guicai' && g.pending.asking===mySeat){
    const jc=g.pending.judgeCard;
    const isSelf = g.pending.seat===mySeat;
    const judgedName = g.players[g.pending.seat].name;
    if(guicaiMode){
      setBanner('发动【鬼才】:选择一张手牌替换'+(isSelf?'':'('+escapeHtml(judgedName)+' 的)')+'判定牌(当前判定：'+jc.suit+rankText(jc.rank)+')。');
      const cb=document.createElement('button'); cb.className='ghost';
      cb.textContent='取消'; cb.onclick=()=>{ resetGuicai(); render(g); }; c.appendChild(cb);
    } else {
      const b1=document.createElement('button'); b1.className='primary';
      b1.textContent='发动【鬼才】替换判定牌'; b1.onclick=()=>{ guicaiMode=true; render(g); };
      c.appendChild(b1);
      const b2=document.createElement('button');
      b2.textContent='不发动'; b2.onclick=()=>respondGuicai(false);
      c.appendChild(b2);
      setBanner(isSelf
        ? '你的判定得到 '+jc.suit+rankText(jc.rank)+',是否发动【鬼才】用一张手牌替换?'
        : escapeHtml(judgedName)+' 判定得到 '+jc.suit+rankText(jc.rank)+',是否打出一张手牌替换 '+escapeHtml(judgedName)+' 的判定牌?');
    }
    return;
  }
  if(g.phase==='guicai' && g.pending && g.pending.type==='guicai'){
    const p=g.players[g.pending.seat], asker=g.players[g.pending.asking], jc=g.pending.judgeCard;
    setBanner(escapeHtml(p?p.name:'?')+' 判定得到 '+escapeHtml(jc.suit+rankText(jc.rank))+',正在询问 '+escapeHtml(asker?asker.name:'?')+' 是否发动【鬼才】替换判定牌…');
    return;
  }
  if(g.phase==='dying' && g.pending && g.pending.type==='dying' && g.pending.asking===mySeat){
    const dyingP=g.players[g.pending.seat];
    const isSelf = g.pending.seat===mySeat;
    const hasTao = me.hand.some(card=>canUseAs(me,card,'桃'));
    const hasJiu = isSelf && me.hand.some(card=>canUseAs(me,card,'酒'));
    const canJiushiJiu = isSelf && hasCap(me,'jiushi') && me.faceup!==false;
    const canJijiu = hasCap(me,'jijiu') && g.turn!==mySeat;
    const jijiuOpts = canJijiu ? jijiuChoices(me) : [];
    if(hasTao){
      const b1=document.createElement('button'); b1.className='primary';
      b1.textContent = isSelf ? '打出【桃】自救' : '打出【桃】救 '+dyingP.name;
      b1.onclick=()=>respondDying(true);
      c.appendChild(b1);
    }
    if(hasJiu){
      const jb=document.createElement('button'); jb.className='primary';
      jb.textContent='使用【酒】自救';
      jb.onclick=()=>respondDying(true, {kind:'jiu'});
      c.appendChild(jb);
    }
    if(canJiushiJiu){
      const jsb=document.createElement('button'); jsb.className='ghost';
      jsb.textContent='酒诗:翻面当【酒】';
      jsb.onclick=()=>respondDying(true, {kind:'jiushiJiu'});
      c.appendChild(jsb);
    }
    jijiuOpts.forEach(opt=>{
      const b=document.createElement('button'); b.className='ghost';
      b.textContent='急救:'+opt.label+'当【桃】';
      b.onclick=()=>respondDying(true, opt);
      c.appendChild(b);
    });
    const guhuoTaoCount = addGuhuoResponseButtons(c, g, me, '桃');
    if(isSelf && hasCap(me,'niepan') && !me.nirvanaUsed){
      const nb=document.createElement('button'); nb.className='primary';
      nb.textContent='发动【涅槃】';
      nb.onclick=()=>{ confirmAndPlay('发动限定技【涅槃】:弃置所有牌,摸3张牌并回复至3点体力？', ()=>useNiepan()); };
      c.appendChild(nb);
    }
    const b2=document.createElement('button');
    b2.textContent='不救'; b2.onclick=()=>respondDying(false);
    c.appendChild(b2);
    const canSave = hasTao || hasJiu || canJiushiJiu || jijiuOpts.length>0 || guhuoTaoCount>0;
    setBanner(canSave
      ? (isSelf ? dyingP.name+' 濒死,你是否使用【桃】自救?' : dyingP.name+' 濒死,是否对其使用【桃】救援?')
      : escapeHtml(dyingP.name)+' 濒死,你没有可用的【桃】,只能选择不救。');
    return;
  }
  // 贾诩【乱武】:乱武选择阶段（当前选择的角色）
  if(g.phase==='luanwuChoose' && g.pending && g.pending.type==='luanwuChoose' && g.pending.currentSeat===mySeat) {
    const sourcePlayer = g.players[g.pending.sourceSeat];
    const map = g.pending.targetMap || {};
    const nearestSeat = map[mySeat];
    const nearestPlayer = (typeof nearestSeat === 'number' && nearestSeat !== mySeat) ? g.players[nearestSeat] : null;
    
    // 检查是否有杀
    const hasSha = hasShaCard(g, mySeat);
    // 检查距离
    const canAttack = nearestSeat !== null && canReachSha(g, mySeat, nearestSeat);
    const shaAvailable = hasSha && canAttack && nearestPlayer && nearestPlayer.alive;
    
    const div=document.createElement('div'); div.className='centered';
    const h4=document.createElement('h4'); h4.textContent=sourcePlayer.name + ' 发动【乱武】';
    div.appendChild(h4);
    const p1=document.createElement('p'); p1.textContent='请选择：';
    div.appendChild(p1);
    
    // 选项1：使用杀（如果可行）
    if (shaAvailable) {
      const b1=document.createElement('button'); b1.className='skill-btn'; b1.style.background='#e74c3c';
      b1.textContent='对 ' + nearestPlayer.name + ' 使用【杀】';
      b1.onclick=()=>chooseLuanwuOption('sha');
      div.appendChild(b1);
    }
    
    // 选项2：失去体力
    const b2=document.createElement('button'); b2.className='skill-btn'; b2.style.background='#8e44ad';
    b2.textContent='失去1点体力';
    b2.onclick=()=>chooseLuanwuOption('hp');
    div.appendChild(b2);
    
    // 如果选项1不可行，只能选择选项2
    if (!shaAvailable) {
      const p2=document.createElement('p'); p2.style.color='#7f8c8d'; p2.textContent='（无法使用杀，只能选择失去体力）';
      div.appendChild(p2);
    }
    
    c.appendChild(div);
    setBanner(sourcePlayer.name + ' 发动【乱武】,你需要选择:使用杀或失去1点体力');
    return;
  }
  if(g.phase==='luanwuChoose' && g.pending && g.pending.type==='luanwuChoose'){
    const currentPlayer = g.players[g.pending.currentSeat];
    const sourcePlayer = g.players[g.pending.sourceSeat];
    setBanner(escapeHtml(sourcePlayer?sourcePlayer.name:'?')+' 发动【乱武】,正在询问 '+escapeHtml(currentPlayer?currentPlayer.name:'?')+' 选择…');
    return;
  }
  if(g.phase==='dying' && g.pending && g.pending.type==='dying'){
    const dyingP=g.players[g.pending.seat], asking=g.players[g.pending.asking]?g.players[g.pending.asking].name:'?';
    setBanner(escapeHtml(dyingP?dyingP.name:'?')+' 濒死！正在询问 '+escapeHtml(asking)+' 是否使用【桃】…');
    return;
  }
  if(g.phase==='aoeResp' && g.pending && g.pending.to===mySeat){
    const need=g.pending.need;
    const aoeCandidates = me.hand.filter(card=>canUseAs(me,card,need));
    const hasCard = aoeCandidates.length>0;
    // 候选>1(真实牌+龙胆/武圣转化)时需要先在手牌区点选具体一张(见render-hand.js),这里只有
    // 已经选中时才渲染"打出【need】"按钮(和respondShan同一风格);候选<=1时行为不变。
    const aoeNeedsPick = hasCard && aoeCandidates.length>1;
    if(hasCard && (!aoeNeedsPick || selectedResponseCardIdx!==null)){
      const chosenIdx = selectedResponseCardIdx; // 挂载onclick这一刻冻结,遵循CLAUDE.md规则14
      const b1=document.createElement('button'); b1.className='primary';
      b1.textContent='打出【'+need+'】';
      // 提交后立刻清空选中状态(理由同 duelResponse 那处)
      b1.onclick = aoeNeedsPick ? (()=>{ resetSelectedResponseCard(); aoeRespond(true, chosenIdx); }) : (()=>aoeRespond(true));
      c.appendChild(b1);
    }
    const guhuoAoeCount = addGuhuoResponseButtons(c, g, me, need);
    const b2=document.createElement('button');
    b2.textContent='不出（受伤）'; b2.onclick=()=>aoeRespond(false);
    c.appendChild(b2);
    const trick = g.aoe ? g.aoe.trick : need;
    const pickHint = (aoeNeedsPick && selectedResponseCardIdx===null) ? '你有多张牌可以当【'+escapeHtml(need)+'】使用,请先在手牌区选择一张。' : '';
    setBanner('【'+escapeHtml(trick)+'】要求你打出【'+escapeHtml(need)+'】。'+(pickHint || ((hasCard||guhuoAoeCount>0)?'':'你没有【'+escapeHtml(need)+'】,只能受到伤害。')));
    return;
  }
  if(g.phase==='aoeResp' && g.pending){
    const to=g.players[g.pending.to]?g.players[g.pending.to].name:'?';
    setBanner('【'+escapeHtml(g.aoe?g.aoe.trick:'')+'】要求 '+escapeHtml(to)+' 打出【'+escapeHtml(g.pending.need)+'】…');
    return;
  }
  if((g.phase==='jijiangAsk'||g.phase==='hujiaAsk') && g.pending && g.pending.asking===mySeat){
    // 主公技求助:被求助者选择是否替主公打出【杀/闪】(候选>1 时先在手牌区点选,同响应阶段)
    const need=g.pending.need;
    const lordName=g.players[g.pending.lordSeat]?g.players[g.pending.lordSeat].name:'?';
    const skillName=need==='杀'?'激将':'护驾';
    const candidates=me.hand.filter(card=>canUseAs(me,card,need));
    const hasCard = !(need==='杀' && me.jiangchiNoSlash) && candidates.length>0;
    const needsPick = hasCard && candidates.length>1;
    if(hasCard && (!needsPick || selectedResponseCardIdx!==null)){
      const chosenIdx = selectedResponseCardIdx; // 挂载onclick这一刻冻结,遵循CLAUDE.md规则14
      const b1=document.createElement('button'); b1.className='primary';
      b1.textContent='替主公打出【'+need+'】';
      b1.onclick = needsPick
        ? (()=>{ resetSelectedResponseCard(); (need==='杀'?respondJijiangAsk:respondHujiaAsk)(true, chosenIdx); })
        : (()=> (need==='杀'?respondJijiangAsk:respondHujiaAsk)(true));
      c.appendChild(b1);
    }
    const b2=document.createElement('button');
    b2.textContent='不出'; b2.onclick=()=> (need==='杀'?respondJijiangAsk:respondHujiaAsk)(false);
    c.appendChild(b2);
    const pickHint=(needsPick && selectedResponseCardIdx===null)?'你有多张牌可以当【'+escapeHtml(need)+'】使用,请先在手牌区选择一张。':'';
    setBanner(escapeHtml(lordName)+' 发动【'+skillName+'】,是否替主公打出【'+escapeHtml(need)+'】?'+(pickHint||(hasCard?'':'（你没有【'+escapeHtml(need)+'】,只能不出）')));
    return;
  }
  if((g.phase==='jijiangAsk'||g.phase==='hujiaAsk') && g.pending){
    const lordName=g.players[g.pending.lordSeat]?g.players[g.pending.lordSeat].name:'?';
    const asking=g.players[g.pending.asking]?g.players[g.pending.asking].name:'?';
    setBanner(escapeHtml(lordName)+' 发动【'+(g.pending.need==='杀'?'激将':'护驾')+'】,正在询问 '+escapeHtml(asking)+' 是否替主公打出【'+escapeHtml(g.pending.need)+'】…');
    return;
  }
  if(g.phase==='pick' && g.pending && g.pending.from===mySeat){
    const tgt=g.players[g.pending.to];
    const verb = g.pending.trick==='顺手牵羊' ? '拿' : '拆';
    if(tgt && (tgt.hand||[]).length>0){
      // 手牌隐藏:只给"随机一张手牌"整体选项,不列具体牌
      const b=document.createElement('button'); b.className='primary';
      b.textContent=verb+'随机一张手牌'; b.onclick=()=>pickResolve('hand'); c.appendChild(b);
    }
    // 装备公开:逐件列出具体牌名供指定
    if(tgt) EQUIP_SLOTS.forEach(s=>{ if(tgt.equips[s]){
      const b=document.createElement('button');
      b.textContent=verb+'装备【'+tgt.equips[s].name+'】'; b.onclick=()=>pickResolve(s); c.appendChild(b);
    }});
    // 判定区(延时锦囊)公开:逐张列出具体牌名供指定,官方规则明确判定区也在可拿/可拆范围内
    if(tgt) (tgt.delays||[]).forEach((card,idx)=>{
      const b=document.createElement('button');
      b.textContent=verb+'判定区【'+card.name+'】'; b.onclick=()=>pickResolve('delay:'+idx); c.appendChild(b);
    });
    setBanner('对 '+escapeHtml(tgt?tgt.name:'目标')+' 使用【'+escapeHtml(g.pending.trick)+'】,选择'+verb+'哪张牌（手牌随机、装备/判定区可指定）。');
    return;
  }
  if(g.phase==='pick' && g.pending){
    const from=g.players[g.pending.from]?g.players[g.pending.from].name:'?', to=g.players[g.pending.to]?g.players[g.pending.to].name:'?';
    setBanner(escapeHtml(from)+' 对 '+escapeHtml(to)+' 使用【'+escapeHtml(g.pending.trick)+'】,正在选择拿/拆哪张牌…');
    return;
  }
  if(g.phase==='qilin' && g.pending && g.pending.from===mySeat){
    // 麒麟弓选马:攻击者从目标的两匹坐骑里选弃哪匹(坐骑公开,列具体牌名)
    const tgt=g.players[g.pending.to];
    const slotLabel={ plus1:'+1马', minus1:'-1马' };
    if(tgt) ['plus1','minus1'].forEach(s=>{ if(tgt.equips[s]){
      const b=document.createElement('button');
      b.textContent='弃置'+slotLabel[s]+'【'+tgt.equips[s].name+'】'; b.onclick=()=>qilinResolve(s); c.appendChild(b);
    }});
    setBanner('你的【麒麟弓】发动,选择弃置 '+escapeHtml(tgt?tgt.name:'目标')+' 的哪匹坐骑。');
    return;
  }
  if(g.phase==='qilin' && g.pending){
    const from=g.players[g.pending.from]?g.players[g.pending.from].name:'?', to=g.players[g.pending.to]?g.players[g.pending.to].name:'?';
    setBanner(escapeHtml(from)+' 的【麒麟弓】发动,正在选择弃置 '+escapeHtml(to)+' 的哪匹坐骑…');
    return;
  }
  if(g.pending && g.pending.type==='guhuoQuestion'){
    const d=g.pending;
    const source=g.players[d.sourceSeat];
    if(d.asking===mySeat && !(me && me.chanyuan)){
      setBanner((source?source.name:'于吉')+' 发动【蛊惑】声明为【'+(d.claimedCard&&d.claimedCard.name||'?')+'】,是否质疑?');
      const qb=document.createElement('button'); qb.className='primary';
      qb.textContent='质疑';
      qb.onclick=()=>respondGuhuoQuestion(true);
      c.appendChild(qb);
      const nb=document.createElement('button'); nb.className='ghost';
      nb.textContent='不质疑';
      nb.onclick=()=>respondGuhuoQuestion(false);
      c.appendChild(nb);
    } else {
      const asker=g.players[d.asking];
      setBanner((asker?asker.name:'其他玩家')+' 正在决定是否质疑【蛊惑】…');
    }
    return;
  }
  if(!myTurn){
    // 到这里说明:上面几千行 g.pending.xxx===mySeat 的判断没有一条命中过——真正没有任何
    // pending 需要我响应,是真正的空闲等待状态。只有在这个前提下才显示翻面提示;一旦真的
    // 有响应类 pending(比如对我出的杀,该不该出闪),更早的分支早就 return 掉了,根本不会
    // 走到这里,翻面提示不会盖住它们。
    const faceupHtml = renderFaceupStatus(g);
    if(faceupHtml) { c.innerHTML = faceupHtml; return; }
    setBanner('等待 '+escapeHtml(g.players[g.turn].name)+' 行动…');
    return;
  }
  // it's my turn
  if(g.phase==='draw'){
    // 张辽【突袭】:其他存活玩家里至少一人有手牌才值得开这个入口,否则跟没有技能一样不渲染。
    const others = g.players.map((p,i)=>({p,i})).filter(o=>o.i!==mySeat && o.p && o.p.alive);
    const tuxiAvailable = hasCap(me,'tuxi') && others.some(o=>(o.p.hand||[]).length>0);
    const maxPick = Math.min(2, others.length);
    if(tuxiMode){
      setBanner('【突袭】选择 1~'+maxPick+' 名角色,各摸一张手牌(已选 '+tuxiPicks.length+'/'+maxPick+')。');
      if(tuxiPicks.length>=1){
        const ok=document.createElement('button'); ok.className='primary';
        ok.textContent='确认发动'; ok.onclick=()=>{ const picks=tuxiPicks.slice(); resetTuxi(); respondTuxi(picks); };
        c.appendChild(ok);
      }
      const cb=document.createElement('button'); cb.className='ghost';
      cb.textContent='取消'; cb.onclick=()=>{ resetTuxi(); render(g); }; c.appendChild(cb);
    } else {
      const b=document.createElement('button'); b.className='primary';
      b.textContent='摸两张牌'; b.onclick=doDraw; c.appendChild(b);
      const xunxunAvailable = hasCap(me,'xunxun') && (g.deck||[]).length > 0;
      if(tuxiAvailable){
        const tb=document.createElement('button'); tb.className='ghost';
        tb.textContent='发动【突袭】'; tb.onclick=()=>{ tuxiMode=true; tuxiPicks=[]; render(g); };
        c.appendChild(tb);
      }
      if(xunxunAvailable){
        const xb=document.createElement('button'); xb.className='ghost';
        xb.textContent='发动【恂恂】'; xb.onclick=()=>respondXunxunStart();
        c.appendChild(xb);
      }
      // 孟获【再起】
      const zaiqiAvailable = hasCap(me,'zaiqi') && me.hp < me.maxHp && (g.deck||[]).length > 0;
      if(zaiqiAvailable){
        const zb=document.createElement('button'); zb.className='ghost';
        zb.textContent='发动【再起】';
        // 张数口径必须和 respondZaiqi 里的 lostHp 完全一致(hp 可以为负,见 dealDamage 注释),
        // 否则 hp<0 时提示会承诺一个和实际不符的张数。
        zb.title = `亮出牌堆顶${me.maxHp - Math.max(0, me.hp)}张牌,每张红桃回复1点体力`;
        zb.onclick=()=>respondZaiqi();
        c.appendChild(zb);
      }
      setBanner('轮到你,摸牌阶段。');
    }
  // 典韦【强袭】消耗选择阶段
  if(g.phase==='qiangxiChooseCost' && g.pending && g.pending.type==='qiangxiChooseCost' && g.pending.seat===mySeat){
    const canPayHp = me && me.alive && me.hp > 1;
    const canPayWeapon = hasWeaponToDiscard(me);
    
    const div = document.createElement('div'); div.className = 'centered';
    const h4 = document.createElement('h4'); h4.textContent = '【强袭】支付方式';
    div.appendChild(h4);
    const p = document.createElement('p'); p.textContent = '请选择你要支付的消耗';
    div.appendChild(p);
    
    if(canPayHp) {
      const b1 = document.createElement('button'); b1.className = 'cost-btn';
      b1.style.background = '#e74c3c';
      b1.textContent = '失去1点体力';
      b1.onclick = () => chooseQiangxiCost('hp');
      div.appendChild(b1);
    }
    
    if(canPayWeapon) {
      const b2 = document.createElement('button'); b2.className = 'cost-btn';
      b2.style.background = '#e74c3c';
      b2.textContent = '弃置一张武器牌';
      b2.onclick = () => chooseQiangxiCost('weapon');
      div.appendChild(b2);
    }
    
    const cb = document.createElement('button'); cb.className = 'cancel-btn';
    cb.textContent = '取消'; cb.onclick = () => cancelQiangxi();
    div.appendChild(cb);
    c.appendChild(div);
    setBanner('请选择【强袭】的支付方式');
    return;
  }
  if(g.phase==='qiangxiChooseCost' && g.pending && g.pending.type==='qiangxiChooseCost'){
    const p = g.players[g.pending.seat];
    setBanner(escapeHtml(p ? p.name : '典韦') + ' 发动【强袭】,选择支付方式…');
    return;
  }
  
  // 典韦【强袭】手牌武器选择阶段
  if(g.phase==='qiangxiChooseWeaponFromHand' && g.pending && g.pending.type==='qiangxiChooseWeaponFromHand' && g.pending.seat===mySeat){
    const weaponIndices = g.pending.weaponIndices || [];
    
    const div = document.createElement('div'); div.className = 'centered';
    const h4 = document.createElement('h4'); h4.textContent = '【强袭】选择武器牌';
    div.appendChild(h4);
    const p = document.createElement('p'); p.textContent = '请选择要弃置的武器牌';
    div.appendChild(p);
    
    weaponIndices.forEach(cardIndex => {
      const card = me.hand[cardIndex];
      if (card) {
        const b = document.createElement('button'); b.className = 'target-btn';
        b.textContent = '【' + escapeHtml(card.name) + '】';
        b.onclick = () => chooseQiangxiWeaponFromHand(cardIndex);
        div.appendChild(b);
      }
    });
    
    const cb = document.createElement('button'); cb.className = 'cancel-btn';
    cb.textContent = '取消'; cb.onclick = () => cancelQiangxi();
    div.appendChild(cb);
    c.appendChild(div);
    setBanner('请选择要弃置的武器牌');
    return;
  }
  if(g.phase==='qiangxiChooseWeaponFromHand' && g.pending && g.pending.type==='qiangxiChooseWeaponFromHand'){
    const p = g.players[g.pending.seat];
    setBanner(escapeHtml(p ? p.name : '典韦') + ' 选择要弃置的武器牌…');
    return;
  }
  
  // 典韦【强袭】目标选择阶段
  if(g.phase==='qiangxiPickTarget' && g.pending && g.pending.type==='qiangxiPickTarget' && g.pending.seat===mySeat){
    const candidates = g.pending.candidates || [];
    
    const div = document.createElement('div'); div.className = 'centered';
    const h4 = document.createElement('h4'); h4.textContent = '【强袭】选择目标';
    div.appendChild(h4);
    const p = document.createElement('p'); p.textContent = '请选择攻击范围内的目标角色';
    div.appendChild(p);
    
    candidates.forEach(targetSeat => {
      const target = g.players[targetSeat];
      if (target && target.alive) {
        const b = document.createElement('button'); b.className = 'target-btn';
        b.textContent = escapeHtml(target.name);
        b.onclick = () => pickQiangxiTarget(targetSeat);
        div.appendChild(b);
      }
    });
    
    // 强袭消耗支付后不可取消，因此不提供取消按钮
    c.appendChild(div);
    setBanner('请选择攻击范围内的目标角色');
    return;
  }
  if(g.phase==='qiangxiPickTarget' && g.pending && g.pending.type==='qiangxiPickTarget'){
    const p = g.players[g.pending.seat];
    setBanner(escapeHtml(p ? p.name : '典韦') + ' 选择【强袭】的目标…');
    return;
  }
  
  } else if(g.phase==='duanbingChoose'){
    // 【短兵】在打出杀后会把 phase 切到 duanbingChoose；必须在 play 分支之外渲染，
    // 否则阶段已经改变后永远到不了原先嵌在 play 里的选择界面。
    if(g.pending && g.pending.type==='duanbingChoose' && g.pending.sourceSeat===mySeat){
      const div=document.createElement('div'); div.className='centered';
      const h4=document.createElement('h4'); h4.textContent='【短兵】选择额外目标'; div.appendChild(h4);
      const baseTarget=g.players[g.pending.baseTarget];
      const p=document.createElement('p');
      p.textContent='当前目标：'+escapeHtml((baseTarget&&baseTarget.name)||'?')+'。可以再选择一名与你距离为1的合法目标。';
      div.appendChild(p);
      const targetsDiv=document.createElement('div'); targetsDiv.className='target-options';
      (g.pending.availableTargets||[]).forEach(seat=>{
        const target=g.players[seat];
        if(!target || !target.alive || !isSeatClickable(seat)) return;
        const b=document.createElement('button'); b.className='target-btn';
        b.textContent='追加 '+escapeHtml(target.name);
        b.onclick=()=>triggerDuanbing(seat);
        targetsDiv.appendChild(b);
      });
      div.appendChild(targetsDiv);
      const cancelBtn=document.createElement('button'); cancelBtn.className='cancel-btn';
      cancelBtn.textContent='不发动（仅对原目标使用杀）';
      cancelBtn.onclick=cancelDuanbing;
      div.appendChild(cancelBtn);
      c.appendChild(div);
      setBanner('【短兵】选择一名距离为1的额外目标');
      return;
    }
    const source=g.pending && g.players[g.pending.sourceSeat];
    setBanner(escapeHtml(source?source.name:'?')+' 正在选择【短兵】的额外目标…');
    return;
  } else if(g.phase==='play'){
    // 本回合是否还能出杀(与单张杀 canPlay 同口径:未出过 或 有无限杀)
    const canSha = !g.shaUsed || hasCap(me,'unlimitedSha');
    if(zhangbaMode && !canSha) resetZhangba(); // 选牌途中次数变得不可用 → 安全退出,不卡在选牌模式
    if(duanliangMode && g.duanliangUsed) resetDuanliang(); // 选牌途中变得不可用(理论上不会,双重保险)
    // 方天画戟触发条件(手牌恰好剩1张+能当杀+还能出杀)在选目标途中变得不满足 → 安全退出,不卡在选牌模式
    if(fangtianMode && (!canSha || me.hand.length!==1 || !hasCap(me,'fangtian') || !canUseAs(me,(me.hand||[])[0],'杀'))) resetFangtian();
    
    if(g.pending && g.pending.type==='guhuoTarget'){
      const d=g.pending;
      const source=g.players[d.sourceSeat];
      if(d.sourceSeat===mySeat){
        setBanner('【蛊惑】已生效,点上方一名合法角色作为【'+(d.claimedCard&&d.claimedCard.name||'?')+'】目标。');
      } else {
        setBanner((source?source.name:'于吉')+' 正在为【蛊惑】选择目标…');
      }
      return;
    }
    
    // 鲁肃【缔盟】:选择两名其他角色
    if(dimengMode && g.dimengUsed) resetDimeng();
    if(dimengMode){
      const availableTargets = g.players.filter((p,i)=>p && p.alive && i!==mySeat);
      if(dimengSeatA === null){
        setBanner('【缔盟】选择第一名角色(已选 0/2)。');
      } else if(dimengSeatB === null){
        setBanner('【缔盟】选择第二名角色(已选 1/2)。');
      }
      // 渲染可选角色按钮
      g.players.forEach((p,i)=>{ 
        if(!p || !p.alive || i===mySeat) return;
        if(dimengSeatA === null || (dimengSeatB === null && i !== dimengSeatA)){
          const b=document.createElement('button');
          b.textContent='选择 '+p.name;
          b.onclick=()=>{ 
            if(dimengSeatA === null) dimengSeatA = i; 
            else if(dimengSeatB === null && i !== dimengSeatA) dimengSeatB = i;
            render(g); 
          };
          c.appendChild(b);
        }
      });
      // 确认按钮(选满2人后才能确认)
      if(dimengSeatA !== null && dimengSeatB !== null){
        const ok=document.createElement('button'); ok.className='primary';
        ok.textContent='确认发动'; 
        ok.onclick=()=>{ 
          const a = dimengSeatA, b = dimengSeatB;
          resetDimeng(); 
          respondDimeng(a, b); 
        };
        c.appendChild(ok);
      }
      const cb=document.createElement('button'); cb.className='ghost';
      cb.textContent='取消'; cb.onclick=()=>{ resetDimeng(); render(g); }; c.appendChild(cb);
    } else if(quhuMode){
      setBanner(quhuCardIdx===null
        ? '【驱虎】选择一张手牌用于拼点。'
        : '已选中拼点牌,选择一名当前体力值大于你的角色拼点。');
      (me.hand||[]).forEach((card, idx)=>{
        const picked=quhuCardIdx===idx;
        const b=document.createElement('button');
        if(picked) b.className='primary';
        b.textContent=(picked?'✓ ':'')+'拼【'+card.name+'】'+card.suit+rankText(card.rank);
        b.onclick=()=>{ quhuCardIdx = picked ? null : idx; render(g); };
        c.appendChild(b);
      });
      if(quhuCardIdx!==null){
        g.players.forEach((p,i)=>{
          if(!p || !p.alive || i===mySeat || p.hp<=me.hp || (p.hand||[]).length===0) return;
          const b=document.createElement('button');
          b.textContent='与 '+p.name+' 拼点';
          b.onclick=()=>{ const idx=quhuCardIdx; resetQuhu(); quHu(idx, i); };
          c.appendChild(b);
        });
      }
      const cb=document.createElement('button'); cb.className='ghost';
      cb.textContent='取消'; cb.onclick=()=>{ resetQuhu(); render(g); }; c.appendChild(cb);
    } else if(tianyiMode){
      // 太史慈【天义】:先选一张手牌拼点,再选目标
      setBanner(tianyiCardIdx===null
        ? '【天义】选择一张手牌用于拼点。'
        : '已选中拼点牌,选择一名其他角色拼点。');
      (me.hand||[]).forEach((card, idx)=>{
        const picked=tianyiCardIdx===idx;
        const b=document.createElement('button');
        if(picked) b.className='primary';
        b.textContent=(picked?'✓ ':'')+'拼【'+card.name+'】'+card.suit+rankText(card.rank);
        b.onclick=()=>{ tianyiCardIdx = picked ? null : idx; render(g); };
        c.appendChild(b);
      });
      if(tianyiCardIdx!==null){
        g.players.forEach((p,i)=>{
          if(!p || !p.alive || i===mySeat || (p.hand||[]).length===0) return;
          const b=document.createElement('button');
          b.textContent='与 '+p.name+' 拼点';
          b.onclick=()=>{ const idx=tianyiCardIdx; resetTianyi(); pickTianyiTarget(idx, i); };
          c.appendChild(b);
        });
      }
      const cb=document.createElement('button'); cb.className='ghost';
      cb.textContent='取消'; cb.onclick=()=>{ resetTianyi(); render(g); }; c.appendChild(cb);
    } else if(zhibaMode){
      // 孙策【制霸】:出牌阶段限一次,点一名有手牌的其他角色拼点(孙策自动出第一张手牌)
      setBanner('【制霸】选择一名有手牌的其他角色拼点。');
      g.players.forEach((p,i)=>{
        if(!p || !p.alive || i===mySeat || (p.hand||[]).length===0) return;
        const b=document.createElement('button');
        b.textContent='与 '+p.name+' 拼点';
        b.onclick=()=>{ resetZhiba(); startZhiba(i); };
        c.appendChild(b);
      });
      const cb=document.createElement('button'); cb.className='ghost';
      cb.textContent='取消'; cb.onclick=()=>{ resetZhiba(); render(g); }; c.appendChild(cb);
    } else if(fangtianMode){
      // 方天画戟选目标模式:点上方存活+范围内的其他玩家(见 seat 循环里的分支),不强制选满,选够1个即可确认。
      setBanner('【方天画戟】选择至多3个目标(已选 '+fangtianPicks.length+'/3，攻击距离 '+attackRange(g,mySeat)+')。');
      if(fangtianPicks.length>=1){
        const ok=document.createElement('button'); ok.className='primary';
        ok.textContent='确认出杀'; ok.onclick=()=>{ const picks=fangtianPicks.slice(); resetFangtian(); playShaFangtian(0, picks); };
        c.appendChild(ok);
      }
      const cb=document.createElement('button'); cb.className='ghost';
      cb.textContent='取消'; cb.onclick=()=>{ resetFangtian(); render(g); }; c.appendChild(cb);
    } else if(duanliangMode){
      // 断粮选牌+选目标模式:先选一张黑色基本牌/黑色装备牌,再点距离2以内的其他玩家提交。提供取消。
      setBanner(duanliangCardIdx===null
        ? '【断粮】选择一张黑色基本牌或黑色装备牌当【兵粮寸断】使用。'
        : '已选中,点上方距离2以内的一名其他玩家,当【兵粮寸断】对其使用(或点牌取消选中)。');
      const cb=document.createElement('button'); cb.className='ghost';
      cb.textContent='取消'; cb.onclick=()=>{ resetDuanliang(); render(g); }; c.appendChild(cb);
    } else if(qixiMode){
      // 奇袭选牌+选目标模式:先选一张黑色手牌,再点有牌可拆的其他玩家提交。提供取消。
      setBanner(qixiCardIdx===null
        ? '【奇袭】选择一张黑色手牌当【过河拆桥】使用。'
        : '已选中,点上方一名有手牌、装备或判定区牌的其他玩家,当【过河拆桥】对其使用(或点牌取消选中)。');
      const cb=document.createElement('button'); cb.className='ghost';
      cb.textContent='取消'; cb.onclick=()=>{ resetQixi(); render(g); }; c.appendChild(cb);
    } else if(guoseMode){
      setBanner(guoseCardIdx===null
        ? '【国色】选择一张方块牌当【乐不思蜀】使用。'
        : '已选中,点上方一名判定区没有【乐不思蜀】的其他角色。');
      const cb=document.createElement('button'); cb.className='ghost';
      cb.textContent='取消'; cb.onclick=()=>{ resetGuose(); render(g); }; c.appendChild(cb);
    } else if(lianhuanMode){
      setBanner(lianhuanCardIdx===null
        ? '【连环】选择一张梅花手牌当【铁索连环】使用。'
        : '已选中,点上方选择一至两名角色进入或解除连环状态；也可以重铸这张牌。');
      if(lianhuanCardIdx!==null){
        const idx=lianhuanCardIdx;
        const rb=document.createElement('button'); rb.className='ghost';
        rb.textContent='重铸这张牌';
        rb.onclick=()=>{ confirmAndPlay('重铸这张梅花牌发动【连环】,弃置后摸一张牌？', ()=>recastLianHuan(idx)); };
        c.appendChild(rb);
        if(lianhuanTargets.length>=1){
          const ub=document.createElement('button'); ub.className='primary';
          ub.textContent='使用【铁索连环】';
          ub.onclick=()=>{
            const targets=lianhuanTargets.slice();
            confirmAndPlay('将这张梅花牌当【铁索连环】使用,目标 '+targets.map(seat=>g.players[seat].name).join('、')+'？', ()=>lianHuan(idx, targets));
          };
          c.appendChild(ub);
        }
      }
      const cb=document.createElement('button'); cb.className='ghost';
      cb.textContent='取消'; cb.onclick=()=>{ resetLianhuan(); render(g); }; c.appendChild(cb);
    } else if(lijianMode){
      const text = lijianCardIdx===null
        ? '【离间】选择一张要弃置的手牌。'
        : (lijianFromSeat===null ? '已选牌,点上方第一名男性角色作为【决斗】使用者。' : '已选择 '+escapeHtml(g.players[lijianFromSeat].name)+',再点另一名男性角色作为【决斗】目标。');
      setBanner(text);
      const cb=document.createElement('button'); cb.className='ghost';
      cb.textContent='取消'; cb.onclick=()=>{ resetLijian(); render(g); }; c.appendChild(cb);
    } else if(fanjianMode){
      setBanner('【反间】选择一名其他角色,令其猜一种花色并抽取你一张手牌。');
      const cb=document.createElement('button'); cb.className='ghost';
      cb.textContent='取消'; cb.onclick=()=>{ resetFanjian(); render(g); }; c.appendChild(cb);
    } else if(qingnangMode){
      setBanner(qingnangCardIdx===null
        ? '【青囊】选择一张要弃置的手牌。'
        : '已选中,点上方一名已受伤角色令其回复1点体力(或点牌取消选中)。');
      const cb=document.createElement('button'); cb.className='ghost';
      cb.textContent='取消'; cb.onclick=()=>{ resetQingnang(); render(g); }; c.appendChild(cb);
    } else if(zhihengMode){
      setBanner('【制衡】选择任意张手牌弃置,然后摸等量牌(已选 '+zhihengPicks.length+' 张)。');
      if(zhihengPicks.length>=1){
        const ok=document.createElement('button'); ok.className='primary';
        ok.textContent='确认制衡'; ok.onclick=()=>{ const picks=zhihengPicks.slice(); confirmAndPlay('发动【制衡】:弃'+picks.length+'张牌,然后摸'+picks.length+'张牌？', ()=>zhiHeng(picks)); };
        c.appendChild(ok);
      }
      const cb=document.createElement('button'); cb.className='ghost';
      cb.textContent='取消'; cb.onclick=()=>{ resetZhiheng(); render(g); }; c.appendChild(cb);
    } else if(sanyaoMode){
      // 散谣本地选择:弃牌成本(手牌+装备混合,sanyaoOptions 已在 skills.js 实现)和平局目标
      // 都是纯客户端一人决策,和贯石斧 guanshi 同款"直接列按钮 toggle 单选",不经过 renderHand
      // (装备牌不在手牌区,没法靠点手牌选中)。候选目标用当前真实的 findMaxHpSeats(g) 现算,
      // 不依赖任何服务端 pending——散谣全程 g.phase 都停在 'play',直到最后一次性提交。
      const sOpts = sanyaoOptions(me);
      const sCandidates = findMaxHpSeats(g);
      const needsTargetChoice = sCandidates.length > 1;
      if(sanyaoCostKey===null){
        setBanner('【散谣】选择一张要弃置的牌(手牌或装备)。');
      } else if(needsTargetChoice && sanyaoTarget===null){
        setBanner('已选中弃牌,请选择一名体力值最大的目标(多人并列时任选其一)。');
      } else {
        setBanner('已选好,点击"确认发动"结算。');
      }
      sOpts.forEach(o=>{
        const picked = sanyaoCostKey===o.key;
        const b=document.createElement('button');
        if(picked) b.className='primary';
        b.textContent=(picked?'✓ ':'')+o.label;
        b.onclick=()=>{ sanyaoCostKey=o.key; render(g); };
        c.appendChild(b);
      });
      if(needsTargetChoice){
        sCandidates.forEach(seat=>{
          const tp=g.players[seat];
          const picked = sanyaoTarget===seat;
          const b=document.createElement('button');
          if(picked) b.className='primary';
          b.textContent=(picked?'✓ ':'')+tp.name+'(体力:'+tp.hp+')';
          b.onclick=()=>{ sanyaoTarget=seat; render(g); };
          c.appendChild(b);
        });
      }
      const readyTarget = needsTargetChoice ? sanyaoTarget : (sCandidates.length===1 ? sCandidates[0] : null);
      if(sanyaoCostKey!==null && readyTarget!==null){
        const ok=document.createElement('button'); ok.className='primary';
        const key=sanyaoCostKey, tgt=readyTarget, tgtName=g.players[tgt].name;
        ok.textContent='确认发动【散谣】';
        ok.onclick=()=>{ confirmAndPlay('弃置这张牌,对 '+escapeHtml(tgtName)+' 造成1点伤害,发动【散谣】？', ()=>sanyao(key, tgt)); };
        c.appendChild(ok);
      }
      const cb=document.createElement('button'); cb.className='ghost';
      cb.textContent='取消'; cb.onclick=()=>{ resetSanyao(); render(g); }; c.appendChild(cb);
    } else if(zhangbaMode){
      // 丈八选牌模式:选两张手牌当杀,再点目标。提供取消。
      setBanner('丈八蛇矛:选两张手牌当作【杀】(已选 '+zhangbaPicks.length+'/2)'+(zhangbaPicks.length===2?'，攻击距离 '+attackRange(g,mySeat)+'，点上方一名对手作为目标。':'。'));
      const cb=document.createElement('button'); cb.className='ghost';
      cb.textContent='取消'; cb.onclick=()=>{ resetZhangba(); render(g); }; c.appendChild(cb);
    } else if(selectedCardIdx!==null && (me.hand||[])[selectedCardIdx] && (me.hand||[])[selectedCardIdx].name==='借刀杀人'){
      // 借刀杀人两步选择提示 + 取消
      setBanner(jiedaoSeatA===null
        ? '【借刀杀人】选择一名装备着武器的角色(A)。'
        : '已选中 '+escapeHtml(g.players[jiedaoSeatA].name)+' 为 A,点上方 A 攻击范围内的另一名角色作为 B(或点 A 重新选)。');
      const cb=document.createElement('button'); cb.className='ghost';
      cb.textContent='取消'; cb.onclick=()=>{ selectedCardIdx=null; resetJiedao(); render(g); }; c.appendChild(cb);
    } else if(selectedCardIdx!==null){
      const selCard=(me.hand||[])[selectedCardIdx]||{};
      const nm=selCard.name;
      const actionId=resolveActionId(g,me,selCard);
      const spec=CARD_PLAYS[actionId];
      // 只有真的会按"杀"结算才显示"当【杀】"/攻击距离提示(见 resolveActionId:红/黑牌若自己有
      // 独立效果,默认不会被判成杀,不该显示这段容易让人误以为要当杀打的文案)
      const label = (actionId==='杀' && !isShaName(nm)) ? '【'+nm+'】当【杀】' : '【'+nm+'】';
      if(actionId==='铁索连环'){
        setBanner('已选中【铁索连环】,点上方选择一至两名角色进入或解除连环状态(或点牌取消)。');
        if(tiesuoTargets.length>=1){
          const ub=document.createElement('button'); ub.className='primary';
          const idx=selectedCardIdx;
          ub.textContent='使用【铁索连环】';
          ub.onclick=()=>{
            const targets=tiesuoTargets.slice();
            confirmAndPlay('对 '+targets.map(seat=>g.players[seat].name).join('、')+' 使用【铁索连环】？', ()=>playCard(idx, actionId, targets));
          };
          c.appendChild(ub);
        }
        if(selCard.name==='铁索连环' || (hasCap(me,'lianhuan') && selCard.suit==='♣')){
          const rb=document.createElement('button'); rb.className='ghost';
          const idx=selectedCardIdx;
          rb.textContent=selCard.name==='铁索连环'?'重铸【铁索连环】':'重铸【连环】';
          const msg=selCard.name==='铁索连环'?'重铸【铁索连环】,弃置后摸一张牌？':'重铸这张梅花牌发动【连环】,弃置后摸一张牌？';
          rb.onclick=()=>{ confirmAndPlay(msg, ()=>recastLianHuan(idx)); };
          c.appendChild(rb);
        }
        const cb=document.createElement('button'); cb.className='ghost';
        cb.textContent='清空目标'; cb.onclick=()=>{ resetTiesuo(); render(g); }; c.appendChild(cb);
        return;
      }
      const rangeNote = (actionId==='杀') ? '，攻击距离 '+attackRange(g,mySeat)+'，仅范围内对手可选' : '';
      const rendeNote = hasCap(me,'rende') ? '；也可点目标座位上的“仁德”按钮交给别人' : '';
      const shuangxiongNote = canShuangxiongDuelCard(me, selCard) ? '；也可点目标座位上的“双雄:决斗”按钮' : '';
      const canRecast = selCard.name==='铁索连环' || (hasCap(me,'lianhuan') && selCard.suit==='♣');
      const recastNote = canRecast ? (selCard.name==='铁索连环' ? '；也可重铸【铁索连环】' : '；也可重铸发动【连环】') : '';
      const guhuoNote = hasCap(me,'guhuo') && !g.guhuoUsed ? '；也可发动【蛊惑】声明为其他牌' : '';
      setBanner('已选中'+label+rangeNote+',点上方一名对手作为目标'+rendeNote+shuangxiongNote+recastNote+guhuoNote+'(或点牌取消)。');
      if(spec && !spec.target && spec.canPlay(g,me,selCard)){
        const ub=document.createElement('button'); ub.className='primary';
        ub.textContent='使用'+label;
        const idx=selectedCardIdx;
        ub.onclick=()=>{ confirmAndPlay(playConfirmMsg(g, actionId, selCard), ()=>playCard(idx, actionId)); };
        c.appendChild(ub);
      }
      if(hasCap(me,'guhuo') && !g.guhuoUsed){
        const claimable=guhuoClaimableNames().filter(name=>{
          const action=guhuoActionId(name);
          const s=CARD_PLAYS[action];
          if(!s) return false;
          const claimed={ id:selCard.id, name, suit:selCard.suit, rank:selCard.rank, originalName:selCard.name };
          if(s.canPlay && !s.canPlay(g, me, claimed)) return false;
          return guhuoHasLegalTarget(g, mySeat, claimed, s);
        });
        claimable.forEach(name=>{
          const gb=document.createElement('button'); gb.className='ghost';
          const idx=selectedCardIdx;
          gb.textContent='蛊惑:【'+name+'】';
          gb.onclick=()=>{ confirmAndPlay('扣置这张手牌发动【蛊惑】,声明为【'+name+'】？', ()=>startGuhuo(idx, name)); };
          c.appendChild(gb);
        });
      }
      if(canRecast){
        const rb=document.createElement('button'); rb.className='ghost';
        const idx=selectedCardIdx;
        rb.textContent=selCard.name==='铁索连环'?'重铸【铁索连环】':'重铸【连环】';
        const msg=selCard.name==='铁索连环'?'重铸【铁索连环】,弃置后摸一张牌？':'重铸这张梅花牌发动【连环】,弃置后摸一张牌？';
        rb.onclick=()=>{ confirmAndPlay(msg, ()=>recastLianHuan(idx)); };
        c.appendChild(rb);
      }
    } else {
      const shaInfo = hasCap(me,'unlimitedSha') ? '可出任意张杀' : (g.shaUsed?'已用过杀':'可出1张杀');
      setBanner('点手牌出牌:【杀】/【决斗】/【顺手牵羊】/【过河拆桥】选目标 ·【桃】回血 ·【无中生有】摸两张 ·【南蛮入侵】/【万箭齐发】群体 · 装备牌点击直接装备。本回合'+shaInfo+'。');
    }
    // 丈八蛇矛入口:装丈八(twoAsSha)、手牌≥2、且本回合还能出杀(canSha,与单张杀同口径)时才出现——
    // 否则普通武将出过一张杀后仍白进选牌流程。张飞等无限杀者 canSha 恒真,可继续用丈八。
    const noLocalMode = !zhangbaMode && !duanliangMode && !qixiMode && !guoseMode && !lianhuanMode && !lijianMode && !fanjianMode && !qingnangMode && !zhihengMode && !fangtianMode && !quhuMode && !dimengMode && !tianyiMode && !sanyaoMode && !zhibaMode;
    if(noLocalMode && selectedCardIdx===null && hasCap(me,'kurou')){
      const kb=document.createElement('button'); kb.className='ghost';
      kb.textContent='发动【苦肉】'; kb.onclick=()=>{ confirmAndPlay('发动【苦肉】:失去1点体力,然后摸两张牌？', ()=>kuRou()); };
      c.appendChild(kb);
    }
    // 马谡【散谣】入口:出牌阶段限一次,手牌+装备里至少有一张能弃的牌才值得开这个入口
    // (和断粮"至少有一张符合条件的牌才渲染"同一原则,不能只看"有没有 sanyao 能力")。
    if(noLocalMode && selectedCardIdx===null && hasCap(me,'sanyao') && !g.sanyaoUsed && sanyaoOptions(me).length>0){
      const syb=document.createElement('button'); syb.className='ghost';
      syb.textContent='发动【散谣】';
      syb.onclick=()=>{ selectedCardIdx=null; sanyaoMode=true; sanyaoCostKey=null; sanyaoTarget=null; render(g); };
      c.appendChild(syb);
    }
    if(noLocalMode && selectedCardIdx===null && hasCap(me,'jiushi') && me.faceup!==false && !g.jiuUsed){
      const jb=document.createElement('button'); jb.className='ghost';
      jb.textContent='酒诗:当【酒】';
      jb.onclick=()=>{ confirmAndPlay('发动【酒诗】:翻面,视为使用一张【酒】？', ()=>jiushiUseJiu()); };
      c.appendChild(jb);
    }
    if(noLocalMode && selectedCardIdx===null && hasCap(me,'zhiheng') && !g.zhihengUsed && (me.hand||[]).length>=1){
      const sb=document.createElement('button'); sb.className='ghost';
      sb.textContent='发动【制衡】'; sb.onclick=()=>{ selectedCardIdx=null; zhihengMode=true; zhihengPicks=[]; render(g); }; c.appendChild(sb);
    }
    if(noLocalMode && selectedCardIdx===null && hasCap(me,'twoAsSha') && (me.hand||[]).length>=2 && canSha){
      const zb=document.createElement('button'); zb.className='ghost';
      zb.textContent='丈八蛇矛:两张牌当杀'; zb.onclick=()=>{ selectedCardIdx=null; zhangbaMode=true; zhangbaPicks=[]; render(g); }; c.appendChild(zb);
    }
    // 断粮入口:出牌阶段限一次,手牌里至少有一张黑色基本牌/黑色装备牌才值得开这个入口
    // (没有符合条件的牌就跟没有技能一样不渲染,不能只看"手牌非空"——那样会出现点进去
    // 一张能选的牌都没有的死胡同界面)。
    const hasDuanliangCard = (me.hand||[]).some(c=>(c.suit==='♠'||c.suit==='♣') && (BASIC_CARDS.includes(c.name)||!!getEquip(c.name)));
    if(noLocalMode && selectedCardIdx===null && hasCap(me,'duanliang') && !g.duanliangUsed && hasDuanliangCard){
      const db=document.createElement('button'); db.className='ghost';
      db.textContent='发动【断粮】'; db.onclick=()=>{ selectedCardIdx=null; duanliangMode=true; duanliangCardIdx=null; render(g); }; c.appendChild(db);
    }
    const hasQixiCard = (me.hand||[]).some(c=>c && (c.suit==='♠'||c.suit==='♣'));
    if(noLocalMode && selectedCardIdx===null && hasCap(me,'qixi') && hasQixiCard){
      const qb=document.createElement('button'); qb.className='ghost';
      qb.textContent='发动【奇袭】'; qb.onclick=()=>{ selectedCardIdx=null; qixiMode=true; qixiCardIdx=null; render(g); }; c.appendChild(qb);
    }
    // 姜维【挑衅】:出牌阶段限一次,选择一个其他角色
    if(noLocalMode && selectedCardIdx===null && hasCap(me,'tiaoxin') && !g.tiaoxinUsed && g.players.some((p,i)=>p&&p.alive&&i!==mySeat&&(p.hand||[]).length>0)){
      const tb=document.createElement('button'); tb.className='ghost';
      tb.textContent='发动【挑衅】'; tb.onclick=()=>{ selectedCardIdx=null; tiaoxinMode=true; render(g); }; c.appendChild(tb);
    }
    const hasGuoseCard = (me.hand||[]).some(c=>c && c.suit==='♦');
    const hasGuoseTarget = g.players.some((p,i)=>p && p.alive && i!==mySeat && !(p.delays||[]).some(c=>c && c.name==='乐不思蜀'));
    if(noLocalMode && selectedCardIdx===null && hasCap(me,'guose') && hasGuoseCard && hasGuoseTarget){
      const gb=document.createElement('button'); gb.className='ghost';
      gb.textContent='发动【国色】'; gb.onclick=()=>{ selectedCardIdx=null; guoseMode=true; guoseCardIdx=null; render(g); }; c.appendChild(gb);
    }
    const hasLianhuanCard = (me.hand||[]).some(c=>c && c.suit==='♣');
    if(noLocalMode && selectedCardIdx===null && hasCap(me,'lianhuan') && hasLianhuanCard){
      const lb=document.createElement('button'); lb.className='ghost';
      lb.textContent='发动【连环】'; lb.onclick=()=>{ selectedCardIdx=null; lianhuanMode=true; lianhuanCardIdx=null; render(g); }; c.appendChild(lb);
    }
    const maleCount = g.players.filter(p=>p && p.alive && isMale(p)).length;
    if(noLocalMode && selectedCardIdx===null && hasCap(me,'lijian') && !g.liJianUsed && (me.hand||[]).length>=1 && maleCount>=2){
      const lb=document.createElement('button'); lb.className='ghost';
      lb.textContent='发动【离间】'; lb.onclick=()=>{ selectedCardIdx=null; lijianMode=true; lijianCardIdx=null; lijianFromSeat=null; render(g); }; c.appendChild(lb);
    }
    if(noLocalMode && selectedCardIdx===null && hasCap(me,'fanjian') && !g.fanJianUsed && (me.hand||[]).length>=1 && g.players.some((p,i)=>p&&p.alive&&i!==mySeat)){
      const fb=document.createElement('button'); fb.className='ghost';
      fb.textContent='发动【反间】'; fb.onclick=()=>{ selectedCardIdx=null; fanjianMode=true; render(g); }; c.appendChild(fb);
    }
    // 贾诩【乱武】:限定技,出牌阶段,令所有其他角色依次选择
    if(noLocalMode && selectedCardIdx===null && hasCap(me,'luanwu') && !g.luanwuUsed && g.players.some((p,i)=>p&&p.alive&&i!==mySeat)){
      const lwb=document.createElement('button'); lwb.className='skill-btn'; lwb.style.background='#e74c3c';
      lwb.textContent='乱武'; lwb.onclick=()=>startLuanwu(); c.appendChild(lwb);
    }
    // 方天画戟入口:锁定技,仅当手牌恰好只剩这最后一张、且这张牌能当杀、且本回合还能出杀时才出现——
    // 不满足条件(手里还有别的牌)时和没有这把武器一样,普通单目标出杀流程完全不受影响。
    const hasQingnangTarget = g.players.some(p=>p && p.alive && p.hp<p.maxHp);
    if(noLocalMode && selectedCardIdx===null && hasCap(me,'qingnang') && !g.qingNangUsed && (me.hand||[]).length>=1 && hasQingnangTarget){
      const hb=document.createElement('button'); hb.className='ghost';
      hb.textContent='发动【青囊】'; hb.onclick=()=>{ selectedCardIdx=null; qingnangMode=true; qingnangCardIdx=null; render(g); }; c.appendChild(hb);
    }
    const hasQuhuTarget = g.players.some((p,i)=>p && p.alive && i!==mySeat && p.hp>me.hp && (p.hand||[]).length>0);
    if(noLocalMode && selectedCardIdx===null && hasCap(me,'quhu') && !g.quHuUsed && (me.hand||[]).length>=1 && hasQuhuTarget){
      const qb=document.createElement('button'); qb.className='ghost';
      qb.textContent='发动【驱虎】'; qb.onclick=()=>{ selectedCardIdx=null; quhuMode=true; quhuCardIdx=null; render(g); }; c.appendChild(qb);
    }
    // 太史慈【天义】:出牌阶段限一次,选择一名其他角色拼点
    const hasTianyiTarget = g.players.some((p,i)=>p && p.alive && i!==mySeat && (p.hand||[]).length>=1);
    if(noLocalMode && selectedCardIdx===null && hasCap(me,'tianyi') && !g.tianyiUsed && (me.hand||[]).length>=1 && hasTianyiTarget && myTurn){
      const tb=document.createElement('button'); tb.className='ghost';
      tb.textContent='发动【天义】'; tb.onclick=()=>{ selectedCardIdx=null; tianyiMode=true; tianyiCardIdx=null; tianyiTargetSeat=null; render(g); }; c.appendChild(tb);
    }
    // 孙策【制霸】:主公技,出牌阶段限一次,选择一名其他角色拼点(仅身份局主公)
    const hasZhibaTarget = g.players.some((p,i)=>p && p.alive && i!==mySeat && (p.hand||[]).length>=1);
    if(noLocalMode && selectedCardIdx===null && g.gameMode==='identity' && me.role==='zhu' && hasCap(me,'zhiba') && !g.zhibaUsed && (me.hand||[]).length>=1 && hasZhibaTarget){
      const zbb=document.createElement('button'); zbb.className='ghost';
      zbb.textContent='发动【制霸】'; zbb.onclick=()=>{ selectedCardIdx=null; zhibaMode=true; render(g); }; c.appendChild(zbb);
    }
    // 典韦【强袭】:出牌阶段限一次
    const canPayHp = me && me.alive && me.hp > 1;
    const canPayWeapon = hasWeaponToDiscard(me);
    if(noLocalMode && selectedCardIdx===null && hasCap(me,'qiangxi') && !g.qiangxiUsed && (canPayHp || canPayWeapon) && myTurn){
      const qb=document.createElement('button'); qb.className='ghost';
      qb.textContent='发动【强袭】'; qb.onclick=()=>{ startQiangxi(); }; c.appendChild(qb);
    }
    // 鲁肃【缔盟】:出牌阶段限一次,选择两名其他角色
    const hasDimengTarget = g.players.filter((p,i)=>p && p.alive && i!==mySeat).length >= 2;
    if(noLocalMode && selectedCardIdx===null && hasCap(me,'dimeng') && !g.dimengUsed && hasDimengTarget){
      const db=document.createElement('button'); db.className='ghost';
      db.textContent='发动【缔盟】'; db.onclick=()=>{ selectedCardIdx=null; dimengMode=true; dimengSeatA=null; dimengSeatB=null; render(g); }; c.appendChild(db);
    }
    // 袁绍【乱击】:出牌阶段,将两张花色相同的手牌当万箭齐发使用
    if(noLocalMode && selectedCardIdx===null && hasCap(me,'luanji') && myTurn){
      // 检查是否有至少两张花色相同的手牌
      const suitCount = {};
      const hand = me.hand || [];
      for (const card of hand) {
        const suit = card.suit;
        suitCount[suit] = (suitCount[suit] || 0) + 1;
      }
      const hasPairs = Object.values(suitCount).some(count => count >= 2);
      if(hasPairs){
        const lb=document.createElement('button'); lb.className='ghost';
        lb.textContent='发动【乱击】'; lb.onclick=()=>startLuanji(); c.appendChild(lb);
      }
    }
    if(noLocalMode && selectedCardIdx===null && hasCap(me,'fangtian') && canSha
       && (me.hand||[]).length===1 && canUseAs(me,(me.hand||[])[0],'杀')){
      const fb=document.createElement('button'); fb.className='ghost';
      fb.textContent='追加目标(方天画戟)'; fb.onclick=()=>{ selectedCardIdx=null; fangtianMode=true; fangtianPicks=[]; render(g); }; c.appendChild(fb);
    }
    // 陈宫【明策】:出牌阶段限一次
    if(noLocalMode && selectedCardIdx===null && hasCap(me,'mingce') && !g.mingceUsed && myTurn){
      // 检查是否有可交给的牌（装备牌或杀）
      const hasMingceCard = checkMingceCard(me);
      // 检查是否有其他存活角色
      const otherAliveCount = g.players.filter((p, i) => i !== mySeat && p && p.alive).length;
      
      if(hasMingceCard && otherAliveCount > 0){
        const mb=document.createElement('button'); mb.className='ghost';
        mb.textContent='发动【明策】'; mb.onclick=()=>startMingce(); c.appendChild(mb);
      }
    }
    
    // 丁奉【奋迅】:出牌阶段限一次,弃置一张牌后令与一名其他角色的距离视为1
    if(noLocalMode && selectedCardIdx===null && hasCap(me,'fenxun') && !me.fenxunUsed && myTurn && (me.hand||[]).length > 0 && g.players.filter((p, i) => i !== mySeat && p && p.alive).length > 0){
      const fb=document.createElement('button'); fb.className='ghost';
      fb.textContent='发动【奋迅】'; fb.onclick=()=>startFenxun(); c.appendChild(fb);
    }
    // 法正【眩惑】:出牌阶段限一次,交给一名其他角色一张♥手牌,然后获得其一张牌交给另一名角色
    const otherAliveCount = g.players.filter((p, i) => i !== mySeat && p && p.alive).length;
    const heartCards = (me.hand || []).filter(card => card.suit === '♥');
    if(noLocalMode && selectedCardIdx===null && hasCap(me,'huanhuo') && !g.huanhuoUsed && myTurn && heartCards.length > 0 && otherAliveCount >= 2){
      const hb=document.createElement('button'); hb.className='skill-btn'; hb.style.background='#4a90d9';
      hb.textContent='眩惑'; hb.onclick=()=>startHuanhuo(); c.appendChild(hb);
    }
    
    const b=document.createElement('button'); b.className='ghost';
    b.textContent='结束出牌'; b.onclick=()=>{selectedCardIdx=null;resetZhangba();resetDuanliang();resetQixi();resetGuose();resetLianhuan();resetTiesuo();resetLijian();resetFanjian();resetZhiheng();resetQiaobian();resetJiedao();resetFangtian();resetGanglie();resetQuhu();resetTiaoxin();resetDimeng();resetTianyi();resetZhiba();resetMingce();resetFenxun();resetSanyao();endPlay();}; c.appendChild(b);
    
    // 丁奉【奋迅】:弃牌选择阶段
    if(g.pending && g.pending.type==='fenxunDiscard' && g.pending.seat===mySeat) {
      const div = document.createElement('div'); div.className = 'centered';
      const h4 = document.createElement('h4'); h4.textContent = '【奋迅】发动';
      div.appendChild(h4);
      
      const p = document.createElement('p'); 
      p.textContent = '请选择要弃置的一张牌';
      div.appendChild(p);
      
      const handDiv = document.createElement('div'); handDiv.className = 'card-options';
      const hand = me.hand || [];
      for (let i = 0; i < hand.length; i++) {
        const card = hand[i];
        const b = document.createElement('button');
        b.className = 'card-btn';
        b.textContent = '弃置 【' + escapeHtml(card.name) + '】(' + card.suit + rankText(card.rank) + ')';
        b.onclick = () => pickFenxunDiscard(i);
        handDiv.appendChild(b);
      }
      div.appendChild(handDiv);
      
      const cancelBtn = document.createElement('button'); cancelBtn.className = 'cancel-btn';
      cancelBtn.textContent = '取消';
      cancelBtn.onclick = cancelFenxun;
      div.appendChild(cancelBtn);
      
      c.appendChild(div);
      return;
    }
    
    // 丁奉【奋迅】:等待其他人弃牌
    if(g.pending && g.pending.type==='fenxunDiscard'){
      const source = g.players[g.pending.seat];
      setBanner(escapeHtml(source?source.name:'?') + ' 发动【奋迅】,选择弃置的牌…');
      return;
    }
    
    // 丁奉【奋迅】:目标选择阶段
    if(g.pending && g.pending.type==='fenxunTarget' && g.pending.seat===mySeat) {
      const div = document.createElement('div'); div.className = 'centered';
      const h4 = document.createElement('h4'); h4.textContent = '【奋迅】选择目标';
      div.appendChild(h4);
      
      const p = document.createElement('p'); 
      p.textContent = '请选择一名其他角色，本回合内与其距离视为1';
      div.appendChild(p);
      
      const targetsDiv = document.createElement('div'); targetsDiv.className = 'target-options';
      (g.pending.availableTargets || []).forEach(seat => {
        const target = g.players[seat];
        if(target && target.alive && isSeatClickable(seat)) {
          const b = document.createElement('button');
          b.className = 'target-btn';
          b.textContent = '选择 ' + escapeHtml(target.name);
          b.onclick = () => pickFenxunTarget(seat);
          targetsDiv.appendChild(b);
        }
      });
      div.appendChild(targetsDiv);
      
      const cancelBtn = document.createElement('button'); cancelBtn.className = 'cancel-btn';
      cancelBtn.textContent = '取消';
      cancelBtn.onclick = cancelFenxun;
      div.appendChild(cancelBtn);
      
      c.appendChild(div);
      return;
    }
    
    // 丁奉【奋迅】:等待其他人选择目标
    if(g.pending && g.pending.type==='fenxunTarget'){
      const source = g.players[g.pending.seat];
      setBanner(escapeHtml(source?source.name:'?') + ' 发动【奋迅】,选择目标…');
      return;
    }
    
  } else if(g.phase==='discard'){
    const over = me.hand.length - handCapLimit(g, mySeat);
    const keji = canSkipDiscard(g, mySeat); // 吕蒙【克己】满足:可跳过弃牌
    if(over>0) setBanner(keji
      ? '克己:本回合未出杀,可不弃牌直接结束回合(也可勾选手牌后点确认弃牌)。'
      : '手牌超出体力,需选中 '+over+' 张后点确认弃牌(已选 '+discardSelectedSet.size+'/'+over+')。');
    else setBanner('轮到你,弃牌阶段。手牌未超出体力上限,可直接结束回合。');
    if(over>0){
      // 多选后统一确认:必须恰好选够数量才能提交,选多选少都不能点(和discardCards的服务端
      // 校验口径一致——服务端要求"cardIdxList.length>=need"且不接受重复/越界下标,这里前端
      // 用===over做更严格的UI层限制,不允许多选,避免玩家多勾了几张、点确认后一次性弃掉超过
      // 需要的数量这种体验问题)。
      const confirmBtn=document.createElement('button'); confirmBtn.className='primary';
      confirmBtn.textContent='确认弃牌('+discardSelectedSet.size+'/'+over+')';
      confirmBtn.disabled = discardSelectedSet.size!==over;
      confirmBtn.onclick=()=>{
        discardCards([...discardSelectedSet]);
        discardSelectedSet = new Set();
      };
      c.appendChild(confirmBtn);
    }
    const b=document.createElement('button'); b.className='ghost';
    b.textContent='结束回合'; b.disabled=over>0 && !keji; b.onclick=endTurn; c.appendChild(b);
  }

  // 袁术【同疾】状态显示:若袁术的手牌数大于体力值,且当前玩家在袁术攻击范围内,显示提示
  // 这个检查放在最后,不会覆盖前面各分支设置的banner
  const yuanshuSeatTongji = findPlayerWithCap(g, 'tongji');
  if(yuanshuSeatTongji !== null && c.innerHTML==='') {
    const yuanshuTongji = g.players[yuanshuSeatTongji];
    if(yuanshuTongji && yuanshuTongji.alive) {
      const handCountTongji = (yuanshuTongji.hand || []).length;
      const hpTongji = yuanshuTongji.hp || 0;
      if(handCountTongji > hpTongji) {
        // 检查当前玩家是否在袁术的攻击范围内
        if(mySeat !== yuanshuSeatTongji) {
          const distTongji = distance(g, mySeat, yuanshuSeatTongji);
          const rangeTongji = attackRange(g, mySeat);
          if(distTongji <= rangeTongji) {
            // 当前玩家在袁术的攻击范围内，受到同疾效果影响
            setBanner('【同疾】: '+yuanshuTongji.name+' 手牌数('+handCountTongji+') > 体力值('+hpTongji+'),你只能对其使用【杀】');
          }
        }
        // 如果当前玩家就是袁术，且在自己回合中显示自己触发了同疾
        if(mySeat === yuanshuSeatTongji && myTurn) {
          setBanner('【同疾】发动中: 你的手牌数('+handCountTongji+') > 体力值('+hpTongji+'),攻击范围内的角色只能对你使用【杀】');
        }
      }
    }
  }
}

// 马谡【散谣】旧的服务端 pending 驱动 UI(renderSanyaoChooseTarget/renderSanyao)已删除——
// 判断的 sanyaoChooseTarget/sanyao pending 类型和调用的 respondSanyaoTarget/respondSanyao
// 都已在第一步整体作废,UI 改走 sanyaoMode 本地状态机(见上方"出牌阶段按钮"区块)。

// ========== 马谡【制蛮】UI ==========

function renderZhimengAsk(g) {
  if(g.phase !== 'zhimengAsk' || !g.pending) return '';
  const p = g.players[g.pending.from];
  // "我是不是这次该做选择的攻击者"要看 g.pending.from(pending自带的座位字段),不能看
  // p.seat——玩家对象上根本没有seat这个属性(座位号是g.players数组下标,不是对象属性),
  // p.seat恒为undefined,写成p.seat!==mySeat这个判断恒真,会让马谡本人也被挡在"等待"分支
  // 里看不到发动/不发动按钮(和悲歌此前出现过的同一类bug)。
  if(!p || g.pending.from !== mySeat) {
    return '<div class="zhimeng-wait">等待 ' + escapeHtml(p.name) + ' 选择是否发动【制蛮】…</div>';
  }
  
  const target = g.players[g.pending.to];
  let html = '<div class="zhimeng-ask">';
  html += '<p>' + escapeHtml(p.name) + ' 对 ' + escapeHtml(target.name) + ' 造成伤害，是否发动【制蛮】？</p>';
  html += '<p>防止此伤害并获得其场上一张牌</p>';
  html += '<button onclick="respondZhimeng(true)">发动</button>';
  html += '<button onclick="respondZhimeng(false)" class="ghost">不发动</button>';
  html += '</div>';
  return html;
}

function renderZhimengPick(g) {
  if(g.phase !== 'zhimengPick' || !g.pending) return '';
  const p = g.players[g.pending.from];
  // 同 renderZhimengAsk:必须用 g.pending.from,不能用不存在的 p.seat。
  if(!p || g.pending.from !== mySeat) return '';
  
  const target = g.players[g.pending.to];
  let html = '<div class="zhimeng-pick">';
  html += '<p>' + escapeHtml(p.name) + ' 发动【制蛮】，请选择获得 ' + escapeHtml(target.name) + ' 的哪一张牌：</p>';
  
  g.pending.options.forEach((opt, idx) => {
    html += '<button onclick="respondZhimengPick(\'' + opt.type + '\',' + (opt.index !== undefined ? opt.index : '') + ')">' + escapeHtml(opt.label) + '</button>';
  });
  
  html += '</div>';
  return html;
}

// ===================== 蔡文姬技能UI =====================

// 悲歌：选择是否发动UI
function renderBeigeChoose(g) {
  if(g.phase !== 'beigeChoose' || !g.pending || g.pending.type !== 'beigeChoose' || g.pending.sourceSeat !== mySeat) return '';
  
  const source = g.players[mySeat];
  if(!source || !source.alive) return '';
  
  const damaged = g.players[g.pending.damagedSeat];
  const sourcePlayer = g.players[g.pending.damageSource];
  
  let html = '<div class="beige-choose">';
  html += '<h4>【悲歌】发动</h4>';
  html += '<p>' + escapeHtml(damaged.name) + ' 受到【杀】伤害后,你可以弃置一张牌令其进行判定</p>';
  html += '<p>判定结果：红桃回复1体力；方块摸2牌；梅花伤害来源弃2牌；黑桃伤害来源翻面</p>';
  html += '<button onclick="triggerBeige(true)" class="skill-btn" style="background: #e74c3c;">发动</button>';
  html += '<button onclick="triggerBeige(false)" class="cancel-btn">不发动</button>';
  html += '</div>';
  return html;
}

// 悲歌：选择弃置的牌UI
function renderBeigeDiscard(g) {
  if(g.phase !== 'beigeDiscard' || !g.pending || g.pending.type !== 'beigeDiscard' || g.pending.sourceSeat !== mySeat) return '';
  
  const source = g.players[mySeat];
  if(!source || !source.alive) return '';
  
  const damaged = g.players[g.pending.damagedSeat];
  
  let html = '<div class="beige-discard">';
  html += '<h4>【悲歌】弃置牌</h4>';
  html += '<p>为 ' + escapeHtml(damaged.name) + ' 发动【悲歌】,请选择一张牌弃置</p>';
  
  // 可弃置的手牌
  html += '<div class="card-options"><h5>手牌：</h5>';
  const hand = source.hand || [];
  for (let i = 0; i < hand.length; i++) {
    const card = hand[i];
    html += '<button onclick="beigeDiscard(' + i + ', false, \'\')" class="card-btn">弃置【' + escapeHtml(card.name) + '】(' + card.suit + rankText(card.rank) + ')</button>';
  }
  
  // 可弃置的装备
  html += '<h5>装备：</h5>';
  const equipTypes = ['weapon', 'armor', 'plus1', 'minus1'];
  const equipNames = ['武器', '防具', '+1马', '-1马'];
  
  for (let i = 0; i < equipTypes.length; i++) {
    const eqType = equipTypes[i];
    const eqName = equipNames[i];
    if (source.equips && source.equips[eqType] !== null) {
      const eqCard = source.equips[eqType];
      html += '<button onclick="beigeDiscard(0, true, \'' + eqType + '\')" class="card-btn">弃置' + eqName + '【' + escapeHtml(eqCard.name) + '】</button>';
    }
  }
  
  html += '</div>';
  html += '<button onclick="cancelBeige()" class="cancel-btn">取消</button>';
  html += '</div>';
  return html;
}

// 悲歌：判定阶段UI
function renderBeigeJudge(g) {
  if(g.phase !== 'beigeJudge' || !g.pending || g.pending.type !== 'beigeJudge' || g.pending.sourceSeat !== mySeat) return '';
  
  const damaged = g.players[g.pending.damagedSeat];
  if(!damaged) return '';
  
  let html = '<div class="beige-judge">';
  html += '<h4>【悲歌】判定</h4>';
  html += '<p>等待 ' + escapeHtml(damaged.name) + ' 的判定结果...</p>';
  html += '<button onclick="doBeigeJudge()" class="skill-btn" style="background: #f39c12;">进行判定</button>';
  html += '<button onclick="cancelBeige()" class="cancel-btn">取消</button>';
  html += '</div>';
  return html;
}

// 翻面状态提示UI
function renderFaceupStatus(g) {
  const p = g.players[mySeat];
  if(!p || p.faceup !== false) return '';
  
  return '<div class="status-notice"><p>你处于背面状态：下次轮到你时将跳过整个回合并自动翻回正面；回合外仍可正常响应</p></div>';
}

// 智迟状态提示UI
function renderZhichiStatus(g) {
  if(g.zhichiImmunity && g.zhichiImmunity.turn === g.turn && g.zhichiImmunity.seat === mySeat) {
    const p = g.players[mySeat];
    if(p && p.alive) {
      return '<div class="status-notice"><p style="color: #9b59b6;">【智迟】: 你本回合内免疫【杀】和普通锦囊牌</p></div>';
    }
  }
  return '';
}

// ========== 曹冲技能UI ==========

// 曹冲技能UI总入口
function renderCaochong(g) {
  // 称象询问阶段:"是否发动"本身和洛神"是否发动进行判定"同一原则——发动意图是隐藏信息,
  // 非本人只看不剧透的banner,不返回任何面板内容。
  if (g.pending && g.pending.type === 'chengxiangAsk') {
    if (g.pending.seat === mySeat) return renderChengxiangAsk(g);
    const p = g.players[g.pending.seat];
    setBanner((p?escapeHtml(p.name):'')+' 受到伤害,是否发动【称象】…');
    return '';
  }

  // 称象选择阶段:官方规则是"亮出"牌堆顶4张牌——这是公开信息,所有玩家都应该能看到这4张牌
  // 的牌面,和五谷丰登公共牌池(poolDesc对所有人可见)同一原则,不能用 seat===mySeat 把整个
  // 渲染都挡住。renderChengxiangChoose 内部自己按 seat===mySeat 分叉:本人拿到完整的
  // 交互面板(可点击选牌+确认/取消按钮),其余人只拿到只读的牌面展示,不含任何 onclick。
  if (g.pending && g.pending.type === 'chengxiangChoose') {
    return renderChengxiangChoose(g);
  }

  // 仁心选择阶段
  if (g.pending && g.pending.type === 'renxinChoose' && g.pending.seat === mySeat) {
    return renderRenxinChoose(g);
  }

  return '';
}

// 称象询问阶段UI
function renderChengxiangAsk(g) {
  const p = g.players[mySeat];
  if (!p || !p.alive) return '';
  
  let html = '<div class="skill-choose">';
  html += '<h4>【称象】</h4>';
  html += '<p>你受到伤害，是否发动【称象】？</p>';
  html += '<p>发动后将亮出牌堆顶的4张牌，并可选择点数和≤13的牌获得</p>';
  html += '<button onclick="confirmChengxiangAsk()" class="skill-btn" style="background: #4a90d9;">发动</button>';
  html += '<button onclick="cancelChengxiangAsk()" class="skill-btn" style="background: #999;">不发动</button>';
  html += '</div>';
  return html;
}

// 称象选择阶段UI
let chengxiangSelectedIndices = [];

function renderChengxiangChoose(g) {
  const p = g.pending;
  if (!p || p.type !== 'chengxiangChoose') return '';

  // 非本人:只读展示亮出的4张牌本身(公开信息),不含任何 onclick,不能操作选择/确认/取消。
  if (p.seat !== mySeat) {
    const owner = g.players[p.seat];
    const ownerName = owner ? owner.name : '';
    let html = '<div class="skill-choose">';
    html += '<h4>【称象】亮出的牌</h4>';
    html += '<p>' + escapeHtml(ownerName) + ' 亮出了以下 ' + p.revealedCards.length + ' 张牌,正在选择获得哪些…</p>';
    html += '<div class="card-grid" style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin: 10px 0;">';
    p.revealedCards.forEach((card, idx) => {
      const value = p.cardValues[idx].value;
      html += '<div class="card-option" style="padding: 10px; border: 2px solid #ccc; border-radius: 5px;">';
      html += '<div class="card-name">' + escapeHtml(card.name) + '</div>';
      html += '<div class="card-value">点数: ' + value + '</div>';
      html += '</div>';
    });
    html += '</div>';
    html += '</div>';
    return html;
  }

  const selectedCards = p.revealedCards.filter((_, i) => chengxiangSelectedIndices.includes(i));
  const selectedHtml = selectedCards.length > 0 
    ? selectedCards.map(c => c.name).join(',') 
    : '无';
  const sum = chengxiangSelectedIndices.reduce((s, i) => s + p.cardValues[i].value, 0);
  
  let html = '<div class="skill-choose">';
  html += '<h4>【称象】选择牌</h4>';
  html += '<p>从亮出的' + p.revealedCards.length + '张牌中选择任意张（点数和 ≤ ' + p.sumLimit + '）：</p>';
  html += '<div class="card-grid" style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin: 10px 0;">';
  
  p.revealedCards.forEach((card, idx) => {
    const value = p.cardValues[idx].value;
    const isSelected = chengxiangSelectedIndices.includes(idx);
    html += '<div class="card-option" onclick="toggleChengxiangCard(' + idx + ')" style="padding: 10px; border: 2px solid ' + (isSelected ? '#4a90d9' : '#ccc') + '; border-radius: 5px; cursor: pointer;" data-index="' + idx + '">';
    html += '<div class="card-name">' + escapeHtml(card.name) + '</div>';
    html += '<div class="card-value">点数: ' + value + '</div>';
    html += '</div>';
  });
  
  html += '</div>';
  html += '<div class="selection-info" style="margin: 10px 0;">';
  html += '<p>当前选择：<strong>' + escapeHtml(selectedHtml) + '</strong></p>';
  html += '<p>点数和：<strong>' + sum + '</strong> / ' + p.sumLimit + '</p>';
  html += '</div>';
  html += '<button onclick="confirmChengxiangSelection()" class="skill-btn" style="background: #4a90d9; margin-right: 10px;">确认选择</button>';
  html += '<button onclick="cancelChengxiang()" class="skill-btn" style="background: #999;">选择0张</button>';
  html += '</div>';
  return html;
}

function toggleChengxiangCard(idx) {
  // 顶层具名函数,由HTML里的onclick在全局作用域直接调用,不是tx回调也不接收g参数——
  // 必须用currentG(render.js里每次render(g)都会更新的"最近一次收到的游戏状态"),不能
  // 引用一个从未在任何地方声明过的裸标识符g(会抛ReferenceError,点击静默无反应)。
  const p = currentG.pending;
  if (!p || p.type !== 'chengxiangChoose' || p.seat !== mySeat) return;
  
  const cardValue = p.cardValues[idx].value;
  const currentSum = chengxiangSelectedIndices.reduce((sum, i) => sum + p.cardValues[i].value, 0);
  const newSum = chengxiangSelectedIndices.includes(idx) 
    ? currentSum - cardValue 
    : currentSum + cardValue;
  
  if (newSum <= p.sumLimit) {
    if (chengxiangSelectedIndices.includes(idx)) {
      chengxiangSelectedIndices = chengxiangSelectedIndices.filter(i => i !== idx);
    } else {
      chengxiangSelectedIndices.push(idx);
    }
    render();
  }
}

function confirmChengxiangSelection() {
  // 同 toggleChengxiangCard:顶层具名函数,必须用 currentG,不能引用未声明的裸 g。
  const p = currentG.pending;
  if (!p || p.type !== 'chengxiangChoose' || p.seat !== mySeat) return;
  
  const sum = chengxiangSelectedIndices.reduce((s, i) => s + p.cardValues[i].value, 0);
  
  if (sum > p.sumLimit) {
    alert('点数和不能超过' + p.sumLimit);
    return;
  }
  
  // 找到对应的selectable选项
  const selection = p.selectable.find(s => 
    s.indices.length === chengxiangSelectedIndices.length &&
    s.indices.every(i => chengxiangSelectedIndices.includes(i))
  );
  
  if (selection) {
    confirmChengxiang(selection);
    chengxiangSelectedIndices = [];
  }
}

// 仁心选择阶段UI
function renderRenxinChoose(g) {
  const p = g.pending;
  if (!p || p.type !== 'renxinChoose' || p.seat !== mySeat) return '';
  
  const target = g.players[p.target];
  const me = g.players[mySeat];
  if (!target || !me) return '';
  
  const slotLabels = { weapon:'武器', armor:'防具', plus1:'+1马', minus1:'-1马' };
  let html = '<div class="skill-choose">';
  html += '<h4>【仁心】保护 ' + escapeHtml(target.name) + '</h4>';
  html += '<p>' + escapeHtml(target.name) + ' 体力为1受到伤害，你可以弃置一张装备牌并翻面来防止此伤害：</p>';
  html += '<div class="equip-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 10px; margin: 10px 0;">';
  
  (p.equipSlots || []).forEach(slot => {
    const equipCard = me.equips && me.equips[slot];
    if (equipCard) {
      html += '<button onclick="chooseRenxinEquip(\'' + slot + '\')" class="equip-btn" style="padding: 10px; border: 2px solid #4a90d9; border-radius: 5px; background: white; cursor: pointer;">';
      html += '弃置【' + escapeHtml(equipCard.name) + '】(' + (slotLabels[slot]||slot) + ')';
      html += '</button>';
    }
  });
  
  html += '</div>';
  html += '<p><small>注意：翻面后你将变为 ' + (me.faceup === false ? '正面朝上' : '背面朝上') + ' 状态</small></p>';
  html += '<button onclick="cancelRenxin()" class="skill-btn" style="background: #999;">不发动</button>';
  html += '</div>';
  return html;
}
