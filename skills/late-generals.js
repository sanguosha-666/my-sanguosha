// 后期武将技能包：袁绍、祝融、徐庶、曹彰、曹植等。纯搬移。

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
    const removedCards = removeHandCards(g, mySeat, cardIndices);
    
    if (removedCards.length !== 2) {
      g.log = pushLog(g.log, `${me.name} 使用【乱击】失败:牌数量不足`);
      g.pending = null;
      g.phase = 'play';
      return g;
    }
    
    // 视为使用万箭齐发
    g.log = pushLog(g.log, `${me.name} 将【${removedCards[0].name}】和【${removedCards[1].name}】当【万箭齐发】使用`);

    // 【真实bug修复】先清空这条luanjiConfirm自己的pending/phase,再执行万箭齐发效果——
    // 不能等效果执行完再清。万箭齐发的effect会调aoeEffect,把g.aoe设成一个真实的AOE会话
    // 并调aoeAdvance,后者会重新建立g.pending(问第一个目标要不要无懈/要不要打闪)、把
    // g.phase切到'wuxie'/'aoeResp'。原来的写法是"先执行效果、再无条件g.pending=null;
    // g.phase='play'",效果内部刚建立的响应pending会被这两行原地冲掉,导致后续没有人会
    // 被问到万箭齐发的响应——而g.aoe本身不受影响、继续保持非null(aoeAdvance只有在
    // 问完所有目标后才会清空g.aoe,这里被冲掉的是"问下一个目标"这一步,永远问不完)。
    // 后果:g.aoe从此卡死非null,render-table.js/pruneExchangeCards共用的
    // "!g.pending&&!g.aoe"这个"链已结束"判断此后再也无法满足,中央出牌区从这一刻起
    // 永久停止淡出/清空,后续所有回合的出牌记录都会不断堆积进同一个g.exchangeCards
    // 数组——这正是"机器人主动技能解锁"后（袁绍乱击开始被机器人真正调用到）暴露出来的
    // 中央出牌区堆积不淡出的根因,是乱击/confirmLuanji自身一直存在的既有bug,不是这次
    // 机器人任务或debugLogs审计任务引入的新问题,只是此前几乎没有真人会用这个技能、
    // 机器人也从不会主动发动,这条代码路径长期没被真正跑过。
    g.pending = null;
    g.phase = 'play';

    // 执行万箭齐发效果(可能会重新建立pending/切换phase,比如依次询问每个目标要不要打闪)
    const wanjianEffect = CARD_PLAYS['万箭齐发'];
    if (wanjianEffect && wanjianEffect.effect) {
      wanjianEffect.effect(g, me, { name: '万箭齐发', suit: removedCards[0].suit });
    }

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
    // 【A类修复】补setResponseAskedAt。
    g.pending = setResponseAskedAt({
      type: 'lieRenPickCard',
      sourceSeat: mySeat,
      targetSeat: pending.targetSeat
    });
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
      removeHandCards(g, pending.sourceSeat, sourceCardIndex);
    }
    
    const targetCardIndex = target.hand.findIndex(c => c === targetCard);
    if (targetCardIndex !== -1) {
      removeHandCards(g, mySeat, targetCardIndex);
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
            removeHandCards(g, mySeat, handIndex);
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
    removeHandCards(g, mySeat, idx);
    g.discard.push(card);
    markDiscardReveal(g, mySeat, [card]);
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
