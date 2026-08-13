// weapons.js — 武器/防具特效,从 game.js 拆分出来(纯重构第二步,行为零变化)。
// 只包含麒麟弓/寒冰剑/青龙偃月刀/贯石斧这四件武器各自独立的 maybeStart*/respond*/resolve*
// 函数;respondShan/resolveShaUse(NoLiuli)/continueShaAfterTieqi 等共用编排函数(处理毅重/
// 仁王盾/铁骑/烈弓/古锭刀等,不专属于这四件武器)仍留在 game.js,这里按全局作用域直接调用
// 它们(和 game.js 内部互相调用同一套 <script> 全局作用域,不需要 import/require)。
// 古锭刀(gudingdao)没有独立代码可抽——它的全部效果是 respondShan 里的一行内联表达式
// (gudingBonus),继续留在 game.js 的 respondShan 里,不在这个文件。


// 麒麟弓:杀造成伤害且目标存活时,弃目标一匹坐骑。0匹→无效果;1匹→直接弃;2匹→开选马子阶段(攻击者选)。
// 返回 true 表示已开选马子阶段(调用方应提前返回、不做收尾)。仅由「杀造成伤害」处调用(srcType==='sha')。
function maybeStartQilin(g, attackerSeat, victimSeat){
  const attacker=g.players[attackerSeat], victim=g.players[victimSeat];
  if(!attacker || !victim || !victim.alive || !hasCap(attacker,'qilin')) return false;
  const hasP = !!(victim.equips && victim.equips.plus1);
  const hasM = !!(victim.equips && victim.equips.minus1);
  if(!hasP && !hasM) return false;                 // 目标无坐骑:无额外效果
  if(hasP && hasM){                                // 两匹:开子阶段,由攻击者选弃哪匹
    g.pending={type:'qilin', from:attackerSeat, to:victimSeat};
    g.phase='qilin';
    g.log=pushLog(g.log, attacker.name+' 的【麒麟弓】发动,选择弃置 '+victim.name+' 的哪匹坐骑…');
    return true;
  }
  // 一匹:直接弃。discardMount 会触发目标的 onLoseEquip 钩子——若目标是凌统、旋风在杀结算中途
  // 挂起了 xuanfengPick pending,必须把它上报给调用方(respondShan)让它 return、别再往下跑
  // g.pending=null;finishSingleShaTarget 把旋风覆盖掉;同时给这个 pending 挂上 resume={type:'sha'},
  // 旋风结束后由 executeXuanfeng/cancelXuanfeng 走 resumeAfterInterrupt 接回杀收尾(方天队列/play)。
  // 写法完全照抄 consumePendingHookQueue 的 pendingBefore 快照约定,零新模式。
  const pendingBefore = g.pending;
  discardMount(g, victimSeat, hasP?'plus1':'minus1', attacker.name);
  if(g.pending !== pendingBefore && g.pending){ g.pending.resume = {type:'sha'}; return true; }
  return false;
}
// 弃置某玩家一匹坐骑进弃牌堆 + 触发失去装备钩子(枭姬等)。坐骑公开,日志写牌名。
function discardMount(g, seat, slot, attackerName){
  const p=g.players[seat], card=p.equips[slot]; if(!card) return;
  p.equips[slot]=null; g.discard.push(card);
  markDiscardReveal(g, seat, [card]);
  g.log=pushLog(g.log, (attackerName?attackerName+' 的':'')+'【麒麟弓】弃置了 '+p.name+' 的坐骑【'+card.name+'】');
  triggerHook(g, seat, 'onLoseEquip', { count:1 });
}
// qilinResolve: 麒麟弓选马子阶段结算。仅攻击者(pending.from)可操作;slot='plus1'|'minus1';失效项安全回 play 防软锁。
function qilinResolve(slot){
  tx(g=>{
    if(g.phase!=='qilin'||!g.pending||g.pending.type!=='qilin'||g.pending.from!==mySeat) return g;
    const victimSeat=g.pending.to, victim=g.players[victimSeat], attacker=g.players[g.pending.from];
    if(!victim || !victim.alive || (slot!=='plus1'&&slot!=='minus1') || !victim.equips[slot]){
      g.pending=null; g.phase='play'; return g; // 失效兜底
    }
    // 双马选一同 maybeStartQilin 单马:discardMount 触发目标 onLoseEquip,旋风挂起就 attach
    // resume={type:'sha'} 并保留(return),不再覆盖成 play。
    const pendingBefore = g.pending;
    discardMount(g, victimSeat, slot, attacker?attacker.name:'');
    if(g.pending !== pendingBefore && g.pending){ g.pending.resume = {type:'sha'}; return g; }
    g.pending=null; g.phase='play';
    return g;
  });
}

// ===== 寒冰剑:杀命中造成伤害之前,攻击者可选择防止伤害、改为弃置目标两张牌 =====
// hanbingDiscardCount: 目标手牌+装备区加起来还有几张牌可弃(0~n)。respondShan 里用来判断
// "目标完全没有牌可弃"这种不能发动的边界,不能弹出一个没什么可弃的空询问。
function hanbingDiscardCount(p){ return (p.hand||[]).length + EQUIP_SLOTS.filter(s=>p.equips&&p.equips[s]).length; }
// respondHanbingAsk: 仅 pending.from(装备寒冰剑的攻击者)可响应。不发动:补上正常伤害流程
// (和 respondShan 的"不闪"分支完全一致的一套收尾,只是挪到这个新函数里,因为已经隔了一次
// 网络往返,不能再指望原来那个 tx 调用里的共用尾巴)。发动:不造成任何伤害,直接进入弃牌
// 循环(startHanbingRound,round 从 0 开始)。
function respondHanbingAsk(activate){
  tx(g=>{
    if(g.phase!=='hanbingAsk'||!g.pending||g.pending.type!=='hanbingAsk'||g.pending.from!==mySeat) return g;
    const from=mySeat, to=g.pending.to;
    if(!activate){
      g.log=pushLog(g.log, g.players[from].name+'：不发动【寒冰剑】');
      const sourceCard=g.pending.sourceCard;
      g.pending=null;
      const dying = dealDamage(g, to, damageAmount(g, from, 1, 'sha'), from, '不闪', 'sha', sourceCard);
      if(dying) return g;
      if(maybeStartQilin(g, from, to)) return g;
      if(checkWin(g)) return g;
      g.phase='play';
      return g;
    }
    g.log=pushLog(g.log, g.players[from].name+' 发动【寒冰剑】,防止伤害,改为弃置 '+g.players[to].name+' 的牌');
    g.pending=null;
    startHanbingRound(g, from, to, 0);
    return g;
  });
}
// startHanbingRound: (重新)计算目标这一刻还有什么可弃——0个直接收尾(不管是第一轮就没有,
// 还是弃完第一张后目标没牌了);1个免弹窗自动弃这一个(和 pick 阶段"唯一选择直接结算"
// 同一个惯例),弃完继续问下一轮;2个以上才真正开 pending 问攻击者选。round 到 2 就收尾——
// "对方2张以上必须弃满两轮,不足两张弃光为止",不存在"弃1张就不弃了"这个中途停下的选项。
function startHanbingRound(g, from, to, round){
  const tgt=g.players[to];
  if(!tgt || !tgt.alive || round>=2){ finishHanbing(g); return; }
  const handCount=(tgt.hand||[]).length;
  const equipSlots=EQUIP_SLOTS.filter(s=>tgt.equips[s]);
  const optCount=(handCount>0?1:0)+equipSlots.length;
  if(optCount===0){ finishHanbing(g); return; }
  if(optCount===1){
    const info={trick:'寒冰剑', from, to};
    const pendingBefore=g.pending;
    if(handCount>0) applyTrickOnHand(g, info); else applyTrickOnEquip(g, info, equipSlots[0]);
    if(g.pending!==pendingBefore && g.pending){
      g.pending.resume={type:'hanbing',from,to,round:round+1};
      return;
    }
    startHanbingRound(g, from, to, round+1);
    return;
  }
  g.pending={type:'hanbing', from, to, round};
  g.phase='hanbing';
  g.log=pushLog(g.log, '等待 '+g.players[from].name+' 选择弃置 '+tgt.name+' 的第'+(round+1)+'张牌…');
}
function finishHanbing(g){
  g.pending=null;
  if(checkWin(g)) return;
  g.phase='play';
}
// hanbingPick: 弃牌子阶段结算。choice='hand' 或槽名,复用 applyTrickOnHand/applyTrickOnEquip
// (info.trick='寒冰剑' 不等于'顺手牵羊',天然落到"弃入弃牌堆"分支,这两个函数不用改一行)。
// 仅使用者(pending.from)可操作;失效项(手牌已空/槽已空)安全收尾防软锁。弃完这一张后继续
// 调用 startHanbingRound 进入下一轮(可能自动弃/可能再问/可能直接收尾)。
function hanbingPick(choice){
  tx(g=>{
    if(g.phase!=='hanbing'||!g.pending||g.pending.type!=='hanbing'||g.pending.from!==mySeat) return g;
    const {from,to,round}=g.pending;
    const tgt=g.players[to];
    if(!tgt || !tgt.alive){ finishHanbing(g); return g; }
    const info={trick:'寒冰剑', from, to};
    const pendingBefore=g.pending;
    if(choice==='hand'){
      if((tgt.hand||[]).length===0){ finishHanbing(g); return g; } // 失效兜底
      applyTrickOnHand(g, info);
    } else {
      if(!EQUIP_SLOTS.includes(choice) || !tgt.equips[choice]){ finishHanbing(g); return g; } // 失效兜底
      applyTrickOnEquip(g, info, choice);
    }
    if(g.pending!==pendingBefore && g.pending){
      g.pending.resume={type:'hanbing',from,to,round:round+1};
      return g;
    }
    startHanbingRound(g, from, to, round+1);
    return g;
  });
}

// respondQinglong: 仅攻击者(pending.from,也就是青龙偃月刀的装备者)可响应。不发动:直接走
// 和 respondShan 共用尾巴一致的收尾(清 pending、判胜负、回到出牌阶段)。发动:选一张能当杀
// 的手牌(目标固定是原目标 pending.to,不需要重新选目标),整张走 resolveShaUse 完整流程——
// 不占用 g.shaUsed(不计入出杀次数限制)、不做距离校验(官方原文明确无距离限制)。
function respondQinglong(activate, cardIdx){
  tx(g=>{
    if(g.phase!=='qinglong'||!g.pending||g.pending.type!=='qinglong'||g.pending.from!==mySeat) return g;
    const me=g.players[mySeat]; // 攻击者本人(装备者)
    const from=mySeat;
    const targetSeat=g.pending.to;
    if(!activate){
      g.log=pushLog(g.log, me.name+'：不发动【青龙偃月刀】');
      const sourceCard = g.pending.sourceCard;
      g.pending = null;
      // 存储剩余可用效果，回到调度
      // 内联mengjinDiscardCount逻辑以避免跨文件依赖
      const mengjinDiscardCount = p => (p.hand||[]).length + EQUIP_SLOTS.filter(s=>p.equips&&p.equips[s]).length;
      const remainingAvailable = ['mengjin', 'guanshifu'].filter(id => {
        if(id === 'mengjin') {
          const attacker = g.players[from];
          const target = g.players[targetSeat];
          return attacker && attacker.alive && target && target.alive && 
                 hasCap(attacker, 'mengjin') && mengjinDiscardCount(target) > 0;
        }
        if(id === 'guanshifu') return canStartGuanshifu(g, from);
        return false;
      });
      if(remainingAvailable.length > 0) {
        continueShaOffsetEffects(g, from, targetSeat, sourceCard, remainingAvailable);
      } else {
        finishSingleShaTarget(g);
      }
      return g;
    }
    // 曹彰【将驰】选项1:本回合不能使用杀
    if(me.jiangchiNoSlash) return g;
    const card=me.hand[cardIdx];
    if(!card || !canUseAs(me,card,'杀')) return g; // 没这张牌/不能当杀:状态不变(双重保险)
    removeHandCards(g, mySeat, cardIdx); g.discard.push(card);
    // 青龙追杀发生在前一张杀被闪抵消后的武器响应时机，不占出牌阶段的普通杀次数，
    // 也不消耗【将驰】提供的额外次数；但它仍是“使用杀”，会正常破坏克己等使用牌记录。
    const usedAs = isShaName(card.name) ? '出【'+card.name+'】' : '出【'+card.name+'】当【杀】';
    g.log=pushLog(g.log, me.name+' 发动【青龙偃月刀】,'+usedAs);
    markCardSound(g, '杀', mySeat, card, targetSeat);
    g.pending=null;
    resolveShaUse(g, me, targetSeat, usedAs, singleCardShaColor(card), card, undefined);
    return g;
  });
}
// ===== 贯石斧:杀被闪抵消后,攻击者可弃自己2张牌(手牌/装备混合)令这张杀依然造成伤害 =====
// guanshifuOptionCount: 攻击者自己还有多少张牌可弃(手牌张数 + 非空装备槽数,装备槽排除武器槽本身——
// 官方FAQ"可以弃装备区里的牌,除了贯石斧本身",武器槽此刻就是贯石斧,天然要排除)。
function guanshifuOptionCount(p){
  const equipCount = EQUIP_SLOTS.filter(s=> s!=='weapon' && p.equips && p.equips[s]).length;
  return (p.hand||[]).length + equipCount;
}
// maybeStartGuanshifu: 攻击者(fromSeat)是否要被问"是否发动贯石斧"。共用出口——不只是
// respondShan 里目标打出实体闪这一条路径会触发"杀被闪抵消",八卦阵判红(视为出闪)是在
// continueShaAfterTieqi/finishGuicai 里更早发生的、respondShan 根本不会被调用的另一条路径,
// 两条路径都要给贯石斧同样的触发机会,所以抽成共用函数,三处调用点各自决定收尾方式。
// 返回 true 表示已开 pending,调用方应立即 return、不做后续收尾。
// maybeStartQinglong: 攻击者(fromSeat)是否要被问"是否发动青龙偃月刀,再次使用一张杀"。
// 从 respondShan 内联判断抽出来的共用出口——和贯石斧同一个原因:八卦阵判红(视为出闪)是
// 在 continueShaAfterTieqi/finishGuicai 里更早发生的、respondShan 根本不会被调用的另一条
// 路径,原来只在 respondShan 里判断,导致"杀被八卦阵判红抵消"这个场景青龙偃月刀完全没有
// 触发机会——这是排查贯石斧同类问题时顺带发现的遗留 bug(青龙偃月刀比贯石斧更早实现,当时
// 没有意识到八卦阵判红会绕开 respondShan),这次一并修复,接入贯石斧同样的三处调用点。
// 返回 true 表示已开 pending,调用方应立即 return、不做后续收尾。
function canStartQinglong(g, fromSeat){
  const attacker=g.players[fromSeat];
  return !!(attacker && attacker.alive && hasCap(attacker,'qinglong') && (attacker.hand||[]).some(c=>canUseAs(attacker,c,'杀')));
}
function maybeStartQinglong(g, fromSeat, toSeat, sourceCard){
  const attacker=g.players[fromSeat];
  if(!canStartQinglong(g, fromSeat)) return false;
  g.pending={type:'qinglong', from:fromSeat, to:toSeat};
  if(sourceCard!==undefined) g.pending.sourceCard=sourceCard;
  g.phase='qinglong';
  g.log=pushLog(g.log, attacker.name+' 是否发动【青龙偃月刀】,再次使用【杀】…');
  return true;
}
function canStartGuanshifu(g, fromSeat){
  const attacker=g.players[fromSeat];
  return !!(attacker && attacker.alive && hasCap(attacker,'guanshifu') && guanshifuOptionCount(attacker)>=2);
}
function maybeStartGuanshifu(g, fromSeat, toSeat, sourceCard){
  const attacker=g.players[fromSeat];
  if(!canStartGuanshifu(g, fromSeat)) return false;
  g.pending={type:'guanshi', from:fromSeat, to:toSeat};
  if(sourceCard!==undefined) g.pending.sourceCard=sourceCard;
  g.phase='guanshi';
  g.log=pushLog(g.log, attacker.name+' 是否发动【贯石斧】,弃两张牌令此【杀】依然造成伤害…');
  return true;
}
// respondGuanshi: 仅攻击者(pending.from)可响应。picks 为 null/不足2项=不发动,直接走"杀被抵消"
// 的原有收尾;恰好2项(每项 'hand:idx' 或 'equip:slot',不含 'equip:weapon')=同时弃掉这2张,
// 不重新走 resolveShaUse(不会再触发闪/判定/其它武器特效),直接 dealDamage 一次让这张杀命中。
function respondGuanshi(picks){
  tx(g=>{
    if(g.phase!=='guanshi'||!g.pending||g.pending.type!=='guanshi'||g.pending.from!==mySeat) return g;
    const from=mySeat, to=g.pending.to;
    const me=g.players[from]; // 攻击者本人(装备者)
    if(!Array.isArray(picks) || picks.length!==2){
      g.log=pushLog(g.log, me.name+'：不发动【贯石斧】');
      const sourceCard = g.pending.sourceCard;
      g.pending = null;
      // 存储剩余可用效果，回到调度
      // 内联mengjinDiscardCount逻辑以避免跨文件依赖
      const mengjinDiscardCount = p => (p.hand||[]).length + EQUIP_SLOTS.filter(s=>p.equips&&p.equips[s]).length;
      const remainingAvailable = ['mengjin', 'qinglong'].filter(id => {
        if(id === 'mengjin') {
          const attacker = g.players[from];
          const target = g.players[to];
          return attacker && attacker.alive && target && target.alive && 
                 hasCap(attacker, 'mengjin') && mengjinDiscardCount(target) > 0;
        }
        if(id === 'qinglong') return canStartQinglong(g, from);
        return false;
      });
      if(remainingAvailable.length > 0) {
        continueShaOffsetEffects(g, from, to, sourceCard, remainingAvailable);
      } else {
        finishSingleShaTarget(g);
      }
      return g;
    }
    // 校验:两项不重复、都合法(手牌下标存在 / 装备槽非空且不是武器槽本身)
    const seen=new Set();
    for(const p of picks){
      if(seen.has(p)) return g;
      seen.add(p);
      if(p.startsWith('hand:')){
        const idx=Number(p.slice(5));
        if(!Number.isInteger(idx) || !me.hand[idx]) return g;
      } else if(p.startsWith('equip:')){
        const slot=p.slice(6);
        if(slot==='weapon' || !EQUIP_SLOTS.includes(slot) || !me.equips[slot]) return g;
      } else return g;
    }
    // sourceCard 必须在弃装备触发 onLoseEquip 钩子之前先取出——钩子(如旋风)可能把 g.pending
    // 整个换成别的对象,晚取就读不到了。
    const sourceCard=g.pending.sourceCard;
    // 【失去装备钩子的正确接法,见 CLAUDE.md「凌统旋风」条+散谣 finishSanyaoDamage 同一范式】
    // 先把休止相设成 play(贯石斧已经结算完毕、攻击者的出牌阶段继续),再触发 onLoseEquip,
    // 这样旋风钩子捕获的 previousPhase 才是 play(而不是此刻已经死掉的 guanshi)。
    g.phase='play';
    // pendingBefore 快照:弃装备(下面循环里可能命中多次 equip:,每次都会重新触发钩子,但只需要
    // 快照一次——只要循环结束后 g.pending 变成了别的对象,就说明期间某次触发挂起了新 pending)。
    const pendingBefore=g.pending;
    // 弃牌:先处理装备(不受手牌下标变动影响),再处理手牌(大下标先弹,避免 splice 错位)
    const handIdxs=[];
    for(const p of picks){
      if(p.startsWith('equip:')){
        const slot=p.slice(6);
        const card=me.equips[slot]; me.equips[slot]=null; g.discard.push(card);
        markDiscardReveal(g, from, [card]);
        g.log=pushLog(g.log, me.name+' 弃置装备【'+card.name+'】(贯石斧)');
        triggerHook(g, from, 'onLoseEquip', {count:1});
      } else {
        handIdxs.push(Number(p.slice(5)));
      }
    }
    const discardedHands=removeHandCards(g, from, handIdxs);
    g.discard.push(...discardedHands);
    markDiscardReveal(g, from, discardedHands);
    if(handIdxs.length) g.log=pushLog(g.log, me.name+' 弃置'+handIdxs.length+'张手牌(贯石斧)');
    g.log=pushLog(g.log, me.name+' 发动【贯石斧】,此【杀】依然对 '+g.players[to].name+' 造成伤害');
    // 两张弃牌(成本)已经全部真实结算完毕。若其中弃自己装备那一步触发了 onLoseEquip 钩子并
    // 挂起了新 pending(如旋风),不能再无条件 g.pending=null 把它覆盖掉——记下 resume 续接
    // 信息、这次 tx 到此为止,强制命中的伤害延后到旋风问完之后才真正结算(见 finishGuanshiDamage)。
    if(g.pending !== pendingBefore && g.pending){
      g.pending.resume = { type:'guanshiDamage', from, to, sourceCard };
      return g;
    }
    g.pending=null;
    finishGuanshiDamage(g, from, to, sourceCard);
    return g;
  });
}
// finishGuanshiDamage: 贯石斧强制命中的伤害结算 + 收尾,从 respondGuanshi 抽出的共用尾巴。
// 两处调用:①respondGuanshi 弃牌未触发钩子打断的直达路径;②resumeAfterInterrupt 的
// 'guanshiDamage' 分支(弃自己装备触发 onLoseEquip 挂起了新 pending,比如旋风,问完之后
// 接回来继续造成这次被强制命中的伤害)——和散谣 finishSanyaoDamage 同一范式。
function finishGuanshiDamage(g, from, to, sourceCard){
  const dying = dealDamage(g, to, damageAmount(g, from, 1, 'sha'), from, '贯石斧强制命中', 'sha', sourceCard);
  if(dying) return; // 濒死流程接管
  finishSingleShaTarget(g);
}

// ===== 雌雄双股剑:杀指定异性目标后,攻击者可选令目标弃1手牌或己摸1 =====
// 挂点在 afterShaTargetSkills(铁骑/烈弓之后、仁王/毅重之前)。单目标特效。
// 透传 noShan/shaColor/sourceCard/shaInfo 供结束后继续杀结算。
function maybeStartCixiong(g, from, to, noShan, sourceCard, shaColor, shaInfo){
  const attacker = g.players[from], target = g.players[to];
  if(!attacker || !target || !target.alive || from===to) return false;
  if(!hasCap(attacker, 'cixiong')) return false;
  if(typeof isOppositeGender==='function'){
    if(!isOppositeGender(attacker, target)) return false;
  } else if(generalGender(attacker)===generalGender(target)) return false;
  g.pending = { type:'cixiongAsk', from, to, noShan:!!noShan, shaColor };
  if(sourceCard!==undefined) g.pending.sourceCard = sourceCard;
  if(shaInfo && shaInfo.jiuBonus) g.pending.jiuBonus = true;
  g.phase = 'cixiongAsk';
  g.log = pushLog(g.log, attacker.name+' 是否发动【雌雄双股剑】…');
  return true;
}

function continueAfterCixiong(g){
  const d = g.pending;
  if(!d || (d.type!=='cixiongAsk' && d.type!=='cixiongChoice')){
    finishSingleShaTarget(g);
    return;
  }
  const from=d.from, to=d.to, noShan=d.noShan, shaColor=d.shaColor;
  const sourceCard=d.sourceCard;
  const shaInfo = d.jiuBonus ? {jiuBonus:true} : undefined;
  g.pending = null;
  // 仁王/毅重 + 后续:走 afterShaTargetSkills 后半——但 afterSha 会再 maybeStartCixiong。
  // 这里直接做仁王判断 + continueShaAfterTieqi,避免重入雌雄。
  const me=g.players[from], target=g.players[to];
  if(!me || !target || !target.alive){ finishSingleShaTarget(g); return; }
  const ignoresArmor=hasCap(me,'ignoreArmor');
  if(shaColor==='black' && ((hasCap(target,'yizhong') && !(target.equips && target.equips.armor)) || (!ignoresArmor && hasCap(target,'renwang')))){
    const reason = hasCap(target,'renwang') ? '【仁王盾】' : '【毅重】';
    g.log=logEvent(g.log, { kind:'sha', actor:from, targets:[to], text: me.name+' 对 '+target.name+' 使用的黑色【杀】因'+reason+'无效' });
    finishSingleShaTarget(g);
    return;
  }
  continueShaAfterTieqi(g, from, to, noShan, sourceCard, shaColor, shaInfo);
}

// respondCixiongAsk: 仅攻击者。不发动→继续杀;发动→无手牌则己摸1,有手牌则问目标。
function respondCixiongAsk(activate){
  tx(g=>{
    if(g.phase!=='cixiongAsk'||!g.pending||g.pending.type!=='cixiongAsk'||g.pending.from!==mySeat) return g;
    const from=g.pending.from, to=g.pending.to;
    const attacker=g.players[from], target=g.players[to];
    if(!activate){
      g.log=pushLog(g.log, attacker.name+'：不发动【雌雄双股剑】');
      continueAfterCixiong(g);
      return g;
    }
    g.log=pushLog(g.log, attacker.name+' 发动【雌雄双股剑】');
    markCardSound(g, '雌雄双股剑', from, (attacker.equips&&attacker.equips.weapon)||null);
    const handLen = (target.hand||[]).length;
    if(handLen===0){
      drawN(g, from, 1);
      g.log=pushLog(g.log, target.name+' 没有手牌，'+attacker.name+' 摸一张牌');
      continueAfterCixiong(g);
      return g;
    }
    g.pending.type = 'cixiongChoice';
    g.phase = 'cixiongChoice';
    g.log=pushLog(g.log, '等待 '+target.name+' 选择：弃一张手牌 或 令 '+attacker.name+' 摸一张牌…');
    return g;
  });
}

// respondCixiongChoice: 仅目标。choice='discard'|'draw'; discard 须带合法手牌下标。
function respondCixiongChoice(choice, cardIdx){
  tx(g=>{
    if(g.phase!=='cixiongChoice'||!g.pending||g.pending.type!=='cixiongChoice'||g.pending.to!==mySeat) return g;
    const from=g.pending.from, to=g.pending.to;
    const attacker=g.players[from], target=g.players[to];
    if(choice==='draw'){
      drawN(g, from, 1);
      g.log=pushLog(g.log, target.name+' 令 '+attacker.name+' 摸一张牌（雌雄双股剑）');
      continueAfterCixiong(g);
      return g;
    }
    if(choice==='discard'){
      const card = (typeof cardIdx==='number') ? (target.hand||[])[cardIdx] : null;
      if(!card) return g;
      g.discard.push(removeHandCards(g, to, cardIdx)[0]);
      markDiscardReveal(g, to, [card]);
      g.log=pushLog(g.log, target.name+' 弃置手牌【'+card.name+'】（雌雄双股剑）');
      continueAfterCixiong(g);
      return g;
    }
    return g;
  });
}
