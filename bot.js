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
// botMissedSchedule:修复"botDecisionInFlight期间的调度请求被静默丢弃、永久卡死"这个
// 真实bug(真实dump复现过:郭嘉的guicai决策AI调用还没resolve期间,另一次无懈可击链式
// 询问轮到郭嘉,scheduleBotTurn 在124行直接return丢弃这次请求,不记录、不重试;
// botDecisionInFlight清零后没有任何机制补上这次机会,除非之后又有别的无关事件恰好
// 触发一次render(g),否则游戏永久卡死——这不是guicai特有的,用botPlay同样能复现,是
// Phase2引入botDecisionInFlight时就存在的架构缺口,只是Phase4新增的三个"由其它玩家
// 操作触发、可能命中旁观机器人"的决策点显著放大了真实触发概率)。
// 只在"因为botDecisionInFlight为true而被丢弃、且这次被丢的状态和当前正在进行中的那个
// 决策不是同一份"这种情况下才置真——!g/非机器人控制端/游戏结束/没有座位需要行动/同一个
// key已经在debounce队列里 这几种情况都是"本来就没事可做"或"已经有等价请求在排队",不是
// "漏掉了一次本该处理的机会",不应该触发重查。"和当前决策是不是同一份状态"这条判断是
// 必需的,不是可选的精细化——第一版实现漏了这一层,导致既有回归测试(test_bot_ai_playbook.js
// "端到端:选牌+选目标两次AI等待期间"那条)变红:那条测试专门验证"AI调用还没回应期间,
// 重复触发scheduleBotTurn(状态完全没变)不应该产生额外callAI调用",这本身是完全合理的
// 既有场景(Firebase的重复回声/无实质变化的重渲染,真实场景里会发生)——如果不加这层
// 区分,清零后的补查会把这类"重复的、状态没变的丢弃"也当成"漏掉的机会"重新处理一遍,
// 对同一份已经处理完的状态再决策一次,产生多余的AI调用甚至重复的动作提交。
// botScheduledKey 正是"当前正在进行中的这个决策对应的key"——从这个决策被 setTimeout
// 调度那一刻起,到它真正resolve、finally里清零botDecisionInFlight之前,不会被别的调用
// 覆盖(scheduleBotTurn只有在botDecisionInFlight为false时才会走到重新赋值这一行),
// 天然可以拿来判断"这次被丢的请求,和正在进行中的是不是同一回事"。
// scheduleBotTurn 本身是"读当前g、判断该轮到谁"的无状态判断,清零后不需要记住"当时具体
// 丢的是哪次请求",只需要知道"该拿最新状态再检查一次"——用 currentG(render(g) 函数体
// 第一行就会更新,早于调用 scheduleBotTurn,所以清零这一刻读到的必然是最新真相)重新调用
// scheduleBotTurn 自己即可自愈,不需要为多次丢弃分别记录/重放。
let botMissedSchedule=false;
function scheduleBotTurn(g){
  if(!g || !isBotController(g) || g.phase==='over') return;
  if(botDecisionInFlight){
    const droppedSeat=botSeatForState(g);
    if(droppedSeat>=0 || botFallbackSeats(g).length){
      const droppedKey=botStateKey(g,droppedSeat);
      if(droppedKey!==botScheduledKey) botMissedSchedule=true;
    }
    return;
  }
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
      // 补检查:期间有调度请求被丢弃过,现在标志位已清零,用最新的 currentG 重新跑一遍
      // scheduleBotTurn 自己——它会自己判断"当前到底该谁行动",不需要外部传入具体信息。
      // 这一步是同步调用(不用 setTimeout(fn,0) 延迟):scheduleBotTurn 本身极轻(只做
      // 字段比较+最多设置一个定时器),真正的重活(runBotDecision)永远要再等一次
      // 650~1150ms 的debounce才会执行,不存在"同步递归导致调用栈爆炸"或"抢占式执行"的
      // 风险;currentG 在这一刻必然是最新的(render(g)把 currentG=g 放在函数体第一行,
      // 早于调用 scheduleBotTurn,不存在"还没更新完"的竞态)。用 try/catch 包一层,和
      // render.js 里"渲染与机器人调度双向隔离"的既有写法同一原则,避免这次补查自身出
      // 意外时把外层 finally 搞崩。
      if(botMissedSchedule){
        botMissedSchedule=false;
        try{ scheduleBotTurn(typeof currentG!=='undefined'?currentG:null); }
        catch(e){ console.warn('bot missed-schedule recheck',e); }
      }
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

// botSuspicionHint:身份局AI选目标/出牌决策的第一层(信息层)——把本地既有的
// aiRebelSuspicion嫌疑值机制(botSuspicion,详见其定义处的注释)转成AI能读的分档
// 描述性文本,不给裸数值。【不是新的隐藏信息接口,是把机器人已有的公开信息读能力
// 补给AI】——recordBotDamageEvidence/recordBotRescueEvidence(game.js里dealDamage/
// 救援响应路径调用)的每一条delta判断分支,输入全部是结构性公开信息:"谁对谁造成了
// 伤害"(dealDamage本身会产生公开日志)、"目标是不是主公"(身份局里主公从开局起就是
// 明牌)、"目标身份是否已翻开"(roleRevealed,和UI的canSeeRole同一套公开性规则)——
// 没有一个分支读取任何只有机器人内部才知道的私有状态。所以aiRebelSuspicion是纯粹
// 由公开事件推导出的聚合值,任何真人玩家盯着日志心算理论上能算出同一个数,这和
// buildBotVisibleState"结构上只投影真实可见信息"的既有安全原则完全兼容,不是新开
// 的口子。裸数值不给的原因:-100~100是内部实现刻度(45/24/-28/-50/25这几个和阈值
// 绑定的魔数),AI拿到一个孤立的数字不知道怎么校准,分档文本更符合"引导性描述、非
// 机械阈值判断"这条既有措辞原则。阈值30/60按现有delta量级校准:单次典型事件
// (24~50)落进"一定"档,两次以上复合(48~100+)落进"较强"档,不是拍脑袋定的。
// 只描述方向+强度,不编造具体事件次数/细节——机制本身只有累加后的最终值,没有保留
// 离散事件记录,编造"三次攻击"这类具体次数是虚构信息,不诚实。
// 返回 undefined(不是 null)是刻意的:JSON.stringify 会跳过值为 undefined 的键,
// 非身份局/证据不足时这个字段在发给AI的prompt里完全不出现,不占篇幅、不用"无证据"
// 这类空话填充每一条候选。
function botSuspicionHint(g, targetSeat){
  if(!g || g.gameMode!=='identity') return undefined;
  const s = botSuspicion(g, targetSeat);
  if(s>=60) return '公开行为显示出较强的反贼嫌疑';
  if(s>=30) return '公开行为显示出一定的反贼嫌疑';
  if(s<=-60) return '公开行为显示出较强的偏向忠于主公一方的倾向,反贼嫌疑很低';
  if(s<=-30) return '公开行为显示出一定的偏向忠于主公一方的倾向,反贼嫌疑较低';
  return undefined;
}
// isFirstTurn 参数保留仅为向后兼容(历史调用方可能传第三参),本函数不再依赖它:
// 武将技能/描述是公开信息(座位卡上人人可见),任何回合都该提供给 AI。
function buildBotVisibleState(g, seat, isFirstTurn=false){
  const me = g.players[seat];
  
  // 计算下一个玩家（用于AI判断行动顺序）
  const calculateNextPlayer = () => {
    if (typeof nextAlive === 'function') {
      return nextAlive(g, g.turn || 0);
    }
    // 兜底实现：如果nextAlive不可用，使用简单的下一个存活玩家逻辑
    const n = g.players.length;
    for(let k = 1; k <= n; k++){
      const s = (g.turn + k) % n;
      if(g.players[s] && g.players[s].alive) return s;
    }
    return g.turn || 0;
  };
  
  return {
    seat,
    gameMode: g.gameMode || 'ffa',
    round: g.roundNum || 1,
    phase: g.phase || '', // 当前游戏阶段
    nextPlayer: calculateNextPlayer(), // 下一个行动的玩家座位
    // 自己的手牌/身份完全可见——这是这个座位本来就该看到的东西,不是特权。
    myRole: me.role || null,
    myHp: me.hp, myMaxHp: me.maxHp,
    myHand: (me.hand||[]).map(botCardBrief),
    myEquips: botPublicEquipsView(me),
    myDelays: botPublicDelaysView(me),
    players: (g.players||[]).map((p,i)=>{
      if(!p) return null;
      const knownRole = botKnownRole(g, seat, i);
      return {
        seat: i, name: p.name, isSelf: i===seat, alive: p.alive,
        hp: p.hp, maxHp: p.maxHp,
        handCount: (p.hand||[]).length, // 只给张数,不给内容
        equips: botPublicEquipsView(p), delays: botPublicDelaysView(p),
        knownRole: knownRole, // 复用既有的安全揭示逻辑,不知道就是 null
        deadRole: !p.alive && g.gameMode==='identity' ? knownRole : undefined, // 已死玩家的身份
        general: p.general || null, // 武将本身是公开信息(座位卡对所有人可见),不是隐藏信息
        generalSkill: p.general && GENERALS && GENERALS[p.general] ? String(GENERALS[p.general].skill||'') : undefined, // 武将技能常开(公开信息)
        generalDesc: p.general && GENERALS && GENERALS[p.general] ? String(GENERALS[p.general].desc||'').slice(0,120) : undefined, // 武将描述常开,截断到120
        distance: i !== seat ? distance(g, seat, i) : 0, // 与自己的距离
        suspicionHint: botSuspicionHint(g, i), // 身份局限定,undefined 时 JSON 里不出现这个键
        // 特殊状态信息
        status: {
          faceup: typeof p.faceup === 'boolean' ? p.faceup : true, // 翻面状态（true=正面，false=背面）
          chained: p.chained === true, // 连环状态
          turnedOver: p.turnedOver === true, // 翻面状态（历史遗留字段，与faceup功能相同）
        },
      };
    }),
    // 最近日志:公开信息,取最近10条;log 项是 {seq,text} 对象,取 text 字段
    recentLog: (g.log||[]).slice(-10).map(e => (e && typeof e==='object') ? e.text : String(e==null?'':e)),
    // 自身回合内标志:只投影自己的(shaUsed 全局、jiangchiNoSlash 每人一份),不含他人私有状态
    myFlags: { shaUsed: !!g.shaUsed, jiangchiNoSlash: !!(me.jiangchiNoSlash) },
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
  // card:候选对应的物理牌牌面(botCardBrief 只给 name/suit/rank),供AI直接看这张牌
  // 具体是什么;handIndex 是对应手牌数组下标,AI 无法凭空发明牌,只能在这份列表里选。
  // botPlay 保证 g.turn===seat(出牌阶段),读 g.players[g.turn] 和读 seat 等价。
  const hand = (g.players[g.turn] && g.players[g.turn].hand) || [];
  const card = (opt.idx!=null && hand[opt.idx]) ? botCardBrief(hand[opt.idx]) : null;
  const parts = ['出【'+opt.action+'】'];
  if(card && card.name!==opt.action) parts.push('实际牌【'+card.name+'】');
  if(targetInfo) parts.push('目标:'+targetInfo.name);
  parts.push('本地分'+Math.round(opt.value));
  return {
    index, action: opt.action, target: targetInfo, localHeuristicScore: Math.round(opt.value),
    label: parts.join(' '), card, handIndex: (opt.idx!=null ? opt.idx : null)
  };
}
function buildBotPlayCandidates(g, options){
  const list = options.map((o,i)=>botPlayCandidateEntry(g, o, i));
  list.push({ index: options.length, action: '结束出牌阶段', target: null, localHeuristicScore: null,
    label: '结束出牌阶段', card: null, handIndex: null });
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
//
// 【判断力层,身份推断线索接入步骤②】四段各追加一句"该怎么用 suspicionHint"——步骤①
// (信息层)已经把 buildBotVisibleState 的 players[].suspicionHint 字段接进两个决策
// 点的 prompt 了,但光有字段不等于AI会用好它,需要明说"这是什么、该怎么参考"。延续
// 既有措辞原则(引导性描述,不是"score>N就必须怎样"这种机械阈值判断)。zhu(主公)那句
// 是唯一的例外——不是新增一句,是修正:原文"可以通过观察谁在集火你、谁在护着你来反推
// 场上身份"这句话此前完全是空转的(AI没有任何字段能真的做这件事),现在 suspicionHint
// 就是这件事的现成答案,原句改写成直接点出这一点、让这句话真正落地,而不是另起一句。
const BOT_IDENTITY_GUIDANCE = {
  fan: '若本回合能对主公形成两次以上有效攻击,通常应该主动出手;避免和忠臣正面消耗,'
    +'那样容易让内奸坐收渔利。候选目标信息里如果带有嫌疑提示(suspicionHint),同样'
    +'值得参考——嫌疑很低的目标往往行为上更偏向保护主公一方,可能更值得优先处理;'
    +'这份线索是场上公开行为算出来的,理论上任何人都能观察到。',
  zhong: '核心任务是辅助并保护主公。局势不明时,宁可暂时被误伤,也不要过早暴露身份——'
    +'过早暴露容易成为反贼的首要目标,反而丧失后续保护主公的能力;也不要把手牌耗尽去'
    +'单挑反贼,那同样是在替内奸创造机会。候选目标信息里如果带有嫌疑提示'
    +'(suspicionHint),那是基于场上公开行为(比如是否打过主公、是否救过疑似反贼)'
    +'算出来的参考,不是凭空猜测——嫌疑越明显的目标,越值得优先怀疑、考虑针对性行动。',
  nei: '判断当前大致该往哪个方向想:场上还有较多反贼时,倾向于配合主公清理反贼,同时'
    +'避免抢头功、暴露自己;反贼所剩不多时,可以考虑找机会针对忠臣;若局面已经收缩到'
    +'只剩你、主公、忠臣三方,这个阶段不要主动招惹主公,优先设法解决忠臣,再考虑后续。'
    +'候选目标的嫌疑提示(suspicionHint)同样有用,帮助判断谁更可能是反贼、谁更可能是'
    +'忠臣,配合上面的阶段判断使用。',
  zhu: '生存优先于输出,倾向保留桃、杀等防身手段,不要轻易消耗殆尽;早期适度低调;'
    +'候选目标信息里的嫌疑提示(suspicionHint)就是"谁在集火你、谁在护着你"这类公开'
    +'行为的汇总,可以直接参考来反推场上身份,不用凭空猜测。',
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

// ================= AI可操作面决策总线(骨架,Task B0) =================
// 【本段是什么】把"一个可操作面决策点"收敛成统一的注册-匹配-候选-询问-执行五段式:
// 新决策点只需往 BOT_DECISIONS 注册 {match, buildCandidates, execute, localFallback,
// onEmpty?, extraState?, buildSystemPrompt?, maxTokens?},其余(密钥守卫、候选规范化、
// AI 调用、超时兜底、本地回退)全部由 botDecide 统一处理,和既有的 tryAiBotPlay/
// tryAiBotBestTarget 共用同一套 parseBotPlayAiChoice 解析与 callAI 基础设施。
// 【当前状态】本阶段只交付骨架:注册表为空、botDecide 对未注册的 decisionId 返回
// false(调用方按"无此决策点"处理)。首个真实决策点由后续任务注册。
const BOT_DECISIONS = Object.create(null);

// ================= L1:controlsChoice(镜像真实 controls 按钮,Task B3) =================
// 【本决策点是什么】把"响应阶段由 renderControls 渲染出的一组按钮"整体镜像成候选列表:
// AI 从按钮里选、无密钥时本地回退按"和改动前硬编码分支完全一致"的顺序点按钮。与
// botSafePrompt 的关系:同一个 DOM 隔离模式(真实 #controls 临时改名 → 隐藏 box 渲染 →
// 收集按钮),区别是 ①收集所有 button:not(:disabled)(不筛安全正则);②box 在收集后
// 【保留】到 execute 点击完才销毁——botSafePrompt 的收集+点击在同一次同步调用里完成,
// L1 的 AI 等待期间 box 必须还活着、click 才有对象可点,所以销毁(defer)交给 execute,
// 不在 collect;③回退选择顺序与 botSafePrompt 相同(先 safe 正则、再 mandatory 正则、
// 最后第一项)。
// 【allowlist 判定,不可随意扩表】只有"旧本地分支的动作 == 按回退顺序点出来的按钮动作"
// 的阶段才允许迁移,否则无密钥行为会悄悄改变(回归红线,见 CLAUDE.md 无密钥回归原则)。
// 逐个读了 render-controls.js 对应分支核对:
//  wuxie      (2840行):按钮[打出【无懈可击】(手里无牌时 disabled), 不出];旧分支
//             respondWuxie(false);safe 正则第一命中"不出" → 等价。✓
//  luoyingAsk (847行) :按钮[获得, 不获得];旧分支 respondLuoying(true);"不获得"不命中
//             safe 正则、"获得/不获得"都不命中 mandatory 正则 → 回退 candidates[0]="获得"
//             → 等价。✓
//  luoshen    (2632行):按钮[发动【洛神】判定, 不再发动];旧分支 respondLuoshen(true);
//             "不再发动"不含"不发动"子串、两个按钮都含"发动"被 mandatory 排除 →
//             回退 candidates[0]="发动【洛神】判定" → 等价。✓
//  铁骑/烈弓刻意不迁移:按钮是[发动X, 不发动],safe 正则第一命中"不发动",而旧分支是
//  respondTieqi(true)/respondLiegong(true),回退会变行为 → 违反无密钥回归红线。
// 不在 allowlist 的阶段 match 返回 false,继续走 runBotDecision 既有硬编码分支,零变化。
const CONTROLS_CHOICE_ALLOWLIST = new Set(['wuxie','luoyingAsk','luoshen']);
// collect 与 execute 之间跨 AI await 传递的 DOM 上下文(box 必须在点击后才销毁)
let controlsChoiceCtx = null;

function collectControlsCandidates(g, seat){
  const real = document.getElementById('controls');
  if(!real || typeof renderControls!=='function') return { candidates: [], dispose: null };
  const oldId = real.id; real.id = 'human-controls';
  const box = document.createElement('div');
  box.id = 'controls'; box.style.display = 'none';
  document.body.appendChild(box);
  const humanSeat = mySeat; mySeat = seat;
  const list = [];
  try{
    renderControls(g);
    const buttons = [...box.querySelectorAll('button:not(:disabled)')];
    buttons.forEach((btn, i)=>{
      const label = (btn.textContent||'').trim() || ('按钮'+i);
      list.push({
        index: i,
        label,
        source: 'controls',
        invoke: ()=>{ btn.click(); },
      });
    });
  } catch(e){ console.warn('collectControlsCandidates', e); }
  finally { mySeat = humanSeat; }
  return {
    candidates: list,
    dispose: function(){
      box.remove();
      real.id = oldId;
      // 与 botSafePrompt 同一约定:借用期间 setBanner 写的是机器人文案,归还后重渲染一次,
      // 把 banner/controls 恢复成真人视角(仅当渲染快照可用时;沙箱测试里 currentG 不存在则跳过)
      if(typeof currentG!=='undefined' && currentG) renderControls(currentG);
    }
  };
}
function controlsChoiceMatch(g, seat){
  if(!g || !g.pending || !CONTROLS_CHOICE_ALLOWLIST.has(g.phase)) return false;
  return botSeatForState(g)===seat;
}
function controlsChoiceBuildCandidates(g, seat){
  const res = collectControlsCandidates(g, seat);
  if(!res.candidates.length){
    // 没有可点按钮:立即归还 DOM(否则真实 #controls 会一直顶着改名后的 id,真人界面坏掉),
    // 返回空让 botDecide 走 false → 旧分支继续处理。
    if(res.dispose) res.dispose();
    return [];
  }
  controlsChoiceCtx = res;
  return res.candidates;
}
function controlsChoiceLocalFallback(g, seat, candidates){
  // 与 botSafePrompt 同款选择顺序:先 safe 正则、再 mandatory 正则、最后第一项。
  // 对 allowlist 三个阶段逐项核对过:落点与旧硬编码分支完全一致(见上面 allowlist 注释)。
  const safe = candidates.find(c=>/不发动|不使用|不出|取消|跳过|放弃|结束/.test(c.label));
  if(safe) return safe;
  const mandatory = candidates.find(c=>!/发动/.test(c.label)&&/选择|交给|弃置|摸牌|回复|打出/.test(c.label));
  if(mandatory) return mandatory;
  return candidates[0];
}
function controlsChoiceExecute(g, seat, choice){
  const ctx = controlsChoiceCtx;
  try{
    botInvoke(seat, ()=>{ if(choice && typeof choice.invoke==='function') choice.invoke(); });
  } finally {
    if(ctx && ctx.dispose) ctx.dispose();
    controlsChoiceCtx = null;
  }
}
function buildControlsChoiceSystemPrompt(g, seat, ctx){
  return '你在扮演一款网页版三国杀里的AI机器人玩家。当前阶段,游戏界面为你渲染了一组'
    +'可点击的按钮(候选列表里的每一项对应一个按钮),每个按钮是一个合法动作。请结合当前'
    +'局面(你视角下真实合法可见的信息)与按钮文案,选出你认为最合适的动作。只能选择候选'
    +'列表里的按钮,不能发明列表之外的选项。'
    +'请只输出一个严格的JSON对象,格式固定为 {"choice": 数字},不要输出任何解释文字、'
    +'代码块标记或多余字段。';
}
BOT_DECISIONS.controlsChoice = {
  match: controlsChoiceMatch,
  buildCandidates: controlsChoiceBuildCandidates,
  localFallback: controlsChoiceLocalFallback,
  execute: controlsChoiceExecute,
  buildSystemPrompt: buildControlsChoiceSystemPrompt,
};

// ================= L2:discardSubset(弃牌阶段选弃哪几张,Task B4) =================
// 【本决策点是什么】弃牌阶段"弃掉哪 need 张"是资源取舍判断,不是纯机械规则——候选列表
// 是若干组"完整的弃牌下标集合"(每组都恰好 need 张、从自己的手牌里弃掉),AI 从中选一组;
// 无密钥回退默认组合 = 末尾 need 张(与旧硬编码分支逐字一致,无密钥回归红线)。
// 【候选生成策略】默认组合永远在场;变体1 = 按 botCardPriority 价值升序(优先弃低价值)
// 取前 need 张;变体2+ = 从价值组合出发逐位换成"下一位未选中下标"的小变异,凑足 20 个
// 上限。下标一律升序(服务端 discardCards 内部自己按降序 splice,顺序不影响结果)。
function discardSubsetMatch(g, seat){
  return g.phase==='discard' && g.turn===seat;
}
function discardSubsetBuildCandidates(g, seat){
  const p = g.players[seat];
  const hand = p.hand || [];
  const need = hand.length - p.hp;
  if(need <= 0) return []; // need<=0 的 endTurn 短路径在 runBotDecision 里处理,这里永不触发
  // 默认组合:末尾 need 张(旧算法)
  const defaultIndices = [];
  for(let i = hand.length - need; i < hand.length; i++) defaultIndices.push(i);
  const seen = new Set();
  const out = [];
  function addVariant(idxArr, isDefault){
    const sorted = idxArr.slice().sort((a,b)=>a-b);
    const key = sorted.join(',');
    if(seen.has(key) || out.length >= 20) return;
    seen.add(key);
    out.push({
      label: (isDefault ? '默认弃牌(与本地一致):' : '弃牌组合'+out.length+':')
        + sorted.map(i=>hand[i].name).join('/'),
      discardIndices: sorted,
      isDefault: isDefault
    });
  }
  addVariant(defaultIndices, true);
  // 变体1:按价值升序(优先弃低价值)取前 need 张
  const byValue = hand.map((c,i)=>({ i:i, v: botCardPriority(c.name) }))
    .sort((a,b)=>a.v-b.v || a.i-b.i);
  addVariant(byValue.slice(0, need).map(x=>x.i), false);
  // 变体2+:从价值组合出发,逐位换成"下一位未选中的更高下标"(小变异)
  for(let k = 0; k < need && out.length < 20; k++){
    const base = byValue.slice(0, need).map(x=>x.i).sort((a,b)=>a-b);
    let next = base[k] + 1;
    while(base.indexOf(next) >= 0) next++;
    if(next >= hand.length) continue;
    const v = base.slice(); v[k] = next;
    addVariant(v, false);
  }
  return out;
}
function discardSubsetLocalFallback(g, seat, candidates){
  return candidates.find(c=>c.isDefault===true) || candidates[0];
}
function discardSubsetExecute(g, seat, choice){
  botInvoke(seat, ()=>discardCards(choice.discardIndices));
}
function buildDiscardSubsetSystemPrompt(){
  return '你在扮演网页版三国杀的AI机器人。当前是你的弃牌阶段,你必须恰好弃置 need 张牌'
    +'(候选列表每一项是一组完整的弃牌下标集合,均从你当前手牌中弃掉,弃哪组都一样合法)。'
    +'思考要保留哪些牌:桃/无中生有/装备/锦囊等价值高的优先保留,闪/酒等价值低的优先弃置。'
    +'只能选择列表内的组合,不能发明列表之外的选项。请只输出 {"choice":数字},不要解释。';
}
BOT_DECISIONS.discardSubset = {
  match: discardSubsetMatch,
  buildCandidates: discardSubsetBuildCandidates,
  localFallback: discardSubsetLocalFallback,
  execute: discardSubsetExecute,
  buildSystemPrompt: buildDiscardSubsetSystemPrompt,
  maxTokens: 120,
};

// ================= L2:pickSlot(顺手/拆桥选拿/拆哪个对象,Task B4) =================
// 【本决策点是什么】顺手牵羊/过河拆桥的选牌子阶段:目标的手牌(整体1个随机选项)、每件
// 装备、判定区每张延时锦囊各算一个候选。AI 从中选拿/拆哪个;无密钥回退与旧分支顺序
// 逐字一致(手牌优先 → 第一个占用装备槽 → delay:0)。
function pickSlotMatch(g, seat){
  return g.phase==='pick' && g.pending && g.pending.type==='pick' && g.pending.from===seat;
}
function pickSlotBuildCandidates(g, seat){
  const d = g.pending || {};
  const target = g.players[d.to];
  if(!target || !target.alive) return [];
  const out = [];
  if((target.hand||[]).length > 0){
    out.push({ pickKey: 'hand', label: '随机手牌(共'+(target.hand||[]).length+'张)' });
  }
  (typeof EQUIP_SLOTS!=='undefined' ? EQUIP_SLOTS : []).forEach(slot=>{
    const c = target.equips && target.equips[slot];
    if(c) out.push({ pickKey: slot, label: '装备:' + c.name });
  });
  (target.delays||[]).forEach((c, i)=>{
    out.push({ pickKey: 'delay:'+i, label: '判定区:' + c.name });
  });
  return out;
}
function pickSlotLocalFallback(g, seat, candidates){
  const byKey = {};
  candidates.forEach(c=>{ byKey[c.pickKey] = c; });
  const target = g.players[(g.pending||{}).to];
  if((target && target.hand || []).length && byKey.hand) return byKey.hand;
  const slot = (typeof EQUIP_SLOTS!=='undefined' ? EQUIP_SLOTS : [])
    .find(s=>target && target.equips && target.equips[s]);
  if(slot && byKey[slot]) return byKey[slot];
  if(byKey['delay:0']) return byKey['delay:0'];
  return candidates[0];
}
function pickSlotExecute(g, seat, choice){
  botInvoke(seat, ()=>pickResolve(choice.pickKey));
}
function buildPickSlotSystemPrompt(){
  return '你在扮演网页版三国杀的AI机器人。你使用了顺手牵羊/过河拆桥,需要从目标处选择'
    +'拿/拆的对象(候选列表每一项是一个具体对象:随机手牌/某件装备/判定区某张延时锦囊)。'
    +'结合当前局面判断哪个对象价值最高(拆武器/拆+1马/拿装备/拆延时锦囊等)。只能选择'
    +'列表内的选项,不能发明列表之外的选项。请只输出 {"choice":数字},不要解释。';
}
BOT_DECISIONS.pickSlot = {
  match: pickSlotMatch,
  buildCandidates: pickSlotBuildCandidates,
  localFallback: pickSlotLocalFallback,
  execute: pickSlotExecute,
  buildSystemPrompt: buildPickSlotSystemPrompt,
};

// ================= L2:响应类三兄弟(guicai/ganglieChoice/guhuoQuestion,Task B5) =================
// 【本批是什么】三个响应类决策点从"第四阶段各自独立的 tryAiBotXxx + runBotDecision 硬编码
// 分支"收敛进 BOT_DECISIONS 注册表,删除 tryAi* 包装函数,避免双路径。三个都无法用 L1
// controlsChoice 镜像:guicai/ganglieChoice 的 controls 按钮是"进入本地多步选牌状态机"
// (点击不提交,见 render-controls.js 对应分支),guhuoQuestion 的本地回退是固定30%概率的
// 随机数(非确定性),都不是"点一个按钮即提交"的形状,故各自专用注册。
// 【无密钥回归红线】三条 localFallback 与改动前硬编码分支逐字一致:guicai 不发动、
// ganglieChoice 手牌够2张弃牌否则受伤、guhuoQuestion 30%随机质疑。
function guicaiHandPickMatch(g, seat){
  return g.phase==='guicai' && g.pending && g.pending.type==='guicai' && g.pending.asking===seat;
}
function guicaiHandPickBuildCandidates(g, seat){
  // 复用 buildBotGuicaiCandidates 的形状(index0=不发动+每张手牌一项),补 replace 标志:
  // 候选0→replace:false,候选>0→replace:true + 对应 handIndex,execute 直接映射到
  // respondGuicai(useReplace,cardIdx) 两个参数。
  return buildBotGuicaiCandidates(g, seat).map((c, i)=>({
    action: c.action, handIndex: c.handIndex, card: c.card,
    replace: i===0 ? false : true,
  }));
}
function guicaiHandPickLocalFallback(){
  return { replace:false, handIndex:null };
}
function guicaiHandPickExecute(g, seat, choice){
  botInvoke(seat, ()=>respondGuicai(choice.replace, choice.handIndex));
}
BOT_DECISIONS.guicaiHandPick = {
  match: guicaiHandPickMatch,
  buildCandidates: guicaiHandPickBuildCandidates,
  localFallback: guicaiHandPickLocalFallback,
  execute: guicaiHandPickExecute,
  extraState: buildBotGuicaiVisibleState,
  buildSystemPrompt: buildBotGuicaiSystemPrompt,
  maxTokens: 100,
};

function ganglieChoiceMatch(g, seat){
  return g.phase==='ganglieChoice' && g.pending && g.pending.type==='ganglieChoice' && g.pending.sourceSeat===seat;
}
function ganglieChoiceBuildCandidates(g, seat){
  // 手牌不足2张时 finishGanglieJudge 会直接跳过这个 pending 自动结算伤害,这里镜像同一
  // 规则只保留"受伤"一个候选(botDecide 单候选短路,不浪费AI调用)。
  const me = g.players[seat];
  const out = [];
  if((me.hand||[]).length>=2) out.push({ action:'弃置2张手牌', discard:true });
  out.push({ action:'受到1点伤害', discard:false });
  return out;
}
function ganglieChoiceLocalFallback(g, seat, candidates){
  // 与旧硬编码分支逐字一致:手牌够两张就弃牌,否则只能受伤。
  const wantDiscard = (g.players[seat].hand||[]).length>=2;
  return candidates.find(c=>c.discard===wantDiscard) || candidates[0];
}
function ganglieChoiceExecute(g, seat, choice){
  botInvoke(seat, ()=>respondGanglieChoice(choice.discard?'discard':'damage', choice.discard?[0,1]:[]));
}
BOT_DECISIONS.ganglieChoice = {
  match: ganglieChoiceMatch,
  buildCandidates: ganglieChoiceBuildCandidates,
  localFallback: ganglieChoiceLocalFallback,
  execute: ganglieChoiceExecute,
  extraState: buildBotGanglieVisibleState,
  buildSystemPrompt: buildBotGanglieSystemPrompt,
  maxTokens: 80,
};

function guhuoQuestionMatch(g, seat){
  return g.phase==='guhuoQuestion' && g.pending && g.pending.type==='guhuoQuestion' && g.pending.asking===seat;
}
function guhuoQuestionBuildCandidates(){
  return [
    { action:'质疑', question:true },
    { action:'不质疑', question:false },
  ];
}
function guhuoQuestionLocalFallback(g, seat, candidates){
  // 与旧硬编码分支逐字一致:固定30%概率随机质疑,不偷看 d.actualCard(隐藏信息)。
  return Math.random()<0.3 ? candidates.find(c=>c.question) : candidates.find(c=>!c.question);
}
function guhuoQuestionExecute(g, seat, choice){
  botInvoke(seat, ()=>respondGuhuoQuestion(choice.question));
}
BOT_DECISIONS.guhuoQuestion = {
  match: guhuoQuestionMatch,
  buildCandidates: guhuoQuestionBuildCandidates,
  localFallback: guhuoQuestionLocalFallback,
  execute: guhuoQuestionExecute,
  extraState: buildBotGuhuoVisibleState,
  buildSystemPrompt: buildBotGuhuoSystemPrompt,
  maxTokens: 50,
};

function buildBotDefaultSystemPrompt(/* g, seat, ctx */){
  return '你在扮演网页版三国杀的AI机器人。根据局面与武将技能说明，从候选列表选一个index。'
    +'只能选列表内选项。只输出 {"choice":数字}，不要解释。';
}

function buildBotDefaultUserPrompt(state, candidates){
  return '当前局面:\n'+JSON.stringify(state)
    +'\n\n合法候选(index从0开始):\n'+JSON.stringify(candidates.map(c=>({
      index:c.index, label:c.label, action:c.action, card:c.card, seat:c.seat,
      handIndex:c.handIndex, pickKey:c.pickKey, discardIndices:c.discardIndices
    })))
    +'\n\n只返回 {"choice":数字}';
}

// callAiChooseIndex:一次"候选列表→索引"的AI询问,返回规范化后的合法下标或 null。
// 守卫/超时/解析失败/越界全部收敛到这一处,与 tryAiBotPlay 同一套取舍:任何失败都
// 返回 null 交给调用方回退本地逻辑,不重试、不阻塞、不抛异常。
async function callAiChooseIndex(opts){
  const candidates = opts.candidates || [];
  if(typeof aiApiKey==='undefined' || !aiApiKey || !aiProvider) return null;
  if(candidates.length<=1) return candidates.length===1 ? 0 : null;
  const g = opts.g, seat = opts.seat;
  showAiThinkingIndicator(g, seat);
  let result;
  try{
    result = await callAI(aiProvider, aiApiKey, {
      systemPrompt: opts.systemPrompt || buildBotDefaultSystemPrompt(),
      userPrompt: opts.userPrompt,
      maxTokens: opts.maxTokens || 80,
      model: (typeof aiApiModel!=='undefined' && aiApiModel) || undefined,
    });
  }catch(e){
    result = { ok:false, reason:'other', detail:String(e) };
  }finally{
    hideAiThinkingIndicator();
  }
  if(!result || !result.ok) return null;
  const idx = parseBotPlayAiChoice(result.text);
  if(idx===null || idx<0 || idx>=candidates.length) return null;
  return idx;
}

// botDecide:决策总线入口。匹配失败/无候选且无 onEmpty 时返回 false(调用方按
// "无此决策点"处理);否则总是执行(spec.execute 负责真正落子)并返回 true。
// 注意:即使返回 true,execute 内部也可能因服务端校验失败而静默不生效——那是
// 具体决策点自己的职责,不在总线层保证。
async function botDecide(decisionId, g, seat){
  const spec = BOT_DECISIONS[decisionId];
  if(!spec || typeof spec.match!=='function' || !spec.match(g, seat)) return false;
  const candidates = spec.buildCandidates(g, seat) || [];
  if(!candidates.length){
    if(typeof spec.onEmpty==='function'){ spec.onEmpty(g, seat); return true; }
    return false;
  }
  // 规范 index
  candidates.forEach((c,i)=>{ c.index = i; });
  let idx = null;
  const aiReady = typeof aiApiKey!=='undefined' && aiApiKey && aiProvider;
  if(aiReady && candidates.length>1){
    const state = buildBotVisibleState(g, seat);
    if(typeof spec.extraState==='function'){
      Object.assign(state, spec.extraState(g, seat) || {});
    }
    const systemPrompt = (typeof spec.buildSystemPrompt==='function')
      ? spec.buildSystemPrompt(g, seat, { state, candidates })
      : buildBotDefaultSystemPrompt(g, seat);
    const userPrompt = buildBotDefaultUserPrompt(state, candidates);
    idx = await callAiChooseIndex({ g, seat, systemPrompt, userPrompt, candidates, maxTokens: spec.maxTokens||80 });
  } else if(aiReady && candidates.length===1){
    idx = 0;
  }
  let choice;
  if(idx===null){
    choice = spec.localFallback(g, seat, candidates);
  } else {
    choice = candidates[idx];
  }
  spec.execute(g, seat, choice);
  return true;
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
  // 候选列表→索引的AI询问统一走 callAiChooseIndex(密钥守卫/单候选短路/思考指示/
  // 解析/越界校验/超时兜底全部收敛在总线骨架里,和 botDecide 共用同一套基础设施)。
  const idx = await callAiChooseIndex({
    g, seat,
    systemPrompt: buildBotPlaySystemPrompt(g, seat),
    userPrompt: buildBotPlayUserPrompt(state, candidates),
    candidates, maxTokens: 200,
  });
  if(idx===null) return null;
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
  const idx = await callAiChooseIndex({
    g, seat,
    systemPrompt: buildBotTargetSystemPrompt(g, seat),
    userPrompt: buildBotTargetUserPrompt(state, card, actionId, candidates),
    candidates, maxTokens: 100,
  });
  if(idx===null) return null;
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

// 【本决策点的注册入口】BOT_DECISIONS.guhuoQuestion(见文件前面"响应类三兄弟"段):
// 候选=[质疑,不质疑],localFallback 是旧硬编码分支的固定30%随机,execute 提交
// respondGuhuoQuestion(question);AI视角经 extraState=buildBotGuhuoVisibleState 构造,
// 结构上不可能引用到 d.actualCard。
//
// 【mySeat 借用窗口,已核实确认不需要】respondGuhuoQuestion(skills.js)内部对 mySeat
// 的唯一引用是标准的调用者身份守卫(g.pending.asking!==mySeat)和 g.players[mySeat]
// 取值,这两处都由 botDecide 的 execute 用既有的 botInvoke(seat,fn) 包装(mySeat=seat;
// 同步执行;立刻归还)正确处理,和其余30多个响应类分支(respondShan/duelResponse等)
// 完全一样——不是 botPlay 枚举阶段那种"需要在调用真正的动作函数之前,先用全局 mySeat
// 跑一遍 CARD_PLAYS.canPlay/canTarget 筛出候选"的特殊场景(这个决策是二选一判断题,
// 不涉及任何候选枚举,不读 CARD_PLAYS)。函数内部另有一处 mySeat 的临时切换
// (runGuhuoAsSource,发生在蛊惑判定为真、真正结算 spec.effect 时),但那是把 mySeat
// 切到"于吉自己的座位"、且完全内嵌在 respondGuhuoQuestion 触发的同一次同步 tx 调用
// 链里、finally 里会自动切回去——是游戏引擎自身的既有机制,和"谁/怎么触发了
// respondGuhuoQuestion"无关,不需要机器人决策层做任何特殊处理。因此这次不需要额外的
// 借用窗口,直接用标准的 botInvoke 包装即可。

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

// 【本决策点的注册入口】BOT_DECISIONS.ganglieChoice(见文件前面"响应类三兄弟"段):
// 候选=[弃置2张(手牌>=2时), 受伤],localFallback 与旧硬编码分支逐字一致,execute
// 提交 respondGanglieChoice(action,picks)。

// ================= AI机器人接入第四阶段第二批:guicai(郭嘉【鬼才】要不要发动改判)
// =================
// 【范围声明】这批是第四阶段第二批的第二个,独立于 ganglieChoice 单独commit。覆盖面
// 最广(8种判定类型,由 finishGuicai 的 resume.kind 分派表决定),需要专门设计一个能
// 适配不同判定上下文的通用prompt结构,不是照抄guhuoQuestion/ganglieChoice就能直接用。
//
// 【mySeat 借用窗口,已实际核实、不是照抄前两批的结论就假设一定适用】读了
// respondGuicai(game.js)的完整函数体:守卫是标准的调用者身份守卫
// (g.pending.asking!==mySeat),函数体内部只用 g.players[mySeat] 取自己、操作自己的
// 手牌,从头到尾没有第二处引用 mySeat,也不调用任何依赖全局 mySeat 的
// CARD_PLAYS.canPlay/canTarget——和 guhuoQuestion/ganglieChoice 是完全相同的形状,
// 结论同样是:不需要额外借用窗口,标准 botInvoke(seat,fn) 包装即可。
//
// 【隐藏信息】判定牌(judgeCard)本身在 judge() 里就已经写进公开日志("判定牌:红桃3"),
// 是公开信息,不是需要对响应者隐藏的东西;响应者自己的手牌通过 buildBotVisibleState 里
// 的 myHand 天然可见(这本来就是他自己的手牌)。这个决策不涉及需要隐藏的信息,但仍然
// 构造专门的 buildBotGuicaiVisibleState,不直接把完整的 g/player 对象喂给AI。
//
// 【选牌维度:设计决定,不是"沿用现有本地逻辑"——因为本地逻辑此前压根没有选牌能力】
// respondGuicai(useReplace,cardIdx) 允许用任意一张手牌替换判定牌,没有额外限制;而
// 改动前的本地启发式是硬编码 respondGuicai(false)(永远不发动,从不需要选牌)。这意味着
// "只做要不要发动、选牌沿用本地逻辑"这个方案没有本地逻辑可沿用——一旦AI决定要发动,
// 必须由这次AI调用自己选出用哪张牌,不存在第二层可独立复用的既有默认值。采用的方案是
// 把"要不要发动"和"发动的话用哪张牌"合并进同一次AI调用、同一个候选列表——完全复用
// botPlay 已经验证过的"候选列表+index"模式(不是发明新的响应格式):
// buildBotGuicaiCandidates 产出 index=0("不发动")+ 每张手牌各一项("打出这张牌替换")的
// 列表,AI 选一个 index,解析仍然是现成的 parseBotPlayAiChoice({"choice":N}),不需要
// 引入新的JSON字段。无密钥/AI失败/index不合法时的回退是 {replace:false}——和改动前
// respondGuicai(false) 这个硬编码默认完全一致,是这次改动的回归基线。
// 手牌为空的座位理论上不会被问到(firstGuicaiAsker/nextGuicaiAsker 已经要求候选人
// (p.hand||[]).length>0 才算有资格),但 guicaiHandPick 注册项仍防御性地在候选列表只有
// "不发动"这一项时跳过AI调用、不浪费一次网络请求(botDecide 的单候选短路)。
function buildBotGuicaiCandidates(g, seat){
  const me = g.players[seat];
  const list = [{ index:0, action:'不发动【鬼才】', handIndex:null, card:null }];
  (me.hand||[]).forEach((c,i)=>{
    list.push({ index:list.length, action:'发动【鬼才】,打出这张牌替换判定牌', handIndex:i, card:botCardBrief(c) });
  });
  return list;
}

// guicaiOutcomeDescription:这批唯一需要新设计的部分——把"当前是哪种判定+判定结果对
// 局势的具体影响"组织进prompt。按 resume.kind(及 delayJudge 下的 trickName)分派,
// 每种判定类型各自描述"如果不替换,当前这张已经判定出来的牌具体会带来什么后果"(不是
// 抽象讲规则,是结合真实的 judgeCard 花色/点数给出确定性的结论)——这样AI不需要自己
// 从头理解八卦阵/闪电/铁骑/洛神/双雄/悲歌/刚烈/雷击这8种判定各自的规则,直接看这句
// 结论就知道"保留 vs 替换"分别意味着什么。覆盖 finishGuicai 分派表里全部 resume.kind
// (包括这次顺带补齐的 leijiJudge,见 game.js 的 finishGuicai 修复注释)。
function guicaiOutcomeDescription(g, resume, judgeCard, judgedSeat){
  const jp = g.players[judgedSeat];
  const judgedName = (jp && jp.name) || '判定者';
  const cardDesc = judgeCard.suit+rankText(judgeCard.rank);
  const isRed = judgeCard.suit==='♥' || judgeCard.suit==='♦';
  switch(resume.kind){
    case 'bagua': {
      if(resume.type==='sha'){
        return isRed
          ? judgedName+' 当前判定'+cardDesc+'(红色),若不替换将视为出闪抵消这张杀,'+judgedName+' 不受伤害。'
          : judgedName+' 当前判定'+cardDesc+'(黑色),若不替换八卦阵判定失败,'+judgedName+' 仍需正常打出闪或受到伤害。';
      }
      return isRed
        ? judgedName+' 当前判定'+cardDesc+'(红色),若不替换将抵消这次群体锦囊效果,'+judgedName+' 不受影响。'
        : judgedName+' 当前判定'+cardDesc+'(黑色),若不替换八卦阵判定失败,'+judgedName+' 仍需正常应战。';
    }
    case 'delayJudge': {
      if(resume.trickName==='闪电'){
        const hit = judgeCard.suit==='♠' && judgeCard.rank>=2 && judgeCard.rank<=9;
        return hit
          ? judgedName+' 当前判定'+cardDesc+'(黑桃2~9),若不替换【闪电】生效,'+judgedName+' 将受到3点无来源伤害。'
          : judgedName+' 当前判定'+cardDesc+',若不替换【闪电】判定失败,将传给下家,'+judgedName+' 本人不受影响。';
      }
      if(resume.trickName==='乐不思蜀'){
        const hit = judgeCard.suit!=='♥';
        return hit
          ? judgedName+' 当前判定'+cardDesc+'(非红桃),若不替换【乐不思蜀】生效,'+judgedName+' 将跳过下一个出牌阶段。'
          : judgedName+' 当前判定'+cardDesc+'(红桃),若不替换【乐不思蜀】判定失败,'+judgedName+' 不受影响。';
      }
      if(resume.trickName==='兵粮寸断'){
        const hit = judgeCard.suit!=='♣';
        return hit
          ? judgedName+' 当前判定'+cardDesc+'(非梅花),若不替换【兵粮寸断】生效,'+judgedName+' 将跳过下一个摸牌阶段。'
          : judgedName+' 当前判定'+cardDesc+'(梅花),若不替换【兵粮寸断】判定失败,'+judgedName+' 不受影响。';
      }
      return judgedName+' 当前判定'+cardDesc+'。';
    }
    case 'tieqiJudge': {
      return isRed
        ? '攻击者的【铁骑】当前判定'+cardDesc+'(红色),若不替换,这张杀将不可被闪抵消。'
        : '攻击者的【铁骑】当前判定'+cardDesc+'(黑色),若不替换,判定无效,这张杀可以正常被闪抵消。';
    }
    case 'luoshenJudge': {
      const isBlack = judgeCard.suit==='♠' || judgeCard.suit==='♣';
      return isBlack
        ? judgedName+' 的【洛神】当前判定'+cardDesc+'(黑色),若不替换,'+judgedName+' 将获得这张判定牌并可以选择继续判定。'
        : judgedName+' 的【洛神】当前判定'+cardDesc+'(红色),若不替换,判定结束,'+judgedName+' 不获得这张牌。';
    }
    case 'shuangxiongJudge': {
      return judgedName+' 的【双雄】当前判定'+cardDesc+'('+(isRed?'红色':'黑色')+'),若不替换,本回合 '+judgedName+' 可以将'+(isRed?'黑色':'红色')+'手牌当决斗使用。';
    }
    case 'beigeJudge': {
      const isRedPeach = judgeCard.suit==='♥';
      return isRedPeach
        ? '蔡文姬的【悲歌】当前判定'+cardDesc+'(红桃),若不替换,伤害来源将回复1点体力。'
        : '蔡文姬的【悲歌】当前判定'+cardDesc+'(非红桃),若不替换,伤害来源需要弃置2张手牌。';
    }
    case 'ganglieJudge': {
      const isRedPeach = judgeCard.suit==='♥';
      return isRedPeach
        ? '夏侯惇的【刚烈】当前判定'+cardDesc+'(红桃),若不替换,无事发生。'
        : '夏侯惇的【刚烈】当前判定'+cardDesc+'(非红桃),若不替换,伤害来源需要在弃两张手牌与受到1点伤害之间选择。';
    }
    case 'leijiJudge': {
      const isSpade = judgeCard.suit==='♠';
      return isSpade
        ? '张角的【雷击】当前判定'+cardDesc+'(黑桃),若不替换,目标将受到2点雷电伤害。'
        : '张角的【雷击】当前判定'+cardDesc+'(非黑桃),若不替换,【雷击】无效。';
    }
    default:
      return judgedName+' 当前判定'+cardDesc+'。';
  }
}

function buildBotGuicaiVisibleState(g, seat){
  const d = g.pending;
  const state = buildBotVisibleState(g, seat);
  state.guicai = {
    judgedSeat: d.seat,
    judgedSeatIsSelf: d.seat===seat,
    judgeCard: botCardBrief(d.judgeCard),
    outcomeIfKept: guicaiOutcomeDescription(g, d.resume, d.judgeCard, d.seat),
  };
  return state;
}

// BOT_GUICAI_SYSTEM_PROMPT:不接身份局四阵营guidance(这批的核心是"这次改判对局势具体
// 有什么影响"这个判定上下文本身,和guhuoQuestion/ganglieChoice同一原则先保持简单;
// guicai天然更贴近阵营博弈——判定往往发生在别人身上,是否要干预确实可能和敌我关系有关——
// 但任务范围没有要求接入,这里刻意不做,留作以后如果需要再单独评估的候选项,不是这次
// 顺手写死的架构决定)。明确提醒"判定发生在别人身上时,你是第三方视角在决定要不要干预",
// 这是调研阶段指出的、guicai和前两批本质不同的地方("响应者是被动的第三方,不是发起者")。
function buildBotGuicaiSystemPrompt(){
  return '你在扮演一款网页版三国杀里的AI机器人玩家。场上刚发生一次判定,你(拥有郭嘉'
  +'【鬼才】技能)可以选择打出一张手牌替换这张判定牌,或者不发动、保留原判定结果。'
  +'局面数据里的 guicai 字段会说明:这次判定是谁的(judgedSeat)、判定牌具体是什么'
  +'(judgeCard)、如果保留不替换会发生什么(outcomeIfKept)。你需要判断:这个结果对'
  +'局势是有利还是不利,值不值得牺牲一张手牌去改变它——判定发生在别的角色身上时'
  +'(guicai.judgedSeatIsSelf为false),你是以第三方视角在决定要不要干预这次判定,'
  +'不是替判定者本人做决定。合法候选列表里,每一项对应"不发动"或"打出某张具体手牌'
  +'替换",请从候选列表里选出一个index,不能凭空发明选项。'
  +'请只输出一个严格的JSON对象,格式固定为 {"choice": 数字},不要输出任何解释文字、'
  +'代码块标记或多余字段。';
}
function buildBotGuicaiUserPrompt(state, candidates){
  return '当前局面:\n'+JSON.stringify(state)
    +'\n\n合法候选动作列表(index从0开始,0是"不发动"):\n'+JSON.stringify(candidates)
    +'\n\n只返回 {"choice": 数字} 这一个JSON对象。';
}

// 【本决策点的注册入口】BOT_DECISIONS.guicaiHandPick(见文件前面"响应类三兄弟"段):
// buildCandidates 复用 buildBotGuicaiCandidates 的形状并补 replace 标志;无密钥回退
// {replace:false} 与改动前 respondGuicai(false) 这个硬编码默认完全一致,是回归基线。
// 手牌为空的座位理论上不会被问到(firstGuicaiAsker/nextGuicaiAsker 已经要求候选人
// (p.hand||[]).length>0 才算有资格),但候选列表只剩"不发动"一项时 botDecide 的单候选
// 短路也会跳过AI调用、不浪费一次网络请求。

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
    if(need<=0){ botInvoke(seat,endTurn); return; }
    // L2 discardSubset:弃牌组合决策由总线接管(无密钥回退=旧算法末尾 need 张,逐字一致)。
    // botDecide 返回 true 表示已执行;need>0 时候选必非空,不存在"无候选落空"的分支。
    if(await botDecide('discardSubset', g, seat)) return;
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
  // L1 controlsChoice:镜像真实 controls 按钮的响应决策(wuxie/luoyingAsk/luoshen,
  // allowlist 及逐阶段等价性核对见 BOT_DECISIONS.controlsChoice 上方注释)。命中则整条
  // 决策链(含无密钥本地回退,与旧硬编码分支动作逐字一致)由总线接管并 return;未命中
  // (非 allowlist 阶段/没有可点按钮)返回 false,继续走下面既有的硬编码分支,行为零变化。
  // 旧的 respondWuxie(false) 硬编码分支已删除:回退顺序 safe 正则第一命中"不出",等价。
  if(await botDecide('controlsChoice', g, seat)) return;
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
    // L2 pickSlot:顺手/拆桥选对象决策由总线接管(无密钥回退=旧分支 hand→装备槽→delay:0)。
    // d.from===seat 与 pickSlotMatch 是同一道守卫,保留作双保险。
    if(await botDecide('pickSlot', g, seat)) return;
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
  if(g.phase==='guicai'&&d.asking===seat){
    // 郭嘉【鬼才】改判决策由总线接管(候选=不发动+每张手牌;无密钥回退=respondGuicai(false),
    // 与旧硬编码分支逐字一致)。guard 与 guicaiHandPickMatch 同一道,保留作双保险。
    if(await botDecide('guicaiHandPick', g, seat)) return;
  }
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
    // 夏侯惇【刚烈】弃牌/受伤决策由总线接管(无密钥回退=手牌够2张弃牌、否则受伤,与旧
    // 分支逐字一致)。guard 与 ganglieChoiceMatch 同一道,保留作双保险。
    if(await botDecide('ganglieChoice', g, seat)) return;
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
    // 于吉【蛊惑】质疑判断由总线接管(无密钥回退=固定30%随机质疑,与旧分支逐字一致;
    // AI视角经 buildBotGuhuoVisibleState 不含 d.actualCard,不偷看隐藏信息)。
    if(await botDecide('guhuoQuestion', g, seat)) return;
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
