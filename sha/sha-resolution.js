// 【杀】目标、响应与武器后续结算。纯函数搬移，加载于 game.js 之后。

function maybeStartShaOffsetEffects(g, from, to, sourceCard){
  const available = [];
  const attacker = g.players[from];
  const target = g.players[to];
  
  // 检查猛进
  if(attacker && attacker.alive && target && target.alive && hasCap(attacker, 'mengjin') && mengjinDiscardCount(target) > 0){
    available.push('mengjin');
  }
  
  // 检查青龙偃月刀
  if(canStartQinglong(g, from)){
    available.push('qinglong');
  }
  
  // 检查贯石斧
  if(canStartGuanshifu(g, from)){
    available.push('guanshifu');
  }
  
  if(available.length === 0) return false;
  if(available.length === 1) {
    startShaOffsetEffect(g, from, to, available[0], sourceCard);
    return true;
  }
  
  // 多个效果,需要选择
  g.pending = {
    type: 'shaOffsetChoice',
    from: from,
    to: to,
    available: available
  };
  if(sourceCard !== undefined) g.pending.sourceCard = sourceCard;
  g.phase = 'shaOffsetChoice';
  return true;
}

function startShaOffsetEffect(g, from, to, effectId, sourceCard) {
  const attacker = g.players[from];
  const target = g.players[to];
  
  if(effectId === 'mengjin') {
    // 启动猛进 - 直接内联实现,避免跨文件依赖
    if(!attacker || !attacker.alive || !target || !target.alive) {
      g.pending = null;
      finishSingleShaTarget(g);
      return;
    }
    
    const discardCount = mengjinDiscardCount(target);
    if(discardCount === 0) {
      g.log = pushLog(g.log, attacker.name+' 发动【猛进】,但 '+target.name+' 没有可弃置的牌');
      g.pending = null;
      finishSingleShaTarget(g);
      return;
    }
    
    // 如果只有一个可弃选项,自动弃置
    const handCount = (target.hand||[]).length;
    const equipSlots = EQUIP_SLOTS.filter(s=>target.equips[s]);
    const optCount = (handCount>0?1:0) + equipSlots.length;
    
    if(optCount === 1) {
      // 唯一选项:自动弃置
      const info = {trick:'猛进', from, to};
      // 猛进弃的若是凌统的装备,applyTrickOnEquip 会触发其 onLoseEquip → 旋风在杀结算中途挂起。
      // 快照 pending,弃置后若挂起了新 pending 就 attach resume 并 return——旋风结束后走
      // resumeAfterInterrupt 接回杀收尾,不能继续往下跑 remainingAvailable/finishSingleShaTarget
      // 把旋风覆盖掉。(applyTrickOnHand 弃手牌不触发 onLoseEquip,快照对它天然是"无变化"。)
      // 【v2】resume 类型从 {type:'sha'} 改成 {type:'shaOffset',from,to,sourceCard}——旋风挂起
      // 这一刻还不知道(也不需要知道)此刻是否还有青龙偃月刀/贯石斧可续,统一 attach 这个类型,
      // 交给 resumeAfterInterrupt 的 shaOffset 分支重新调 continueShaOffsetEffects 判断:
      // 有就续(修复 v1 会跳过庞德青龙"再来一杀"的已知限制),没有就自动等价于原来 {type:'sha'}
      // 的收尾(finishSingleShaTarget)。不在这里判断"有没有青龙",避免注入点和
      // continueShaOffsetEffects 各自维护一份判断条件、日后走样。
      const pendingBefore = g.pending;
      if(handCount > 0) {
        applyTrickOnHand(g, info);
      } else if(equipSlots.length > 0) {
        applyTrickOnEquip(g, info, equipSlots[0]);
      }

      g.log = pushLog(g.log, attacker.name+' 发动【猛进】,弃置了 '+target.name+' 一张牌');
      markSkillSound(g, '猛进');

      if(g.pending !== pendingBefore && g.pending){ g.pending.resume = {type:'shaOffset', from, to, sourceCard}; return; } // 旋风挂起,保留
      // 处理完猛进后,检查是否还有其他效果需要处理
      const remainingAvailable = ['qinglong', 'guanshifu'].filter(id => {
        if(id === 'qinglong') return canStartQinglong(g, from);
        if(id === 'guanshifu') return canStartGuanshifu(g, from);
        return false;
      });

      if(remainingAvailable.length > 0) {
        continueShaOffsetEffects(g, from, to, sourceCard, remainingAvailable);
      } else {
        g.pending = null;
        finishSingleShaTarget(g);
      }
      return;
    }
    
    // 多个选项:开 pending 让攻击者选择
    g.pending = {
      type: 'mengjin',
      from: from,
      to: to,
      available: []
    };
    if(handCount > 0) {
      g.pending.available.push('hand');
    }
    equipSlots.forEach(slot => {
      g.pending.available.push(slot);
    });
    if(sourceCard !== undefined) g.pending.sourceCard = sourceCard;
    g.phase = 'mengjin';
    g.log = pushLog(g.log, attacker.name+' 发动【猛进】,选择弃置 '+target.name+' 的一张牌…');
  } else if(effectId === 'qinglong') {
    // 重新启动青龙
    maybeStartQinglong(g, from, to, sourceCard);
  } else if(effectId === 'guanshifu') {
    // 重新启动贯石斧
    maybeStartGuanshifu(g, from, to, sourceCard);
  }
}

function continueShaOffsetEffects(g, from, to, sourceCard, remainingAvailable) {
  const attacker = g.players[from];
  const target = g.players[to];
  
  // 过滤掉不再合法的效果
  const validAvailable = remainingAvailable.filter(id => {
    if(id === 'mengjin') {
      return attacker && attacker.alive && target && target.alive && 
             hasCap(attacker, 'mengjin') && mengjinDiscardCount(target) > 0;
    } else if(id === 'qinglong') {
      return canStartQinglong(g, from);
    } else if(id === 'guanshifu') {
      return canStartGuanshifu(g, from);
    }
    return false;
  });
  
  if(validAvailable.length === 0) {
    g.pending = null;
    finishSingleShaTarget(g);
    return true;
  }
  
  if(validAvailable.length === 1) {
    startShaOffsetEffect(g, from, to, validAvailable[0], sourceCard);
    return true;
  }
  
  // 仍然有多个可用效果
  g.pending = {
    type: 'shaOffsetChoice',
    from: from,
    to: to,
    available: validAvailable
  };
  if(sourceCard !== undefined) g.pending.sourceCard = sourceCard;
  g.phase = 'shaOffsetChoice';
  return true;
}

function respondShaOffsetChoice(effectId) {
  tx(g=>{
    if(g.phase!=='shaOffsetChoice'||!g.pending||g.pending.type!=='shaOffsetChoice'||g.pending.from!==mySeat) return g;
    const {from, to, available, sourceCard} = g.pending;
    if(!effectId){
      g.pending = null;
      finishSingleShaTarget(g);
      return g;
    }
    if(!Array.isArray(available) || !available.includes(effectId)) return g;
    g.pending = null;
    startShaOffsetEffect(g, from, to, effectId, sourceCard);
    return g;
  });
}

function consumeJiuShaBonus(g, player){
  if(!player || !player.jiuShaBonus) return undefined;
  player.jiuShaBonus=false;
  return { jiuBonus:true };
}

function canReachSha(g, fromSeat, targetSeat){
  return distance(g, fromSeat, targetSeat) <= attackRange(g, fromSeat);
}

function resolveShaUse(g, me, targetSeat, usedAs, shaColor, sourceCard, shaInfo){
  const fromSeat=g.players.indexOf(me);
  if(maybeStartLiuli(g, fromSeat, targetSeat, usedAs, shaColor, sourceCard)) return;
  resolveShaUseNoLiuli(g, me, targetSeat, usedAs, shaColor, sourceCard, shaInfo);
}

function resolveShaUseNoLiuli(g, me, targetSeat, usedAs, shaColor, sourceCard, shaInfo){
  const fromSeat=g.players.indexOf(me);
  const target=g.players[targetSeat];
  if(hasSkillName(me,'马术') && distanceWithoutCharacterModifiers(g,fromSeat,targetSeat)>attackRange(g,fromSeat)) markSkillSound(g,'马术');
  if(hasSkillName(me,'义从') && me.hp>2 && distanceWithoutCharacterModifiers(g,fromSeat,targetSeat)>attackRange(g,fromSeat)) markSkillSound(g,'义从');
  
  // 处理神速的杀的特殊标记
  const isShensuSha = shaInfo && shaInfo.fromShensu;
  const skipShaLimit = shaInfo && shaInfo.skipShaLimit;
  const noDistance = shaInfo && shaInfo.noDistance;
  
  // 检查距离限制：如果是无距离限制的杀，跳过距离检查
  if(!noDistance && !canReachSha(g, fromSeat, targetSeat)){
    g.log=pushLog(g.log, me.name + ' 对 ' + target.name + ' 的攻击距离不足');
    finishSingleShaTarget(g);
    return;
  }
  
  // 杀链顺序(雌雄双股剑规格):流离后 → 铁骑/烈弓 → 雌雄 → 仁王/毅重 → 八卦/闪。
  // 仁王/毅重无效已挪到 afterShaTargetSkills(雌雄之后),以便 FAQ「可先发动雌雄再因盾无效」。
  g.log=logEvent(g.log, { kind:'sha', actor:fromSeat, targets:[targetSeat], text: me.name+' 对 '+target.name+' '+usedAs });
  if(hasCap(me,'tieqi')){
    g.pending=setResponseAskedAt({type:'tieqi', from:fromSeat, to:targetSeat, shaColor});
    if(sourceCard!==undefined) g.pending.sourceCard=sourceCard;
    if(shaInfo && shaInfo.jiuBonus) g.pending.jiuBonus=true;
    g.phase='tieqi';
    g.log=pushLog(g.log, '是否发动【铁骑】进行判定…');
    return;
  }
  // 黄忠【烈弓】:数值条件同步比较,不需要判定,满足条件时可选发动(不是自动生效)。
  if(hasCap(me,'liegong')){
    const targetHandCount=(g.players[targetSeat].hand||[]).length;
    if(targetHandCount>=me.hp || targetHandCount<=attackRange(g,fromSeat)){
      g.pending=setResponseAskedAt({type:'liegong', from:fromSeat, to:targetSeat, shaColor});
      if(sourceCard!==undefined) g.pending.sourceCard=sourceCard;
      if(shaInfo && shaInfo.jiuBonus) g.pending.jiuBonus=true;
      g.phase='liegong';
      g.log=pushLog(g.log, '是否发动【烈弓】,令此【杀】不可被【闪】抵消…');
      return;
    }
  }
  afterShaTargetSkills(g, fromSeat, targetSeat, false, sourceCard, shaColor, shaInfo);
}

function afterShaTargetSkills(g, from, to, noShan, sourceCard, shaColor, shaInfo){
  if(typeof maybeStartCixiong==='function' && maybeStartCixiong(g, from, to, noShan, sourceCard, shaColor, shaInfo)) return;
  const me=g.players[from], target=g.players[to];
  if(!me || !target || !target.alive){ finishSingleShaTarget(g); return; }
  // 青釭剑无视目标防具，因此仁王盾不能让黑色杀无效；毅重是武将技，不属于防具，
  // 即使攻击者装备青釭剑仍照常生效。
  const ignoresArmor=hasCap(me,'ignoreArmor');
  if(shaColor==='black' && ((hasCap(target,'yizhong') && !(target.equips && target.equips.armor)) || (!ignoresArmor && hasCap(target,'renwang')))){
    const reason = hasCap(target,'renwang') ? '【仁王盾】' : '【毅重】';
    if(reason==='【毅重】') markSkillSound(g,'毅重');
    g.log=logEvent(g.log, { kind:'sha', actor:from, targets:[to], text: me.name+' 对 '+target.name+' 使用的黑色【杀】因'+reason+'无效' });
    finishSingleShaTarget(g);
    return;
  }
  continueShaAfterTieqi(g, from, to, noShan, sourceCard, shaColor, shaInfo);
}

function respondJiedao(useSha, cardIdx){
  tx(g=>{
    if(g.phase!=='jiedaoChoice'||!g.pending||g.pending.type!=='jiedaoChoice'||g.pending.seatA!==mySeat) return g;
    const seatB=g.pending.seatB;
    const A=g.players[mySeat];
    if(useSha){
      // 曹彰【将驰】选项1:本回合不能打出杀
      if(A.jiangchiNoSlash) return g;
      // cardIdx 是客户端"多候选选牌"传来的具体下标(可选):传了且服务端复核确实能当杀才采信,
      // 不合法就当没传、回退 findUsableAs——不盲信客户端下标(和 respondShan 同一套写法)。
      const specifiedCard = (typeof cardIdx==='number') ? (A.hand||[])[cardIdx] : null;
      const idx = (specifiedCard && canUseAs(A, specifiedCard, '杀')) ? cardIdx : findUsableAs(A.hand, A, '杀');
      if(idx<0) return g; // 没有可用的杀:不生效(按钮本就不该渲染)
      const card=removeHandCards(g, mySeat, idx)[0]; g.discard.push(card);
      g.log=pushLog(g.log, A.name+' 选择对 '+g.players[seatB].name+' 使用'+(isShaName(card.name)?'【'+card.name+'】':'【'+card.name+'】当【杀】')+'(借刀杀人)');
      markCardSound(g, '杀', mySeat, card, seatB);
      if(card.name!=='杀'){ if(hasCap(A,'longdan')) markSkillSound(g,'龙胆'); else if(hasCap(A,'wusheng')) markSkillSound(g,'武圣'); }
      g.pending=null;
      resolveShaUse(g, A, seatB, '借刀杀人:出【杀】', singleCardShaColor(card), card, undefined);
      return g;
    }
    const weapon=A.equips.weapon;
    if(!weapon) return g; // 理论上不会(resolveTrick 进这个阶段前已校验),双重保险
    A.equips.weapon=null;
    const user=g.players[g.pending.from]; // 借刀杀人的使用者(不是A、不是B)
    if(user && user.alive){
      user.hand.push(weapon);
      g.log=pushLog(g.log, A.name+' 选择交出武器【'+weapon.name+'】,'+user.name+' 获得此牌(借刀杀人)');
    } else {
      // 使用者已阵亡(理论边界):没有手牌可归还,兜底弃入弃牌堆,防止牌凭空消失
      g.discard.push(weapon);
      g.log=pushLog(g.log, A.name+' 选择交出武器【'+weapon.name+'】,但使用者已不在场,该牌弃置(借刀杀人)');
    }
    // 【失去装备钩子的正确接法,见 CLAUDE.md「凌统旋风」条】先把休止相设成 play(A 交出武器后,
    // 借刀已结算完毕、攻击者的出牌阶段继续),再触发 onLoseEquip——这样凌统【旋风】钩子捕获的
    // previousPhase 才是 play(而不是此刻的 jiedaoChoice)。钩子若挂起了新 pending(旋风),
    // 说明它接管了控制权,直接 return、不要再执行下面的重置把它覆盖掉(遗计/濒死同款约定)。
    g.pending=null; g.phase='play';
    const pendingBefore=g.pending; // = null
    triggerHook(g, mySeat, 'onLoseEquip', {count:1});
    if(g.pending!==pendingBefore && g.pending) return g; // 旋风等钩子挂起了,保留不覆盖
    return g;
  });
}

function continueShaAfterTieqi(g, from, to, noShan, sourceCard, shaColor, shaInfo){
  const me=g.players[from];
  g.pending=setResponseAskedAt({from, to, noShan, shaColor});
  if(sourceCard!==undefined) g.pending.sourceCard=sourceCard;
  if(shaInfo && shaInfo.jiuBonus) g.pending.jiuBonus=true;
  if(noShan){
    g.log=pushLog(g.log, '此【杀】不可被【闪】抵消(含视为闪的效果)');
    g.phase='respond';
    return;
  }
  // 青釭剑:攻击者无视目标防具 → 跳过目标防具判定。
  if(hasCap(me,'ignoreArmor')){
    if(g.players[to].equips && g.players[to].equips.armor) g.log=pushLog(g.log, me.name+' 的【青釭剑】无视了 '+g.players[to].name+' 的防具');
    g.phase='respond'; return; // 目标只能正常出闪/受伤
  }
  // 八卦阵:被杀需出闪前先判定,红=视为出闪 → 杀被抵消,攻击者继续出牌(与正常出闪同结果)
  const r=tryBagua(g, to, {type:'sha', from, to, sourceCard, shaInfo});
  if(r==='pending') return; // 鬼才改判进行中,收尾延后到 finishGuicai
  if(r){
    const sourceCardForSha = g.pending && g.pending.sourceCard;
    g.pending=null;
    // 杀被闪抵消后的效果调度:猛进/青龙偃月刀/贯石斧
    if(maybeStartShaOffsetEffects(g, from, to, sourceCardForSha)) return;
    finishSingleShaTarget(g);
    return;
  }
  g.phase='respond'; // 黑/无八卦阵:照常进响应,等目标出闪或受伤
}

function finishTieqiJudge(g, from, to, card, sourceCard, shaColor, shaInfo){
  markHongyanIfConverted(g,g.players[from],card);
  const red=isRedForPlayer(g.players[from], card);
  g.log=pushLog(g.log, g.players[from].name+' 发动【铁骑】,判定为'+(red?'红':'黑'));
  // 天妒:铁骑判定归属者是 from(发动铁骑的攻击者)自己的判定,若 from 恰好是郭嘉可以收下判定牌
  // (现实中不会发生——铁骑是马超专属 cap,一人不能同时是马超又是郭嘉——但函数写法上不应该
  // 硬编码排除这种情况,和 maybeTiandu 本身"只查 hasCap,不硬编码武将名"的原则一致)。
  maybeTiandu(g, from, card);
  afterShaTargetSkills(g, from, to, red, sourceCard, shaColor, shaInfo);
}

function playZhangbaSha(idx1, idx2, targetSeat){
  tx(g=>{
    if(g.phase!=='play'||g.turn!==mySeat) return g;
    const me=g.players[mySeat];
    if(idx1===idx2) return g;
    const c1=me.hand[idx1], c2=me.hand[idx2];
    if(!c1||!c2) return g;
    if(!hasCap(me,'twoAsSha')) return g;                       // 无丈八(卸下/被拆即失效)
    if(me.jiangchiNoSlash) return g; // 曹彰【将驰】选项1
    if(g.shaUsed && !hasCap(me,'unlimitedSha') && !(g.jiangchiExtraShaLeft > 0)) return g; // 次数限制(除非无限杀/将驰+1)
    const tgt=g.players[targetSeat];
    if(targetSeat===mySeat||!tgt||!tgt.alive) return g;
    // 曹彰【将驰】选项2:无距离;否则查攻击距离(丈八 range3)
    if(!(me.jiangchiNoDistance && g.turn===mySeat) && !canReachSha(g, mySeat, targetSeat)) return g;
    // 诸葛亮【空城】:丈八蛇矛这条路径不走 CARD_PLAYS['杀'].canTarget,单独补上同一条限制
    // ——这仍然是"使用杀"这件事,空城不区分杀是怎么凑出来的。
    if(hasCap(tgt,'kongcheng') && (tgt.hand||[]).length===0) return g;
    // 两张牌进弃牌堆:统一走 removeHandCards(大下标先弹,内部处理连营)
    const hi=Math.max(idx1,idx2), lo=Math.min(idx1,idx2);
    g.discard.push(...removeHandCards(g, mySeat, [hi, lo]));
    if(!g.shaUsed) g.shaUsed=true;
    else if(g.jiangchiExtraShaLeft > 0) g.jiangchiExtraShaLeft--;
    // 丈八蛇矛合成杀的颜色按两张牌的红黑组合决定(两红→红/两黑→黑/一红一黑→无色),
    // 不是"没有颜色"——c1/c2 是 splice 之前存的引用,不受后面 splice 影响。
    resolveShaUse(g, me, targetSeat, '用两张牌当【杀】(丈八蛇矛)', combinedShaColor(c1, c2), [c1, c2], consumeJiuShaBonus(g, me));
    // 丈八蛇矛是两张牌合成一个杀,没有单一牌面对象可传(c1/c2 是两张不同的牌,传其中任一张
    // 都是拼凑/误导),中央出牌区只传座位(仍能显示"谁"),card 留空退化为不显示牌面。
    markCardSound(g, '杀', mySeat, null, targetSeat); // 丈八蛇矛两张当杀不走 playCard 统一出口,单独补一次
    return g;
  });
}

function playShaFangtian(cardIdx, targets){
  tx(g=>{
    if(g.phase!=='play'||g.turn!==mySeat) return g;
    const me=g.players[mySeat], card=me.hand[cardIdx];
    if(!card || !canUseAs(me,card,'杀')) return g;
    if(me.jiangchiNoSlash) return g;
    if(g.shaUsed && !hasCap(me,'unlimitedSha') && !(g.jiangchiExtraShaLeft > 0)) return g; // 出杀次数限制,和普通杀一致
    if(!hasCap(me,'fangtian') || me.hand.length!==1) return g; // 锁定技触发条件:必须是最后一张手牌
    if(!Array.isArray(targets) || targets.length<1 || targets.length>3) return g;
    const seen=new Set();
    for(const t of targets){
      if(seen.has(t)) return g; // 目标不能重复
      seen.add(t);
      if(!CARD_PLAYS['杀'].canTarget(g,me,{name:'杀',virtual:true},t)) return g;
    }
    // 按现有回合方向(nextAlive)从攻击者起重排,不用玩家提交的原始顺序
    const order=[]; let s=mySeat;
    for(let i=0;i<g.players.length;i++){ s=nextAlive(g,s); if(targets.includes(s)) order.push(s); }
    removeHandCards(g, mySeat, cardIdx);
    g.discard.push(card);
    if(!g.shaUsed) g.shaUsed=true;
    else if(g.jiangchiExtraShaLeft > 0) g.jiangchiExtraShaLeft--;
    const usedAs = isShaName(card.name) ? '出【'+card.name+'】' : '出【'+card.name+'】当【杀】';
    g.log=pushLog(g.log, me.name+' 发动【方天画戟】,'+usedAs+',指定 '+order.length+' 个目标：'+order.map(t=>g.players[t].name).join('、'));
    const shaInfo = consumeJiuShaBonus(g, me);
    g.fangtianQueue = { from:mySeat, targets:order, idx:0, usedAs, shaColor:singleCardShaColor(card), sourceCard:card, shaInfo };
    resolveShaUse(g, me, order[0], usedAs, singleCardShaColor(card), card, shaInfo);
    markCardSound(g, '杀', mySeat, card, order); // 方天画戟多目标出杀不走 playCard 统一出口,单独补一次
    return g;
  });
}

function maybeStartLiuli(g, from, to, usedAs, shaColor, sourceCard){
  const target=g.players[to];
  if(!target || !target.alive || from===to || !hasCap(target,'liuli')) return false;
  if(liuliDiscardOptions(target).length===0) return false;
  const targets=liuliTargets(g, from, to);
  if(targets.length===0) return false;
  g.pending=setResponseAskedAt({type:'liuli', from, to, usedAs, shaColor, targets});
  if(sourceCard!==undefined) g.pending.sourceCard=sourceCard;
  g.phase='liuli';
  g.log=pushLog(g.log, target.name+' 是否发动【流离】,弃一张牌转移此【杀】…');
  return true;
}

function maybeStartQiaomeng(g, from, to, shaColor) {
  const source = g.players[from];
  const target = g.players[to];
  // 检查条件:攻击者是公孙瓒,有趫猛技能,使用的是黑色杀,目标存活
  if(!source || !source.alive || !target || !target.alive || from === to || !hasCap(source,'qiaomeng')) return false;
  // 必须是黑色杀；resolveShaUse 传入的 shaColor 已统一为 'red'/'black'/'none'。
  if(shaColor !== 'black') return false;
  // 检查目标是否有装备
  const equips = target.equips || {};
  const equipSlots = Object.keys(equips).filter(slot => equips[slot] !== null);
  if(equipSlots.length === 0) return false;
  
  // 进入趫猛选择阶段
  g.pending=setResponseAskedAt({type:'qiaomengChoose', sourceSeat:from, targetSeat:to, shaColor:shaColor});
  g.phase='qiaomengChoose';
  g.log=pushLog(g.log, source.name + ' 发动【趫猛】,可以选择 ' + target.name + ' 的一张装备牌');
  markSkillSound(g, 'qiaomeng');
  return true;
}

function finishSingleShaTarget(g){
  if(checkWin(g)) return;
  // 夏侯渊【神速】"视为使用一张杀"结算完毕后的收尾:g.shensuResume 和 g.fangtianQueue/
  // g.luanwuResume 同一设计——放在 g 上而不是 g.pending 里,不受 resolveShaUse 替换
  // g.pending 的影响。finishSingleShaTarget 是这张"视为杀"(不管中途有没有触发濒死/争议/
  // 天香/制蛮/毅重/仁王盾/八卦阵等任意打断)彻底结算完毕的唯一收敛点,在这里做神速自己的
  // 阶段跳转天然正确、不会被提前冲掉。详见 skills.js 的 respondShensuSha/finishShensuSha。
  if(g.shensuResume){ finishShensuSha(g); return; }
  if(g.fangtianQueue){ advanceFangtianQueue(g); return; }
  // 乱武借 resolveShaUse 出的杀结算完:接回乱武链
  if(g.luanwuResume){ continueLuanwuAfterSha(g); return; }
  g.phase='play';
}

function continueLuanwuAfterSha(g){
  const r = g.luanwuResume;
  g.luanwuResume = null;
  if(!r){ g.phase='play'; return; }
  g.pending = {
    type:'luanwuChoose',
    currentSeat: null,
    remainingSeats: Array.isArray(r.remainingSeats) ? r.remainingSeats.slice() : [],
    sourceSeat: r.sourceSeat,
    targetMap: r.targetMap || {}
  };
  if(typeof proceedToNextLuanwu === 'function') proceedToNextLuanwu(g);
  else { g.pending=null; g.phase='play'; }
}

function respondShan(useShan, cardIdx){
  tx(g=>{
    if(g.phase!=='respond'||!g.pending||g.pending.to!==mySeat) return g;
    const me=g.players[mySeat]; const attacker=g.players[g.pending.from];
    const needed = hasCap(attacker,'wushuang') ? 2 : 1;
    if(needed===2 && !(g.pending.shanCount||0)) markSkillSound(g,'无双');
    if(useShan){
      if(g.pending.noShan) return g; // 马超【铁骑】判红:此杀不可被闪抵消,服务端兜底(UI 本就不该渲染这个按钮)
      const specifiedCard = (typeof cardIdx==='number') ? (me.hand||[])[cardIdx] : null;
      const idx = (specifiedCard && canUseAs(me, specifiedCard, '闪')) ? cardIdx : findUsableAs(me.hand,me,'闪'); // 龙胆:杀可当闪,优先用本名闪
      if(idx<0) return g;
      const card=removeHandCards(g, mySeat, idx)[0]; g.discard.push(card);
      const played=(g.pending.shanCount||0)+1;
      g.log=pushLog(g.log, me.name+' 打出'+(card.name==='闪'?'【闪】':'【'+card.name+'】当【闪】')+(needed>1?'（'+played+'/'+needed+'）':'抵消'));
      markCardSound(g, '闪', mySeat, card);
      if(card.name!=='闪' && hasSkillName(me,'倾国') && !isRedForPlayer(me,card)) markSkillSound(g,'倾国');
      if(card.name!=='闪' && hasCap(me,'longdan')) markSkillSound(g,'龙胆');
      // 张角【雷击】:使用或打出【闪】时可以发动雷击——maybeStartLeiji 内部会把 g.pending
      // 整个换成 leijiChoose 结构(不再是这个函数原本认识的 {from,to,...} respond 结构),
      // 必须检查它的返回值:一旦挂起就立即 return,不能再往下跑 played<needed/
      // maybeStartShaOffsetEffects 这些以"g.pending 还是原来那个杀响应结构"为前提的判断——
      // 否则 g.pending.from 会读到 undefined(取自已被替换的 leijiChoose 对象),这些判断
      // 全部落空,最终执行到函数尾部的 g.pending=null;finishSingleShaTarget(g),把刚挂起
      // 的 leijiChoose 在同一次 tx 里原地冲掉,雷击的"是否发动"询问永远不会被任何客户端
      // 看到。和凌统旋风当初的 pendingBefore 快照检查是同一类问题,这里更简单——
      // maybeStartLeiji 本身就有明确的布尔返回值,不需要额外快照比较。
      if(hasCap(me,'leiji') && card.name==='闪'){
        if(maybeStartLeiji(g, mySeat, card)) return g;
      }
      if(played<needed){ g.pending.shanCount=played; return g; } // 吕布【无双】:还不够,留在原地再问一次
      // 杀被闪抵消后的效果调度:猛进/青龙偃月刀/贯石斧
      if(maybeStartShaOffsetEffects(g, g.pending.from, mySeat, g.pending.sourceCard)) return g;
    } else {
      // 曹操【护驾】:主公需出闪且未用过主公技 → 先进入求助流程;无人替出则回原响应
      // (铁骑判红的杀不可被闪抵消,连求助也不给——服务端兜底,UI 本就不渲染该按钮)
      if(!g.pending.noShan && canTriggerLordAsk(g, mySeat, 'hujia')){
        startLordAsk(g, mySeat, '闪', 'hujia');
        return g;
      }
      const shaFrom = g.pending.from;
      const shaSourceCard = g.pending.sourceCard;
      const shaColor = g.pending.shaColor;
      // 寒冰剑:杀命中造成伤害之前,装备者(攻击者)可选择防止此伤害、改为弃置目标两张牌——
      // 目标(mySeat,这一刻要受伤的人)完全没有牌可弃时不能发动,直接走原有的正常受伤流程,
      // 不弹出一个"发动了但没什么可弃"的空询问。
      const attackerHan=g.players[shaFrom];
      if(hasCap(attackerHan,'hanbing') && hanbingDiscardCount(me)>0){
        const sourceCard=shaSourceCard;
        g.pending={type:'hanbingAsk', from:shaFrom, to:mySeat};
        if(sourceCard!==undefined) g.pending.sourceCard=sourceCard;
        g.phase='hanbingAsk';
        g.log=pushLog(g.log, attackerHan.name+' 是否发动【寒冰剑】,防止伤害,改为弃置 '+me.name+' 两张牌…');
        return g;
      }
      // 古锭刀:锁定技,自动生效,不问是否发动——命中这一刻(不是出杀那一刻)检查目标手牌数,
      // 若此刻恰好无手牌则这次伤害+1。整体按一次 dealDamage 调用结算(amount 先算好再传),
      // 不拆成两次调用,这样依赖"这次伤害共多少点"的钩子(如郭嘉【天妒】)才能看到正确数值。
      const gudingBonus = hasCap(attacker,'gudingdao') && (me.hand||[]).length===0 ? 1 : 0;
      const dying = dealDamage(g, mySeat, damageAmount(g, shaFrom, 1+gudingBonus, 'sha', {jiuBonus:!!g.pending.jiuBonus}), shaFrom, '不闪', 'sha', shaSourceCard);
      if(dying) return g; // 濒死流程接管,后续(pending清空/checkWin/phase=play)延后到 finishDying 处理
      // 麒麟弓:杀造成实际伤害且目标存活 → 弃目标坐骑;两匹时开选马子阶段(此处提前返回,交给 qilinResolve,不做收尾)
      if(maybeStartQilin(g, shaFrom, mySeat)) return g;
      // 公孙瓒【趫猛】:使用黑色【杀】造成伤害后,可以选择目标装备区的一张牌
      if(maybeStartQiaomeng(g, shaFrom, mySeat, shaColor)) return g;
      // 祝融【烈刃】:使用【杀】造成伤害后,可以与目标拼点
      if(maybeStartLieRen(g, shaFrom, mySeat)) return g;
    }
    g.pending=null;
    finishSingleShaTarget(g); // 单个目标响应完毕:方天画戟排队中还有下一个则继续,否则回到出牌阶段
    return g;
  });
}
