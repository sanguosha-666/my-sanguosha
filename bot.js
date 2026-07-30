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

// ================= AI机器人接入第二阶段:仅接入 botPlay 这一个决策点 =================
// 【范围声明】只有 botPlay(出什么牌)这一个决策点接入AI,botBestTarget(选目标)本次
// 不动,留给第三阶段——先在一个决策点上验证完整链路(AI调用→合法性校验→超时/失败
// 兜底→回退本地逻辑)稳固可靠,再扩展到下一个。ai-bot.js 的 callAI/PROVIDER_ADAPTERS
// 等基础设施本阶段确认不需要改动,直接复用第一阶段已完成的成果。

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

const BOT_PLAY_SYSTEM_PROMPT =
  '你在扮演一款网页版三国杀里的AI机器人玩家,当前轮到你的出牌阶段。你会收到:'
  +'①你视角下真实合法可见的局面(自己的手牌与身份完全可见;其他角色只有公开信息——'
  +'血量、装备、判定区、已知身份,手牌只知道张数、不知道具体是什么牌);'
  +'②一份已经按游戏规则筛选好的合法候选动作列表(localHeuristicScore是一个简单的'
  +'启发式参考分,仅供参考、不代表最优解),列表最后一项固定是"结束出牌阶段"。'
  +'你的任务只有一件事:从候选列表里选出一个index,代表这次要执行的动作——'
  +'不能选择列表之外的动作,不能凭空发明新选项,不需要也不能指定目标(目标已经在候选'
  +'列表里算好了)。请只输出一个严格的JSON对象,格式固定为 {"choice": 数字},'
  +'不要输出任何解释文字、代码块标记或多余字段。';

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
      systemPrompt: BOT_PLAY_SYSTEM_PROMPT,
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

  let chosen=null;
  if(typeof aiApiKey!=='undefined' && aiApiKey && aiProvider){
    chosen = await tryAiBotPlay(g, seat, options);
  }
  if(chosen===null){
    // 与改动前逐字一致的本地启发式——没有密钥、AI没有正确响应(网络/超时/解析失败/
    // 索引越权)全部落到这里,是同一条兜底路径,不单独区分失败原因(第一阶段方案确认
    // 的原则)。没有密钥这一支和改动前行为完全相同,是这次改动的回归基线。
    if(options.length && options[0].value>25) chosen = options[0];
    else chosen = 'pass';
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
// 保持同步不变——只有 g.phase==='play' 这一条分支需要 await botPlay(g,seat)(botPlay
// 内部可能因为AI调用而异步等待,见上面 tryAiBotPlay 的注释)。async function 包裹一段
// 同步代码不影响其行为(相当于自动包一层 resolved promise),所以其它分支原样照抄、
// 零改动。
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
    const picks=(p.hand||[]).length>=2?[0,1]:[];
    botInvoke(seat,()=>respondGanglieChoice(picks.length===2?'discard':'damage',picks)); return;
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
    // 于吉【蛊惑】质疑与否是真正的判断题(质疑真的会被扣【缠怨】、质疑假的能让蛊惑作废),
    // 但机器人不能偷看 d.actualCard——那是对玩家隐藏的信息,拿它来决策就是作弊。真人也是
    // 在不知道真实牌的情况下博弈,这里用固定概率的随机数模拟同等的不完全信息决策,和
    // respondFanjianSuit随机猜花色是同一处理原则,不是"瞎选"而是"信息对称前提下的合理
    // 默认"。
    botInvoke(seat,()=>respondGuhuoQuestion(Math.random()<0.3)); return;
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
