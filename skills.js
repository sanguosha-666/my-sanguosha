// skills.js — 各武将专属技能/特定锦囊机制的实现,从 game.js 拆分出来(纯重构,行为零变化,
// 这是继 weapons.js(武器/防具特效)之后 game.js 的第二次拆分)。
//
// 【这批函数为什么能安全独立】排查确认它们彼此之间零调用关系(每个技能只有自己的几个
// 函数互相调用,不同技能之间不存在依赖),只共同依赖 game.js 留下的核心编排函数
// (dealDamage/checkWin/pushLog/tx等hub函数,以及 resolveShaUse/resolveTrick/
// finishGuicai 等留在 game.js 的杀/锦囊/判定拦截引擎)。被 render-controls.js(多数)/
// render.js/render-hand.js 的 UI 点击直接调用是正常形态,和 weapons.js 里
// respondHanbingAsk 等函数被 render.js 的 onclick 调用是同一性质,不代表这些技能
// 函数之间有耦合。
//
// 【核实中从最初候选名单里拉回 game.js core 的函数,不在这里】distance/equipDist
// (距离系统,归属 attackRange/canReachSha 同一族)、ensureDeck(牌堆管理,归属
// drawN/judge)、stripUndefined(tx的序列化辅助)、startDying(濒死通用机制,归属
// dealDamage/checkWin/finishDying)、playCard/isTrickCardName(统一出牌入口,归属
// CARD_PLAYS)、aoeEffect/aoeRespond(AOE通用发起/响应机制,归属aoeAdvance)、
// equipCard(装备通用机制)、discardCard/discardCards(弃牌阶段通用机制)、
// endTurn(回合结束通用触发)——这些函数虽然在最初的调用图聚类里因为"组内互调次数
// 低于阈值"被归进了长尾,但它们的真实角色是"所有玩家都会用到的基础规则",不是
// 某个武将/技能专属逻辑,核实后改判定为留在 core。
//
// 【开局武将分配相关函数不在这里】startGame/finishGeneralAssign/respondPickGeneral/
// debugPickGeneral 归入 room-lifecycle.js(和建房/加入/重开同一个"游戏生命周期"
// 主题,不是武将技能)。


// revealPool: 批量亮出牌堆顶 n 张牌,只放进一个数组返回(不进弃牌堆、不记判定日志)——
// 和 judge() 语义不同:judge 是"翻一张+立刻进弃牌堆+判定日志",这里是"批量暂存到公共池,
// 之后可能被人挑走进手牌、也可能被无懈/挑完剩余弃入弃牌堆",五谷丰登专用。
// 牌堆(含重洗弃牌堆)不够 n 张时,能亮多少算多少(不报错、不阻断)。
function revealPool(g, n){
  const pool=[];
  for(let i=0;i<n;i++){
    if(!ensureDeck(g)) break;
    pool.push(g.deck.pop());
  }
  return pool;
}

// respondTuxi: 张辽【突袭】——摸牌阶段放弃摸牌,改为从 1~2 名其他存活玩家的手牌里各随机拿一张。
// targets 是 1~2 个座位号(不含自己、不重复、都要存活);校验不过直接不生效(状态不变)。
// 选到没手牌的目标不算错误,只是拿不到牌,记一条日志说明,不阻断其余目标的结算。
// 和顺手牵羊不同:这是摸牌阶段的替代行为,不是出牌阶段的锦囊,不开无懈可击窗口,同步直接结算。
function respondTuxi(targets){
  tx(g=>{
    if(g.phase!=='draw'||g.turn!==mySeat) return g;
    const me=g.players[mySeat];
    if(!hasCap(me,'tuxi')) return g;
    if(!Array.isArray(targets) || targets.length<1 || targets.length>2) return g;
    const seen=new Set();
    for(const t of targets){
      if(typeof t!=='number' || t===mySeat || !g.players[t] || !g.players[t].alive || seen.has(t)) return g;
      seen.add(t);
    }
    targets.forEach(t=>{
      const tgt=g.players[t];
      if((tgt.hand||[]).length>0){
        const j=Math.floor(Math.random()*tgt.hand.length);
        me.hand.push(tgt.hand.splice(j,1)[0]);
        g.log=pushLog(g.log, me.name+' 发动【突袭】,从 '+tgt.name+' 拿走一张手牌');
      } else {
        g.log=pushLog(g.log, me.name+' 发动【突袭】,但 '+tgt.name+' 没有手牌');
      }
    });
    g.phase='play';
    return g;
  });
}

function triggerJiangOnTarget(g, fromSeat, targetSeat, kind, isRedSha){
  const from=g.players[fromSeat], target=g.players[targetSeat];
  if(kind!=='duel' && !(kind==='sha' && isRedSha)) return;
  if(from && from.alive && hasCap(from,'jiang')){
    drawN(g, fromSeat, 1);
    g.log=pushLog(g.log, from.name+' 发动【激昂】,摸一张牌');
    markSkillSound(g, '激昂');
  }
  if(target && target.alive && hasCap(target,'jiang')){
    drawN(g, targetSeat, 1);
    g.log=pushLog(g.log, target.name+' 发动【激昂】,摸一张牌');
    markSkillSound(g, '激昂');
  }
}

// jieDaoShaRen: 使用者选定 A(有武器)、B(在 A 攻击范围内,不是 A 自己)后提交,弃牌+开无懈窗口。
// 距离校验(B 是否在 A 范围内)就在这一步做,A 后续出杀时不再重复校验(见 respondJiedao 注释)。
function jieDaoShaRen(cardIdx, seatA, seatB){
  tx(g=>{
    if(g.phase!=='play'||g.turn!==mySeat) return g;
    const me=g.players[mySeat];
    const card=me.hand[cardIdx];
    if(!card || card.name!=='借刀杀人') return g;
    const A=g.players[seatA], B=g.players[seatB];
    if(!A || !A.alive || seatA===mySeat || !A.equips.weapon) return g;
    if(!B || !B.alive || seatB===seatA || !canReachSha(g, seatA, seatB)) return g;
    // 诸葛亮【空城】:借刀杀人的B同样是"被指定为这张杀的目标"(官方FAQ明确空城对借刀杀人的B
    // 目标同样生效),不能因为这条路径不走 CARD_PLAYS['杀'].canTarget 就漏了这层保护。
    if(hasCap(B,'kongcheng') && (B.hand||[]).length===0) return g;
    me.hand.splice(cardIdx,1);
    g.discard.push(card);
    g.log=pushLog(g.log, me.name+' 对 '+A.name+' 使用【借刀杀人】,目标 '+B.name);
    markCardSound(g, '借刀杀人', mySeat, card, seatA); // 借刀杀人不走 playCard 统一出口(两步选目标的独立函数),单独补一次
    startTrick(g, {trick:'借刀杀人', from:mySeat, to:seatA, seatB});
    return g;
  });
}

// duanLiang: 徐晃【断粮】——出牌阶段限一次,将一张黑色基本牌或黑色装备牌当【兵粮寸断】
// 使用,距离2以内。官方规则不是"弃任意牌"(此前的实现有误);选中的这张真实牌直接传给
// startTrick 的 info.card,走和真实兵粮寸断完全一样的 startTrick/resolveTrick/回合开始判定
// 流程(可被无懈可击抵消)——resolveTrick 按 info.trick 字段('兵粮寸断')分派,discardOrVanish
// 只看 card.virtual 标记,两者都跟牌的真实身份无关,不需要构造虚拟对象,判定完直接以真实
// 身份进弃牌堆即可。距离校验复用和杀同一套 distance(g,mySeat,targetSeat)<=2。
function duanLiang(cardIdx, targetSeat){
  tx(g=>{
    if(g.phase!=='play'||g.turn!==mySeat) return g;
    const me=g.players[mySeat];
    if(!hasCap(me,'duanliang') || g.duanliangUsed) return g;
    const card=me.hand[cardIdx];
    if(!card) return g;
    const isBlack = card.suit==='♠' || card.suit==='♣';
    const isBasicOrEquip = BASIC_CARDS.includes(card.name) || !!getEquip(card.name);
    if(!isBlack || !isBasicOrEquip) return g;
    if(targetSeat===mySeat || !g.players[targetSeat] || !g.players[targetSeat].alive) return g;
    if(distance(g, mySeat, targetSeat) > 2) return g;
    g.duanliangUsed=true;
    me.hand.splice(cardIdx,1);
    g.log=pushLog(g.log, me.name+' 将【'+card.name+'】当【兵粮寸断】使用,发动【断粮】,目标 '+g.players[targetSeat].name);
    markCardSound(g, '兵粮寸断', mySeat, card, targetSeat); // 念被当作使用的目标牌名(兵粮寸断),不是原始物理牌本身
    startTrick(g, {trick:'兵粮寸断', from:mySeat, to:targetSeat, card:card});
    return g;
  });
}

// qiXi: 甘宁【奇袭】——将任意一张黑色手牌当【过河拆桥】使用。
// 和徐晃【断粮】一样走独立技能动作:真实手牌先离手并进弃牌堆,再按过河拆桥开启无懈窗口。
function qiXi(cardIdx, targetSeat){
  tx(g=>{
    if(g.phase!=='play'||g.turn!==mySeat) return g;
    const me=g.players[mySeat];
    if(!hasCap(me,'qixi')) return g;
    const card=me.hand[cardIdx];
    if(!card) return g;
    const isBlack = card.suit==='♠' || card.suit==='♣';
    if(!isBlack) return g;
    const target=g.players[targetSeat];
    if(targetSeat===mySeat || !target || !target.alive) return g;
    const hasTargetCard = (target.hand||[]).length>0
      || EQUIP_SLOTS.some(s=>target.equips && target.equips[s])
      || (target.delays||[]).length>0;
    if(!hasTargetCard) return g;
    me.hand.splice(cardIdx,1);
    g.discard.push(card);
    g.log=pushLog(g.log, me.name+' 将【'+card.name+'】当【过河拆桥】使用,发动【奇袭】,目标 '+target.name);
    markSkillSound(g, '奇袭');
    markCardSound(g, '过河拆桥', mySeat, card, targetSeat);
    startTrick(g, {trick:'过河拆桥', from:mySeat, to:targetSeat});
    return g;
  });
}

function guoSe(cardIdx, targetSeat){
  tx(g=>{
    if(g.phase!=='play'||g.turn!==mySeat) return g;
    const me=g.players[mySeat];
    if(!hasCap(me,'guose')) return g;
    const card=me.hand[cardIdx];
    if(!card || card.suit!=='♦') return g;
    const target=g.players[targetSeat];
    if(targetSeat===mySeat || !target || !target.alive) return g;
    target.delays = target.delays || [];
    if(target.delays.some(c=>c && c.name==='乐不思蜀')) return g;
    me.hand.splice(cardIdx,1);
    const trickCard={...card, name:'乐不思蜀', originalName:card.name};
    g.log=pushLog(g.log, me.name+' 将【'+card.name+'】当【乐不思蜀】使用,发动【国色】,目标 '+target.name);
    markSkillSound(g, '国色');
    markCardSound(g, '乐不思蜀', mySeat, card, targetSeat);
    startTrick(g, {trick:'乐不思蜀', from:mySeat, to:targetSeat, card:trickCard});
    return g;
  });
}

function maleSeats(g){
  return g.players.map((p,i)=>({p,i})).filter(o=>o.p && o.p.alive && isMale(o.p)).map(o=>o.i);
}

function liJian(cardIdx, fromSeat, toSeat){
  tx(g=>{
    if(g.phase!=='play'||g.turn!==mySeat) return g;
    const me=g.players[mySeat];
    if(!me || !me.alive || !hasCap(me,'lijian') || g.liJianUsed) return g;
    const card=me.hand[cardIdx];
    if(!card) return g;
    const from=g.players[fromSeat], to=g.players[toSeat];
    if(fromSeat===toSeat || !from || !to || !from.alive || !to.alive || !isMale(from) || !isMale(to)) return g;
    if(maleSeats(g).length<2) return g;
    me.hand.splice(cardIdx,1);
    g.discard.push(card);
    g.liJianUsed=true;
    g.log=pushLog(g.log, me.name+' 弃置一张牌发动【离间】,令 '+from.name+' 视为对 '+to.name+' 使用【决斗】');
    markSkillSound(g, '离间');
    triggerJiangOnTarget(g, fromSeat, toSeat, 'duel', false);
    startTrick(g, {trick:'决斗', from:fromSeat, to:toSeat});
    return g;
  });
}

function fanJian(targetSeat){
  tx(g=>{
    if(g.phase!=='play'||g.turn!==mySeat) return g;
    const me=g.players[mySeat], target=g.players[targetSeat];
    if(!me || !target || !me.alive || !target.alive || targetSeat===mySeat) return g;
    if(!hasCap(me,'fanjian') || g.fanJianUsed || (me.hand||[]).length===0) return g;
    g.fanJianUsed=true;
    g.pending={type:'fanjianSuit', seat:mySeat, targetSeat};
    g.phase='fanjianSuit';
    g.log=pushLog(g.log, me.name+' 对 '+target.name+' 发动【反间】,令其选择一种花色');
    markSkillSound(g, '反间');
    return g;
  });
}

function respondFanjianSuit(suit){
  tx(g=>{
    if(g.phase!=='fanjianSuit'||!g.pending||g.pending.type!=='fanjianSuit'||g.pending.targetSeat!==mySeat) return g;
    if(!['♠','♥','♣','♦'].includes(suit)) return g;
    const {seat, targetSeat}=g.pending;
    const zhou=g.players[seat], target=g.players[targetSeat];
    if(!zhou || !target || !zhou.alive || !target.alive || (zhou.hand||[]).length===0){ g.pending=null; g.phase='play'; return g; }
    const idx=Math.floor(Math.random()*zhou.hand.length);
    const card=zhou.hand.splice(idx,1)[0];
    target.hand.push(card);
    const same=card.suit===suit;
    g.log=pushLog(g.log, target.name+' 为【反间】选择 '+suit+',获得并展示 '+card.suit+rankText(card.rank)+'【'+card.name+'】');
    g.pending=null;
    if(!same){
      const interrupted=dealDamage(g, targetSeat, 1, seat, '【反间】', 'fanjian');
      if(interrupted){
        if(g.pending) g.pending.resume={type:'fanjian'};
        return g;
      }
      if(checkWin(g)) return g;
    } else {
      g.log=pushLog(g.log, '花色相同,'+target.name+' 不受到【反间】伤害');
    }
    g.phase='play';
    return g;
  });
}

function recastLianHuan(cardIdx){
  tx(g=>{
    if(g.phase!=='play'||g.turn!==mySeat) return g;
    const me=g.players[mySeat];
    if(!me || !me.alive) return g;
    const card=me.hand[cardIdx];
    const isRealTieSuo = card && card.name==='铁索连环';
    const isPangTongRecast = card && hasCap(me,'lianhuan') && card.suit==='♣';
    if(!isRealTieSuo && !isPangTongRecast) return g;
    me.hand.splice(cardIdx,1);
    g.discard.push(card);
    drawN(g, mySeat, 1);
    if(isRealTieSuo){
      g.log=pushLog(g.log, me.name+' 重铸【铁索连环】,摸一张牌');
      markCardSound(g, '铁索连环', mySeat, card);
    } else {
      g.log=pushLog(g.log, me.name+' 重铸【'+card.name+'】发动【连环】,摸一张牌');
      markSkillSound(g, '连环');
    }
    return g;
  });
}

function guhuoClaimableNames(){
  const excluded = new Set(Object.keys(EQUIPS).concat(Object.keys(DELAY_TRICKS), ['借刀杀人']));
  const names = [...BASIC_CARDS.filter(name=>name!=='闪'), ...Object.keys(CARD_PLAYS).filter(name=>!excluded.has(name))];
  return [...new Set(names)];
}

function guhuoActionId(name){
  return isShaName(name) ? '杀' : name;
}
function guhuoResponseRole(name){
  if(isShaName(name)) return '杀';
  if(name==='闪') return '闪';
  if(name==='桃') return '桃';
  if(name==='无懈可击') return '无懈可击';
  return null;
}
function guhuoResponseNamesForRole(role){
  if(role==='杀') return ['杀','火杀','雷杀'];
  if(role==='闪') return ['闪'];
  if(role==='桃') return ['桃'];
  if(role==='无懈可击') return ['无懈可击'];
  return [];
}
function canStartGuhuoResponse(g, seat, role){
  const me=g.players[seat];
  if(!me || !me.alive || !hasCap(me,'guhuo') || g.guhuoUsed) return false;
  if(role==='闪'){
    if(g.phase==='respond' && g.pending && g.pending.to===seat && !g.pending.noShan) return true;
    return g.phase==='aoeResp' && g.pending && g.pending.to===seat && g.pending.need==='闪';
  }
  if(role==='杀'){
    if(me.jiangchiNoSlash) return false;
    if(g.phase==='duel' && g.pending && g.pending.active===seat) return true;
    return g.phase==='aoeResp' && g.pending && g.pending.to===seat && g.pending.need==='杀';
  }
  if(role==='桃'){
    if(!(g.phase==='dying' && g.pending && g.pending.type==='dying' && g.pending.asking===seat)) return false;
    if(g.wanshaActive && g.wanshaDyingSeat===g.pending.seat){
      const jiaxuSeat=findPlayerWithCap(g,'wansha');
      if(jiaxuSeat!==null && jiaxuSeat===g.turn && seat!==jiaxuSeat && seat!==g.pending.seat) return false;
    }
    return true;
  }
  if(role==='无懈可击'){
    return g.phase==='wuxie' && g.pending && g.pending.type==='wuxie' && g.pending.asking===seat;
  }
  return false;
}
function restoreGuhuoResponse(g, d){
  const r=d && d.response;
  if(!r) return false;
  g.phase=r.phase;
  g.pending=r.pending;
  return true;
}
function resolveGuhuoResponseShan(g, seat, actual, claimed){
  if(!(g.phase==='respond' && g.pending && g.pending.to===seat)) return;
  const me=g.players[seat];
  const attacker=g.players[g.pending.from];
  const needed=hasCap(attacker,'wushuang') ? 2 : 1;
  const played=(g.pending.shanCount||0)+1;
  g.discard.push(actual);
  g.log=pushLog(g.log, me.name+' 【蛊惑】生效,打出【'+claimed.name+'】抵消【杀】'+(needed>1?'（'+played+'/'+needed+'）':''));
  markCardSound(g, '闪', seat, actual);
  if(played<needed){ g.pending.shanCount=played; return; }
  if(maybeStartShaOffsetEffects(g, g.pending.from, seat, g.pending.sourceCard)) return;
  g.pending=null;
  finishSingleShaTarget(g);
}
function resolveGuhuoResponseSha(g, seat, actual, claimed){
  const me=g.players[seat];
  if(g.phase==='duel' && g.pending && g.pending.active===seat){
    const opp=(seat===g.pending.from)?g.pending.to:g.pending.from;
    const needed=(!hasCap(me,'wushuang') && hasCap(g.players[opp],'wushuang')) ? 2 : 1;
    const played=(g.pending.shaCount||0)+1;
    g.discard.push(actual);
    g.log=pushLog(g.log, me.name+' 【蛊惑】生效,打出【'+claimed.name+'】响应【决斗】'+(needed>1?'（'+played+'/'+needed+'）':''));
    markCardSound(g, '杀', seat, actual, opp);
    if(seat===g.turn) g.shaPlayedInDuel=true;
    if(played<needed){ g.pending.shaCount=played; return; }
    g.pending.active=(seat===g.pending.from)?g.pending.to:g.pending.from;
    g.pending.shaCount=0;
    return;
  }
  if(g.phase==='aoeResp' && g.pending && g.pending.to===seat && g.aoe && g.pending.need==='杀'){
    g.discard.push(actual);
    g.log=pushLog(g.log, me.name+' 【蛊惑】生效,打出【'+claimed.name+'】,抵消【'+g.aoe.trick+'】');
    markCardSound(g, '杀', seat, actual);
    aoeAdvance(g, seat);
  }
}
function resolveGuhuoResponseAoe(g, seat, actual, claimed, role){
  const me=g.players[seat];
  if(!(g.phase==='aoeResp' && g.pending && g.pending.to===seat && g.aoe && g.pending.need===role)) return false;
  g.discard.push(actual);
  g.log=pushLog(g.log, me.name+' 【蛊惑】生效,打出【'+claimed.name+'】,抵消【'+g.aoe.trick+'】');
  markCardSound(g, role, seat, actual);
  aoeAdvance(g, seat);
  return true;
}
function resolveGuhuoResponseTao(g, seat, actual, claimed){
  if(!(g.phase==='dying' && g.pending && g.pending.type==='dying' && g.pending.asking===seat)) return;
  const me=g.players[seat];
  const dyingP=g.players[g.pending.seat];
  if(!dyingP) return;
  g.discard.push(actual);
  dyingP.hp++;
  g.log=pushLog(g.log, me.name+' 【蛊惑】生效,将扣置牌当【'+claimed.name+'】对 '+dyingP.name+' 使用,回复1点体力（体力'+dyingP.hp+'）');
  removeBuquCard(g, g.pending.seat);
  if(hasCap(dyingP, 'enyuan') && seat!==g.pending.seat){
    ensureDeck(g);
    drawN(g, seat, 1);
    g.log=pushLog(g.log, dyingP.name+' 回复1点体力,'+me.name+' 发动【恩怨】效果,摸一张牌');
  }
  markCardSound(g, '桃', seat, actual, g.pending.seat);
  if(dyingP.hp>0) finishDying(g, false);
}
function resolveGuhuoResponseWuxie(g, seat, actual, claimed){
  if(!(g.phase==='wuxie' && g.pending && g.pending.type==='wuxie' && g.pending.asking===seat)) return;
  const me=g.players[seat];
  if(!me || !me.alive) return;
  g.discard.push(actual);
  const target = g.pending.depth>0
    ? g.players[g.pending.exclude].name+' 的【无懈可击】'
    : '对 '+g.players[g.pending.to].name+' 的【'+g.pending.trick+'】';
  g.log=pushLog(g.log, me.name+' 【蛊惑】生效,打出【'+claimed.name+'】,抵消了'+target);
  markCardSound(g, '无懈可击', seat, actual);
  g.pending.depth++;
  g.pending.exclude=seat;
  openWuxieRound(g);
}
function resolveGuhuoResponse(g, d){
  if(!restoreGuhuoResponse(g, d)){
    if(d && d.actualCard) g.discard.push(d.actualCard);
    return;
  }
  const role=guhuoResponseRole(d.claimedCard && d.claimedCard.name);
  if(role==='闪' && g.phase==='aoeResp' && resolveGuhuoResponseAoe(g, d.sourceSeat, d.actualCard, d.claimedCard, '闪')){
    return;
  } else if(role==='闪' && g.phase==='respond' && g.pending && g.pending.to===d.sourceSeat){
    resolveGuhuoResponseShan(g, d.sourceSeat, d.actualCard, d.claimedCard);
  } else if(role==='杀' && ((g.phase==='duel' && g.pending && g.pending.active===d.sourceSeat) || (g.phase==='aoeResp' && g.pending && g.pending.to===d.sourceSeat))){
    resolveGuhuoResponseSha(g, d.sourceSeat, d.actualCard, d.claimedCard);
  } else if(role==='桃' && g.phase==='dying' && g.pending && g.pending.asking===d.sourceSeat){
    resolveGuhuoResponseTao(g, d.sourceSeat, d.actualCard, d.claimedCard);
  } else if(role==='无懈可击' && g.phase==='wuxie' && g.pending && g.pending.asking===d.sourceSeat){
    resolveGuhuoResponseWuxie(g, d.sourceSeat, d.actualCard, d.claimedCard);
  } else if(d.actualCard) {
    g.discard.push(d.actualCard);
  }
}

function runGuhuoAsSource(sourceSeat, fn){
  const oldSeat = mySeat;
  mySeat = sourceSeat;
  try {
    return fn();
  } finally {
    mySeat = oldSeat;
  }
}

function guhuoHasLegalTarget(g, sourceSeat, claimedCard, spec){
  if(!spec || !spec.target) return true;
  const me=g.players[sourceSeat];
  if(!me || !me.alive) return false;
  return g.players.some((p, seat)=>{
    if(!p || !p.alive) return false;
    if(seat===sourceSeat && !spec.allowSelf) return false;
    return !spec.canTarget || spec.canTarget(g, me, claimedCard, seat);
  });
}

function nextGuhuoAsker(g, fromSeat){
  const d=g.pending;
  if(!d || d.type!=='guhuoQuestion') return null;
  const answered = new Set(d.answered || []);
  for(let k=1;k<=g.players.length;k++){
    const seat=(fromSeat+k)%g.players.length;
    const p=g.players[seat];
    if(seat!==d.sourceSeat && p && p.alive && !p.chanyuan && !answered.has(seat)) return seat;
  }
  return null;
}

function grantChanyuan(g, seat){
  const p=g.players[seat];
  if(!p || !p.alive || p.chanyuan) return;
  p.chanyuan = true;
  g.log = pushLog(g.log, p.name+' 因质疑真实【蛊惑】获得【缠怨】');
}

function finishGuhuo(g, shouldResolve){
  const d=g.pending;
  if(!d || d.type!=='guhuoQuestion') return;
  const me=g.players[d.sourceSeat];
  const actual=d.actualCard;
  const claimed=d.claimedCard;
  g.pending=null;
  g.phase='play';
  if(!me || !me.alive || !actual || !claimed){
    if(actual) g.discard.push(actual);
    return;
  }
  if(d.response){
    if(!shouldResolve){
      g.discard.push(actual);
      restoreGuhuoResponse(g, d);
      return;
    }
    resolveGuhuoResponse(g, d);
    return;
  }
  if(!shouldResolve){
    g.discard.push(actual);
    return;
  }
  const spec=CARD_PLAYS[guhuoActionId(claimed.name)];
  if(!spec){
    g.discard.push(actual);
    return;
  }
  if(spec.target){
    g.pending={ type:'guhuoTarget', sourceSeat:d.sourceSeat, actualCard:actual, claimedCard:claimed };
    g.phase='guhuoTarget';
    g.log=pushLog(g.log, me.name+' 【蛊惑】生效,请选择【'+claimed.name+'】的目标');
    return;
  }
  g.discard.push(actual);
  g.log=pushLog(g.log, me.name+' 【蛊惑】生效,将扣置牌当【'+claimed.name+'】使用');
  markCardSound(g, claimed.name, d.sourceSeat, actual);
  runGuhuoAsSource(d.sourceSeat, ()=>spec.effect(g, me, claimed, d.sourceSeat));
}

function resolveGuhuoAfterQuestion(g){
  const d=g.pending;
  if(!d || d.type!=='guhuoQuestion') return;
  const actual=d.actualCard;
  const claimed=d.claimedCard;
  const me=g.players[d.sourceSeat];
  const questioners=d.questioners||[];
  const actualName=actual && actual.name;
  const claimedName=claimed && claimed.name;
  const isTrue = actualName===claimedName;
  g.log=pushLog(g.log, (me?me.name:'于吉')+' 翻开【蛊惑】牌:实际为【'+actualName+'】,声明为【'+claimedName+'】');
  if(questioners.length>0 && isTrue){
    questioners.forEach(seat=>grantChanyuan(g, seat));
    finishGuhuo(g, true);
  } else if(questioners.length>0 && !isTrue){
    g.log=pushLog(g.log, '【蛊惑】为假,此牌作废');
    finishGuhuo(g, false);
  } else {
    finishGuhuo(g, true);
  }
}

function startGuhuo(cardIdx, claimedName){
  tx(g=>{
    if(g.phase!=='play'||g.turn!==mySeat) return g;
    const me=g.players[mySeat];
    if(!me || !me.alive || !hasCap(me,'guhuo') || g.guhuoUsed) return g;
    const actual=me.hand[cardIdx];
    if(!actual || !guhuoClaimableNames().includes(claimedName)) return g;
    const spec=CARD_PLAYS[guhuoActionId(claimedName)];
    if(!spec) return g;
    const claimed={ id:actual.id, name:claimedName, suit:actual.suit, rank:actual.rank, originalName:actual.name };
    if(spec.canPlay && !spec.canPlay(g, me, claimed)) return g;
    if(!guhuoHasLegalTarget(g, mySeat, claimed, spec)) return g;
    me.hand.splice(cardIdx,1);
    g.guhuoUsed=true;
    g.pending={ type:'guhuoQuestion', sourceSeat:mySeat, actualCard:actual, claimedCard:claimed, questioners:[], answered:[] };
    g.log=pushLog(g.log, me.name+' 扣置一张手牌发动【蛊惑】,声明为【'+claimedName+'】');
    markSkillSound(g, '蛊惑');
    const asker=nextGuhuoAsker(g, mySeat);
    if(asker===null){
      g.log=pushLog(g.log, '无人可质疑【蛊惑】');
      resolveGuhuoAfterQuestion(g);
    } else {
      g.pending.asking=asker;
      g.phase='guhuoQuestion';
      g.log=pushLog(g.log, g.players[asker].name+' 是否质疑【蛊惑】?');
    }
    return g;
  });
}
function startGuhuoResponse(cardIdx, claimedName){
  tx(g=>{
    const role=guhuoResponseRole(claimedName);
    if(!role || !canStartGuhuoResponse(g, mySeat, role)) return g;
    const me=g.players[mySeat];
    const actual=me && me.hand && me.hand[cardIdx];
    if(!actual || !guhuoResponseNamesForRole(role).includes(claimedName)) return g;
    const claimed={ id:actual.id, name:claimedName, suit:actual.suit, rank:actual.rank, originalName:actual.name };
    me.hand.splice(cardIdx,1);
    g.guhuoUsed=true;
    const oldPhase=g.phase;
    const oldPending=g.pending;
    g.pending={
      type:'guhuoQuestion',
      sourceSeat:mySeat,
      actualCard:actual,
      claimedCard:claimed,
      questioners:[],
      answered:[],
      response:{ phase:oldPhase, pending:oldPending }
    };
    g.log=pushLog(g.log, me.name+' 扣置一张手牌发动【蛊惑】,声明为【'+claimedName+'】');
    markSkillSound(g, '蛊惑');
    const asker=nextGuhuoAsker(g, mySeat);
    if(asker===null){
      g.log=pushLog(g.log, '无人可质疑【蛊惑】');
      resolveGuhuoAfterQuestion(g);
    } else {
      g.pending.asking=asker;
      g.phase='guhuoQuestion';
      g.log=pushLog(g.log, g.players[asker].name+' 是否质疑【蛊惑】?');
    }
    return g;
  });
}

function respondGuhuoQuestion(question){
  tx(g=>{
    if(g.phase!=='guhuoQuestion'||!g.pending||g.pending.type!=='guhuoQuestion'||g.pending.asking!==mySeat) return g;
    const me=g.players[mySeat];
    if(!me || !me.alive || me.chanyuan) return g;
    g.pending.answered = g.pending.answered || [];
    if(!g.pending.answered.includes(mySeat)) g.pending.answered.push(mySeat);
    if(question){
      g.pending.questioners = g.pending.questioners || [];
      if(!g.pending.questioners.includes(mySeat)) g.pending.questioners.push(mySeat);
      g.log=pushLog(g.log, me.name+' 质疑【蛊惑】');
      resolveGuhuoAfterQuestion(g);
      return g;
    }
    g.log=pushLog(g.log, me.name+' 不质疑【蛊惑】');
    const asker=nextGuhuoAsker(g, mySeat);
    if(asker===null){
      g.log=pushLog(g.log, '无人质疑【蛊惑】');
      resolveGuhuoAfterQuestion(g);
    } else {
      g.pending.asking=asker;
      g.log=pushLog(g.log, g.players[asker].name+' 是否质疑【蛊惑】?');
    }
    return g;
  });
}

function guhuoChooseTarget(targetSeat){
  tx(g=>{
    if(g.phase!=='guhuoTarget'||!g.pending||g.pending.type!=='guhuoTarget'||g.pending.sourceSeat!==mySeat) return g;
    const d=g.pending;
    const me=g.players[mySeat];
    const spec=CARD_PLAYS[guhuoActionId(d.claimedCard && d.claimedCard.name)];
    if(!me || !me.alive || !spec || !spec.target) return g;
    if(targetSeat===mySeat && !spec.allowSelf) return g;
    const target=g.players[targetSeat];
    if(!target || !target.alive) return g;
    if(spec.canTarget && !spec.canTarget(g, me, d.claimedCard, targetSeat)) return g;
    g.pending=null;
    g.phase='play';
    g.discard.push(d.actualCard);
    g.log=pushLog(g.log, me.name+' 【蛊惑】生效,将扣置牌当【'+d.claimedCard.name+'】对 '+target.name+' 使用');
    markCardSound(g, d.claimedCard.name, mySeat, d.actualCard, targetSeat);
    spec.effect(g, me, d.claimedCard, targetSeat);
    return g;
  });
}

function cancelGuhuoTarget(){
  tx(g=>{
    if(g.phase!=='guhuoTarget'||!g.pending||g.pending.type!=='guhuoTarget'||g.pending.sourceSeat!==mySeat) return g;
    const d=g.pending;
    if(d.actualCard) g.discard.push(d.actualCard);
    g.log=pushLog(g.log, g.players[mySeat].name+' 取消【蛊惑】目标选择,扣置牌作废');
    g.pending=null;
    g.phase='play';
    return g;
  });
}

// ===== 张郃【巧变】完整版:回合开始时一次性决策"是否发动"+"跳过判定/摸牌/出牌/弃牌
// 阶段之一"(一回合限一次),仅选"出牌阶段"才附带"移动一张装备/判定牌"这个后续效果
// (官方原文:"你可以弃置一张手牌并跳过一个阶段(准备阶段和结束阶段除外),若为:摸牌阶段,
// 你可以获得至多两名角色各一张手牌;出牌阶段,你可以移动场上一张牌。"——这个项目目前
// 只实现"跳过阶段"+"出牌阶段可移动装备/判定牌"这部分,"摸牌阶段可获得两名角色各一张
// 手牌"这个官方原文里的额外效果暂不实现,是简化,不是遗漏,见 CLAUDE.md 记录)。
//
// continueQiaobianCheck: startTurn 里紧接着"声明轮到谁"之后调用,必须在 resolveDelayTricks
// (真正的判定阶段)之前问,因为"跳过判定阶段"这个选项要求判定阶段还没发生。没有这个能力
// 或没有手牌(付不起弃牌的代价)则直接放行到原有链路,不放行的人完全不受这次改动影响。
// continueGuanxingCheck: 诸葛亮【观星】,回合开始时紧跟着"声明轮到谁"之后调用,比
// continueQiaobianCheck 更早——观星是"准备阶段"的交互,巧变是"回合开始时(判定阶段之前)"
// 的交互,准备阶段本来就在判定阶段之前,所以观星要插在链路里更靠前的位置。没有这个能力
// 或牌堆(含重洗弃牌堆)一张都没有则直接放行到原有链路(继续走巧变检查),不受这次改动影响。
// continueHuashenChangeCheckAtTurnStart: 左慈"更改化身"回合开始一侧的入口,插在
// startTurn 链路最前面(比观星更早)——更改化身本身不涉及判定/摸牌逻辑,放在链路最前面
// 只是为了和回合结束一侧(finishTurn -> continueHuashenChangeCheckAtTurnEnd -> ...)
// 对称,没有必须更早/更晚的规则依据。没有化身能力或尚未声明借用技能(huashenGeneral为
// null,说明还在huashenPick阶段或从未借用过)则直接放行到continueGuanxingCheck,不受
// 这次改动影响。
function continueHuashenChangeCheckAtTurnStart(g, seat){
  const p = g.players[seat];
  if(p && p.alive && hasCap(p,'huashen') && p.huashenGeneral!==null){
    g.pending = {type:'huashenChangeAskStart', seat};
    g.phase = 'huashenChangeAskStart';
    g.log = pushLog(g.log, p.name+' 是否更改【化身】声明的技能…');
    return;
  }
  continueGuanxingCheck(g, seat);
}
// respondHuashenChangeAskStart/respondHuashenChangePickStart: 回合开始阶段"是否更改
// 化身"的询问及两级选择结算,和回合结束一侧(respondHuashenChangeAskEnd/PickEnd,见
// room-lifecycle.js)是两个独立的respond函数——不是同一个函数靠source字段分支,这样
// 各自的收尾(继续continueGuanxingCheck vs continueBiyueCheck)天然不会写错。
function respondHuashenChangeAskStart(activate){
  tx(g=>{
    if(g.phase!=='huashenChangeAskStart' || !g.pending || g.pending.type!=='huashenChangeAskStart' || g.pending.seat!==mySeat) return g;
    const me = g.players[mySeat];
    if(!me || !me.alive){ g.pending=null; g.phase='draw'; return g; }
    const seat = g.pending.seat;
    if(!activate){
      g.log = pushLog(g.log, me.name+'：不更改【化身】');
      g.pending = null;
      continueGuanxingCheck(g, seat);
      return g;
    }
    g.pending = {type:'huashenChangePickStart', seat};
    g.phase = 'huashenChangePickStart';
    g.log = pushLog(g.log, me.name+' 重新选择借用一名武将的技能…');
    return g;
  });
}
function respondHuashenChangePickStart(generalId, skillName){
  tx(g=>{
    if(g.phase!=='huashenChangePickStart' || !g.pending || g.pending.type!=='huashenChangePickStart' || g.pending.seat!==mySeat) return g;
    const me = g.players[mySeat];
    const seat = g.pending.seat;
    if(!me || !validateHuashenPick(me.huashenPool, generalId, skillName)){ return g; }
    me.huashenGeneral = generalId;
    me.huashenSkillName = skillName;
    g.log = pushLog(g.log, me.name+' 已更改【化身】声明的技能');
    g.pending = null;
    continueGuanxingCheck(g, seat);
    return g;
  });
}
function continueGuanxingCheck(g, seat){
  const p=g.players[seat];
  if(hasCap(p,'guanxing')){
    const aliveN = g.players.filter(pp=>pp&&pp.alive).length;
    const n = Math.min(5, aliveN);
    if(ensureDeck(g) && g.deck.length>0){
      const actualN = Math.min(n, g.deck.length); // 牌堆不够X张时,有多少看多少,不报错不卡死
      // g.deck 数组尾部代表"牌堆顶"(judge()/drawN() 都用 g.deck.pop() 取牌),这里从数组末尾
      // 切出 actualN 张——cards 里下标越大的牌离"牌堆顶"越近,cards[actualN-1] 就是原本
      // 会被最先翻到的那张。
      const cards = g.deck.splice(g.deck.length-actualN, actualN);
      g.pending = { type:'guanxingReview', seat, cards };
      g.phase = 'guanxingReview';
      g.log = pushLog(g.log, p.name+' 发动【观星】,正在查看牌堆顶…'); // 不写牌面,私密信息
      return;
    }
  }
  continueQiaobianCheck(g, seat);
}

// respondGuanxing: 观星发动者提交排序结果。topOrder/bottomOrder 是 g.pending.cards 的下标
// 数组(两者合起来必须恰好覆盖每个下标一次)。约定:topOrder 数组的**最后一个元素**对应的
// 那张牌,是"放回牌堆顶之后最先会被翻到的那张"(和 judge() 用 pop() 从数组末尾取牌的方向
// 严格对齐——这是最容易弄反的地方,前端UI组装 topOrder 时必须遵守这个约定,不能想当然按
// "数组第一个=最先翻到"来传)。bottomOrder 里的牌整体放到牌堆最底部(数组最前面),牌堆见底
// 前基本不会被摸到/判定到,顺序本身影响很小。
function respondGuanxing(topOrder, bottomOrder){
  tx(g=>{
    if(g.phase!=='guanxingReview'||!g.pending||g.pending.type!=='guanxingReview'||g.pending.seat!==mySeat) return g;
    const cards = g.pending.cards;
    const allIdx = [...(topOrder||[]), ...(bottomOrder||[])];
    // 校验:两个数组合起来必须恰好是cards的每个下标各出现一次,不能多选/漏选/重复选
    if(allIdx.length!==cards.length || new Set(allIdx).size!==cards.length || !allIdx.every(i=>Number.isInteger(i)&&i>=0&&i<cards.length)) return g;
    const topCards = topOrder.map(i=>cards[i]);
    const bottomCards = bottomOrder.map(i=>cards[i]);
    g.deck = [...bottomCards, ...g.deck, ...topCards];
    g.pending = null;
    g.log = pushLog(g.log, g.players[mySeat].name+' 【观星】结束'); // 不写具体怎么排的,私密信息
    continueQiaobianCheck(g, mySeat); // 继续走向巧变检查->判定阶段,原有链路不变
    return g;
  });
}

function continueQiaobianCheck(g, seat){
  const p=g.players[seat];
  if(hasCap(p,'qiaobian') && (p.hand||[]).length>0){
    g.pending={type:'qiaobianTurnStart', seat};
    g.phase='qiaobianTurnStart';
    g.log=pushLog(g.log, p.name+' 是否发动【巧变】…');
    return;
  }
  continueShensu1Check(g, seat);
}
// 夏侯渊【神速1】:必须在判定区结算(resolveDelayTricks)之前询问。
// 旧实现挂在 enterDrawPhase(判定之后),导致「跳过判定」永远晚一拍——官方是准备阶段跳过判定+摸牌。
function continueShensu1Check(g, seat){
  const p=g.players[seat];
  // 【断点2修复】检查 shensuUsed1(神速1自己的标志位),不再检查共享的 shensuUsed——
  // 神速1/神速2 各自独立限一次,发动过神速2不该挡住神速1这个询问(理论上神速1的开启点
  // 本来就早于神速2,这个顺序目前不会真的撞上,但字段语义要对,不能沿用共享写法)。
  if(p && p.alive && hasCap(p,'shensu') && !g.shensuUsed1 && !g.shensuSkipJudgingAndDraw){
    g.pending = { type: 'shensuChoose1', seat };
    g.phase = 'shensuChoose1';
    g.log = pushLog(g.log, p.name + ' 可以发动【神速】跳过判定和摸牌阶段');
    return;
  }
  continueDelayResolution(g, seat);
}

// qiaobianDecline: 仅 pending.seat 本人可响应,"不发动"才需要真正提交(会改变共享状态,
// 放行到原有链路)。"发动"不需要单独一次网络往返——点"发动"只是让客户端进入"选牌+选阶段"
// 的本地界面(和徐晃断粮同款,选择过程纯客户端状态),真正生效的提交是 qiaobianDeclare。
function qiaobianDecline(){
  tx(g=>{
    if(g.phase!=='qiaobianTurnStart'||!g.pending||g.pending.type!=='qiaobianTurnStart'||g.pending.seat!==mySeat) return g;
    g.log=pushLog(g.log, g.players[mySeat].name+'：不发动【巧变】');
    g.pending=null;
    continueShensu1Check(g, mySeat);
    return g;
  });
}

// respondQiaobianMove: 仅 pending.seat 本人可响应。move 为 null(不移动)或 {kind,srcSeat,
// slot/idx,dstSeat}(复用 doQiaobianMove 校验+执行)。移动是否合法/是否发生,都不影响
// "跳过出牌阶段"这个已经生效的效果——最后统一设 skipPlay 并继续原有链路。
function respondQiaobianMove(move){
  tx(g=>{
    if(g.phase!=='qiaobianMove'||!g.pending||g.pending.type!=='qiaobianMove'||g.pending.seat!==mySeat) return g;
    if(move) doQiaobianMove(g, move);
    g.pending=null;
    g.skipPlay=true;
    continueShensu1Check(g, mySeat);
    return g;
  });
}

// doQiaobianMove: 独立重新校验合法性后执行移动;不合法就安静跳过(巧变本身——弃牌+跳过
// 阶段——已经生效,不受影响,只是这次没有移动发生)。装备移动触发 onLoseEquip(和拆装备/
// 换装同性质,源玩家视为失去这件装备);延时锦囊移动不触发任何钩子(项目里没有对应的
// "失去判定牌"钩子)。
function doQiaobianMove(g, move){
  const src=g.players[move.srcSeat], dst=g.players[move.dstSeat];
  if(!src || !dst || !src.alive || !dst.alive || move.srcSeat===move.dstSeat) return;
  if(move.kind==='equip'){
    const slot=move.slot;
    if(!EQUIP_SLOTS.includes(slot)) return;
    const card=src.equips[slot];
    if(!card || dst.equips[slot]) return; // 源槽为空,或目标同类型槽已被占用
    src.equips[slot]=null;
    dst.equips[slot]=card;
    g.log=pushLog(g.log, '【巧变】把 '+src.name+' 的装备【'+card.name+'】移到了 '+dst.name);
    triggerHook(g, move.srcSeat, 'onLoseEquip', {count:1});
  } else if(move.kind==='delay'){
    const idx=move.idx;
    const card=(src.delays||[])[idx];
    if(!card) return;
    dst.delays = dst.delays || [];
    if(dst.delays.some(c=>c.name===card.name)) return; // 目标判定区已有同名延时锦囊
    src.delays.splice(idx,1);
    dst.delays.push(card);
    g.log=pushLog(g.log, '【巧变】把 '+src.name+' 判定区的【'+card.name+'】移到了 '+dst.name+' 的判定区');
  }
}

// ===== 伤害 / 胜负 统一处理(为日后武将技能铺路) =====
// dealDamage: 只负责扣血 + 死亡判定挂起 + 相关日志,不推进阶段、不判胜负。
// 返回值语义:是否已挂起进入濒死流程(true = 调用方应立即 return,后续收尾延后到 finishDying 处理;
// 不代表最终真死——濒死可能被桃救回)。sourceSeat 暂存伤害来源,供日后技能使用。
function tianxiangHeartOptions(p){
  const list=[];
  (p.hand||[]).forEach((card, idx)=>{
    if(cardSuitForPlayer(p, card)==='♥') list.push({idx, card});
  });
  return list;
}

function tianxiangTargets(g, seat){
  return g.players.map((p,i)=>({p,i})).filter(o=>o.p && o.p.alive && o.i!==seat).map(o=>o.i);
}

function maybeStartTianxiang(g, seat, amount, sourceSeat, reason, srcType, sourceCard){
  const p=g.players[seat];
  if(!p || !p.alive || !hasCap(p,'tianxiang')) return false;
  const hearts=tianxiangHeartOptions(p);
  const targets=tianxiangTargets(g, seat);
  if(hearts.length===0 || targets.length===0) return false;
  g.pending={type:'tianxiang', seat, amount, sourceSeat, reason, srcType, targets, resume:{type:srcType}};
  if(sourceCard!==undefined) g.pending.sourceCard=sourceCard;
  g.phase='tianxiang';
  g.log=pushLog(g.log, p.name+' 是否发动【天香】,弃置一张红桃手牌转移此次伤害…');
  return true;
}

function zhengyiRecipient(g, seat){
  const p=g.players[seat];
  const r=g.liRangRecord;
  if(!p || !p.alive || !hasCap(p,'zhengyi') || !r || r.round!==g.roundNum || r.from!==seat) return null;
  const target=g.players[r.to];
  if(!target || !target.alive || r.to===seat) return null;
  return r.to;
}

function maybeStartZhengyi(g, seat, amount, sourceSeat, reason, srcType, sourceCard){
  const p=g.players[seat];
  if(!p || !p.alive || !hasCap(p,'zhengyi')) return false;
  if(p.zhengyiTurn===g.turn) return false;
  const asking=zhengyiRecipient(g, seat);
  if(asking===null) return false;
  p.zhengyiTurn=g.turn;
  g.pending={type:'zhengyi', seat, asking, amount, sourceSeat, reason, srcType, resume:{type:srcType}};
  if(sourceCard!==undefined) g.pending.sourceCard=sourceCard;
  g.phase='zhengyi';
  g.log=pushLog(g.log, p.name+' 本回合首次受到伤害,询问 '+g.players[asking].name+' 是否发动【争义】替其承受…');
  return true;
}

function finishTianxiangTransfer(g, originalResume, originalSeat, drawSeat){
  const target=g.players[drawSeat];
  if(target && target.alive){
    // hp 可以为负(见 dealDamage 的注释),所以"已损失体力值"不能直接写 maxHp-hp:
    // hp=-2/maxHp=4 时会算出 6、比体力上限还多,承伤者会多摸 2 张。先把 hp 钳进可用区间再相减。
    const lost=Math.max(0, target.maxHp - Math.max(0, target.hp));
    if(lost>0){
      drawN(g, drawSeat, lost);
      g.log=pushLog(g.log, target.name+' 因【天香】摸'+lost+'张牌');
    } else {
      g.log=pushLog(g.log, target.name+' 未损失体力,【天香】不摸牌');
    }
  }
  resumeAfterInterrupt(g, originalResume, originalSeat);
}

function wrapPendingForTianxiang(g, originalResume, originalSeat, drawSeat){
  if(g.pending && g.pending.resume){
    g.pending.resume={type:'tianxiang', inner:g.pending.resume, originalResume, originalSeat, drawSeat};
  }
}

function chainedDamageTargets(g, seat){
  return (g.players||[])
    .map((p,i)=>({p,i}))
    .filter(o=>o.i!==seat && o.p && o.p.alive && o.p.chained)
    .map(o=>o.i);
}

function prepareChainedDamage(g, seat, amount, sourceSeat, reason, srcType, sourceCard){
  const nature=cardDamageNature(sourceCard);
  const p=g.players[seat];
  if(!nature || !p || !p.chained || amount<=0) return false;
  const targets=chainedDamageTargets(g, seat);
  p.chained=false;
  g.log=pushLog(g.log, p.name+' 解除连环状态');
  // 传导一旦开始，参与本次传导的角色同时解除连环状态；队列保存目标，即使前一名
  // 进入濒死并经过 Firebase 回读，也不会丢失后续角色。
  targets.forEach(targetSeat=>{
    const target=g.players[targetSeat];
    if(target) target.chained=false;
  });
  if(!targets.length) return false;
  g.chainDamageQueue={
    originalSeat:seat,targets,idx:0,amount,sourceSeat,reason,srcType,sourceCard,
    nature,finalResume:null
  };
  return true;
}

function advanceChainedDamage(g){
  const q=g.chainDamageQueue;
  if(!q) return false;
  while(q.idx<q.targets.length){
    const targetSeat=q.targets[q.idx++];
    const target=g.players[targetSeat];
    if(!target || !target.alive) continue;
    g.log=pushLog(g.log, target.name+' 被连环传导,解除连环状态');
    const interrupted=dealDamage(g,targetSeat,q.amount,q.sourceSeat,
      '连环传导'+(damageNatureText(q.nature)?'('+damageNatureText(q.nature)+')':''),
      q.srcType,q.sourceCard,false,false,true);
    if(interrupted) return true;
  }
  return false;
}

function respondTianxiang(choice, targetSeat){
  tx(g=>{
    if(g.phase!=='tianxiang'||!g.pending||g.pending.type!=='tianxiang'||g.pending.seat!==mySeat) return g;
    const d=g.pending;
    const me=g.players[mySeat];
    if(!me || !me.alive) return g;
    const originalResume=d.resume || {type:d.srcType};
    if(!choice){
      g.pending=null;
      const interrupted=dealDamage(g, d.seat, d.amount, d.sourceSeat, d.reason, d.srcType, d.sourceCard, true);
      if(interrupted) return g;
      resumeAfterInterrupt(g, originalResume, d.seat);
      return g;
    }
    const target=g.players[targetSeat];
    if(!target || !target.alive || targetSeat===d.seat || !(d.targets||[]).includes(targetSeat)) return g;
    const card=me.hand[choice.idx];
    if(!card || cardSuitForPlayer(me, card)!=='♥') return g;
    me.hand.splice(choice.idx,1);
    g.discard.push(card);
    g.pending=null;
    g.log=pushLog(g.log, me.name+' 弃置【'+card.name+'】发动【天香】,将此次伤害转移给 '+target.name);
    markSkillSound(g, '天香');
    const interrupted=dealDamage(g, targetSeat, d.amount, d.sourceSeat, d.reason || '【天香】转移', d.srcType, d.sourceCard, true);
    if(interrupted){
      wrapPendingForTianxiang(g, originalResume, d.seat, targetSeat);
      return g;
    }
    finishTianxiangTransfer(g, originalResume, d.seat, targetSeat);
    return g;
  });
}

function wrapPendingForZhengyi(g, originalResume, originalSeat){
  if(g.pending && g.pending.resume){
    g.pending.resume={type:'zhengyi', inner:g.pending.resume, originalResume, originalSeat};
  }
}

function respondZhengyi(activate){
  tx(g=>{
    if(g.phase!=='zhengyi'||!g.pending||g.pending.type!=='zhengyi'||g.pending.asking!==mySeat) return g;
    const d=g.pending;
    const kong=g.players[d.seat], me=g.players[mySeat];
    if(!kong || !kong.alive || !me || !me.alive) return g;
    const originalResume=d.resume || {type:d.srcType};
    g.pending=null;
    if(!activate){
      g.log=pushLog(g.log, me.name+'：不发动【争义】');
      const interrupted=dealDamage(g, d.seat, d.amount, d.sourceSeat, d.reason, d.srcType, d.sourceCard, false, true);
      if(interrupted) return g;
      resumeAfterInterrupt(g, originalResume, d.seat);
      return g;
    }
    g.log=pushLog(g.log, me.name+' 发动【争义】,替 '+kong.name+' 承受此次伤害');
    markSkillSound(g, '争义');
    const interrupted=dealDamage(g, mySeat, d.amount, d.sourceSeat, d.reason || '【争义】转移', d.srcType, d.sourceCard, false, true);
    if(interrupted){
      wrapPendingForZhengyi(g, originalResume, d.seat);
      return g;
    }
    resumeAfterInterrupt(g, originalResume, d.seat);
    return g;
  });
}

// ===== 荀彧【驱虎/节命】:拼点与受伤后补牌 =====
function pointText(card){ return card ? card.suit+rankText(card.rank)+'【'+card.name+'】' : '?'; }

function quhuDamageTargets(g, targetSeat){
  return g.players.map((p,i)=>({p,i}))
    .filter(o=>o.p && o.p.alive && o.i!==targetSeat && canReachSha(g, targetSeat, o.i))
    .map(o=>o.i);
}

function finishQuhu(g){
  g.pending=null;
  if(checkWin(g)) return;
  g.phase='play';
}

function quHu(cardIdx, targetSeat){
  tx(g=>{
    if(g.phase!=='play'||g.turn!==mySeat) return g;
    const me=g.players[mySeat], target=g.players[targetSeat];
    if(!me || !target || !me.alive || !target.alive || !hasCap(me,'quhu') || g.quHuUsed) return g;
    if(targetSeat===mySeat || target.hp<=me.hp || (me.hand||[]).length===0 || (target.hand||[]).length===0) return g;
    const card=me.hand[cardIdx];
    if(!card) return g;
    me.hand.splice(cardIdx,1);
    g.discard.push(card);
    g.quHuUsed=true;
    g.pending={type:'quhuRespond', seat:mySeat, targetSeat, selfCard:card};
    g.phase='quhuRespond';
    g.log=pushLog(g.log, me.name+' 发动【驱虎】,与 '+target.name+' 拼点');
    markSkillSound(g, '驱虎');
    return g;
  });
}

function respondQuhu(cardIdx){
  tx(g=>{
    if(g.phase!=='quhuRespond'||!g.pending||g.pending.type!=='quhuRespond'||g.pending.targetSeat!==mySeat) return g;
    const {seat, targetSeat, selfCard}=g.pending;
    const xun=g.players[seat], target=g.players[targetSeat];
    if(!xun || !target || !xun.alive || !target.alive){ finishQuhu(g); return g; }
    const card=target.hand[cardIdx];
    if(!card) return g;
    target.hand.splice(cardIdx,1);
    g.discard.push(card);
    const quhuWin = (selfCard.rank||0) > (card.rank||0);
    g.log=pushLog(g.log, xun.name+' 出 '+pointText(selfCard)+',对方 '+target.name+' 出 '+pointText(card)+',拼点'+(quhuWin?'荀彧赢':'荀彧没赢'));
    if(quhuWin){
      const targets=quhuDamageTargets(g, targetSeat);
      if(targets.length===0){
        g.log=pushLog(g.log, '但 '+target.name+' 攻击范围内没有可伤害目标');
        finishQuhu(g);
        return g;
      }
      g.pending={type:'quhuDamageChoice', seat, targetSeat, targets};
      g.phase='quhuDamageChoice';
      g.log=pushLog(g.log, '选择 '+target.name+' 攻击范围内一名角色受到1点伤害');
      return g;
    }
    g.log=pushLog(g.log, target.name+' 对其造成1点伤害');
    g.pending=null;
    const interrupted=dealDamage(g, seat, 1, targetSeat, '【驱虎】', 'quhu');
    if(interrupted){
      if(g.pending) g.pending.resume={type:'quhu'};
      return g;
    }
    if(checkWin(g)) return g;
    g.phase='play';
    return g;
  });
}

function respondQuhuDamage(targetSeat){
  tx(g=>{
    if(g.phase!=='quhuDamageChoice'||!g.pending||g.pending.type!=='quhuDamageChoice'||g.pending.seat!==mySeat) return g;
    const {targetSeat:sourceSeat, targets}=g.pending;
    if(!Array.isArray(targets) || !targets.includes(targetSeat)) return g;
    const source=g.players[sourceSeat], target=g.players[targetSeat];
    if(!source || !target || !source.alive || !target.alive){ finishQuhu(g); return g; }
    g.pending=null;
    const interrupted=dealDamage(g, targetSeat, 1, sourceSeat, '【驱虎】', 'quhu');
    if(interrupted){
      if(g.pending) g.pending.resume={type:'quhu'};
      return g;
    }
    if(checkWin(g)) return g;
    g.phase='play';
    return g;
  });
}

// ===== 太史慈【天义】:拼点与杀使用规则改变 =====
// 使用荀彧驱虎的pointText函数（在567行）

function finishTianyi(g){
  g.pending=null;
  if(checkWin(g)) return;
  g.phase='play';
}

function startTianyi() {
  tx(g => {
    if (g.phase !== 'play' || g.turn !== mySeat) return g;
    const me = g.players[mySeat];
    if (!me || !me.alive || !hasCap(me, 'tianyi') || g.tianyiUsed) return g;
    
    // 进入天义选择模式：先选牌，再选目标
    g.pending = {
      type: 'tianyiPickCard',
      seat: mySeat
    };
    g.phase = 'tianyiPickCard';
    g.log = pushLog(g.log, `${me.name} 发动【天义】,请选择一张手牌用于拼点`);
    markSkillSound(g, '天义');
    
    return g;
  });
}

function pickTianyiCard(cardIdx) {
  tx(g => {
    if (g.pending.type !== 'tianyiPickCard' || g.pending.seat !== mySeat) return g;
    const me = g.players[mySeat];
    if (!me || !me.alive) return g;
    
    const card = me.hand[cardIdx];
    if (!card) return g;
    
    // 进入选择目标阶段
    g.pending = {
      type: 'tianyiPickTarget',
      seat: mySeat,
      cardIdx: cardIdx
    };
    g.phase = 'tianyiPickTarget';
    g.log = pushLog(g.log, `${me.name} 选择了拼点牌,请选择一名其他角色拼点`);
    
    return g;
  });
}

function pickTianyiTarget(cardIdx, targetSeat) {
  tx(g => {
    // 天义选目标阶段 phase 是 tianyiPickTarget(不是 play);UI 走客户端 tianyiMode 时也可能直接调本函数
    const inPendingPick = g.pending && g.pending.type === 'tianyiPickTarget' && g.pending.seat === mySeat;
    const inClientMode = g.phase === 'play' && g.turn === mySeat && hasCap(g.players[mySeat], 'tianyi') && !g.tianyiUsed;
    if (!inPendingPick && !inClientMode) return g;
    const me = g.players[mySeat];
    const target = g.players[targetSeat];
    
    if (!me || !me.alive || !target || !target.alive) return g;
    if (targetSeat === mySeat) return g; // 不能选自己
    if ((target.hand || []).length === 0) return g; // 目标没有手牌
    
    const card = me.hand[cardIdx];
    if (!card) return g;
    
    // 执行拼点：从玩家手牌中移除拼点牌
    me.hand.splice(cardIdx, 1);
    g.discard.push(card);
    
    // 设置拼点响应状态
    g.tianyiUsed = true;
    g.pending = {
      type: 'tianyiRespond',
      seat: mySeat,
      targetSeat: targetSeat,
      selfCard: card
    };
    g.phase = 'tianyiRespond';
    g.log = pushLog(g.log, `${me.name} 发动【天义】,与 ${target.name} 拼点`);
    
    return g;
  });
}

function respondTianyi(cardIdx) {
  tx(g => {
    if (g.phase !== 'tianyiRespond' || !g.pending || g.pending.type !== 'tianyiRespond' || 
        g.pending.targetSeat !== mySeat) return g;
    
    const {seat, targetSeat, selfCard} = g.pending;
    const source = g.players[seat];
    const target = g.players[targetSeat];
    
    if (!source || !target || !source.alive || !target.alive) {
      finishTianyi(g);
      return g;
    }
    
    const card = target.hand[cardIdx];
    if (!card) return g;
    
    // 移除目标的拼点牌
    target.hand.splice(cardIdx, 1);
    g.discard.push(card);
    
    // 判断拼点结果：点数大的赢（数值比较）
    const tianyiWin = (selfCard.rank || 0) > (card.rank || 0);
    
    g.log = pushLog(g.log, 
      `${source.name} 出 ${pointText(selfCard)}, ${target.name} 出 ${pointText(card)},拼点${tianyiWin ? source.name + '赢' : source.name + '没赢'}`);
    
    if (tianyiWin) {
      // 赢：设置本阶段的增益效果
      g.tianyiWin = true;
      g.log = pushLog(g.log, `${source.name} 【天义】拼点赢,本阶段内使用【杀】的次数上限+1、无距离限制、目标数上限+1`);
    } else {
      // 输：设置本阶段的禁用效果
      g.tianyiLose = true;
      g.log = pushLog(g.log, `${source.name} 【天义】拼点输,本阶段内不能使用【杀】`);
    }
    
    finishTianyi(g);
    return g;
  });
}

function cancelTianyi() {
  tx(g => {
    if (g.pending && (g.pending.type === 'tianyiPickCard' || g.pending.type === 'tianyiPickTarget') && 
        g.pending.seat === mySeat) {
      g.pending = null;
      g.phase = 'play';
      g.log = pushLog(g.log, `${g.players[mySeat].name} 取消发动【天义】`);
    }
    return g;
  });
}

function finishJieming(g, resume, seat){
  g.pending=null;
  if(checkWin(g)) return;
  resumeAfterInterrupt(g, resume, seat);
}

function continueJieming(g, seat, remaining, resume){
  if(remaining>0 && g.players[seat] && g.players[seat].alive){
    g.pending={type:'jiemingAsk', seat, remaining, resume};
    g.phase='jiemingAsk';
    g.log=pushLog(g.log, g.players[seat].name+' 是否继续发动【节命】('+remaining+'次)…');
  } else {
    finishJieming(g, resume, seat);
  }
}

function respondJieming(targetSeat){
  tx(g=>{
    if(g.phase!=='jiemingAsk'||!g.pending||g.pending.type!=='jiemingAsk'||g.pending.seat!==mySeat) return g;
    const {seat, remaining, resume}=g.pending;
    const self=g.players[seat];
    if(targetSeat===null || targetSeat===undefined){
      g.log=pushLog(g.log, self.name+'：不发动【节命】');
      continueJieming(g, seat, remaining-1, resume);
      return g;
    }
    const target=g.players[targetSeat];
    if(!target || !target.alive) return g;
    const limit=Math.min(target.maxHp, 5);
    const n=Math.max(0, limit-(target.hand||[]).length);
    if(n>0) drawN(g, targetSeat, n);
    g.log=pushLog(g.log, self.name+' 发动【节命】,令 '+target.name+(n>0?' 摸'+n+'张牌':' 手牌已达上限,不摸牌'));
    markSkillSound(g, '节命');
    continueJieming(g, seat, remaining-1, resume);
    return g;
  });
}

// ===== 左慈【新生】:每受到1点伤害后可选择发动一次,获得一个新武将加入 huashenPool =====
// 完全照抄荀彧【节命】的 remaining 计数循环四段式(continueJieming/respondJieming/
// finishJieming 同构),不重新发明:GENERALS.zuoci.hooks.onDamaged 只负责开第一次
// 询问(remaining=amount),每次响应完(不管发动与否)都调 continueXinsheng 推进计数,
// remaining 耗尽才收尾。
function continueXinsheng(g, seat, remaining, resume){
  if(remaining>0 && g.players[seat] && g.players[seat].alive){
    g.pending={type:'xinshengAsk', seat, remaining, resume};
    g.phase='xinshengAsk';
    g.log=pushLog(g.log, g.players[seat].name+' 是否继续发动【新生】('+remaining+'次)…');
  } else {
    finishXinsheng(g, resume, seat);
  }
}

function respondXinshengAsk(activate){
  tx(g=>{
    if(g.phase!=='xinshengAsk'||!g.pending||g.pending.type!=='xinshengAsk'||g.pending.seat!==mySeat) return g;
    const {seat, remaining, resume}=g.pending;
    const self=g.players[seat];
    if(!activate){
      g.log=pushLog(g.log, self.name+'：不发动【新生】');
      continueXinsheng(g, seat, remaining-1, resume);
      return g;
    }
    // 排除条件统一:候选 = GENERAL_IDS - ['zuoci', ...p.huashenPool] ——和
    // checkHuashenBeforeAssign 生成初始库存那一处完全同一条规则,不额外排除
    // "场上其他玩家在用的武将"。
    const excluded=['zuoci', ...self.huashenPool];
    const avail=GENERAL_IDS.filter(id=>!excluded.includes(id));
    if(avail.length===0){
      g.log=pushLog(g.log, self.name+' 【新生】没有可获得的新武将了');
      continueXinsheng(g, seat, remaining-1, resume);
      return g;
    }
    const picked=avail[Math.floor(Math.random()*avail.length)];
    self.huashenPool.push(picked);
    g.log=pushLog(g.log, self.name+' 发动【新生】,获得一个新的武将');
    markSkillSound(g, '新生');
    continueXinsheng(g, seat, remaining-1, resume);
    return g;
  });
}

function finishXinsheng(g, resume, seat){
  g.pending=null;
  if(checkWin(g)) return;
  resumeAfterInterrupt(g, resume, seat);
}

// ===== 郭嘉【遗计】:受伤后可选发动,看牌堆顶2张、分给任意角色(含自己) =====
// respondYijiAsk: 仅本人(pending.seat)可响应。不发动/发动都要用 resumeAfterInterrupt 接回被
// 打断的流程(resume 是 onDamaged 钩子里存的 {type:srcType,...},和濒死解决同一套约定)——
// 不能像最初设想那样硬编码 phase='play',因为遗计可能在决斗/AOE/延时锦囊判定/骁果等非
// "出牌阶段互殴"的场景中触发,这些场景各自需要接回不同的尾巴。
function respondYijiAsk(activate){
  tx(g=>{
    if(g.phase!=='yijiAsk'||!g.pending||g.pending.type!=='yijiAsk'||g.pending.seat!==mySeat) return g;
    const seat=mySeat, resume=g.pending.resume;
    if(!activate){
      g.log=pushLog(g.log, g.players[seat].name+'：不发动【遗计】');
      g.pending=null;
      if(checkWin(g)) return g;
      resumeAfterInterrupt(g, resume, seat);
      return g;
    }
    const n = Math.min(2, (g.deck||[]).length);
    if(n===0){ // 双重保险,理论上 onDamaged 已经拦过(牌堆空时钩子根本不会挂起这个 pending)
      g.pending=null;
      if(checkWin(g)) return g;
      resumeAfterInterrupt(g, resume, seat);
      return g;
    }
    const cards = g.deck.splice(0, n); // 从牌堆顶取,不进日志(私密信息)
    g.pending = { type:'yijiAssign', seat, cards, resume };
    g.phase='yijiAssign';
    g.log=pushLog(g.log, g.players[seat].name+' 发动【遗计】,正在分配牌…'); // 不写牌面
    markSkillSound(g, '遗计');
    return g;
  });
}

// respondYijiAssign: 仅本人可响应。assignments 是长度等于 cards.length 的座位号数组(cards[i]
// 交给 assignments[i]),可以重复(都给自己/都给同一人/分给不同人都合法)。
function respondYijiAssign(assignments){
  tx(g=>{
    if(g.phase!=='yijiAssign'||!g.pending||g.pending.type!=='yijiAssign'||g.pending.seat!==mySeat) return g;
    const {cards, resume}=g.pending;
    if(!Array.isArray(assignments) || assignments.length!==cards.length) return g;
    for(const seat of assignments){
      const tgt=g.players[seat];
      if(!tgt || !tgt.alive) return g; // 任一目标非法/已阵亡,整体拒绝,状态不变(双重保险)
    }
    assignments.forEach((seat, i)=>{ g.players[seat].hand.push(cards[i]); });
    g.log=pushLog(g.log, g.players[mySeat].name+' 【遗计】分配了'+cards.length+'张牌给 '+assignments.map(s=>g.players[s].name).join('、'));
    g.pending=null;
    if(checkWin(g)) return g;
    resumeAfterInterrupt(g, resume, mySeat);
    return g;
  });
}

function respondHuogongReveal(cardIdx){
  tx(g=>{
    if(g.phase!=='huogongReveal'||!g.pending||g.pending.type!=='huogongReveal'||g.pending.to!==mySeat) return g;
    const d=g.pending;
    const target=g.players[mySeat], user=g.players[d.from];
    if(!target || !target.alive || !user || !user.alive){ g.pending=null; g.phase='play'; return g; }
    const revealed=(target.hand||[])[cardIdx];
    if(!revealed) return g;
    const suit=cardSuitForPlayer(target, revealed);
    g.log=pushLog(g.log, target.name+' 展示 '+suit+rankText(revealed.rank)+'【'+revealed.name+'】');
    const hasSame=(user.hand||[]).some(c=>c && cardSuitForPlayer(user, c)===suit);
    if(!hasSame){
      g.pending=null; g.phase='play';
      g.log=pushLog(g.log, user.name+' 没有同花色手牌,【火攻】不造成伤害');
      return g;
    }
    g.pending={type:'huogong', from:d.from, to:mySeat, suit, sourceCard:d.sourceCard};
    g.phase='huogong';
    g.log=pushLog(g.log, user.name+' 可弃置一张'+suit+'手牌,令 '+target.name+' 受到1点火属性伤害');
    return g;
  });
}

function respondHuogong(activate, cardIdx){
  tx(g=>{
    if(g.phase!=='huogong'||!g.pending||g.pending.type!=='huogong'||g.pending.from!==mySeat) return g;
    const d=g.pending;
    const me=g.players[mySeat], target=g.players[d.to];
    if(!me || !me.alive || !target || !target.alive){ g.pending=null; g.phase='play'; return g; }
    if(!activate){
      g.log=pushLog(g.log, me.name+'：不弃牌,【火攻】不造成伤害');
      g.pending=null; g.phase='play';
      return g;
    }
    const card=me.hand[cardIdx];
    if(!card || cardSuitForPlayer(me, card)!==d.suit) return g;
    me.hand.splice(cardIdx,1);
    g.discard.push(card);
    const sourceCard=d.sourceCard;
    g.log=pushLog(g.log, me.name+' 弃置 '+d.suit+'【'+card.name+'】,【火攻】生效');
    g.pending=null;
    const dying=dealDamage(g, d.to, 1, mySeat, '【火攻】', 'huogong', sourceCard);
    if(dying) return g;
    if(checkWin(g)) return g;
    g.phase='play';
    return g;
  });
}

// wuguPick: 五谷丰登挑选。仅当前轮到的人(order[idx])可操作;poolIdx 校验后从公共池移除、
// 收入挑选者手牌;idx 推进到下一个人,挑完一整圈(idx===order.length)则收尾——若池里还有剩牌
// (阵亡导致 order 比 pool 短的边界),兜底弃入弃牌堆,不做复杂的重新分配,只保证不卡死。
function wuguPick(poolIdx, expectedIdx, expectedCardId){
  tx(g=>{
    if(g.phase!=='wugu'||!g.pending||g.pending.type!=='wugu') return g;
    const { order, idx, pool } = g.pending;
    if(Number.isInteger(expectedIdx) && idx!==expectedIdx) return g;
    if(order[idx]!==mySeat) return g;
    const card = pool[poolIdx];
    if(!card) return g;
    if(expectedCardId!==undefined && card.id!==expectedCardId) return g;
    const me=g.players[mySeat];
    pool.splice(poolIdx,1);
    me.hand.push(card);
    g.log=pushLog(g.log, me.name+' 从【五谷丰登】挑选了一张牌');
    startWuguWuxie(g, g.pending.from, pool, order, idx+1);
    return g;
  });
}

function kuRou(){
  tx(g=>{
    if(g.phase!=='play'||g.turn!==mySeat) return g;
    const me=g.players[mySeat];
    if(!me || !me.alive || !hasCap(me,'kurou')) return g;
    g.log=pushLog(g.log, me.name+' 发动【苦肉】');
    markSkillSound(g, '苦肉');
    const interrupted = dealDamage(g, mySeat, 1, mySeat, '【苦肉】', 'kurou');
    if(interrupted) return g;
    drawN(g, mySeat, 2);
    g.log=pushLog(g.log, me.name+' 【苦肉】结算,摸两张牌');
    g.phase='play';
    return g;
  });
}

function zhiHeng(cardIdxs){
  tx(g=>{
    if(g.phase!=='play'||g.turn!==mySeat) return g;
    const me=g.players[mySeat];
    if(!me || !me.alive || !hasCap(me,'zhiheng') || g.zhihengUsed) return g;
    if(!Array.isArray(cardIdxs) || cardIdxs.length<1) return g;
    const unique=[...new Set(cardIdxs)].filter(i=>Number.isInteger(i)).sort((a,b)=>b-a);
    if(unique.length!==cardIdxs.length) return g;
    if(unique.some(i=>i<0 || i>=(me.hand||[]).length)) return g;
    const moved=[];
    unique.forEach(i=>{ moved.push(me.hand.splice(i,1)[0]); });
    moved.forEach(c=>{ if(c) g.discard.push(c); });
    g.zhihengUsed=true;
    drawN(g, mySeat, moved.length);
    g.log=pushLog(g.log, me.name+' 发动【制衡】,弃'+moved.length+'张牌并摸'+moved.length+'张牌');
    markSkillSound(g, '制衡');
    g.phase='play';
    return g;
  });
}

function renDe(cardIdx, targetSeat){
  tx(g=>{
    if(g.phase!=='play'||g.turn!==mySeat) return g;
    const me=g.players[mySeat];
    if(!me || !me.alive || !hasCap(me,'rende')) return g;
    const card=me.hand[cardIdx];
    if(!card) return g;
    const target=g.players[targetSeat];
    if(targetSeat===mySeat || !target || !target.alive) return g;
    me.hand.splice(cardIdx,1);
    target.hand.push(card);
    if(!Number.isInteger(g.renDeCount)) g.renDeCount=0;
    g.renDeCount++;
    g.log=pushLog(g.log, me.name+' 【仁德】将一张牌交给 '+target.name);
    if(g.renDeCount===2){
      if(me.hp<me.maxHp) me.hp = Math.min(me.maxHp, me.hp+1);
      g.log=pushLog(g.log, me.name+' 【仁德】发动,回复1点体力');
      markSkillSound(g, '仁德');
      // 周泰【不屈】:回复体力时移除一张不屈牌
      if (hasCap(me,'buqu') && me.buquCards && me.buquCards.length > 0) {
        const removedCard = me.buquCards.pop();
        g.log = pushLog(g.log, me.name+' 回复体力,移除一张不屈牌（'+removedCard.name+' '+removedCard.suit+removedCard.rank+'）');
        if(me.buquCards.length === 0) {
          me.hp = Math.min(me.maxHp, me.hp + 1);
          g.log = pushLog(g.log, me.name+' 移除最后一张不屈牌,恢复1点体力（体力'+me.hp+'）');
        }
      }
    }
    g.phase='play';
    return g;
  });
}

function qingNang(cardIdx, targetSeat){
  tx(g=>{
    if(g.phase!=='play'||g.turn!==mySeat) return g;
    const me=g.players[mySeat];
    if(!me || !me.alive || !hasCap(me,'qingnang') || g.qingNangUsed) return g;
    const card=me.hand[cardIdx];
    if(!card) return g;
    const tgt=g.players[targetSeat];
    if(!tgt || !tgt.alive || tgt.hp>=tgt.maxHp) return g;
    g.qingNangUsed=true;
    me.hand.splice(cardIdx,1);
    g.discard.push(card);
    tgt.hp=Math.min(tgt.maxHp, tgt.hp+1);
    g.log=pushLog(g.log, me.name+' 弃置一张牌,发动【青囊】,令 '+tgt.name+' 回复1点体力');
    const resolvedTargetSeat = g.players.findIndex(p => p === tgt);
    // 法正【恩怨】：当其他角色令法正回复1点体力后，其摸一张牌
    if(hasCap(tgt, 'enyuan') && mySeat !== resolvedTargetSeat) {
      ensureDeck(g);
      drawN(g, mySeat, 1);
      g.log = pushLog(g.log, tgt.name + ' 回复1点体力,' + me.name + ' 发动【恩怨】效果,摸一张牌');
    }
    // 周泰【不屈】:回复体力时移除一张不屈牌
    if (resolvedTargetSeat !== -1 && hasCap(tgt,'buqu') && tgt.buquCards && tgt.buquCards.length > 0) {
      const removedCard = tgt.buquCards.pop();
      g.log = pushLog(g.log, tgt.name+' 回复体力,移除一张不屈牌（'+removedCard.name+' '+removedCard.suit+removedCard.rank+'）');
      if(tgt.buquCards.length === 0) {
        tgt.hp = Math.min(tgt.maxHp, tgt.hp + 1);
        g.log = pushLog(g.log, tgt.name+' 移除最后一张不屈牌,恢复1点体力（体力'+tgt.hp+'）');
      }
    }
    markSkillSound(g, '青囊');
    g.phase='play';
    return g;
  });
}

// 吕蒙【克己】(锁定技):本回合"未以任何方式打出过杀"则可跳过弃牌阶段。判据 = 未主动出杀(!shaUsed)
// 且 未在决斗中打杀(!shaPlayedInDuel)。g.shaUsed 只由主动出杀置真、仅管出杀次数;决斗打杀走
// g.shaPlayedInDuel,两者分离,避免决斗应战误消耗出牌阶段的出杀次数(见 duelResponse 注释)。
function canSkipDiscard(g, seat){
  const p=g.players[seat];
  return !!(p && hasCap(p,'keji') && !g.shaUsed && !g.shaPlayedInDuel);
}

function liRangDiscardCardsInPile(g, cards){
  return (cards||[]).filter(card=>(g.discard||[]).some(c=>c===card || (c && card && c.id!==undefined && c.id===card.id)));
}

function maybeStartLiRangRecover(g, endingSeat){
  const r=g.liRangRecord;
  if(!r || r.round!==g.roundNum || r.to!==endingSeat) return false;
  const kong=g.players[r.from];
  if(!kong || !kong.alive || !hasCap(kong,'lirang')) return false;
  const cards=liRangDiscardCardsInPile(g, r.discarded);
  if(cards.length===0) return false;
  g.pending={type:'lirangRecover', from:r.from, to:endingSeat, cards};
  g.phase='lirangRecover';
  g.log=pushLog(g.log, kong.name+' 是否发动【礼让】,获得 '+g.players[endingSeat].name+' 本弃牌阶段弃置的牌…');
  return true;
}

function respondLiRangRecover(activate){
  tx(g=>{
    if(g.phase!=='lirangRecover'||!g.pending||g.pending.type!=='lirangRecover'||g.pending.from!==mySeat) return g;
    const from=g.pending.from, to=g.pending.to;
    const kong=g.players[from], target=g.players[to];
    if(!kong || !kong.alive || !target) return g;
    if(activate){
      const gained=[];
      (g.pending.cards||[]).forEach(card=>{
        const idx=(g.discard||[]).findIndex(c=>c===card || (c && card && c.id!==undefined && c.id===card.id));
        if(idx>=0) gained.push(g.discard.splice(idx,1)[0]);
      });
      if(gained.length){
        kong.hand.push(...gained);
        g.log=pushLog(g.log, kong.name+' 发动【礼让】,获得 '+target.name+' 本弃牌阶段弃置的'+gained.length+'张牌');
        markSkillSound(g, '礼让');
      }
    } else {
      g.log=pushLog(g.log, kong.name+'：不发动【礼让】回收弃牌');
    }
    g.pending=null;
    advanceXiaoguo(g, to, to);
    return g;
  });
}

function respondBiyue(activate){
  tx(g=>{
    if(g.phase!=='biyue'||!g.pending||g.pending.type!=='biyue'||g.pending.seat!==mySeat) return g;
    const me=g.players[mySeat];
    if(!me || !me.alive) return g;
    if(activate){
      drawN(g, mySeat, 1);
      g.log=pushLog(g.log, me.name+' 发动【闭月】,摸1张牌');
      markSkillSound(g, '闭月');
    } else {
      g.log=pushLog(g.log, me.name+'：不发动【闭月】');
    }
    g.pending=null;
    startTurn(g, nextAlive(g, mySeat));
    return g;
  });
}

// ===== 乐进【骁果】:其他角色的结束阶段,乐进可以弃基本牌发动,让该角色弃装备(乐进摸牌)或受伤 =====
// nextXiaoguoAsker: 从 current 的下家起,按座位顺序找下一个"有资格发动骁果"的候选人——
// 存活 + hasCap(p,'xiaoguo') + 手牌里有基本牌。绕回 endingSeat(即将结束回合的人,永远不会
// 被当成候选人,天然排除"乐进对自己回合结束触发")即问完一圈,返回 null。
function nextXiaoguoAsker(g, endingSeat, current){
  const n=g.players.length;
  for(let k=1;k<=n;k++){
    const s=(current+k)%n;
    if(s===endingSeat) return null;
    const p=g.players[s];
    if(p && p.alive && hasCap(p,'xiaoguo') && (p.hand||[]).some(c=>BASIC_CARDS.includes(c.name))) return s;
  }
  return null;
}

// respondXiaoguo: 仅当前被问的人(pending.asking)可响应。不发动:推进到下一个候选人;
// 发动:弃一张基本牌(校验 BASIC_CARDS),交给目标(endingSeat)二选一。
function respondXiaoguo(activate, cardIdx){
  tx(g=>{
    if(g.phase!=='xiaoguo'||!g.pending||g.pending.type!=='xiaoguo'||g.pending.asking!==mySeat) return g;
    const endingSeat=g.pending.endingSeat;
    if(!activate){
      advanceXiaoguo(g, endingSeat, mySeat);
      return g;
    }
    const me=g.players[mySeat];
    const card=me.hand[cardIdx];
    if(!card || !BASIC_CARDS.includes(card.name)) return g; // 不是基本牌:不生效,状态不变
    me.hand.splice(cardIdx,1);
    g.discard.push(card);
    g.log=pushLog(g.log, me.name+' 弃置一张【'+card.name+'】,发动【骁果】,询问 '+g.players[endingSeat].name+' 弃装备或受到1点伤害…');
    g.pending={type:'xiaoguoChoice', from:mySeat, endingSeat, to:endingSeat};
    g.phase='xiaoguoChoice';
    return g;
  });
}

// respondXiaoguoChoice: 仅目标(pending.to,即 endingSeat 本人)可响应。choice 是装备槽名
// (EQUIP_SLOTS 之一)= 弃该装备、乐进摸一张;choice==='damage' = 受到乐进 1 点伤害
// (可能连锁触发濒死,见 finishDying 的 resume.type==='xiaoguo' 分支)。
function respondXiaoguoChoice(choice){
  tx(g=>{
    if(g.phase!=='xiaoguoChoice'||!g.pending||g.pending.type!=='xiaoguoChoice'||g.pending.to!==mySeat) return g;
    const from=g.pending.from, endingSeat=g.pending.endingSeat;
    const target=g.players[endingSeat], asker=g.players[from];
    if(choice==='damage'){
      const dying=dealDamage(g, endingSeat, 1, from, '【骁果】', 'xiaoguo');
      if(dying){ g.pending.resume={type:'xiaoguo', endingSeat, lastAsker:from}; return g; }
      g.pending=null;
      if(checkWin(g)) return g;
      advanceXiaoguo(g, endingSeat, from);
      return g;
    }
    if(!EQUIP_SLOTS.includes(choice) || !target.equips[choice]) return g; // 非法/槽已空
    const card=target.equips[choice];
    target.equips[choice]=null;
    g.discard.push(card);
    g.log=pushLog(g.log, target.name+' 弃置装备【'+card.name+'】,'+asker.name+' 摸一张牌');
    // 装备已经弃置，先清掉骁果的旧 pending，再触发失去装备钩子。旋风若挂起，必须保留它并
    // 记下骁果续接信息；旧实现触发后无条件 g.pending=null，导致只留下“可以发动旋风”的日志。
    g.pending=null;
    const pendingBefore=g.pending;
    triggerHook(g, endingSeat, 'onLoseEquip', {count:1});
    drawN(g, from, 1);
    if(g.pending!==pendingBefore && g.pending){
      g.pending.resume={type:'xiaoguo', endingSeat, lastAsker:from};
      return g;
    }
    advanceXiaoguo(g, endingSeat, from);
    return g;
  });
}

// ===== 姜维【志继】 =====
// respondZhijiChoice: 姜维【志继】觉醒后的选择
// choice: true=回复1点体力, false=摸两张牌
function respondZhijiChoice(healOrDraw){
  tx(g=>{
    if(g.phase!=='zhijiChoice'||!g.pending||g.pending.type!=='zhijiChoice') return g;
    if(g.pending.seat!==mySeat) return g; // 仅姜维本人可选择,和 respondTiaoxinChoice/respondSanyao 同型修复
    const seat = g.pending.seat;
    const p = g.players[seat];
    if(!p || !p.alive) {
      g.pending = null; g.phase = 'play';
      return g;
    }
    
    if(healOrDraw){
      // 选择回复1点体力
      p.hp = Math.min(p.hp + 1, p.maxHp);
      g.log = pushLog(g.log, p.name + ' 选择回复1点体力');
      // 周泰【不屈】:回复体力时移除一张不屈牌
      if (hasCap(p,'buqu') && p.buquCards && p.buquCards.length > 0) {
        const removedCard = p.buquCards.pop();
        g.log = pushLog(g.log, p.name+' 回复体力,移除一张不屈牌（'+removedCard.name+' '+removedCard.suit+removedCard.rank+'）');
        if(p.buquCards.length === 0) {
          p.hp = Math.min(p.maxHp, p.hp + 1);
          g.log = pushLog(g.log, p.name+' 移除最后一张不屈牌,恢复1点体力（体力'+p.hp+'）');
        }
      }
    } else {
      // 选择摸两张牌
      drawN(g, seat, 2);
      g.log = pushLog(g.log, p.name + ' 选择摸两张牌');
    }
    
    // 获得观星技能（在选择完成后才生效）
    if(!p.caps) p.caps = {};
    p.caps.guanxing = true;
    g.log = pushLog(g.log, p.name + ' 【志继】觉醒完成,获得【观星】技能');
    g.pending = null;
    // 继续准备阶段的后续流程
    continueGuanxingCheck(g, seat);
    return g;
  });
}

// ===== 姜维【挑衅】 =====
// respondTiaoxin: 姜维【挑衅】,选择目标后提交。服务端在 tx 内:
// 1. 校验:出牌阶段,本回合未使用过挑衅,目标合法
// 2. 设 g.tiaoxinUsed=true,开 pending 询问目标角色选择:①对你使用一张杀;②让你弃置其一张牌
function respondTiaoxin(targetSeat){
  tx(g=>{
    if(g.phase!=='play'||g.turn!==mySeat) return g;
    const me=g.players[mySeat];
    if(!me || !me.alive || !hasCap(me,'tiaoxin')) return g;
    if(g.tiaoxinUsed) return g; // 本回合已使用过
    const target = g.players[targetSeat];
    if(!target || !target.alive || targetSeat===mySeat) return g;
    if((target.hand||[]).length===0) return g;
    
    g.tiaoxinUsed=true;
    g.pending={type:'tiaoxinChoice', from:mySeat, to:targetSeat};
    g.phase='tiaoxinChoice';
    g.log=pushLog(g.log, me.name+' 发动【挑衅】,要求 '+target.name+' 选择:对其使用一张杀或被弃置一张牌');
    return g;
  });
}

// respondTiaoxinChoice: 挑衅目标的选择
// target 选择: true=使用杀, false=被弃置一张牌
function respondTiaoxinChoice(useSha, cardIdx){
  tx(g=>{
    if(g.phase!=='tiaoxinChoice'||!g.pending||g.pending.type!=='tiaoxinChoice') return g;
    // 调用者身份守卫:只有被挑衅的目标本人(g.pending.to)能替自己做这个选择。
    // 和项目里其它响应函数同一范式(respondShan/aoeRespond 也是 g.pending.to!==mySeat;
    // duelResponse 是 active、respondJiedao 是 seatA——字段名各自不同,别抄错)。
    // 这一句以前漏了:函数体内部一律用 g.pending.to 取响应者,所以效果不会算错人,但没有
    // 任何一句把 mySeat 和 g.pending.to 对上,导致任何在场客户端(包括挑衅发起者自己)都能
    // 在这个 phase 内代替目标做选择——已实测复现:座位2(无关第三方)和座位0(发起者)都能
    // 强行让目标打出手里的杀、或替目标选择被弃牌。UI 侧虽然有 g.pending.to===mySeat 判断
    // 点不到别人的按钮,但按"服务端级兜底,UI 漏判也拦得住"的一贯原则,不能只靠 UI 拦。
    if(g.pending.to!==mySeat) return g;
    const from=g.pending.from, to=g.pending.to;
    const target=g.players[to];
    const asker=g.players[from];

    if(useSha){
      // 目标选择对挑衅者使用一张杀
      // 检查目标是否能出杀
      // cardIdx 是客户端"多候选选牌"传来的具体下标(可选):传了且服务端复核确实能当杀才采信,
      // 不合法就当没传、回退 findUsableAs——不盲信客户端下标(和 respondShan 同一套写法)。
      // 注意这里的响应者是 target(g.pending.to),不是 mySeat,所以复核的是 target 的手牌。
      const specifiedCard = (typeof cardIdx==='number') ? (target.hand||[])[cardIdx] : null;
      const shaIdx = (specifiedCard && canUseAs(target, specifiedCard, '杀')) ? cardIdx : findUsableAs(target.hand, target, '杀');
      if(shaIdx>=0 && canReachSha(g, to, from)){
        const card=target.hand.splice(shaIdx,1)[0];
        g.discard.push(card);
        g.log=pushLog(g.log, target.name+' 对 '+asker.name+' 使用'+(isShaName(card.name)?'【'+card.name+'】':'【'+card.name+'】当【杀】')+'响应【挑衅】');
        markCardSound(g, '杀', to, card, from);
        if(card.name!=='杀'){
          if(hasCap(target,'longdan')) markSkillSound(g,'龙胆');
          else if(hasCap(target,'wusheng')) markSkillSound(g,'武圣');
        }
        // 使用杀 - resolveShaUse(g, me, targetSeat, usedAs, shaColor, sourceCard)
        // 这里target是出杀者，from是目标
        g.pending=null;
        resolveShaUse(g, target, from, '挑衅:出【杀】', singleCardShaColor(card), card, undefined);
      } else {
        // 目标不能出杀，视为放弃使用杀，需要被弃置一张牌
        g.log=pushLog(g.log, target.name+' 无法对 '+asker.name+' 使用杀,自动选择被弃置一张牌');
        startTiaoxinDiscard(g, from, to);
      }
    } else {
      // 目标选择被弃置一张牌
      startTiaoxinDiscard(g, from, to);
    }
    return g;
  });
}

function tiaoxinDiscardOptions(target){
  const opts=[];
  (target.hand||[]).forEach((card, idx)=>{ if(card) opts.push({kind:'hand', idx}); });
  EQUIP_SLOTS.forEach(slot=>{ if(target.equips && target.equips[slot]) opts.push({kind:'equip', slot}); });
  return opts;
}

function startTiaoxinDiscard(g, from, to){
  const asker=g.players[from];
  const target=g.players[to];
  if(!asker || !asker.alive || !target || !target.alive){
    g.pending=null; g.phase='play';
    return;
  }
  const opts=tiaoxinDiscardOptions(target);
  if(opts.length===0){
    g.pending=null; g.phase='play';
    return;
  }
  g.pending={type:'tiaoxinDiscard', from, to};
  g.phase='tiaoxinDiscard';
  g.log=pushLog(g.log, asker.name+' 选择弃置 '+target.name+' 的一张牌…');
}

function pickTiaoxinDiscard(kind, value){
  tx(g=>{
    if(g.phase!=='tiaoxinDiscard'||!g.pending||g.pending.type!=='tiaoxinDiscard') return g;
    const from=g.pending.from, to=g.pending.to;
    if(from!==mySeat) return g;
    const asker=g.players[from];
    const target=g.players[to];
    if(!asker || !asker.alive || !target || !target.alive){
      g.pending=null; g.phase='play';
      return g;
    }
    let card=null;
    if(kind==='hand'){
      const idx=Number(value);
      if(!Number.isInteger(idx) || idx<0 || idx>=(target.hand||[]).length) return g;
      card=target.hand.splice(idx,1)[0];
      if(card){
        g.discard.push(card);
        g.log=pushLog(g.log, asker.name+' 弃置了 '+target.name+' 的一张手牌');
      }
    } else if(kind==='equip'){
      const slot=String(value||'');
      if(!EQUIP_SLOTS.includes(slot) || !target.equips || !target.equips[slot]) return g;
      card=target.equips[slot];
      target.equips[slot]=null;
      g.discard.push(card);
      g.log=pushLog(g.log, asker.name+' 弃置了 '+target.name+' 的装备【'+card.name+'】');
    } else {
      return g;
    }
    g.pending=null; g.phase='play';
    return g;
  });
}

// ===== 李典【恂恂】 =====
// respondXunxun: 李典【恂恂】,选择获得哪些牌后提交。
// keepIdxs: 要获得的牌在 g.pending.cards 中的下标数组,长度必须等于 g.pending.takeN
// bottomOrder: 其余牌的下标数组（按任意顺序置于牌堆底）
// 约定: keepIdxs 和 bottomOrder 合起来必须恰好覆盖每个下标一次,没有重复和遗漏
function respondXunxun(keepIdxs, bottomOrder){
  tx(g=>{
    if(g.phase!=='xunxunPick'||!g.pending||g.pending.type!=='xunxunPick'||g.pending.seat!==mySeat) return g;
    const me = g.players[mySeat];
    if(!me || !me.alive || !hasCap(me, 'xunxun')) return g;
    
    const cards = g.pending.cards;
    const takeN = g.pending.takeN;
    
    // 校验: keepIdxs 必须是数组,长度等于 takeN
    if(!Array.isArray(keepIdxs) || keepIdxs.length !== takeN) return g;
    
    // 所有下标合并
    const allIdx = [...(keepIdxs||[]), ...(bottomOrder||[])];
    
    // 校验:两个数组合起来必须恰好是cards的每个下标各出现一次
    if(allIdx.length!==cards.length || new Set(allIdx).size!==cards.length || !allIdx.every(i=>Number.isInteger(i)&&i>=0&&i<cards.length)) return g;
    
    // 获得选择的牌
    const keepCards = keepIdxs.map(i => cards[i]);
    me.hand.push(...keepCards);
    
    // 其余牌按指定顺序置于牌堆底（数组最前面）
    const bottomCards = bottomOrder.map(i => cards[i]);
    g.deck = [...bottomCards, ...g.deck];
    
    g.pending = null;
    g.log = pushLog(g.log, me.name+' 【恂恂】结算,获得'+keepCards.length+'张牌,其余'+bottomCards.length+'张牌置于牌堆底');
    markSkillSound(g, '恂恂');
    
    // 进入出牌阶段（跳过摸牌阶段）
    g.phase = 'play';
    return g;
  });
}

// respondZaiqi: 孟获【再起】
// 摸牌阶段,若已受伤,可放弃摸牌:亮出牌堆顶 X 张牌(X=已损失体力),每张红桃回复1点体力,然后将这些牌置入弃牌堆
function respondZaiqi() {
  tx(g => {
    if (g.phase !== 'draw' || g.turn !== mySeat) return g;
    const me = g.players[mySeat];
    if (!me || !me.alive) return g;
    
    // 检查发动条件:已受伤
    if (me.hp >= me.maxHp) return g;
    if (!hasCap(me, 'zaiqi')) return g;
    
    // 计算 X = 已损失体力值。hp 可以为负(见 dealDamage 的注释),不能直接 maxHp-hp,否则
    // hp<0 时会翻出比体力上限还多的张数。再起在摸牌阶段发动、濒死者进不到这里,现实中
    // hp<0 到不了这一步,这里是防御性对齐(和天香/血格显示同一套口径),不是已知会触发的路径。
    const lostHp = me.maxHp - Math.max(0, me.hp);
    
    // 亮出牌堆顶 X 张牌
    const cards = revealPool(g, lostHp);
    if (cards.length === 0) {
      g.log = pushLog(g.log, me.name + ' 发动【再起】,但牌堆为空');
      g.phase = 'play';
      return g;
    }
    
    // 计算红桃数量
    const heartCount = cards.filter(card => cardSuitForPlayer(me, card) === '♥').length;
    
    // 回复体力
    const recoverAmount = Math.min(lostHp, heartCount);
    if (recoverAmount > 0) {
      me.hp = Math.min(me.maxHp, me.hp + recoverAmount);
      // 周泰【不屈】:回复体力时移除一张不屈牌
      if (hasCap(me,'buqu') && me.buquCards && me.buquCards.length > 0) {
        const removedCard = me.buquCards.pop();
        g.log = pushLog(g.log, me.name+' 回复体力,移除一张不屈牌（'+removedCard.name+' '+removedCard.suit+removedCard.rank+'）');
        if(me.buquCards.length === 0) {
          me.hp = Math.min(me.maxHp, me.hp + 1);
          g.log = pushLog(g.log, me.name+' 移除最后一张不屈牌,恢复1点体力（体力'+me.hp+'）');
        }
      }
    }
    
    // 记录日志
    const recoverText = recoverAmount > 0 ? `,其中${recoverAmount}张红桃,回复${recoverAmount}点体力（体力${me.hp}）** ` : ',无红桃,未回复体力';
    g.log = pushLog(g.log, me.name + ' 发动【再起】,亮出牌堆顶' + lostHp + '张牌' + recoverText);
    
    // 将牌置入弃牌堆
    g.discard.push(...cards);
    
    // 结束摸牌阶段,进入出牌阶段
    g.phase = 'play';
    markSkillSound(g, '再起');
    
    return g;
  });
}

// ========== 马谡【散谣】技能 ==========
// 第一步(服务端核心)实现记录见 CLAUDE.md。这次是从零重新设计,不是在旧骨架上打补丁——
// 旧骨架(startSanyao/respondSanyao/respondSanyaoTarget + sanyao/sanyaoChooseTarget 两个
// pending 类型)整体作废删除,原因见 CLAUDE.md 对应条目(findMaxHpSeats 排除自己是真实规则
// bug、UI 的 p.seat!==mySeat 判断因为玩家对象根本没有 seat 字段而永远为真、respondSanyao
// 漏了 onLoseEquip 钩子)。上次刚给这两个函数补的身份守卫这次随函数一起被替换,不是白做——
// 那次的目的是"死代码也要有正确的卫生习惯",不是保证这段代码会被长期保留。

// 找到全场(含马谡自己)体力值最大的角色（返回座位号数组）。
// 官方原文用"全场"而不是"其他角色",马谡自己体力值最大时应该能对自己造成伤害——
// 旧版 findMaxHpSeats(g, excludeSeat) 把发动者自己排除在候选之外,是真实规则 bug,已改正。
// 平局(多人并列最大)时返回全部候选座位,由发动者从中选一个(不是全部命中/不是随机)。
function findMaxHpSeats(g) {
  const alivePlayers = g.players.filter(p => p && p.alive);
  if(alivePlayers.length === 0) return [];
  const maxHp = Math.max(...alivePlayers.map(p => p.hp));
  return alivePlayers
    .map(p => g.players.indexOf(p))
    .filter(seat => g.players[seat].hp === maxHp);
}

// sanyaoOptions: 马谡自己当前可弃的项(手牌逐张 + 非空装备槽逐件,不含判定区——弃牌范围
// 类推自贯石斧的既有口径,项目里对"弃置X张牌"这类不带区域限定措辞统一按"手牌+装备"解释,
// 见 CLAUDE.md)。返回 {key,label} 列表,key 格式和贯石斧 guanshifuOptions 一致
// ('hand:'+idx / 'equip:'+slot),供 UI(第二步)渲染按钮,也供服务端复用同一份 key 解析逻辑。
function sanyaoOptions(p) {
  const list = [];
  (p.hand || []).forEach((c, idx) => { list.push({ key: 'hand:' + idx, label: '手牌【' + c.name + '】' }); });
  EQUIP_SLOTS.forEach(slot => {
    if(p.equips && p.equips[slot]) {
      list.push({ key: 'equip:' + slot, label: (EQUIP_SLOT_LABEL[slot] || slot) + '【' + p.equips[slot].name + '】' });
    }
  });
  return list;
}

// finishSanyaoDamage: 散谣弃牌成本已经结算完毕(不管有没有触发 onLoseEquip 中途打断)之后,
// 真正造成伤害 + 收尾的共用尾巴。两处调用:①sanyao() 里弃牌未触发钩子打断的直达路径；
// ②resumeAfterInterrupt 的 'sanyaoDamage' 分支(弃装备触发 onLoseEquip 挂起了新 pending,
// 比如旋风,问完之后接回来继续伤害结算——见下方注释,这条分支当前不可达但按强制约定补上)。
// srcType 传 'sanyao'(参照苦肉kurou/反间fanjian/驱虎quhu/苦肉kurou/骁果xiaoguo/刚烈ganglie/
// 恩怨enyuan/挑衅qiangxi 同类命名惯例),sourceSeat 传马谡自己(不管目标是不是他本人),
// 这样司马懿反馈这类"看伤害来源"的钩子能正确识别来源。
function finishSanyaoDamage(g, casterSeat, targetSeat) {
  const caster = g.players[casterSeat];
  const interrupted = dealDamage(g, targetSeat, 1, casterSeat, (caster ? caster.name : '') + ' 发动【散谣】', 'sanyao');
  if(interrupted) return; // dealDamage 自身的濒死/onDamaged 打断,由 resumeAfterInterrupt 的 'sanyao' 分支接回
  if(g.players[g.turn] && g.players[g.turn].alive) g.phase = 'play';
  else startTurn(g, nextAlive(g, g.turn));
}

// sanyao(costKey, targetSeat): 出牌阶段限一次的原子发动函数——弃哪张牌、平局选哪个目标,
// 全程只有马谡一人决定、不需要其他玩家响应,按张郃【巧变】已经确立的既有规则走"客户端
// 本地累积选择、最后一次性原子提交",不再引入 sanyao/sanyaoChooseTarget 这类服务端两阶段
// pending。服务端仍然完整重新校验 costKey/targetSeat,不信任客户端传入的值。
function sanyao(costKey, targetSeat) {
  tx(g => {
    if(g.phase !== 'play' || g.turn !== mySeat) return g;
    const me = g.players[mySeat];
    if(!me || !me.alive || !hasCap(me, 'sanyao') || g.sanyaoUsed) return g;

    // 校验 costKey:必须真实对应马谡当前手牌里的某一张、或某个非空装备槽(不含判定区)。
    let discardedCard = null, isEquip = false, equipSlot = null, handIdx = -1;
    if(typeof costKey === 'string' && costKey.indexOf('hand:') === 0) {
      const idx = Number(costKey.slice(5));
      if(!Number.isInteger(idx) || idx < 0 || idx >= (me.hand || []).length) return g;
      handIdx = idx;
      discardedCard = me.hand[idx];
    } else if(typeof costKey === 'string' && costKey.indexOf('equip:') === 0) {
      const slot = costKey.slice(6);
      if(!EQUIP_SLOTS.includes(slot) || !me.equips || !me.equips[slot]) return g;
      isEquip = true; equipSlot = slot;
      discardedCard = me.equips[slot];
    } else {
      return g;
    }

    // 校验 targetSeat:服务端重新计算候选集,不信任客户端传入的目标是否合法。
    const maxHpSeats = findMaxHpSeats(g);
    if(maxHpSeats.length === 0) return g;
    if(!maxHpSeats.includes(targetSeat)) return g;

    g.sanyaoUsed = true;
    if(isEquip) {
      me.equips[equipSlot] = null;
    } else {
      me.hand.splice(handIdx, 1);
    }
    g.discard = g.discard || [];
    if(discardedCard && !discardedCard.virtual) g.discard.push(discardedCard);
    g.log = pushLog(g.log, me.name + ' 发动【散谣】,弃置了【' + discardedCard.name + '】');
    markSkillSound(g, '散谣');

    if(isEquip) {
      // 【失去装备钩子的正确接法,见 CLAUDE.md「凌统旋风」/pickResolve 条】先把 phase 设回
      // 休止相(play),再触发 onLoseEquip,让钩子(如旋风)捕获到正确的休止相；若钩子挂起了
      // 新 pending,记下 resume 续接信息、这次 tx 到此为止,不在这里往下走伤害结算。
      // 当前项目里马谡自己没有 onLoseEquip 钩子(旋风/枭姬只在凌统/孙尚香身上,一人只能是
      // 一个武将),这个分支目前不可达,是按强制约定补上的正确性代码,不是修一个能被打的漏洞。
      g.phase = 'play';
      const pendingBefore = g.pending;
      triggerHook(g, mySeat, 'onLoseEquip', { count: 1 });
      if(g.pending !== pendingBefore && g.pending) {
        g.pending.resume = { type: 'sanyaoDamage', casterSeat: mySeat, target: targetSeat };
        return g;
      }
    }

    finishSanyaoDamage(g, mySeat, targetSeat);
    if(checkWin(g)) return g;
    return g;
  });
}

// ========== 马谡【制蛮】技能 ==========

// 检查目标是否有牌可被获得
function zhimengTargetHasCard(p) {
  if(!p || !p.alive) return false;
  if((p.hand || []).length > 0) return true;
  if(EQUIP_SLOTS.some(slot => p.equips && p.equips[slot])) return true;
  if((p.delays || []).length > 0) return true;
  return false;
}

// 获取目标场上可获得的牌选项
function getZhimengOptions(g, targetSeat) {
  const target = g.players[targetSeat];
  const options = [];
  
  if(!target || !target.alive) return options;
  
  if((target.hand || []).length > 0) {
    options.push({ type: 'hand', label: '一张手牌' });
  }
  
  EQUIP_SLOTS.forEach(slot => {
    if(target.equips && target.equips[slot]) {
      const equip = target.equips[slot];
      options.push({ type: slot, label: '装备【' + equip.name + '】', card: equip });
    }
  });
  
  (target.delays || []).forEach((card, idx) => {
    if(card) {
      options.push({ type: 'delay', label: '判定区【' + card.name + '】', index: idx, card: card });
    }
  });
  
  return options;
}

// 触发制蛮询问。返回:
//   'ask'  — 已挂起询问(是否发动),调用方应立即 return true 暂停伤害——不管候选牌是1张
//            还是多张都走这条路径,"是否发动"这一步永远要问,不能因为候选唯一就跳过
//   false  — 不触发(目标无牌可拿/攻击者无制蛮/自伤等)
function triggerZhimeng(g, from, to, ctx) {
  if(from === to) return false;
  
  const attacker = g.players[from];
  if(!attacker || !attacker.alive) return false;
  
  if(!hasCap(attacker, 'zhimeng')) return false;
  
  const target = g.players[to];
  if(!target || !target.alive) return false;
  
  if(!zhimengTargetHasCard(target)) return false;
  
  const options = getZhimengOptions(g, to);
  if(options.length === 0) return false;

  // 【制蛮】永远可选发动("你可以防止此伤害"),不管目标身上能拿的候选牌是1张还是多张——
  // "唯一候选自动跳过选卡这一步"是对的简化(respondZhimeng(true)里已正确处理),但"唯一候选
  // 自动跳过是否发动这一步"是错的:这里曾经在 options.length===1 时直接调用
  // zhimengAutoResolve 自动结算、返回'prevented',完全剥夺了玩家"不发动、让伤害正常打出"
  // 这个选择机会——两者不能混为一谈,这里必须无条件挂起 zhimengAsk 询问。
  g.pending = {
    type: 'zhimengAsk',
    from: from,
    to: to,
    options: options.map(o => ({ type: o.type, label: o.label, index: o.index })),
    originalCtx: ctx
  };
  g.phase = 'zhimengAsk';
  g.log = pushLog(g.log, attacker.name + ' 是否发动【制蛮】防止此伤害并获得目标一张牌…');
  
  return 'ask';
}

// 自动结算制蛮（唯一选项时）——只拿牌+记日志,不碰异类型 pending
function zhimengAutoResolve(g, from, to, option) {
  const attacker = g.players[from];
  const target = g.players[to];
  
  let gainedCard = null;
  
  if(option.type === 'hand') {
    const hand = target.hand || [];
    if(hand.length > 0) {
      const idx = Math.floor(Math.random() * hand.length);
      gainedCard = hand.splice(idx, 1)[0];
    }
  } else if(EQUIP_SLOTS.includes(option.type)) {
    if(target.equips && target.equips[option.type]) {
      gainedCard = target.equips[option.type];
      target.equips[option.type] = null;
      triggerHook(g, to, 'onLoseEquip', {count:1});
    }
  } else if(option.type === 'delay') {
    if(target.delays && target.delays[option.index]) {
      gainedCard = target.delays.splice(option.index, 1)[0];
    }
  }
  
  if(gainedCard) {
    attacker.hand = attacker.hand || [];
    attacker.hand.push(gainedCard);
    g.log = pushLog(g.log, attacker.name + ' 发动【制蛮】,防止伤害并获得' + (gainedCard.virtual ? '一张牌' : '【' + gainedCard.name + '】'));
  } else {
    g.log = pushLog(g.log, attacker.name + ' 发动【制蛮】,防止伤害(目标已无牌可获)');
  }
  
  markSkillSound(g, '制蛮');
}

// 制蛮结束后接回原伤害流程(不发动时重放伤害;发动后 resume)
function finishZhimeng(g, originalCtx, prevented){
  g.pending = null;
  if(!originalCtx){
    g.phase = 'play';
    return;
  }
  // aoe/delay 等 resume 用受害座位;sha 用攻击者座位(见 resumeAfterInterrupt)
  const resumeSeat = (originalCtx.srcType==='aoe' || originalCtx.srcType==='delay')
    ? originalCtx.to
    : originalCtx.sourceSeat;
  if(prevented){
    // 伤害被防止:只接回调用方尾巴(等同 dealDamage 返回 false 后的路径)
    if(checkWin(g)) return;
    resumeAfterInterrupt(g, {type: originalCtx.srcType, seat: originalCtx.to}, resumeSeat);
    return;
  }
  // 不发动:按原参数重放伤害,跳过制蛮防递归
  const dying = dealDamage(
    g,
    originalCtx.to != null ? originalCtx.to : undefined,
    originalCtx.amount,
    originalCtx.sourceSeat,
    originalCtx.reason,
    originalCtx.srcType,
    originalCtx.sourceCard,
    false, false, false,
    true // skipZhimeng
  );
  if(dying) return;
  if(checkWin(g)) return;
  resumeAfterInterrupt(g, {type: originalCtx.srcType, seat: originalCtx.to}, resumeSeat);
}

// 响应制蛮选择
function respondZhimeng(activate) {
  tx(g => {
    if(g.phase !== 'zhimengAsk') return g;
    
    const pending = g.pending;
    if(!pending || pending.type !== 'zhimengAsk') {
      g.phase = 'play';
      return g;
    }
    if(pending.from !== mySeat) return g;
    
    const originalCtx = pending.originalCtx || {};
    // 补 to 字段(重放伤害目标)
    originalCtx.to = pending.to;
    originalCtx.sourceSeat = pending.from;
    
    if(!activate) {
      g.log = pushLog(g.log, g.players[mySeat].name + '：不发动【制蛮】');
      finishZhimeng(g, originalCtx, false);
      return g;
    }
    
    const from = pending.from;
    const to = pending.to;
    const attacker = g.players[from];
    const target = g.players[to];
    
    if(!attacker || !attacker.alive || !target || !target.alive) {
      finishZhimeng(g, originalCtx, false);
      return g;
    }
    
    if(pending.options.length === 1) {
      zhimengAutoResolve(g, from, to, pending.options[0]);
      finishZhimeng(g, originalCtx, true);
      return g;
    }
    
    g.pending = {
      type: 'zhimengPick',
      from: from,
      to: to,
      options: pending.options.slice(),
      originalCtx: originalCtx
    };
    g.phase = 'zhimengPick';
    g.log = pushLog(g.log, attacker.name + ' 选择获得哪一张牌…');
    
    return g;
  });
}

// 响应制蛮牌选择
function respondZhimengPick(optionType, optionIndex) {
  tx(g => {
    if(g.phase !== 'zhimengPick') return g;
    
    const pending = g.pending;
    if(!pending || pending.type !== 'zhimengPick') {
      g.phase = 'play';
      return g;
    }
    if(pending.from !== mySeat) return g;
    
    const originalCtx = pending.originalCtx || {};
    originalCtx.to = pending.to;
    originalCtx.sourceSeat = pending.from;
    
    const from = pending.from;
    const to = pending.to;
    const attacker = g.players[from];
    const target = g.players[to];
    
    if(!attacker || !attacker.alive || !target || !target.alive) {
      finishZhimeng(g, originalCtx, false);
      return g;
    }
    
    let selectedOption = null;
    for(let i = 0; i < pending.options.length; i++) {
      const opt = pending.options[i];
      if(opt.type === optionType && (optionIndex === undefined || opt.index === optionIndex)) {
        selectedOption = opt;
        break;
      }
    }
    
    if(!selectedOption) return g;
    
    zhimengAutoResolve(g, from, to, selectedOption);
    finishZhimeng(g, originalCtx, true);
    return g;
  });
}

// respondHaoshi: 鲁肃【好施】——选择目标角色
function respondHaoshi(targetSeat){
  tx(g=>{
    if(g.phase!=='haoshiPick'||!g.pending||g.pending.type!=='haoshiPick'||g.pending.seat!==mySeat) return g;
    const me = g.players[mySeat];
    if(!hasCap(me,'haoshi')) return g;
    if(typeof targetSeat!=='number') return g;
    if(!g.pending.candidates || !g.pending.candidates.includes(targetSeat)) return g;
    if(!g.players[targetSeat] || !g.players[targetSeat].alive) return g;
    
    const half = g.pending.half;
    const cardsToGive = me.hand.splice(0, half);
    g.players[targetSeat].hand.push(...cardsToGive);
    g.log = pushLog(g.log, me.name+' 发动【好施】,将'+half+'张手牌交给 '+g.players[targetSeat].name);
    markSkillSound(g, '好施');
    
    // 清理pending状态，继续游戏
    g.pending = null;
    g.phase = 'play';
    
    return g;
  });
}

// respondDimeng: 鲁肃【缔盟】——选择两名其他角色并弃置X张牌,令他们交换手牌
function respondDimeng(seatA, seatB){
  tx(g=>{
    if(g.phase!=='play'||g.turn!==mySeat) return g;
    const me=g.players[mySeat];
    if(!hasCap(me,'dimeng')) return g;
    if(typeof seatA!=='number' || typeof seatB!=='number') return g;
    if(seatA===seatB || seatA===mySeat || seatB===mySeat) return g;
    if(!g.players[seatA] || !g.players[seatA].alive || !g.players[seatB] || !g.players[seatB].alive) return g;
    if(g.dimengUsed) return g;
    
    // 计算X = 手牌数之差
    const handA = (g.players[seatA].hand || []).length;
    const handB = (g.players[seatB].hand || []).length;
    const X = Math.abs(handA - handB);
    
    // 检查是否能弃置X张牌
    if((me.hand || []).length < X) {
      g.log = pushLog(g.log, me.name+' 手牌不足'+X+'张,无法发动【缔盟】');
      return g;
    }
    
    // 弃置X张牌
    const cardsToDiscard = me.hand.splice(0, X);
    g.discard.push(...cardsToDiscard);
    
    // 交换两名角色的手牌
    const tempA = g.players[seatA].hand || [];
    const tempB = g.players[seatB].hand || [];
    g.players[seatA].hand = tempB;
    g.players[seatB].hand = tempA;
    
    g.dimengUsed = true;
    g.log = pushLog(g.log, me.name+' 发动【缔盟】,弃置'+X+'张牌,令 '+g.players[seatA].name+' 与 '+g.players[seatB].name+' 交换手牌');
    markSkillSound(g, '缔盟');
    
    return g;
  });
}

// ============================================================================
// 夏侯渊【神速】技能实现
// ============================================================================

// 发动神速1
function triggerShensu1() {
  tx(g => {
    const seat = g.turn;
    const p = g.players[seat];
    
    // 【断点2修复】守卫和标记位改成 shensuUsed1(神速1自己的标志位),不再是共享的
    // shensuUsed——发动过神速2不该挡住神速1(见 continueShensu1Check 同款注释)。
    if (!p || !p.alive || !hasCap(p, 'shensu') || g.shensuUsed1) return g;

    // 标记神速1已使用
    g.shensuUsed1 = true;

    // 设置跳过判定和摸牌标记
    g.shensuSkipJudgingAndDraw = true;
    
    // 标记需要使用1张无距离限制的杀
    g.shensuShaRemaining = 1;
    
    // 设置杀的目标选择
    g.pending = {
      type: 'shensuSha',
      seat: seat,
      remaining: 1,
      noDistance: true,
      fromShensu: 'shensu1'
    };
    
    g.phase = 'shensuSha';
    g.log = pushLog(g.log, p.name + ' 发动【神速1】,跳过判定和摸牌阶段,需使用1张无距离限制的【杀】');
    markSkillSound(g, '神速');
    
    return g;
  });
}

// 发动神速2
function triggerShensu2() {
  tx(g => {
    const seat = mySeat;
    const p = g.players[seat];
    
    // 【断点2修复】守卫和标记位改成 shensuUsed2(神速2自己的标志位),不再是共享的
    // shensuUsed——这正是断点2的根因:发动过神速1之后这里原来会被同一把总锁挡住。
    if (!p || !p.alive || !hasCap(p, 'shensu') || g.shensuUsed2) return g;

    // 标记神速2已使用
    g.shensuUsed2 = true;

    // 检查是否有装备牌可以弃置
    let equipToDiscard = findShensuEquipToDiscard(p);
    if (!equipToDiscard) {
      // 检查手牌中的装备牌
      const equipInHand = findShensuEquipCardInHand(p);
      if (equipInHand !== null) {
        equipToDiscard = { type: 'hand', index: equipInHand };
      }
    }
    
    if (!equipToDiscard) {
      g.log = pushLog(g.log, p.name + ' 没有装备牌可弃置,无法发动【神速2】');
      g.pending = null;
      g.phase = 'play';
      return g;
    }
    
    // 弃置装备牌
    if (equipToDiscard.type === 'equip') {
      discardShensuEquip(g, seat, equipToDiscard);
    } else if (equipToDiscard.type === 'hand') {
      discardShensuCardFromHand(g, seat, equipToDiscard.index);
    }
    
    // 设置跳过出牌阶段标记
    g.shensuSkipPlay = true;
    
    // 计算需要使用的杀数量
    // 如果已经发动过神速1，那么这是第二刀杀
    const shaCount = g.shensuShaRemaining + 1;
    g.shensuShaRemaining = shaCount;
    
    // 设置杀的目标选择
    g.pending = {
      type: 'shensuSha',
      seat: seat,
      remaining: shaCount,
      noDistance: true,
      fromShensu: shaCount > 1 ? 'shensu1+2' : 'shensu2'
    };
    
    g.phase = 'shensuSha';
    g.log = pushLog(g.log, p.name + ' 发动【神速2】,跳过出牌阶段并弃置装备牌,需使用' + shaCount + '张无距离限制的【杀】');
    markSkillSound(g, '神速');
    
    return g;
  });
}

// 辅助函数：查找要弃置的装备牌（装备区）
function findShensuEquipToDiscard(player) {
  const equips = player.equips || {};
  const slots = ['weapon', 'armor', 'plus1', 'minus1'];
  
  for (const slot of slots) {
    if (equips[slot]) {
      return { type: 'equip', slot, card: equips[slot] };
    }
  }
  return null;
}

// 辅助函数：查找手牌中的装备牌
function findShensuEquipCardInHand(player) {
  const hand = player.hand || [];
  // 装备牌列表
  const equipNames = ['诸葛连弩', '丈八蛇矛', '青釭剑', '麒麟弓', '青龙偃月刀', 
                     '寒冰剑', '方天画戟', '古锭刀', '贯石斧', '的卢', '绝影', 
                     '爪黄飞电', '大宛', '赤兔', '紫骍', '骕骦', '八卦阵', '仁王盾'];
  
  for (let i = 0; i < hand.length; i++) {
    if (hand[i] && equipNames.includes(hand[i].name)) {
      return i; // 返回手牌中的索引
    }
  }
  return null;
}

// 辅助函数：弃置一张装备
function discardShensuEquip(g, seat, equipInfo) {
  const player = g.players[seat];
  if (!player || !player.alive) return;
  
  const slot = equipInfo.slot;
  const card = equipInfo.card;
  
  if (player.equips && player.equips[slot] === card) {
    player.equips[slot] = null;
    g.discard.push(card);
    g.log = pushLog(g.log, player.name + ' 弃置了装备牌【' + card.name + '】');
  }
}

// 辅助函数：从手牌中弃置一张装备牌
function discardShensuCardFromHand(g, seat, cardIndex) {
  const player = g.players[seat];
  if (!player || !player.alive) return;
  
  const card = player.hand[cardIndex];
  if (card) {
    player.hand.splice(cardIndex, 1);
    g.discard.push(card);
    g.log = pushLog(g.log, player.name + ' 弃置了手牌中的装备牌【' + card.name + '】');
  }
}

// 处理神速杀的目标选择
// 【根因修复,见 CLAUDE.md「夏侯渊神速」条】resolveShaUse 内部(经 resolveShaUseNoLiuli→
// continueShaAfterTieqi)会把 g.pending 整个替换成杀的标准响应结构(等待目标出闪/受伤;或
// tieqi/liegong/guanxing 等其它子阶段),原实现在调用之后才读 g.pending.remaining——读到的
// 已经不是这个 shensuSha pending 了,而且原实现无论 remaining 算出多少,都会在调用后
// 立刻 g.pending=null 收尾,把刚建立起来的响应阶段直接冲掉,目标从未真正获得响应机会。
// 修复不是简单地把 remaining 挪到调用前读(即使读对了数值,后面那段"立刻收尾"的代码本身
// 依然会把响应阶段冲掉)——真正需要做的是让"这次杀处理完之后该怎么收尾"这件事,推迟到杀
// 真正彻底结算完毕(不管中途有没有被濒死/争议/天香/制蛮/毅重/仁王盾/八卦阵等任意效果打断)
// 那一刻才执行。做法是把这个信息存进 g.shensuResume(全局字段,不挂在 g.pending 上)——
// 和 g.fangtianQueue/g.luanwuResume 同一设计(见 CLAUDE.md「方天画戟嵌套天然正确」条:
// 队列/续接信息放在 g 上、不进被打断的局部栈,不受 g.pending 被谁替换的影响),配合
// finishSingleShaTarget 新增的 g.shensuResume 检查——它是这张杀彻底结算完毕的唯一收敛点
// (fangtianQueue/luanwuResume 也复用同一个收敛点),在这里做神速自己的阶段跳转天然正确。
function respondShensuSha(targetSeat) {
  tx(g => {
    if (g.pending.type !== 'shensuSha' || g.pending.seat !== mySeat) return g;

    const target = g.players[targetSeat];

    if (!target || !target.alive) return g;

    // 调用 resolveShaUse 之前先把需要的字段读出来存成局部变量/挪到 g.shensuResume,
    // 不要指望调用后还能从 g.pending 读到这个 shensuSha pending 原来的东西。
    const remaining = (g.pending.remaining || 1) - 1;
    const fromShensu = g.pending.fromShensu;
    g.shensuResume = { seat: mySeat, remaining, fromShensu };
    g.pending = null; // 交给 resolveShaUse 自己决定这一刻该是什么 pending(和借刀杀人 respondJiedao 出杀分支同一写法)

    // 使用一张无距离限制的普通杀
    const sha = {
      name: '杀',
      suit: '♠',
      rank: 2,
      id: 'shensu_sha_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4)
    };

    // 神速的杀不计入出杀次数限制，所以传递 skipShaLimit 标记
    const shaInfo = {
      noDistance: true,
      fromShensu: true,
      shensuType: fromShensu,
      skipShaLimit: true
    };

    resolveShaUse(g, g.players[mySeat], targetSeat, '无距离限制的【杀】', singleCardShaColor(sha), sha, shaInfo);

    return g;
  });
}

// finishShensuSha: g.shensuResume 存在时由 finishSingleShaTarget 调用——这张"视为杀"已经
// 彻底结算完毕(命中/被闪抵消/被毅重仁王盾无效/等等,不管走了哪条子路径),现在才是真正安全
// 执行神速自己的阶段跳转的时机。
function finishShensuSha(g){
  const resume = g.shensuResume;
  g.shensuResume = null;
  const seat = resume.seat;
  const p = g.players[seat];
  const remaining = resume.remaining;

  if (remaining > 0) {
    // 【断点2已修复,这个分支现在真的可达了】shensuUsed 共享总锁拆成 shensuUsed1/
    // shensuUsed2 之后,神速1+2 组合(俗称"夏侯二刀")可以在同一回合都发动,
    // g.shensuShaRemaining 会先被 triggerShensu1 设成1,再被 triggerShensu2 累加成2——
    // 这条分支当初实现 finishShensuSha 时就已经按"重新挂起 shensuSha pending 问下一个
    // 目标"写好了,这次断点2修复没有改动这里的逻辑本身,只是让它从"写好了但走不到"变成
    // 真正可达,已有真实场景测试覆盖(run_shensu_sha_test.js)。
    g.shensuShaRemaining = remaining;
    g.pending = { type: 'shensuSha', seat, remaining, noDistance: true, fromShensu: resume.fromShensu };
    g.phase = 'shensuSha';
    if (p) g.log = pushLog(g.log, p.name + ' 还需要使用' + remaining + '张无距离限制的普通【杀】');
    return;
  }

  g.shensuShaRemaining = 0;
  if (g.shensuSkipJudgingAndDraw && g.shensuSkipPlay) {
    // 同时发动了神速1和神速2
    g.shensuSkipJudgingAndDraw = false;
    g.shensuSkipPlay = false;
    g.phase = 'discard';
    if (p) g.log = pushLog(g.log, p.name + ' 【神速1+2】效果生效，跳过判定、摸牌和出牌阶段，进入弃牌阶段');
  } else if (g.shensuSkipJudgingAndDraw) {
    // 只发动了神速1
    g.shensuSkipJudgingAndDraw = false;
    g.phase = 'play';
    if (p) g.log = pushLog(g.log, p.name + ' 【神速1】效果生效，跳过判定和摸牌阶段，进入出牌阶段');
  } else if (g.shensuSkipPlay) {
    // 只发动了神速2
    g.shensuSkipPlay = false;
    g.phase = 'discard';
    if (p) g.log = pushLog(g.log, p.name + ' 【神速2】效果生效，跳过出牌阶段，进入弃牌阶段');
  } else {
    // 正常返回出牌阶段
    g.phase = 'play';
  }
}

// 跳过神速1:回到判定区结算链路(不是写一个不存在的 phase='judge')
function skipShensu1() {
  tx(g => {
    if (g.pending && g.pending.type === 'shensuChoose1' && g.pending.seat === mySeat) {
      g.pending = null;
      g.log = pushLog(g.log, g.players[mySeat].name + ' 选择不发动【神速1】');
      continueDelayResolution(g, mySeat);
    }
    return g;
  });
}

// 跳过神速2
function skipShensu2() {
  tx(g => {
    if (g.pending && g.pending.type === 'shensuChoose2' && g.pending.seat === mySeat) {
      g.pending = null;
      g.phase = 'play';
      g.log = pushLog(g.log, g.players[mySeat].name + ' 选择不发动【神速2】');
    }
    return g;
  });
}

// 取消神速杀选择
function cancelShensuSha() {
  tx(g => {
    if (g.pending && g.pending.type === 'shensuSha' && g.pending.seat === mySeat) {
      g.pending = null;
      g.shensuShaRemaining = 0;
      
      // 检查是否有阶段跳过效果需要处理
      if (g.shensuSkipJudgingAndDraw && g.shensuSkipPlay) {
        g.shensuSkipJudgingAndDraw = false;
        g.shensuSkipPlay = false;
        g.phase = 'discard';
        g.log = pushLog(g.log, g.players[mySeat].name + ' 取消使用【杀】，但【神速1+2】阶段跳过效果仍生效');
      } else if (g.shensuSkipJudgingAndDraw) {
        g.shensuSkipJudgingAndDraw = false;
        g.phase = 'play';
        g.log = pushLog(g.log, g.players[mySeat].name + ' 取消使用【杀】，但【神速1】阶段跳过效果仍生效');
      } else if (g.shensuSkipPlay) {
        g.shensuSkipPlay = false;
        g.phase = 'discard';
        g.log = pushLog(g.log, g.players[mySeat].name + ' 取消使用【杀】，但【神速2】阶段跳过效果仍生效');
      } else {
        g.phase = 'play';
      }
    }
    return g;
  });
}

// ============ 公孙瓒技能 ============

// isMountCard: 辅助函数，判断卡片是否为坐骑牌
function isMountCard(card) {
  if (!card || !card.name) return false;
  const mountNames = ['的卢', '绝影', '爪黄飞电', '大宛', '赤兔', '紫骍', '骕骦'];
  return mountNames.includes(card.name);
}

// triggerQiaomeng: 公孙瓒【趫猛】—— 选择目标装备牌
function triggerQiaomeng() {
  tx(g => {
    const pending = g.pending;
    if (!pending || pending.type !== 'qiaomengChoose' || pending.sourceSeat !== mySeat) return g;
    
    const source = g.players[mySeat];
    const target = g.players[pending.targetSeat];
    
    if (!source || !source.alive || !target || !target.alive) return g;
    
    // 检查目标是否有装备
    const equips = target.equips || {};
    const equipSlots = Object.keys(equips).filter(slot => equips[slot] !== null);
    
    if (equipSlots.length === 0) {
      g.log = pushLog(g.log, target.name + ' 没有装备牌,【趫猛】无法发动');
      g.pending = null;
      g.phase = 'play';
      return g;
    }
    
    // 进入装备选择阶段
    g.pending = {
      type: 'qiaomengPickEquip',
      sourceSeat: mySeat,
      targetSeat: pending.targetSeat,
      availableSlots: equipSlots
    };
    g.phase = 'qiaomengPickEquip';
    g.log = pushLog(g.log, source.name + ' 选择要获取或弃置的装备牌');
    
    return g;
  });
}

// pickQiaomengEquip: 公孙瓒【趫猛】—— 选择具体装备卡
function pickQiaomengEquip(slot) {
  tx(g => {
    const pending = g.pending;
    if (!pending || pending.type !== 'qiaomengPickEquip' || pending.sourceSeat !== mySeat) return g;
    
    const source = g.players[mySeat];
    const target = g.players[pending.targetSeat];
    
    if (!source || !source.alive || !target || !target.alive) return g;
    if (!pending.availableSlots.includes(slot)) return g;
    
    const card = target.equips[slot];
    if (!card) return g;
    
    // 判断是否为坐骑牌
    const isMount = isMountCard(card);
    
    // 【失去装备钩子的正确接法,见 CLAUDE.md「凌统旋风」条】趫猛拿走目标装备是杀结算中途的
    // mid-杀效果(和麒麟弓/猛进同一位置:respondShan 的不闪分支,finishSingleShaTarget 之前)。
    // 必须先把休止相/pending 重置成"到站"状态,再触发 onLoseEquip——否则钩子(凌统【旋风】)
    // 捕获的 previousPhase 会是此刻的 'qiaomengPickEquip'(死相,pending 已经不在了),旋风
    // 若不发动、恢复到这个死相就会软锁。重置后才触发钩子,钩子若挂起了新 pending(旋风)就
    // attach resume={type:'sha'} 并 return,不再往下调用 finishSingleShaTarget 把它覆盖掉
    // (遗计/濒死/麒麟弓/猛进同一套 pendingBefore 快照约定,零新写法)。
    // 收尾从裸的 phase='play' 改成调用 finishSingleShaTarget(g)(和麒麟弓/猛进一致)——这不是
    // 新增功能,是让趫猛走上这两个函数本来就该走的正确收尾路径,顺带修复了此前"从不调用
    // finishSingleShaTarget、跳过 checkWin/方天画戟队列推进"这个独立既有 bug(方天画戟+趫猛
    // 组合下,拿走目标装备后方天队列会永久卡死,不会推进到下一目标)。
    if (isMount) {
      // 获得坐骑牌：直接置入手牌
      target.equips[slot] = null;
      if (!source.hand) source.hand = [];
      source.hand.push(card);
      g.log = pushLog(g.log, source.name + ' 获得 ' + target.name + ' 的坐骑牌【' + card.name + '】并置入手牌');
      markSkillSound(g, 'qiaomeng');
    } else {
      // 弃置非坐骑牌
      target.equips[slot] = null;
      g.discard.push(card);
      g.log = pushLog(g.log, source.name + ' 弃置 ' + target.name + ' 的装备牌【' + card.name + '】');
      markSkillSound(g, 'qiaomeng');
    }

    // 清理状态(先重置,让 onLoseEquip 钩子捕获到正确的休止相)
    g.pending = null;
    g.phase = 'play';
    const pendingBefore = g.pending; // = null
    triggerHook(g, pending.targetSeat, 'onLoseEquip', {count:1});
    if(g.pending !== pendingBefore && g.pending){ g.pending.resume = {type:'sha'}; return g; } // 旋风等钩子挂起了,保留不覆盖
    finishSingleShaTarget(g); // 方天画戟排队中还有下一个则继续,否则回到出牌阶段

    return g;
  });
}

// cancelQiaomeng: 公孙瓒【趫猛】—— 取消
function cancelQiaomeng() {
  tx(g => {
    if (g.pending && (g.pending.type === 'qiaomengChoose' || g.pending.type === 'qiaomengPickEquip') &&
        g.pending.sourceSeat === mySeat) {
      g.pending = null;
      g.phase = 'play';
      g.log = pushLog(g.log, g.players[mySeat].name + ' 取消发动【趫猛】');
    }
    return g;
  });
}


// ========== 典韦【强袭】技能函数 ==========

// hasWeaponToDiscard: 检查玩家是否有可弃置的武器牌（装备区或手牌）
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

// startQiangxi: 典韦【强袭】—— 发动技能
function startQiangxi() {
  tx(g => {
    if (g.phase !== 'play' || g.turn !== mySeat) return g;
    const me = g.players[mySeat];
    if (!me || !me.alive || !hasCap(me, 'qiangxi') || g.qiangxiUsed) return g;
    
    // 进入消耗选择阶段
    g.pending = {
      type: 'qiangxiChooseCost',
      seat: mySeat
    };
    g.phase = 'qiangxiChooseCost';
    g.log = pushLog(g.log, `${me.name} 发动【强袭】,请选择支付方式`);
    markSkillSound(g, '强袭');
    
    return g;
  });
}

// chooseQiangxiCost: 典韦【强袭】—— 选择支付方式
function chooseQiangxiCost(costType) {
  tx(g => {
    if (g.pending.type !== 'qiangxiChooseCost' || g.pending.seat !== mySeat) return g;
    const me = g.players[mySeat];
    if (!me || !me.alive) return g;
    
    // 验证消耗方式是否可行
    if (costType === 'hp' && me.hp <= 1) return g;
    if (costType === 'weapon' && !hasWeaponToDiscard(me)) return g;
    
    // 如果选择弃置武器牌，需要先选择具体哪张武器牌
    if (costType === 'weapon') {
      const weaponInEquip = me.equips && me.equips.weapon;
      const weaponInHand = [];
      
      if (me.hand) {
        for (let i = 0; i < me.hand.length; i++) {
          if (me.hand[i] && EQUIPS[me.hand[i].name]) {
            weaponInHand.push(i);
          }
        }
      }
      
      // 如果有装备区的武器，直接使用
      if (weaponInEquip) {
        // 直接进入目标选择，使用装备区的武器
        proceedWithWeaponDiscard(g, 'equip', me.equips.weapon, null);
        return g;
      }
      
      // 如果只有手牌中的武器，需要选择哪一张
      if (weaponInHand.length > 0) {
        g.pending = {
          type: 'qiangxiChooseWeaponFromHand',
          seat: mySeat,
          weaponIndices: weaponInHand
        };
        g.phase = 'qiangxiChooseWeaponFromHand';
        g.log = pushLog(g.log, `${me.name} 选择从手牌弃置武器牌,请选择`);
        return g;
      }
      
      // 不应该到达这里，但为了安全起见
      g.log = pushLog(g.log, `${me.name} 强袭发动失败,无可弃置的武器牌`);
      g.pending = null;
      g.phase = 'play';
      return g;
    }
    
    // 失去体力的情况，直接进入目标选择
    if (costType === 'hp') {
      proceedWithCostType(g, 'hp');
    }
    
    return g;
  });
}

// proceedWithWeaponDiscard: 典韦【强袭】—— 处理武器弃置的具体执行
function proceedWithWeaponDiscard(g, source, weapon, weaponIndex) {
  const me = g.players[mySeat];
  const myAttackRange = getAttackRange(g, mySeat);
  
  // 找到所有在攻击范围内的目标
  const candidates = [];
  for (let i = 0; i < g.players.length; i++) {
    if (i === mySeat || !g.players[i] || !g.players[i].alive) continue;
    if (distance(g, mySeat, i) <= myAttackRange) {
      candidates.push(i);
    }
  }
  
  if (candidates.length === 0) {
    g.log = pushLog(g.log, `${me.name} 攻击范围内无目标,无法发动【强袭】`);
    g.pending = null;
    g.phase = 'play';
    return g;
  }
  
  // 存储消耗方式和武器信息，进入目标选择阶段
  g.pending = {
    type: 'qiangxiPickTarget',
    seat: mySeat,
    costType: 'weapon',
    weaponSource: source,
    weapon: weapon,
    weaponIndex: source === 'hand' ? weaponIndex : null,
    candidates: candidates
  };
  g.phase = 'qiangxiPickTarget';
  g.log = pushLog(g.log, `${me.name} 选择了弃置武器牌,请选择目标`);
}

// proceedWithCostType: 典韦【强袭】—— 处理失去体力的消耗类型
function proceedWithCostType(g, costType) {
  const me = g.players[mySeat];
  const myAttackRange = getAttackRange(g, mySeat);
  
  // 找到所有在攻击范围内的目标
  const candidates = [];
  for (let i = 0; i < g.players.length; i++) {
    if (i === mySeat || !g.players[i] || !g.players[i].alive) continue;
    if (distance(g, mySeat, i) <= myAttackRange) {
      candidates.push(i);
    }
  }
  
  if (candidates.length === 0) {
    g.log = pushLog(g.log, `${me.name} 攻击范围内无目标,无法发动【强袭】`);
    g.pending = null;
    g.phase = 'play';
    return g;
  }
  
  // 存储消耗方式，进入目标选择阶段
  g.pending = {
    type: 'qiangxiPickTarget',
    seat: mySeat,
    costType: costType,
    candidates: candidates
  };
  g.phase = 'qiangxiPickTarget';
  g.log = pushLog(g.log, `${me.name} 选择了失去1点体力,请选择目标`);
}

// chooseQiangxiWeaponFromHand: 典韦【强袭】—— 选择手牌中的武器牌
function chooseQiangxiWeaponFromHand(cardIndex) {
  tx(g => {
    if (g.pending.type !== 'qiangxiChooseWeaponFromHand' || g.pending.seat !== mySeat) return g;
    const me = g.players[mySeat];
    if (!me || !me.alive) return g;
    
    if (!g.pending.weaponIndices.includes(cardIndex)) return g;
    
    const weapon = me.hand[cardIndex];
    if (!weapon || !EQUIPS[weapon.name]) return g;
    
    // 进入目标选择阶段
    proceedWithWeaponDiscard(g, 'hand', weapon, cardIndex);
    
    return g;
  });
}

// pickQiangxiTarget: 典韦【强袭】—— 选择目标并执行强袭效果
function pickQiangxiTarget(targetSeat) {
  tx(g => {
    if (g.pending.type !== 'qiangxiPickTarget' || g.pending.seat !== mySeat) return g;
    const me = g.players[mySeat];
    const target = g.players[targetSeat];
    
    if (!me || !me.alive || !target || !target.alive) return g;
    
    // 验证目标是否在候选列表中
    if (!g.pending.candidates.includes(targetSeat)) return g;
    
    const costType = g.pending.costType;
    
    // 支付消耗
    if (costType === 'hp') {
      me.hp--;
      g.log = pushLog(g.log, `${me.name} 失去1点体力`);
    } else if (costType === 'weapon') {
      const weaponSource = g.pending.weaponSource;
      const weapon = g.pending.weapon;
      const weaponIndex = g.pending.weaponIndex;
      
      if (weaponSource === 'equip') {
        if (me.equips && me.equips.weapon === weapon) {
          me.equips.weapon = null;
          g.discard.push(weapon);
          g.log = pushLog(g.log, `${me.name} 弃置了装备区的武器牌【${weapon.name}】`);
        }
      } else if (weaponSource === 'hand' && typeof weaponIndex === 'number') {
        const card = me.hand[weaponIndex];
        if (card) {
          me.hand.splice(weaponIndex, 1);
          g.discard.push(card);
          g.log = pushLog(g.log, `${me.name} 弃置了手牌中的武器牌【${card.name}】`);
        }
      }
    }
    
    // 标记技能已使用
    g.qiangxiUsed = true;
    
    // 造成1点伤害;若挂起濒死/受伤后技能,保留其 pending,不可无条件清空
    const interrupted = dealDamage(g, targetSeat, 1, mySeat, `${me.name} 的【强袭】`, 'qiangxi');
    if(interrupted) return g;
    g.pending = null;
    g.phase = 'play';
    if(checkWin(g)) return g;
    return g;
  });
}

// cancelQiangxi: 典韦【强袭】—— 取消（仅在消耗选择阶段可用）
function cancelQiangxi() {
  tx(g => {
    if (g.pending && (g.pending.type === 'qiangxiChooseCost' || g.pending.type === 'qiangxiChooseWeaponFromHand') && g.pending.seat === mySeat) {
      g.pending = null;
      g.phase = 'play';
      g.log = pushLog(g.log, `${g.players[mySeat].name} 取消发动【强袭】`);
    }
    return g;
  });
}

// getAttackRange: 与 game.js 的 attackRange 同口径(武器 range 即攻击距离,无武器默认 1)。
// 旧实现曾错误地"基础1 + 武器range + 马",导致所有武器射程+1、马被算进攻击距离。
function getAttackRange(g, seat) {
  return attackRange(g, seat);
}

// ============================================
// 贾诩【乱武】技能相关函数
// ============================================

// 乱武最近目标只存 g.pending.targetMap(Firebase 同步),禁止客户端全局变量——
// 非发动者浏览器没有发动时写入的 map,读全局会拿空/错目标。

// findNearestTarget: 找到一个角色距离最近的其他角色（排除自己和源头）
function findNearestTarget(g, seat, excludeSeat) {
  const aliveSeats = g.players.map((p, i) => i).filter(i => 
    g.players[i] && g.players[i].alive && i !== seat && i !== excludeSeat
  );
  
  if (aliveSeats.length === 0) return null;
  
  let nearestSeat = null;
  let minDistance = Infinity;
  
  for (const targetSeat of aliveSeats) {
    const dist = distance(g, seat, targetSeat);
    if (dist < minDistance) {
      minDistance = dist;
      nearestSeat = targetSeat;
    }
  }
  
  return nearestSeat;
}

// hasShaCard: 检查角色是否有杀
function hasShaCard(g, seat) {
  const player = g.players[seat];
  if (!player || !player.alive) return false;
  
  // 检查手牌
  const hand = player.hand || [];
  for (const card of hand) {
    if (canUseAs(player, card, '杀')) {
      return true;
    }
  }
  
  return false;
}

// startLuanwu: 乱武发动函数
function startLuanwu() {
  tx(g => {
    if (g.phase !== 'play' || g.turn !== mySeat) return g;
    const me = g.players[mySeat];
    if (!me || !me.alive || !hasCap(me, 'luanwu') || g.luanwuUsed) return g;
    
    // 标记乱武已使用
    g.luanwuUsed = true;
    
    // 准备乱武选择流程
    // 找出所有其他存活角色
    const otherSeats = [];
    for (let i = 0; i < g.players.length; i++) {
      if (i === mySeat || !g.players[i] || !g.players[i].alive) continue;
      otherSeats.push(i);
    }
    
    if (otherSeats.length === 0) {
      g.log = pushLog(g.log, `${me.name} 发动【乱武】时,场上无其他角色`);
      g.pending = null;
      g.phase = 'play';
      return g;
    }
    
    // 为每个角色预计算最近的目标(写入 pending,随 Firebase 同步到所有客户端)
    const targetMap = {};
    for (const seat of otherSeats) {
      const nearest = findNearestTarget(g, seat, mySeat);
      targetMap[seat] = nearest;
    }
    
    // 进入乱武选择阶段,从第一个角色开始
    g.pending = {
      type: 'luanwuChoose',
      currentSeat: otherSeats[0],
      remainingSeats: otherSeats.slice(1),
      sourceSeat: mySeat,
      targetMap: targetMap
    };
    g.phase = 'luanwuChoose';
    g.log = pushLog(g.log, `${me.name} 发动【乱武】,令所有其他角色依次选择`);
    markSkillSound(g, '乱武');
    
    return g;
  });
}

// chooseLuanwuOption: 乱武选择处理
function chooseLuanwuOption(option) {
  tx(g => {
    if (g.pending.type !== 'luanwuChoose') return g;
    if (g.pending.currentSeat !== mySeat) return g;

    const currentSeat = g.pending.currentSeat;
    const sourceSeat = g.pending.sourceSeat;
    const currentPlayer = g.players[currentSeat];
    
    if (!currentPlayer || !currentPlayer.alive) {
      // 当前角色已死亡，跳过
      proceedToNextLuanwu(g);
      return g;
    }
    
    // 处理选择——目标只信 pending.targetMap(全客户端同步)
    if (option === 'sha') {
      const map = g.pending.targetMap || {};
      const targetSeat = map[currentSeat];
      
      if (typeof targetSeat === 'number' && targetSeat !== currentSeat) {
        const hasSha = hasShaCard(g, currentSeat);
        const canAttack = canReachSha(g, currentSeat, targetSeat);
        
        if (hasSha && canAttack) {
          useShaForLuanwu(g, currentSeat, targetSeat);
        } else {
          loseHpForLuanwu(g, currentSeat);
        }
      } else {
        loseHpForLuanwu(g, currentSeat);
      }
    } else if (option === 'hp') {
      loseHpForLuanwu(g, currentSeat);
    }
    
    return g;
  });
}

// useShaForLuanwu: 乱武中使用杀——走完整 resolveShaUse(铁骑/烈弓/八卦/闪/伤害/武器),
// 不再直接 dealDamage。杀结算跨 pending,链状态存 g.luanwuResume,由 finishSingleShaTarget 接回。
function useShaForLuanwu(g, sourceSeat, targetSeat) {
  const source = g.players[sourceSeat];
  const target = g.players[targetSeat];
  
  if (!source || !source.alive || !target || !target.alive) return g;
  
  // 找到一张杀
  let shaCard = null;
  let shaIndex = -1;
  
  for (let i = 0; i < (source.hand || []).length; i++) {
    if (canUseAs(source, source.hand[i], '杀')) {
      shaCard = source.hand[i];
      shaIndex = i;
      break;
    }
  }
  
  if (!shaCard) return g;
  
  // 快照乱武链(resolveShaUse 会覆盖 g.pending)
  const luanwuSnap = (g.pending && g.pending.type==='luanwuChoose') ? {
    remainingSeats: (g.pending.remainingSeats||[]).slice(),
    sourceSeat: g.pending.sourceSeat,
    targetMap: g.pending.targetMap || null
  } : {
    remainingSeats: [],
    sourceSeat: g.pending && g.pending.sourceSeat,
    targetMap: (g.pending && g.pending.targetMap) || null
  };
  
  // 移除杀
  source.hand.splice(shaIndex, 1);
  g.discard.push(shaCard);
  maybeStartLianying(g, sourceSeat, 1);
  
  g.log = pushLog(g.log, `${source.name} 选择对 ${target.name} 使用【杀】(乱武)`);
  markCardSound(g, '杀', sourceSeat, shaCard, targetSeat);
  if(shaCard.name!=='杀'){
    if(hasCap(source,'longdan')) markSkillSound(g,'龙胆');
    else if(hasCap(source,'wusheng')) markSkillSound(g,'武圣');
  }
  
  // 存链状态:杀完整结算后 finishSingleShaTarget → continueLuanwuAfterSha
  g.luanwuResume = {
    remainingSeats: luanwuSnap.remainingSeats,
    sourceSeat: luanwuSnap.sourceSeat,
    targetMap: luanwuSnap.targetMap
  };
  g.pending = null;
  // 完整杀结算(无距离限制:乱武选目标时已校验 canReachSha;skip 次数限制)
  resolveShaUse(g, source, targetSeat, '【乱武】出【杀】', singleCardShaColor(shaCard), shaCard, {
    skipShaLimit: true,
    noDistance: true
  });
  // 若 resolve 同步结束(毅重无效等走 finishSingleShaTarget),luanwuResume 已被消费;
  // 若进入 respond/tieqi 等,等该路径收尾再 continueLuanwuAfterSha。
  return g;
}

// loseHpForLuanwu: 乱武中失去体力处理
function loseHpForLuanwu(g, seat) {
  const player = g.players[seat];
  if (!player || !player.alive) return g;
  
  player.hp--;
  g.log = pushLog(g.log, `${player.name} 选择失去1点体力`);
  
  // 检查是否死亡——用 startDying 挂起;链状态进 luanwuResume 供 finishDying 接回
  if (player.hp <= 0) {
    const snap = (g.pending && g.pending.type==='luanwuChoose') ? {
      remainingSeats: (g.pending.remainingSeats||[]).slice(),
      sourceSeat: g.pending.sourceSeat,
      targetMap: g.pending.targetMap || null
    } : null;
    if(snap) g.luanwuResume = snap;
    startDying(g, seat, 'luanwu', seat, 1);
  } else {
    proceedToNextLuanwu(g);
  }
  
  return g;
}

// proceedToNextLuanwu: 继续下一个角色的乱武选择
function proceedToNextLuanwu(g) {
  if (g.pending.type !== 'luanwuChoose') return g;
  
  const remainingSeats = g.pending.remainingSeats || [];
  
  if (remainingSeats.length > 0) {
    // 还有角色需要选择
    g.pending.currentSeat = remainingSeats[0];
    g.pending.remainingSeats = remainingSeats.slice(1);
    g.phase = 'luanwuChoose';
  } else {
    // 所有角色都选择完毕
    g.pending = null;
    g.phase = 'play';
    g.log = pushLog(g.log, `【乱武】结算完毕`);
    
    // 检查游戏胜负
    checkWin(g);
  }
  
  return g;
}

// cancelLuanwu: 取消乱武
function cancelLuanwu() {
  tx(g => {
    if (g.pending && g.pending.type === 'luanwuChoose' && g.pending.sourceSeat === mySeat) {
      g.pending = null;
      g.phase = 'play';
      g.log = pushLog(g.log, `${g.players[mySeat].name} 取消发动【乱武】`);
    }
    return g;
  });
}

// ==================== 袁绍【乱击】 ====================

// startLuanji: 发动乱击，进入牌对选择阶段
function startLuanji() {
  tx(g => {
    const me = g.players[mySeat];
    if (!me || !me.alive || g.phase !== 'play' || g.turn !== mySeat) return g;
    
    // 检查手牌中花色相同的牌
    const hand = me.hand || [];
    const suitGroups = {};
    
    for (let i = 0; i < hand.length; i++) {
      const card = hand[i];
      const suit = card.suit;
      if (!suitGroups[suit]) {
        suitGroups[suit] = [];
      }
      suitGroups[suit].push(i);
    }
    
    // 找出所有可以组合的牌对（至少两张相同花色）
    const availablePairs = [];
    for (const [suit, indices] of Object.entries(suitGroups)) {
      if (indices.length >= 2) {
        for (let i = 0; i < indices.length; i++) {
          for (let j = i + 1; j < indices.length; j++) {
            availablePairs.push([indices[i], indices[j]]);
          }
        }
      }
    }
    
    if (availablePairs.length === 0) {
      g.log = pushLog(g.log, `${me.name} 发动【乱击】失败:没有花色相同的手牌`);
      return g;
    }
    
    // 进入乱击选择阶段
    g.pending = {
      type: 'luanjiChoose',
      sourceSeat: mySeat,
      availablePairs: availablePairs
    };
    g.phase = 'luanjiChoose';
    g.log = pushLog(g.log, `${me.name} 发动【乱击】,选择两张花色相同的手牌当【万箭齐发】使用`);
    markSkillSound(g, '乱击');
    
    return g;
  });
}

// pickLuanjiPair: 选择牌对
function pickLuanjiPair(pairIndex) {
  tx(g => {
    const pending = g.pending;
    if (!pending || pending.type !== 'luanjiChoose' || pending.sourceSeat !== mySeat) return g;
    
    if (pairIndex < 0 || pairIndex >= pending.availablePairs.length) return g;
    
    const me = g.players[mySeat];
    const cardIndices = pending.availablePairs[pairIndex];
    const cards = [me.hand[cardIndices[0]], me.hand[cardIndices[1]]];
    
    // 验证这两张牌是否仍然存在且花色相同
    if (!cards[0] || !cards[1] || cards[0].suit !== cards[1].suit) {
      g.log = pushLog(g.log, `${me.name} 选择的牌组合无效`);
      g.pending = null;
      g.phase = 'play';
      return g;
    }
    
    // 进入确认阶段
    g.pending = {
      type: 'luanjiConfirm',
      sourceSeat: mySeat,
      cardIndices: cardIndices
    };
    g.phase = 'luanjiConfirm';
    g.log = pushLog(g.log, `${me.name} 选择了【${cards[0].name}】和【${cards[1].name}】,确认当【万箭齐发】使用吗?`);
    
    return g;
  });
}

// confirmLuanji: 确认使用乱击
function confirmLuanji() {
  tx(g => {
    const pending = g.pending;
    if (!pending || pending.type !== 'luanjiConfirm' || pending.sourceSeat !== mySeat) return g;
    
    const me = g.players[mySeat];
    const cardIndices = pending.cardIndices;
    
    // 移除这两张手牌
    const removedCards = [];
    const hand = me.hand || [];
    
    // 按降序排列索引，避免移除后影响后面的索引
    cardIndices.sort((a, b) => b - a);
    
    for (const idx of cardIndices) {
      if (idx >= 0 && idx < hand.length) {
        removedCards.push(hand.splice(idx, 1)[0]);
      }
    }
    
    if (removedCards.length !== 2) {
      g.log = pushLog(g.log, `${me.name} 使用【乱击】失败:牌数量不足`);
      g.pending = null;
      g.phase = 'play';
      return g;
    }
    
    // 视为使用万箭齐发
    g.log = pushLog(g.log, `${me.name} 将【${removedCards[0].name}】和【${removedCards[1].name}】当【万箭齐发】使用`);
    
    // 执行万箭齐发效果
    const wanjianEffect = CARD_PLAYS['万箭齐发'];
    if (wanjianEffect && wanjianEffect.effect) {
      wanjianEffect.effect(g, me, { name: '万箭齐发', suit: removedCards[0].suit });
    }
    
    // 清理状态
    g.pending = null;
    g.phase = 'play';
    
    return g;
  });
}

// cancelLuanji: 取消乱击
function cancelLuanji() {
  tx(g => {
    if (g.pending && (g.pending.type === 'luanjiChoose' || g.pending.type === 'luanjiConfirm') &&
        g.pending.sourceSeat === mySeat) {
      g.pending = null;
      g.phase = 'play';
      g.log = pushLog(g.log, `${g.players[mySeat].name} 取消发动【乱击】`);
    }
    return g;
  });
}

// ===== 祝融【烈刃】:拼点获得一张牌 =====

// 烈刃选择拼点函数
function triggerLieRen() {
  tx(g => {
    const pending = g.pending;
    if (!pending || pending.type !== 'lieRenChoose' || pending.sourceSeat !== mySeat) return g;
    
    const me = g.players[mySeat];
    const target = g.players[pending.targetSeat];
    
    if (!me || !me.alive || !target || !target.alive) return g;

    // 选择一张手牌用于拼点
    g.pending = {
      type: 'lieRenPickCard',
      sourceSeat: mySeat,
      targetSeat: pending.targetSeat
    };
    g.phase = 'lieRenPickCard';
    g.log = pushLog(g.log, `${me.name} 发动【烈刃】,请选择一张手牌用于拼点`);
    markSkillSound(g, '烈刃');
    
    return g;
  });
}

// 烈刃选择拼点牌
function pickLieRenCard(cardIndex) {
  tx(g => {
    const pending = g.pending;
    if (!pending || pending.type !== 'lieRenPickCard' || pending.sourceSeat !== mySeat) return g;
    
    const me = g.players[mySeat];
    const target = g.players[pending.targetSeat];
    
    if (!me || !me.alive || !target || !target.alive) return g;
    if (!me.hand || cardIndex < 0 || cardIndex >= me.hand.length) return g;
    
    const card = me.hand[cardIndex];
    if (!card) return g;
    
    // 进入目标选择拼点阶段（等待目标选择拼点牌）
    g.pending = {
      type: 'lieRenRespond',
      sourceSeat: mySeat,
      targetSeat: pending.targetSeat,
      sourceCard: card
    };
    g.phase = 'lieRenRespond';
    g.log = pushLog(g.log, `${me.name} 选择了拼点牌,等待 ${target.name} 选择拼点牌`);
    
    return g;
  });
}

// 烈刃目标响应拼点
function respondLieRen(cardIndex) {
  tx(g => {
    const pending = g.pending;
    if (!pending || pending.type !== 'lieRenRespond' || pending.targetSeat !== mySeat) return g;
    
    const source = g.players[pending.sourceSeat];
    const target = g.players[mySeat];
    
    if (!source || !source.alive || !target || !target.alive) return g;
    if (!target.hand || cardIndex < 0 || cardIndex >= target.hand.length) return g;
    
    const targetCard = target.hand[cardIndex];
    if (!targetCard) return g;
    
    const sourceCard = pending.sourceCard;
    
    // 判断拼点结果：点数大的赢
    const sourceRank = sourceCard.rank;
    const targetRank = targetCard.rank;
    const lieRenWin = sourceRank > targetRank;
    
    // 移除双方的拼点牌
    const sourceCardIndex = source.hand.findIndex(c => c === sourceCard);
    if (sourceCardIndex !== -1) {
      source.hand.splice(sourceCardIndex, 1);
    }
    
    const targetCardIndex = target.hand.findIndex(c => c === targetCard);
    if (targetCardIndex !== -1) {
      target.hand.splice(targetCardIndex, 1);
    }
    
    // 将拼点牌置入弃牌堆
    g.discard.push(sourceCard, targetCard);
    
    const pointText = (c) => c.suit + rankText(c.rank);
    g.log = pushLog(g.log, `${source.name} 出 ${pointText(sourceCard)}, ${target.name} 出 ${pointText(targetCard)},拼点${lieRenWin ? source.name + '赢' : source.name + '没赢'}`);
    
    if (lieRenWin) {
      // 祝融赢，从目标处获得一张牌
      const targetCards = [];
      // 收集目标的手牌
      if (target.hand && target.hand.length > 0) {
        targetCards.push(...target.hand);
      }
      // 收集目标的装备牌
      if (target.equips) {
        for (const slot of Object.keys(target.equips)) {
          if (target.equips[slot]) {
            targetCards.push(target.equips[slot]);
          }
        }
      }
      
      if (targetCards.length > 0) {
        // 随机选择一张牌
        const randomIndex = Math.floor(Math.random() * targetCards.length);
        const cardToGain = targetCards[randomIndex];
        
        // 从目标处移除该牌
        let cardFound = false;
        let fromEquip = false; // 是否是从装备区移除的——只有这种情况才触发 onLoseEquip

        // 先尝试从手牌中移除
        if (target.hand) {
          const handIndex = target.hand.findIndex(c => c === cardToGain);
          if (handIndex !== -1) {
            target.hand.splice(handIndex, 1);
            cardFound = true;
          }
        }

        // 再尝试从装备区中移除
        if (!cardFound && target.equips) {
          for (const slot of Object.keys(target.equips)) {
            if (target.equips[slot] === cardToGain) {
              target.equips[slot] = null;
              cardFound = true;
              fromEquip = true;
              break;
            }
          }
        }

        if (cardFound) {
          // 祝融获得该牌
          if (!source.hand) source.hand = [];
          source.hand.push(cardToGain);
          g.log = pushLog(g.log, `${source.name} 【烈刃】拼点赢,获得 ${target.name} 的一张牌【${cardToGain.name}】`);
        }

        // 【失去装备钩子的正确接法,见 CLAUDE.md「凌统旋风」条】烈刃拼点赢拿走目标装备时同样是
        // mid-杀效果(respondShan 不闪分支,finishSingleShaTarget 之前)。fromEquip 为真时才是真的
        // "失去装备区的牌"(拿的若是手牌则不触发)。同 pickQiaomengEquip:先重置 pending/phase 到
        // 'play',让钩子(旋风)捕获正确休止相而不是死相 'lieRenRespond';钩子挂起新 pending 就
        // attach resume={type:'sha'} 并 return;收尾走 finishSingleShaTarget(而不是裸 phase='play'),
        // 顺带修复此前跳过 checkWin/方天画戟队列推进的独立既有 bug。
        if (fromEquip) {
          g.pending = null;
          g.phase = 'play';
          const pendingBefore = g.pending; // = null
          triggerHook(g, mySeat, 'onLoseEquip', {count:1});
          if(g.pending !== pendingBefore && g.pending){ g.pending.resume = {type:'sha'}; return g; } // 旋风等钩子挂起了,保留不覆盖
          finishSingleShaTarget(g);
          return g;
        }
      } else {
        g.log = pushLog(g.log, `${source.name} 【烈刃】拼点赢,但 ${target.name} 没有牌`);
      }
    } else {
      g.log = pushLog(g.log, `${source.name} 【烈刃】拼点没赢`);
    }

    // 清理状态(未走上面 fromEquip 分支的所有其它情况:拼点没赢/拿的是手牌/目标没牌)
    g.pending = null;
    g.phase = 'play';
    finishSingleShaTarget(g); // 同上,顺带修复方天画戟队列推进

    return g;
  });
}

// 取消烈刃
function cancelLieRen() {
  tx(g => {
    if (g.pending && (g.pending.type === 'lieRenChoose' || g.pending.type === 'lieRenPickCard') &&
        g.pending.sourceSeat === mySeat) {
      g.pending = null;
      g.phase = 'play';
      g.log = pushLog(g.log, `${g.players[mySeat].name} 取消发动【烈刃】`);
    }
    return g;
  });
}

// ===== 徐庶【举荐】 =====
function isNonBasicCard(card){
  return !!(card && card.name && !BASIC_CARDS.includes(card.name));
}
function respondJujianPickCard(cardIdx){
  tx(g=>{
    if(g.phase!=='jujianPickCard'||!g.pending||g.pending.type!=='jujianPickCard') return g;
    if(g.pending.sourceSeat!==mySeat) return g;
    const me=g.players[mySeat];
    const card=me.hand[cardIdx];
    if(!isNonBasicCard(card)) return g;
    const candidates=[];
    for(let i=0;i<g.players.length;i++){
      if(i!==mySeat && g.players[i] && g.players[i].alive) candidates.push(i);
    }
    if(!candidates.length) return g;
    g.pending={
      type:'jujianPickTarget',
      sourceSeat:mySeat,
      endingSeat:g.pending.endingSeat,
      cardIdx,
      cardId:card.id,
      candidates
    };
    g.phase='jujianPickTarget';
    return g;
  });
}
function respondJujianPickTarget(targetSeat){
  tx(g=>{
    if(g.phase!=='jujianPickTarget'||!g.pending||g.pending.type!=='jujianPickTarget') return g;
    if(g.pending.sourceSeat!==mySeat) return g;
    if(!(g.pending.candidates||[]).includes(targetSeat)) return g;
    const me=g.players[mySeat];
    const endingSeat=g.pending.endingSeat;
    let idx=g.pending.cardIdx;
    let card=me.hand[idx];
    if(!card || card.id!==g.pending.cardId){
      idx=(me.hand||[]).findIndex(c=>c && c.id===g.pending.cardId);
      if(idx<0){
        g.pending=null;
        finishTurn(g, endingSeat);
        return g;
      }
      card=me.hand[idx];
    }
    if(!isNonBasicCard(card)) return g;
    me.hand.splice(idx,1);
    g.discard.push(card);
    g.pending={
      type:'jujianChooseEffect',
      sourceSeat:mySeat,
      endingSeat,
      targetSeat,
      discardCard:card
    };
    g.phase='jujianChooseEffect';
    g.log=pushLog(g.log, me.name+' 发动【举荐】,弃置【'+card.name+'】,令 '+g.players[targetSeat].name+' 选择一项');
    markSkillSound(g, '举荐');
    return g;
  });
}
function respondJujianEffect(opt){
  tx(g=>{
    if(g.phase!=='jujianChooseEffect'||!g.pending||g.pending.type!=='jujianChooseEffect') return g;
    if(g.pending.targetSeat!==mySeat) return g;
    const src=g.players[g.pending.sourceSeat];
    const tgt=g.players[g.pending.targetSeat];
    const endingSeat=g.pending.endingSeat;
    if(!tgt||!tgt.alive){
      if(src) src.jujianUsed=true;
      g.pending=null;
      finishTurn(g, endingSeat);
      return g;
    }
    if(opt==='draw'){
      drawN(g, g.pending.targetSeat, 2);
      g.log=pushLog(g.log, tgt.name+' 因【举荐】摸2张牌');
    } else if(opt==='recover'){
      if(tgt.hp<tgt.maxHp){
        tgt.hp++;
        g.log=pushLog(g.log, tgt.name+' 因【举荐】回复1点体力');
      } else {
        g.log=pushLog(g.log, tgt.name+' 体力已满,【举荐】回复无效果');
      }
    } else if(opt==='reset'){
      const need=! (tgt.faceup!==false) || !!tgt.chained;
      tgt.faceup=true;
      tgt.chained=false;
      g.log=pushLog(g.log, need ? (tgt.name+' 因【举荐】复原武将牌') : (tgt.name+' 无需复原'));
    } else {
      return g;
    }
    if(src) src.jujianUsed=true;
    g.pending=null;
    finishTurn(g, endingSeat);
    return g;
  });
}
function cancelJujian(){
  tx(g=>{
    if(!g.pending) return g;
    if(g.pending.type==='jujianChooseEffect') return g; // 已弃牌不可取消
    if(g.pending.sourceSeat!==mySeat) return g;
    if(g.pending.type!=='jujianPickCard' && g.pending.type!=='jujianPickTarget') return g;
    const endingSeat=g.pending.endingSeat;
    g.pending=null;
    g.log=pushLog(g.log, g.players[mySeat].name+' 取消【举荐】');
    finishTurn(g, endingSeat);
    return g;
  });
}

// ===== 曹彰【将驰】 =====
function respondJiangchi(optionId){
  tx(g=>{
    if(g.phase!=='jiangchiAsk'||!g.pending||g.pending.type!=='jiangchiAsk') return g;
    if(g.pending.seat!==mySeat) return g;
    const me=g.players[mySeat];
    if(!me||!me.alive||!hasCap(me,'jiangchi')) return g;
    const base=Number.isInteger(g.pending.baseDraw) ? g.pending.baseDraw : drawPhaseCount(g, mySeat);
    g.pending=null;
    if(optionId==='more'){
      me.jiangchiNoSlash=true;
      me.jiangchiNoDistance=false;
      g.jiangchiExtraShaLeft=0;
      g.log=pushLog(g.log, me.name+' 发动【将驰】:多摸1张,本回合不能使用或打出杀');
      markSkillSound(g, '将驰');
      finishDrawPhase(g, mySeat, base+1);
    } else if(optionId==='less'){
      me.jiangchiNoSlash=false;
      me.jiangchiNoDistance=true;
      g.jiangchiExtraShaLeft=1;
      g.log=pushLog(g.log, me.name+' 发动【将驰】:少摸1张,本回合杀无距离限制且可多出1张杀');
      markSkillSound(g, '将驰');
      finishDrawPhase(g, mySeat, Math.max(0, base-1));
    } else {
      me.jiangchiNoSlash=false;
      me.jiangchiNoDistance=false;
      g.jiangchiExtraShaLeft=0;
      g.log=pushLog(g.log, me.name+'：不发动【将驰】');
      finishDrawPhase(g, mySeat, base);
    }
    return g;
  });
}

// ===== 曹植【落英】 =====
function isClubCard(card){
  return !!(card && card.suit==='♣');
}
// fromSeat: 牌的来源角色; cards: 已进入弃牌堆的牌; reason: 'judge'|'discard'
// resume: 结束后接回(如 {type:'delay',seat} 或 {phase:'discard'})
function maybeStartLuoying(g, fromSeat, cards, reason, resume){
  if(reason!=='judge' && reason!=='discard') return false;
  if(!Array.isArray(cards) || !cards.length) return false;
  if(g.pending) return false; // 已有更高优先级挂起则不覆盖
  const clubCards=cards.filter(isClubCard);
  if(!clubCards.length) return false;
  for(let k=0;k<g.players.length;k++){
    const i=(fromSeat+1+k)%g.players.length;
    if(i===fromSeat) continue;
    const p=g.players[i];
    if(!p||!p.alive||!hasCap(p,'luoying')) continue;
    g.pending={
      type:'luoyingAsk',
      seat:i,
      fromSeat,
      reason,
      cardIds:clubCards.map(c=>c.id).filter(id=>id!=null),
      cardsPreview:clubCards.map(c=>({id:c.id,name:c.name,suit:c.suit,rank:c.rank})),
      resume:resume||null
    };
    g.phase='luoyingAsk';
    g.log=pushLog(g.log, p.name+' 是否发动【落英】获得'+clubCards.length+'张梅花牌…');
    return true;
  }
  return false;
}
function respondLuoying(activate){
  tx(g=>{
    if(g.phase!=='luoyingAsk'||!g.pending||g.pending.type!=='luoyingAsk') return g;
    if(g.pending.seat!==mySeat) return g;
    const me=g.players[mySeat];
    const resume=g.pending.resume;
    if(activate && me && me.alive){
      const got=[];
      (g.pending.cardIds||[]).forEach(id=>{
        const idx=(g.discard||[]).findIndex(c=>c && c.id===id);
        if(idx>=0){
          const [card]=g.discard.splice(idx,1);
          got.push(card);
        }
      });
      if(got.length){
        me.hand.push(...got);
        g.log=pushLog(g.log, me.name+' 发动【落英】,获得'+got.length+'张牌');
        markSkillSound(g, '落英');
      } else {
        g.log=pushLog(g.log, me.name+' 发动【落英】,但牌已不在弃牌堆');
      }
    } else {
      g.log=pushLog(g.log, me.name+'：不发动【落英】');
    }
    g.pending=null;
    if(resume && resume.type==='delay' && Number.isInteger(resume.seat)){
      continueDelayResolution(g, resume.seat);
    } else if(resume && resume.phase){
      g.phase=resume.phase;
    } else {
      g.phase='play';
    }
    return g;
  });
}

// ===== 曹植【酒诗②】 =====
function respondJiushiFlip(activate){
  tx(g=>{
    if(g.phase!=='jiushiFlipAsk'||!g.pending||g.pending.type!=='jiushiFlipAsk') return g;
    if(g.pending.seat!==mySeat) return g;
    const me=g.players[mySeat];
    const resume=g.pending.resume;
    if(activate && me && me.alive && g.pending.wasFacedown){
      me.faceup=true;
      g.log=pushLog(g.log, me.name+' 发动【酒诗】,翻回正面');
      markSkillSound(g, '酒诗');
    } else {
      g.log=pushLog(g.log, me.name+'：不发动【酒诗】');
    }
    g.pending=null;
    resumeAfterInterrupt(g, resume||{type:'sha'}, mySeat);
    return g;
  });
}
