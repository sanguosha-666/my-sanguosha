// 统一 pending 阶段配置：actor、normalize、timeoutAction 的唯一登记位置。
// 传统 script 共享作用域；必须在 game.js / bot-ai-bus.js / render-controls.js 前加载。
const STAGE_TABLE = Object.create(null);
function registerStage(type, spec){
  if(typeof type!=='string'||!type) throw new Error('stage type required');
  const current=STAGE_TABLE[type]||(STAGE_TABLE[type]={});
  if(spec&&spec.actor&&current.actor&&current.actor!==spec.actor){
    throw new Error('stage actor conflict: '+type+' ('+current.actor+' / '+spec.actor+')');
  }
  Object.assign(current,spec||{});
  return current;
}
function stageActorField(type){
  const spec=type&&STAGE_TABLE[type];
  return spec&&typeof spec.actor==='string'?spec.actor:null;
}
Object.entries({
  huashenPick:'seat',guanxingReview:'seat',xunxunPick:'seat',guhuoTarget:'sourceSeat',
  respond:'to',aoeResp:'to',duel:'active',dying:'asking',wuxie:'asking',
  tieqi:'from',huogong:'from',pick:'from',hanbing:'from',duanbingChoose:'sourceSeat',fanjianSuit:'targetSeat',
  enyuanChoose:'damagerSeat',jiedaoChoice:'seatA',luoyingAsk:'seat',
  huashenChangeAskStart:'seat',guhuoQuestion:'asking',yijiAsk:'seat',yijiAssign:'seat',
  lirangAsk:'from',liuli:'to',xiaoguo:'asking',xiaoguoChoice:'to',jijiangAsk:'asking',
  zhibaAsk:'lordSeat',yinghunTarget:'seat',beigeChoose:'sourceSeat',beigeDiscard:'sourceSeat',
  beigeJudge:'sourceSeat',luanwuChoose:'currentSeat',xuanfengPick:'from',
  lieRenRespond:'targetSeat',qiangxiPickTarget:'seat',qiangxiChooseCost:'seat',
  jujianPickCard:'sourceSeat',jushouChoose:'seat',cixiongAsk:'from',guanshi:'from',
  hanbingAsk:'from',qinglong:'from',shuangxiongAsk:'seat',leijiChoose:'sourceSeat',
  haoshiPick:'seat',tiaoxinDiscard:'from',biyue:'seat',buquAsk:'seat',renxinChoose:'seat',
  chengxiangAsk:'seat',luoyiAsk:'seat',jiemingAsk:'seat',xinshengAsk:'seat',
  jiushiFlipAsk:'seat',lianyingAsk:'seat',mingcePickCard:'sourceSeat',mingceChoice:'targetSeat',
  tianyiPickCard:'seat',tianyiPickTarget:'seat',fenxunDiscard:'seat',fenxunTarget:'seat',
  qiaomengChoose:'sourceSeat',wangxiAsk:'seat',ganglieAsk:'seat',guiduAsk:'sourceSeat',
  jiangchiAsk:'seat',zhijiChoice:'seat',tiaoxinChoice:'to',huanhuoPick:'sourceSeat',
  huanhuoPickGotCard:'sourceSeat',lieRenChoose:'sourceSeat',shensuChoose1:'seat',
  qiaobianTurnStart:'seat',yaowu_choose:'seat',shensuSha:'seat',zhimengAsk:'from',
  zhimengPick:'from',huashenChangePickStart:'seat',luanjiChoose:'sourceSeat',
  jujianPickTarget:'sourceSeat',jujianChooseEffect:'targetSeat',liegong:'from',
  shaOffsetChoice:'from',mengjin:'from',lirangRecover:'from',zhengyi:'asking',
  quhuRespond:'targetSeat',tianyiRespond:'targetSeat',tianxiang:'seat',
  huashenChangeAskEnd:'seat',huashenChangePickEnd:'seat',cixiongChoice:'to',
  huogongReveal:'to',guicai:'asking',ganglieChoice:'sourceSeat',quhuDamageChoice:'seat',
  qiaobianMove:'seat',leijiJudge:'sourceSeat',hujiaAsk:'asking',lieRenPickCard:'sourceSeat',
  shensuChoose2:'seat',qiaomengPickEquip:'sourceSeat',qilin:'from',
  qiangxiChooseWeaponFromHand:'seat',mingcePickTarget:'sourceSeat',
  mingcePickTarget2:'sourceSeat',luanjiConfirm:'sourceSeat',zhibaGain:'lordSeat',
  yinghunChoice:'seat',yinghunDiscard:'targetSeat',enyuanChooseOption:'damagerSeat',
  enyuanGiveCard:'damagerSeat',huanhuoPickCard:'sourceSeat',huanhuoPickSecond:'sourceSeat'
}).forEach(([type,actor])=>registerStage(type,{actor}));

// ---------- 身份局(主公局)配比与查询 ----------
// 仅 4~8 人。数组元素为 role id,开局洗牌后按座位发放。
// 规格: docs/superpowers/specs/2026-07-19-identity-mode-design.md

function normalizeRegisteredStage(g){
  if(!g.pending) return;
  const d=g.pending;
  const spec=STAGE_TABLE[d.type];
  if(!spec) return;
  const required=Array.isArray(spec.required)?spec.required:[];
  const alive=Array.isArray(spec.alive)?spec.alive:[];
  const missing=required.some(function(field){ return d[field]===undefined || d[field]===null; });
  const dead=alive.some(function(field){
    const seat=d[field];
    return !Number.isInteger(seat) || !g.players[seat] || !g.players[seat].alive;
  });
  if(missing||dead){
    logPendingOrphan(g,'STAGE_TABLE声明式校验未通过('+d.type+')');
    g.pending=null;
    g.phase=typeof spec.orphanPhase==='string'?spec.orphanPhase:'play';
    return;
  }
  if(typeof spec.normalize==='function') spec.normalize(g);
}
// pending 结构校验与 actor/render/timeout 共用 STAGE_TABLE；复杂阶段保留原校验体。
function registerStageNormalizer(types, normalizePending){
  (Array.isArray(types)?types:[types]).forEach(function(type){ registerStage(type,{normalize:normalizePending}); });
}
registerStageNormalizer("qiangxiPickTarget", function(g){
  if(g.pending && g.pending.type==='qiangxiPickTarget'){
    const d = g.pending;
    if(typeof d.seat!=='number' || !g.players[d.seat] || !g.players[d.seat].alive ||
       !Array.isArray(d.candidates) || d.candidates.length===0 ||
       typeof d.costType!=='string' || !['hp','weapon'].includes(d.costType)){
      logPendingOrphan(g, 'A:normalize校验未通过,pending结构不合法(qiangxiPickTarget)');
      g.pending = null;
      g.phase = 'play';
    }
  }
});
registerStageNormalizer("qiangxiChooseCost", function(g){
  if(g.pending && g.pending.type==='qiangxiChooseCost'){
    const d = g.pending;
    if(typeof d.seat!=='number' || !g.players[d.seat] || !g.players[d.seat].alive){
      logPendingOrphan(g, 'B:normalize校验未通过,pending结构不合法(qiangxiChooseCost)');
      g.pending = null;
      g.phase = 'play';
    }
  }
});
registerStageNormalizer("qiangxiChooseWeaponFromHand", function(g){
  if(g.pending && g.pending.type==='qiangxiChooseWeaponFromHand'){
    const d = g.pending;
    if(typeof d.seat!=='number' || !g.players[d.seat] || !g.players[d.seat].alive ||
       !Array.isArray(d.weaponIndices) || d.weaponIndices.length===0){
      logPendingOrphan(g, 'A:normalize校验未通过,pending结构不合法(qiangxiChooseWeaponFromHand)');
      g.pending = null;
      g.phase = 'play';
    }
  }
});
registerStageNormalizer("mingcePickCard", function(g){
  if(g.pending && g.pending.type==='mingcePickCard'){
    const d = g.pending;
    // 【不要再加 cardToGive 的校验】这个阶段的语义就是"陈宫还没选牌",startMingce 建的
    // pending 只有 {type,sourceSeat},cardToGive 要到下一阶段才存在 —— 空/缺失是合法的
    // 中间态,不是脏数据。曾经要求它必须是非空数组,导致每次 tx 开头的 normalize 都把这个
    // 刚建立的 pending 清掉,明策永远走不过第一步(而 mingceUsed 已被消耗)。
    // 和贾诩【乱武】remainingSeats.length===0 被误当脏数据是同一类错误。
    if(typeof d.sourceSeat!=='number' || !g.players[d.sourceSeat] || !g.players[d.sourceSeat].alive){
      logPendingOrphan(g, 'B:normalize校验未通过,pending结构不合法(mingcePickCard)');
      g.pending = null;
      g.phase = 'play';
    }
  }
});
registerStageNormalizer("mingcePickTarget", function(g){
  if(g.pending && g.pending.type==='mingcePickTarget'){
    const d = g.pending;
    // 【不要再要求 targetSeat 是 number】这个阶段的语义就是"还没选接收牌的目标",
    // pickMingceCard 建 pending 时 targetSeat 恒为 null —— 同上,合法中间态不是脏数据。
    // 只有它非 null 时才需要是个真实座位。cardToGive/cardName 在这个阶段确实已经有了,保留校验。
    if(typeof d.sourceSeat!=='number' || !g.players[d.sourceSeat] ||
       (d.targetSeat!==null && (typeof d.targetSeat!=='number' || !g.players[d.targetSeat] || !g.players[d.targetSeat].alive)) ||
       !Array.isArray(d.cardToGive) || d.cardToGive.length===0 ||
       typeof d.cardName !== 'string' || d.cardName === ''){
      logPendingOrphan(g, 'A:normalize校验未通过,pending结构不合法(mingcePickTarget)');
      g.pending = null;
      g.phase = 'play';
    }
  }
});
registerStageNormalizer("mingcePickTarget2", function(g){
  if(g.pending && g.pending.type==='mingcePickTarget2'){
    const d = g.pending;
    if(typeof d.sourceSeat!=='number' || !g.players[d.sourceSeat] ||
       typeof d.targetSeat!=='number' || !g.players[d.targetSeat] || !g.players[d.targetSeat].alive ||
       !Array.isArray(d.candidates) || d.candidates.length===0 ||
       !Array.isArray(d.cardToGive) || d.cardToGive.length===0 ||
       typeof d.cardName !== 'string' || d.cardName === ''){
      logPendingOrphan(g, 'A:normalize校验未通过,pending结构不合法(mingcePickTarget2)');
      g.pending = null;
      g.phase = 'play';
    }
  }
});
registerStageNormalizer("mingceChoice", function(g){
  if(g.pending && g.pending.type==='mingceChoice'){
    const d = g.pending;
    if(typeof d.sourceSeat!=='number' ||
       typeof d.targetSeat!=='number' || !g.players[d.targetSeat] || !g.players[d.targetSeat].alive ||
       (d.target2Seat!==null && (typeof d.target2Seat!=='number' || !g.players[d.target2Seat]))||
       typeof d.cardName !== 'string' || d.cardName === ''){
      logPendingOrphan(g, 'A:normalize校验未通过,pending结构不合法(mingceChoice)');
      g.pending = null;
      g.phase = 'play';
    }
  }
});
registerStageNormalizer("luanwuChoose", function(g){
  if(g.pending && g.pending.type==='luanwuChoose'){
    const d = g.pending;
    if(typeof d.currentSeat!=='number' || !g.players[d.currentSeat] || !g.players[d.currentSeat].alive ||
       typeof d.sourceSeat!=='number' || !g.players[d.sourceSeat] || !g.players[d.sourceSeat].alive){
      logPendingOrphan(g, 'A:normalize校验未通过,pending结构不合法(luanwuChoose)');
      g.pending = null;
      g.phase = 'play';
    } else if(!Array.isArray(d.remainingSeats)){
      d.remainingSeats = [];
    }
  }
});
registerStageNormalizer("luanjiChoose", function(g){
  if(g.pending && g.pending.type==='luanjiChoose'){
    const d = g.pending;
    if(typeof d.sourceSeat!=='number' || !g.players[d.sourceSeat] || !g.players[d.sourceSeat].alive ||
       !Array.isArray(d.availablePairs) || d.availablePairs.length===0){
      logPendingOrphan(g, 'A:normalize校验未通过,pending结构不合法(luanjiChoose)');
      g.pending = null;
      g.phase = 'play';
    }
  }
});
registerStageNormalizer("luanjiConfirm", function(g){
  if(g.pending && g.pending.type==='luanjiConfirm'){
    const d = g.pending;
    if(typeof d.sourceSeat!=='number' || !g.players[d.sourceSeat] || !g.players[d.sourceSeat].alive ||
       !Array.isArray(d.cardIndices) || d.cardIndices.length !== 2){
      logPendingOrphan(g, 'A:normalize校验未通过,pending结构不合法(luanjiConfirm)');
      g.pending = null;
      g.phase = 'play';
    }
  }
});
registerStageNormalizer("leijiChoose", function(g){
  if(g.pending && g.pending.type==='leijiChoose'){
    const d = g.pending;
    if(typeof d.sourceSeat!=='number' || !g.players[d.sourceSeat] || !g.players[d.sourceSeat].alive ||
       !Array.isArray(d.availableTargets) || d.availableTargets.length===0){
      logPendingOrphan(g, 'A:normalize校验未通过,pending结构不合法(leijiChoose)');
      g.pending = null;
      g.phase = 'play';
    }
  }
});
registerStageNormalizer("leijiJudge", function(g){
  if(g.pending && g.pending.type==='leijiJudge'){
    const d = g.pending;
    if(typeof d.sourceSeat!=='number' || !g.players[d.sourceSeat] || !g.players[d.sourceSeat].alive ||
       typeof d.targetSeat!=='number' || !g.players[d.targetSeat] || !g.players[d.targetSeat].alive ||
       !d.resume || typeof d.resume.kind!=='string'){
      logPendingOrphan(g, 'A:normalize校验未通过,pending结构不合法(leijiJudge)');
      g.pending = null;
      g.phase = 'play';
    }
  }
});
registerStageNormalizer("guiduAsk", function(g){
  if(g.pending && g.pending.type==='guiduAsk'){
    const d = g.pending;
    // Firebase Realtime Database 不保留空数组。maybeGuidu 创建 pending 时 askedSeats 是
    // []（还没有任何候选人被问过），同步回来后该字段会直接缺失（undefined）；这属于合法
    // 初始状态，不能当成脏数据清掉 pending，否则真实联机局中鬼道询问会在建立后立刻消失
    // （和 xuanfengPick 的 targets/discardedCounts、guhuoQuestion 的 questioners/answered
    // 同一类修复——先补默认值，再校验真正结构性的字段）。
    if(!Array.isArray(d.askedSeats)) d.askedSeats=[];
    if(typeof d.sourceSeat!=='number' || !g.players[d.sourceSeat] || !g.players[d.sourceSeat].alive ||
       typeof d.judgedSeat!=='number' || !g.players[d.judgedSeat] || !g.players[d.judgedSeat].alive ||
       !d.judgeCard || !d.judgeCard.suit ||
       !d.resume || typeof d.resume.kind!=='string'){
      logPendingOrphan(g, 'A:normalize校验未通过,pending结构不合法(guiduAsk)');
      g.pending = null;
      g.phase = 'play';
    }
  }
});
registerStageNormalizer("huashenPick", function(g){
  if(g.pending && g.pending.type==='huashenPick'){
    const d=g.pending;
    const p=g.players[d.seat];
    if(typeof d.seat!=='number' || !p || !p.alive || p.huashenGeneral!==null
       || !Array.isArray(p.huashenPool) || p.huashenPool.length===0){
      logPendingOrphan(g, 'A:normalize校验未通过,pending结构不合法(huashenPick)');
      g.pending=null; g.phase='play';
    }
  }
});
registerStageNormalizer("wuxie", function(g){
  if(g.pending && g.pending.type==='wuxie'){
    if(typeof g.pending.exclude!=='number') g.pending.exclude=g.pending.from;
    if(typeof g.pending.depth!=='number') g.pending.depth=0;
  }
});
registerStageNormalizer("dying", function(g){
  if(g.pending && g.pending.type==='dying'){
    const d=g.pending;
    if(typeof d.seat!=='number' || typeof d.asking!=='number' || !d.resume || typeof d.resume.type!=='string'){
      logPendingOrphan(g, 'A:normalize校验未通过,pending结构不合法(dying)');
      g.pending=null; g.phase='play';
    }
  }
});
registerStageNormalizer("zhijiChoice", function(g){
  if(g.pending && g.pending.type==='zhijiChoice'){
    const d=g.pending;
    if(typeof d.seat!=='number' || !g.players[d.seat] || !g.players[d.seat].alive){
      logPendingOrphan(g, 'B:normalize校验未通过,pending结构不合法(zhijiChoice)');
      g.pending=null; g.phase='play';
    }
  }
});
registerStageNormalizer("tiaoxinChoice", function(g){
  if(g.pending && g.pending.type==='tiaoxinChoice'){
    const d=g.pending;
    if(typeof d.from!=='number' || typeof d.to!=='number' ||
       !g.players[d.from] || !g.players[d.from].alive ||
       !g.players[d.to] || !g.players[d.to].alive){
      logPendingOrphan(g, 'B:normalize校验未通过,pending结构不合法(tiaoxinChoice)');
      g.pending=null; g.phase='play';
    }
  }
});
registerStageNormalizer("tiaoxinDiscard", function(g){
  if(g.pending && g.pending.type==='tiaoxinDiscard'){
    const d=g.pending;
    if(typeof d.from!=='number' || typeof d.to!=='number' ||
       !g.players[d.from] || !g.players[d.from].alive ||
       !g.players[d.to] || !g.players[d.to].alive){
      logPendingOrphan(g, 'B:normalize校验未通过,pending结构不合法(tiaoxinDiscard)');
      g.pending=null; g.phase='play';
    }
  }
});
registerStageNormalizer("yijiAsk", function(g){
  if(g.pending && g.pending.type==='yijiAsk'){
    const d=g.pending;
    if(typeof d.seat!=='number' || !g.players[d.seat] || !g.players[d.seat].alive){
      logPendingOrphan(g, 'B:normalize校验未通过,pending结构不合法(yijiAsk)');
      g.pending=null; g.phase='play';
    }
  }
});
registerStageNormalizer("wangxiAsk", function(g){
  if(g.pending && g.pending.type==='wangxiAsk'){
    const d=g.pending;
    if(typeof d.seat!=='number' || typeof d.otherSeat!=='number' || !Number.isInteger(d.amount) || d.amount<=0
       || !g.players[d.seat] || !g.players[d.seat].alive || !g.players[d.otherSeat]
       || (d.death!==true && !g.players[d.otherSeat].alive)
       || !d.resume || typeof d.resume.type!=='string'){
      logPendingOrphan(g, 'A:normalize校验未通过,pending结构不合法(wangxiAsk)');
      g.pending=null; g.phase='play';
    }
  }
});
registerStageNormalizer("shaOffsetChoice", function(g){
  if(g.pending && g.pending.type==='shaOffsetChoice'){
    const d=g.pending;
    if(typeof d.from!=='number' || typeof d.to!=='number' || 
       !g.players[d.from] || !g.players[d.from].alive ||
       !g.players[d.to] || !g.players[d.to].alive ||
       !Array.isArray(d.available) || d.available.length===0 ||
       !d.available.every(id => ['mengjin','qinglong','guanshifu'].includes(id))){
      logPendingOrphan(g, 'A:normalize校验未通过,pending结构不合法(shaOffsetChoice)');
      g.pending=null; g.phase='play';
    }
  }
});
registerStageNormalizer("mengjin", function(g){
  if(g.pending && g.pending.type==='mengjin'){
    const d=g.pending;
    if(typeof d.from!=='number' || typeof d.to!=='number' || 
       !g.players[d.from] || !g.players[d.from].alive ||
       !g.players[d.to] || !g.players[d.to].alive ||
       !Array.isArray(d.available) || d.available.length===0){
      logPendingOrphan(g, 'A:normalize校验未通过,pending结构不合法(mengjin)');
      g.pending=null; g.phase='play';
    }
  }
});
registerStageNormalizer("yijiAssign", function(g){
  if(g.pending && g.pending.type==='yijiAssign'){
    const d=g.pending;
    if(typeof d.seat!=='number' || !g.players[d.seat] || !g.players[d.seat].alive || !Array.isArray(d.cards) || d.cards.length===0){
      logPendingOrphan(g, 'A:normalize校验未通过,pending结构不合法(yijiAssign)');
      g.pending=null; g.phase='play';
    }
  }
});
registerStageNormalizer("yaowu_choose", function(g){
  if(g.pending && g.pending.type==='yaowu_choose'){
    const d=g.pending;
    if(typeof d.seat!=='number' || typeof d.target!=='number' ||
       !g.players[d.seat] || !g.players[d.target] ||
       !d.sourceCard || typeof d.sourceCard!=='object' ||
       !d.resume || typeof d.resume!=='object' || typeof d.resume.type!=='string'){
      logPendingOrphan(g, 'A:normalize校验未通过,pending结构不合法(yaowu_choose)');
      g.pending=null; g.phase='play';
    }
  }
});
registerStageNormalizer("zhimengAsk", function(g){
  if(g.pending && g.pending.type==='zhimengAsk'){
    const d=g.pending;
    if(typeof d.from!=='number' || typeof d.to!=='number' ||
       !g.players[d.from] || !g.players[d.from].alive ||
       !g.players[d.to] || !g.players[d.to].alive ||
       !Array.isArray(d.options) || d.options.length===0){
      logPendingOrphan(g, 'A:normalize校验未通过,pending结构不合法(zhimengAsk)');
      g.pending=null; g.phase='play';
    }
  }
});
registerStageNormalizer("zhimengPick", function(g){
  if(g.pending && g.pending.type==='zhimengPick'){
    const d=g.pending;
    if(typeof d.from!=='number' || typeof d.to!=='number' ||
       !g.players[d.from] || !g.players[d.from].alive ||
       !g.players[d.to] || !g.players[d.to].alive ||
       !Array.isArray(d.options) || d.options.length===0){
      logPendingOrphan(g, 'A:normalize校验未通过,pending结构不合法(zhimengPick)');
      g.pending=null; g.phase='play';
    }
  }
});
registerStageNormalizer("guicai", function(g){
  if(g.pending && g.pending.type==='guicai'){
    const d=g.pending;
    if(typeof d.seat!=='number' || typeof d.asking!=='number' || !d.judgeCard || !d.judgeCard.suit || !d.resume || typeof d.resume.kind!=='string'){
      logPendingOrphan(g, 'A:normalize校验未通过,pending结构不合法(guicai)');
      g.pending=null; g.phase='play';
    }
  }
});
registerStageNormalizer("tieqi", function(g){
  if(g.pending && g.pending.type==='tieqi' && (typeof g.pending.from!=='number' || typeof g.pending.to!=='number')){
    logPendingOrphan(g, 'B:normalize校验未通过,pending结构不合法(tieqi)');
    g.pending=null; g.phase='play';
  }
});
registerStageNormalizer("liegong", function(g){
  if(g.pending && g.pending.type==='liegong' && (typeof g.pending.from!=='number' || typeof g.pending.to!=='number')){
    logPendingOrphan(g, 'B:normalize校验未通过,pending结构不合法(liegong)');
    g.pending=null; g.phase='play';
  }
});
registerStageNormalizer("xiaoguo", function(g){
  if(g.pending && g.pending.type==='xiaoguo' && (typeof g.pending.endingSeat!=='number' || typeof g.pending.asking!=='number')){
    logPendingOrphan(g, 'B:normalize校验未通过,pending结构不合法(xiaoguo)');
    g.pending=null; g.phase='play';
  }
});
registerStageNormalizer("xiaoguoChoice", function(g){
  if(g.pending && g.pending.type==='xiaoguoChoice' && (typeof g.pending.from!=='number' || typeof g.pending.endingSeat!=='number' || typeof g.pending.to!=='number')){
    logPendingOrphan(g, 'B:normalize校验未通过,pending结构不合法(xiaoguoChoice)');
    g.pending=null; g.phase='play';
  }
});
registerStageNormalizer(["jijiangAsk","hujiaAsk"], function(g){
  if(g.pending && (g.pending.type==='jijiangAsk'||g.pending.type==='hujiaAsk')){
    const d = g.pending;
    if(typeof d.lordSeat!=='number' || typeof d.asking!=='number' ||
       typeof d.need!=='string' || !d.resume ||
       typeof d.resume!=='object' || typeof d.resume.phase!=='string'){
      logPendingOrphan(g, 'A:normalize校验未通过,pending结构不合法(jijiangAsk/hujiaAsk)');
      g.pending=null; g.phase='play';
    } else if(!Object.prototype.hasOwnProperty.call(d.resume,'pending')){
      // resume 缺 pending 键 = 主动激将的 pending:null 被 Firebase 吞掉,补回 null。
      d.resume.pending = null;
    }
  }
});
registerStageNormalizer("zhibaAsk", function(g){
  if(g.pending && g.pending.type==='zhibaAsk'){
    const d=g.pending,lord=g.players[d.lordSeat],challenger=g.players[d.challengerSeat];
    const invalid=!Number.isInteger(d.lordSeat) || !Number.isInteger(d.challengerSeat) || d.lordSeat===d.challengerSeat ||
      !lord || !lord.alive || lord.role!=='zhu' || !hasCap(lord,'zhiba') ||
      !challenger || !challenger.alive || generalFaction(challenger)!=='wu' || g.gameMode!=='identity' ||
      !d.challengerCard || !d.resume || typeof d.resume!=='object' || typeof d.resume.phase!=='string';
    if(invalid){
    logPendingOrphan(g, 'A:normalize校验未通过,pending结构不合法(zhibaAsk)');
    if(d.challengerCard) g.discard.push(d.challengerCard);
    g.pending=null; g.phase='play';
    }
  }
});
registerStageNormalizer("zhibaGain", function(g){
  if(g.pending && g.pending.type==='zhibaGain'){
    const d=g.pending,lord=g.players[d.lordSeat];
    if(!Number.isInteger(d.lordSeat) || !lord || !lord.alive || lord.role!=='zhu' || !hasCap(lord,'zhiba') ||
       !Array.isArray(d.cards) || d.cards.length!==2 || d.cards.some(card=>!card)){
    logPendingOrphan(g, 'A:normalize校验未通过,pending结构不合法(zhibaGain)');
    if(Array.isArray(d.cards)) g.discard.push(...d.cards.filter(Boolean));
    g.pending=null; g.phase='play';
    }
  }
});
registerStageNormalizer(["yinghunTarget","yinghunChoice","yinghunDiscard"], function(g){
  if(g.pending && (g.pending.type==='yinghunTarget' || g.pending.type==='yinghunChoice' || g.pending.type==='yinghunDiscard')){
    const d=g.pending;
    const ownerSeat=d.type==='yinghunDiscard'?d.ownerSeat:d.seat;
    if(typeof ownerSeat!=='number' || !g.players[ownerSeat] || !g.players[ownerSeat].alive ||
       ((d.type==='yinghunChoice'||d.type==='yinghunDiscard') && (typeof d.targetSeat!=='number' || !g.players[d.targetSeat] || !g.players[d.targetSeat].alive))){
      logPendingOrphan(g, 'A:normalize校验未通过,pending结构不合法(yinghunTarget/yinghunChoice/yinghunDiscard)');
      g.pending=null;
      if(Number.isInteger(ownerSeat) && g.players[ownerSeat] && g.players[ownerSeat].alive && g.turn===ownerSeat &&
         typeof continueHuashenChangeCheckAtTurnStart==='function'){
        g.phase='play'; continueHuashenChangeCheckAtTurnStart(g,ownerSeat);
      }else g.phase='draw';
    }
  }
});
registerStageNormalizer("jiedaoChoice", function(g){
  if(g.pending && g.pending.type==='jiedaoChoice' && (typeof g.pending.from!=='number' || typeof g.pending.seatA!=='number' || typeof g.pending.seatB!=='number')){
    logPendingOrphan(g, 'B:normalize校验未通过,pending结构不合法(jiedaoChoice)');
    g.pending=null; g.phase='play';
  }
});
registerStageNormalizer("guhuoQuestion", function(g){
  if(g.pending && g.pending.type==='guhuoQuestion'){
    const d=g.pending;
    if(!Array.isArray(d.questioners)) d.questioners=[];
    if(!Array.isArray(d.answered)) d.answered=[];
    if(typeof d.sourceSeat!=='number' || typeof d.asking!=='number' ||
       !g.players[d.sourceSeat] || !g.players[d.sourceSeat].alive ||
       !g.players[d.asking] || !g.players[d.asking].alive ||
       !d.actualCard || !d.claimedCard || typeof d.claimedCard.name!=='string'){
      logPendingOrphan(g, 'A:normalize校验未通过,pending结构不合法(guhuoQuestion)');
      g.pending=null; g.phase='play';
    }
  }
});
registerStageNormalizer("guhuoTarget", function(g){
  if(g.pending && g.pending.type==='guhuoTarget'){
    const d=g.pending;
    if(typeof d.sourceSeat!=='number' || !g.players[d.sourceSeat] || !g.players[d.sourceSeat].alive ||
       !d.actualCard || !d.claimedCard || typeof d.claimedCard.name!=='string'){
      logPendingOrphan(g, 'A:normalize校验未通过,pending结构不合法(guhuoTarget)');
      g.pending=null; g.phase='play';
    }
  }
});
registerStageNormalizer("wugu", function(g){
  if(g.pending && g.pending.type==='wugu'){
    g.pending.pool = g.pending.pool || [];
    g.pending.order = g.pending.order || [];
    if(typeof g.pending.from!=='number' || typeof g.pending.idx!=='number' || g.pending.order.length===0){
      logPendingOrphan(g, 'A:normalize校验未通过,pending结构不合法(wugu)');
      g.pending=null; g.phase='play';
    }
  }
});
registerStageNormalizer("huogongReveal", function(g){
  if(g.pending && g.pending.type==='huogongReveal'){
    const d=g.pending;
    if(typeof d.from!=='number' || typeof d.to!=='number' || !g.players[d.from] || !g.players[d.to] || !g.players[d.from].alive || !g.players[d.to].alive){
      logPendingOrphan(g, 'B:normalize校验未通过,pending结构不合法(huogongReveal)');
      g.pending=null; g.phase='play';
    }
  }
});
registerStageNormalizer("huogong", function(g){
  if(g.pending && g.pending.type==='huogong'){
    const d=g.pending;
    if(typeof d.from!=='number' || typeof d.to!=='number' || !d.suit || !g.players[d.from] || !g.players[d.to] || !g.players[d.from].alive || !g.players[d.to].alive){
      logPendingOrphan(g, 'B:normalize校验未通过,pending结构不合法(huogong)');
      g.pending=null; g.phase='play';
    }
  }
});
registerStageNormalizer("aoeResp", function(g){
  if(g.pending && g.pending.type==='aoeResp'){
    const d=g.pending;
    if(typeof d.from!=='number' || typeof d.to!=='number' || !g.players[d.from] || !g.players[d.to] || !g.players[d.from].alive || !g.players[d.to].alive){
      logPendingOrphan(g, 'B:normalize校验未通过,pending结构不合法(aoeResp)');
      g.pending=null; g.aoe=null; g.phase='play';
    }
  }
});
registerStageNormalizer("duel", function(g){
  if(g.pending && g.pending.type==='duel'){
    const d=g.pending;
    if(typeof d.from!=='number' || typeof d.to!=='number' || typeof d.active!=='number'
       || !g.players[d.from] || !g.players[d.to] || !g.players[d.active]
       || !g.players[d.from].alive || !g.players[d.to].alive || !g.players[d.active].alive){
      logPendingOrphan(g, 'B:normalize校验未通过,pending结构不合法(duel)');
      g.pending=null; g.phase='play';
    }
  }
});
registerStageNormalizer("ganglieChoice", function(g){
  if(g.pending && g.pending.type==='ganglieChoice'){
    const d=g.pending;
    if(typeof d.seat!=='number' || typeof d.sourceSeat!=='number' || !g.players[d.seat] || !g.players[d.sourceSeat] || !g.players[d.seat].alive || !g.players[d.sourceSeat].alive){
      logPendingOrphan(g, 'B:normalize校验未通过,pending结构不合法(ganglieChoice)');
      g.pending=null; g.phase='play';
    }
  }
});
registerStageNormalizer("guanshi", function(g){
  if(g.pending && g.pending.type==='guanshi'){
    const d=g.pending;
    if(typeof d.from!=='number' || typeof d.to!=='number' || !g.players[d.from] || !g.players[d.to] || !g.players[d.from].alive || !g.players[d.to].alive){
      logPendingOrphan(g, 'B:normalize校验未通过,pending结构不合法(guanshi)');
      g.pending=null; g.phase='play';
    }
  }
});
registerStageNormalizer("hanbing", function(g){
  if(g.pending && g.pending.type==='hanbing'){
    const d=g.pending;
    if(typeof d.from!=='number' || typeof d.to!=='number' || !g.players[d.from] || !g.players[d.to] || !g.players[d.from].alive || !g.players[d.to].alive){
      logPendingOrphan(g, 'B:normalize校验未通过,pending结构不合法(hanbing)');
      g.pending=null; g.phase='play';
    }
  }
});
registerStageNormalizer("hanbingAsk", function(g){
  if(g.pending && g.pending.type==='hanbingAsk'){
    const d=g.pending;
    if(typeof d.from!=='number' || typeof d.to!=='number' || !g.players[d.from] || !g.players[d.to] || !g.players[d.from].alive || !g.players[d.to].alive){
      logPendingOrphan(g, 'B:normalize校验未通过,pending结构不合法(hanbingAsk)');
      g.pending=null; g.phase='play';
    }
  }
});
registerStageNormalizer("luoyiAsk", function(g){
  if(g.pending && g.pending.type==='luoyiAsk'){
    const d=g.pending;
    if(typeof d.seat!=='number' || d.seat!==g.turn || !g.players[d.seat] || !g.players[d.seat].alive){
      logPendingOrphan(g, 'B:normalize校验未通过,pending结构不合法(luoyiAsk)');
      g.pending=null; g.phase='draw';
    }
  }
});
registerStageNormalizer("qiaobianMove", function(g){
  if(g.pending && g.pending.type==='qiaobianMove'){
    const d=g.pending;
    if(typeof d.seat!=='number' || !g.players[d.seat] || !g.players[d.seat].alive){
      logPendingOrphan(g, 'B:normalize校验未通过,pending结构不合法(qiaobianMove)');
      g.pending=null; g.phase='play';
    }
  }
});
registerStageNormalizer("qiaobianTurnStart", function(g){
  if(g.pending && g.pending.type==='qiaobianTurnStart'){
    const d=g.pending;
    if(typeof d.seat!=='number' || !g.players[d.seat] || !g.players[d.seat].alive){
      logPendingOrphan(g, 'B:normalize校验未通过,pending结构不合法(qiaobianTurnStart)');
      g.pending=null; g.phase='draw';
    }
  }
});
registerStageNormalizer(["huashenChangeAskStart","huashenChangePickStart"], function(g){
  if(g.pending && (g.pending.type==='huashenChangeAskStart' || g.pending.type==='huashenChangePickStart')){
    const d=g.pending;
    const p=g.players[d.seat];
    if(typeof d.seat!=='number' || !p || !p.alive || p.huashenGeneral===null){
      logPendingOrphan(g, 'A:normalize校验未通过,pending结构不合法(huashenChangeAskStart/huashenChangePickStart)');
      g.pending=null; g.phase='draw';
    }
  }
});
registerStageNormalizer("qilin", function(g){
  if(g.pending && g.pending.type==='qilin'){
    const d=g.pending;
    if(typeof d.from!=='number' || typeof d.to!=='number' || !g.players[d.from] || !g.players[d.to] || !g.players[d.from].alive || !g.players[d.to].alive){
      logPendingOrphan(g, 'B:normalize校验未通过,pending结构不合法(qilin)');
      g.pending=null; g.phase='play';
    }
  }
});
registerStageNormalizer("qinglong", function(g){
  if(g.pending && g.pending.type==='qinglong'){
    const d=g.pending;
    if(typeof d.from!=='number' || typeof d.to!=='number' || !g.players[d.from] || !g.players[d.to] || !g.players[d.from].alive || !g.players[d.to].alive){
      logPendingOrphan(g, 'B:normalize校验未通过,pending结构不合法(qinglong)');
      g.pending=null; g.phase='play';
    }
  }
});
registerStageNormalizer(["cixiongAsk","cixiongChoice"], function(g){
  if(g.pending && (g.pending.type==='cixiongAsk' || g.pending.type==='cixiongChoice')){
    const d=g.pending;
    if(typeof d.from!=='number' || typeof d.to!=='number' || !g.players[d.from] || !g.players[d.to] || !g.players[d.from].alive || !g.players[d.to].alive){
      logPendingOrphan(g, 'B:normalize校验未通过,pending结构不合法(cixiongAsk/cixiongChoice)');
      g.pending=null; g.phase='play';
    }
  }
});
registerStageNormalizer("shuangxiongAsk", function(g){
  if(g.pending && g.pending.type==='shuangxiongAsk'){
    const d=g.pending;
    if(typeof d.seat!=='number' || d.seat!==g.turn || !g.players[d.seat] || !g.players[d.seat].alive){
      logPendingOrphan(g, 'B:normalize校验未通过,pending结构不合法(shuangxiongAsk)');
      g.pending=null; g.phase='draw';
    }
  }
});
registerStageNormalizer("guanxingReview", function(g){
  if(g.pending && g.pending.type==='guanxingReview'){
    const gp=g.pending.seat;
    if(typeof gp!=='number' || !g.players[gp] || !g.players[gp].alive || !Array.isArray(g.pending.cards)){
      logPendingOrphan(g, 'B:normalize校验未通过,pending结构不合法(guanxingReview)');
      g.pending=null; g.phase='play';
    }
  }
});
registerStageNormalizer("xunxunPick", function(g){
  if(g.pending && g.pending.type==='xunxunPick'){
    const d = g.pending;
    if(typeof d.seat!=='number' || !g.players[d.seat] || !g.players[d.seat].alive 
       || !Array.isArray(d.cards) || d.cards.length===0 
       || !Number.isInteger(d.takeN) || d.takeN<=0 || d.takeN>d.cards.length){
      logPendingOrphan(g, 'A:normalize校验未通过,pending结构不合法(xunxunPick)');
      g.pending=null; g.phase='play';
    }
  }
});
registerStageNormalizer("shensuChoose1", function(g){
  if(g.pending && g.pending.type==="shensuChoose1"){
    const d = g.pending;
    if(typeof d.seat!=="number" || !g.players[d.seat] || !g.players[d.seat].alive){
      logPendingOrphan(g, 'B:normalize校验未通过,pending结构不合法(shensuChoose1)');
      g.pending = null; g.phase = "judge";
    }
  }
});
registerStageNormalizer("shensuChoose2", function(g){
  if(g.pending && g.pending.type==="shensuChoose2"){
    const d = g.pending;
    if(typeof d.seat!=="number" || !g.players[d.seat] || !g.players[d.seat].alive){
      logPendingOrphan(g, 'B:normalize校验未通过,pending结构不合法(shensuChoose2)');
      g.pending = null; g.phase = "play";
    }
  }
});
registerStageNormalizer("shensuSha", function(g){
  if(g.pending && g.pending.type==="shensuSha"){
    const d = g.pending;
    if(typeof d.seat!=="number" || !g.players[d.seat] || !g.players[d.seat].alive ||
       typeof d.remaining!=="number" || d.remaining <= 0 ||
       typeof d.noDistance!=="boolean"){
      logPendingOrphan(g, 'A:normalize校验未通过,pending结构不合法(shensuSha)');
      g.pending = null;
      g.phase = g.shensuSkipJudgingAndDraw ? "play" : (g.shensuSkipPlay ? "discard" : "play");
    }
  }
});
registerStageNormalizer("shensuShaRespond", function(g){
  if(g.pending && g.pending.type==="shensuShaRespond"){
    const d = g.pending;
    if(typeof d.sourceSeat!=="number" || typeof d.targetSeat!=="number" ||
       !g.players[d.sourceSeat] || !g.players[d.sourceSeat].alive ||
       !g.players[d.targetSeat] || !g.players[d.targetSeat].alive ||
       typeof d.needed!=="number" || typeof d.played!=="number"){
      logPendingOrphan(g, 'A:normalize校验未通过,pending结构不合法(shensuShaRespond)');
      g.pending = null; g.phase = "play";
    }
  }
});
registerStageNormalizer("quhuRespond", function(g){
  if(g.pending && g.pending.type==='quhuRespond'){
    const d=g.pending;
    if(typeof d.seat!=='number' || typeof d.targetSeat!=='number' || !d.selfCard || !g.players[d.seat] || !g.players[d.targetSeat]){
      logPendingOrphan(g, 'A:normalize校验未通过,pending结构不合法(quhuRespond)');
      g.pending=null; g.phase='play';
    }
  }
});
registerStageNormalizer("quhuDamageChoice", function(g){
  if(g.pending && g.pending.type==='quhuDamageChoice'){
    const d=g.pending;
    if(typeof d.seat!=='number' || typeof d.targetSeat!=='number' || !Array.isArray(d.targets) || d.targets.length===0
       || !g.players[d.seat] || !g.players[d.targetSeat] || !d.targets.every(t=>Number.isInteger(t) && g.players[t] && g.players[t].alive)){
      logPendingOrphan(g, 'A:normalize校验未通过,pending结构不合法(quhuDamageChoice)');
      g.pending=null; g.phase='play';
    }
  }
});
registerStageNormalizer(["tianyiPickCard","tianyiPickTarget"], function(g){
  if(g.pending && (g.pending.type==='tianyiPickCard' || g.pending.type==='tianyiPickTarget')){
    const d = g.pending;
    if(typeof d.seat!=='number' || !g.players[d.seat] || !g.players[d.seat].alive){
      logPendingOrphan(g, 'B:normalize校验未通过,pending结构不合法(tianyiPickCard/tianyiPickTarget)');
      g.pending = null; g.phase = 'play';
    }
  }
});
registerStageNormalizer("tianyiRespond", function(g){
  if(g.pending && g.pending.type==='tianyiRespond'){
    const d = g.pending;
    if(typeof d.seat!=='number' || !g.players[d.seat] || !g.players[d.seat].alive ||
       typeof d.targetSeat!=='number' || !g.players[d.targetSeat] || !g.players[d.targetSeat].alive ||
       !d.selfCard || typeof d.selfCard.rank!=='number'){
      logPendingOrphan(g, 'A:normalize校验未通过,pending结构不合法(tianyiRespond)');
      g.pending = null; g.phase = 'play';
    }
  }
});
registerStageNormalizer("buquAsk", function(g){
  if(g.pending && g.pending.type==='buquAsk'){
    const d = g.pending;
    if(typeof d.seat!=='number' || !g.players[d.seat] || !g.players[d.seat].alive){
      logPendingOrphan(g, 'B:normalize校验未通过,pending结构不合法(buquAsk)');
      g.pending = null; g.phase = 'play';
    } else if(!Number.isInteger(d.remaining) || d.remaining < 1) {
      // remaining 是"这次伤害还需连续询问几次"的计数器,旧存档/防御性回退默认1次
      // (等价于改动前"只问一次"的行为,不影响单点伤害场景)。
      d.remaining = 1;
    }
  }
});
registerStageNormalizer("lianyingAsk", function(g){
  if(g.pending && g.pending.type==='lianyingAsk'){
    const d = g.pending;
    if(typeof d.seat!=='number' || !g.players[d.seat] || !g.players[d.seat].alive){
      logPendingOrphan(g, 'B:normalize校验未通过,pending结构不合法(lianyingAsk)');
      g.pending = null; g.phase = 'play';
    }
  }
});
registerStageNormalizer("qiaomengChoose", function(g){
  if(g.pending && g.pending.type==='qiaomengChoose'){
    const d = g.pending;
    if(typeof d.sourceSeat!=='number' || !g.players[d.sourceSeat] || !g.players[d.sourceSeat].alive ||
       typeof d.targetSeat!=='number' || !g.players[d.targetSeat] || !g.players[d.targetSeat].alive ||
       d.shaColor !== 'black'){
      logPendingOrphan(g, 'A:normalize校验未通过,pending结构不合法(qiaomengChoose)');
      g.pending = null; g.phase = 'play';
    }
  }
});
registerStageNormalizer("qiaomengPickEquip", function(g){
  if(g.pending && g.pending.type==='qiaomengPickEquip'){
    const d = g.pending;
    if(typeof d.sourceSeat!=='number' || !g.players[d.sourceSeat] || !g.players[d.sourceSeat].alive ||
       typeof d.targetSeat!=='number' || !g.players[d.targetSeat] || !g.players[d.targetSeat].alive ||
       !Array.isArray(d.availableSlots) || d.availableSlots.length === 0 ||
       !g.players[d.targetSeat].equips || Object.keys(g.players[d.targetSeat].equips).length === 0){
      logPendingOrphan(g, 'A:normalize校验未通过,pending结构不合法(qiaomengPickEquip)');
      g.pending = null; g.phase = 'play';
    }
  }
});
registerStageNormalizer("fanjianSuit", function(g){
  if(g.pending && g.pending.type==='fanjianSuit'){
    const d=g.pending;
    if(typeof d.seat!=='number' || typeof d.targetSeat!=='number' || !g.players[d.seat] || !g.players[d.targetSeat]){
      logPendingOrphan(g, 'B:normalize校验未通过,pending结构不合法(fanjianSuit)');
      g.pending=null; g.phase='play';
    }
  }
});
registerStageNormalizer("jiemingAsk", function(g){
  if(g.pending && g.pending.type==='jiemingAsk'){
    const d=g.pending;
    if(typeof d.seat!=='number' || !Number.isInteger(d.remaining) || d.remaining<=0 || !g.players[d.seat] || !g.players[d.seat].alive){
      logPendingOrphan(g, 'A:normalize校验未通过,pending结构不合法(jiemingAsk)');
      g.pending=null; g.phase='play';
    }
  }
});
registerStageNormalizer("xinshengAsk", function(g){
  if(g.pending && g.pending.type==='xinshengAsk'){
    const d=g.pending;
    if(typeof d.seat!=='number' || !Number.isInteger(d.remaining) || d.remaining<=0 || !g.players[d.seat] || !g.players[d.seat].alive){
      logPendingOrphan(g, 'A:normalize校验未通过,pending结构不合法(xinshengAsk)');
      g.pending=null; g.phase='play';
    }
  }
});
registerStageNormalizer("liuli", function(g){
  if(g.pending && g.pending.type==='liuli'){
    const d=g.pending;
    if(typeof d.from!=='number' || typeof d.to!=='number' || !g.players[d.from] || !g.players[d.to]){
      logPendingOrphan(g, 'B:normalize校验未通过,pending结构不合法(liuli)');
      g.pending=null; g.phase='play';
    }
  }
});
registerStageNormalizer("tianxiang", function(g){
  if(g.pending && g.pending.type==='tianxiang'){
    const d=g.pending;
    if(typeof d.seat!=='number' || !g.players[d.seat] || !g.players[d.seat].alive || !Array.isArray(d.targets) || d.targets.length===0){
      logPendingOrphan(g, 'A:normalize校验未通过,pending结构不合法(tianxiang)');
      g.pending=null; g.phase='play';
    }
  }
});
registerStageNormalizer("biyue", function(g){
  if(g.pending && g.pending.type==='biyue'){
    const d=g.pending;
    if(typeof d.seat!=='number' || !g.players[d.seat] || !g.players[d.seat].alive){
      logPendingOrphan(g, 'B:normalize校验未通过,pending结构不合法(biyue)');
      g.pending=null; g.phase='discard';
    }
  }
});
registerStageNormalizer(["huashenChangeAskEnd","huashenChangePickEnd"], function(g){
  if(g.pending && (g.pending.type==='huashenChangeAskEnd' || g.pending.type==='huashenChangePickEnd')){
    const d=g.pending;
    const p=g.players[d.seat];
    if(typeof d.seat!=='number' || !p || !p.alive || p.huashenGeneral===null){
      logPendingOrphan(g, 'A:normalize校验未通过,pending结构不合法(huashenChangeAskEnd/huashenChangePickEnd)');
      g.pending=null; g.phase='discard';
    }
  }
});
registerStageNormalizer("lirangAsk", function(g){
  if(g.pending && g.pending.type==='lirangAsk'){
    const d=g.pending;
    if(typeof d.from!=='number' || typeof d.to!=='number' || !g.players[d.from] || !g.players[d.to] || !g.players[d.from].alive || !g.players[d.to].alive){
      logPendingOrphan(g, 'B:normalize校验未通过,pending结构不合法(lirangAsk)');
      g.pending=null; g.phase='draw';
    }
  }
});
registerStageNormalizer("lirangRecover", function(g){
  if(g.pending && g.pending.type==='lirangRecover'){
    const d=g.pending;
    if(typeof d.from!=='number' || typeof d.to!=='number' || !Array.isArray(d.cards) || !g.players[d.from] || !g.players[d.to]){
      logPendingOrphan(g, 'B:normalize校验未通过,pending结构不合法(lirangRecover)');
      g.pending=null; g.phase='discard';
    }
  }
});
registerStageNormalizer("zhengyi", function(g){
  if(g.pending && g.pending.type==='zhengyi'){
    const d=g.pending;
    if(typeof d.seat!=='number' || typeof d.asking!=='number' || !g.players[d.seat] || !g.players[d.asking] || !g.players[d.seat].alive || !g.players[d.asking].alive){
      logPendingOrphan(g, 'B:normalize校验未通过,pending结构不合法(zhengyi)');
      g.pending=null; g.phase='play';
    }
  }
});
registerStageNormalizer("haoshiPick", function(g){
  if(g.pending && g.pending.type==='haoshiPick'){
    const d=g.pending;
    if(typeof d.seat!=='number' || !g.players[d.seat] || !g.players[d.seat].alive ||
       !Array.isArray(d.candidates) || d.candidates.length===0 ||
       !Number.isInteger(d.half) || d.half<=0){
      logPendingOrphan(g, 'A:normalize校验未通过,pending结构不合法(haoshiPick)');
      g.pending=null; g.phase='play';
    }
  }
});
registerStageNormalizer("jushouChoose", function(g){
  if(g.pending && g.pending.type==='jushouChoose'){
    const d = g.pending;
    if(typeof d.seat!=='number' || !g.players[d.seat] || !g.players[d.seat].alive){
      logPendingOrphan(g, 'B:normalize校验未通过,pending结构不合法(jushouChoose)');
      g.pending = null;
      g.phase = 'end';
    }
  }
});
registerStageNormalizer(["jujianPickCard","jujianPickTarget","jujianChooseEffect"], function(g){
  if(g.pending && (g.pending.type==='jujianPickCard' || g.pending.type==='jujianPickTarget' || g.pending.type==='jujianChooseEffect')){
    const d = g.pending;
    const srcOk = Number.isInteger(d.sourceSeat) && g.players[d.sourceSeat] && g.players[d.sourceSeat].alive;
    if(!srcOk){
      logPendingOrphan(g, 'B:normalize校验未通过,pending结构不合法(jujianPickCard/jujianPickTarget/jujianChooseEffect)');
      g.pending = null;
      if(String(g.phase||'').startsWith('jujian')) g.phase = 'discard';
    } else if(d.type==='jujianChooseEffect'){
      const tgtOk = Number.isInteger(d.targetSeat) && g.players[d.targetSeat] && g.players[d.targetSeat].alive;
      if(!tgtOk){
        logPendingOrphan(g, 'B:normalize校验未通过,pending结构不合法(jujianPickCard/jujianPickTarget/jujianChooseEffect)');
        g.pending = null;
        if(String(g.phase||'').startsWith('jujian')) g.phase = 'discard';
      }
    }
  }
});
registerStageNormalizer("jiangchiAsk", function(g){
  if(g.pending && g.pending.type==='jiangchiAsk'){
    const d = g.pending;
    if(!Number.isInteger(d.seat) || !g.players[d.seat] || !g.players[d.seat].alive){
      logPendingOrphan(g, 'B:normalize校验未通过,pending结构不合法(jiangchiAsk)');
      g.pending = null;
      if(g.phase==='jiangchiAsk') g.phase = 'draw';
    }
  }
});
registerStageNormalizer("luoyingAsk", function(g){
  if(g.pending && g.pending.type==='luoyingAsk'){
    const d = g.pending;
    if(!Number.isInteger(d.seat) || !g.players[d.seat] || !g.players[d.seat].alive ||
       !Array.isArray(d.cardIds)){
      logPendingOrphan(g, 'A:normalize校验未通过,pending结构不合法(luoyingAsk)');
      g.pending = null;
      if(g.phase==='luoyingAsk') g.phase = 'play';
    }
  }
});
registerStageNormalizer("jiushiFlipAsk", function(g){
  if(g.pending && g.pending.type==='jiushiFlipAsk'){
    const d = g.pending;
    if(!Number.isInteger(d.seat) || !g.players[d.seat] || !g.players[d.seat].alive ||
       typeof d.wasFacedown!=='boolean'){
      logPendingOrphan(g, 'A:normalize校验未通过,pending结构不合法(jiushiFlipAsk)');
      g.pending = null;
      if(g.phase==='jiushiFlipAsk') g.phase = 'play';
    }
  }
});
registerStageNormalizer("beigeChoose", function(g){
  if(g.pending && g.pending.type==='beigeChoose'){
    const d = g.pending;
    if(typeof d.sourceSeat!=='number' || !g.players[d.sourceSeat] || !g.players[d.sourceSeat].alive ||
       typeof d.damagedSeat!=='number' || !g.players[d.damagedSeat] || !g.players[d.damagedSeat].alive ||
       (d.damageSource !== null && typeof d.damageSource === 'number' && (!g.players[d.damageSource] || !g.players[d.damageSource].alive))){
      logPendingOrphan(g, 'B:normalize校验未通过,pending结构不合法(beigeChoose)');
      g.pending = null;
      g.phase = g.phase === 'beigeChoose' ? 'play' : g.phase;
    }
  }
});
registerStageNormalizer("beigeDiscard", function(g){
  if(g.pending && g.pending.type==='beigeDiscard'){
    const d = g.pending;
    if(typeof d.sourceSeat!=='number' || !g.players[d.sourceSeat] || !g.players[d.sourceSeat].alive ||
       typeof d.damagedSeat!=='number' || !g.players[d.damagedSeat] || !g.players[d.damagedSeat].alive ||
       (d.damageSource !== null && typeof d.damageSource === 'number' && (!g.players[d.damageSource] || !g.players[d.damageSource].alive))){
      logPendingOrphan(g, 'B:normalize校验未通过,pending结构不合法(beigeDiscard)');
      g.pending = null;
      g.phase = 'play';
    }
  }
});
registerStageNormalizer("beigeJudge", function(g){
  if(g.pending && g.pending.type==='beigeJudge'){
    const d = g.pending;
    if(typeof d.sourceSeat!=='number' || !g.players[d.sourceSeat] || !g.players[d.sourceSeat].alive ||
       typeof d.damagedSeat!=='number' || !g.players[d.damagedSeat] || !g.players[d.damagedSeat].alive ||
       !d.resume || typeof d.resume.kind!=='string'){
      logPendingOrphan(g, 'A:normalize校验未通过,pending结构不合法(beigeJudge)');
      g.pending = null;
      g.phase = 'play';
    }
  }
});
registerStageNormalizer("lieRenChoose", function(g){
  if(g.pending && g.pending.type==='lieRenChoose'){
    const d = g.pending;
    if(typeof d.sourceSeat!=='number' || !g.players[d.sourceSeat] || !g.players[d.sourceSeat].alive ||
       typeof d.targetSeat!=='number' || !g.players[d.targetSeat] || !g.players[d.targetSeat].alive){
      logPendingOrphan(g, 'B:normalize校验未通过,pending结构不合法(lieRenChoose)');
      g.pending = null;
      g.phase = 'play';
    }
  }
});
registerStageNormalizer("lieRenPickCard", function(g){
  if(g.pending && g.pending.type==='lieRenPickCard'){
    const d = g.pending;
    if(typeof d.sourceSeat!=='number' || !g.players[d.sourceSeat] || !g.players[d.sourceSeat].alive ||
       typeof d.targetSeat!=='number' || !g.players[d.targetSeat] || !g.players[d.targetSeat].alive){
      logPendingOrphan(g, 'B:normalize校验未通过,pending结构不合法(lieRenPickCard)');
      g.pending = null;
      g.phase = 'play';
    }
  }
});
registerStageNormalizer("lieRenRespond", function(g){
  if(g.pending && g.pending.type==='lieRenRespond'){
    const d = g.pending;
    if(typeof d.sourceSeat!=='number' || !g.players[d.sourceSeat] || !g.players[d.sourceSeat].alive ||
       typeof d.targetSeat!=='number' || !g.players[d.targetSeat] || !g.players[d.targetSeat].alive ||
       !d.sourceCard || typeof d.sourceCard.rank!=='number'){
      logPendingOrphan(g, 'A:normalize校验未通过,pending结构不合法(lieRenRespond)');
      g.pending = null;
      g.phase = 'play';
    }
  }
});
registerStageNormalizer("xuanfengPick", function(g){
  if(g.pending && g.pending.type==='xuanfengPick'){
    const d = g.pending;
    if(!Array.isArray(d.selections)) d.selections=[];
    // Firebase Realtime Database 不保留空数组。旋风刚触发、尚未选择目标时，targets 和
    // discardedCounts 都是 []，同步回来后字段会直接缺失；这属于合法初始状态，不能当成
    // 脏数据清掉 pending，否则真实联机局中旋风界面会在建立后立刻消失。
    if(d.targets===undefined || d.targets===null) d.targets=[];
    if(d.discardedCounts===undefined || d.discardedCounts===null) d.discardedCounts=[];
    if(typeof d.from!=='number' || !g.players[d.from] || !g.players[d.from].alive ||
       !Array.isArray(d.targets) ||
       !Array.isArray(d.discardedCounts) ||
       d.discardedCounts.length !== d.targets.length ||
       d.discardedCounts.some(c => typeof c !== 'number' || c < 0) ||
       typeof d.previousPhase !== 'string'){
      logPendingOrphan(g, 'A:normalize校验未通过,pending结构不合法(xuanfengPick)');
      g.pending = null;
      g.phase = d.previousPhase || (g.phase === 'xuanfengPick' ? 'discard' : g.phase);
    }
  }
});
registerStageNormalizer("duanbingChoose", function(g){
  if(g.pending && g.pending.type==='duanbingChoose'){
    const d = g.pending;
    if(typeof d.sourceSeat!=='number' || !g.players[d.sourceSeat] || !g.players[d.sourceSeat].alive ||
       typeof d.baseTarget!=='number' || !g.players[d.baseTarget] || !g.players[d.baseTarget].alive ||
       !Array.isArray(d.availableTargets) || d.availableTargets.length===0){
      logPendingOrphan(g, 'A:normalize校验未通过,pending结构不合法(duanbingChoose)');
      g.pending = null;
      g.phase = 'play';
    }
  }
});
registerStageNormalizer("enyuanChoose", function(g){
  if(g.pending && g.pending.type==='enyuanChoose'){
    const d = g.pending;
    if(typeof d.sourceSeat!=='number' || !g.players[d.sourceSeat] || !g.players[d.sourceSeat].alive ||
       typeof d.damagerSeat!=='number' || !g.players[d.damagerSeat] || !g.players[d.damagerSeat].alive){
      logPendingOrphan(g, 'B:normalize校验未通过,pending结构不合法(enyuanChoose)');
      g.pending = null;
      g.phase = 'play';
    }
  }
});
registerStageNormalizer("enyuanChooseOption", function(g){
  if(g.pending && g.pending.type==='enyuanChooseOption'){
    const d = g.pending;
    if(typeof d.sourceSeat!=='number' || !g.players[d.sourceSeat] || !g.players[d.sourceSeat].alive ||
       typeof d.damagerSeat!=='number' || !g.players[d.damagerSeat] || !g.players[d.damagerSeat].alive ||
       !Array.isArray(d.heartCards)){
      logPendingOrphan(g, 'A:normalize校验未通过,pending结构不合法(enyuanChooseOption)');
      g.pending = null;
      g.phase = 'play';
    }
  }
});
registerStageNormalizer("enyuanGiveCard", function(g){
  if(g.pending && g.pending.type==='enyuanGiveCard'){
    const d = g.pending;
    if(typeof d.sourceSeat!=='number' || !g.players[d.sourceSeat] || !g.players[d.sourceSeat].alive ||
       typeof d.damagerSeat!=='number' || !g.players[d.damagerSeat] || !g.players[d.damagerSeat].alive ||
       !(g.players[d.damagerSeat].hand||[]).some(card=>card && card.suit==='♥')){
      logPendingOrphan(g, 'A:normalize校验未通过,pending结构不合法(enyuanGiveCard)');
      g.pending = null;
      g.phase = 'play';
    }
  }
});
registerStageNormalizer("huanhuoPick", function(g){
  if(g.pending && g.pending.type==='huanhuoPick'){
    const d = g.pending;
    if(typeof d.sourceSeat!=='number' || !g.players[d.sourceSeat] || !g.players[d.sourceSeat].alive ||
       !Array.isArray(d.candidates) || d.candidates.length===0){
      logPendingOrphan(g, 'A:normalize校验未通过,pending结构不合法(huanhuoPick)');
      g.pending = null;
      g.phase = 'play';
    }
  }
});
registerStageNormalizer("huanhuoPickCard", function(g){
  if(g.pending && g.pending.type==='huanhuoPickCard'){
    const d = g.pending;
    if(typeof d.sourceSeat!=='number' || !g.players[d.sourceSeat] || !g.players[d.sourceSeat].alive ||
       typeof d.targetSeat!=='number' || !g.players[d.targetSeat] || !g.players[d.targetSeat].alive ||
       !(g.players[d.sourceSeat].hand||[]).some(card=>card && card.suit==='♥')){
      logPendingOrphan(g, 'A:normalize校验未通过,pending结构不合法(huanhuoPickCard)');
      g.pending = null;
      g.phase = 'play';
    }
  }
});
registerStageNormalizer("huanhuoPickGotCard", function(g){
  if(g.pending && g.pending.type==='huanhuoPickGotCard'){
    const d = g.pending;
    if(typeof d.sourceSeat!=='number' || !g.players[d.sourceSeat] || !g.players[d.sourceSeat].alive ||
       typeof d.targetSeat!=='number' || !g.players[d.targetSeat] || !g.players[d.targetSeat].alive ||
       ((g.players[d.targetSeat].hand||[]).length +
        EQUIP_SLOTS.filter(slot=>g.players[d.targetSeat].equips && g.players[d.targetSeat].equips[slot]).length)===0){
      logPendingOrphan(g, 'A:normalize校验未通过,pending结构不合法(huanhuoPickGotCard)');
      g.pending = null;
      g.phase = 'play';
    }
  }
});
registerStageNormalizer("huanhuoPickSecond", function(g){
  if(g.pending && g.pending.type==='huanhuoPickSecond'){
    const d = g.pending;
    if(typeof d.sourceSeat!=='number' || !g.players[d.sourceSeat] || !g.players[d.sourceSeat].alive ||
       typeof d.firstTargetSeat!=='number' || !g.players[d.firstTargetSeat] || !g.players[d.firstTargetSeat].alive ||
       typeof d.transferCard!=='object' || !d.transferCard ||
       !Array.isArray(d.candidates) || d.candidates.length===0){
      logPendingOrphan(g, 'A:normalize校验未通过,pending结构不合法(huanhuoPickSecond)');
      g.pending = null;
      g.phase = 'play';
    }
  }
});
registerStageNormalizer("fenxunDiscard", function(g){
  if(g.pending && g.pending.type==='fenxunDiscard'){
    const d = g.pending;
    if(typeof d.seat!=='number' || !g.players[d.seat] || !g.players[d.seat].alive){
      logPendingOrphan(g, 'B:normalize校验未通过,pending结构不合法(fenxunDiscard)');
      g.pending = null;
      g.phase = 'play';
    }
  }
});
registerStageNormalizer("fenxunTarget", function(g){
  if(g.pending && g.pending.type==='fenxunTarget'){
    const d = g.pending;
    if(typeof d.seat!=='number' || !g.players[d.seat] || !g.players[d.seat].alive ||
       !Array.isArray(d.availableTargets) || d.availableTargets.length===0){
      logPendingOrphan(g, 'A:normalize校验未通过,pending结构不合法(fenxunTarget)');
      g.pending = null;
      g.phase = 'play';
    }
  }
});
registerStageNormalizer("chengxiangAsk", function(g){
  if(g.pending && g.pending.type==='chengxiangAsk'){
    const d = g.pending;
    if(typeof d.seat!=='number' || !g.players[d.seat] || !g.players[d.seat].alive ||
       typeof d.damageInfo!=='object' || d.damageInfo === null){
      logPendingOrphan(g, 'A:normalize校验未通过,pending结构不合法(chengxiangAsk)');
      g.pending = null;
      g.phase = 'play';
    }
  }
});
registerStageNormalizer("chengxiangChoose", function(g){
  if(g.pending && g.pending.type==='chengxiangChoose'){
    const d = g.pending;
    if(typeof d.seat!=='number' || !g.players[d.seat] || !g.players[d.seat].alive ||
       !Array.isArray(d.revealedCards) || d.revealedCards.length === 0 ||
       !Array.isArray(d.selectable) || !Number.isInteger(d.sumLimit) || d.sumLimit <= 0){
      logPendingOrphan(g, 'A:normalize校验未通过,pending结构不合法(chengxiangChoose)');
      g.pending = null;
      g.phase = 'play';
    }
  }
});
registerStageNormalizer("renxinChoose", function(g){
  if(g.pending && g.pending.type==='renxinChoose'){
    const d = g.pending;
    if(typeof d.seat!=='number' || !g.players[d.seat] || !g.players[d.seat].alive ||
       typeof d.target!=='number' || !g.players[d.target] || !g.players[d.target].alive ||
       g.players[d.target].hp > 1 ||
       !Array.isArray(d.equipSlots) || d.equipSlots.length === 0 ||
       typeof d.originalDamageInfo!=='object' || d.originalDamageInfo===null){
      logPendingOrphan(g, 'A:normalize校验未通过,pending结构不合法(renxinChoose)');
      g.pending = null;
      g.phase = 'play';
    }
  }
});

function registerStageTimeoutAction(types, factory){
  (Array.isArray(types)?types:[types]).forEach(function(type){
    const spec=STAGE_TABLE[type]||registerStage(type,{});
    if(typeof spec.timeoutAction!=='function') registerStage(type,{timeoutAction:factory});
  });
}
registerStageTimeoutAction("wuxiePublicWait", function(g){ return function(){ finishWuxiePublicWait(); }; });
registerStageTimeoutAction("respond", function(g){ return function(){ respondShan(false); }; });
registerStageTimeoutAction("aoeResp", function(g){ return function(){ aoeRespond(false); }; });
registerStageTimeoutAction("duel", function(g){ return function(){ duelResponse(false); }; });
registerStageTimeoutAction("dying", function(g){ return function(){ respondDying(false); }; });
registerStageTimeoutAction("wuxie", function(g){ return function(){ respondWuxie(false); }; });
registerStageTimeoutAction("pick", function(g){ return function(){                                          // 顺手/拆桥:固定选首个合法对象
    const target=g.players[g.pending.to];
    if(target&&(target.hand||[]).length) pickResolve('hand');
    else{
      const slot=target&&target.equips&&EQUIP_SLOTS.find(function(s){return target.equips[s];});
      if(slot) pickResolve(slot);
      else if(target&&(target.delays||[]).length) pickResolve('delay:0');
    }
  }; });
registerStageTimeoutAction("guicai", function(g){ return function(){ respondGuicai(false); }; });
registerStageTimeoutAction("jiedaoChoice", function(g){ return function(){ respondJiedao(false); }; });
registerStageTimeoutAction("ganglieChoice", function(g){ return function(){ respondGanglieChoice('damage',[]); }; });
registerStageTimeoutAction("guhuoQuestion", function(g){ return function(){ respondGuhuoQuestion(false); }; });
registerStageTimeoutAction("xiaoguo", function(g){ return function(){ respondXiaoguo(false); }; });
registerStageTimeoutAction("xiaoguoChoice", function(g){ return function(){ respondXiaoguoChoice('damage'); }; });
registerStageTimeoutAction("lirangAsk", function(g){ return function(){ respondLiRang(false,[]); }; });
registerStageTimeoutAction("lirangRecover", function(g){ return function(){ respondLiRangRecover(false); }; });
registerStageTimeoutAction("zhengyi", function(g){ return function(){ respondZhengyi(false); }; });
registerStageTimeoutAction("tianxiang", function(g){ return function(){ respondTianxiang(null,null); }; });
registerStageTimeoutAction("liuli", function(g){ return function(){ respondLiuli(null,null); }; });
registerStageTimeoutAction("quhuRespond", function(g){ return function(){ respondQuhu(0); }; });
registerStageTimeoutAction("fanjianSuit", function(g){ return function(){ respondFanjianSuit(SUITS[Math.floor(Math.random()*SUITS.length)]); }; });
registerStageTimeoutAction("huogong", function(g){ return function(){ respondHuogong(false); }; });
registerStageTimeoutAction("huogongReveal", function(g){ return function(){ respondHuogongReveal(0); }; });
registerStageTimeoutAction("jijiangAsk", function(g){ return function(){ respondJijiangAsk(false); }; });
registerStageTimeoutAction("hujiaAsk", function(g){ return function(){ respondHujiaAsk(false); }; });
registerStageTimeoutAction("zhibaAsk", function(g){ return function(){ respondZhiba(0); }; });
registerStageTimeoutAction("zhibaGain", function(g){ return function(){ respondZhibaGain(true); }; });
registerStageTimeoutAction("yinghunTarget", function(g){ return function(){ cancelYinghun(); }; });
registerStageTimeoutAction("yinghunChoice", function(g){ return function(){ respondYinghunChoice('drawX'); }; });
registerStageTimeoutAction("yinghunDiscard", function(g){ return function(){ const p=g.players[g.pending.targetSeat],slot=EQUIP_SLOTS.find(function(s){return p.equips&&p.equips[s];}); discardYinghunCard((p.hand||[]).length?0:{kind:'equip',slot:slot}); }; });
registerStageTimeoutAction("huashenChangeAskStart", function(g){ return function(){ respondHuashenChangeAskStart(false); }; });
registerStageTimeoutAction("huashenChangeAskEnd", function(g){ return function(){ respondHuashenChangeAskEnd(false); }; });
registerStageTimeoutAction("huashenChangePickStart", function(g){ return function(){
    const me = g.players[g.pending.seat];
    const generalId = me && (me.huashenPool||[]).find(function(id){ return (HUASHEN_SKILL_TABLE[id]||[]).length; });
    if(!generalId){ abandonHuashenChangePickStart(); return; }
    const entry = (HUASHEN_SKILL_TABLE[generalId]||[])[0];
    respondHuashenChangePickStart(generalId, entry && entry.name);
  }; });
registerStageTimeoutAction("huashenChangePickEnd", function(g){ return function(){
    const me = g.players[g.pending.seat];
    const generalId = me && (me.huashenPool||[]).find(function(id){ return (HUASHEN_SKILL_TABLE[id]||[]).length; });
    if(!generalId){ abandonHuashenChangePickEnd(); return; }
    const entry = (HUASHEN_SKILL_TABLE[generalId]||[])[0];
    respondHuashenChangePickEnd(generalId, entry && entry.name);
  }; });
registerStageTimeoutAction("yijiAsk", function(g){ return function(){ respondYijiAsk(false); }; });
registerStageTimeoutAction("ganglieAsk", function(g){ return function(){ respondGanglieAsk(false); }; });
registerStageTimeoutAction("guiduAsk", function(g){ return function(){ cancelGuidu(); }; });
registerStageTimeoutAction("jiangchiAsk", function(g){ return function(){ respondJiangchi('none'); }; });
registerStageTimeoutAction("zhijiChoice", function(g){ return function(){ respondZhijiChoice(true); }; });
registerStageTimeoutAction("tiaoxinChoice", function(g){ return function(){ respondTiaoxinChoice(false); }; });
registerStageTimeoutAction("huanhuoPick", function(g){ return function(){
    const target=(g.pending.candidates||[])[0];
    if(typeof target==='number') pickHuanhuoTarget(target); else cancelHuanhuo();
  }; });
registerStageTimeoutAction("huanhuoPickCard", function(g){ return function(){
    const me=g.players[g.pending.sourceSeat];
    const idx=(me&&me.hand||[]).findIndex(function(c){ return c&&c.suit==='♥'; });
    if(idx>=0) pickHuanhuoHeartCard(idx); else cancelHuanhuo();
  }; });
registerStageTimeoutAction("huanhuoPickGotCard", function(g){ return function(){
    const target=g.players[g.pending.targetSeat];
    const slot=target&&target.equips&&EQUIP_SLOTS.find(function(s){ return target.equips[s]; });
    if(slot) pickHuanhuoGotCard('equip',slot);
    else if(target&&(target.hand||[]).length>0) pickHuanhuoGotCard('hand',null);
  }; });
registerStageTimeoutAction("huanhuoPickSecond", function(g){ return function(){
    const target=(g.pending.candidates||[])[0];
    if(typeof target==='number') pickHuanhuoSecondTarget(target);
  }; });
registerStageTimeoutAction("lieRenChoose", function(g){ return function(){ cancelLieRen(); }; });
registerStageTimeoutAction("lieRenPickCard", function(g){ return function(){
    const me=g.players[g.pending.sourceSeat];
    if(me && (me.hand||[]).length>0) pickLieRenCard(0);
    else cancelLieRen();
  }; });
registerStageTimeoutAction("shensuChoose1", function(g){ return function(){ skipShensu1(); }; });
registerStageTimeoutAction("shensuChoose2", function(g){ return function(){ skipShensu2(); }; });
registerStageTimeoutAction("qiaobianTurnStart", function(g){ return function(){ qiaobianDecline(); }; });
registerStageTimeoutAction("duanbingChoose", function(g){ return function(){ cancelDuanbing(); }; });
registerStageTimeoutAction("mingcePickCard", function(g){ return function(){ cancelMingce(); }; });
registerStageTimeoutAction("qiaomengChoose", function(g){ return function(){ cancelQiaomeng(); }; });
registerStageTimeoutAction("lianyingAsk", function(g){ return function(){ respondLianying(false); }; });
registerStageTimeoutAction("tieqi", function(g){ return function(){ respondTieqi(false); }; });
registerStageTimeoutAction("liegong", function(g){ return function(){ respondLiegong(false); }; });
registerStageTimeoutAction("qiangxiChooseCost", function(g){ return function(){ cancelQiangxi(); }; });
registerStageTimeoutAction("qiangxiChooseWeaponFromHand", function(g){ return function(){ cancelQiangxi(); }; });
registerStageTimeoutAction("qiangxiPickTarget", function(g){ return function(){
    const target=(g.pending.candidates||[])[0];
    if(typeof target==='number') pickQiangxiTarget(target);
  }; });
registerStageTimeoutAction(["luanjiChoose","luanjiConfirm"], function(g){ return function(){ cancelLuanji(); }; });
registerStageTimeoutAction("haoshiPick", function(g){ return function(){ const target=(g.pending.candidates||[])[0]; if(typeof target==='number') respondHaoshi(target); }; });
registerStageTimeoutAction("leijiChoose", function(g){ return function(){ cancelLeiji(); }; });
registerStageTimeoutAction("leijiJudge", function(g){ return function(){ doLeijiJudge(); }; });
registerStageTimeoutAction("mengjin", function(g){ return function(){ const choice=(g.pending.available||[])[0]; if(choice) mengjinPick(choice); }; });
registerStageTimeoutAction("mingcePickTarget", function(g){ return function(){ cancelMingce(); }; });
registerStageTimeoutAction("mingcePickTarget2", function(g){ return function(){ cancelMingce(); }; });
registerStageTimeoutAction("mingceChoice", function(g){ return function(){ chooseMingceOption('draw'); }; });
registerStageTimeoutAction("qiaobianMove", function(g){ return function(){ respondQiaobianMove(null); }; });
registerStageTimeoutAction("enyuanChoose", function(g){ return function(){ triggerEnyuan(); }; });
registerStageTimeoutAction("jiushiFlipAsk", function(g){ return function(){ respondJiushiFlip(false); }; });
registerStageTimeoutAction("wangxiAsk", function(g){ return function(){ respondWangxi(false); }; });
registerStageTimeoutAction("buquAsk", function(g){ return function(){ respondBuqu(true); }; });
registerStageTimeoutAction("luanwuChoose", function(g){ return function(){ chooseLuanwuOption('hp'); }; });
registerStageTimeoutAction("wugu", function(g){ return function(){ const d=g.pending,card=(d.pool||[])[0]; if(card) wuguPick(0,d.idx,card.id); }; });
registerStageTimeoutAction("hanbingAsk", function(g){ return function(){ respondHanbingAsk(false); }; });
registerStageTimeoutAction("jujianPickCard", function(g){ return function(){ cancelJujian(); }; });
registerStageTimeoutAction("jushouChoose", function(g){ return function(){ cancelJushou(); }; });
registerStageTimeoutAction("shuangxiongAsk", function(g){ return function(){ respondShuangxiong(false); }; });
registerStageTimeoutAction("luoyiAsk", function(g){ return function(){ respondLuoyi(false); }; });
registerStageTimeoutAction("xunxunPick", function(g){ return function(){ const d=g.pending,all=(d.cards||[]).map(function(_,i){return i;}),take=d.takeN||2; respondXunxun(all.slice(0,take),all.slice(take)); }; });
registerStageTimeoutAction("enyuanChooseOption", function(g){ return function(){ chooseEnyuanOption('giveCard'); }; });
registerStageTimeoutAction("enyuanGiveCard", function(g){ return function(){ const p=g.players[g.pending.damagerSeat],idx=(p&&p.hand||[]).findIndex(function(c){return c&&c.suit==='♥';}); if(idx>=0) giveEnyuanCard(idx); }; });
registerStageTimeoutAction("guhuoTarget", function(g){ return function(){ cancelGuhuoTarget(); }; });
registerStageTimeoutAction("guanxingReview", function(g){ return function(){ const all=(g.pending.cards||[]).map(function(_,i){return i;}); respondGuanxing(all,[]); }; });
registerStageTimeoutAction("quhuDamageChoice", function(g){ return function(){ const target=(g.pending.targets||[])[0]; if(typeof target==='number') respondQuhuDamage(target); }; });
registerStageTimeoutAction("tianyiRespond", function(g){ return function(){ respondTianyi(0); }; });
registerStageTimeoutAction("jiemingAsk", function(g){ return function(){ respondJieming(null); }; });
registerStageTimeoutAction("xinshengAsk", function(g){ return function(){ respondXinshengAsk(false); }; });
registerStageTimeoutAction("yijiAssign", function(g){ return function(){ respondYijiAssign((g.pending.cards||[]).map(function(){return g.pending.seat;})); }; });
registerStageTimeoutAction("tiaoxinDiscard", function(g){ return function(){ const target=g.players[g.pending.to],opt=target&&tiaoxinDiscardOptions(target)[0]; if(opt) pickTiaoxinDiscard(opt.kind,opt.kind==='hand'?opt.idx:opt.slot); }; });
registerStageTimeoutAction("qiaomengPickEquip", function(g){ return function(){ const slot=(g.pending.availableSlots||[])[0]; if(slot) pickQiaomengEquip(slot); }; });
registerStageTimeoutAction("lieRenRespond", function(g){ return function(){ respondLieRen(0); }; });
registerStageTimeoutAction("jujianPickTarget", function(g){ return function(){ const target=(g.pending.candidates||[])[0]; if(typeof target==='number') respondJujianPickTarget(target); else cancelJujian(); }; });
registerStageTimeoutAction("jujianChooseEffect", function(g){ return function(){ respondJujianEffect('draw'); }; });
registerStageTimeoutAction("luoyingAsk", function(g){ return function(){ respondLuoying(false); }; });
registerStageTimeoutAction("cixiongAsk", function(g){ return function(){ respondCixiongAsk(false); }; });
registerStageTimeoutAction("chengxiangAsk", function(g){ return function(){ cancelChengxiangAsk(); }; });
registerStageTimeoutAction("chengxiangChoose", function(g){ return function(){ cancelChengxiang(); }; });
registerStageTimeoutAction("renxinChoose", function(g){ return function(){ cancelRenxin(); }; });
registerStageTimeoutAction("xuanfengPick", function(g){ return function(){ cancelXuanfeng(); }; });
registerStageTimeoutAction("beigeChoose", function(g){ return function(){ triggerBeige(false); }; });
registerStageTimeoutAction("beigeDiscard", function(g){ return function(){ const p=g.players[g.pending.sourceSeat],slot=p&&p.equips&&EQUIP_SLOTS.find(function(s){return p.equips[s];}); if(p&&(p.hand||[]).length) beigeDiscard(0,false,null); else if(slot) beigeDiscard(null,true,slot); }; });
registerStageTimeoutAction("beigeJudge", function(g){ return function(){ doBeigeJudge(); }; });
registerStageTimeoutAction(["tianyiPickCard","tianyiPickTarget"], function(g){ return function(){ cancelTianyi(); }; });
registerStageTimeoutAction("zhimengAsk", function(g){ return function(){ respondZhimeng(false); }; });
registerStageTimeoutAction("zhimengPick", function(g){ return function(){ const opt=(g.pending.options||[])[0]; if(opt) respondZhimengPick(opt.type,opt.index); }; });
registerStageTimeoutAction("biyue", function(g){ return function(){ respondBiyue(false); }; });
registerStageTimeoutAction("yaowu_choose", function(g){ return function(){ const p=g.players[g.pending.seat]; respondYaowu(p&&p.hp<p.maxHp?'recover':'draw'); }; });
registerStageTimeoutAction("shensuSha", function(g){ return function(){ cancelShensuSha(); }; });
registerStageTimeoutAction("shaOffsetChoice", function(g){ return function(){ respondShaOffsetChoice(null); }; });
registerStageTimeoutAction(["fenxunDiscard","fenxunTarget"], function(g){ return function(){ cancelFenxun(); }; });
