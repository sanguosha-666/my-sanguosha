// ---------- 身份局机器人 ----------
// 机器人完全运行在第一名真人的浏览器里，不使用服务器进程。它只能读取公开身份、自己身份
// 和公开行动形成的嫌疑值；除主公/已阵亡翻开的角色外，不读取其他人的隐藏 role。
let botTimer=null;
let botScheduledKey=null;

function botControllerSeat(g){
  return (g.players||[]).findIndex(p=>p && !p.isBot && p.cid);
}
function isBotController(g){
  const seat=botControllerSeat(g);
  return seat>=0 && g.players[seat].cid===myClientId;
}
// phase -> "这个阶段真正该行动的人存在 pending 的哪个字段"。
// 【为什么必须查表】旧实现是按固定顺序扫 [asking,active,currentSeat,targetSeat,sourceSeat,
// damagerSeat,from,to,seat],返回第一个"恰好是机器人"的字段,不判断这个座位是不是该行动的
// 那个人。respond/aoeResp 的 pending 都是 {from,to},该响应的是 to,但 from 排在前面 —— 机器人
// 对机器人出杀时会把攻击者当成响应者,runBotDecision 对应分支要求 d.to===seat 不匹配、全部
// 落空,而每次调度只算一个座位,真正该出闪的机器人永远等不到调度,对局必然死锁。
// 【这张表的权威来源】不是从 runBotDecision 抄的,是逐条对照各响应函数在服务端的身份守卫
// (respondShan 的 g.pending.to!==mySeat、duelResponse 的 active、respondJiedao 的 seatA 等)
// 核验过的,33 条与 runBotDecision 的分支一一对应,无遗漏无多余。
// 【安全性质】各 runBotDecision 分支仍保留自己的 d.X===seat 复核,所以万一某条表项写错,
// 只会退化成"不行动"(=修复前的行为),绝不会让错误的机器人替别人行动。
// 新增技能/阶段时:在 runBotDecision 里加分支,就要在这里补一条,否则该阶段会掉进下面的
// 未覆盖兜底(能走,但不如查表精确)。
const BOT_PHASE_ACTOR = {
  huashenPick:'seat', guanxingReview:'seat', xunxunPick:'seat',
  respond:'to', aoeResp:'to', huogongReveal:'to',
  duel:'active',
  dying:'asking', wuxie:'asking', guicai:'asking',
  tieqi:'from', liegong:'from', huogong:'from', pick:'from', qilin:'from',
  hanbing:'from', mengjin:'from', shaOffsetChoice:'from',
  duanbingChoose:'sourceSeat', ganglieChoice:'sourceSeat',
  fanjianSuit:'targetSeat', quhuRespond:'targetSeat', tianyiRespond:'targetSeat',
  enyuanChoose:'damagerSeat', enyuanChooseOption:'damagerSeat', enyuanGiveCard:'damagerSeat',
  jiedaoChoice:'seatA',
  // 新增(机器人兜底词汇盲区修复,问题3+4):这几个phase的按钮文案("获得"/"不获得"、
  // "不再发动"、"更改【化身】"/"不更改"、"质疑"/"不质疑"、"移动到XX"/"不移动")没有一个被
  // botSafePrompt 的正则(/不发动|不使用|不出|取消|跳过|放弃|结束/ 和 /选择|交给|弃置|摸牌|
  // 回复|打出/)覆盖到,兜底探测不出可点按钮,必然卡死。这里不是简单扩充正则(那治标不治本,
  // 且 guhuoQuestion 本身是有策略含义的判断题,随便点安全按钮=瞎选而不是决策),而是照
  // huashenPick/guanxingReview 等既有先例补专门决策分支——补分支就必须同时在这张表里登记,
  // 否则 botSeatForState 会继续把这些phase当"未覆盖阶段"扔给 botFallbackSeats+
  // botSafePrompt(=修复前的broken路径),新分支永远不会被调用到。
  luoyingAsk:'seat', luoshen:'seat',
  huashenChangeAskStart:'seat', huashenChangeAskEnd:'seat',
  guhuoQuestion:'asking', qiaobianMove:'seat'
};
function botSeatForState(g){
  const d=g.pending||{};
  const isBotSeat=s=>Number.isInteger(s)&&g.players[s]&&g.players[s].isBot;
  // A. 行动者不在 pending 字段上的几个特殊阶段
  if(g.phase==='wugu'&&d.type==='wugu'&&Array.isArray(d.order)){
    const picker=d.order[d.idx||0];
    return isBotSeat(picker)?picker:-1;
  }
  if(g.phase==='pickingLordGeneral'){
    const lord=getLordSeat(g);
    return isBotSeat(lord)?lord:-1;
  }
  if(g.phase==='pickingGeneral'){
    // 选将是各选各的:任意一个还没选将的机器人都可以现在就选
    const pick=(g.players||[]).findIndex(p=>p&&p.isBot&&!p.general);
    return pick>=0?pick:-1;
  }
  if(g.phase==='draw'||g.phase==='play'||g.phase==='discard'){
    return isBotSeat(g.turn)?g.turn:-1;
  }
  // B. 其余已覆盖阶段:查表直取,不猜
  const field=BOT_PHASE_ACTOR[g.phase];
  if(field!==undefined){
    return isBotSeat(d[field])?d[field]:-1;
  }
  // C. runBotDecision 未覆盖的阶段(骁果/据守/礼让/悲歌/旋风等 70+ 个):这里不猜字段,
  //    交给 botFallbackSeats + botSafePrompt 逐个座位试。
  return -1;
}
// 上面 A/B 两段能解析出行动者的阶段集合。已知阶段就算解析结果是"该真人行动"(返回 -1),
// 也不该再去兜底试点 —— 那是真人的回合,机器人不该插手,试点只会白白渲染+刷告警。
const BOT_KNOWN_PHASES = new Set(
  Object.keys(BOT_PHASE_ACTOR).concat(
    ['wugu','pickingLordGeneral','pickingGeneral','draw','play','discard'])
);
// 未覆盖阶段的兜底候选:所有存活机器人。只在确实有人被询问(g.pending 非空)时才给,
// 避免正常轮次里空转渲染。真正"该不该由这个座位点"由 botSafePrompt 自证 —— renderControls
// 的各分支都按 ===mySeat 把关,不该他动的时候压根渲染不出可点按钮。
function botFallbackSeats(g){
  if(!g.pending || BOT_KNOWN_PHASES.has(g.phase)) return [];
  const out=[];
  (g.players||[]).forEach((p,i)=>{ if(p&&p.isBot&&p.alive) out.push(i); });
  return out;
}
function runBotFallbackProbe(g){
  for(const s of botFallbackSeats(g)){
    if(botSafePrompt(g,s)) return true;
  }
  console.warn('机器人兜底未找到可点按钮',g.phase,(g.pending||{}).type);
  return false;
}
function botStateKey(g,seat){
  const d=g.pending||{};
  const p=g.players[seat]||{};
  return [
    g.phase,g.turn,g.roundNum,seat,d.type,d.asking,d.active,d.stage,d.idx,d.to,d.from,
    p.hp,(p.hand||[]).length,(g.log||[]).length
  ].join(':');
}
// botDecisionInFlight:AI机器人接入第二阶段新增的并发保护——botPlay 改成 async 之后,
// "AI思考"这段等待(最长约15秒,见 tryAiBotPlay 顶部注释)期间,任何触发 render(g) 的
// 事件(比如别的玩家的操作、甚至只是网络重连推送)都会经过 render.js 里
// scheduleBotTurn(g) 这唯一的调用点重新跑一遍;而这段等待期间服务端状态其实完全没变
// (我们在等的是"自己"的决策结果,不是别人的行动),botStateKey 算出来的 key 会和上一次
// 一模一样,原有的"botTimer && botScheduledKey===key 就不重复排程"这条防重复守卫只挡得住
// "定时器还没触发"这一段,挡不住"定时器已经触发、决策还在异步进行中"这一段(触发那一刻
// botTimer 已经清空成 null)——不加这个标志位,会在同一个决策点上并发跑出两次
// runBotDecision,对 botPlay 而言就是两次并发的AI调用/两次 playCard,是这次改成 async
// 之后必须补的正确性保护,不是可选的优化。只在"确实有一个决策正在进行"时才为真,
// try/finally 保证不管走哪条路径(成功/AI失败回退本地/抛异常)最终都会被清空,不会永久
// 卡住机器人。
let botDecisionInFlight=false;
function scheduleBotTurn(g){
  if(!g || !isBotController(g) || g.phase==='over') return;
  if(botDecisionInFlight) return;
  const seat=botSeatForState(g);
  // seat<0 有两种情况:该行动的是真人(不该我们插手),或这个阶段 runBotDecision 没覆盖
  // (需要走兜底逐个试)。只有后者才继续排程。
  if(seat<0 && !botFallbackSeats(g).length) return;
  const key=botStateKey(g,seat);
  if(botTimer && botScheduledKey===key) return;
  if(botTimer) clearTimeout(botTimer);
  botScheduledKey=key;
  botTimer=setTimeout(async ()=>{
    botTimer=null;
    const latest=(typeof currentG!=='undefined')?currentG:null;
    if(!latest || !isBotController(latest)) return;
    const nowSeat=botSeatForState(latest);
    if(botStateKey(latest,nowSeat)!==key) return;
    botDecisionInFlight=true;
    try{
      if(nowSeat>=0) await runBotDecision(latest,nowSeat);
      else runBotFallbackProbe(latest);
    } finally {
      botDecisionInFlight=false;
    }
  },650+Math.floor(Math.random()*500));
}
function botInvoke(seat,fn){
  const humanSeat=mySeat;
  mySeat=seat;
  try{ fn(); } finally { mySeat=humanSeat; }
}
function botKnownRole(g,viewerSeat,targetSeat){
  const target=g.players[targetSeat];
  if(!target) return null;
  if(targetSeat===viewerSeat || target.role==='zhu' || target.roleRevealed) return target.role;
  return null;
}
function botSuspicion(g,seat){
  return Number((g.aiRebelSuspicion||{})[seat]||0);
}
// 公开行动证据。正数=更像反贼，负数=更像忠臣；不按观察者分别保存，所有人看到的公开
// 行为相同。这里只记录真实造成的伤害，不把被迫响应【决斗】误算成主动敌意。
function recordBotDamageEvidence(g,sourceSeat,targetSeat,amount,srcType){
  if(g.gameMode!=='identity'||!Number.isInteger(sourceSeat)||amount<=0||srcType==='duel') return;
  const source=g.players[sourceSeat], target=g.players[targetSeat];
  if(!source||!target||source.roleRevealed) return;
  g.aiRebelSuspicion=g.aiRebelSuspicion||{};
  let delta=0;
  if(target.role==='zhu') delta=45*amount;
  else if(target.roleRevealed && target.role==='fan') delta=-28*amount;
  else if(target.roleRevealed && target.role==='zhong') delta=24*amount;
  if(delta) g.aiRebelSuspicion[sourceSeat]=Math.max(-100,Math.min(100,botSuspicion(g,sourceSeat)+delta));
}
function recordBotRescueEvidence(g,rescuerSeat,dyingSeat){
  if(g.gameMode!=='identity'||!Number.isInteger(rescuerSeat)) return;
  const dying=g.players[dyingSeat], rescuer=g.players[rescuerSeat];
  if(!dying||!rescuer||rescuer.roleRevealed) return;
  g.aiRebelSuspicion=g.aiRebelSuspicion||{};
  let delta=0;
  if(dying.role==='zhu') delta=-50;
  else if(dying.roleRevealed&&dying.role==='fan') delta=25;
  if(delta) g.aiRebelSuspicion[rescuerSeat]=Math.max(-100,Math.min(100,botSuspicion(g,rescuerSeat)+delta));
}
function botTargetScore(g,seat,targetSeat,kind){
  const me=g.players[seat], target=g.players[targetSeat];
  if(!me||!target||!target.alive||seat===targetSeat) return -Infinity;
  const known=botKnownRole(g,seat,targetSeat);
  const suspicion=botSuspicion(g,targetSeat);
  let score=(target.maxHp-target.hp)*8+(4-target.hp)*7+(target.hand||[]).length*2;
  if(me.role==='zhong'){
    if(known==='zhu'||known==='zhong') return -Infinity;
    if(known==='fan') score+=180;
    else if(known==='nei') score+=55;
    else if(suspicion<35) return -Infinity; // 忠臣宁可不出牌，也不盲杀身份不明者
    else score+=suspicion*2;
  } else if(me.role==='fan'){
    if(known==='fan') return -Infinity;
    if(known==='zhu') score+=240;
    else if(known==='zhong') score+=100;
    else score-=suspicion;
  } else if(me.role==='zhu'){
    if(known==='zhong') return -Infinity;
    if(known==='fan') score+=190;
    else if(suspicion<30) return -Infinity;
    else score+=suspicion*2;
  } else if(me.role==='nei'){
    if(known==='zhu'&&target.hp<=2) return -Infinity; // 前中期不让主公突然死亡
    const lord=getLordSeat(g), rebels=g.players.filter(p=>p&&p.alive&&p.roleRevealed&&p.role==='fan').length;
    if(known==='fan') score+=(rebels>0?45:0);
    if(targetSeat===lord) score-=60;
    score+=(target.hand||[]).length+target.hp;
  } else {
    score+=Math.random()*10;
  }
  if(kind==='steal') score+=(target.hand||[]).length*4;
  return score;
}
function botBestTarget(g,seat,card,actionId){
  const me=g.players[seat], spec=CARD_PLAYS[actionId];
  let best=-1,bestScore=-Infinity;
  g.players.forEach((p,i)=>{
    if(!p||!p.alive||i===seat) return;
    if(spec&&spec.canTarget&&!spec.canTarget(g,me,card,i)) return;
    const kind=(actionId==='顺手牵羊'||actionId==='过河拆桥')?'steal':'damage';
    const score=botTargetScore(g,seat,i,kind);
    if(score>bestScore){bestScore=score;best=i;}
  });
  return best;
}
function botActionId(card){ return isShaName(card.name)?'杀':card.name; }
function botCardPriority(name){
  if(name==='桃') return 100;
  if(name==='无中生有') return 92;
  if(EQUIPS[name]) return 82;
  if(name==='顺手牵羊'||name==='过河拆桥') return 74;
  if(name==='乐不思蜀'||name==='兵粮寸断') return 70;
  if(isShaName(name)) return 66;
  if(name==='决斗'||name==='火攻') return 62;
  if(name==='桃园结义') return 58;
  if(name==='五谷丰登') return 48;
  if(name==='酒') return 40;
  return 20;
}

// ================= AI机器人接入第二阶段起:botPlay(出什么牌)+ botBestTarget(选目标) =================
// 【范围声明】第二阶段先在 botPlay(出什么牌)这一个决策点上验证完整链路(AI调用→合法性
// 校验→超时/失败兜底→回退本地逻辑)稳固可靠;第三阶段(见下方"AI机器人接入第三阶段"
// 那段)在此基础上扩展到 botBestTarget(选目标)。四阶段方案里规划的三个决策点(第四阶段
// 是可选的更广范围扩展,不在此列)至此全部接入完毕。ai-bot.js 的 callAI/PROVIDER_ADAPTERS
// 等基础设施两个阶段都确认不需要改动,直接复用第一阶段已完成的成果。

// showAiThinkingIndicator/hideAiThinkingIndicator:index.html 里新增的 #aiThinkingIndicator
// 是一个独立于 #controls/#banner 的常驻占位元素(挂在 .panel.table 内,#banner 之后、
// #controls 之前),不会被 renderControls() 每次调用时的 c.innerHTML='' 清空覆盖——
// AI 调用发生在客户端本地的一次异步等待期间,不是由某次 render(g) 触发,不能指望常规
// 渲染周期去托管这个提示的显隐,只能在调用前后手动切换。只有 isBotController(g) 为真
// 的这一个客户端会真正执行到 botPlay/tryAiBotPlay(scheduleBotTurn 的既有门槛已经保证
// 了这一点,不需要额外判断),所以"仅在机器人控制者这一端显示"是这套调度结构天然带来的
// 效果,不用专门加判断。纯提示、不拦截点击(CSS pointer-events:none,和 .my-turn-banner
// 同一约定),不会挡住玩家同时进行的其它操作。
function showAiThinkingIndicator(g, seat){
  const el = document.getElementById('aiThinkingIndicator');
  if(!el) return;
  const name = (g.players[seat] && g.players[seat].name) || ('机器人'+(seat+1));
  el.textContent = '🤖 '+name+' 正在思考…';
  el.classList.remove('hidden');
}
function hideAiThinkingIndicator(){
  const el = document.getElementById('aiThinkingIndicator');
  if(el) el.classList.add('hidden');
}

// botCardBrief/botPublicEquipsView/botPublicDelaysView/buildBotVisibleState:
// 【隐藏信息保护,务必遵守】给 AI 的 game state 必须是"这个机器人视角下真实合法可见的信息"
// 投影——是从头只塞进这个座位真实能看到的字段,不是先把整个 g 塞给AI事后再过滤(那种
// 写法容易在新增字段时漏过滤,这里从设计上就不给 AI 任何超出范围的原始对象引用)。
// 装备区(equips)和判定区(delays)在这个项目里本来就是公开信息(见 CLAUDE.md「装备
// 系统」「延时锦囊」两节的既有规则),对所有玩家一视同仁完整展示;身份复用既有的
// botKnownRole(和 UI 渲染座位卡身份标识用的 canSeeRole 同一套规则:自己、主公、
// 已翻开的角色才可见,其余一律 null),不新发明一套可见性判断。不该出现的东西——
// 其他角色的真实手牌内容(只给张数 handCount,不给 name/suit/rank)、未翻开角色的
// 真实身份(botKnownRole 返回 null 就是 null,不回退成"猜测值")——从这个函数的结构上
// 就不可能被塞进去,不是靠事后删字段做到的。
function botCardBrief(c){ return c ? { name:c.name, suit:c.suit, rank:c.rank } : null; }
function botPublicEquipsView(p){
  const out={};
  (typeof EQUIP_SLOTS!=='undefined' ? EQUIP_SLOTS : []).forEach(slot=>{
    const c = p.equips && p.equips[slot];
    out[slot] = c ? c.name : null;
  });
  return out;
}
function botPublicDelaysView(p){ return (p.delays||[]).map(c=>c.name); }
function buildBotVisibleState(g, seat){
  const me = g.players[seat];
  return {
    seat,
    gameMode: g.gameMode || 'ffa',
    round: g.roundNum || 1,
    // 自己的手牌/身份完全可见——这是这个座位本来就该看到的东西,不是特权。
    myRole: me.role || null,
    myHp: me.hp, myMaxHp: me.maxHp,
    myHand: (me.hand||[]).map(botCardBrief),
    myEquips: botPublicEquipsView(me),
    myDelays: botPublicDelaysView(me),
    players: (g.players||[]).map((p,i)=>{
      if(!p) return null;
      return {
        seat: i, name: p.name, isSelf: i===seat, alive: p.alive,
        hp: p.hp, maxHp: p.maxHp,
        handCount: (p.hand||[]).length, // 只给张数,不给内容
        equips: botPublicEquipsView(p), delays: botPublicDelaysView(p),
        knownRole: botKnownRole(g, seat, i), // 复用既有的安全揭示逻辑,不知道就是 null
        general: p.general || null, // 武将本身是公开信息(座位卡对所有人可见),不是隐藏信息
      };
    }),
  };
}

// buildBotPlayCandidates:AI能选的候选动作列表,直接由已经跑过 CARD_PLAYS 真实
// canPlay/canTarget 校验的 options 数组(botPlay 里现有的合法性枚举逻辑,完全不变)
// 转成给AI看的可读描述,index 和 options 数组下标一一对应;最后追加一项固定的
// "结束出牌阶段"(index===options.length)。AI 只能从这份列表里选一个 index,这就是
// 硬性合法性校验的入口——列表之外根本不存在其它选项可选。
function botPlayCandidateEntry(g, opt, index){
  const targetInfo = (opt.target!=null && g.players[opt.target])
    ? { seat: opt.target, name: g.players[opt.target].name }
    : null;
  return { index, action: opt.action, target: targetInfo, localHeuristicScore: Math.round(opt.value) };
}
function buildBotPlayCandidates(g, options){
  const list = options.map((o,i)=>botPlayCandidateEntry(g, o, i));
  list.push({ index: options.length, action: '结束出牌阶段', target: null, localHeuristicScore: null });
  return list;
}

// BOT_STRATEGY_GUIDANCE_PLAY:第一阶段"通用部分"策略指导(不区分是否身份局,详见
// CLAUDE.md"AI机器人策略指导"记录)。这是判断优先级的引导性文字,不是"若A则必须B"式的
// 硬规则——刻意不写死具体阈值/条件,避免把AI变成一个更贵的本地启发式复制品。三个来源:
// ①价值取舍格言"多干损人利己的事,慎干损己利人的事"+1血≈2手牌粗略汇率(physixfan.com
// 三国杀价值理论长文);②"不要为了试探不明身份的人无谓消耗"+"不要把手牌耗尽去互殴"
// (忠臣/反贼过度消耗都会让内奸坐收渔利,这是四阵营研究里反复出现的同一枚硬币两面,
// gaoshouyou.com新手误区清单同样点名);③"五谷/无懈不要随手挥霍"直接引用自
// gaoshouyou.com原文"五谷不要乱开,开了死得快。无懈不要随意乱用,暴殄天物终将要还的"。
const BOT_STRATEGY_GUIDANCE_PLAY =
  '决策时可参考这些经验(是判断优先级的参考,不是必须遵守的硬规则):'
  +'总体上,多做"损人利己"的事,谨慎做"损己利人"的事——粗略换算,1点体力大致相当于2张'
  +'手牌的价值,可以据此判断值不值得为了某次效果搭上手牌或体力。几个容易踩的坑:不要为'
  +'了试探身份不明的角色而无谓消耗自己的资源;不要把手牌耗到几乎不剩就去和别人正面'
  +'互殴,那样往往是在替别人火中取栗;五谷丰登、无懈可击这类关键锦囊不要随手挥霍,该省'
  +'的时候要省。';

// BOT_IDENTITY_GUIDANCE:第二阶段——身份局四阵营战术基调(详见 CLAUDE.md"AI机器人策略
// 指导第二阶段"记录)。只在 g.gameMode==='identity' 且这个座位的 role 有值时才启用,
// 复用 buildBotVisibleState 已经在读的 me.role 字段,不新增读取路径;普通局(ffa)完全
// 不受影响。四段内容都是"当前阶段大致该往哪个方向想"的引导,刻意不写成if-then硬规则——
// 尤其内奸那条(三阶段模型)是调研里最具体、也最容易被写歪成机械规则的一条,已按调研阶段
// 的提醒把它写成"局势提示→倾向"这种叙述式引导,不是条件判断语句。四条内容和第一阶段
// 通用指导共用同一句"是判断优先级的参考,不是必须遵守的硬规则"这条纪律声明。
// 来源(调研阶段已查证,详见方案设计对话记录):反贼集火节奏("本回合若能对主公形成两次
// 以上有效攻击应主动出手")+反贼不与忠臣内耗;忠臣"局势不明时宁可暂时被误伤也不要过早
// 暴露"+不把手牌耗尽单挑反贼(这两条和反贼的"不与忠臣内耗"是同一枚硬币的两面);内奸
// 三阶段模型(前期配合主公清理反贼但避免抢头功暴露自己→中期反贼减员后伺机针对忠臣→
// 终局三方对峙阶段绝不主动碰主公、必须先解决忠臣);主公优先血厚/防御倾向+生存优先于
// 输出+早期低调靠观察集火/护主反推身份。
const BOT_IDENTITY_GUIDANCE = {
  fan: '若本回合能对主公形成两次以上有效攻击,通常应该主动出手;避免和忠臣正面消耗,'
    +'那样容易让内奸坐收渔利。',
  zhong: '核心任务是辅助并保护主公。局势不明时,宁可暂时被误伤,也不要过早暴露身份——'
    +'过早暴露容易成为反贼的首要目标,反而丧失后续保护主公的能力;也不要把手牌耗尽去'
    +'单挑反贼,那同样是在替内奸创造机会。',
  nei: '判断当前大致该往哪个方向想:场上还有较多反贼时,倾向于配合主公清理反贼,同时'
    +'避免抢头功、暴露自己;反贼所剩不多时,可以考虑找机会针对忠臣;若局面已经收缩到'
    +'只剩你、主公、忠臣三方,这个阶段不要主动招惹主公,优先设法解决忠臣,再考虑后续。',
  zhu: '生存优先于输出,倾向保留桃、杀等防身手段,不要轻易消耗殆尽;早期适度低调,可以'
    +'通过观察谁在集火你、谁在护着你来反推场上身份。',
};
const BOT_IDENTITY_ROLE_LABEL = { zhu:'主公', zhong:'忠臣', fan:'反贼', nei:'内奸' };
function botIdentityGuidance(g, seat){
  if(!g || g.gameMode!=='identity') return '';
  const me = g.players && g.players[seat];
  const role = me && me.role;
  const content = role && BOT_IDENTITY_GUIDANCE[role];
  if(!content) return '';
  return '这局是身份局,你当前的身份是'+BOT_IDENTITY_ROLE_LABEL[role]+':'+content;
}

function buildBotPlaySystemPrompt(g, seat){
  return '你在扮演一款网页版三国杀里的AI机器人玩家,当前轮到你的出牌阶段。你会收到:'
  +'①你视角下真实合法可见的局面(自己的手牌与身份完全可见;其他角色只有公开信息——'
  +'血量、装备、判定区、已知身份,手牌只知道张数、不知道具体是什么牌);'
  +'②一份已经按游戏规则筛选好的合法候选动作列表(localHeuristicScore是一个简单的'
  +'启发式参考分,仅供参考、不代表最优解),列表最后一项固定是"结束出牌阶段"。'
  +'你的任务只有一件事:从候选列表里选出一个index,代表这次要执行的动作——'
  +'不能选择列表之外的动作,不能凭空发明新选项,不需要也不能指定目标(目标已经在候选'
  +'列表里算好了)。'+BOT_STRATEGY_GUIDANCE_PLAY+botIdentityGuidance(g, seat)
  +'请只输出一个严格的JSON对象,格式固定为 {"choice": 数字},'
  +'不要输出任何解释文字、代码块标记或多余字段。';
}

function buildBotPlayUserPrompt(state, candidates){
  return '当前局面:\n'+JSON.stringify(state)
    +'\n\n合法候选动作列表(index从0开始):\n'+JSON.stringify(candidates)
    +'\n\n只返回 {"choice": 数字} 这一个JSON对象。';
}

// parseBotPlayAiChoice:从AI原始回复文本里尽量宽容地抠出 {"choice":N}——直接
// JSON.parse失败时,再剥掉常见的```/```json代码块包裹重试一次(小模型经常无视"不要
// 代码块"的指示);两次都失败,或者解析出来的 choice 不是合法整数,一律返回 null——
// 不细分"到底是格式错误还是数值不对",按第一阶段方案确认的原则,parse失败和索引越权
// 都统一交给调用方走同一条"回退本地逻辑"的路径,不单独区分。
function parseBotPlayAiChoice(text){
  if(typeof text!=='string') return null;
  const tryParse=(s)=>{
    try{
      const obj=JSON.parse(s.trim());
      if(obj && typeof obj.choice==='number' && Number.isInteger(obj.choice)) return obj.choice;
    }catch(e){}
    return null;
  };
  let r=tryParse(text);
  if(r!==null) return r;
  const stripped=text.replace(/```(?:json)?/gi,'').trim();
  if(stripped!==text) r=tryParse(stripped);
  return r;
}

// tryAiBotPlay:唯一的AI决策入口,返回 options 数组里的一项、或字符串 'pass'(选中了
// "结束出牌阶段"那个候选)、或 null(没有密钥/AI没有正确响应/索引不合法——这几种情况
// 一视同仁,统一交给 botPlay 落回本地启发式,不重试、不阻塞游戏)。
//
// 【超时上限,已确认的取舍】8~10秒的超时上限要求,直接复用 ai-bot.js 的 callAI 自带的
// AbortController 超时机制(目前是 AI_CALL_TIMEOUT_MS=15000),这里不额外包一层
// Promise.race 或 setTimeout——那是"重新发明"一套并行的超时逻辑,和"直接复用、不要
// 重新发明"这条要求矛盾。而这次任务的收尾范围明确写了"ai-bot.js的callAI等基础设施
// 本阶段不需要改动",两条要求字面上有一点冲突(15秒略宽于"8~10秒"),这里选择遵守
// "不改ai-bot.js"这条更明确的收尾约束、如实记录这个取舍,而不是为了凑那个数字回头
// 改动本阶段确认不动的文件。
async function tryAiBotPlay(g, seat, options){
  if(typeof aiApiKey==='undefined' || !aiApiKey || !aiProvider) return null;
  const candidates = buildBotPlayCandidates(g, options);
  const state = buildBotVisibleState(g, seat);
  showAiThinkingIndicator(g, seat);
  let result;
  try{
    result = await callAI(aiProvider, aiApiKey, {
      systemPrompt: buildBotPlaySystemPrompt(g, seat),
      userPrompt: buildBotPlayUserPrompt(state, candidates),
      maxTokens: 200,
    });
  }catch(e){
    // callAI 本身设计上从不 reject(网络/超时/解析错误都被归类进 {ok:false,...} 这个
    // resolve 值),这里只是防御性兜底,理论上不会走到。
    result = { ok:false, reason:'other', detail:String(e) };
  }finally{
    hideAiThinkingIndicator();
  }
  if(!result || !result.ok) return null;
  const idx = parseBotPlayAiChoice(result.text);
  if(idx===null || idx<0 || idx>=candidates.length) return null;
  if(idx===options.length) return 'pass';
  return options[idx];
}

// ================= AI机器人接入第三阶段:接入 botBestTarget(选目标)这个决策点 =================
// 【范围声明】唯一新增的AI决策点是"给已经决定要打出的、需要目标的牌挑一个目标"——不是
// 让 botBestTarget 本身变 async 后塞进 botPlay 枚举阶段的 forEach 里。枚举阶段要给
// options 里每一个候选算 value 才能排序,如果每张需要目标的手牌都在枚举时先问一次AI,
// 会在"到底决定出哪张牌"之前就打出多次AI请求,既偏离第二阶段"一次决策一次AI调用"的
// 既有形状,又没有意义(还没决定要不要打这张牌,选目标的决策没有意义)。
//
// 实现方式:botBestTarget(本地启发式)在枚举阶段完全不变,继续为每个候选算出一个默认
// 目标——这个默认目标就是"没有AI介入/AI失败时"的兜底,和第二阶段"无密钥回归行为完全
// 一致"同一原则,不需要额外的回退计算。等 botPlay 最终决定了 chosen(可能来自AI选牌、
// 也可能来自本地兜底)之后,如果这张牌需要目标且有AI密钥,才调用 tryAiBotBestTarget
// 针对这一张牌单独问一次AI该打谁——问到就用AI的答案覆盖 chosen.target,问不到就保留
// 枚举阶段已经算好的默认值。
//
// buildBotTargetCandidates:候选目标列表只包含真实通过 spec.canTarget 校验的座位(和
// botBestTarget 自己筛选合法目标的判断逐字一致),每一项直接复用 buildBotVisibleState
// 里对应座位已经算好的公开信息投影(seat/name/hp/maxHp/handCount/equips/delays/
// knownRole/general)——和"选牌"AI看到的隐藏信息范围是同一份、同一个函数产出,不重新
// 定义一套可见性规则。
function buildBotTargetCandidates(g, seat, card, actionId){
  const me = g.players[seat];
  const spec = CARD_PLAYS[actionId];
  const state = buildBotVisibleState(g, seat);
  const list = [];
  g.players.forEach((p,i)=>{
    if(!p||!p.alive||i===seat) return;
    if(spec && spec.canTarget && !spec.canTarget(g, me, card, i)) return;
    list.push(Object.assign({ index: list.length }, state.players[i]));
  });
  return list;
}

// BOT_STRATEGY_GUIDANCE_TARGET:第一阶段"通用部分"策略指导,选目标专用。两条来源:
// ①免疫检查提醒——直接对应调研中查到的AI常见错误反面案例"酒黑杀仁王"(黑杀对装备
// 仁王盾/拥有毅重这类"黑杀无效"能力的目标完全不生效,加成/强化这张杀纯属浪费),这类
// 具体规则错误值得专门提醒一句,让AI在选目标前先看一眼候选的公开装备/技能信息。
// ②手牌数量提醒——本地 botTargetScore(bot.js)的评分公式里,体力相关权重合计约
// (maxHp-hp)*8+(4-hp)*7,每点体力差贡献7~8分,而手牌数量只有(hand.length)*2,每张
// 手牌差只贡献2分,两者相差约7.5倍。调研查到的社区经验("没有手牌的人通常很容易死,
// 连反抗的余地都没有")说明手牌枯竭本身就是一个很强的"容易解决"信号,但本地公式对这个
// 维度的权重明显偏低、可能覆盖不足。这里刻意写成引导性描述而非"手牌数比血量更重要"这
// 种硬结论,只是让AI在本地分数接近的边界情况下多一个参考维度,不是要求AI推翻本地启发式
// 算出的顺序——避免二者经常正面对冲。若以后要优化本地公式本身,这条注释里的具体权重
// 数字和调研依据可以直接复用,不需要重新查证。
const BOT_STRATEGY_GUIDANCE_TARGET =
  '选目标前,留意这两点(是判断优先级的参考,不是必须遵守的硬规则):'
  +'先看候选目标当前的公开装备/技能信息,判断这次进攻会不会被直接免疫或化解——例如'
  +'黑色的杀对装备了仁王盾、或拥有"黑色杀无效"类技能的目标完全不生效,这种情况下换个'
  +'目标或换张牌通常更划算,不要平白浪费一次机会。除了看血量,也要留意候选目标的手牌'
  +'数量——手牌枯竭的目标往往比看起来血厚但手牌充足的目标更容易迅速解决,值得作为'
  +'参考维度之一。';

function buildBotTargetSystemPrompt(g, seat){
  return '你在扮演一款网页版三国杀里的AI机器人玩家。你刚决定要使用/打出一张需要指定目标的牌,'
  +'现在需要从候选目标列表里选一名目标——列表每一项是一个座位真实合法可见的公开信息'
  +'(血量、装备、判定区、已知身份;其他角色的手牌你只知道张数,不知道具体是什么牌)。'
  +'你的任务只有一件事:从候选列表里选出一个index,代表这次要指定的目标——不能选择'
  +'列表之外的座位,不能凭空指定目标。'+BOT_STRATEGY_GUIDANCE_TARGET+botIdentityGuidance(g, seat)
  +'请只输出一个严格的JSON对象,格式固定为'
  +'{"choice": 数字},不要输出任何解释文字、代码块标记或多余字段。';
}

function buildBotTargetUserPrompt(state, card, actionId, candidates){
  return '你正在使用【'+actionId+'】(实际打出的牌:'+card.name+')。\n\n'
    +'当前局面:\n'+JSON.stringify(state)
    +'\n\n合法候选目标列表(index从0开始):\n'+JSON.stringify(candidates)
    +'\n\n只返回 {"choice": 数字} 这一个JSON对象。';
}

// tryAiBotBestTarget:和 tryAiBotPlay 同一套结构——返回一个合法座位号、或 null(没有
// 密钥/AI没有正确响应/索引不合法,统一交给调用方保留本地启发式已经算好的默认目标,
// 不重试、不阻塞)。解析直接复用 parseBotPlayAiChoice(两处AI回复都是同一个
// {"choice":N}格式,没必要另写一份)。超时同样直接复用 callAI 自带的机制,不额外包
// 一层——和 tryAiBotPlay 同一个已确认的取舍(见其顶部注释)。
async function tryAiBotBestTarget(g, seat, card, actionId){
  if(typeof aiApiKey==='undefined' || !aiApiKey || !aiProvider) return null;
  const candidates = buildBotTargetCandidates(g, seat, card, actionId);
  if(!candidates.length) return null; // 理论上不会发生:调用方已经确认至少有一个合法目标
  const state = buildBotVisibleState(g, seat);
  showAiThinkingIndicator(g, seat);
  let result;
  try{
    result = await callAI(aiProvider, aiApiKey, {
      systemPrompt: buildBotTargetSystemPrompt(g, seat),
      userPrompt: buildBotTargetUserPrompt(state, card, actionId, candidates),
      maxTokens: 100,
    });
  }catch(e){
    result = { ok:false, reason:'other', detail:String(e) };
  }finally{
    hideAiThinkingIndicator();
  }
  if(!result || !result.ok) return null;
  const idx = parseBotPlayAiChoice(result.text);
  if(idx===null || idx<0 || idx>=candidates.length) return null;
  return candidates[idx].seat;
}

// ================= AI机器人接入第四阶段:guhuoQuestion(于吉【蛊惑】质疑判断) =================
// 【范围声明】这批只接入 guhuoQuestion 一个决策点;ganglieChoice/guicai 留给以后单独的
// 批次分别验证,不在这次任务范围内(见 CLAUDE.md"AI机器人策略指导第四阶段"设计报告的
// 优先级排序)。
//
// 【隐藏信息约束,本次唯一需要新设计的部分,务必做对】d.actualCard(于吉扣置的那张牌的
// 真实内容)是对玩家隐藏的信息——本地启发式(runBotDecision 原有分支)用固定30%概率的
// 随机数模拟不完全信息决策,绝不偷看这张牌;AI决策同样不能看到它。buildBotGuhuoVisibleState
// 从头只构造这个决策真正该看到的字段:局面 state 部分直接复用 buildBotVisibleState——
// 它本身从不涉及 pending/actualCard,复用它不会引入风险;guhuoQuestion 专属的字段是
// 手工逐个挑选加进去的——sourceSeat/sourceName(于吉是谁,公开信息)、claimedCardName
// (于吉声明的内容本身就是公开动作,规则上任何人都能看到"他声称这是什么牌")。整个函数体
// 从第一行到最后一行都没有出现过 d.actualCard 这个引用,不是"先塞进完整视图再删掉这个
// 字段"那种更容易出错的写法(万一漏删就会真的泄露),是结构上从一开始就不可能引用到它。
function buildBotGuhuoVisibleState(g, seat){
  const d = g.pending;
  const state = buildBotVisibleState(g, seat);
  state.guhuo = {
    sourceSeat: d.sourceSeat,
    sourceName: (g.players[d.sourceSeat] && g.players[d.sourceSeat].name) || null,
    claimedCardName: d.claimedCard && d.claimedCard.name,
  };
  return state;
}

// buildBotGuhuoSystemPrompt:独立的、比 BOT_PLAY_SYSTEM_PROMPT 更短的专用 system
// prompt——这是一道二选一的判断题,不需要候选动作列表描述,也不接入身份局四阵营指导
// (纯粹是"这张声明牌可信度"的判断,和阵营博弈无关,按第四阶段设计报告的结论刻意不接)。
// choice 的语义在这里显式约定:choice=1 表示"质疑"(question=true),choice=0 表示
// "不质疑"(question=false)——和 respondGuhuoQuestion(question) 的参数语义直接对应,
// 不需要额外的映射表。
function buildBotGuhuoSystemPrompt(){
  return '你在扮演一款网页版三国杀里的AI机器人玩家。场上一名角色(于吉)刚扣置一张手牌,'
  +'声明它是某张具体的牌,并表示要当那张牌使用——你现在需要判断要不要质疑这个声明。'
  +'若你选择质疑:声明为真,你会获得一个负面效果(【缠怨】,此后永远不能再质疑于吉的'
  +'蛊惑);声明为假,这张牌会直接作废、不产生任何效果。若你选择不质疑:声明为真则'
  +'照常生效,声明为假也没有任何影响。你完全不知道这张牌真实是什么,只能根据这名角色'
  +'的行为倾向、场上局势等信息合理推断这次声明的可信度做出判断。'
  +'请只输出一个严格的JSON对象,格式固定为 {"choice": 数字},其中 1 表示质疑、'
  +'0 表示不质疑,不要输出任何解释文字、代码块标记或多余字段。';
}
function buildBotGuhuoUserPrompt(state){
  return '当前局面:\n'+JSON.stringify(state)
    +'\n\n只返回 {"choice": 数字} 这一个JSON对象,1表示质疑、0表示不质疑。';
}

// tryAiBotGuhuoQuestion:返回布尔值(是否质疑)、或 null(没有密钥/AI没有正确响应/
// choice 不是合法的0或1,统一交给调用方回退到本地启发式,不重试、不阻塞)。
//
// 【mySeat 借用窗口,已核实确认不需要】respondGuhuoQuestion(skills.js)内部对 mySeat
// 的唯一引用是标准的调用者身份守卫(g.pending.asking!==mySeat)和 g.players[mySeat]
// 取值,这两处都由 runBotDecision 现有的 botInvoke(seat,fn) 包装(mySeat=seat;同步
// 执行;立刻归还)正确处理,和其余30多个响应类分支(respondShan/duelResponse等)完全
// 一样——不是 botPlay 枚举阶段那种"需要在调用真正的动作函数之前,先用全局 mySeat 跑一遍
// CARD_PLAYS.canPlay/canTarget 筛出候选"的特殊场景(这个决策是二选一判断题,不涉及任何
// 候选枚举,不读 CARD_PLAYS)。函数内部另有一处 mySeat 的临时切换(runGuhuoAsSource,
// 发生在蛊惑判定为真、真正结算 spec.effect 时),但那是把 mySeat 切到"于吉自己的座位"、
// 且完全内嵌在 respondGuhuoQuestion 触发的同一次同步 tx 调用链里、finally 里会自动切
// 回去——是游戏引擎自身的既有机制,和"谁/怎么触发了 respondGuhuoQuestion"无关,不需要
// 机器人决策层做任何特殊处理。因此这次不需要额外的借用窗口,直接用标准的 botInvoke
// 包装即可。
async function tryAiBotGuhuoQuestion(g, seat){
  if(typeof aiApiKey==='undefined' || !aiApiKey || !aiProvider) return null;
  const state = buildBotGuhuoVisibleState(g, seat);
  showAiThinkingIndicator(g, seat);
  let result;
  try{
    result = await callAI(aiProvider, aiApiKey, {
      systemPrompt: buildBotGuhuoSystemPrompt(),
      userPrompt: buildBotGuhuoUserPrompt(state),
      maxTokens: 50,
    });
  }catch(e){
    result = { ok:false, reason:'other', detail:String(e) };
  }finally{
    hideAiThinkingIndicator();
  }
  if(!result || !result.ok) return null;
  const choice = parseBotPlayAiChoice(result.text);
  if(choice!==0 && choice!==1) return null;
  return choice===1;
}

// ================= AI机器人接入第四阶段第二批:ganglieChoice(夏侯惇【刚烈】弃牌还是
// 受伤) =================
// 【范围声明】这批是第四阶段第二批的第一个,和第一批 guhuoQuestion 同一个"判断题型"
// 决策模式,复用同一套解析/回退/并发保护机制,只新增决策本身的视图构造和 prompt。
// guicai 是第二批的第二个,单独一次commit,不和这次合并。
//
// 【mySeat 借用窗口,已实际核实、不是照抄guhuoQuestion的结论就假设一定适用】读了
// respondGanglieChoice(game.js)的完整函数体:守卫是标准的调用者身份守卫
// (g.pending.sourceSeat!==mySeat),函数体内部只用 g.pending 解出的 seat/sourceSeat/
// resume 这几个局部变量操作 g.players[sourceSeat].hand,从头到尾没有第二处引用
// mySeat,也不调用任何依赖全局 mySeat 的 CARD_PLAYS.canPlay/canTarget——和
// respondGuhuoQuestion 是完全相同的形状(响应者对自己的一次判断,不涉及候选枚举),
// 结论同样是:不需要额外借用窗口,标准 botInvoke(seat,fn) 包装即可正确处理身份守卫。
//
// 【隐藏信息】这个决策的响应者(sourceSeat)判断的是关于他自己的选择(弃自己的手牌还是
// 自己受伤),不涉及需要对他隐藏的信息——但仍然构造专门的 buildBotGanglieVisibleState,
// 不直接把完整的 g/player 对象喂给AI,做法和 buildBotGuhuoVisibleState 一致:复用
// buildBotVisibleState(g,seat)得到的安全投影(已经包含myHand的完整内容——这是这个
// 座位自己的手牌,对他自己公开完全合理),再补一个 ganglie 专属字段:discardIndices——
// 若选择"弃牌",游戏规则固定弃掉 myHand 数组下标0和1这两张(respondGanglieChoice 的
// 本地回退/AI回退都不做选牌,只做"弃牌还是受伤"这个二元判断,选牌维度不在这次范围内),
// 让AI能直接对着 myHand[0]/myHand[1] 判断这两张具体的牌值不值得留,而不是凭空猜测
// "弃牌"这个选项到底会弃掉哪两张。
function buildBotGanglieVisibleState(g, seat){
  const state = buildBotVisibleState(g, seat);
  state.ganglie = {
    hpIfDamaged: state.myHp - 1,
    discardIndices: state.myHand.length>=2 ? [0,1] : [],
  };
  return state;
}

// BOT_GANGLIE_SYSTEM_PROMPT:choice=1 表示"弃牌"(discard),choice=0 表示"受伤"
// (damage)——respondGanglieChoice(action,picks) 的 action 参数直接对应
// ('discard'/'damage'),不需要额外映射表。直接引用第一阶段"通用部分"里已经写好的
// "1点体力≈2张手牌"这句价值判断(和调研阶段的结论一致:这条经验本身就足够覆盖大部分
// 场景,不需要另起一套框架),再补一句提醒AI同时评估"这两张即将被弃掉的牌具体值不值得
// 留"和"当前体力安全边际"——这两个维度是本地固定启发式(总是选弃牌,只要手牌够两张)
// 完全没有考虑的,正是调研阶段指出的、AI能比机械规则做得更好的地方。
function buildBotGanglieSystemPrompt(){
  return '你在扮演一款网页版三国杀里的AI机器人玩家。你(被夏侯惇【刚烈】判定命中后需要'
  +'做选择的伤害来源)现在需要在两个选项里选一个:弃置手牌中两张具体的牌(不能挑,固定'
  +'弃掉局面里 myHand 数组下标0和1对应的那两张,已在局面数据的 ganglie.discardIndices'
  +'里标出),或者受到1点伤害。判断依据可以参考:1点体力大致相当于2张手牌的价值,可以据此'
  +'判断值不值得为了保命搭上这两张牌——但这不是唯一维度,还要具体看这两张即将被弃掉的牌'
  +'本身值不值得留(是不是杀/闪/桃/装备/关键锦囊这类高价值牌),以及你当前的体力安全'
  +'边际(血量已经很低、手里又缺桃这类救命牌时,即使多花两张牌也应该优先保留体力;血量'
  +'充裕、这两张牌明显有用时,选择受伤反而更划算)。'
  +'请只输出一个严格的JSON对象,格式固定为 {"choice": 数字},其中 1 表示弃牌、'
  +'0 表示受到伤害,不要输出任何解释文字、代码块标记或多余字段。';
}
function buildBotGanglieUserPrompt(state){
  return '当前局面:\n'+JSON.stringify(state)
    +'\n\n只返回 {"choice": 数字} 这一个JSON对象,1表示弃牌、0表示受伤。';
}

// tryAiBotGanglieChoice:返回布尔值(true=弃牌/false=受伤)、或 null(没有密钥/AI没有
// 正确响应/choice不是合法的0或1,统一交给调用方回退到本地启发式)。结构和
// tryAiBotGuhuoQuestion 逐字对应,复用同一套 parseBotPlayAiChoice/showAiThinkingIndicator/
// callAI超时机制,不重复设计。
async function tryAiBotGanglieChoice(g, seat){
  if(typeof aiApiKey==='undefined' || !aiApiKey || !aiProvider) return null;
  const state = buildBotGanglieVisibleState(g, seat);
  showAiThinkingIndicator(g, seat);
  let result;
  try{
    result = await callAI(aiProvider, aiApiKey, {
      systemPrompt: buildBotGanglieSystemPrompt(),
      userPrompt: buildBotGanglieUserPrompt(state),
      maxTokens: 80,
    });
  }catch(e){
    result = { ok:false, reason:'other', detail:String(e) };
  }finally{
    hideAiThinkingIndicator();
  }
  if(!result || !result.ok) return null;
  const choice = parseBotPlayAiChoice(result.text);
  if(choice!==0 && choice!==1) return null;
  return choice===1;
}

async function botPlay(g,seat){
  // CARD_PLAYS 的合法性函数沿用旧架构，会读取全局 mySeat；评估阶段也必须切到机器人
  // 视角，不能只在最后真正提交动作时才切。
  const humanSeat=mySeat;
  mySeat=seat;
  let options;
  try{
    const me=g.players[seat];
    options=[];
    (me.hand||[]).forEach((card,idx)=>{
      const action=botActionId(card),spec=CARD_PLAYS[action];
      if(!spec||action==='借刀杀人'||action==='铁索连环'||action==='闪电') return;
      if(!spec.canPlay(g,me,card)) return;
      // 忠臣不主动使用会伤到主公的群体牌。
      if(me.role==='zhong'&&(action==='南蛮入侵'||action==='万箭齐发')) return;
      let target=null;
      if(spec.target){
        target=botBestTarget(g,seat,card,action);
        if(target<0) return;
      }
      let value=botCardPriority(action);
      if(action==='桃'&&me.hp>=me.maxHp) return;
      if(target!==null) value+=botTargetScore(g,seat,target,action);
      options.push({idx,action,target,value});
    });
    options.sort((a,b)=>b.value-a.value);
  } finally {
    // 【正确性要点,不是可选优化】枚举阶段(需要 mySeat=seat 供 CARD_PLAYS 的
    // canPlay/canTarget 读取)到此结束就立刻交还 mySeat,不能跨越接下来可能出现的
    // AI 网络等待(最长约15秒,见 tryAiBotPlay 顶部注释)——mySeat 是全局的、瞬时的
    // "当前视角",如果在 await 期间继续占着它,这段等待期间真人一切读取 mySeat 的
    // 操作(渲染/点击)都会被误判成机器人自己的座位。这是把 botPlay 从同步改成 async
    // 之后必须处理的正确性问题:改动前 mySeat 的借用窗口和整个函数体一样短(纯同步、
    // 微秒级);改动后如果不提前归还,借用窗口会被 AI 等待拉长到最多15秒,足以让真人
    // 在这段时间内的任何交互读到错误的座位号。
    mySeat=humanSeat;
  }

  // aiReady 只算一次,card选择/target选择两处AI决策共用同一个判断,不重复写三遍
  // 同一个条件表达式。
  const aiReady = typeof aiApiKey!=='undefined' && aiApiKey && aiProvider;

  let chosen=null;
  if(aiReady){
    chosen = await tryAiBotPlay(g, seat, options);
  }
  if(chosen===null){
    // 与改动前逐字一致的本地启发式——没有密钥、AI没有正确响应(网络/超时/解析失败/
    // 索引越权)全部落到这里,是同一条兜底路径,不单独区分失败原因(第一阶段方案确认
    // 的原则)。没有密钥这一支和改动前行为完全相同,是这次改动的回归基线。
    if(options.length && options[0].value>25) chosen = options[0];
    else chosen = 'pass';
  }

  // 【第三阶段新增】chosen 需要目标、且有AI密钥时,针对这一张已经确定要打出的牌单独
  // 问一次AI该指定谁为目标——这是"决定出什么牌"之后紧接着的第二个、独立的AI决策,不是
  // 提前塞进上面的枚举阶段。mySeat 此刻已经在上面枚举阶段的 finally 里还给真人了,这里
  // 完全没有再碰 mySeat——buildBotTargetCandidates/buildBotVisibleState/
  // tryAiBotBestTarget 全部只读 g/seat 参数,不依赖也不修改 mySeat,这段AI等待期间
  // mySeat 全程保持人类自己的座位。这不是"重新实现"第二阶段那套mySeat窗口处理方式,
  // 是天然沿用——这段新代码从头到尾没有任何一行触碰 mySeat,自然不会重新踩那个坑。
  // AI选中的目标为 null(没有密钥/AI失败/索引越权)时,chosen.target 保留 botBestTarget
  // 在枚举阶段已经算好的本地默认目标,不需要额外的回退计算。
  if(aiReady && chosen!=='pass' && CARD_PLAYS[chosen.action] && CARD_PLAYS[chosen.action].target){
    const me = g.players[seat];
    const card = me.hand[chosen.idx];
    const aiTarget = await tryAiBotBestTarget(g, seat, card, chosen.action);
    if(aiTarget!==null) chosen.target = aiTarget;
  }

  // 真正执行决策的这一刻,再借用一次 mySeat——botInvoke 本身就是"借用→同步执行→立刻
  // 归还"这套既有写法(见文件前面 botInvoke 的定义),不会跨越任何 await,和改动前的
  // 借用窗口性质完全相同。
  if(chosen==='pass') botInvoke(seat, endPlay);
  else botInvoke(seat, ()=>playCard(chosen.idx, chosen.action, chosen.target));
}
// 机器人"此刻能不能打出【杀】"的统一判断。手里有没有杀是一回事,规则允不允许是另一回事 ——
// 曹彰【将驰】选项1 期间服务端 respondJiedao/duelResponse/aoeRespond 都会一上来就
// if(jiangchiNoSlash) return g 原地拒绝,而机器人是无状态重算的:盲答"用杀"会被拒 → 状态不变
// → 下次醒来重算得到同样结论 → 永久死循环(真人能改点别的选项逃出来,机器人不会改主意)。
// 【通用要求】新增任何"要不要打出某张牌"的决策分支时,都要先问一句"服务端除了牌够不够,
// 还有没有别的前置条件会拒绝我" —— 照 pick 分支"先探测实际可选项、再决定答什么"的写法,
// 不要盲答。
function canBotPlaySha(p){
  return !!p && !p.jiangchiNoSlash;
}
// 机器人"此刻能不能用桃救这个濒死者"的统一判断(respond 的 noShan、这里的贾诩【完杀】,
// 都是同一类"决策先探测服务端再决定"的实例,见上面 canBotPlaySha 那段注释——不要每次
// 重新论证,直接照这个范式补)。逐字对照 respondDying 服务端那段"辅诩【完杀】"检查写的,
// 不是简化版:完杀生效期间(g.wanshaActive 且濒死者正是 g.wanshaDyingSeat)、且贾诩本人
// 正在其回合内(findPlayerWithCap 找到的贾诩座位===g.turn)时,只有贾诩自己或濒死者本人
// 能用桃,其余人一律不能——盲答"能救"会被服务端原地拒绝、状态不变,永久死循环。
function canBotUseTaoForDying(g, seat, dyingSeat){
  if(!(g.wanshaActive && g.wanshaDyingSeat===dyingSeat)) return true;
  const jiaxuSeat = findPlayerWithCap(g, 'wansha');
  if(jiaxuSeat===null || jiaxuSeat!==g.turn) return true;
  return seat===jiaxuSeat || seat===dyingSeat;
}
function botCanSave(g,seat,dyingSeat){
  const me=g.players[seat], dying=g.players[dyingSeat];
  if(seat===dyingSeat) return true;
  if(me.role==='zhong') return dying.role==='zhu'||(dying.roleRevealed&&dying.role==='zhong');
  if(me.role==='zhu') return dying.roleRevealed&&dying.role==='zhong';
  if(me.role==='fan') return dying.roleRevealed&&dying.role==='fan';
  if(me.role==='nei') return dying.role==='zhu'&&dying.hp<=0;
  return false;
}
function botPickGeneral(g,seat,lordPick){
  const p=g.players[seat], choices=(p.generalChoices||[]).filter(id=>GENERALS[id]);
  if(!choices.length) return;
  const score=id=>{
    const gen=GENERALS[id], text=(gen.skill||'')+(gen.desc||'');
    return generalMaxHp(id)*12+
      (/回复|摸.*牌|防止|免疫|闪/.test(text)?16:0)+
      (/伤害|杀|弃置/.test(text)?10:0)+(lordPick&&/主公|回复|防止/.test(text)?20:0);
  };
  choices.sort((a,b)=>score(b)-score(a));
  botInvoke(seat,()=>lordPick?respondPickLordGeneral(choices[0]):respondPickGeneral(choices[0]));
}
function botSafePrompt(g,seat){
  // 使用现有 UI 的“拒绝/取消/跳过”按钮作为未知技能的防卡兜底。它只点击会立即提交的
  // 保守按钮，不尝试驱动需要多步本地选牌的发动流程。
  const real=document.getElementById('controls');
  if(!real) return false;
  const oldId=real.id; real.id='human-controls';
  const box=document.createElement('div'); box.id='controls'; box.style.display='none';
  document.body.appendChild(box);
  const humanSeat=mySeat; mySeat=seat;
  try{
    renderControls(g);
    const buttons=[...box.querySelectorAll('button:not(:disabled)')];
    const safe=buttons.find(b=>/不发动|不使用|不出|取消|跳过|放弃|结束/.test(b.textContent||''));
    const mandatory=buttons.find(b=>!/发动/.test(b.textContent||'')&&/选择|交给|弃置|摸牌|回复|打出/.test(b.textContent||''));
    const chosen=safe||mandatory||(buttons.length===1?buttons[0]:null);
    if(chosen){ chosen.click(); return true; }
  } catch(e) {
    console.warn('bot fallback',e);
  } finally {
    mySeat=humanSeat; box.remove(); real.id=oldId;
    if(typeof currentG!=='undefined'&&currentG) renderControls(currentG);
  }
  return false;
}
// 【async 的唯一理由】这个函数的绝大多数分支(respond/aoeResp/duel/dying/…30+个)全部
// 保持同步不变——只有 g.phase==='play' 这一条分支需要 await botPlay(g,seat)。botPlay
// 内部可能因为AI调用而异步等待,且可能连续等待两次(先问"出什么牌",牌需要目标时再问
// "打给谁",见 tryAiBotPlay/tryAiBotBestTarget 的注释)——这两次AI调用都完整嵌套在这
// 一次 await botPlay(g,seat) 里,不需要在这里(runBotDecision)单独再 await 一次
// botBestTarget,那不是它现在的调用形状。async function 包裹一段同步代码不影响其行为
// (相当于自动包一层 resolved promise),所以其它分支原样照抄、零改动。
async function runBotDecision(g,seat){
  const p=g.players[seat];
  if(!p||!p.isBot||!p.alive&&g.phase!=='pickingGeneral') return;
  const d=g.pending||{};
  if(g.phase==='pickingLordGeneral'){ botPickGeneral(g,seat,true); return; }
  if(g.phase==='pickingGeneral'){ botPickGeneral(g,seat,false); return; }
  if(g.phase==='huashenPick'&&d.seat===seat){
    const generalId=(p.huashenPool||[]).find(id=>(HUASHEN_SKILL_TABLE[id]||[]).length);
    const entry=generalId&&(HUASHEN_SKILL_TABLE[generalId]||[])[0];
    if(entry) botInvoke(seat,()=>respondHuashenPick(generalId,entry.name));
    return;
  }
  if(g.phase==='guanxingReview'&&d.seat===seat){
    const order=(d.cards||[]).map((_,i)=>i);
    botInvoke(seat,()=>respondGuanxing(order,[])); return;
  }
  if(g.phase==='xunxunPick'&&d.seat===seat){
    const all=(d.cards||[]).map((_,i)=>i),take=d.takeN||2;
    botInvoke(seat,()=>respondXunxun(all.slice(0,take),all.slice(take))); return;
  }
  if(g.phase==='draw'&&g.turn===seat){ botInvoke(seat,doDraw); return; }
  if(g.phase==='play'&&g.turn===seat){ await botPlay(g,seat); return; }
  if(g.phase==='discard'&&g.turn===seat){
    const need=Math.max(0,(p.hand||[]).length-p.hp);
    if(need>0) botInvoke(seat,()=>discardCards([...Array(need).keys()].map(i=>p.hand.length-1-i)));
    else botInvoke(seat,endTurn);
    return;
  }
  if(g.phase==='respond'&&d.to===seat){
    // 不能只看"手里有没有能当闪的牌":马超【铁骑】判红/黄忠【烈弓】触发时 d.noShan===true,
    // 这张杀不可被闪抵消,respondShan 服务端一上来就 if(g.pending.noShan) return g 原地拒绝。
    // 盲答"出闪"会被拒、状态不变,机器人下次醒来重算又是同样结论,永久死循环。
    botInvoke(seat,()=>respondShan(!d.noShan && findUsableAs(p.hand,p,'闪')>=0));
    return;
  }
  if(g.phase==='aoeResp'&&d.to===seat){
    // need==='杀'(南蛮入侵)时同样受【将驰】限制,服务端 aoeRespond 会拒;need==='闪'
    // (万箭齐发)不受影响,所以只在需要杀时才加这道判断。
    const canRespond = (d.need==='杀' ? canBotPlaySha(p) : true) && findUsableAs(p.hand,p,d.need)>=0;
    botInvoke(seat,()=>aoeRespond(canRespond));
    return;
  }
  if(g.phase==='duel'&&d.active===seat){
    // 不能只看"手里有没有杀":曹彰【将驰】选项1 期间服务端 duelResponse 一上来就
    // if(me.jiangchiNoSlash) return g —— 盲答 true 会被原地拒绝、状态不变,机器人下次
    // 醒来重算又得到同样结论,永久死循环。仿 pick 分支"先探测实际可选项再决定"。
    botInvoke(seat,()=>duelResponse(canBotPlaySha(p) && findUsableAs(p.hand,p,'杀')>=0));
    return;
  }
  if(g.phase==='dying'&&d.asking===seat){
    const save=botCanSave(g,seat,d.seat)&&canBotUseTaoForDying(g,seat,d.seat)&&findUsableAs(p.hand,p,'桃')>=0;
    botInvoke(seat,()=>respondDying(save));
    return;
  }
  if(g.phase==='wuxie'&&d.asking===seat){ botInvoke(seat,()=>respondWuxie(false)); return; }
  if(g.phase==='wugu'&&d.type==='wugu'&&Array.isArray(d.order)&&d.order[d.idx||0]===seat&&Array.isArray(d.pool)&&d.pool.length){
    // expectedIdx 是乐观并发校验("我看到的时候轮到第几个人挑"),必须传当前真实的
    // d.idx。曾经硬编码成 0,于是只要机器人不是五谷丰登的第一个挑牌人,服务端的
    // idx!==expectedIdx 就会静默 return、什么都不做 —— 挑牌轮次卡在这里再也不动。
    botInvoke(seat,()=>wuguPick(0,d.idx||0,d.pool[0]&&d.pool[0].id)); return;
  }
  if(g.phase==='tieqi'&&d.from===seat){ botInvoke(seat,()=>respondTieqi(true)); return; }
  if(g.phase==='liegong'&&d.from===seat){ botInvoke(seat,()=>respondLiegong(true)); return; }
  if(g.phase==='duanbingChoose'&&d.sourceSeat===seat){
    const targets=(d.availableTargets||[]).slice().sort((a,b)=>botTargetScore(g,seat,b,'damage')-botTargetScore(g,seat,a,'damage'));
    if(targets.length&&botTargetScore(g,seat,targets[0],'damage')>-Infinity) botInvoke(seat,()=>triggerDuanbing(targets[0]));
    else botInvoke(seat,cancelDuanbing);
    return;
  }
  if(g.phase==='huogongReveal'&&d.to===seat){ botInvoke(seat,()=>respondHuogongReveal(0)); return; }
  if(g.phase==='huogong'&&d.from===seat){ botInvoke(seat,()=>respondHuogong(false)); return; }
  if(g.phase==='pick'&&d.from===seat){
    const target=g.players[d.to];
    let choice='hand';
    if(!(target.hand||[]).length){
      choice=EQUIP_SLOTS.find(s=>target.equips&&target.equips[s]);
      if(!choice&&Array.isArray(target.delays)&&target.delays.length) choice='delay:0';
    }
    if(choice) botInvoke(seat,()=>pickResolve(choice));
    return;
  }
  if(g.phase==='qilin'&&d.from===seat){
    const target=g.players[d.to];
    const slot=['plus1','minus1'].find(s=>target&&target.equips&&target.equips[s]);
    if(slot) botInvoke(seat,()=>qilinResolve(slot));
    return;
  }
  if(g.phase==='hanbing'&&d.from===seat){
    const target=g.players[d.to];
    const choice=(target.hand||[]).length?'hand':EQUIP_SLOTS.find(s=>target.equips&&target.equips[s]);
    if(choice) botInvoke(seat,()=>hanbingPick(choice));
    return;
  }
  if(g.phase==='mengjin'&&d.from===seat){
    const choice=(d.available||[])[0];
    if(choice) botInvoke(seat,()=>mengjinPick(choice));
    return;
  }
  if(g.phase==='shaOffsetChoice'&&d.from===seat){
    botInvoke(seat,()=>respondShaOffsetChoice((d.available||[])[0]||null)); return;
  }
  if(g.phase==='jiedaoChoice'&&d.seatA===seat){
    // 同上:【将驰】期间不能出杀,只能选"交出武器"。答 false 会走弃武器分支,流程正常收尾。
    botInvoke(seat,()=>respondJiedao(canBotPlaySha(p) && findUsableAs(p.hand,p,'杀')>=0)); return;
  }
  if(g.phase==='guicai'&&d.asking===seat){ botInvoke(seat,()=>respondGuicai(false)); return; }
  if(g.phase==='fanjianSuit'&&d.targetSeat===seat){
    const suits=['♠','♥','♣','♦'];
    botInvoke(seat,()=>respondFanjianSuit(suits[Math.floor(Math.random()*suits.length)])); return;
  }
  if(g.phase==='quhuRespond'&&d.targetSeat===seat){
    botInvoke(seat,()=>respondQuhu(0)); return;
  }
  if(g.phase==='tianyiRespond'&&d.targetSeat===seat){
    botInvoke(seat,()=>respondTianyi(0)); return;
  }
  if(g.phase==='enyuanChoose'&&d.damagerSeat===seat){
    botInvoke(seat,triggerEnyuan); return;
  }
  if(g.phase==='enyuanChooseOption'&&d.damagerSeat===seat){
    botInvoke(seat,()=>chooseEnyuanOption((p.hand||[]).some(c=>c.suit==='♥')?'giveCard':'loseHp')); return;
  }
  if(g.phase==='enyuanGiveCard'&&d.damagerSeat===seat){
    const heart=(p.hand||[]).findIndex(c=>c.suit==='♥');
    botInvoke(seat,()=>giveEnyuanCard(heart)); return;
  }
  if(g.phase==='ganglieChoice'&&d.sourceSeat===seat){
    // 夏侯惇【刚烈】:弃两张手牌还是受1点伤害是资源取舍判断,不是纯机械规则。AI优先、
    // 回退本地——有密钥时先问AI(隐藏信息处理/mySeat窗口/合法性校验均见
    // tryAiBotGanglieChoice 顶部注释,第四阶段第二批第一个);没有密钥、或AI没有给出
    // 合法答案(网络/超时/解析失败/choice不是0或1)时,回退到原有的本地启发式——手牌够
    // 两张就弃牌,不够就只能受伤(这个分支实际总是手牌>=2,finishGanglieJudge在手牌不足2
    // 时会直接跳过这个pending自动结算伤害)。没有密钥这一支和改动前行为完全相同,是这次
    // 改动的回归基线。
    let discard = null;
    if(typeof aiApiKey!=='undefined' && aiApiKey && aiProvider){
      discard = await tryAiBotGanglieChoice(g, seat);
    }
    if(discard===null) discard = (p.hand||[]).length>=2;
    const picks = discard ? [0,1] : [];
    botInvoke(seat,()=>respondGanglieChoice(discard?'discard':'damage',picks)); return;
  }
  // ---- 机器人兜底词汇盲区修复(问题3+4):以下几个phase的按钮文案够不到botSafePrompt的
  // 正则,分两类处理——纯流程性的(选哪个都不影响游戏走向)给合理默认;guhuoQuestion真的
  // 有策略含义,用不偷看隐藏信息的随机决策,不是随便点安全按钮。----
  if(g.phase==='luoyingAsk'&&d.seat===seat){
    // 曹植【落英】:白拿弃牌堆里的梅花牌,没有下行风险,合理默认是总是获得。
    botInvoke(seat,()=>respondLuoying(true)); return;
  }
  if(g.phase==='luoshen'&&d.seat===seat){
    // 甄姬【洛神】:循环判定,黑色继续拿牌、红色才结束,没有下行风险,合理默认是总是尝试
    // 发动(反正判红也只是这个技能结束,不会有额外损失)。
    botInvoke(seat,()=>respondLuoshen(true)); return;
  }
  if(g.phase==='huashenChangeAskStart'&&d.seat===seat){
    // 左慈【化身】回合开始阶段"是否更改借用的技能":要不要换需要评估全局局势,超出"合理
    // 默认"的范畴——安全默认是不更改,维持现状,不做任何越权评估。
    botInvoke(seat,()=>respondHuashenChangeAskStart(false)); return;
  }
  if(g.phase==='huashenChangeAskEnd'&&d.seat===seat){
    // 同上,回合结束阶段的同一个决策,同一个安全默认。
    botInvoke(seat,()=>respondHuashenChangeAskEnd(false)); return;
  }
  if(g.phase==='guhuoQuestion'&&d.asking===seat){
    // 于吉【蛊惑】质疑与否是真正的判断题(质疑真的会被扣【缠怨】、质疑假的能让蛊惑作废)。
    // AI优先、回退本地——有密钥时先问AI(隐藏信息保护/mySeat窗口/合法性校验均见
    // tryAiBotGuhuoQuestion 顶部注释,第四阶段第一批接入,详见 CLAUDE.md);没有密钥、
    // 或AI没有给出合法答案(网络/超时/解析失败/choice不是0或1)时,回退到原有的本地
    // 启发式——机器人不能偷看 d.actualCard,真人也是在不知道真实牌的情况下博弈,固定
    // 概率的随机数模拟同等的不完全信息决策,和 respondFanjianSuit 随机猜花色是同一
    // 处理原则,不是"瞎选"而是"信息对称前提下的合理默认"。没有密钥这一支和改动前行为
    // 完全相同,是这次改动的回归基线。
    let question = null;
    if(typeof aiApiKey!=='undefined' && aiApiKey && aiProvider){
      question = await tryAiBotGuhuoQuestion(g, seat);
    }
    if(question===null) question = Math.random()<0.3;
    botInvoke(seat,()=>respondGuhuoQuestion(question)); return;
  }
  if(g.phase==='qiaobianMove'&&d.seat===seat){
    // 张郃【巧变】跳过出牌阶段后"是否移动一张装备/判定牌":真人走的是"选来源+选目的地"
    // 纯客户端本地选牌流程,机器人不需要走这套UI,直接调用服务端函数决定"不移动"——弃牌+
    // 跳过阶段这个效果本身已经生效,不移动不影响这个前提,不需要评估移动哪张牌对谁更有利。
    botInvoke(seat,()=>respondQiaobianMove(null)); return;
  }
  if(botSafePrompt(g,seat)) return;
  console.warn('机器人暂未覆盖阶段',g.phase,d.type,seat);
}
