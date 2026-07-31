// render-hand.js — 手牌渲染层,从 render.js 拆分出来(纯重构第四步,行为零变化)。
// 只包含 attachLongPressPreview/renderHand 以及它们专属的字号自适应小工具
// (_fitCanvas/CARD_TITLE_FONT_FAMILY/fitFontSize/cardMetricsForViewport)。
// 排查确认:出牌确认弹窗(showConfirm/confirmAndPlay)、resolveActionId、以及那一整批
// 客户端选牌/选目标状态机(selectedCardIdx/zhangbaMode/duanliangMode/jiedaoSeatA/
// qiaobianMode 等~30个 *Mode/*Picks/*CardIdx 变量及其 reset* 函数)都被 renderControls
// (1101-2314行,一个独立的巨型函数)和/或 render() 的按阶段清理逻辑和/或 confirmAndPlay
// 的跨技能 cleanup 闭包共同读写,不是手牌专属,刻意留在 render.js,不搬到这里——
// 尤其是 guanxingTop/guanxingBottom/guanshiPicks/yijiPicks/gangliePicks/quhuMode/
// quhuCardIdx/qiaobianPhaseChoice/qiaobianSrc 这几个在 renderHand 里引用次数为0,
// 完全是 renderControls 独占,和手牌渲染无关。


// attachLongPressPreview: 手机端(触屏设备)长按放大预览,和桌面端鼠标悬停(index.html里
// @media (hover:hover) and (pointer:fine) 限定的 .card:hover)是两条独立的交互路径——桌面端
// 靠CSS伪类自动响应真实的悬停状态,手机端没有"悬停"这个交互状态,靠这里手动监听touch事件、
// 长按500ms后手动切换一个class(.long-press-preview)来复用同一套放大视觉效果(scale+
// translateY+box-shadow,见index.html的.card.long-press-preview规则)。两者互不干扰:桌面端
// 触屏模拟不出真悬停(见CLAUDE.md的hover:hover/pointer:fine限定),这里的touch监听器也不会
// 在桌面鼠标操作下触发(桌面浏览器点击不会派发touchstart)。
// 长按只是纯视觉预览,不进入任何游戏操作流程——不调用render(g)、不设置selectedCardIdx等
// 任何游戏状态,松手时如果触发过长按预览,阻止这次touchend继续变成click(不会误触发打牌);
// 如果手指按下后不到500ms就松开(正常点击),不做任何拦截,原有的点击打牌逻辑照常执行。
// renderHand每次游戏状态更新都会把整排手牌DOM销毁重建(h.innerHTML=''重新生成),旧的
// touch监听器随着旧DOM节点一起被丢弃,所以这个函数必须在每次renderHand为每张新生成的
// 卡片元素各自调用一次,不能只在页面加载时绑定一次。
function attachLongPressPreview(el, card){
  let pressTimer = null;
  let longPressTriggered = false;

  const start = (e)=>{
    longPressTriggered = false;
    pressTimer = setTimeout(()=>{
      longPressTriggered = true;
      el.classList.add('long-press-preview');
    }, 500);
  };
  const cancel = ()=>{
    clearTimeout(pressTimer);
    el.classList.remove('long-press-preview');
  };
  const end = (e)=>{
    clearTimeout(pressTimer);
    if(longPressTriggered){
      el.classList.remove('long-press-preview');
      e.preventDefault();
      e.stopPropagation();
    }
  };

  el.addEventListener('touchstart', start, {passive:true});
  el.addEventListener('touchend', end);
  el.addEventListener('touchcancel', cancel);
  el.addEventListener('touchmove', cancel);
}
function renderHand(g){
  const h=document.getElementById('hand'); h.innerHTML='';
  if(mySeat===null) return;
  const me=g.players[mySeat]; if(!me) return;
  const myTurn=g.turn===mySeat;
  // 自己的武将信息(技能名+描述);未开局或无将时留空
  const myGenEl=document.getElementById('myGeneral');
  const myGen=g.started?getGeneral(me.general):null;
  // 势力标识(第3步·3a):小色块+单字,和座位卡同一套视觉语言(.faction-* 配色、FACTION_LABEL
  // 单字),只是尺寸为文字行内联大小(不是卡片色块那种绝对定位)。generalFaction(me) 跟随左慈
  // 【化身】,和座位卡表现一致。用 g.started 门控(myGen 本身已经是这个条件),不会在选将阶段
  // 提前泄露。
  const myFactionKey = myGen ? generalFaction(me) : null;
  const myFactionChip = (myFactionKey && FACTION_LABEL[myFactionKey])
    ? '<span class="inline-faction faction-'+myFactionKey+'">'+FACTION_LABEL[myFactionKey]+'</span>'
    : '';
  myGenEl.innerHTML = myGen
    ? '你的武将：'+escapeHtml(myGen.name)+myFactionChip+' · '+escapeHtml(myGen.skill)+'<span style="color:var(--paper-dim)">（'+escapeHtml(myGen.desc)+'）</span>'
    : '';
  // 响应阶段"多候选可选"判断:这一轮渲染需要的角色(role)和候选数量在循环外算一次,不必每张
  // 手牌各自重算一遍。只有候选>1(真实牌+龙胆/武圣/倾国转化)才需要玩家先点选具体一张;候选
  // <=1时维持原有"手牌不可点、按钮直接生效"的简化体验,不强迫多点一步。
  // 五个响应场景共用这同一套状态(selectedResponseCardIdx)和交互,不各自另起一套:
  // respond(出闪)/aoeResp(南蛮万箭)/duel(决斗出杀)/jiedaoChoice(借刀杀人A出杀)/
  // tiaoxinChoice(挑衅目标出杀)。
  let respondRole = null, respondCandidateCount = 0;
  if(g.phase==='respond' && g.pending && g.pending.to===mySeat){
    respondRole = '闪';
    respondCandidateCount = (me.hand||[]).filter(c=>canUseAs(me,c,'闪')).length;
  } else if(g.phase==='aoeResp' && g.pending && g.pending.type==='aoeResp' && g.pending.to===mySeat && g.aoe){
    respondRole = g.pending.need;
    respondCandidateCount = (me.hand||[]).filter(c=>canUseAs(me,c,respondRole)).length;
  } else if(g.phase==='duel' && g.pending && g.pending.active===mySeat && !me.jiangchiNoSlash){
    // 曹彰【将驰】禁杀时服务端会拒绝,这里也不给点选(否则选了也没用)
    respondRole = '杀';
    respondCandidateCount = (me.hand||[]).filter(c=>canUseAs(me,c,'杀')).length;
  } else if(g.phase==='jiedaoChoice' && g.pending && g.pending.type==='jiedaoChoice' && g.pending.seatA===mySeat && !me.jiangchiNoSlash){
    respondRole = '杀';
    respondCandidateCount = (me.hand||[]).filter(c=>canUseAs(me,c,'杀')).length;
  } else if(g.phase==='tiaoxinChoice' && g.pending && g.pending.type==='tiaoxinChoice' && g.pending.to===mySeat && canReachSha(g, mySeat, g.pending.from)){
    // 挑衅:够不到挑衅者时这张杀根本用不出去(服务端同样要求 canReachSha),不给点选
    respondRole = '杀';
    respondCandidateCount = (me.hand||[]).filter(c=>canUseAs(me,c,'杀')).length;
  }
  (me.hand||[]).forEach((card,idx)=>{
    const el=document.createElement('div');
    const cls = isShaName(card.name)?'sha':card.name==='桃'?'tao':card.name==='闪'?'shan':card.name==='顺手牵羊'?'steal':'trick';
    // 过河拆桥沿用统一锦囊样式 trick
    const picked = zhangbaMode && zhangbaPicks.includes(idx);
    const duanliangPicked = duanliangMode && duanliangCardIdx===idx;
    const qixiPicked = qixiMode && qixiCardIdx===idx;
    const guosePicked = guoseMode && guoseCardIdx===idx;
    const lianhuanPicked = lianhuanMode && lianhuanCardIdx===idx;
    const lijianPicked = lijianMode && lijianCardIdx===idx;
    const lirangPicked = lirangPicks.includes(idx);
    const qingnangPicked = qingnangMode && qingnangCardIdx===idx;
    const zhihengPicked = zhihengMode && zhihengPicks.includes(idx);
    const qiaobianPicked = qiaobianMode==='choosePhase' && qiaobianCardIdx===idx;
    const discardPicked = discardSelectedSet.has(idx);
    const responsePicked = respondRole && selectedResponseCardIdx===idx;
    el.className='card '+cls+((selectedCardIdx===idx||picked||duanliangPicked||qixiPicked||guosePicked||lianhuanPicked||lijianPicked||lirangPicked||qingnangPicked||zhihengPicked||qiaobianPicked||discardPicked||responsePicked)?' selected':'')+(discardPicked?' discard-selected':'');
    // 卡片版式:顶部标题栏(牌名,代码生成文字,不依赖图片、始终显示)+ 下方插画区域(图片,
    // 有则铺满、没有则留一块占位底色)+ 左上角花色点数角标——更接近实体卡牌的分区观感,
    // 牌名不再像早期"图片铺满全卡"那版那样靠 no-art 来控制显示/隐藏。
    // .corner 相对整张卡片(.card)定位,top:0;left:0,和右上角"?"图标(.info-badge-hit)
    // 对角对齐;尺寸由 CSS 的 --badge 变量统一控制,不在这里处理(见 index.html)。
    // 只保留左上角一个角标,右下角(.corner.br)已删除——单个角标已经能完整传达花色点数
    // 信息,不需要两处重复。
    const imgSrc = cardImageSrc(card.name);
    const imgTag = imgSrc ? '<img class="card-art" src="'+imgSrc+'" onerror="cardImgError(this)" alt="">' : '';
    const cornerText = cardFace(card)||'';
    // 标题栏字号用 fitFontSize 实测自适应(取代早期"按牌名字数分档手动猜大小"的做法,
    // 那套只覆盖了4字/5字两档,任何新长度组合都要回来手动调整)。cardMetricsForViewport
    // 按当前视口宽度取这一档卡片的实际宽度/--badge值/标题栏最大字号。
    // 【曾经反复出现三次的真实bug,这次修正】titleMaxWidth 曾经按 CSS 的 .card-title
    // padding 系数(--badge*0.12*2)算,那只是"给文字预留的装饰性呼吸空间"这个很小的
    // 数值(badge=20px时只有4.8px)——但左右两个图标(.corner花色角标、.info-badge-hit
    // 问号)是绝对定位悬浮在标题栏上层的完整 badge 宽度方块(20px/16px/14px),不受父
    // 元素padding约束、z-index比文字高。maxWidth 算的是"CSS padding算出来的名义宽度"
    // 而不是"两个图标之间真正的净空间"——这两者是完全不同的两个数字,只要文字宽度超出
    // 图标间真正的净空间,末尾的字就会被图标不透明地压住挡掉,不管字号算法本身多精确都
    // 没用(算法只能保证"塞进算出来的maxWidth",算错了maxWidth,结果必然还是被挡)。
    // 现在手牌的角标/说明按钮位于插画区顶部，标题栏可以使用整张卡的宽度；只保留
    // 左右各5px的视觉安全边距，不再为两个已经移出标题栏的badge重复预留空间。
    const m = cardMetricsForViewport();
    const titleMaxWidth = m.cardWidth - 10;
    const titleFontSize = fitFontSize(card.name, titleMaxWidth, m.maxTitleFont, 800, CARD_TITLE_FONT_FAMILY) + 'px';
    el.innerHTML =
      '<div class="card-title" style="font-size:'+titleFontSize+'">'+card.name+'</div>'
      +'<div class="card-art-box">'+imgTag+'</div>'
      +'<div class="corner">'+cornerText+'</div>';
    el.classList.toggle('no-art', !imgSrc); // no-art 现在只控制插画区域的占位底色,不再控制牌名文字的显示/隐藏

    let usable=false, onClick=null;
    if(g.phase==='enyuanGiveCard'&&g.pending&&g.pending.type==='enyuanGiveCard'&&g.pending.damagerSeat===mySeat){
      // 【恩怨】交红桃：按钮与真实手牌统一使用同一个下标，红桃手牌本体也可直接点击。
      usable=card.suit==='♥';
      if(usable) onClick=()=>giveEnyuanCard(idx);
    } else if(g.phase==='huanhuoPickCard'&&g.pending&&g.pending.type==='huanhuoPickCard'&&g.pending.sourceSeat===mySeat){
      // 法正【眩惑】:选择交出的红桃时，允许直接点击真实手牌。旧界面只在控制区另外生成一排
      // 文本按钮，手牌本体反而是灰的，手机玩家自然会以为“红桃牌点不了”。按 card.id 对照
      // pending 快照找到服务端需要的候选下标，点击后仍走同一个 pickHuanhuoHeartCard 校验入口。
      usable=card.suit==='♥';
      if(usable) onClick=()=>pickHuanhuoHeartCard(idx);
    } else if(g.phase==='guicai'&&guicaiMode&&g.pending&&g.pending.type==='guicai'&&g.pending.asking===mySeat){
      // 鬼才选牌模式:任意一张手牌都可以打出替换判定牌
      usable=true; onClick=()=>respondGuicai(true, idx);
    } else if(g.phase==='xiaoguo'&&xiaoguoMode&&g.pending&&g.pending.type==='xiaoguo'&&g.pending.asking===mySeat){
      // 骁果选牌模式:只有基本牌(杀/闪/桃)可选,其余牌照常灰显不可点
      usable = BASIC_CARDS.includes(card.name);
      if(usable) onClick=()=>{ resetXiaoguo(); respondXiaoguo(true, idx); };
    } else if(g.phase==='qinglong'&&qinglongMode&&g.pending&&g.pending.type==='qinglong'&&g.pending.from===mySeat){
      // 青龙偃月刀选牌模式:只有能当杀的牌可选(canUseAs 统一入口,含龙胆闪当杀等转化),
      // 点了直接提交,不需要额外确认(目标固定,不需要选目标)。
      usable = canUseAs(me, card, '杀');
      if(usable) onClick=()=>{ resetQinglong(); respondQinglong(true, idx); };
    } else if(g.phase==='cixiongChoice'&&cixiongDiscardMode&&g.pending&&g.pending.type==='cixiongChoice'&&g.pending.to===mySeat){
      // 雌雄双股剑:目标弃一张手牌,任意手牌可点,点了即提交
      usable=true;
      onClick=()=>{ resetCixiongDiscard(); respondCixiongChoice('discard', idx); };
    } else if(g.phase==='qiaobianTurnStart'&&qiaobianMode==='choosePhase'&&g.pending&&g.pending.type==='qiaobianTurnStart'&&g.pending.seat===mySeat){
      // 巧变选牌模式:任意一张牌都可以选(不检查牌名)。toggle 单选(和断粮同款),
      // 还要另外选一个阶段(四个按钮在 renderControls 里),两者都选好才出现"确认"。
      usable=true;
      onClick=()=>{ qiaobianCardIdx = (qiaobianCardIdx===idx?null:idx); render(g); };
    } else if(g.phase==='lirangAsk'&&g.pending&&g.pending.type==='lirangAsk'&&g.pending.from===mySeat){
      usable=true;
      onClick=()=>{
        if(lirangPicks.includes(idx)) lirangPicks = lirangPicks.filter(x=>x!==idx);
        else if(lirangPicks.length<2) lirangPicks.push(idx);
        render(g);
      };
    } else if(g.phase==='play'&&myTurn&&duanliangMode){
      // 断粮选牌模式:官方规则只能选黑色基本牌或黑色装备牌(不是任意牌),不满足条件的牌
      // 照常灰显不可点。点=切换选中(单选,再点别的合法牌会换选中)。
      const isBlack = card.suit==='♠' || card.suit==='♣';
      const isBasicOrEquip = BASIC_CARDS.includes(card.name) || !!getEquip(card.name);
      usable = isBlack && isBasicOrEquip;
      if(usable) onClick=()=>{ duanliangCardIdx = (duanliangCardIdx===idx?null:idx); render(g); };
    } else if(g.phase==='play'&&myTurn&&qixiMode){
      // 奇袭选牌模式:任意黑色手牌都能当【过河拆桥】使用。
      usable = card.suit==='♠' || card.suit==='♣';
      if(usable) onClick=()=>{ qixiCardIdx = (qixiCardIdx===idx?null:idx); render(g); };
    } else if(g.phase==='play'&&myTurn&&guoseMode){
      usable = card.suit==='♦';
      if(usable) onClick=()=>{ guoseCardIdx = (guoseCardIdx===idx?null:idx); render(g); };
    } else if(g.phase==='play'&&myTurn&&lianhuanMode){
      usable = card.suit==='♣';
      if(usable) onClick=()=>{ lianhuanCardIdx = (lianhuanCardIdx===idx?null:idx); lianhuanTargets=[]; render(g); };
    } else if(g.phase==='play'&&myTurn&&lijianMode){
      usable = true;
      if(usable) onClick=()=>{ lijianCardIdx = (lijianCardIdx===idx?null:idx); lijianFromSeat=null; render(g); };
    } else if(g.phase==='play'&&myTurn&&qingnangMode){
      // 青囊选牌模式:任意一张手牌都可弃置作为发动成本。
      usable = true;
      onClick=()=>{ qingnangCardIdx = (qingnangCardIdx===idx?null:idx); render(g); };
    } else if(g.phase==='play'&&myTurn&&zhihengMode){
      // 制衡选牌模式:任意手牌都可弃置,点牌 toggle 多选,最后由按钮一次性提交。
      usable = true;
      onClick=()=>{
        if(zhihengPicked) zhihengPicks = zhihengPicks.filter(x=>x!==idx);
        else zhihengPicks.push(idx);
        render(g);
      };
    } else if(g.phase==='play'&&myTurn&&fangtianMode){
      // 方天画戟选目标模式:手牌只有这一张(触发条件已限定),不需要再点手牌本身,
      // 目标全部在座位区(见下方 seat 循环里的 fangtianMode 分支)选择,这里留空不可点。
    } else if(g.phase==='play'&&myTurn&&zhangbaMode){
      // 丈八选牌模式:点牌 = toggle 到 zhangbaPicks(任意牌均可,最多2张;已满则仅允许取消已选)
      usable = picked || zhangbaPicks.length<2;
      if(usable) onClick=()=>{
        if(picked) zhangbaPicks = zhangbaPicks.filter(x=>x!==idx);
        else if(zhangbaPicks.length<2) zhangbaPicks.push(idx);
        render(g);
      };
    } else if(g.phase==='play'&&myTurn){
      // 武圣类(目前只有关羽):这张牌同时"有自己的独立入口"和"能当杀使用"时,resolveActionId 的固定
      // 优先级会让它自己的效果100%胜出、玩家永远点不到"当杀"。把选择权交还给玩家(见 confirmOwnOrSha)。
      //
      // gate 是结构化判断,不硬编码牌名、也不查 getEquip(遵循规则5,以后新增同型牌零改动):
      //   ownSpec 存在 + 它自己不需要选目标(target:false) + 它此刻真的能按自己的效果打出 + 也能当杀。
      // 覆盖装备牌 + 6张 target:false 的普通红牌(桃♥8/无中生有♥4/五谷丰登♥2/酒♦1/万箭齐发♥1/桃园结义♥1)。
      // target:true 的9张红牌(乐不思蜀/闪电/决斗/顺手牵羊/过河拆桥/火攻)两种用法都要选目标、必须同屏
      // 共存,走 render.js 座位循环里的"武圣:杀"独立按钮,不走这个弹窗——两套机制共用同一个触发判据,
      // 只按 spec.target 分流,天然互斥不重叠。
      //
      // 【ownSpec.canPlay 这一项不能省】装备的 equipPlay.canPlay 恒真,所以早期只做装备时漏掉它没
      // 暴露问题;但【桃】(me.hp<me.maxHp)和【酒】(!g.jiuUsed)的 canPlay 是状态相关的。带上这一项后:
      // 它自己此刻打不出(满血的桃/已用过的酒) → 不弹窗,resolveActionId 自然落到'杀'、直接当杀(行为不变);
      // 打得出 → 弹窗二选一。这同时消掉了"满血能当杀、受伤反而不能"那个反直觉的翻转——不是为桃/酒
      // 写特例,是这条通用条件的自然结果。
      const ownSpec = CARD_PLAYS[card.name];
      const needsShaChoice = !!ownSpec && !ownSpec.target
        && ownSpec.canPlay(g, me, card)
        && CARD_PLAYS['杀'].canPlay(g, me, card);
      if(needsShaChoice){
        usable = true;
        onClick = () => confirmOwnOrSha(card, idx);
      } else {
      // actionId:优先这张牌自己的效果,没有独立入口(如闪)才转化为杀;查 CARD_PLAYS 决定可用性与点击行为
      const actionId = resolveActionId(g, me, card);
      const spec = CARD_PLAYS[actionId];
      const canRende = hasCap(me,'rende');
      const canShuangxiong = canShuangxiongDuelCard(me, card);
      const canGuhuoActive = hasCap(me,'guhuo') && !g.guhuoUsed && guhuoClaimableNames().some(name=>{
        const action=guhuoActionId(name);
        const s=CARD_PLAYS[action];
        if(!s) return false;
        const claimed={ id:card.id, name, suit:card.suit, rank:card.rank, originalName:card.name };
        if(s.canPlay && !s.canPlay(g, me, claimed)) return false;
        return guhuoHasLegalTarget(g, mySeat, claimed, s);
      });
      if(spec && spec.canPlay(g,me,card)){
        usable=true;
        if(spec.target || canRende || canShuangxiong || canGuhuoActive){ onClick=()=>{ selectedCardIdx = (selectedCardIdx===idx?null:idx); resetTiesuo(); render(g);} ; } // 目标牌/刘备仁德/双雄/蛊惑:点=选中
        else { onClick=()=>confirmAndPlay(playConfirmMsg(g, actionId, card), ()=>playCard(idx, actionId)); } // 桃/无中生有/AOE/装备:确认后出牌
      } else if(canRende || canShuangxiong || canGuhuoActive){
        // 刘备【仁德】可交出任意手牌;颜良文丑【双雄】可把异色手牌当【决斗】使用;于吉【蛊惑】可扣置任意手牌声明合法牌名。
        usable=true;
        onClick=()=>{ selectedCardIdx = (selectedCardIdx===idx?null:idx); resetTiesuo(); render(g); };
      }
      }
    } else if(g.phase==='discard'&&myTurn&&me.hand.length>me.hp){
      // 多选后统一确认:点击只是切换勾选状态(discardSelectedSet),不立刻提交——真正弃牌
      // 由弃牌阶段的"确认弃牌"按钮统一调用discardCards一次性提交,见renderControls。
      usable=true;
      onClick=()=>{
        if(discardSelectedSet.has(idx)) discardSelectedSet.delete(idx);
        else discardSelectedSet.add(idx);
        render(g);
      };
    } else if(respondRole && canUseAs(me, card, respondRole)){
      // 五个响应场景(出闪/南蛮万箭/决斗/借刀杀人/挑衅):候选>1时(真实牌+龙胆/武圣/倾国转化)
      // 才需要玩家先点选具体一张——点选只是切换 selectedResponseCardIdx(纯客户端状态,不入库),
      // 真正响应仍由旁边"出【闪/杀】"按钮触发、读取这个下标传给对应的 respond* 函数。候选<=1时这里不设
      // onClick,维持原有"手牌不可点、按钮直接生效"的简化体验(respondCandidateCount 在
      // 循环外已经算好,和之前"handled via button, leave card non-clickable"的注释描述的
      // 是同一种"唯一候选"场景,只是现在多了">1时可点选"这个新分支)。
      if(respondCandidateCount>1){
        usable=true;
        onClick=()=>{ selectedResponseCardIdx = (selectedResponseCardIdx===idx?null:idx); render(g); };
      }
    }
    if(!usable) el.classList.add('disabled');
    if(onClick) el.onclick=onClick;
    el.title = getAnyDesc(card.name); // 电脑鼠标悬停即显示说明(装备牌走 EQUIPS.desc、基础牌/锦囊走 CARD_DESC)
    // "?" 角标:查看该牌说明。stopPropagation 不触发出牌;pointer-events:auto 让 disabled 牌也能查看
    // 外层 .info-badge-hit 是实际点击热区(比视觉圆圈大,手机上更好点中),内层 .info-badge 只负责
    // 视觉上的小圆圈(手机断点下会缩小,避免盖住花色/点数角标文字)——热区和视觉大小分离,不是
    // 缩小视觉尺寸就顺带缩小了可点范围。
    const hit=document.createElement('div'); hit.className='info-badge-hit';
    hit.onclick=(e)=>{ e.stopPropagation(); showInfo(card.name, escapeHtml(getAnyDesc(card.name)||'(暂无说明)')); };
    const badge=document.createElement('span'); badge.className='info-badge'; badge.textContent='?';
    hit.appendChild(badge);
    el.appendChild(hit);
    attachLongPressPreview(el, card); // 手机端长按放大预览,和桌面端hover是独立的两条路径
    h.appendChild(el);
  });
  if((me.hand||[]).length===0) h.innerHTML='<span style="color:var(--paper-dim);font-size:13px">（暂无手牌）</span>';
}

// fitFontSize: 用canvas measureText测量文字在给定字号下的实际宽度,反推出能让文字刚好
// 塞进 maxWidth 的字号(不超过 maxFontSize),取代早期"按字数分档手动猜大小"的做法——
// 新增任何长度的牌名都不需要回来手动调整,算法自动算出刚好放得下的字号。
// 用一个模块级复用的canvas(避免每次调用都新建一个,减少开销)。
// 【曾经的下限保护,已移除,真实bug】原来 return Math.max(scaled, maxFontSize*0.4) 设了
// 一个"不低于maxFontSize*0.4"的下限,初衷是"避免极端长文字缩到无法辨认"——但用 Playwright
// 实测"青龙偃月刀"（5字,64px卡片,两个20px图标间真实净空间只有~22px）发现:这个下限会
// 反过来违背 fitFontSize 本身"保证文字塞进maxWidth"的核心承诺——被下限强行拉高到
// maxFontSize*0.4(=5.6px)后,实际渲染宽度是29.45px,超过了22px的真实间隙,文字依然
// 被左右两个图标压住,和"按maxWidth精确计算字号"这个函数存在的意义直接矛盾。有下限时,
// "文字会不会被遮挡"这件事不再由 maxWidth 决定,而是由"maxFontSize*0.4 算出来的宽度
// 是否偶然小于间隙"这个和 maxWidth 无关的巧合决定——这不是这个函数应该承诺的行为。
// 现在去掉下限,允许字号真正缩到能塞进 maxWidth 为止(哪怕极端情况下缩得很小、肉眼难以
// 辨认单个字符也认了)——"字虽然小但没被图标挡住"好于"字号被强行拉大但被图标挡住看不清
// 是哪张牌",这是这次改动权衡后的选择。
let _fitCanvas = null;
const CARD_TITLE_FONT_FAMILY = '"Songti SC","Noto Serif SC",ui-serif,"STSong",serif'; // 和 body 的 font-family 保持一致(见 index.html);canvas 不支持"inherit",必须传具体字体栈
function fitFontSize(text, maxWidth, maxFontSize, fontWeight, fontFamily){
  if(!_fitCanvas) _fitCanvas = document.createElement('canvas');
  const ctx = _fitCanvas.getContext('2d');
  ctx.font = (fontWeight||700)+' '+maxFontSize+'px '+fontFamily;
  const width = ctx.measureText(text).width;
  if(width<=maxWidth) return maxFontSize;
  const scaled = maxFontSize * (maxWidth/width) * 0.96; // 0.96留安全余量,避免刚好卡在边缘
  return scaled; // 不设下限——保证塞进maxWidth是这个函数唯一的承诺,见上方注释
}
// cardMetricsForViewport: 手牌卡片在当前视口宽度下的尺寸(卡片宽度/--badge值/标题栏
// 最大字号)——和 index.html 里 .card 基础规则+两个响应式断点(max-width:640px/480px)
// 的实际数值保持同步(方案B:不动态读DOM,直接按视口宽度分档传入固定值,更简单,足以
// 达成"不用再按牌名字数手动调整"这个核心目标;如果以后改动了那三个断点的卡片宽度或
// --badge/标题栏字号,这里要跟着改)。
function cardMetricsForViewport(){
  const w = window.innerWidth;
  const h = window.innerHeight;
  const game = document.getElementById('game');
  const desktop = !!(game && game.classList.contains('desktop-layout'));
  if(desktop){
    if(h<=760) return { cardWidth:92, badge:19, maxTitleFont:16 };
    return { cardWidth:108, badge:22, maxTitleFont:18 };
  }
  const coarse = window.matchMedia && window.matchMedia('(pointer:coarse)').matches;
  if(h<=520 && coarse) return { cardWidth:60, badge:15, maxTitleFont:13 };
  if(w<=480) return { cardWidth:52, badge:14, maxTitleFont:12 };
  if(w<=640) return { cardWidth:58, badge:15, maxTitleFont:13 };
  if(w<=1199 || coarse) return { cardWidth:82, badge:18, maxTitleFont:15 };
  return { cardWidth:72, badge:18, maxTitleFont:15 };
}
