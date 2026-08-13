// ---------- game constants ----------
const SEATS = 9;        // 房间容量上限(team模式9人,支持3v3v3/4v4+机器人等;desktop-layout-8p基础扩1)
const MIN_PLAYERS = 2;  // 开始游戏的最低人数(2 或 3 人均可开始)
const MAX_HP = 4; // 大厅占位 / 兜底默认体力上限
// TEAM_COLORS:组队模式队伍色表(索引即队伍号,最多9队=一人一队)。纯客户端常量,不写进Firebase。
const TEAM_COLORS = ['#c0392b','#2471a3','#1e8449','#7d3c98','#b7950b','#e67e22','#2e86c1','#28b463','#6c3483'];
const START_HAND = 4;
const BASIC_CARDS = ['杀','火杀','雷杀','闪','桃','酒']; // 基本牌:不含锦囊/装备,乐进【骁果】等按"是不是基本牌"判断的地方统一查这个表

// 询问型 pending 的唯一阶段配置源。data.js 是浏览器与各类测试共同加载的最早底座；
// 后续模块只向同一个 stage 项补 render / timeoutAction / botDecision / required / alive。
const IDENTITY_TABLE = {
  4: ['zhu','zhong','fan','nei'],
  5: ['zhu','zhong','fan','fan','nei'],
  6: ['zhu','zhong','fan','fan','fan','nei'],
  7: ['zhu','zhong','zhong','fan','fan','fan','nei'],
  8: ['zhu','zhong','zhong','fan','fan','fan','fan','nei'],
};
const ROLE_LABEL = { zhu:'主公', zhong:'忠臣', fan:'反贼', nei:'内奸' };

// 按人数洗牌写入 p.role;主公 roleRevealed=true,其余 false。人数不在 4~8 时 no-op。
function assignIdentities(players){
  const n = (players||[]).length;
  const base = IDENTITY_TABLE[n];
  if(!base) return;
  const roles = [...base].sort(()=>Math.random()-0.5);
  players.forEach((p,i)=>{
    if(!p) return;
    p.role = roles[i];
    p.roleRevealed = (p.role === 'zhu');
  });
}

function getLordSeat(g){
  if(!g || !Array.isArray(g.players)) return -1;
  return g.players.findIndex(p=>p && p.role==='zhu');
}

// 渲染用:谁能看见目标座位的身份。主公始终可见;已翻开可见;自己看自己可见。
function canSeeRole(g, viewerSeat, targetSeat){
  if(!g || g.gameMode!=='identity') return false;
  const t = g.players && g.players[targetSeat];
  if(!t || !t.role) return false;
  if(t.role==='zhu') return true;
  if(t.roleRevealed) return true;
  if(viewerSeat===targetSeat) return true;
  return false;
}

// ---------- 组队模式(team)队伍归属判断 ----------
// sameTeam(g,seatA,seatB):唯一的"是否同队"判断入口,业务代码(机器人打分/未来任何需要
// 判断队友关系的逻辑)一律经这里查,不各处手写 `p.team===p2.team` 这类判断——normalize()
// 已经保证非 team 模式下 p.team 恒为 null,这里只需要再检查一次 gameMode 防御性收口
// (万一某处直接传了未经过 normalize 的 g),不需要重复关心"team 字段本身合不合法"这件事。
// seatA===seatB(自己和自己)算同队(约定和 canSeeRole 的 viewerSeat===targetSeat 分支
// 同一直觉:自己人不含糊),调用方如果需要排除自己,自行在外层判断。
function sameTeam(g, seatA, seatB){
  if(!g || g.gameMode!=='team') return false;
  const a = g.players && g.players[seatA];
  const b = g.players && g.players[seatB];
  if(!a || !b) return false;
  if(!Number.isInteger(a.team) || !Number.isInteger(b.team)) return false;
  return a.team === b.team;
}

// ---------- 装备区(地基:只搭容器+显示;派生属性/距离/射程/效果一律后续经 EQUIPS 常量表 + getEquip 实现,不写进 Firebase) ----------
// 四槽:weapon 武器 / armor 防具 / plus1 +1马(防御马) / minus1 -1马(进攻马);每槽存一张装备牌对象 {id,name} 或 null(空)。
const EQUIP_SLOTS = ['weapon','armor','plus1','minus1'];
function emptyEquips(){ return { weapon:null, armor:null, plus1:null, minus1:null }; }
// 装备牌派生属性表(name→{slot,...});只存在客户端,从不写进 Firebase(持久化的只有槽里的 {id,name})。
// range(武器射程)/dist(马的距离修正)本步只声明、不生效,留给后续距离系统。业务层查表不硬编码装备名。
const EQUIPS = {
  '诸葛连弩': { slot:'weapon', range:1, cap:'unlimitedSha', desc:'武器,射程1。装备后,你在自己的出牌阶段可以使用任意数量的【杀】(不再受每回合只能出1张的限制)。' },
  '丈八蛇矛': { slot:'weapon', range:3, cap:'twoAsSha', desc:'武器,射程3。你可以把任意两张手牌合起来当作一张【杀】使用。' },
  '八卦阵':   { slot:'armor', cap:'bagua', desc:'防具。当你需要打出【闪】时,可先翻开牌堆顶一张牌碰运气:翻到红色就当作你打出了【闪】,黑色则无效、仍需正常应对。' },
  '仁王盾':   { slot:'armor', cap:'renwang', desc:'防具。黑色的【杀】对你无效。' },
  '青釭剑':   { slot:'weapon', range:2, cap:'ignoreArmor', desc:'武器,射程2。你使用【杀】时无视对方的防具(例如对方的【八卦阵】无法发动)。' },
  '麒麟弓':   { slot:'weapon', range:5, cap:'qilin', desc:'武器,射程5。你的【杀】对目标造成伤害时,可以弃掉对方装备的一匹坐骑。' },
  '青龙偃月刀': { slot:'weapon', range:3, cap:'qinglong', desc:'武器,射程3。你使用的【杀】被【闪】抵消时,你可以对同一目标再使用一张【杀】(不计入出杀次数限制,无距离限制,只要又被闪抵消可以连续触发)。' },
  '寒冰剑':   { slot:'weapon', range:2, cap:'hanbing', desc:'武器,射程2。你使用的【杀】命中目标时,可以防止此伤害,改为弃置该角色两张牌(不足两张则弃光为止,不能被无懈可击抵消)。' },
  '方天画戟': { slot:'weapon', range:4, cap:'fangtian', desc:'武器,射程4。锁定技,若你使用的【杀】是你手牌里的最后一张牌,则此【杀】可以额外选择至多两个目标(可以不多选、也可以只多选一个)。' },
  '古锭刀':   { slot:'weapon', range:2, cap:'gudingdao', desc:'武器,射程2。锁定技,当你使用【杀】对目标角色造成伤害时,若其没有手牌,此伤害+1。' },
  '贯石斧':   { slot:'weapon', range:3, cap:'guanshifu', desc:'武器,射程3。当你使用的【杀】被【闪】抵消时,你可以弃置两张牌(手牌/装备任意组合,须同时弃满两张),令此【杀】依然造成伤害。' },
  '雌雄双股剑': { slot:'weapon', range:2, cap:'cixiong', desc:'武器,射程2。当你使用【杀】指定与你性别不同的角色为目标后,你可以令其选择一项:1.弃置一张手牌;2.令你摸一张牌。' },
  '的卢':     { slot:'plus1', dist:+1, desc:'坐骑(防御马)。其他角色计算与你的距离时+1,让你更难被【杀】攻击到。' },
  '绝影':     { slot:'plus1', dist:+1, desc:'坐骑(防御马)。其他角色计算与你的距离时+1,让你更难被【杀】攻击到。' },
  '爪黄飞电': { slot:'plus1', dist:+1, desc:'坐骑(防御马)。其他角色计算与你的距离时+1,让你更难被【杀】攻击到。' },
  '大宛':     { slot:'minus1', dist:-1, desc:'坐骑(进攻马)。你计算与其他角色的距离时-1,让你更容易攻击到别人。' },
  '赤兔':     { slot:'minus1', dist:-1, desc:'坐骑(进攻马)。你计算与其他角色的距离时-1,让你更容易攻击到别人。' },
  '紫骍':     { slot:'minus1', dist:-1, desc:'坐骑(进攻马)。你计算与其他角色的距离时-1,让你更容易攻击到别人。' },
  '骕骦':     { slot:'minus1', dist:-1, desc:'坐骑(进攻马)。你计算与其他角色的距离时-1,让你更容易攻击到别人。' },
};
function getEquip(name){ return EQUIPS[name] || null; } // 唯一查询入口
// 「这张牌是不是装备牌」。陈宫【明策】的 4 个调用点(game.js ×3、render-controls.js ×1)
// 一直在调它,但全项目从来没有定义过 —— 每次调用都直接抛 ReferenceError,导致明策整个
// 技能不可用、且渲染会从调用处断掉。口径沿用项目既有写法 !!getEquip(card.name),不新造
// 判断方式(见 render-hand.js/skills.js 的 isBasicOrEquip)。
function isEquipment(card){ return !!(card && getEquip(card.name)); }

// ---------- 延时锦囊(判定区)地基:seam 已搭好,三张具体牌(闪电/乐不思蜀/兵粮寸断)尚未实现 ----------
// name -> { onlySelf(是否只能对自己使用,如日后的闪电), effect(g,seat,judgeCard,card)=>可选返回"传给谁"的座位号 }。
// effect 在 game.js 的 resolveDelayTricks(回合开始的判定阶段)里被调用:seat=正在结算判定区的玩家,
// judgeCard=judge(g)翻出的判定牌,card=延时锦囊牌本身。返回数字座位号=传给该玩家(判定区各自独立,不进弃牌堆);
// 不返回(undefined)=判定完就弃置。加新延时锦囊:1) 这里加一项 2) buildDeck 里加牌——和 EQUIPS 表同一套约定。
const DELAY_TRICKS = {};
// 闪电:只能放在自己判定区(onlySelf)。回合开始判定黑桃2~9(不含A/10/J/Q/K)则受到3点无来源伤害、
// 闪电作废;否则不受伤害,传给下家(nextAlive 环形顺序,阵亡者不占位)。dealDamage 的 sourceSeat
// 传 undefined——已确认安全:司马懿【反馈】等依赖 sourceSeat 的钩子本来就防御了非数字来源,静默跳过。
// dealDamage 命中致命时会挂起濒死流程(返回 true),此时 effect 仍返回 'pending' 让 resolveDelayTricks
// 停止处理、把控制权交还(闪电这张牌本身照常进弃牌堆,和是否致命无关,由 resolveDelayTricks 统一处理)。
DELAY_TRICKS['闪电'] = {
  onlySelf:true,
  effect:(g, seat, judgeCard, card)=>{
    if(cardSuitForPlayer(g.players[seat], judgeCard)==='♠' && judgeCard.rank>=2 && judgeCard.rank<=9){
      const dying = dealDamage(g, seat, 3, undefined, '【闪电】发动', 'delay', card);
      return dying ? 'pending' : undefined;
    }
    // 判定不中:移到下一名"判定区里没有【闪电】"的其他存活角色(官方通则:同一判定区不能有两张同名牌)。
    // 找不到合法去处(极端边界:2人局且对方判定区已有另一张闪电)则作废进弃牌堆、不传回自己,
    // 否则本回合判定循环会立刻再判一次造成死循环。
    const n=g.players.length;
    for(let k=1;k<=n;k++){
      const s=(seat+k)%n;
      if(s===seat) break;
      const p=g.players[s];
      if(p && p.alive && !(p.delays||[]).some(c=>c && c.name==='闪电')) return s;
    }
    g.log = pushLog(g.log, '场上没有可传递的判定区,【闪电】作废');
  }
};
// 乐不思蜀:只能放在别人判定区(onlySelf:false)。回合开始判定,官方原文是"若判定结果不为
// 红桃,则跳过其出牌阶段"——精确到花色(♥),不是红/黑两大类:红桃♥=判定失败,无效果;
// 黑桃/梅花/方块(含方块这张"红色但不是红桃"的牌)=判定成功,跳过这个回合的出牌阶段。
// 摸牌阶段依然正常摸牌,只是不给出牌机会,所以不能在这里直接切阶段(这时候还没摸牌),
// 只能设一个标志位 g.skipPlay,交给 doDraw 在摸完牌、原本要进 play 阶段的那一刻消费掉。
// 不管判定结果是哪种花色,乐不思蜀本身都作废(不返回值,resolveDelayTricks 默认分支进弃牌堆);
// 不产生伤害,不会触发濒死流程,不需要闪电那套 'pending' 挂起机制。
// 【曾经的 bug】最初这里写的是 `if(!isRed(judgeCard)) g.skipPlay=true`(只按红/黑两大类判断),
// 会把方块(红色但不是红桃)也当成"逃脱花色"错误放行——已改为直接比较 `judgeCard.suit`。
DELAY_TRICKS['乐不思蜀'] = {
  onlySelf:false,
  effect:(g, seat, judgeCard, card)=>{
    const name=g.players[seat].name;
    if(cardSuitForPlayer(g.players[seat], judgeCard)!=='♥'){
      g.skipPlay=true;
      g.log=pushLog(g.log, name+' 判定不为红桃,【乐不思蜀】生效,跳过出牌阶段');
    } else {
      g.log=pushLog(g.log, name+' 判定为红桃,【乐不思蜀】无效');
    }
  }
};
// 兵粮寸断:只能放别人判定区。官方原文"若判定结果不为梅花,则跳过其摸牌阶段"——精确到
// 花色(♣),不是红/黑两大类:梅花♣=判定失败,无效果;红桃/黑桃/方块(含黑桃这张"黑色但
// 不是梅花"的牌)=判定成功,跳过该玩家这个回合的摸牌阶段。和乐不思蜀"跳过阶段"的触发
// 条件各自锁定不同花色,不是同一个"红/黑"判断的镜像,影响的阶段也相反
// (兵粮寸断管摸牌 g.skipDraw,乐不思蜀管出牌 g.skipPlay)——两个标志位各管一段、
// 互不覆盖;真正消费的地方是 enterDrawPhase(见 game.js),会同时兼顾两者同时命中的情况。
// 不管判定结果是哪种花色,兵粮寸断本身都作废(不返回值,resolveDelayTricks 默认分支进弃
// 牌堆),不像闪电那样在"不生效"时传给下家——判定完这张牌就离开判定区,不产生伤害,不触发
// 濒死。【曾经的 bug】最初这里写的是 `if(!isRed(judgeCard)) g.skipDraw=true`(只按红/黑
// 两大类判断)——这个判断方向整体是反的:红桃/方块本该生效却被误判成"红=逃脱"而放行,
// 黑桃本该逃脱却被误判成"黑=生效"——已改为直接比较 `judgeCard.suit`。
DELAY_TRICKS['兵粮寸断'] = {
  onlySelf:false,
  effect:(g, seat, judgeCard, card)=>{
    const name=g.players[seat].name;
    if(cardSuitForPlayer(g.players[seat], judgeCard)!=='♣'){
      g.skipDraw=true;
      g.log=pushLog(g.log, name+' 判定不为梅花,【兵粮寸断】生效,跳过摸牌阶段');
    } else {
      g.log=pushLog(g.log, name+' 判定为梅花,【兵粮寸断】无效');
    }
  }
};

// ---------- 武将定义表(数据结构 + 技能均已实现) ----------
// 技能有两种表达:被动能力挂 caps(经 generalHasCap/generalCapValue 查),触发型挂 hooks(经 triggerHook 分发);统一经 getGeneral(id) 取用。
const GENERALS = {
  zhangfei:      { id:'zhangfei',      name:'张飞',   gender:'male', faction:'shu',   maxHp:4, skill:'咆哮', desc:'出牌阶段,你可以使用任意数量的【杀】。', caps:{ unlimitedSha:true } },
  guojia: { id:'guojia', name:'郭嘉', gender:'male', faction:'wei', maxHp:3, skill:'天妒/遗计',
    desc:'天妒:当你的判定牌生效后,你可以获得此牌。遗计:当你受到1点伤害后,你可以选择观看牌堆顶两张牌,然后将这两张牌分别交给任意角色(可以是自己)。',
    caps:{ tiandu:true },
    hooks:{
      onDamaged(g, seat, ctx){
        const p=g.players[seat];
        if(!p || !p.alive || (g.deck||[]).length===0) return; // 牌堆空则无法发动,静默跳过
        // resume 记下"遗计问完之后该接回哪条被打断的流程"——取值就是 dealDamage 本来就在传的
        // ctx.srcType,和濒死求桃(startDying)同一套约定,复用同一个 resumeAfterInterrupt 出口。
        // 'delay'/'xiaoguo' 这两种 srcType 需要的额外字段(seat/endingSeat/lastAsker),由各自
        // 原有的挂起入口负责补全(见 continueDelayResolution/finishGuicai 的 delayJudge 分支/
        // respondXiaoguoChoice,这几处已经对 g.pending.type==='dying' 做同样的事,这次一并
        // 扩展到 'yijiAsk'),这里不需要关心这些细节。
        // 【真实bug修复】补上 setResponseAskedAt:这个询问型pending此前没有设askedAt,
        // bot-ai-bus.js 的 maybeAutoRespondTimeout 靠 typeof g.pending.askedAt==='number'
        // 这条守卫判断"要不要走30秒超时兜底",没有这个字段等于这条安全网对yijiAsk形同虚设——
        // 真人玩家忘了响应/掉线时,这个pending会永久悬空卡住整局,和左慈"更改化身"那批
        // 询问阶段此前踩过的同一个坑。
        g.pending = setResponseAskedAt({ type:'yijiAsk', seat, resume:{type:ctx.srcType} });
        g.phase = 'yijiAsk';
        g.log = pushLog(g.log, p.name+' 是否发动【遗计】,观看牌堆顶两张牌…');
      }
    } },
  sunshangxiang: { id:'sunshangxiang', name:'孙尚香', gender:'female', faction:'wu', maxHp:3, skill:'枭姬', desc:'当你失去装备区里的一张装备牌时,你摸两张牌。', hooks:{ onLoseEquip:(g, seat, ctx)=>{ const n = 2 * (ctx && ctx.count || 1); drawN(g, seat, n); g.log=pushLog(g.log, g.players[seat].name+' 发动【枭姬】,摸'+n+'张牌'); markSkillSound(g, '枭姬'); } } },
  diaochan:      { id:'diaochan',      name:'貂蝉',   gender:'female', faction:'qun', maxHp:3, skill:'离间/闭月',
    desc:'离间:出牌阶段限一次,你可以弃置一张手牌,选择两名男性角色,令其中一名男性角色视为对另一名男性角色使用【决斗】。闭月:结束阶段,你可以摸1张牌。',
    caps:{ lijian:true, biyue:true } },
  kongrong:      { id:'kongrong',      name:'孔融',   gender:'male', faction:'qun', maxHp:3, skill:'礼让/争义',
    desc:'礼让:每轮限一次,其他角色的摸牌阶段开始时,你可以交给其两张牌;其本回合弃牌阶段结束时,你可以获得其在此弃牌阶段弃置的牌。争义:每回合首次受到伤害时,本轮内因礼让获得过你牌的角色可以替你承受此次伤害。',
    caps:{ lirang:true, zhengyi:true } },
  zhaoyun:       { id:'zhaoyun',       name:'赵云',   gender:'male', faction:'shu',   maxHp:4, skill:'龙胆', desc:'你可以将【杀】当【闪】、【闪】当【杀】使用(1:1 转化)。', caps:{ longdan:true } },
  luxun:         { id:'luxun',         name:'陆逊',   gender:'male', faction:'wu',    maxHp:3, skill:'谦逊/连营',
    desc:'谦逊:锁定技,你不能成为【顺手牵羊】和【乐不思蜀】的目标。连营:当你失去最后一张手牌时,你可以摸1张牌。',
    caps:{ qianxun:true, lianying:true } },
  lvmeng:        { id:'lvmeng',        name:'吕蒙',   gender:'male', faction:'wu',   maxHp:4, skill:'克己', desc:'若你于出牌阶段未使用或打出过【杀】,你可以跳过弃牌阶段(手牌超过体力上限也不必弃牌)。', caps:{ keji:true } },
  simayi:        { id:'simayi',        name:'司马懿', gender:'male', faction:'wei', maxHp:3, skill:'反馈', desc:'当你受到伤害后,你获得伤害来源的一张手牌(随机)。你进行判定时,可以打出一张手牌替换之(鬼才)。',
    caps:{ guicai:true },
    hooks:{
      // 受伤后从伤害来源随机获得一张手牌。ctx={amount, sourceSeat}。
      onDamaged(g, seat, ctx){
        const src = (typeof ctx.sourceSeat==='number') ? g.players[ctx.sourceSeat] : null;
        if(!src || ctx.sourceSeat===seat || !src.alive) return; // 无效来源/是自己/已阵亡 -> 静默跳过
        if((src.hand||[]).length===0){
          g.log = pushLog(g.log, g.players[seat].name+' 【反馈】发动,但 '+src.name+' 无牌可获得');
          return;
        }
        const j = Math.floor(Math.random()*src.hand.length);
        g.players[seat].hand.push(removeHandCards(g, ctx.sourceSeat, j)[0]);
        g.log = pushLog(g.log, g.players[seat].name+' 【反馈】发动,获得 '+src.name+' 一张牌');
        markSkillSound(g, '反馈');
      }
    } },
  xiahoudun:     { id:'xiahoudun',     name:'夏侯惇', gender:'male', faction:'wei', maxHp:4, skill:'刚烈',
    desc:'当你受到伤害后,你可以进行判定,若结果不为红桃,伤害来源选择弃置2张手牌或受到你造成的1点伤害。',
    hooks:{
      onDamaged(g, seat, ctx){
        const self=g.players[seat];
        const sourceSeat=ctx && ctx.sourceSeat;
        const source=(typeof sourceSeat==='number') ? g.players[sourceSeat] : null;
        if(!self || !self.alive || !source || !source.alive || sourceSeat===seat || ctx.srcType==='ganglie') return;
        // 【系统性扫描发现的遗漏,和郭嘉遗计yijiAsk同一批】补setResponseAskedAt,否则
        // maybeAutoRespondTimeout的askedAt守卫永远拦在最前面,30秒超时兜底对这个pending
        // 形同虚设。
        g.pending=setResponseAskedAt({type:'ganglieAsk', seat, sourceSeat, resume:{type:ctx.srcType}});
        g.phase='ganglieAsk';
        g.log=pushLog(g.log, self.name+' 是否发动【刚烈】,对 '+source.name+' 进行判定反击…');
      }
    } },
  xuchu:         { id:'xuchu',         name:'许褚',   gender:'male', faction:'wei', maxHp:4, skill:'裸衣',
    desc:'摸牌阶段,你可以少摸1张牌。若如此做,直到本回合结束,你使用【杀】或【决斗】造成的伤害+1。',
    caps:{ luoyi:true } },
  yanliangwenchou:{ id:'yanliangwenchou', name:'颜良文丑', gender:'male', faction:'qun', maxHp:4, skill:'双雄',
    desc:'摸牌阶段,你可以放弃摸牌并进行一次判定,获得判定牌。直到本回合结束,你可以将一张与判定牌颜色不同的手牌当【决斗】使用。',
    caps:{ shuangxiong:true } },
  xunyu:         { id:'xunyu',         name:'荀彧',   gender:'male', faction:'wei', maxHp:3, skill:'驱虎/节命',
    desc:'驱虎:出牌阶段限一次,你可以与一名体力值大于你的角色拼点。若你赢,该角色对其攻击范围内由你选择的一名角色造成1点伤害;若你没赢,该角色对你造成1点伤害。节命:每受到1点伤害后,你可以令一名角色摸牌至手牌数等于体力上限,最多摸至5张。',
    caps:{ quhu:true },
    hooks:{
      onDamaged(g, seat, ctx){
        const p=g.players[seat];
        if(!p || !p.alive || (ctx && ctx.srcType)==='jieming') return;
        const amount=Math.max(1, (ctx && ctx.amount) || 1);
        g.pending={type:'jiemingAsk', seat, remaining:amount, resume:{type:ctx.srcType}};
        g.phase='jiemingAsk';
        g.log=pushLog(g.log, p.name+' 是否发动【节命】,令一名角色补牌…');
      }
    } },
  daqiao:        { id:'daqiao',        name:'大乔',   gender:'female', faction:'wu', maxHp:3, skill:'国色/流离',
    desc:'国色:出牌阶段,你可以将一张方块牌当【乐不思蜀】使用。流离:当你成为其他角色使用【杀】的目标时,你可以弃置一张牌,将此【杀】转移给你攻击范围内的另一名其他角色(不能是此【杀】的使用者)。',
    caps:{ guose:true, liuli:true } },
  xiaoqiao:      { id:'xiaoqiao',      name:'小乔',   gender:'female', faction:'wu', maxHp:3, skill:'天香/红颜',
    desc:'天香:当你受到伤害时,你可以弃置一张红桃手牌并选择一名其他角色,防止此伤害,改为该角色受到此伤害,然后其摸等同于已损失体力值的牌。红颜:锁定技,你的黑桃牌均视为红桃牌。',
    caps:{ tianxiang:true, hongyan:true } },
  pangtong:      { id:'pangtong',      name:'庞统',   gender:'male', faction:'shu', maxHp:3, skill:'连环/涅槃',
    desc:'连环:你可以将一张梅花手牌当【铁索连环】使用或重铸。涅槃:限定技,当你处于濒死状态时,你可以弃置所有牌,解除连环状态和翻面,摸3张牌并将体力回复至3点。',
    caps:{ lianhuan:true, niepan:true } },
  masu:        { id:'masu',        name:'马谡',   gender:'male', faction:'shu', maxHp:3, skill:'散谣/制蛮',
    desc:'散谣:出牌阶段限一次,你可以弃置一张牌,对全场体力值最大的一名角色造成1点伤害。制蛮:当你对其他角色造成伤害时,你可以防止此伤害,然后获得其场上的一张牌。',
    caps:{ sanyao:true, zhimeng:true } },
  machao:        { id:'machao',        name:'马超',   gender:'male', faction:'shu', maxHp:4, skill:'马术/铁骑',
    desc:'马术(锁定技):你计算与其他角色的距离时始终-1(可与装备的-1马叠加)。铁骑:当你使用【杀】指定一名角色为目标后,你可以进行判定,若结果为红色,此【杀】不可被【闪】抵消(含视为闪的效果,如八卦阵)。',
    caps:{ extraMinus1:true, tieqi:true } },
  lidian:        { id:'lidian',        name:'李典',   gender:'male', faction:'wei', maxHp:3, skill:'恂恂/忘隙',
    desc:'恂恂:摸牌阶段,你可以放弃摸牌,改为亮出牌堆顶至多4张牌,获得其中2张,其余按任意顺序置于牌堆底。忘隙:每当一名其他角色对你造成1点伤害后,或你对其他角色造成1点伤害后,你与其各摸1张牌(每点伤害触发一次,可选发动)。',
    // 忘隙不在 hooks.onDamaged 挂:与 dealDamage 造成侧统一入口,避免双路径互盖 pending
    caps:{ xunxun:true, wangxi:true } },
  pangde:        { id:'pangde',        name:'庞德',   gender:'male', faction:'wei', maxHp:4, skill:'马术/猛进',
    desc:'马术(锁定技):你计算与其他角色的距离时始终-1(可与装备的-1马叠加)。猛进:当你使用的【杀】被目标角色的【闪】抵消时,你可以弃置其一张牌。',
    caps:{ extraMinus1:true, mengjin:true } },
  menghuo:       { id:'menghuo',       name:'孟获',   gender:'male', faction:'qun', maxHp:4, skill:'祸首/再起',
    desc:'祸首：锁定技，南蛮入侵对你无效；其他角色使用南蛮入侵结算时，你成为伤害来源。再起：摸牌阶段，若你已受伤，可放弃摸牌，亮出牌堆顶X张牌，X为你已损失体力值，每有一张红桃回复1点体力，然后将这些牌置入弃牌堆。',
    caps:{ huoshou:true, zaiqi:true } },
  zhenji:        { id:'zhenji',        name:'甄姬',   gender:'female', faction:'wei', maxHp:3, skill:'洛神/倾国',
    desc:'洛神:回合开始时,你可以进行判定,若结果为黑色,你获得这张判定牌(计入手牌),并可以再次发动(直到红色或你选择停止)。倾国:你可以将黑色手牌当【闪】使用或打出。',
    caps:{ luoshen:true, qingguo:true } },
  zhangliao:     { id:'zhangliao',     name:'张辽',   gender:'male', faction:'wei', maxHp:4, skill:'突袭',
    desc:'摸牌阶段,你可以放弃摸牌,改为从至多两名其他角色的手牌中各摸一张牌。',
    caps:{ tuxi:true } },
  ganning:       { id:'ganning',       name:'甘宁',   gender:'male', faction:'wu', maxHp:4, skill:'奇袭',
    desc:'你可以将任意一张黑色手牌当【过河拆桥】使用。',
    caps:{ qixi:true } },
  huanggai:      { id:'huanggai',      name:'黄盖',   gender:'male', faction:'wu', maxHp:4, skill:'苦肉',
    desc:'出牌阶段,你可以失去1点体力,然后摸两张牌。',
    caps:{ kurou:true } },
  huaxiong:      { id:'huaxiong',      name:'华雄',   gender:'male', faction:'qun', maxHp:6, skill:'耀武',
    desc:'耀武(锁定技):当你受到红色【杀】造成的伤害时，伤害来源选择一项：1.回复1点体力；2.摸一张牌。',
    caps:{ yaowu:true } },
  huangyueying:  { id:'huangyueying',  name:'黄月英', gender:'female', faction:'shu', maxHp:3, skill:'集智',
    desc:'当你使用一张锦囊牌时,你可以摸一张牌。',
    caps:{ jizhi:true } },
  sunquan:       { id:'sunquan',       name:'孙权',   gender:'male', faction:'wu', maxHp:4, skill:'制衡/救援',
    desc:'制衡:出牌阶段限一次,你可以弃置任意张牌,然后摸等量的牌。救援:主公技,锁定技,其他吴势力角色对你使用【桃】的回复值+1。',
    caps:{ zhiheng:true, jiuyuan:true } },
  zhouyu:        { id:'zhouyu',        name:'周瑜',   gender:'male', faction:'wu', maxHp:3, skill:'英姿/反间',
    desc:'英姿:锁定技,摸牌阶段你额外摸一张牌。反间:出牌阶段限一次,你可以令一名其他角色选择一种花色,然后获得你一张手牌并展示;若花色不同,其受到你造成的1点伤害。',
    caps:{ extraDrawPhase:1, fanjian:true } },
  sunce:         { id:'sunce',         name:'孙策',   gender:'male', faction:'wu', maxHp:4, skill:'激昂/魂姿/制霸',
    desc:'激昂:当你使用【决斗】或红色【杀】指定目标后,或成为【决斗】或红色【杀】的目标后,你可以摸一张牌。魂姿:觉醒技,准备阶段,若你的体力值为1,你减1点体力上限,然后获得【英姿】和【英魂】。制霸:主公技,其他吴势力角色的出牌阶段限一次,其可以与你拼点;若你已发动【魂姿】,你可以拒绝此拼点。其没赢后,你获得双方拼点的牌。',
    caps:{ jiang:true, hunzi:true, zhiba:true } },
  huatuo:        { id:'huatuo',        name:'华佗',   gender:'male', faction:'qun', maxHp:3, skill:'青囊/急救',
    desc:'青囊:出牌阶段限一次,你可以弃置一张手牌,令一名已受伤的角色回复1点体力。急救:你的回合外,你可以将一张红色牌当【桃】使用。',
    caps:{ qingnang:true, jijiu:true } },
  liubei:        { id:'liubei',        name:'刘备',   gender:'male', faction:'shu', maxHp:4, skill:'仁德/激将',
    desc:'仁德:出牌阶段,你可以将任意数量的手牌交给其他角色,若本阶段内给出的牌达到2张或以上,你回复1点体力。激将:主公技,当需要使用或打出一张【杀】时,可令其他角色替出。',
    caps:{ rende:true, jijiang:true } },
  caocao:        { id:'caocao',        name:'曹操',   gender:'male', faction:'wei', maxHp:4, skill:'奸雄/护驾',
    desc:'奸雄:当你受到伤害后,你可以获得对你造成伤害的牌。护驾:主公技,当需要使用或打出一张【闪】时,可令其他角色替出。',
    caps:{ hujia:true },
    hooks:{
      onDamaged(g, seat, ctx){
        const p=g.players[seat];
        const source=ctx && ctx.sourceCard;
        if(!p || !p.alive || !source) return;
        const cards=Array.isArray(source) ? source : [source];
        const gained=[];
        cards.forEach(card=>{
          if(!card) return;
          const idx=(g.discard||[]).findIndex(c=>c===card || (c && card.id!==undefined && c.id===card.id));
          if(idx<0) return;
          gained.push(g.discard.splice(idx,1)[0]);
        });
        if(gained.length===0) return;
        p.hand.push(...gained);
        g.log=pushLog(g.log, p.name+' 发动【奸雄】,获得造成伤害的'+gained.map(c=>'【'+c.name+'】').join('、'));
        markSkillSound(g, '奸雄');
      }
    } },
  guanyu:        { id:'guanyu',        name:'关羽',   gender:'male', faction:'shu', maxHp:4, skill:'武圣',
    desc:'你可以将任意一张红色手牌当【杀】使用或打出。',
    caps:{ wusheng:true } },
  huangzhong:    { id:'huangzhong',    name:'黄忠',   gender:'male', faction:'shu', maxHp:4, skill:'烈弓',
    desc:'出牌阶段,你使用【杀】指定一名角色为目标后,若该角色手牌数≥你的体力值,或手牌数≤你的攻击范围,你可以令此【杀】不可被【闪】抵消。',
    caps:{ liegong:true } },
  xuhuang:       { id:'xuhuang',       name:'徐晃',   gender:'male', faction:'wei', maxHp:4, skill:'断粮',
    desc:'出牌阶段限一次,你可以将一张黑色基本牌或黑色装备牌当【兵粮寸断】使用(距离2以内)。',
    caps:{ duanliang:true } },
  yujin:         { id:'yujin',         name:'于禁',   gender:'male', faction:'wei', maxHp:4, skill:'毅重',
    desc:'锁定技,若你的装备区里没有防具牌,黑色【杀】对你无效。',
    caps:{ yizhong:true } },
  yuejin:        { id:'yuejin',        name:'乐进',   gender:'male', faction:'wei', maxHp:4, skill:'骁果',
    desc:'其他角色的结束阶段,你可以弃置一张基本牌,然后该角色选择一项:弃置一张装备牌,你摸一张牌;或受到你造成的1点伤害。',
    caps:{ xiaoguo:true } },
  zhanghe:       { id:'zhanghe',       name:'张郃',   gender:'male', faction:'wei', maxHp:4, skill:'巧变',
    desc:'回合开始时(限一次),你可以弃置一张手牌并选择判定/摸牌/出牌/弃牌阶段之一跳过。若跳过的是出牌阶段,你可以将场上一张装备牌移到另一名角色的对应空槽,或将一张延时锦囊移到另一名角色没有同名锦囊的判定区。',
    caps:{ qiaobian:true } },
  lvbu:          { id:'lvbu',          name:'吕布',   gender:'male', faction:'qun', maxHp:4, skill:'无双',
    desc:'你使用【杀】指定目标后,该角色需要连续使用两张【闪】才能抵消。你或你的对手使用/成为【决斗】的目标时,每次响应需要连续打出两张【杀】。',
    caps:{ wushuang:true } },
  zhuge:         { id:'zhuge',         name:'诸葛亮', gender:'male', faction:'shu', maxHp:3, skill:'观星/空城',
    desc:'观星:准备阶段,你可以观看牌堆顶的X张牌(X为存活角色数且最多为5),以任意顺序分配至牌堆顶或牌堆底。空城:锁定技,若你没有手牌,你不能成为【杀】或【决斗】的目标。',
    caps:{ guanxing:true, kongcheng:true } },
  jiangwei:      { id:'jiangwei',      name:'姜维',   gender:'male', faction:'shu', maxHp:4, skill:'挑衅/志继',
    desc:'挑衅:出牌阶段限一次,你可指定一名其他角色,令其选择一项:1.对你使用一张杀;2.令你弃置其一张牌。志继:觉醒技,准备阶段,若你没有手牌,你减1点体力上限,回复1点体力或摸两张牌,然后获得技能观星。',
    caps:{ tiaoxin:true, zhiji:true },
    hooks:{ } },
  zhoutai:        { id:'zhoutai',        name:'周泰',   gender:'male', faction:'wu', maxHp:4, skill:'不屈',
    desc:'当你的体力降到0或以下时,可以选择放置一张不屈牌。所有回复体力的场景都会触发移除一张不屈牌,最后一张被移除时恢复1点体力。',
    caps:{ buqu:true },
    hooks:{ } },
  weiyan:        { id:'weiyan',        name:'魏延',   gender:'male', faction:'shu', maxHp:4, skill:'狂骨',
    desc:'锁定技，当你对一名角色造成伤害后，若其扣减体力前你计算与其的距离不大于1，你回复等同于伤害点数的体力。',
    caps:{ kuanggu:true } },
  lusu:          { id:'lusu',          name:'鲁肃',   gender:'male', faction:'wu', maxHp:3, skill:'好施/缔盟',
    desc:'好施:摸牌阶段,你可以多摸两张牌,然后若你的手牌数大于5,你将一半的手牌(向下取整)交给除你以外全场手牌数最少的一名其他角色。缔盟:出牌阶段限一次,你可以选择两名其他角色并弃置X张牌(X为这两名角色的手牌数之差),令他们交换手牌。',
    caps:{ haoshi:true, extraDrawPhase:2, dimeng:true } },
  xiahouyuan:    { id:'xiahouyuan',    name:'夏侯渊', gender:'male', faction:'wei', maxHp:4, skill:'神速',
    desc:'神速:出牌阶段限一次,你可以选择:1.准备阶段结束后,可以跳过判定和摸牌阶段,视为使用一张无距离限制的【杀】,然后进入出牌阶段;2.摸牌阶段结束后,可以跳过出牌阶段并弃置一张装备牌,视为使用一张无距离限制的【杀】,然后进入弃牌阶段。',
    caps:{ shensu:true } },
  taishici:      { id:'taishici',      name:'太史慈',   gender:'male', faction:'wu', maxHp:4, skill:'天义',
    desc:'天义:出牌阶段限一次,你可以与一名角色拼点,然后本阶段:若你赢,则你使用【杀】的次数上限+1、使用【杀】无距离限制、使用【杀】的目标数上限+1;否则你不能使用【杀】。',
    caps:{ tianyi:true } },
  dianwei:       { id:'dianwei',       name:'典韦',   gender:'male', faction:'wei', maxHp:4, skill:'强袭',
    desc:'强袭:出牌阶段限一次,你可以失去1点体力或弃置一张武器牌(装备区或手牌),对你攻击范围内的一名其他角色造成1点伤害。',
    caps:{ qiangxi:true } },
  gongsunzan:    { id:'gongsunzan',    name:'公孙瓒', gender:'male', faction:'qun', maxHp:4, skill:'趫猛/义从',
    desc:'趫猛:当你使用黑色【杀】对一名角色造成伤害后,你可以选择其装备区里的一张牌,若此牌:为坐骑牌,你获得之;不为坐骑牌,你弃置之。义从:锁定技,①若你的体力值大于2,你计算与其他角色的距离-1;②若你的体力值不大于2,其他角色计算与你的距离+1。',
    caps:{ qiaomeng:true, yicong:true } },
  jiaxu:         { id:'jiaxu',         name:'贾诩',   gender:'male', faction:'wei', maxHp:3, skill:'完杀/乱武/帷幕',
    desc:'完杀:锁定技,你的回合内,当一名角色进入濒死状态时,除你和其以外的角色不能对其使用【桃】直到此次濒死结算结束。乱武:限定技,出牌阶段,你可以令所有其他角色依次选择一项:1.对距离最近的另一名角色使用一张【杀】;2.失去1点体力。帷幕:锁定技,你不能成为黑色锦囊牌的目标。',
    caps:{ wansha:true, luanwu:true, weimu:true } },
  yuanshao:      { id:'yuanshao',      name:'袁绍',   gender:'male', faction:'qun', maxHp:4, skill:'乱击/血裔',
    desc:'乱击:出牌阶段,你可以将两张花色相同的手牌当【万箭齐发】使用。血裔:主公技,锁定技,你的手牌上限+X,X为其他群势力角色数的两倍。',
    caps:{ luanji:true, xueyi:true } },
  yuanshu:       { id:'yuanshu',       name:'袁术',   gender:'male', faction:'qun', maxHp:4, skill:'妄尊/同疾',
    desc:'妄尊:主公的准备阶段,你可以摸一张牌,然后其本回合的手牌上限-1。同疾:锁定技,若你的手牌数大于体力值,攻击范围内包含你的其他角色使用【杀】不能指定除你以外的角色为目标。',
    caps:{ tongji:true, wangzun:true } },
  zhangjiao:     { id:'zhangjiao',     name:'张角',   gender:'male', faction:'qun', maxHp:3, skill:'雷击/鬼道/黄天',
    desc:'雷击:当你使用或打出【闪】时,你可以令一名角色进行一次判定,若结果为♠,你对其造成2点雷电伤害。鬼道:当一名角色的判定牌生效前,你可以打出一张黑色牌替换之。黄天:主公技,其他群势力角色的出牌阶段限一次,其可以交给你一张【闪】或【闪电】。',
    caps:{ leiji:true, guidu:true, huangtian:true } },
  caiwenji:      { id:'caiwenji',      name:'蔡文姬', gender:'female', faction:'wei', maxHp:3, skill:'悲歌/断肠',
    desc:'悲歌:当一名角色受到【杀】造成的伤害后,你可以弃置一张牌,令其判定,若结果为:红桃,其回复1点体力;方块,其摸两张牌;梅花,伤害来源弃置两张牌;黑桃,伤害来源翻面。断肠:锁定技,当你死亡时,杀死你的角色失去所有武将技能。',
    caps:{ beige:true, duanchang:true } },
  caoren:       { id:'caoren',       name:'曹仁',   gender:'male', faction:'wei', maxHp:4, skill:'据守',
    desc:'据守:结束阶段,你可以摸三张牌,然后将你的武将牌翻面。',
    caps:{ jushou:true } },
  chengong:      { id:'chengong',      name:'陈宫',   gender:'male', faction:'qun', maxHp:3, skill:'明策/智迟',
    desc:'明策:出牌阶段限一次,你可以交给一名其他角色一张装备牌或【杀】,并选择其攻击范围内的另一名角色(若无则不选择),令其选择一项:1.视为对你选择的角色使用一张普通【杀】;2.摸一张牌。智迟:锁定技,当你于回合外受到伤害后,【杀】和普通锦囊牌对你无效直至本回合结束。',
    caps:{ mingce:true, zhichi:true } },
  zhurong:       { id:'zhurong',       name:'祝融',   gender:'female', faction:'qun', maxHp:4, skill:'巨象/烈刃',
    desc:'巨象:锁定技,①【南蛮入侵】对你无效;②当其他角色使用的【南蛮入侵】结算结束后置入弃牌堆时,你获得之。烈刃:当你使用【杀】对目标角色造成伤害后,你可以与其拼点,若你赢,你获得该角色的一张牌。',
    caps:{ juxiang:true, lieRen:true } },
  lingtong:       { id:'lingtong',       name:'凌统',   gender:'male', faction:'wu', maxHp:4, skill:'旋风',
    desc:'旋风:当你于弃牌阶段弃置过至少两张牌,或当你失去装备区里的牌后,你可以依次弃置任意名其他角色的共计至多两张牌。',
    caps:{ xuanfeng:true },
    hooks:{
      onLoseEquip:(g, seat, ctx)=>{
        const me = g.players[seat];
        // 旋风：失去装备区的牌后触发（回合内外都可以触发）
        // 注意：seat 是失去装备的玩家，当该玩家是凌统且存活时触发
        if (hasCap(me, 'xuanfeng') && me.alive) {
          // 记录触发时的phase用于状态回滚
          const previousPhase = g.phase;
          
          // 进入旋风选择阶段
          g.pending = {
            type: 'xuanfengPick',
            from: seat,
            trigger: 'equip',
            targets: [],
            discardedCounts: [],
            selections: [],
            maxRemaining: 2,
            stage: 'selecting',
            previousPhase: previousPhase
          };
          g.phase = 'xuanfengPick';
          g.log=pushLog(g.log, me.name + ' 失去装备,可以发动【旋风】,弃置其他角色的共计至多两张牌');
          markSkillSound(g, '旋风');
        }
      }
    } },
  fazheng:       { id:'fazheng',       name:'法正',   gender:'male', faction:'shu', maxHp:3, skill:'恩怨/眩惑',
    desc:'恩怨:锁定技,①当其他角色令你回复1点体力后,其摸一张牌;②当你受到其他角色对你造成的伤害后,其选择一项:1.交给你一张♥手牌;2.失去1点体力。眩惑:出牌阶段限一次,你可以交给一名其他角色一张♥手牌,然后你获得该角色的一张牌,并将此牌交给另一名其他角色。',
    caps:{ enyuan:true, huanhuo:true } },
  dingfeng:       { id:'dingfeng',       name:'丁奉',   gender:'male', faction:'wu', maxHp:4, skill:'短兵/奋迅',
    desc:'短兵:你使用【杀】时可以多选择一名距离为1的角色为目标。奋迅:出牌阶段限一次,你可以弃置一张牌,令你本回合计算与一名其他角色的距离视为1。',
    caps:{ duanbing:true, fenxun:true } },
  caochong:       { id:'caochong',       name:'曹冲',   gender:'male', faction:'wei', maxHp:3, skill:'称象/仁心',
    desc:'称象:当你受到伤害后,你可以亮出牌堆顶的四张牌,获得其中任意张点数之和不大于13的牌。仁心:当其他角色受到伤害时,若其体力值为1,你可以翻面并弃置一张装备牌,防止此伤害。',
    caps:{ chengxiang:true, renxin:true } },
  xushu:          { id:'xushu',          name:'徐庶',   gender:'male', faction:'shu', maxHp:3, skill:'无言/举荐',
    desc:'无言:锁定技,你使用锦囊牌造成伤害时防止之;你受到锦囊牌伤害时防止之。举荐:结束阶段,你可以弃置一张非基本牌,令一名其他角色选择:摸两张牌/回复1点体力/复原武将牌。',
    caps:{ wuyan:true, jujian:true } },
  caozhang:       { id:'caozhang',       name:'曹彰',   gender:'male', faction:'wei', maxHp:4, skill:'将驰',
    desc:'将驰:摸牌阶段,你可以选择一项:1.多摸1张,本回合不能使用或打出杀;2.少摸1张,本回合使用杀无距离限制且可多使用1张杀;3.不发动。',
    caps:{ jiangchi:true } },
  caozhi:         { id:'caozhi',         name:'曹植',   gender:'male', faction:'wei', maxHp:3, skill:'落英/酒诗',
    desc:'落英:当其他角色的梅花牌因判定或弃置进入弃牌堆时,你可以获得之。酒诗:当你需要使用【酒】时,若你的武将牌正面朝上,你可以翻面,视为使用一张【酒】；当你受到伤害后,若此时与你受到此伤害时你的武将牌均背面朝上,你可以翻面。',
    caps:{ luoying:true, jiushi:true } },
  yuji:           { id:'yuji',           name:'于吉',   gender:'male', faction:'qun', maxHp:3, skill:'蛊惑/缠怨',
    desc:'蛊惑:每回合限一次,你可以扣置一张手牌,将此牌当任意一张基本牌或普通锦囊牌使用或打出,其他角色可质疑。若为假,此牌作废;若为真,质疑角色获得【缠怨】。缠怨:锁定技,你不能质疑【蛊惑】;当你的体力值为1时,你的所有其他技能失效。',
    caps:{ guhuo:true } },
  // 左慈【化身/新生】(v2 完整版:化身+更改化身+新生均已实现)。
  // 新生按荀彧【节命】(jiemingAsk/continueJieming/respondJieming/finishJieming)同一套
  // "remaining 计数循环"四段式实现,见 continueXinsheng/respondXinshengAsk/
  // finishXinsheng(skills.js)——每受到1点伤害独立问一次是否发动,不是"看总伤害点数
  // 只问一次"。这次是 zuoci 自己的普通 onDamaged hook,和节命/遗计的接入方式完全
  // 一致,不涉及 v1 那套"借用的技能自己的hook是否优先触发"的排队机制——新生不关心
  // 借用的技能有没有生效,只是左慈本人受伤后的一个独立技能。
  zuoci: { id:'zuoci', name:'左慈', gender:'male', faction:'qun', maxHp:3, skill:'化身/新生',
    desc:'化身:你可以选择借用其他一名武将的单个技能(可在回合开始/结束时重新声明)。'+
      '新生:每受到1点伤害后,你可以获得一个新的武将(将其加入可借用的武将库,不立即声明借用)。',
    caps:{ huashen:true },
    hooks:{
      onDamaged(g, seat, ctx){
        const p=g.players[seat];
        if(!p || !p.alive) return;
        const amount=Math.max(1, (ctx && ctx.amount) || 1);
        g.pending={type:'xinshengAsk', seat, remaining:amount, resume:{type:ctx.srcType}};
        g.phase='xinshengAsk';
        g.log=pushLog(g.log, p.name+' 是否发动【新生】,获得一个新的武将…');
      }
    } },
};
const GENERAL_IDS = Object.keys(GENERALS);
function getGeneral(id){ return GENERALS[id] || null; } // 唯一查询入口

// ---------- 左慈【化身】技能拆分表 ----------
// HUASHEN_SKILL_TABLE:把 GENERALS 里每个武将"整个打包"的 caps/hooks,按单个技能名的粒度
// 拆开,供左慈【化身】(选择借用其他武将的单个技能)使用。覆盖 GENERALS 里当前已实现的全部
// 64 个武将(左慈自己除外),每条 caps/hooks key 均已用脚本逐一核对确认真实存在于对应武将的
// GENERALS 条目里(无编造/无遗漏)。
//
// 【架构约定,后续实现化身逻辑时必须遵守】任何时候只应动态查询"左慈当前借用的那个具体武将id"
// 对应的 cap/hook 值,绝不能把借来的值静态复制/覆写到 player.caps 等对象上——否则会有多个武将
// 共用同一个 cap key 时的覆盖风险(如周瑜【英姿】和鲁肃【好施】都用 caps.extraDrawPhase,一个是
// 数值1、一个是数值2;若静态复制,后借的值会覆盖先借的,且卸下/切换借用技能后不会自动失效)。
// 正确做法应类似 hasCap/generalHasCap 的实时查询模式:hasCap(player,cap) 从不缓存,每次都重新
// 从 getGeneral(player.general) 现查——化身借用的技能同理,应该是"每次查询时现查左慈当前借用的
// 是哪个武将/技能",而不是"借用那一刻就把值写死"。
//
// 【凌统"旋风"特例】lingtong 唯一一条同时标了 caps 和 hook——caps.xuanfeng 和
// hooks.onLoseEquip 服务于同一个技能(不是两个不同技能),借用时两者必须作为整体一起生效,
// 只借其一无意义(只借 cap 没有实际触发逻辑;只借 hook 则查询"是否有旋风能力"的地方会查不到)。
//
// 【袁术"妄尊"未纳入】yuanshu 的 GENERALS.desc 提到"妄尊"(作用于主公的普通武将技,主公准备阶段摸一张牌、
// 手牌上限-1)和"同疾"两个技能名,但 GENERALS.caps 里只有 tongji 一个 key,对应"同疾"——
// 手牌上限-1)和"同疾"两个技能名。妄尊依赖身份局主公时机,不适合作为化身候选,
// 因此这里只收"同疾"一条。
//
// 【马谡"散谣"未纳入】masu 条目本该有"散谣"(caps:['sanyao'])+"制蛮"(caps:['zhimeng'])
// 两条,这次审查 generalHasCap->hasCap 时核实发现:sanyao 这个 cap 从未被任何
// hasCap/generalHasCap 查询过(发动函数 startSanyao 只检查 g.sanyaoUsed/g.phase,不检查
// 是不是马谡),且 startSanyao 本身在全项目里没有任何调用点——散谣对马谡本体来说都是
// 完全无法触发的死代码,不是"借了没生效"这么简单,是"压根没有能借的东西"。这里只保留
// "制蛮"一条,等马谡本体的散谣补上真正的触发入口(见 CLAUDE.md「已知的待优化点」)后
// 再考虑加回。
//
// 【限定技/主公技/觉醒技/获得技能——本表暂不做类型过滤】官方"化身"规则通常要求排除
// 限定技(一局限一次的技能,如庞统涅槃niepan)、主公技(袁术妄尊/刘备激将/曹操护驾/
// 孙策制霸——这几个因为项目无身份局系统压根没被写进GENERALS.caps,天然不会出现在
// 本表)、觉醒技(如姜维志继zhiji)、以及"觉醒/特殊条件下才动态获得的技能"(志继本身
// 触发后会让姜维player.caps.guanxing=true,这是运行时追加的能力,和本表这种静态查表
// 结构是两回事)。
// 本表当前**不含任何技能类型分类元数据**,姜维志继/庞统涅槃这类技能和普通caps技能
// 一视同仁被收录,均可被化身/新生声明借用——比如借到志继,hasCap(左慈,'zhiji')会
// 因huashenHasCap生效,game.js里志继的觉醒判定(检查手牌是否为空等条件)是通用hasCap
// 入口,借用后左慈理论上真的能触发这套觉醒流程,而不是被静默挡住。
// 若以后要把这几类技能排除在化身候选之外,需要在respondHuashenPick/respondXinshengPick
// (或对应的新版本函数名,后续改动可能会重命名)的候选校验逻辑里,依据某种技能类型标记
// 过滤掉这些entry——本次暂不实现这个过滤,记在这里以防以后被误以为"什么都能借、这是
// 故意的最终设计"。
const HUASHEN_SKILL_TABLE = {
  zhangfei: [
    { name:'咆哮', caps:['unlimitedSha'] }
  ],
  guojia: [
    { name:'天妒', caps:['tiandu'] },
    { name:'遗计', hook:'onDamaged' }
  ],
  sunshangxiang: [
    { name:'枭姬', hook:'onLoseEquip' }
  ],
  diaochan: [
    { name:'离间', caps:['lijian'] },
    { name:'闭月', caps:['biyue'] }
  ],
  kongrong: [
    { name:'礼让', caps:['lirang'] },
    { name:'争义', caps:['zhengyi'] }
  ],
  zhaoyun: [
    { name:'龙胆', caps:['longdan'] }
  ],
  lvmeng: [
    { name:'克己', caps:['keji'] }
  ],
  simayi: [
    { name:'反馈', hook:'onDamaged' },
    { name:'鬼才', caps:['guicai'] }
  ],
  xiahoudun: [
    { name:'刚烈', hook:'onDamaged' }
  ],
  xuchu: [
    { name:'裸衣', caps:['luoyi'] }
  ],
  yanliangwenchou: [
    { name:'双雄', caps:['shuangxiong'] }
  ],
  xunyu: [
    { name:'驱虎', caps:['quhu'] },
    { name:'节命', hook:'onDamaged' }
  ],
  daqiao: [
    { name:'国色', caps:['guose'] },
    { name:'流离', caps:['liuli'] }
  ],
  xiaoqiao: [
    { name:'天香', caps:['tianxiang'] },
    { name:'红颜', caps:['hongyan'] }
  ],
  pangtong: [
    { name:'连环', caps:['lianhuan'] },
    { name:'涅槃', caps:['niepan'] }
  ],
  // 马谡【散谣】这次刻意不纳入可借用范围——核实发现 sanyao 这个 cap 从未被任何
  // hasCap/generalHasCap 查询过(散谣的发动函数 startSanyao 只检查 g.sanyaoUsed/
  // g.phase,不检查是不是马谡),且 startSanyao 本身在全项目里没有任何调用点(没有对应
  // 的UI按钮/respond函数触发它)——散谣对马谡本体来说都是完全无法触发的死代码,不是
  // "借了没生效"这么简单,是"压根没有能借的东西"。借一个连本体都触发不了的技能没有
  // 意义,等马谡本体的散谣补上真正的触发入口之后再考虑加回这一条(该问题已单独记入
  // CLAUDE.md「已知的待优化点」,不在这次改动范围内解决)。
  masu: [
    { name:'制蛮', caps:['zhimeng'] }
  ],
  machao: [
    { name:'马术', caps:['extraMinus1'] },
    { name:'铁骑', caps:['tieqi'] }
  ],
  lidian: [
    { name:'恂恂', caps:['xunxun'] },
    { name:'忘隙', caps:['wangxi'] }
  ],
  pangde: [
    { name:'马术', caps:['extraMinus1'] },
    { name:'猛进', caps:['mengjin'] }
  ],
  menghuo: [
    { name:'祸首', caps:['huoshou'] },
    { name:'再起', caps:['zaiqi'] }
  ],
  zhenji: [
    { name:'洛神', caps:['luoshen'] },
    { name:'倾国', caps:['qingguo'] }
  ],
  zhangliao: [
    { name:'突袭', caps:['tuxi'] }
  ],
  ganning: [
    { name:'奇袭', caps:['qixi'] }
  ],
  huanggai: [
    { name:'苦肉', caps:['kurou'] }
  ],
  huaxiong: [
    { name:'耀武', caps:['yaowu'] }
  ],
  huangyueying: [
    { name:'集智', caps:['jizhi'] }
  ],
  sunquan: [
    { name:'制衡', caps:['zhiheng'] }
  ],
  zhouyu: [
    { name:'英姿', caps:['extraDrawPhase'], note:'数值型cap,值为1' },
    { name:'反间', caps:['fanjian'] }
  ],
  sunce: [
    { name:'激昂', caps:['jiang'] }
  ],
  huatuo: [
    { name:'青囊', caps:['qingnang'] },
    { name:'急救', caps:['jijiu'] }
  ],
  liubei: [
    { name:'仁德', caps:['rende'] }
  ],
  caocao: [
    { name:'奸雄', hook:'onDamaged' }
  ],
  guanyu: [
    { name:'武圣', caps:['wusheng'] }
  ],
  huangzhong: [
    { name:'烈弓', caps:['liegong'] }
  ],
  xuhuang: [
    { name:'断粮', caps:['duanliang'] }
  ],
  yujin: [
    { name:'毅重', caps:['yizhong'] }
  ],
  yuejin: [
    { name:'骁果', caps:['xiaoguo'] }
  ],
  zhanghe: [
    { name:'巧变', caps:['qiaobian'] }
  ],
  lvbu: [
    { name:'无双', caps:['wushuang'] }
  ],
  zhuge: [
    { name:'观星', caps:['guanxing'] },
    { name:'空城', caps:['kongcheng'] }
  ],
  jiangwei: [
    { name:'挑衅', caps:['tiaoxin'] },
    { name:'志继', caps:['zhiji'], note:'觉醒技,hooks为空对象{},当前无额外触发逻辑' }
  ],
  zhoutai: [
    { name:'不屈', caps:['buqu'], note:'hooks为空对象{},当前无额外触发逻辑' }
  ],
  weiyan: [
    { name:'狂骨', caps:['kuanggu'] }
  ],
  lusu: [
    { name:'好施', caps:['haoshi','extraDrawPhase'], note:'摸牌+2与交牌门槛判定同属好施一个技能,需整体借用,见本表顶部架构约定' },
    { name:'缔盟', caps:['dimeng'] }
  ],
  xiahouyuan: [
    { name:'神速', caps:['shensu'] }
  ],
  taishici: [
    { name:'天义', caps:['tianyi'] }
  ],
  luxun: [
    { name:'谦逊', caps:['qianxun'] },
    { name:'连营', caps:['lianying'] }
  ],
  dianwei: [
    { name:'强袭', caps:['qiangxi'] }
  ],
  gongsunzan: [
    { name:'趫猛', caps:['qiaomeng'] },
    { name:'义从', caps:['yicong'] }
  ],
  jiaxu: [
    { name:'完杀', caps:['wansha'] },
    { name:'乱武', caps:['luanwu'] },
    { name:'帷幕', caps:['weimu'] }
  ],
  yuanshao: [
    { name:'乱击', caps:['luanji'] }
  ],
  yuanshu: [
    { name:'同疾', caps:['tongji'] }
  ],
  zhangjiao: [
    { name:'雷击', caps:['leiji'] },
    { name:'鬼道', caps:['guidu'] }
  ],
  caiwenji: [
    { name:'悲歌', caps:['beige'] },
    { name:'断肠', caps:['duanchang'] }
  ],
  caoren: [
    { name:'据守', caps:['jushou'] }
  ],
  chengong: [
    { name:'明策', caps:['mingce'] },
    { name:'智迟', caps:['zhichi'] }
  ],
  zhurong: [
    { name:'巨象', caps:['juxiang'] },
    { name:'烈刃', caps:['lieRen'] }
  ],
  lingtong: [
    { name:'旋风', caps:['xuanfeng'], hook:'onLoseEquip', note:'caps和hook共同构成同一技能,借用时必须整体一起生效,见本表顶部架构约定' }
  ],
  fazheng: [
    { name:'恩怨', caps:['enyuan'] },
    { name:'眩惑', caps:['huanhuo'] }
  ],
  dingfeng: [
    { name:'短兵', caps:['duanbing'] },
    { name:'奋迅', caps:['fenxun'] }
  ],
  caochong: [
    { name:'称象', caps:['chengxiang'] },
    { name:'仁心', caps:['renxin'] }
  ],
  xushu: [
    { name:'无言', caps:['wuyan'] },
    { name:'举荐', caps:['jujian'] }
  ],
  caozhang: [
    { name:'将驰', caps:['jiangchi'] }
  ],
  caozhi: [
    { name:'落英', caps:['luoying'] },
    { name:'酒诗', caps:['jiushi'] }
  ],
  yuji: [
    { name:'蛊惑', caps:['guhuo'] }
  ]
};

// validateHuashenPick: 校验"从pool里选一个武将+声明其一个技能"这个操作是否合法——
// generalId必须在pool里,skillName必须是HUASHEN_SKILL_TABLE[generalId]里真实存在的
// 技能名。供respondHuashenPick(开局初始声明)/respondHuashenChangePickStart/
// respondHuashenChangePickEnd(回合开始/结束的更改化身)共用,避免同一段校验逻辑写三遍。
function validateHuashenPick(pool, generalId, skillName){
  if(!Array.isArray(pool) || !pool.includes(generalId)) return false;
  const entries = HUASHEN_SKILL_TABLE[generalId];
  if(!entries || !entries.some(e=>e.name===skillName)) return false;
  return true;
}

function chanyuanLocksSkills(player){
  return !!(player && player.chanyuan && player.hp<=1);
}
// 查询某玩家的武将是否拥有某项被动能力(能力声明在 GENERALS.caps,业务层不写武将名)
function generalHasCap(player, cap){
  // 蔡文姬【断肠】等:武将技能整体失效后,不再从 GENERALS.caps 读取
  if(player && (player.skillsLost || chanyuanLocksSkills(player))) return false;
  const gen = player && getGeneral(player.general);
  return !!(gen && gen.caps && gen.caps[cap]);
}
// 读取数值型被动能力的值(无则返回 fallback),如 extraDrawPhase(摸牌阶段多摸 N 张;
// 周瑜【英姿】值为1、鲁肃【好施】值为2,两者共用同一个 cap key,见下方 huashenCapValue
// 的架构说明)。自己的武将有这个数值就优先用自己的,没有再查化身借用的技能——和
// huashenHasCap 接入 hasCap 时"自己优先、借用兜底"同一个优先级顺序。
function generalCapValue(player, cap, fallback){
  if(player && (player.skillsLost || chanyuanLocksSkills(player))) return fallback;
  const gen = player && getGeneral(player.general);
  const v = gen && gen.caps && gen.caps[cap];
  if(typeof v === 'number') return v;
  const runtime = player && player.caps && player.caps[cap];
  if(typeof runtime === 'number') return runtime;
  return huashenCapValue(player, cap, fallback);
}
// generalGender: 左慈声明借用某个武将后,性别视为与该武将相同(desc里写的"性别视为与该
// 武将相同"这句话由这里落地生效)——p.huashenGeneral 非 null 时查借用武将的性别,否则
// 查自己(p.general)的性别。开局刚分配武将、还没走完huashenPick声明这一刻,
// p.huashenGeneral 是 null(normalize 默认值),自然回退到查 p.general 本身,不会
// 出现异常;getGeneral 查无对应武将(理论不该发生的脏数据)也安全回退到 'male'。
function generalGender(player){
  if(player && player.huashenGeneral!=null){
    const borrowedGen = getGeneral(player.huashenGeneral);
    if(borrowedGen) return borrowedGen.gender || 'male';
  }
  const gen = player && getGeneral(player.general);
  return (gen && gen.gender) || 'male';
}
function isMale(player){ return generalGender(player)==='male'; }
// 两名角色武将性别是否不同(雌雄双股剑等)。走 generalGender,含左慈化身跟随。
function isOppositeGender(a, b){
  if(!a || !b) return false;
  return generalGender(a) !== generalGender(b);
}
// generalFaction:武将所属势力(wei/shu/wu/qun/jin)。逐行对应 generalGender——同样的
// 化身跟随分支(左慈【化身】借用别人的武将时,势力也跟着变:借曹操则算 wei)、同样的
// player.general 取法、同样的脏数据回退。展示层和未来的势力相关技能都统一走这一个函数,
// 不区分展示/规则两套(和 generalGender 一处定义、渲染和规则共用是同一个定位)。
// 回退值取 'qun'(群):脏数据/查无武将时,群是最"中性"的归属,不会误把某人算进某个阵营。
function generalFaction(player){
  if(player && player.huashenGeneral!=null){
    const borrowedGen = getGeneral(player.huashenGeneral);
    if(borrowedGen) return borrowedGen.faction || 'qun';
  }
  const gen = player && getGeneral(player.general);
  return (gen && gen.faction) || 'qun';
}
// FACTION_LABEL:势力值(wei/shu/wu/qun/jin)→显示单字(魏/蜀/吴/群/晋)。唯一定义,座位卡/
// #myGeneral文字行/武将说明弹窗/选将候选卡都查这一张表,不各自重复一份(原来只在 renderSeatCard
// 里有一份局部拷贝,现在提到这里做单一来源;色块颜色仍在 index.html 的 .faction-* 里定义,
// 不重复到这里)。
const FACTION_LABEL = { wei:'魏', shu:'蜀', wu:'吴', qun:'群', jin:'晋' };
// 装备来源的能力:任一已装备的牌在 EQUIPS 里声明了 cap===该能力(如诸葛连弩 cap:'unlimitedSha')。
function equipHasCap(player, cap){
  if(!player || !player.equips) return false;
  return EQUIP_SLOTS.some(slot=>{
    const c = player.equips[slot];
    const info = c && getEquip(c.name);
    return !!(info && info.cap===cap);
  });
}
// huashenSkillEntry: 左慈当前声明借用的那个具体技能条目(HUASHEN_SKILL_TABLE里的一项),
// 没有借用/借用武将或技能名对不上(理论上不该发生,兜底防御)则返回null。
function huashenSkillEntry(player){
  if(!player || player.huashenGeneral===undefined || player.huashenGeneral===null) return null;
  const entries = HUASHEN_SKILL_TABLE[player.huashenGeneral];
  if(!entries) return null;
  return entries.find(e=>e.name===player.huashenSkillName) || null;
}
function hasSkillName(player, skillName){
  if(!player || player.skillsLost || chanyuanLocksSkills(player)) return false;
  const gen=getGeneral(player.general);
  const own=gen&&typeof gen.skill==='string' ? gen.skill.split('/').map(function(s){return s.trim();}) : [];
  if(own.includes(skillName) || player.huashenSkillName===skillName) return true;
  return skillName==='观星' && !!(player.caps&&player.caps.guanxing);
}
function markHongyanIfConverted(g, player, card){
  if(player && card && card.suit==='♠' && hasSkillName(player,'红颜')) markSkillSound(g,'红颜');
}
// huashenHasCap: 左慈通过【化身】借用的技能是否提供某个布尔能力——只查当前声明借用的
// 那一个技能条目的caps数组,不查huashenGeneral整个武将的其它技能(左慈只借了"单个技能",
// 不是整个武将)。断肠等"武将技能整体失效"效果对借来的技能同样生效(和generalHasCap
// 共用同一条skillsLost/chanyuanLocksSkills前置判断,由hasCap统一把关,这里不重复判断)。
function huashenHasCap(player, cap){
  const entry = huashenSkillEntry(player);
  return !!(entry && Array.isArray(entry.caps) && entry.caps.includes(cap));
}
// huashenCapValue: 数值型cap的借用版本(如extraDrawPhase)——只记"借来的这个技能条目
// 确实声明了这个cap key"(entry.caps数组里有没有这个名字),真正的数值现查
// GENERALS[player.huashenGeneral].caps[cap],不复制到中间存储、不缓存。这是刻意
// 的架构选择:周瑜【英姿】(值1)和鲁肃【好施】(值2)共用同一个
// extraDrawPhase key,如果借用时把数值抄一份存进player自己的字段,后续"更改化身"
// 换借另一个武将时容易忘记同步更新/清空这份抄本,而现查天然不会有这个问题——和
// huashenHasCap的原则完全一致,只是这次是数值不是布尔。
function huashenCapValue(player, cap, fallback){
  const entry = huashenSkillEntry(player);
  if(!entry || !Array.isArray(entry.caps) || !entry.caps.includes(cap)) return fallback;
  const gen = getGeneral(player.huashenGeneral);
  const v = gen && gen.caps && gen.caps[cap];
  return (typeof v === 'number') ? v : fallback;
}
// huashenHasHook: 左慈借用的技能是否挂着某个触发型hook(HUASHEN_SKILL_TABLE条目里的
// hook字段,如{name:'遗计',hook:'onDamaged'})——只记"这个技能对应哪个hook名字",
// 真正的函数体仍然去 GENERALS[player.huashenGeneral].hooks[hookName] 里取(见
// triggerHook),表里不重复存函数,避免和GENERALS本体产生两份真相。
function huashenHasHook(player, hookName){
  const entry = huashenSkillEntry(player);
  return !!(entry && entry.hook === hookName);
}
// 统一能力入口:武将 caps 或 装备 cap 或 化身借用的技能 任一提供即算拥有。实时查询无缓存
// —— 卸下/替换装备、更改化身声明后自然失效。
// player.caps 是运行时额外获得的武将侧能力(如志继觉醒获得观星);断肠后一并失效,装备 cap 不受影响。
function hasCap(player, cap){
  if(equipHasCap(player, cap)) return true;
  if(player && (player.skillsLost || chanyuanLocksSkills(player))) return false;
  return generalHasCap(player, cap) || !!(player && player.caps && player.caps[cap]) || huashenHasCap(player, cap);
}
// ===== 牌的花色/点数(判定机制的地基;本步只加数据+显示,不做任何看花色的规则)=====
// 颜色由花色派生,统一走这些 seam,不到处硬判断花色。
function cardSuitForPlayer(player, card){
  if(!card) return undefined;
  if(hasCap(player,'hongyan') && card.suit==='♠') return '♥';
  return card.suit;
}
function isRed(card){ return !!(card && (card.suit==='♥'||card.suit==='♦')); }
function isRedForPlayer(player, card){
  const suit=cardSuitForPlayer(player, card);
  return suit==='♥'||suit==='♦';
}
function cardColor(card){ return isRed(card)?'red':'black'; }
function cardColorForPlayer(player, card){ return isRedForPlayer(player, card)?'red':'black'; }
// singleCardShaColor: 普通杀(含转化牌,如龙胆的闪当杀、武圣的红牌当杀)的颜色——直接查这张
// 物理牌本身的花色。给 resolveShaUse 的 shaColor 参数用,不是给"判定牌颜色"这类场景用
// (判定区/铁骑/洛神那些判定,直接查 isRed(judgeCard) 即可,不涉及"杀的颜色"这个概念)。
function isShaName(name){ return name==='杀' || name==='火杀' || name==='雷杀'; }
function singleCardShaColor(card){ return card ? (isRed(card)?'red':'black') : undefined; }
function cardDamageNature(card){
  if(!card || Array.isArray(card)) return null;
  if(card.name==='火杀' || card.name==='火攻') return 'fire';
  if(card.name==='雷杀' || card.name==='闪电') return 'thunder';
  return null;
}
function damageNatureText(nature){
  return nature==='fire' ? '火属性' : nature==='thunder' ? '雷属性' : '';
}
// combinedShaColor: 丈八蛇矛"两张牌当一张杀"的颜色规则——不看单张牌花色,按两张牌的红黑
// 组合决定:两张都红→红,两张都黑→黑,一红一黑→"无色"(仁王盾/毅重这类"黑杀无效"的效果
// 对无色杀不生效)。这是一个真实存在的三态结果,不是"非红即黑"的二元判断,和 isRed 的语义
// 不同,专门给合成杀这个场景用,单张牌的颜色判断永远只有红/黑两态,不需要这个函数。
function combinedShaColor(c1, c2){
  const r1=isRed(c1), r2=isRed(c2);
  if(r1 && r2) return 'red';
  if(!r1 && !r2) return 'black';
  return 'none';
}
// 点数显示:1→A、11~13→J/Q/K,其余原数字;缺失回退空串
function rankText(rank){ return {1:'A',11:'J',12:'Q',13:'K'}[rank] || (rank?String(rank):''); }
// 牌面花色+点数的带色 HTML(红 #b33 / 黑 #3a2f28);缺 suit/rank 安全回退空串(兼容旧牌)
function cardFace(card){
  if(!card || !card.suit) return '';
  return '<span style="color:'+(isRed(card)?'#b33':'#3a2f28')+'">'+card.suit+rankText(card.rank)+'</span>';
}
// 这张牌对该玩家能否充当 role('杀'/'闪')使用。默认本名相符;赵云【龙胆】允许 杀<->闪 双向转化
// (按名字);甄姬【倾国】允许任意黑色手牌当【闪】、关羽【武圣】允许任意红色手牌当【杀】
// (都是按颜色,不看名字);三条判断各自独立,互不覆盖。
function canUseAs(player, card, role){
  if(!card) return false;
  if(role==='杀' && isShaName(card.name)) return true;
  if(card.name===role) return true;
  if(hasCap(player,'longdan')){
    if(role==='杀' && card.name==='闪') return true;
    if(role==='闪' && card.name==='杀') return true;
  }
  if(role==='闪' && hasCap(player,'qingguo') && !isRedForPlayer(player, card)) return true;
  if(role==='杀' && hasCap(player,'wusheng') && isRedForPlayer(player, card)) return true;
  if(role==='决斗' && hasCap(player,'shuangxiong') && player.shuangxiongColor
     && cardColorForPlayer(player, card)!==player.shuangxiongColor) return true;
  return false;
}
// 在手牌里找一张能当 role 用的牌:优先本名牌,没有才用可转化的牌。返回索引,无则 -1。
function findUsableAs(hand, player, role){
  let i = (hand||[]).findIndex(c=>c && c.name===role);
  if(i<0) i = (hand||[]).findIndex(c=>canUseAs(player,c,role));
  return i;
}
// 触发型技能分发:查 seat 玩家武将的 hooks[hookName] 并执行(在调用方的 tx 内,直接改 g)。
// triggerHook: 自己的hook先跑,借来的hook(左慈化身)后跑。两者都可能想给同一个seat开
// 同一类pending(比如左慈自己的新生+借来的遗计都是onDamaged且都想问一次),不能无脑
// 连续跑两次(第二次会覆盖第一次刚开的g.pending)——自己的hook跑完后,若g.pending真的
// 变化了(说明它挂起了一个新pending,等玩家响应),且借来的技能也挂着同一个hookName,
// 就把"借来的"这一份记进g.pendingHookQueue、这次直接return,交给
// consumePendingHookQueue(见game.js,在resumeAfterInterrupt里接入)在第一个pending
// 解决之后再执行。若自己没有这个hook、或自己的hook是即时效果(没开新pending,如
// 反馈/奸雄直接拿牌不问人),借来的技能可以在同一次调用里紧接着跑,不需要排队。
function triggerHook(g, seat, hookName, ctx){
  const p = g.players[seat];
  if(p && (p.skillsLost || chanyuanLocksSkills(p))) return; // 断肠/缠怨等:武将 hooks 一并失效
  const gen = p && getGeneral(p.general);
  const ownFn = gen && gen.hooks && gen.hooks[hookName];
  if(typeof ownFn === 'function'){
    const pendingBefore = g.pending;
    ownFn(g, seat, ctx);
    if(g.pending !== pendingBefore){
      if(huashenHasHook(p, hookName)){
        g.pendingHookQueue = { seat, hookName, ctx, source:'borrowed' };
      }
      return;
    }
  }
  if(huashenHasHook(p, hookName)){
    const borrowedGen = getGeneral(p.huashenGeneral);
    const borrowedFn = borrowedGen && borrowedGen.hooks && borrowedGen.hooks[hookName];
    if(typeof borrowedFn === 'function') borrowedFn(g, seat, ctx);
  }
}
function randomGeneralId(){ return GENERAL_IDS[Math.floor(Math.random()*GENERAL_IDS.length)]; }
// 取武将体力上限,任何异常(null/旧数据)都回退到 MAX_HP,绝不抛错
function generalMaxHp(id){ const gen=getGeneral(id); return (gen && typeof gen.maxHp==='number') ? gen.maxHp : MAX_HP; }

// 基础牌/锦囊的一句话效果说明(给新手看,通俗;装备说明在 EQUIPS.desc)。唯一查询入口 getCardDesc,业务层不硬编码牌名。
const CARD_DESC = {
  '杀':       '出牌阶段使用,对攻击距离内的一名其他角色造成1点伤害;对方可打出【闪】抵消。每回合一般只能使用1张,且受攻击距离限制。',
  '火杀':     '属性【杀】。用法同【杀】,造成火属性伤害;若目标处于连环状态,会传导给其他连环角色。',
  '雷杀':     '属性【杀】。用法同【杀】,造成雷属性伤害;若目标处于连环状态,会传导给其他连环角色。',
  '闪':       '当你被【杀】指定为目标时打出,用来抵消这张【杀】、免受伤害。不能主动使用。',
  '桃':       '让自己回复1点体力,只能在自己体力没满时使用。',
  '酒':       '出牌阶段对自己使用,本回合下一张【杀】造成的伤害+1；自己濒死时也可以当作救自己的牌使用。',
  '决斗':     '指定一名其他角色决斗:双方轮流打出【杀】,先打不出【杀】的一方受到1点伤害。',
  '无中生有': '直接从牌堆摸两张牌。',
  '桃园结义': '所有存活角色各回复1点体力(已满血则不受影响)。每名角色的回复效果分别可被无懈可击抵消。',
  '顺手牵羊': '拿取一名其他角色的一张牌归为己有(可拿手牌或一件装备),每次只能拿一张。',
  '过河拆桥': '弃掉一名其他角色的一张牌(手牌或一件装备),每次只能弃一张。',
  '无懈可击': '抵消一张功能牌(“锦囊”,如决斗、南蛮入侵等)对一名角色的效果;也能抵消别人的【无懈可击】。',
  '南蛮入侵': '你以外的所有角色各需打出一张【杀】,打不出的人受到1点伤害。',
  '万箭齐发': '你以外的所有角色各需打出一张【闪】,打不出的人受到1点伤害。',
  '火攻':     '指定一名有手牌的角色,其展示一张手牌;你可弃置一张同花色手牌,令其受到1点火属性伤害。',
  '闪电': '延时锦囊,只能放在你自己的判定区。轮到你回合开始时判定:黑桃2~9,你受到3点伤害,然后此牌作废;否则无事发生,将此牌移到下一名角色的判定区。',
  '乐不思蜀': '延时锦囊,只能放在其他角色的判定区。轮到该角色回合开始时判定:若判定牌不为♥(红桃),跳过本回合的出牌阶段;为♥则无效果。判定完此牌作废。',
  '兵粮寸断': '延时锦囊,只能放在其他角色的判定区。轮到该角色回合开始时判定:若判定牌不为♣(梅花),跳过本回合的摸牌阶段;为♣则无效果。判定完此牌作废。',
  '铁索连环': '指定一至两名角色,分别令其进入或解除连环状态。连环状态用于属性伤害传导;也可以直接重铸,弃置后摸一张牌。',
  '借刀杀人': '选择一名装备着武器牌的角色(A),再选择A攻击范围内的另一名角色(B)。A可以选择对B使用一张【杀】(不受A本回合出杀次数限制),否则弃置A装备的武器牌。可被无懈可击整体抵消。',
  '五谷丰登': '亮出等同于存活角色数量的牌堆顶的牌,从你开始按座位顺序,每人依次挑选一张收入手中。每名角色的挑选效果分别可被无懈可击抵消。',
};
function getCardDesc(name){ return CARD_DESC[name] || ''; } // 基础牌/锦囊说明
// 任意牌的说明统一入口:装备牌走 EQUIPS.desc,基础牌/锦囊走 CARD_DESC。任何位置(手牌/装备区/帮助面板)都用它。
function getAnyDesc(name){ const e=getEquip(name); return (e && e.desc) || getCardDesc(name) || ''; }

const SUITS = ['♠','♥','♦','♣']; // 黑/红/红/♣黑;轮询分配保证红黑严格均衡(判定公平)
function buildDeck(){
  // 牌堆:标准版(104基础+4EX)官方花色点数 + 项目额外实现的军争/非官方牌。
  // 标准版+军争等。雌雄双股剑 ♠2 已实现。
  // 点数:A=1,J=11,Q=12,K=13。同花色点数可在不同牌名重复,靠 id 区分。
  const S='♠', H='♥', C='♣', D='♦';
  const LIST = [
    // 基本牌 58
    ['杀',S,7],['杀',S,8],['杀',S,8],['杀',S,9],['杀',S,9],['杀',S,10],['杀',S,10],
    ['杀',H,10],['杀',H,10],['杀',H,11],
    ['杀',C,2],['杀',C,3],['杀',C,4],['杀',C,5],['杀',C,6],['杀',C,7],['杀',C,8],['杀',C,8],['杀',C,9],['杀',C,9],['杀',C,10],['杀',C,10],['杀',C,11],['杀',C,11],
    ['杀',D,6],['杀',D,7],['杀',D,8],['杀',D,9],['杀',D,10],['杀',D,13],
    ['闪',H,2],['闪',H,2],['闪',H,13],
    ['闪',D,2],['闪',D,2],['闪',D,3],['闪',D,4],['闪',D,5],['闪',D,6],['闪',D,8],['闪',D,9],['闪',D,10],['闪',D,10],['闪',D,11],['闪',D,11],
    ['桃',H,3],['桃',H,4],['桃',H,7],['桃',H,8],['桃',H,9],['桃',H,12],
    ['桃',D,2],['桃',D,12],
    ['酒',S,3],['酒',S,9],['酒',C,3],['酒',C,9],['酒',D,9],
    // 标准版锦囊 36
    ['决斗',S,1],['决斗',C,1],['决斗',D,1],
    ['无中生有',H,7],['无中生有',H,8],['无中生有',H,9],['无中生有',H,11],
    ['顺手牵羊',S,3],['顺手牵羊',S,4],['顺手牵羊',S,11],['顺手牵羊',D,3],['顺手牵羊',D,4],
    ['过河拆桥',S,3],['过河拆桥',S,4],['过河拆桥',S,12],['过河拆桥',C,3],['过河拆桥',C,4],['过河拆桥',H,12],
    ['无懈可击',S,11],['无懈可击',C,12],['无懈可击',C,13],['无懈可击',D,12],
    ['借刀杀人',C,12],['借刀杀人',C,13],
    ['南蛮入侵',S,7],['南蛮入侵',S,13],['南蛮入侵',C,7],
    ['万箭齐发',H,1],
    ['桃园结义',H,1],
    ['五谷丰登',H,3],['五谷丰登',H,4],
    ['乐不思蜀',S,6],['乐不思蜀',H,6],['乐不思蜀',C,6],
    ['闪电',S,1],['闪电',H,12],
    ['铁索连环',C,10],['铁索连环',C,11],
    // 军争属性伤害牌:火杀5、雷杀9、火攻3
    ['火杀',H,4],['火杀',H,7],['火杀',H,10],['火杀',D,4],['火杀',D,5],
    ['雷杀',S,4],['雷杀',S,5],['雷杀',S,6],['雷杀',S,7],['雷杀',S,8],
    ['雷杀',C,5],['雷杀',C,6],['雷杀',C,7],['雷杀',C,8],
    ['火攻',H,2],['火攻',H,3],['火攻',D,12],
    // 标准版装备 19
    ['诸葛连弩',C,1],['诸葛连弩',D,1],
    ['雌雄双股剑',S,2],
    ['青釭剑',S,6],['青龙偃月刀',S,5],['丈八蛇矛',S,12],
    ['贯石斧',D,5],['方天画戟',D,12],['麒麟弓',H,5],['寒冰剑',S,2],
    ['八卦阵',S,2],['八卦阵',C,2],['仁王盾',C,2],
    ['绝影',S,5],['爪黄飞电',H,13],['的卢',C,5],
    ['大宛',S,13],['赤兔',H,5],['紫骍',D,13],
    // 项目额外实现的军争/非官方牌 4(按官方军争花色点数;骕骦无官方值暂定♣K)
    ['兵粮寸断',S,10],['兵粮寸断',C,4],
    ['古锭刀',S,1],
    ['骕骦',C,13],
  ];
  const d = LIST.map((c,i)=>({id:i, name:c[0], suit:c[1], rank:c[2]}));
  for(let i=d.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [d[i],d[j]]=[d[j],d[i]]; }
  return d;
};

// 导出给Node.js使用
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    GENERALS, GENERAL_IDS, getGeneral, generalMaxHp, hasCap, HUASHEN_SKILL_TABLE,
    EQUIPS, EQUIP_SLOTS, emptyEquips, getEquip,
    SEATS, MIN_PLAYERS, MAX_HP, START_HAND, BASIC_CARDS,
    IDENTITY_TABLE, ROLE_LABEL, assignIdentities, getLordSeat, canSeeRole, sameTeam,
    DELAY_TRICKS,
    buildDeck, cardSuitForPlayer, isRed, isRedForPlayer, cardColor, cardColorForPlayer,
    isShaName, singleCardShaColor, combinedShaColor, rankText, cardFace,
    canUseAs, findUsableAs, triggerHook, randomGeneralId, generalHasCap, generalCapValue, generalGender, isMale, isOppositeGender, equipHasCap,
    validateHuashenPick, huashenSkillEntry, huashenHasCap, huashenCapValue, huashenHasHook
  };
}
