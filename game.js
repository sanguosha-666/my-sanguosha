// ---------- local state ----------
// normalize() 里散落的 logPendingOrphan(g,reason) 调用(见下方各处"发现不合法pending"
// 分支)依赖 debug-log.js 先定义好这个函数——index.html 里真实加载顺序确实如此,但
// 项目里不少测试脚本单独加载 game.js、不带 debug-log.js。用"未定义才补一个no-op"的
// 写法兜底:debug-log.js 若已先加载,这里的 typeof 检查为假,不会覆盖真实实现;
// 没加载时(测试环境)兜底成no-op,不影响 normalize 本身的校验逻辑。
if(typeof logPendingOrphan==='undefined'){
  var logPendingOrphan = function(){};
}
let roomId = null, mySeat = null;
let gameRef = null;
let chatRef = null, chatQuery = null;
let chatMessages = [];
// 本地稳定标识:用来区分"我自己刷新重连"和"另一个人重名"。持久化到 localStorage,刷新后不变。
let myClientId = (function(){
  try{
    let c = localStorage.getItem('sgsClientId');
    if(!c){ c = 'c'+Date.now().toString(36)+Math.random().toString(36).slice(2,8); localStorage.setItem('sgsClientId', c); }
    return c;
  }catch(e){ return 'c'+Date.now().toString(36)+Math.random().toString(36).slice(2,8); }
})();

// ---------- join ----------
document.getElementById('joinBtn').onclick = joinRoom;


// ---------- helpers ----------
// Firebase drops empty arrays/objects -> they come back undefined. Restore defaults.
// A1 响应超时托管:询问型 pending 的超时阈值(30s)。检测器(bot-ai-bus.js)按它判定超时
// 提交保守动作,render.js 按它显示"⏱ Ns 后自动…"倒计时。
const RESPONSE_TIMEOUT_MS = 30000;
// setResponseAskedAt: 给询问型 pending 打"轮到当前被问者"的时间戳。创建点/asking 切换点
// 都调它;normalize 只兜底补戳(老存档/遗漏),不重复打——创建处已打的戳保持原值,否则
// 每次 tx/render 都会把倒计时重置回 30s,永远等不到超时。
function setResponseAskedAt(pending){
  pending.askedAt = Date.now();
  return pending;
}
// pendingResponderSeat: 超时托管和 tx 活跃检测共用的响应者解析入口。
// 已有阶段优先复用机器人调度表中逐项核验过的字段；新增阶段无需登记，按通用字段约定
// 自动识别。这样新增 pending 不会再因为漏改一张超时白名单而永久卡局。
function pendingResponderSeat(g, pending){
  if(!pending || typeof pending!=='object') return null;
  if(pending.type==='wugu' && Array.isArray(pending.order)){
    const wuguSeat=pending.order[pending.idx||0];
    return Number.isInteger(wuguSeat) ? wuguSeat : null;
  }
  const phase=g&&g.phase;
  const actorField=typeof stageActorField==='function' ? stageActorField(pending.type||phase) : null;
  if(actorField && Number.isInteger(pending[actorField])) return pending[actorField];
  const fields=['responderSeat','responseSeat','asking','active','currentSeat','seat','sourceSeat','targetSeat','damagerSeat',
    'lordSeat','seatA','to','from'];
  for(let i=0;i<fields.length;i++){
    if(Number.isInteger(pending[fields[i]])) return pending[fields[i]];
  }
  return null;
}
function isTimedResponsePending(g, pending){
  if(!pending || typeof pending!=='object') return false;
  if(pending.type==='wuxiePublicWait') return true;
  const spec=typeof pending.type==='string' ? STAGE_TABLE[pending.type] : null;
  if(spec && typeof spec.timeoutAction==='function') return true;
  return Number.isInteger(pendingResponderSeat(g,pending));
}
function normalize(g){
  if(!g) return g;
  g.deck = g.deck || [];
  g.discard = g.discard || [];
  // 日志:元素统一成 {seq,text[,kind,actor,targets]}。老房间/开局初始条目(createRoom 的
  // log:['房间已创建…'])可能是裸字符串,在这里一次性补 seq——保留已有合法 seq、绝不重新编号
  // (seq 必须跨读取稳定,渲染端靠它判断哪些是新日志),只给缺 seq 的项接在当前最大值之后编号。
  // kind/actor/targets 是第二步新增的结构字段(logEvent 产出),原样透传+轻量类型防御——
  // Firebase 吞空 targets 数组、读回来是 undefined,消费端按"无目标"处理即可,不强求恢复空数组。
  // normalize 在读(render→normalize)和写(tx→normalize)两条路径都跑,所以到达渲染端时 g.log
  // 一定已是这套结构;此修正只在客户端内存进行、不写回 Firebase(同既有空数组防御)。
  {
    let maxSeq = 0;
    const keepMeta = (src, dst)=>{
      if(src && typeof src.kind==='string') dst.kind = src.kind;
      if(src && Number.isInteger(src.actor)) dst.actor = src.actor;
      if(src && Array.isArray(src.targets)) dst.targets = src.targets.filter(Number.isInteger);
      return dst;
    };
    g.log = (g.log || []).map(e=>{
      if(e && typeof e==='object' && Number.isInteger(e.seq)){
        if(e.seq>maxSeq) maxSeq=e.seq;
        return keepMeta(e, { seq:e.seq, text: typeof e.text==='string' ? e.text : String(e.text==null?'':e.text) });
      }
      return { seq: ++maxSeq, text: typeof e==='string' ? e : String(e==null?'':e) };
    });
  }
  g.players = g.players || [];
  // 对战模式:ffa/identity/team;非法/缺失回退 null(当乱斗行为)。winSide 仅 identity 终局用。
  if(g.gameMode!=='ffa' && g.gameMode!=='identity' && g.gameMode!=='team') g.gameMode=null;
  if(g.winSide!=null && !['fan','nei','lord','none'].includes(g.winSide)) g.winSide=null;
  if(g.lordGeneralPool!=null && !Array.isArray(g.lordGeneralPool)) g.lordGeneralPool=null;
  g.players.forEach(p=>{
    if(!p) return;
    // AI托管标识是公开房间状态，仅同步一个布尔值；API密钥和托管记录始终不进入 g。
    if(typeof p.aiAutopilot!=='boolean') p.aiAutopilot=false;
    if(p.role!=null && !['zhu','zhong','fan','nei'].includes(p.role)) p.role=null;
    if(typeof p.roleRevealed!=='boolean') p.roleRevealed=false;
    // 非 identity 清空脏身份,避免旧局/乱斗残留
    if(g.gameMode!=='identity'){ p.role=null; p.roleRevealed=false; }
    // 组队:队伍号只对 team 模式有意义;非法/非整数/越界清 null
    if(p.team!=null && !Number.isInteger(p.team)) p.team=null;
    if(Number.isInteger(p.team) && (p.team<0 || p.team>=SEATS)) p.team=null;
    if(g.gameMode!=='team'){ p.team=null; }
  });
  // 组队模式队伍数:从 players 实时推导(最大队伍号+1);非 team 清空。
  if(g.gameMode==='team'){
    let maxT = -1;
    (g.players||[]).forEach(p=>{ if(p && Number.isInteger(p.team) && p.team>maxT) maxT=p.team; });
    g.teamCount = maxT+1;
  } else {
    g.teamCount = 0;
  }
  // 轮次计数:数字/数组防御,Firebase 吞空数组、旧存档可能没有这两个字段
  if(!Number.isInteger(g.roundNum)) g.roundNum=1;
  if(!Array.isArray(g.roundSeatsActed)) g.roundSeatsActed=[];
  // 身份局公开嫌疑事件:只保留结构化的伤害/救援公开事件,最多20条。
  // Firebase 吞空数组,消费端统一回退为空数组。
  if(!Array.isArray(g.aiSuspicionEvents)) g.aiSuspicionEvents=[];
  g.aiSuspicionEvents=g.aiSuspicionEvents.filter(e=>e && typeof e==='object'
    && Number.isInteger(e.round) && Number.isInteger(e.source) && Number.isInteger(e.target)
    && Number.isInteger(e.amount) && (e.kind==='damage'||e.kind==='rescue')).slice(-20);
  // 按座位累计的嫌疑分缓存(bot.js botSuspicion 写入):Firebase 吞空对象,回退容器为{};
  // 键值防御非数字/超范围(读取端本身也有 Math.max(-100,Math.min(100,...)) 约束写入,
  // 这里是双重保险,防止旧存档或手工构造的脏数据带进不合法值)。
  if(!g.aiRebelSuspicion || typeof g.aiRebelSuspicion!=='object' || Array.isArray(g.aiRebelSuspicion)) g.aiRebelSuspicion={};
  Object.keys(g.aiRebelSuspicion).forEach(k=>{
    const v=g.aiRebelSuspicion[k];
    if(typeof v!=='number' || !isFinite(v)) delete g.aiRebelSuspicion[k];
  });
  // 出牌语音事件:旧存档可能没有这个字段,回退 null(表示"还没有任何一次出牌语音事件")
  if(g.lastCardSound===undefined) g.lastCardSound=null;
  // 实际扣血事件:渲染端据此播放受击动画和音效。只保留最新一次,seq 用于各客户端去重。
  if(g.lastDamageEffect===undefined) g.lastDamageEffect=null;
  else if(g.lastDamageEffect!==null && (!Number.isInteger(g.lastDamageEffect.seq) || !Number.isInteger(g.lastDamageEffect.target) || !Number.isFinite(g.lastDamageEffect.amount) || g.lastDamageEffect.amount<=0)) g.lastDamageEffect=null;
  // 闪电判定特效事件:旧存档可能没有这个字段,回退 null(表示"还没有任何一次闪电判定特效");
  // 渲染端据此播放 flash0/flash1 全屏动画,hit 必须为布尔(判定中 true / 未中 false)。
  if(g.lastLightningFx===undefined) g.lastLightningFx=null;
  else if(g.lastLightningFx!==null && (!Number.isInteger(g.lastLightningFx.seq) || !Number.isInteger(g.lastLightningFx.seat) || typeof g.lastLightningFx.hit!=='boolean')) g.lastLightningFx=null;
  // 过场动画事件(武将死亡/胜负结算剧情点):旧存档可能没有这个字段,回退 null。kind 必须是
  // 字符串,seat 为事件主体座位(可为 null),result(仅 gameOver 用)若存在须为普通对象。
  if(g.lastMovieFx===undefined) g.lastMovieFx=null;
  else if(g.lastMovieFx!==null && (!Number.isInteger(g.lastMovieFx.seq) || typeof g.lastMovieFx.kind!=='string' || (g.lastMovieFx.seat!=null && !Number.isInteger(g.lastMovieFx.seat)) || (g.lastMovieFx.result!==undefined && (g.lastMovieFx.result===null || typeof g.lastMovieFx.result!=='object' || Array.isArray(g.lastMovieFx.result))))) g.lastMovieFx=null;
  // Firebase RTDB 丢 null 键：gameOver 的 seat:null 读回是缺键。缺席/undefined 回填 null，不当非法。
  if(g.lastMovieFx && g.lastMovieFx.seat==null) g.lastMovieFx.seat=null;
  if(!Array.isArray(g.exchangeCards)) g.exchangeCards=[];
  // 每一项的 targets 字段防御(原来只在单独的 g.tableCard.targets 上做,现在 g.tableCard 已经
  // 消灭、统一到 g.exchangeCards,防御要作用于数组里的每一项)。这条是纯粹的"数据形状防御"
  // (类型/结构检查),读(render→normalize)写(tx→normalize)两条路径都该跑,和下面那条
  // "状态转换"性质的兜底清空刻意分属两类、分开维护(见 pruneExchangeCards 的说明)。
  g.exchangeCards.forEach(e=>{ if(e && e.targets!=null && !Array.isArray(e.targets)) e.targets=null; });
  // 陆逊【连营】:失去最后手牌时先入队,等当前 pending 空闲再询问(防 playCard effect 覆盖)
  if(!Array.isArray(g.lianyingQueue)) g.lianyingQueue=[];
  g.lianyingQueue = g.lianyingQueue.filter(s=>Number.isInteger(s));
  // 贾诩【乱武】:杀结算跨 pending 时用此字段接回链(不塞进 g.pending,避免被杀响应覆盖)
  if(g.luanwuResume===undefined) g.luanwuResume=null;
  if(g.luanwuResume && typeof g.luanwuResume.sourceSeat!=='number'){
    g.luanwuResume=null;
  } else if(g.luanwuResume && !Array.isArray(g.luanwuResume.remainingSeats)){
    // remainingSeats 推进到空数组([])时,Firebase 存进去读回来会变成 undefined(不保存空
    // 数组,和下面 pending.remainingSeats 同一类坑)——链条问到最后一人前这个字段本来就该是
    // 空数组,不是数据损坏,补默认值而不是把整条 luanwuResume 判死清空。
    g.luanwuResume.remainingSeats=[];
  }
  // 夏侯渊【神速】:"视为杀"结算跨 pending 时用此字段接回链,和上面 g.luanwuResume 同一设计
  // (不塞进 g.pending,避免被杀响应过程中打开的各种子阶段覆盖)。
  if(g.shensuResume===undefined) g.shensuResume=null;
  if(g.shensuResume && (typeof g.shensuResume.seat!=='number' || !g.players[g.shensuResume.seat] || typeof g.shensuResume.remaining!=='number')){
    g.shensuResume=null;
  }
  // 张角【雷击】:雷击从南蛮入侵/万箭齐发的响应里触发时,靠此字段跨 leijiChoose→leijiJudge→
  // 可能的鬼道/鬼才改判 记住"结束后该 aoeAdvance 续接哪个座位之后的目标",同样不塞进
  // g.pending(会被期间打开的 guiduAsk/guicai 等子阶段覆盖),和 g.shensuResume 同一设计。
  if(g.leijiResume===undefined) g.leijiResume=null;
  if(g.leijiResume && (typeof g.leijiResume.prevSeat!=='number' || !g.players[g.leijiResume.prevSeat])){
    g.leijiResume=null;
  }
  // 技能发动语音事件:同上,旧存档回退 null
  if(g.lastSkillSound===undefined) g.lastSkillSound=null;
  // 许褚【裸衣】:本回合伤害加成标记。回合开始重置,旧存档缺失回退 false。
  if(typeof g.luoyiActive!=='boolean') g.luoyiActive=false;
  // 鲁肃【缔盟】:回合内使用标记
  if(typeof g.dimengUsed!=='boolean') g.dimengUsed=false;
  // 法正【眩惑】:回合内使用标记
  if(typeof g.huanhuoUsed!=='boolean') g.huanhuoUsed=false;
  // 典韦【强袭】:回合内使用标记
  if(typeof g.qiangxiUsed!=='boolean') g.qiangxiUsed=false;
  // 典韦【强袭】目标选择阶段:pending 应包含 type、seat 等字段

  // 典韦【强袭】消耗选择阶段:pending 应包含 type、seat 等字段

  // 典韦【强袭】武器选择阶段（从手牌弃置武器时）

  // 辅诩【乱武】:游戏内使用标记（限定技，全局只能使用一次）
  if(typeof g.luanwuUsed!=='boolean') g.luanwuUsed=false;

  // 陈宫【明策】:回合内使用标记
  if(typeof g.mingceUsed!=='boolean') g.mingceUsed=false;

  // 陈宫【明策】:选择阶段
  // pending 应包含 type、sourceSeat（陈宫座位）、targetSeat（接收牌的角色）、target2Seat（被攻击的目标，可选）
  // 注意：明策结算必须完整进行，即使陈宫死亡，也继续结算


  // 陈宫【明策】:选择接收牌的目标阶段


  // 陈宫【明策】:第二个目标选择阶段


  // 陈宫【明策】:接收牌的角色选择阶段
  // 注意：此阶段不检查sourceSeat（陈宫）是否存活，因为明策必须结算完毕


  // 陈宫【智迟】:免疫状态标记
  // 记录智迟的免疫状态：{ seat: 陈宫座位, turn: 当前回合的角色座位 }
  // 免疫状态持续至该回合结束
  if(typeof g.zhichiImmunity!=='object' || g.zhichiImmunity===null) g.zhichiImmunity=null;

  // 辅诩【乱武】:乱武选择阶段
  // ⚠️ d.remainingSeats.length===0 不是脏数据的信号——链条正常推进到最后一个人时,
  // remainingSeats 本来就该是空数组(proceedToNextLuanwu 把它从长度1推进到长度0,这正是
  // "正在询问链条最后一人"这个合法中间态)。之前这里把"空数组"和"数据损坏"划了等号,
  // 每次链条走到最后一人,下一次 normalize(写路径的 tx 内部/任何客户端收到 Firebase 推送
  // 的读路径)就会把这个合法状态当成脏数据清空——真实表现是"乱武链条永远只问到倒数第二人,
  // 最后一人从不会被真正询问"(不分人数,3人局时最容易被注意到,因为只剩1个"其他角色"能
  // 被问,一清空就等于"只问了下家一个人")。这条检查的其它几项(currentSeat/sourceSeat
  // 的类型与存活性)本身没问题,只删掉 remainingSeats.length===0 这一条误判。
  // ⚠️ 第二个坑(debugLogs 抓到过真实 pending_orphan_detected 案例,7人局 currentSeat=6
  // 恰好是链条最后一人):上面那次修复删掉了 length===0 的误判,但保留的 !Array.isArray(d.
  // remainingSeats) 这一条本身也会被同一个 Firebase 坑命中——"空数组存进去读回来变成
  // undefined"(CLAUDE.md 二、Firebase 的关键坑),remainingSeats 推进到 [] 之后写入
  // Firebase、下一次读出来就是 undefined、不再是"空数组"而是"没有这个字段",直接命中
  // !Array.isArray() 判定为结构不合法、把整个 pending 清空——症状和第一次那个坑几乎一样
  // (链条问到最后一人前 pending 就被误杀),只是触发路径从"检查空数组"变成了"检查字段
  // 缺失"。修法和 g.luanwuResume.remainingSeats(见上方同函数)一致:currentSeat/sourceSeat
  // 校验通过但 remainingSeats 不是数组时,补默认值[]而不是整体判死。


  // 贾诩【完杀】:回合内濒死状态标记
  if(typeof g.wanshaActive!=='boolean') g.wanshaActive=false;
  if(typeof g.wanshaDyingSeat!=='number') g.wanshaDyingSeat=null;

  // 袁绍【乱击】:选择阶段


  // 袁绍【乱击】:确认使用阶段


  // 张角【雷击】:使用或打出闪后的雷击选择阶段


  // 张角【雷击】:雷击判定阶段


  // 张角【鬼道】:询问是否发动鬼道阶段


  // 开局选将模式:'random'/'pick',开局前是 null,旧存档缺失同样回退 null
  if(g.generalMode===undefined) g.generalMode=null;
  g.players.forEach(p=>{ if(p){ p.hand = p.hand || []; if(typeof p.alive!=='boolean') p.alive=true;
    // 三选一候选:pending 期间是数组,其余时候应为 null;Firebase 吞空数组,缺失回退 null
    if(p.generalChoices===undefined) p.generalChoices=null;
    if(p.shuangxiongColor!==null && p.shuangxiongColor!=='red' && p.shuangxiongColor!=='black') p.shuangxiongColor=null;
    // 体力上限防御:旧数据/异常路径缺失时回退,避免血条/桃回血读到 undefined
    if(typeof p.maxHp!=='number') p.maxHp = MAX_HP;
    // 装备区防御:Firebase 吞 null 值/空对象,读回来容器会缺失或缺键;补容器 + 补齐四槽(缺的回退 null)
    p.equips = Object.assign(emptyEquips(), p.equips || {});
    // 濒死标记:纯 UI 提示用的布尔标量,和 alive 同款防御
    if(typeof p.dying!=='boolean') p.dying=false;
    if(typeof p.chained!=='boolean') p.chained=false;
    if(typeof p.turnedOver!=='boolean') p.turnedOver=false;
    if(typeof p.nirvanaUsed!=='boolean') p.nirvanaUsed=false;
    if(typeof p.jujianUsed!=='boolean') p.jujianUsed=false;
    if(typeof p.chanyuan!=='boolean') p.chanyuan=false;
    if(typeof p.jiuShaBonus!=='boolean') p.jiuShaBonus=false;
    // 曹彰【将驰】本回合效果
    if(typeof p.jiangchiNoSlash!=='boolean') p.jiangchiNoSlash=false;
    if(typeof p.jiangchiNoDistance!=='boolean') p.jiangchiNoDistance=false;
    if(!Number.isInteger(p.zhengyiTurn)) p.zhengyiTurn=-1;
    // 姜维【志继】觉醒标记
    if(typeof p.zhijiAwakened!=='boolean') p.zhijiAwakened=false;
    // 周泰【不屈】牌堆:不屈牌数组,每张牌是一个对象{id,name,suit,rank}
    p.buquCards = p.buquCards || [];
    // 玩家动态获得的能力(如志继觉醒后获得观星)
    if(typeof p.caps!=='object'||p.caps===null) p.caps={};
    // 蔡文姬【断肠】等:武将技能整体失效标记
    if(typeof p.skillsLost!=='boolean') p.skillsLost=false;
    // 左慈【化身】v2:huashenPool 是只增不减的库存(和 p.hand/p.delays 同款防御,
    // Firebase 吞空数组),huashenGeneral/huashenSkillName 是当前声明借用的武将/技能名。
    if(!Array.isArray(p.huashenPool)) p.huashenPool=[];
    if(p.huashenGeneral===undefined) p.huashenGeneral=null;
    if(typeof p.huashenSkillName!=='string') p.huashenSkillName=null;
    // 不一致状态兜底:huashenGeneral非null但不在huashenPool里,整体清空(不是把huashenGeneral
    // 塞进pool补救)——huashenPool"只增不减"意味着huashenGeneral正常情况下必然是从pool里
    // 选出来的,这种不一致只可能是脏数据/未来代码写错,不该被静默"修好"而永久掩盖真正的bug,
    // 和项目里其它"结构不完整就整体判无效清空"的既有防御(如huashenPick/xinshengAsk等pending
    // 防御)保持同一原则。
    if(p.huashenGeneral!==null && !p.huashenPool.includes(p.huashenGeneral)){
      p.huashenGeneral=null;
      p.huashenSkillName=null;
    }
    // 判定区(延时锦囊):和 p.hand 同款防御,Firebase 吞空数组
    p.delays = p.delays || [];
  } });
  // 左慈【化身】v2选择阶段:seat 应是数字座位号且对应玩家存活;该玩家应该确实"还没声明
  // 技能"(huashenGeneral===null)且确实"有pool可选"(huashenPool非空)——不满足任一条
  // 整体判无效清空,防止卡死(和v1的huashenPick/观星/李典恂恂同款写法)。**这次pending
  // 里不存availGenerals副本**(设计理由见 checkHuashenBeforeAssign 注释),所以这里
  // 也不需要校验"候选是不是过时快照"这类问题,只需要校验seat对应的huashenPool/
  // huashenGeneral本身是否处于"确实还在等待声明"这个状态。

  // 无懈询问阶段:asking 是当前响应者座位号(数字);防御非法值
  if(g.pending && g.pending.type==='wuxie' && typeof g.pending.asking!=='number') g.pending.asking=-1;
  // 无懈反制:exclude(当前轮不问谁的座位号)/depth(成功次数)都应是数字;缺失多半是旧数据,回退到"层0"

  // 濒死询问阶段:seat/asking 都应是数字座位号,resume.type 应是字符串;任一不对就整体判无效,防止卡死

  // 姜维【志继】选择阶段:seat 应是数字且存活

  // 姜维【挑衅】选择阶段:from/to 应是数字且存活


  // 郭嘉【遗计】询问阶段:seat 应是数字座位号且对应玩家存活;任一不对就整体判无效,防止卡死。

  // 李典【忘隙】询问阶段:seat 应是数字座位号且对应玩家存活;otherSeat 应是数字座位号且
  // 对应玩家存在;amount应为正整数;任一不对就整体判无效。otherSeat 的"存活性"不能一刀切
  // 要求为真——忘隙有两个合法创建入口(startNextWangxi的一般伤害队列/死亡结算处的致死
  // 入口),后者是"李典造成致命伤害,目标死亡结算完毕后才挂起询问",这时otherSeat对应的
  // 就是刚阵亡的那个人,d.death===true 正是用来标记这种合法情形的(见 respondWangxi 对
  // death 的分支处理:death=true 时只有李典自己摸牌,不要求otherSeat存活)。d.death!==true
  // 的一般场景才需要otherSeat存活,否则会把"目标已死"这个合法状态误判成脏数据清空掉。

  // 杀被抵消后的效果选择阶段:from/to 应是数字且存活;available 应是非空数组且元素合法

  // 猛进选择弃牌阶段:from/to 应是数字且存活;available 应是非空数组

  // 郭嘉【遗计】分配阶段:seat 同上;cards 应是非空数组(牌堆不足2张时会是1张,长度1或2皆合法)。

  // 华雄【耀武】选择阶段:seat=选择者(伤害来源), target=华雄, sourceCard=红色【杀】, resume=结算后恢复信息

  // 马谡【散谣】的 sanyao/sanyaoChooseTarget 两个旧 pending 类型已随第一步重新设计整体
  // 作废(改成客户端本地累积选择、一次性原子提交,不再需要服务端两阶段 pending),这里原有
  // 的两条防御性校验一并删除,不留死引用。
  // 马谡【制蛮】询问阶段:from/to 应是数字且存活, options 应是非空数组

  // 马谡【制蛮】选择牌阶段:from/to 应是数字且存活, options 应是非空数组

  // 多目标杀排队(g.fangtianQueue，方天画戟/短兵共用):非活跃时应为 null。
  // 活跃时 from/idx 应是数字、targets 应是非空数组——任一不对就整体判无效清空,防止卡死。
  if(g.fangtianQueue===undefined) g.fangtianQueue=null;
  if(g.fangtianQueue){
    const q=g.fangtianQueue;
    if(typeof q.from!=='number' || typeof q.idx!=='number' || !Array.isArray(q.targets) || q.targets.length===0){
      g.fangtianQueue=null;
    }
  }
  // 属性伤害连环传导队列：允许任一目标的濒死/技能询问中断后继续。
  if(g.chainDamageQueue===undefined) g.chainDamageQueue=null;
  if(g.chainDamageQueue){
    const q=g.chainDamageQueue;
    if(!Array.isArray(q.targets) || typeof q.idx!=='number' || typeof q.originalSeat!=='number' ||
       typeof q.amount!=='number' || q.amount<=0){
      g.chainDamageQueue=null;
    }
  }
  // 鬼才改判阶段:seat/asking 都应是数字座位号,judgeCard 应有 suit/rank,resume.kind 应是字符串;任一不对就整体判无效

  // 铁骑判定阶段:from/to 都应是数字座位号;不对就整体判无效

  // 烈弓阶段:from/to 都应是数字座位号;不对就整体判无效

  // 骁果询问阶段:endingSeat/asking 都应是数字座位号;不对就整体判无效

  // 骁果二选一阶段:from/endingSeat/to 都应是数字座位号;不对就整体判无效

  // 主公技求助阶段(激将/护驾):lordSeat/asking 应是数字座位号、need 应是字符串、
  // resume 是原 pending 快照(结构非法=这条求助链无法继续);不对就整体判无效。
  // asking 在创建/切换点恒有值,不存在"还没轮到"的合法中间态,按结构校验不误伤。
  // ⚠️ Firebase 吞 null 坑(第三次翻版,同 remainingSeats 两次):主动激将(useJijiang,
  // 出牌阶段主动入口)构造 resume={phase:'play',pending:null,jijiangTarget:X}——
  // pending:null 写入 Firebase 读回来键直接消失(null 值字段=删除该键,和"空数组存
  // 进去读回来变 undefined"是同一族序列化限制,CLAUDE.md 只记了空数组那类),resume
  // 因此缺 pending 键。这不是脏数据:出牌阶段主动激将本来就没有"正在响应的原
  // pending",pending:null 就是合法中间态。拆两层:必填结构字段(lordSeat/asking/
  // need/resume.phase)不合法才整体判死;resume 缺 pending 键时补默认 null,不误杀。

  // 孙策【制霸】拼点阶段:lordSeat/challengerSeat 应是数字座位号、challengerCard 是吴势力角色已出的拼点牌、
  // resume 是进入前的快照(play 阶段 pending 恒为 null,不要求 resume.pending 有值)。


  // 孙策【英魂】:觉醒后准备阶段选择目标/效果,再由目标选择弃牌。

  // 借刀杀人选择阶段:from/seatA/seatB 都应是数字座位号;不对就整体判无效

  // 于吉【蛊惑】质疑阶段:sourceSeat/asking 应是合法座位,实际牌和声明牌应存在;回答列表缺失时回退空数组

  // 于吉【蛊惑】目标选择阶段:声明牌已通过质疑后,由于吉为这张牌选择目标

  // 五谷丰登挑选阶段:pool/order 是数组(Firebase 吞空数组),from/idx 应是数字;不对就整体判无效

  // 火攻弃同花色阶段:from/to 都应是存活座位,suit 是展示牌花色;不对就整体判无效


  // 洛神判定阶段:seat 应是数字座位号;不对就整体判无效

  // 群体锦囊(南蛮入侵/万箭齐发)响应阶段:from/to 都应是数字座位号且对应玩家存活;不对就整体
  // 判无效——顺带清空 g.aoe(这条锦囊本身已不可恢复,和 aoeAdvance 结算完毕时的清空一致),
  // 防止孤立的 aoeResp 卡住(没人能匹配上一个不存在/已阵亡的 to,永远等不到响应)。

  // 决斗阶段:from/to/active 都应是数字座位号且对应玩家存活(active 是当前该出杀的那个人);
  // 不对就整体判无效——render.js 的旁观者 banner 直接读 g.players[active].name 没有防护,
  // active 非法会真的抛 TypeError 崩溃,不只是卡死。

  // 夏侯惇【刚烈】二选一阶段:seat(判定者本人)/sourceSeat(伤害来源)都应是数字座位号且存活;不对就整体判无效

  // 贯石斧询问阶段:from/to 都应是数字座位号且存活;不对就整体判无效——render.js 的旁观者
  // banner 直接读 g.players[from]/[to].name 没有防护,会真的崩溃。

  // 寒冰剑弃牌子阶段:from/to 都应是数字座位号且存活;不对就整体判无效——render.js 的旁观者
  // banner 直接读 g.players[from]/[to].name 没有防护,会真的崩溃。

  // 寒冰剑询问阶段(是否发动):from/to 同上;不对就整体判无效——同样在 render.js 有无防护的
  // g.players[from]/[to].name 读取。

  // 许褚【裸衣】摸牌阶段询问:和颜良文丑【双雄】(shuangxiongAsk)同一个 continueEnterDrawPhase
  // 里互斥的分支,结构完全一样——seat 应是当前回合玩家且存活,不对就整体判无效回退到摸牌阶段。

  // 张郃【巧变】"是否移动一张装备/判定牌"子阶段:seat 应是数字座位号且存活;不对就整体判无效。
  // 这个子阶段发生在"已决定跳过出牌阶段、改为移动装备"之后,回退到 'play' 让该玩家正常走出牌阶段
  // 是最安全的降级(不勉强重现"跳过出牌阶段"这个已经做出的选择)。render.js 的旁观者 banner
  // 直接读 g.players[seat].name 没有防护,会真的崩溃。

  // 张郃【巧变】回合开始"是否发动"询问:和 shuangxiongAsk/luoyiAsk 同一类"回合开始阶段的
  // 分支性询问",但这一步发生得更早(判定阶段之前)——无效时没有办法安全重放被跳过的判定/
  // 摸牌逻辑,统一降级回退到摸牌阶段(和 shuangxiongAsk/luoyiAsk 一致的近似处理)。render.js
  // 的旁观者 banner 直接读 g.players[seat].name 没有防护,会真的崩溃。

  // 左慈"更改化身"回合开始一侧:huashenChangeAskStart(是否更改)/huashenChangePickStart
  // (两级选择)——和qiaobianTurnStart同一类"回合开始阶段的分支性询问",发生在判定/摸牌
  // 阶段之前,无效时同样降级回退到摸牌阶段。额外校验huashenGeneral必须非null(和
  // continueHuashenChangeCheckAtTurnStart的触发条件保持一致,防止脏状态下问出一个
  // 本不该出现的询问)。

  // 麒麟弓选马阶段:from/to 都应是数字座位号且存活;不对就整体判无效,防止卡死
  // (render.js 这里已经用 ?:'?' 防护过读取,不会真崩溃,但座位失效仍会让选择永远问不到人)。

  // 青龙偃月刀连续杀询问阶段:from/to 都应是数字座位号且存活;不对就整体判无效——render.js
  // 的旁观者 banner 直接读 g.players[from]/[to].name 没有防护,会真的崩溃。

  // 雌雄双股剑:攻击者询问 / 目标二选一

  // 顺手牵羊/过河拆桥的选牌子阶段(g.pending.type==='pick'):trick/from/to 全是标量
  // (trick 是字符串锦囊名,from/to 是座位号)。这次专门审查过是否需要补防御,结论是刻意不改——
  // 和这一批新补防御的类型同样携带座位引用,但 pick 早有既有先例(CLAUDE.md 明确记录
  // "pending.type:'pick' 全是标量,normalize 无需改"),沿用先例不重新论证;等到真的出现过
  // 因为它卡死/崩溃的实际案例再补,不为了"看起来对称"而添加从未验证过必要性的防御代码。
  // 颜良文丑【双雄】摸牌阶段询问:seat 应是当前回合玩家且存活。

  // 观星阶段:seat 应是数字座位号且对应玩家存活,cards 应是数组;不满足整体判无效,防止卡死

  // 李典【恂恂】阶段:seat 应是数字座位号且对应玩家存活,cards 应是数组,takeN 应是正整数;不满足整体判无效

  // 群体锦囊上下文:字段不全则视为无效(全是标量,无空数组问题)
  if(g.aoe && (typeof g.aoe.from!=='number' || !g.aoe.trick || !g.aoe.need)) g.aoe=null;
  // 乐不思蜀:跳过出牌阶段的标志位,和 p.dying 同款防御
  if(typeof g.skipPlay!=='boolean') g.skipPlay=false;
  // 兵粮寸断:跳过摸牌阶段的标志位,和 g.skipPlay 同款防御
  if(typeof g.skipDraw!=='boolean') g.skipDraw=false;
  // 张郃【巧变】完整版:跳过弃牌阶段的标志位,和 g.skipDraw/g.skipPlay 同款防御
  if(typeof g.skipDiscard!=='boolean') g.skipDiscard=false;
  // 夏侯渊【神速】:相关标志位。shensuUsed1/shensuUsed2 分别对应神速1/神速2各自独立的
  // "本回合是否已发动"限制(官方规则:两者各自限一次,一回合最多发动两次,即"夏侯二刀")——
  // 【断点2修复】原来只有一个共享的 g.shensuUsed,发动神速1之后 shensuChoose2 连开启条件
  // 都不成立,神速2永远问不到,已拆成两个独立字段。
  if(typeof g.shensuUsed1!=='boolean') g.shensuUsed1=false;
  if(typeof g.shensuUsed2!=='boolean') g.shensuUsed2=false;
  if(typeof g.shensuSkipJudgingAndDraw!=='boolean') g.shensuSkipJudgingAndDraw=false;
  if(typeof g.shensuSkipPlay!=='boolean') g.shensuSkipPlay=false;
  if(typeof g.shensuShaRemaining!=='number') g.shensuShaRemaining=0;
  if(typeof g.qiaobianSkipJudge!=='boolean') g.qiaobianSkipJudge=false;
  // 徐晃【断粮】:出牌阶段限一次的标志位,和 g.shaUsed 同款防御
  // 吕蒙【克己】辅助标志:本回合是否在决斗中打出过杀,和 g.shaUsed 同款防御
  if(typeof g.shaPlayedInDuel!=='boolean') g.shaPlayedInDuel=false;
  if(typeof g.duanliangUsed!=='boolean') g.duanliangUsed=false;
  // 姜维【挑衅】:出牌阶段限一次的标志位,和 g.duanliangUsed 同款防御
  if(typeof g.tiaoxinUsed!=='boolean') g.tiaoxinUsed=false;
  // 孙权【制衡】:出牌阶段限一次的标志位,和 g.duanliangUsed 同款防御
  if(typeof g.zhihengUsed!=='boolean') g.zhihengUsed=false;
  // 刘备【激将】/曹操【护驾】:主公技每回合限一次的标志位,和 g.duanliangUsed 同款防御
  if(typeof g.jijiangUsed!=='boolean') g.jijiangUsed=false;
  if(typeof g.hujiaUsed!=='boolean') g.hujiaUsed=false;
  // 孙策【制霸】:主公技出牌阶段限一次的标志位;袁术【妄尊】:主公本回合手牌上限-1(0=无修正)
  if(typeof g.zhibaUsed!=='boolean') g.zhibaUsed=false;
  if(!Number.isInteger(g.lordHandCap)) g.lordHandCap=0;
  // 刘备【仁德】:统计当前出牌阶段已交出的牌数,到第2张时强制回复一次
  if(!Number.isInteger(g.renDeCount)) g.renDeCount=0;
  // 华佗【青囊】:出牌阶段限一次
  if(typeof g.qingNangUsed!=='boolean') g.qingNangUsed=false;
  // 荀彧【驱虎】:出牌阶段限一次
  if(typeof g.quHuUsed!=='boolean') g.quHuUsed=false;
  // 太史慈【天义】:回合内使用标记 + 本阶段拼点结果标记
  if(typeof g.tianyiUsed!=='boolean') g.tianyiUsed=false;
  if(typeof g.tianyiWin!=='boolean') g.tianyiWin=false;
  if(typeof g.tianyiLose!=='boolean') g.tianyiLose=false;
  // 貂蝉【离间】:出牌阶段限一次
  if(typeof g.liJianUsed!=='boolean') g.liJianUsed=false;
  // 周瑜【反间】:出牌阶段限一次
  if(typeof g.fanJianUsed!=='boolean') g.fanJianUsed=false;
  // 于吉【蛊惑】:每回合限一次
  if(typeof g.guhuoUsed!=='boolean') g.guhuoUsed=false;
  if(typeof g.jiuUsed!=='boolean') g.jiuUsed=false;
  if(!Array.isArray(g.wangxiQueue)) g.wangxiQueue=[];
  // 左慈"自己的hook + 借来的hook都想开pending"的排队(见triggerHook/
  // consumePendingHookQueue)——结构不完整/座位已失效就整体清空,不阻塞流程
  // (和其它排队型字段同一处理原则)。
  if(g.pendingHookQueue){
    const q=g.pendingHookQueue;
    if(typeof q.seat!=='number' || typeof q.hookName!=='string' || !q.ctx
       || (q.source!=='own' && q.source!=='borrowed') || !g.players[q.seat] || !g.players[q.seat].alive){
      g.pendingHookQueue=null;
    }
  }
  if(g.beigeQueue===undefined) g.beigeQueue=null;
  if(g.beigeQueue && (!Array.isArray(g.beigeQueue.candidates) || !Number.isInteger(g.beigeQueue.index) ||
      !Number.isInteger(g.beigeQueue.damagedSeat))){
    g.beigeQueue=null;
  }
  if(g.afterDamageEffects){
    const q=g.afterDamageEffects;
    if(!Number.isInteger(q.seat) || !g.players[q.seat] || !g.players[q.seat].alive ||
       !Array.isArray(q.actions) || !Number.isInteger(q.index) || q.index<0 || q.index>q.actions.length ||
       !q.originalResume || typeof q.originalResume.type!=='string'){
      g.afterDamageEffects=null;
    }
  }
  // 马谡【散谣】:出牌阶段限一次
  if(typeof g.sanyaoUsed!=='boolean') g.sanyaoUsed=false;
  // 曹彰【将驰】:本回合额外出杀次数剩余
  if(typeof g.jiangchiExtraShaLeft!=='number') g.jiangchiExtraShaLeft=0;
  // 孔融【礼让】:每轮限一次 + 当前礼让对象/弃牌阶段记录
  if(!Number.isInteger(g.liRangRound)) g.liRangRound=0;
  if(!g.liRangRecord || typeof g.liRangRecord!=='object') g.liRangRecord=null;
  if(g.liRangRecord){
    if(!Array.isArray(g.liRangRecord.discarded)) g.liRangRecord.discarded=[];
    if(typeof g.liRangRecord.round!=='number' || typeof g.liRangRecord.from!=='number' || typeof g.liRangRecord.to!=='number'){
      g.liRangRecord=null;
    }
  }
  // quhuRespond(拼点阶段)和 quhuDamageChoice(拼点赢后选伤害目标)结构不同,不能共用同一份校验——
  // 前者带 selfCard(拼点用的那张牌),后者带 targets(可选的伤害目标座位数组),没有 selfCard。
  // 曾经两者共用一段校验、都要求 selfCard 非空,quhuDamageChoice 从来不带这个字段,
  // 导致刚设置好 pending 就被下一次 normalize 判定"无效"直接清空、phase 打回 'play'——
  // 真实 bug:拼点赢了之后完全没机会选目标,见 CLAUDE.md 记录。
  // 夏侯渊【神速】选择阶段






  // 太史慈【天义】选牌/选目标/拼点响应


  // 周泰【不屈】询问

  // 陆逊【连营】询问

  // 公孙瓒【趫猛】:伤害结算后的选择阶段

  // 公孙瓒【趫猛】:装备选择阶段


  if(g.tiesuoQueue && (!Array.isArray(g.tiesuoQueue.targets) || !Number.isInteger(g.tiesuoQueue.idx) || typeof g.tiesuoQueue.from!=='number')){
    g.tiesuoQueue=null;
  }

  // 左慈【新生】:remaining计数循环询问,和节命的jiemingAsk同一套结构、同一套防御写法。




  // 左慈"更改化身"回合结束一侧:huashenChangeAskEnd/huashenChangePickEnd——和biyue同一类
  // "回合结束阶段的分支性询问",无效时降级回退到弃牌阶段(biyue同款处理)。




  // 鲁肃【好施】选择目标阶段:seat 应是数字且存活, candidates 应是非空数组

  // 曹仁【据守】:选择阶段

  // 徐庶【举荐】三阶段

  // 曹彰【将驰】摸牌阶段询问

  // 曹植【落英】

  // 曹植【酒诗②】翻面询问

  // 蔡文姬【悲歌】:伤害后选择是否发动

  // 蔡文姬【悲歌】:弃牌选择阶段

  // 蔡文姬【悲歌】:判定阶段

  // 蔡文姬【断肠】:死亡结算标记
  if(typeof g.dyingSource !== 'number' && g.dyingSource !== null) g.dyingSource = null;

  // 祝融【烈刃】:拼点选择阶段

  // 祝融【烈刃】:选择拼点牌阶段

  // 祝融【烈刃】:拼点响应阶段

  // 翻面状态：确保所有角色都有 faceup 属性
  for (let i = 0; i < g.players.length; i++) {
    if (g.players[i] && typeof g.players[i].faceup !== 'boolean') {
      g.players[i].faceup = true; // 默认正面朝上
    }
  }
  // 凌统【旋风】:旋风选择阶段

  // 凌统【旋风】:每回合弃牌阶段是否已触发过旋风
  if(typeof g.xuanfengDiscardUsed !== 'boolean') g.xuanfengDiscardUsed = false;
  // 凌统【旋风】:本回合弃牌阶段实际弃置的牌数（用于准确计算，避免依赖g.discard.length）
  if(typeof g.discardedThisPhase !== 'number') g.discardedThisPhase = 0;

  // 丁奉【奋迅】:为每个玩家初始化专属状态（避免多丁奉冲突）
  // 状态绑定到玩家对象而非全局对象
  for (let i = 0; i < g.players.length; i++) {
    const p = g.players[i];
    if (p) {
      if(typeof p.fenxunUsed !== 'boolean') p.fenxunUsed = false;
      if(typeof p.fenxunTarget !== 'number') p.fenxunTarget = null;
    }
  }

  // 丁奉【短兵】:使用杀时的额外目标选择阶段


  // 法正【恩怨】:伤害后选择阶段


  // 法正【恩怨】:选择交♥手牌或失去体力阶段


  // 法正【恩怨】:选择要交的♥手牌阶段


  // 法正【眩惑】:选择目标阶段


  // 法正【眩惑】:选择♥手牌阶段


  // 法正【眩惑】:选择要获得的牌阶段


  // 法正【眩惑】:选择第二个目标阶段


  // 丁奉【奋迅】:弃牌选择阶段


  // 丁奉【奋迅】:目标选择阶段


  // 曹冲【称象】: 询问是否发动阶段
  // 【压力测试发现的真实bug】这三个块(chengxiangAsk/chengxiangChoose/renxinChoose)曾经
  // 只清 g.pending、忘了同步清 g.phase——一旦这条校验真的判定为脏数据(比如曹冲在这次
  // 询问挂起期间因后续事件死亡),g.phase 会永久停在这个phase值、g.pending 却是 null,
  // 从此没有任何代码路径能再匹配上这个phase,游戏对所有人(不分真人机器人)永久卡死。
  // 这是服务端bug,不是机器人专属问题。全项目扫过 normalize 里全部93处
  // "if(g.pending&&g.pending.type===X){...g.pending=null...}"块,只有这三处漏了
  // phase重置,其余全部正确同步清理(如上面的 fenxunDiscard/fenxunTarget)。


  // 曹冲【称象】: 选择牌阶段


  // 曹冲【仁心】: 选择装备牌阶段


  // A1 响应超时托管:对有明确响应者的 pending 兜底补 askedAt(缺失时=首次读到,视为刚被询问)。
  // normalize 在 tx 写路径和 render 读路径都跑,老存档/创建处漏打的 pending 在这里补齐;
  // 创建处/asking 切换处已用 setResponseAskedAt 打过,这里绝不覆盖原值(覆盖=倒计时重置,
  // 永远等不到超时)。不再依赖 type 白名单；新增 pending 只要沿用通用响应者字段就自动覆盖。
  normalizeRegisteredStage(g);

  if(g.pending && typeof g.pending.askedAt !== 'number'){
    if(isTimedResponsePending(g,g.pending)) g.pending.askedAt = Date.now();
  }

  return g;
}
// logEvent: 追加一条结构化日志事件。ev = {text, kind?, actor?, targets?}:
//   text   —— 给日志面板/toast 显示的文本(本步仍由各调用点手写,措辞不变)
//   kind   —— 事件类型标签('damage'/'sha'/…),渲染端据此判定该不该弹 toast、以及 toast 的强调色,
//             取代原来"从文本里嗅探子串"的脆弱写法。未带 kind 的条目走旧子串判定,行为不变。
//   actor  —— 事件发起者座位号(可空);targets —— 目标座位号数组(可空)。本步只存不读,供第三步取用。
// 日志保留本局全部记录。右侧日志栏自身滚动，不再为了常驻面板只显示几条而在数据层
// 截断历史；新开一局时游戏状态本来就会重建日志数组，因此不会串到下一局。
// seq 继续从上一条派生自增，跨读取稳定。
function logEvent(log, ev){
  log = (log||[]).slice();
  const last = log.length ? log[log.length-1] : null;
  const lastSeq = (last && typeof last==='object' && Number.isInteger(last.seq)) ? last.seq : 0;
  const text = (ev && typeof ev.text==='string') ? ev.text : String(ev && ev.text!=null ? ev.text : '');
  const entry = { seq: lastSeq+1, text };
  if(ev){
    if(typeof ev.kind==='string') entry.kind = ev.kind;
    if(Number.isInteger(ev.actor)) entry.actor = ev.actor;
    if(Array.isArray(ev.targets)) entry.targets = ev.targets.filter(Number.isInteger);
  }
  log.push(entry);
  return log;
}
// pushLog: 纯文本日志便捷入口,内部就是只带 text 的 logEvent——那 177 个 g.log=pushLog(g.log,'…')
// 调用点一律不动,产出条目没有 kind,渲染端自动回退到"文本子串判定 toast"的旧路径,行为完全不变。
function pushLog(log, msg){
  return logEvent(log, { text: (typeof msg==='string' ? msg : String(msg==null?'':msg)) });
}
// markCardSound: 记录"这次打出/使用了哪张牌"这个语音播放事件,供 render.js 的
// maybePlayCardSound 检测并播放对应语音(assets/audio/{CARD_PINYIN拼音}.mp3)。
// seq 自增而不是只存牌名——"连续两次打出同一张牌名"(比如连续两个人都出杀)如果只比较
// name 文本,后一次会因为文本没变化而被误判成"和上次是同一个事件"从而漏播,seq 保证
// 每次调用都是可识别的独立事件。cardName 传的是"这次使用在游戏规则意义上算作哪张牌"
// (即 actionId/概念上的杀|闪|桃|兵粮寸断 等),不是"手里那张被转化的物理牌"——比如
// 龙胆闪当杀使用,应该播杀的语音,和玩家/其他人听到的"这是一次杀"这个游戏事件一致。
// markCardSound: seat/card 是可选的展示补充信息(座位号、牌面对象)——音效播放只看
// name+seq,不受影响;中央出牌区额外用 seat/card 显示"谁打了什么牌",调用点没有现成的
// seat/card 就不传,中央区退化为只显示牌名。targets 是可选的目标座位信息(单个座位号或
// 座位号数组,如铁索连环两个目标)——座位高亮用,没有目标的牌(如无中生有、南蛮入侵这类
// 非单目标或本步没能力提供的场景)传 null,单个座位号会被归一化成长度为1的数组。
//
// markCardSound: 中央出牌区不再区分"单次展示"和"交换展示"两套机制——曾经的 g.tableCard
// (单槽位,每次覆盖)和 g.exchangeCards(追加数组,只在 g.aoe||phase==='duel' 时才追加)
// 是并存的两条路径,靠"枚举场景"判断该用哪一条,这正是"顺手牵羊→无懈可击→反制无懈可击"
// 这类链条会漏掉中央展示的根源(不满足 aoe/duel 任一条件)。现在统一成一套:g.tableCard
// 已消灭,只保留 g.exchangeCards,每次调用无条件 push 一条完整记录(含 targets)。
//
// 何时该清空重开、何时该接着累积,不需要这里判断——tx(fn) 的结构是
// gameRef.transaction(g=>{ normalize(g); return fn(g); }),normalize(g) 处理的是"上一次
// 真正提交的状态",在这次 fn(g)(也就是这次调用 markCardSound 的这个动作本身)跑之前。
// 只要 normalize 里的兜底清空规则(见其注释)判断上一次提交时游戏是空闲的(上一条链已经
// 结束),就会在这次 fn 跑之前把数组清成 [];这次 push 自然成为新链条的第一项。如果上一次
// 提交时游戏还没空闲(链条还在进行),normalize 不清空,这次 push 自然接着累积。
function markCardSound(g, cardName, seat, card, targets){
  const seq = (g.lastCardSound && g.lastCardSound.seq) ? g.lastCardSound.seq : 0;
  g.lastCardSound = { name: cardName, seq: seq+1 };
  const normTargets = targets==null ? null
    : (Array.isArray(targets) ? targets.filter(Number.isInteger) : (Number.isInteger(targets) ? [targets] : null));
  if(!Array.isArray(g.exchangeCards)) g.exchangeCards=[];
  g.exchangeCards.push({ name: cardName, seq: seq+1, seat: (Number.isInteger(seat) ? seat : null), card: card || null, targets: normTargets });
}
// markDiscardReveal: 只由业务上明确发生且允许公开的“弃置”入口调用。
// 弃牌堆只是牌的去向，判定牌、使用/打出的牌、延时锦囊离场等均不得调用本函数。
// 事件保留最近20条，seq 单调递增，支持同一事务内连续发生多个独立弃置动作。
function markDiscardReveal(g, seat, cards){
  const list=(Array.isArray(cards)?cards:[cards]).filter(Boolean);
  if(list.length===0) return;
  const seq=Number.isInteger(g.discardRevealSeq)?g.discardRevealSeq+1:1;
  g.discardRevealSeq=seq;
  if(!Array.isArray(g.discardRevealEvents)) g.discardRevealEvents=[];
  g.discardRevealEvents.push({seq,seat:Number.isInteger(seat)?seat:null,cards:list});
  if(g.discardRevealEvents.length>20) g.discardRevealEvents=g.discardRevealEvents.slice(-20);
}
// markSkillSound: 和 markCardSound 同一模式,独立字段(lastSkillSound),记录"这次真正发动了
// 哪个技能"这个语音播放事件,供 render.js 的 maybePlaySkillSound 检测并播放对应语音
// (assets/audio/{SKILL_PINYIN拼音}.mp3)。只在"确认真的发动/生效"的分支调用,不在"仅仅有
// 资格/被询问是否发动"时调用。
function markSkillSound(g, skillName){
  const seq = (g.lastSkillSound && g.lastSkillSound.seq) ? g.lastSkillSound.seq : 0;
  g.lastSkillSound = { name: skillName, seq: seq+1 };
}
// markMovieFx: 过场动画事件——游戏逻辑在关键剧情点(武将死亡/胜负结算)写入,各客户端
// render.js 的 maybePlayMovieFx 检测 seq 变化后按 kind+座位/身份过滤播放对应全屏视频
// (见 game-bg.js MOVIE_VIDEOS)。和 markCardSound/g.lastDamageEffect 同一套"seq 自增去重、
// 只保留最新一次"的模式。seat 语义按 kind 而定(死者/杀手/事件主体座位),不需要时传 null。
// result: 可选的结算结果表(仅 kind==='gameOver' 使用,含各阵营胜负),前端按身份分派动画。
function markMovieFx(g, kind, seat, result){
  const seq=(g.lastMovieFx && Number.isInteger(g.lastMovieFx.seq)) ? g.lastMovieFx.seq : 0;
  g.lastMovieFx={seq:seq+1, kind:kind, seat:(Number.isInteger(seat)?seat:null)};
  if(result!==undefined) g.lastMovieFx.result=result;
}
function nextAlive(g, from){
  const n=g.players.length; // 按实际玩家数取模,支持 2 或 3 人
  for(let k=1;k<=n;k++){
    const s=(from+k)%n;
    if(g.players[s] && g.players[s].alive) return s;
  }
  return from;
}
function aliveCount(g){ return g.players.filter(p=>p&&p.alive).length; }
// 牌堆空则把弃牌堆洗回牌堆;返回牌堆此刻是否有牌(true/false)。摸牌与判定共用同一重洗口径。
function ensureDeck(g){
  if(g.deck.length===0){
    if(g.discard.length===0) return false;
    g.deck = g.discard; g.discard = [];
    for(let a=g.deck.length-1;a>0;a--){const b=Math.floor(Math.random()*(a+1));[g.deck[a],g.deck[b]]=[g.deck[b],g.deck[a]];}
  }
  return true;
}
function drawN(g, seat, n){
  for(let i=0;i<n;i++){
    if(!ensureDeck(g)) break;
    g.players[seat].hand.push(g.deck.pop());
  }
}
function drawPhaseCount(g, seat){
  return 2 + generalCapValue(g.players[seat],'extraDrawPhase',0);
}
function eligibleLiRangSeat(g, targetSeat){
  if(g.liRangRound===g.roundNum) return null;
  for(let k=1;k<=g.players.length;k++){
    const s=(targetSeat+k)%g.players.length;
    const p=g.players[s];
    if(s!==targetSeat && p && p.alive && hasCap(p,'lirang') && (p.hand||[]).length>=2) return s;
  }
  return null;
}
function finishDrawPhase(g, seat, n){
  drawN(g, seat, n);
  g.log=pushLog(g.log, g.players[seat].name+' 摸了'+n+'张牌');
  
  // 鲁肃【好施】:摸牌后若手牌数>5,需将一半手牌交给手牌最少的其他角色
  const p = g.players[seat];
  if(p && p.alive && hasCap(p, 'haoshi') && (p.hand || []).length > 5){
    const half = Math.floor(p.hand.length / 2);
    if(half > 0){
      // 找手牌最少的其他存活角色
      let targetSeats = [];
      let minHand = Infinity;
      for(let i = 0; i < g.players.length; i++){
        if(i === seat || !g.players[i] || !g.players[i].alive) continue;
        const handCount = (g.players[i].hand || []).length;
        if(handCount < minHand){
          minHand = handCount;
          targetSeats = [i];
        } else if(handCount === minHand){
          targetSeats.push(i);
        }
      }
      // 若只有一个目标，直接分配
      if(targetSeats.length === 1){
        const targetSeat = targetSeats[0];
        const cardsToGive = removeHandCards(g, seat, Array.from({length:half},(_,i)=>i)).reverse();
        g.players[targetSeat].hand.push(...cardsToGive);
        g.log=pushLog(g.log, p.name+' 发动【好施】,将'+half+'张手牌交给 '+g.players[targetSeat].name);
        markSkillSound(g, '好施');
      } else if(targetSeats.length > 1){
        // 多个最少手牌的角色，需要玩家选择
        g.pending = { type: 'haoshiPick', seat, half, candidates: targetSeats };
        g.phase = 'haoshiPick';
        g.log = pushLog(g.log, p.name+' 发动【好施】,请选择要交给的角色…');
        // CORE-112:这里必须 return——不然会继续往下跑到函数末尾的 advancePastPlay(g),
        // 那一行会把刚设好的 g.phase 立刻覆盖回 'play'(默认分支),而 g.pending 还留着
        // 'haoshiPick',形成"phase已经是play、pending却还是haoshiPick"的残留状态,
        // 机器人/UI都对不上号,永久卡死(真实用 soak.js 压测复现过)。挂起的分支必须像
        // 下面的神速2分支一样显式 return,不能让流程继续往下走。
        return;
      }
    }
  }
  
  // 乐不思蜀/张郃【巧变】:摸牌阶段照常摸牌,只是不给出牌(或弃牌)机会——advancePastPlay
  // 统一判断出牌/弃牌阶段是否被跳过,不在这里各自重复逻辑。
  
  // 夏侯渊【神速2】: 摸牌完成后检查是否可以发动(用 g.turn,不看客户端 mySeat)。
  // 【断点2修复】检查 shensuUsed2(神速2自己的标志位),不再检查共享的 shensuUsed——
  // 发动过神速1不应该挡住神速2这个独立的询问。
  if (hasCap(g.players[seat], 'shensu') && !g.shensuUsed2 && seat === g.turn) {
    // 【A类修复】补setResponseAskedAt。
    g.pending = setResponseAskedAt({ type: 'shensuChoose2', seat: seat });
    g.phase = 'shensuChoose2';
    g.log = pushLog(g.log, g.players[seat].name + ' 可以发动【神速】跳过出牌阶段并弃置装备牌');
    return;
  }
  
  advancePastPlay(g);
}
function damageAmount(g, sourceSeat, baseAmount, cardType, options){
  let amount=baseAmount;
  const source=g.players[sourceSeat];
  if(source && g.luoyiActive && sourceSeat===g.turn && hasCap(source,'luoyi') && (cardType==='sha' || cardType==='duel')){
    amount++;
    g.log=pushLog(g.log, source.name+' 【裸衣】生效,此伤害+1');
  }
  if(options && options.jiuBonus && cardType==='sha' && source){
    amount++;
    g.log=pushLog(g.log, source.name+' 的【酒】生效,此【杀】伤害+1');
  }
  return amount;
}
function isTrickCardName(name){
  return !!name && !BASIC_CARDS.includes(name) && !getEquip(name);
}
// 通用判定:翻牌堆顶一张(堆空则先重洗弃牌堆),亮出后进弃牌堆,返回这张牌(供调用方看花色/颜色)。
// 通用无副作用——不含任何具体技能逻辑,闪电/乐不思蜀等日后复用。堆+弃都空则返回 null,调用方容错。
function judge(g){
  if(!ensureDeck(g)) return null;
  const card = g.deck.pop();
  g.discard.push(card);
  g.log=pushLog(g.log, '判定牌:'+card.suit+rankText(card.rank));
  return card;
}
// 八卦阵:被要求出【闪】时先判定,红=视为打出一张【闪】(免这次伤害),黑=判定失败(仍走正常出闪/受伤)。
// 只在「需要出闪」的响应点调用。能力来源=装备(cap:'bagua'),走 hasCap 不硬编码牌名。
// 返回三态:true=判定成功(红)、false=判定失败(黑/无牌)、'pending'=挂起等待【鬼才】改判决定
// (调用方收到 'pending' 应立即 return,收尾延后到 finishGuicai 处理,和 dealDamage 的濒死挂起同一套路)。
// resumeInfo 由调用方传入,记录"改判解决后该接回哪条被打断的流程"(见 finishGuicai)。
function tryBagua(g, seat, resumeInfo){
  const p=g.players[seat];
  if(!p || !p.alive || !hasCap(p,'bagua')) return false;
  g.log=pushLog(g.log, p.name+' 发动【八卦阵】');
  const card=judge(g);
  if(!card) return false; // 无牌可判,视为未发动
  if(maybeGuicai(g, seat, card, Object.assign({kind:'bagua'}, resumeInfo))==='pending') return 'pending';
  return finishBaguaColor(g, seat, card);
}
// finishBaguaColor: 八卦阵判定的红黑结算(独立出来,供 tryBagua 直接判 和 finishGuicai 改判后判 共用)。
function finishBaguaColor(g, seat, card){
  const p = g.players[seat];
  markHongyanIfConverted(g,p,card);
  if(isRedForPlayer(p, card)){ g.log=pushLog(g.log, p.name+' 判定为红,视为打出【闪】'); return true; }
  g.log=pushLog(g.log, p.name+' 判定为黑,【八卦阵】未生效'); return false;
}
// ===== 鬼才:判定牌亮出后,判定者自己(优先)或攻击范围内的其他鬼才拥有者可打出一张手牌替换 =====
// 四个判定场景(八卦阵 tryBagua、闪电/乐不思蜀/兵粮寸断的 processOneDelayCard)都调用 maybeGuicai,
// 不各自实现一遍"谁可以发起"的枚举。
// nextGuicaiAsker: 从 current 的下家起,按座位顺序找下一个"有资格发起鬼才"的候选人——
// 存活 + hasCap(p,'guicai') + 手牌非空 + 攻击范围够到 judgedSeat(candidateSeat→judgedSeat
// 距离<=candidateSeat攻击范围,用 canReachSha)。绕回 judgedSeat 即问完一圈,返回 null。
function nextGuicaiAsker(g, judgedSeat, current){
  const n=g.players.length;
  for(let k=1;k<=n;k++){
    const s=(current+k)%n;
    if(s===judgedSeat) return null;
    const p=g.players[s];
    if(p && p.alive && hasCap(p,'guicai') && (p.hand||[]).length>0 && canReachSha(g, s, judgedSeat)) return s;
  }
  return null;
}
// firstGuicaiAsker: 判定者自己优先(若有资格);否则按座位顺序找第一个有资格的其他人。
function firstGuicaiAsker(g, judgedSeat){
  const p=g.players[judgedSeat];
  if(p && hasCap(p,'guicai') && (p.hand||[]).length>0) return judgedSeat;
  return nextGuicaiAsker(g, judgedSeat, judgedSeat);
}
// maybeGuicai: 判定牌亮出后统一入口。若存在有资格的候选人,挂起询问,返回 'pending'
// (调用方应立即 return,原有处理延后到 finishGuicai 按 resume.kind 接回);没人有资格
// 则不挂起,返回 undefined,调用方照常用原判定牌结算。
// resume 记录"改判解决后用哪条逻辑消费最终判定牌"——resume.kind:'bagua'(走 finishBaguaColor,
// resume.type 是 sha/aoe,和原本一致)或 'delayJudge'(走 DELAY_TRICKS[trickName].effect)。

// ===== 张角【雷击】 =====
// maybeStartLeiji: 张角使用或打出【闪】时触发雷击。resume(可选):调用方在南蛮入侵/万箭齐发
// 的响应(aoeRespond)里触发雷击时传 {prevSeat:mySeat}——雷击整条链路(leijiChoose→
// leijiJudge→可能的鬼道/鬼才改判)结束后,要靠这个字段知道"该不该转而调用 aoeAdvance 续接
// 群体锦囊队列的下一个目标",而不是无条件回到 play、把还没问到的目标凭空丢弃。respondShan
// (单体杀响应)调用时不传,g.leijiResume 保持 null,行为和 3/4 完全一致。
function maybeStartLeiji(g, sourceSeat, shanCard, resume) {
  const source = g.players[sourceSeat];
  if(!source || !source.alive || !hasCap(source, 'leiji')) return false;

  // 找出所有其他存活角色
  const aliveSeats = [];
  for(let i = 0; i < g.players.length; i++){
    if(g.players[i] && g.players[i].alive && i !== sourceSeat){
      aliveSeats.push(i);
    }
  }

  if(aliveSeats.length === 0) return false;

  g.leijiResume = resume || null;
  // 进入雷击选择阶段
  g.pending = {
    type: 'leijiChoose',
    sourceSeat: sourceSeat,
    availableTargets: aliveSeats,
    shanCard: shanCard
  };
  g.phase = 'leijiChoose';
  g.log = pushLog(g.log, source.name + ' 可以发动【雷击】,选择一名角色进行判定');
  markSkillSound(g, '雷击');
  return true;
}
// finishLeijiChain: 雷击整条链路(不管是判完黑桃/非黑桃、还是中途取消、还是无牌可判/目标已死
// 这类早退)真正结束时的唯一收尾出口——所有 doLeijiJudge/cancelLeiji/finishGuidu(leijiJudge
// 分支)的退出点都必须经过这里,不能各自直接写 g.pending=null;g.phase='play'。按 g.leijiResume
// 是否存在分两种收尾:有(这次雷击是从南蛮/万箭响应里触发的)→ 消费掉这个标记,改用
// aoeAdvance(g, resume.prevSeat) 续接群体锦囊剩余的目标;没有(respondShan 触发的普通场景,
// 3/4 的既有行为)→ 照旧回到 play。
function finishLeijiChain(g){
  if(g.leijiResume){
    const resume = g.leijiResume;
    g.leijiResume = null;
    g.pending = null;
    aoeAdvance(g, resume.prevSeat);
  } else {
    g.pending = null;
    g.phase = 'play';
  }
}

// triggerLeiji: 选择雷击的目标角色
function triggerLeiji(targetSeat) {
  tx(g => {
    const pending = g.pending;
    if (!pending || pending.type !== 'leijiChoose' || pending.sourceSeat !== mySeat) return g;
    
    if(!pending.availableTargets.includes(targetSeat)) return g;
    
    const source = g.players[mySeat];
    const target = g.players[targetSeat];
    
    if (!source || !source.alive || !target || !target.alive) return g;
    
    // 进入雷击判定阶段
    g.pending = {
      type: 'leijiJudge',
      sourceSeat: mySeat,
      targetSeat: targetSeat,
      resume: { kind: 'leijiJudge', sourceSeat: mySeat, targetSeat: targetSeat }
    };
    g.phase = 'leijiJudge';
    g.log = pushLog(g.log, source.name + ' 对 ' + target.name + ' 发动【雷击】,进行判定');
    
    return g;
  });
}

// doLeijiJudge: 执行雷击判定
function doLeijiJudge(g) {
  tx(g => {
    const pending = g.pending;
    if (!pending || pending.type !== 'leijiJudge') return g;
    
    const { sourceSeat, targetSeat, resume } = pending;
    const source = g.players[sourceSeat];
    const target = g.players[targetSeat];
    
    if (!source || !source.alive || !target || !target.alive) {
      finishLeijiChain(g);
      return g;
    }

    // 进行判定
    const judgeCard = judge(g);
    if(!judgeCard) {
      finishLeijiChain(g);
      return g;
    }

    // 先检查是否有改判技能（按照规则顺序）
    // 这里先检查鬼道，因为鬼道应该先于其他改判技能被询问
    if(maybeGuidu(g, targetSeat, judgeCard, resume) === 'pending') return g;

    // 然后检查鬼才
    if(maybeGuicai(g, targetSeat, judgeCard, resume) === 'pending') return g;

    // 如果没有改判或改判完成后，检查判定结果
    // 注意: 如果有改判，judgeCard可能已经被替换
    const finalCard = judgeCard; // 如果有改判，会在finishGuidu或finishGuicai中处理
    if(finalCard.suit === '♠'){
      // 造成2点雷电伤害——必须检查dealDamage的返回值:2点伤害若致目标进入濒死(或触发仁心/
      // 制蛮等其它onDamaged打断),dealDamage会挂起一个新pending并返回true,此时必须立即
      // return,不能再往下跑finishLeijiChain(那会在同一次tx里把刚挂起的pending原地冲掉,
      // 目标从未真正获得求桃机会)。濒死流程结束后会经resumeAfterInterrupt的'leiji'分支
      // 自动接回这里(见该分支注释),不需要雷击自己处理续接。
      const dying = dealDamage(g, targetSeat, 2, sourceSeat, source.name + ' 的【雷击】效果', 'leiji');
      g.log = pushLog(g.log, target.name + ' 判定为' + finalCard.suit + rankText(finalCard.rank) + ',受到2点雷电伤害');
      if(dying) return g;
    } else {
      g.log = pushLog(g.log, target.name + ' 判定为' + finalCard.suit + rankText(finalCard.rank) + ',【雷击】无效');
    }

    // 清理状态——统一走 finishLeijiChain,不直接写 g.pending=null;g.phase='play'
    finishLeijiChain(g);

    return g;
  });
}

// cancelLeiji: 取消雷击
function cancelLeiji() {
  tx(g => {
    if (g.pending && (g.pending.type === 'leijiChoose' || g.pending.type === 'leijiJudge') &&
        g.pending.sourceSeat === mySeat) {
      g.log = pushLog(g.log, g.players[mySeat].name + ' 取消发动【雷击】');
      finishLeijiChain(g); // 统一走链路收尾出口,不直接写 g.pending=null;g.phase='play'
    }
    return g;
  });
}

// ===== 张角【鬼道】 =====
// maybeGuidu: 当判定牌即将生效时,检查是否有张角可以发动鬼道
// 遵循规则:从当前回合角色开始,按逆时针座次顺序依次询问
function maybeGuidu(g, judgedSeat, judgeCard, resume) {
  // 获取当前回合角色
  const currentTurn = g.turn;
  const n = g.players.length;
  
  // 从当前回合角色开始,逆时针方向(即座位递减方向)寻找有资格的张角
  // 座位顺序:0,1,2,3... -> 逆时针:currentTurn, (currentTurn-1+n)%n, (currentTurn-2+n)%n...
  for(let k = 0; k < n; k++){
    const s = (currentTurn - k + n) % n;
    const p = g.players[s];
    
    if(p && p.alive && hasCap(p, 'guidu')) {
      // 检查是否有黑色手牌可以打出
      const hand = p.hand || [];
      for(const card of hand){
        if(card.suit === '♠' || card.suit === '♣'){
          // 找到第一个有资格的张角
          // 【系统性扫描发现的遗漏】补setResponseAskedAt,否则30秒超时兜底对这个pending
          // 形同虚设(和郭嘉遗计yijiAsk同一批问题)。
          g.pending = setResponseAskedAt({
            type: 'guiduAsk',
            sourceSeat: s,
            judgedSeat: judgedSeat,
            judgeCard: judgeCard,
            resume: resume,
            askedSeats: []
          });
          g.phase = 'guiduAsk';
          g.log = pushLog(g.log, '询问 ' + p.name + ' 是否发动【鬼道】替换 ' + g.players[judgedSeat].name + ' 的判定牌');
          return 'pending';
        }
      }
    }
  }
  
  return null;
}

// triggerGuidu: 鬼道选择替换牌
function triggerGuidu(cardIndex) {
  tx(g => {
    const pending = g.pending;
    if (!pending || pending.type !== 'guiduAsk' || pending.sourceSeat !== mySeat) return g;
    
    const source = g.players[mySeat];
    const judgedSeat = pending.judgedSeat;
    const judgeCard = pending.judgeCard;
    const resume = pending.resume;
    
    if (!source || !source.alive || !source.hand || cardIndex >= source.hand.length) return g;
    
    const replaceCard = source.hand[cardIndex];
    
    // 检查是否为黑色牌
    if(replaceCard.suit !== '♠' && replaceCard.suit !== '♣') {
      g.log = pushLog(g.log, source.name + ' 只能打出黑色牌发动【鬼道】');
      // 继续询问下一个张角
      return askNextGuidu(g);
    }
    
    // 打出黑色牌
    removeHandCards(g, mySeat, cardIndex);
    g.discard.push(replaceCard);
    
    g.log = pushLog(g.log, source.name + ' 发动【鬼道】,用【' + replaceCard.name + '】替换判定牌');
    markSkillSound(g, '鬼道');
    
    // 记录已询问的座位
    if(!pending.askedSeats) pending.askedSeats = [];
    pending.askedSeats.push(mySeat);
    
    // 继续询问下一个张角（支持后手优势）
    return askNextGuidu(g, replaceCard);
  });
}

// askNextGuidu: 询问下一个张角。
// 【嵌套tx修复】这个函数原来自己又包了一层 tx(g=>{...}),但它的调用方
// triggerGuidu/cancelGuidu 本身已经身处另一个 tx() 事务回调内部——在一个尚未
// 提交的事务内部同步发起一个全新的、独立的异步事务,两个事务互相竞争、状态互相
// 踩踏,而且这个函数体本身没有 return 语句(永远返回 undefined),外层 tx() 的
// `const result = fn(g) || g` 兜底会吞掉这个 undefined,导致 pending/phase 的
// 推进全部发生在抢跑的嵌套事务里,外层实际提交的只有手牌/弃牌堆的就地修改——
// 判定牌换不掉、界面卡住。改成和 finishGuicai/continueBiyueCheck 这些"接回被
// 打断流程"的辅助函数同样的写法:直接操作传入的 g 并 return g,不发起新事务,
// 调用方 triggerGuidu/cancelGuidu 的 `return askNextGuidu(g, ...)` 不需要改动。
function askNextGuidu(g, currentReplaceCard = null) {
  const pending = g.pending;
  if (!pending || pending.type !== 'guiduAsk') {
    if(currentReplaceCard) {
      // 没有其他张角需要询问,使用当前替换牌作为最终判定牌
      g.pending = null;
      return finishGuidu(g, pending.judgedSeat, currentReplaceCard, pending.resume);
    }
    return g;
  }

  const currentTurn = g.turn;
  const n = g.players.length;
  const judgedSeat = pending.judgedSeat;
  const askedSeats = pending.askedSeats || [];

  // 从当前回合角色开始,逆时针寻找下一个有资格的张角
  for(let k = 0; k < n; k++){
    const s = (currentTurn - k + n) % n;
    const p = g.players[s];

    // 跳过已经询问过的
    if(askedSeats.includes(s)) continue;

    if(p && p.alive && hasCap(p, 'guidu')) {
      // 检查是否有黑色手牌可以打出
      const hand = p.hand || [];
      for(const card of hand){
        if(card.suit === '♠' || card.suit === '♣'){
          // 找到下一个有资格的张角
          pending.askedSeats = askedSeats;
          pending.sourceSeat = s;
          setResponseAskedAt(pending); // 切换下一位候选人即重新计时,和guhuoQuestion同一约定
          g.phase = 'guiduAsk';
          g.log = pushLog(g.log, '询问 ' + p.name + ' 是否发动【鬼道】替换 ' + g.players[judgedSeat].name + ' 的判定牌');
          return g;
        }
      }
      // 标记为已询问（但无黑色牌）
      askedSeats.push(s);
    }
  }

  // 没有其他张角需要询问
  if(currentReplaceCard) {
    // 使用当前替换牌作为最终判定牌
    g.pending = null;
    return finishGuidu(g, pending.judgedSeat, currentReplaceCard, pending.resume);
  } else {
    // 无人发动鬼道:必须用原判定牌(pending.judgeCard,从未被替换过)接回原判定的收尾流程——
    // 和 respondGuicai 找不到下一个鬼才候选人时 finishGuicai(g, g.pending.judgeCard) 同一
    // 处理方式,不能直接清空 pending/phase 了事。这里曾经就是直接清空,导致任何判定(八卦阵/
    // 延时锦囊/铁骑/洛神/双雄/刚烈/悲歌/雷击等,只要走 maybeGuidu 这个统一入口的判定类型)
    // 只要被问过"是否发动鬼道"、最终没有人真的换牌,原判定就会被整个静默吞掉——牌从判定区
    // 消失、效果完全不执行,还不报错也不卡死,表现为"看起来正常但效果凭空消失"。这是系统级
    // 缺陷,影响面覆盖全部判定类型,不止张角自己的雷击。
    g.pending = null;
    return finishGuidu(g, pending.judgedSeat, pending.judgeCard, pending.resume);
  }
}

// finishGuidu: 鬼道替换后的处理函数。resume.kind 的分派逻辑必须和姐妹函数 finishGuicai
// (鬼才改判,同一份 resume 结构、同一批判定场景)保持同等完整——鬼道和鬼才都是"判定牌亮出后
// 可能被人用一张牌替换掉"这同一件事的两种不同技能,替换完之后"该怎么接回原判定所在的流程"
// 是完全一致的收尾逻辑,不该因为触发技能不同就分派得比对方浅。以下 bagua/delayJudge/
// beigeJudge 三段是逐字对照 finishGuicai(1776行起)搬过来的,不是重新设计。
function finishGuidu(g, judgedSeat, replaceCard, resume) {
  // 使用替换后的牌作为判定结果
  // 调用对应的判定处理函数

  if(resume.kind === 'bagua'){
    // 八卦阵判定:判红黑之后还要按 resume.type(sha/aoe)接回被打断的流程——红则视为出闪,
    // 推进 maybeStartShaOffsetEffects/finishSingleShaTarget 或 aoeAdvance;黑则原判定失败,
    // 必须重新开出 respond/aoeResp pending 问真正的杀/闪,不能就此不了了之。
    const red = finishBaguaColor(g, judgedSeat, replaceCard);
    if(resume.type==='sha'){
      if(red){
        if(!maybeStartShaOffsetEffects(g, resume.from, resume.to, resume.sourceCard, !!(resume.shaInfo && resume.shaInfo.jiuBonus))) finishSingleShaTarget(g);
      } else {
        g.pending=setResponseAskedAt({from:resume.from, to:resume.to});
        if(resume.sourceCard!==undefined) g.pending.sourceCard=resume.sourceCard;
        if(resume.shaInfo && resume.shaInfo.jiuBonus) g.pending.jiuBonus=true;
        g.phase='respond';
      }
    } else if(resume.type==='aoe'){
      if(red){
        g.log=pushLog(g.log, g.players[resume.target].name+' 以【八卦阵】抵消【'+g.aoe.trick+'】');
        aoeAdvance(g, resume.target);
      } else {
        g.pending=setResponseAskedAt({type:'aoeResp', from:g.aoe.from, to:resume.target, need:g.aoe.need});
        if(g.aoe.sourceCard!==undefined) g.pending.sourceCard=g.aoe.sourceCard;
        g.phase='aoeResp';
        g.log=pushLog(g.log, '要求 '+g.players[resume.target].name+' 打出【'+g.aoe.need+'】');
      }
    }
    return g;
  } else if(resume.kind === 'delayJudge'){
    // 延时锦囊判定:finishDelayCard 只处理这一张牌本身,还要跟一句 continueDelayResolution
    // 才能推进判定区剩余的牌/摸牌阶段——和 finishGuicai 的 delayJudge 分支同一套嵌套挂起
    // 处理(若又挂起了濒死/遗计,resume 只有 {type:'delay'},这里要补上 seat;若挂起的是
    // 鬼才/鬼道自己的改判,resume 已经自带完整信息,不能覆盖)。
    const result=finishDelayCard(g, resume.seat, DELAY_TRICKS[resume.trickName], replaceCard, resume.card);
    if(result==='pending'){
      // 落英已改为确定正收益自动发动：finishDelayCard 仍以 'pending' 表示“本层不要
      // 再次续接”，但落英会在内部直接续接并保持 g.pending=null。这里只能在确有
      // 新挂起时补 resume，不能把 'pending' 返回值等同于 pending 对象必然存在。
      if(g.pending && (g.pending.type==='dying' || g.pending.type==='yijiAsk' || (g.pending.resume&&g.pending.resume.type==='afterDamageEffects'))) setInterruptedDamageResume(g,{type:'delay',seat:resume.seat});
      return g;
    }
    continueDelayResolution(g, resume.seat);
    return g;
  } else if(resume.kind === 'tieqiJudge'){
    // 铁骑判定
    return finishTieqiJudge(g, resume.from, resume.to, replaceCard, resume.sourceCard, resume.shaColor, resume.shaInfo);
  } else if(resume.kind === 'luoshenJudge'){
    // 洛神判定
    return finishLuoshenJudge(g, resume.seat, replaceCard);
  } else if(resume.kind === 'shuangxiongJudge'){
    // 双雄判定
    return finishShuangxiongJudge(g, resume.seat, replaceCard);
  } else if(resume.kind === 'ganglieJudge'){
    // 刚烈判定
    return finishGanglieJudge(g, replaceCard, resume.seat, resume.sourceSeat, resume.resume);
  } else if(resume.kind === 'beigeJudge'){
    // 蔡文姬【悲歌】判定:此前完全没有这个分支,会落到下面的通用兜底(g.pending=null;
    // g.phase='play'),悲歌该有的回血/摸牌/翻面/伤害来源弃牌全部被静默吞掉——加上专属分支,
    // 和 finishGuicai 的 beigeJudge 分支(处理鬼才改判悲歌判定的同一场景)完全对齐。
    processBeigeJudgeResult(g, replaceCard, resume.sourceSeat, resume.damagedSeat, resume.damageSource);
    return g;
  } else if(resume.kind === 'leijiJudge'){
    // 雷击判定（特殊情况）——统一走 finishLeijiChain 收尾(和 doLeijiJudge/cancelLeiji 同一
    // 出口),不落到下面给其它 kind 兜底用的通用 g.pending=null;g.phase='play',否则雷击若是
    // 从南蛮/万箭响应里触发、又被鬼道/鬼才改判过,g.leijiResume 记着的续接队列信息就会被漏掉,
    // 重演场景5那个"其余目标被凭空丢弃"的问题。
    const { sourceSeat, targetSeat } = resume;
    const target = g.players[targetSeat];
    if(replaceCard.suit === '♠'){
      // 同 doLeijiJudge:必须检查dealDamage返回值,致濒死时立即return,不能执行finishLeijiChain。
      const dying = dealDamage(g, targetSeat, 2, sourceSeat, g.players[sourceSeat].name + ' 的【雷击】效果', 'leiji');
      g.log = pushLog(g.log, target.name + ' 被替换判定为' + replaceCard.suit + rankText(replaceCard.rank) + ',受到2点雷电伤害');
      if(dying) return g;
    } else {
      g.log = pushLog(g.log, target.name + ' 被替换判定为' + replaceCard.suit + rankText(replaceCard.rank) + ',【雷击】无效');
    }
    finishLeijiChain(g);
    return g;
  }

  // 清理状态
  g.pending = null;
  g.phase = 'play';

  return g;
}

// cancelGuidu: 取消鬼道
function cancelGuidu() {
  tx(g => {
    if (g.pending && g.pending.type === 'guiduAsk' && g.pending.sourceSeat === mySeat) {
      const pending = g.pending;
      // 记录已询问的座位
      if(!pending.askedSeats) pending.askedSeats = [];
      pending.askedSeats.push(mySeat);
      g.log = pushLog(g.log, g.players[mySeat].name + ' 取消发动【鬼道】');
      // 继续询问下一个张角
      return askNextGuidu(g);
    }
    return g;
  });
}

// 修改 maybeGuicai 函数,集成所有改判技能的统一询问逻辑
// 所有改判技能(鬼道、鬼才等)都应使用相同的顺序规则
// 先检查鬼道,因为鬼道和鬼才都使用相同的改判顺序规则
function maybeGuicai(g, judgedSeat, card, resume){
  // 先检查鬼道
  if(maybeGuidu(g, judgedSeat, card, resume) === 'pending') return 'pending';
  
  const asker=firstGuicaiAsker(g, judgedSeat);
  if(asker===null) return;
  g.pending=setResponseAskedAt({type:'guicai', seat:judgedSeat, asking:asker, judgeCard:card, resume});
  g.phase='guicai';
  g.log=pushLog(g.log, g.players[judgedSeat].name+' 判定得到 '+card.suit+rankText(card.rank)+',询问 '+g.players[asker].name+' 是否发动【鬼才】替换判定牌…');
  return 'pending';
}
// respondGuicai: 仅当前被问的人(pending.asking)可响应。替换:打出一张手牌(移出手牌/进弃牌堆),
// 用它的花色/内容结算,调 finishGuicai;不替换:推进到下一个候选人(nextGuicaiAsker),
// 问完一圈(绕回判定者自己)才用原判定牌结算——和无懈可击"不出→问下一个"同一套结构。
function respondGuicai(useReplace, cardIdx){
  tx(g=>{
    if(g.phase!=='guicai'||!g.pending||g.pending.type!=='guicai') return g;
    if(g.pending.asking!==mySeat) return g;
    const me=g.players[mySeat];
    if(useReplace){
      const card=(me.hand||[])[cardIdx];
      if(!card) return g; // 没这张牌:状态不变(双重保险)
      removeHandCards(g, mySeat, cardIdx);
      g.discard.push(card);
      g.log=pushLog(g.log, me.name+' 发动【鬼才】,打出'+card.suit+rankText(card.rank)+' 替换判定牌');
      markSkillSound(g, '鬼才');
      finishGuicai(g, card);
      return g;
    }
    g.log=pushLog(g.log, me.name+'：不发动【鬼才】');
    const nxt=nextGuicaiAsker(g, g.pending.seat, mySeat);
    if(nxt===null){ finishGuicai(g, g.pending.judgeCard); return g; }
    g.pending.asking=nxt;
    setResponseAskedAt(g.pending); // A1:切换被问者即重新计时
    g.log=pushLog(g.log, '询问 '+g.players[nxt].name+' 是否发动【鬼才】替换判定牌…');
    return g;
  });
}
// finishGuicai: 鬼才改判解决(不管替换与否)。按 resume.kind 分派——
// 'bagua':和原来一样走 finishBaguaColor + resume.type(sha/aoe)接回被打断的流程;
// 'delayJudge':用最终判定牌重新调用该延时锦囊的 effect,处理去向后继续该玩家判定区剩余的牌。
function finishGuicai(g, finalCard){
  const resume=g.pending.resume;
  // judgedSeat: 由 maybeGuicai 统一写在 g.pending.seat 上,不管 resume 具体带了哪些字段都始终
  // 正确——kind==='bagua' 的 resume(来自 tryBagua 的 resumeInfo,sha 场景是 {type,from,to,
  // sourceCard}、aoe 场景是 {type,target})都没有 .seat 这个字段,直接读 resume.seat 会是
  // undefined(真实踩过的坑:finishBaguaColor 内部 g.players[undefined] 抛异常,和本次要修的
  // ReferenceError 同一类问题,只是换了个位置)。g.pending.seat 才是所有 kind 都保证存在、
  // 值恒等于判定者座位的字段,必须在 g.pending=null 之前先取出来。
  const judgedSeat=g.pending.seat;
  g.pending=null;
  if(resume.kind==='delayJudge'){
    const result=finishDelayCard(g, resume.seat, DELAY_TRICKS[resume.trickName], finalCard, resume.card);
    if(result==='pending'){
      // 又挂起了(嵌套濒死、嵌套鬼才、或郭嘉【遗计】)。和 continueDelayResolution 的收尾同一套
      // 逻辑,不能省略:若新挂起是濒死或遗计(g.pending.type==='dying'||'yijiAsk'),它的 resume
      // 只有 {type:'delay'}(dealDamage/startDying 不知道 seat是谁,这个信息只有这里——鬼才改判
      // 后重新触发的 finishDelayCard——才知道),这里必须补上 seat,否则接回流程时读 resume.seat
      // 是 undefined,g.players[undefined] 直接抛异常(真实 bug:鬼才替换了延时锦囊的判定牌、
      // 替换后结果致命时才会走到这条分支,此前测试没覆盖到这个组合)。若新挂起是鬼才(嵌套鬼才
      // 改判),它的 resume 已经自带完整信息,绝不能覆盖。
      // 同上：自动落英会自己续接判定流程，此时 result==='pending' 但 g.pending 为 null。
      if(g.pending && (g.pending.type==='dying' || g.pending.type==='yijiAsk' || (g.pending.resume&&g.pending.resume.type==='afterDamageEffects'))) setInterruptedDamageResume(g,{type:'delay',seat:resume.seat});
      return;
    }
    continueDelayResolution(g, resume.seat);
    return;
  }
  if(resume.kind==='tieqiJudge'){
    finishTieqiJudge(g, resume.from, resume.to, finalCard, resume.sourceCard, resume.shaColor, resume.shaInfo);
    return;
  }
  if(resume.kind==='luoshenJudge'){
    finishLuoshenJudge(g, resume.seat, finalCard);
    return;
  }
  if(resume.kind==='shuangxiongJudge'){
    finishShuangxiongJudge(g, resume.seat, finalCard);
    return;
  }
  // 蔡文姬【悲歌】判定阶段:doBeigeJudge 调用 maybeGuicai 时传的 resume 是
  // {kind:'beigeJudge', sourceSeat, damagedSeat, damageSource}——鬼才改判后用最终判定牌
  // (finalCard)代替原判定牌,重新调用悲歌自己的结算函数,不能漏掉这一支落到下面的
  // bagua 兜底(那会把悲歌的判定结果错误地当成八卦阵的红黑判定处理)。
  if(resume.kind==='beigeJudge'){
    processBeigeJudgeResult(g, finalCard, resume.sourceSeat, resume.damagedSeat, resume.damageSource);
    return;
  }
  // 许褚【裸衣】摸牌阶段询问:seat 应是当前回合玩家且存活。
  if(g.pending && g.pending.type==='luoyiAsk'){
    const d=g.pending;
    if(typeof d.seat!=='number' || d.seat!==g.turn || !g.players[d.seat] || !g.players[d.seat].alive){
      g.pending=null; g.phase='draw';
    }
  }
  if(resume.kind==='ganglieJudge'){
    finishGanglieJudge(g, finalCard, resume.seat, resume.sourceSeat, resume.resume);
    return;
  }
  // 张角【雷击】判定:此前完全没有这个分支,会落到下面给其它 kind 兜底用的通用
  // finishBaguaColor 处理(把雷击判定错误地当成八卦阵判定),且 resume.type 对雷击而言
  // 恒为 undefined、两个 if/else if 分支都不成立,雷击链路(尤其从南蛮/万箭响应里触发、
  // g.leijiResume 记着续接队列信息的场景)会被静默卡死。和 finishGuidu 的 leijiJudge
  // 分支(处理鬼道改判雷击判定的同一场景)完全对齐——写法逐字照抄那一处,统一走
  // finishLeijiChain 收尾,不落到下面的通用兜底。这是在实现 guicai(鬼才)AI接入、为了
  // 覆盖"雷击判定被鬼才改判"这个场景做端到端测试时发现的既有 bug,和这批 AI 接入本身
  // 无关,顺手一并修好(finishGuidu 那边已经修过,这里只是把 finishGuicai 补齐到同等
  // 完整深度)。
  if(resume.kind==='leijiJudge'){
    const { sourceSeat, targetSeat } = resume;
    const target=g.players[targetSeat];
    if(finalCard.suit==='♠'){
      const dying=dealDamage(g, targetSeat, 2, sourceSeat, g.players[sourceSeat].name+' 的【雷击】效果', 'leiji');
      g.log=pushLog(g.log, target.name+' 被替换判定为'+finalCard.suit+rankText(finalCard.rank)+',受到2点雷电伤害');
      if(dying) return;
    } else {
      g.log=pushLog(g.log, target.name+' 被替换判定为'+finalCard.suit+rankText(finalCard.rank)+',【雷击】无效');
    }
    finishLeijiChain(g);
    return;
  }
  // kind==='bagua'
  const red = finishBaguaColor(g, judgedSeat, finalCard);
  if(resume.type==='sha'){
    // 鬼才把这次判定改成红色,视为出闪——和 tryBagua 直接判红同一收尾(方天画戟排队目标需要
    // 继续;杀被闪抵消后的效果调度:猛进/青龙偃月刀/贯石斧
    if(red){
      if(!maybeStartShaOffsetEffects(g, resume.from, resume.to, resume.sourceCard, !!(resume.shaInfo && resume.shaInfo.jiuBonus))) finishSingleShaTarget(g);
    }
    else {
      g.pending=setResponseAskedAt({from:resume.from, to:resume.to});
      if(resume.sourceCard!==undefined) g.pending.sourceCard=resume.sourceCard;
      if(resume.shaInfo && resume.shaInfo.jiuBonus) g.pending.jiuBonus=true;
      g.phase='respond';
    }
  } else if(resume.type==='aoe'){
    if(red){
      g.log=pushLog(g.log, g.players[resume.target].name+' 以【八卦阵】抵消【'+g.aoe.trick+'】');
      aoeAdvance(g, resume.target);
    } else {
      g.pending=setResponseAskedAt({type:'aoeResp', from:g.aoe.from, to:resume.target, need:g.aoe.need});
      if(g.aoe.sourceCard!==undefined) g.pending.sourceCard=g.aoe.sourceCard;
      g.phase='aoeResp';
      g.log=pushLog(g.log, '要求 '+g.players[resume.target].name+' 打出【'+g.aoe.need+'】');
    }
  }
}

// ===== 杀被抵消后的效果调度系统 =====
// mengjinDiscardCount: 目标可弃牌数量(手牌+装备,不含判定区)
function mengjinDiscardCount(p){ 
  return (p.hand||[]).length + EQUIP_SLOTS.filter(s=>p.equips&&p.equips[s]).length; 
}

// maybeStartShaOffsetEffects: 检查杀被抵消后是否有可触发的效果(猛进/青龙/贯石斧)
// 返回 true 表示已开 pending/直接处理,调用方应立即 return; false 表示无效果,继续原有流程


// startShaOffsetEffect: 启动单个效果


// continueShaOffsetEffects: 一个效果处理完后继续处理剩余效果


// mengjinPick: 处理猛进的牌选择
function mengjinPick(choice) {
  tx(g=>{
    if(g.phase!=='mengjin'||!g.pending||g.pending.type!=='mengjin'||g.pending.from!==mySeat) return g;
    
    const {from, to, available, sourceCard, jiuBonus} = g.pending;
    const attacker = g.players[from];
    const target = g.players[to];

    if(!attacker || !attacker.alive || !target || !target.alive) {
      g.pending = null;
      finishSingleShaTarget(g);
      return g;
    }

    if(!available.includes(choice)) return g;

    const info = {trick:'猛进', from, to};
    // 同 auto-single:快照 pending,弃装备触发凌统 onLoseEquip → 旋风挂起就 attach resume 并 return,
    // 不能往下 g.pending=null 把旋风覆盖掉(applyTrickOnHand 弃手牌不触发,快照对它无变化)。
    // 【v2】同 auto-single 分支,resume 类型改成 {type:'shaOffset',...},见上方注释说明。
    const pendingBefore = g.pending;
    const discardedEquipName = choice === 'hand' ? null : target.equips[choice]?.name;
    if(choice === 'hand') {
      applyTrickOnHand(g, info);
    } else {
      applyTrickOnEquip(g, info, choice);
    }

    g.log = pushLog(g.log, attacker.name+' 发动【猛进】,弃置了 '+target.name+' '+ (choice==='hand'?'一张手牌':'的装备【'+(discardedEquipName||choice)+'】'));
    markSkillSound(g, '猛进');

    if(g.pending !== pendingBefore && g.pending){ g.pending.resume = {type:'shaOffset', from, to, sourceCard, jiuBonus}; return g; } // 旋风挂起,保留
    g.pending = null;

    // 处理完猛进后,检查是否还有其他效果需要处理
    const remainingAvailable = ['qinglong', 'guanshifu'].filter(id => {
      if(id === 'qinglong') return canStartQinglong(g, from);
      if(id === 'guanshifu') return canStartGuanshifu(g, from);
      return false;
    });

    if(remainingAvailable.length > 0) {
      continueShaOffsetEffects(g, from, to, sourceCard, remainingAvailable, jiuBonus);
    } else {
      finishSingleShaTarget(g);
    }
    
    return g;
  });
}

// respondMengjin: 在shaOffsetChoice阶段选择猛进后的处理
function respondMengjin() {
  tx(g=>{
    if(g.phase!=='shaOffsetChoice'||!g.pending||g.pending.type!=='shaOffsetChoice'||g.pending.from!==mySeat) return g;
    
    const {from, to, available, sourceCard, jiuBonus} = g.pending;

    // 从shaOffsetChoice切换到mengjin
    g.pending = null;
    startShaOffsetEffect(g, from, to, 'mengjin', sourceCard, jiuBonus);
    return g;
  });
}


// ---------- actions (all via transaction on the whole game) ----------
// stripUndefined: 深度剔除对象/数组里所有值为 undefined 的属性——Firebase 的 transaction 规则是
// "返回值里任何字段显式为 undefined 就整个拒绝写入"(不是软失败,是直接不提交,抛
// "Data returned contains undefined in property ..." 错误)。这类 bug 极隐蔽:很多 pending 构造
// 习惯"多传一个透传字段,其它场景不传就是 undefined"(如 startTrick 的 card/seatB/pool——见那里的
// 具体修复),本地跑/自测环境不会报错,只有真连 Firebase 才会在提交那一刻被拒绝。这里在 tx() 出口
// 做一层统一兜底,即使以后又有类似疏漏也不会真正写坏/被拒绝——但这只是兜底,不是纵容随手传
// `x: 可能是 undefined 的变量` 的理由,新增"透传字段"时仍然优先用条件展开、只在有值时才放进对象。
function stripUndefined(obj){
  if(Array.isArray(obj)){
    obj.forEach(v=>{ if(v && typeof v==='object') stripUndefined(v); });
    return obj;
  }
  if(obj && typeof obj==='object'){
    Object.keys(obj).forEach(k=>{
      if(obj[k]===undefined) delete obj[k];
      else if(obj[k] && typeof obj[k]==='object') stripUndefined(obj[k]);
    });
  }
  return obj;
}
// pruneExchangeCards: "上一条结算链是否已经彻底结束、该不该在这次新动作开始前清空"——这是
// 状态转换性质的判断(该不该把陈旧的一批牌从数据里抹掉,给即将开始的这次新动作腾出空位),
// 和 normalize 里那条 targets 字段的"数据形状防御"是两类不同性质的事,刻意不放进 normalize
// 内部、只在 tx() 的写入路径调用一次,不在 render() 的读取路径调用。
//
// 这是一个真实踩过的坑:最初这条清空规则也写在 normalize 里,render() 每次都会调用
// normalize(g)——而 render() 几乎在每一次 tx() 提交后都会被 Firebase 的 value 监听器立刻
// 触发一次,传入的正是刚提交的这份"链已结束"的最终状态。如果清空规则也在这条 render 路径的
// normalize 里跑,它会在 renderTableCard 真正有机会显示"这批牌"之前,就先把数组在客户端内存
// 里清空——renderTableCard 拿到的永远是已经被清空的空数组,链结束那一刻的整批淡出动画根本
// 没有机会播放,直接从"链进行中的静态展示"跳到"什么都没有",和最初设计的"链结束后先完整
// 展示一轮再统一淡出"完全相悖。Playwright 端到端测试第一次跑就复现了这个问题(exchangeCards
// 在链结束的同一次渲染里就已经是空的,`show`/`exchange-mode` 两个 class 都不带、innerHTML
// 也是空的),才发现"normalize 在读写两条路径都跑"这条既有约定,对"数据形状防御"这类事情
// 完全正确、必须两条路径都跑,但对"某个状态转换该不该发生"这类事情是错的——转换只应该发生
// 一次,伴随着某次真正的写入(下一次真实的游戏动作),不应该在纯粹的读取/重新渲染时被
// 提前触发。判定条件本身(!g.pending && !g.aoe)和之前设计的一样没有变,只是调用位置从
// normalize 内部搬到这里、只在 tx() 里跑这一处改变了。
function pruneExchangeCards(g){
  if(Array.isArray(g.exchangeCards) && g.exchangeCards.length>0 && !g.pending && !g.aoe){
    g.exchangeCards=[];
  }
}
// ============ CORE-77(issue #122)第一期:对局确定性重放 —— 记录基础设施 ============
// 【本期范围,严格限定】只做"开局记录seed + 动作命令采集"这一件事,不改变任何随机结果、
// 不引入播种PRNG、不做重放器——那些是issue明确划分的第二/三期。这里新增的两样东西
// (g.seed / commandLog)本期都只是"被记录"，完全没有任何代码去"读"它们做决策，因此
// 不可能改变现有任何游戏结果，这是"行为零变化"这个声明能够成立的根本原因：不是承诺
// "改了但保证等价"，而是压根没有新代码路径会影响已有的判定/随机结果。
//
// 【seed】generateSeed() 生成一个无符号32位整数，写入 g.seed（finishGeneralAssign 调用,
// 见 room-lifecycle.js）。这个值目前只是"记录留痕"——没有任何随机调用点从它派生随机数
// （那是第二期"随机数种子化"要做的事：把 Math.random() 替换成以 g.seed 播种的 Mulberry32）。
// 多消耗一次 Math.random() 调用本身不影响后续任何游戏内随机结果——V8 的 Math.random() 各次
// 调用相互独立，不是"从同一个有限序列里按顺序取值"，所以这里多调一次不会让后面的
// shuffleSeats/buildDeck 等随机结果发生偏移。
// 【为什么不用 Math.random()】本期只是"记录"这个数值,还没有任何代码用它驱动游戏内的
// 随机结果(那是第二期"随机数种子化"的工作)——但如果这里消耗一次 Math.random(),会把
// 开局之后全部既有随机调用点(shuffleSeats/buildDeck等)在真实、未播种的 Math.random()
// 流水线里整体错位一位:严格来说就不再是"行为零变化"了——即使规则逻辑没变,给定同一串
// 真实操作,谁摸到哪张牌会和没有这次改动时不同。改用 Date.now() + 单调自增计数器
// 异或组合,完全不触碰 Math.random(),保证这次改动前后,同一串操作产出的后续全部随机
// 结果逐位一致——这一点已用 run_core77_replay_infra_test.js 的"零行为变化"回归实测验证。
let seedEntropyCounter = 0;
function generateSeed(){
  seedEntropyCounter = (seedEntropyCounter + 1) >>> 0;
  return (Date.now() ^ Math.imul(seedEntropyCounter, 0x9E3779B1)) >>> 0; // 无符号32位整数
}
// 【命令日志】commandLog 是纯客户端本地内存数组，刻意不挂在 g 上——不写 Firebase(和
// aiDecisionRecords/aiSuspicionEvents 同一类"本地诊断/记录数据不进共享状态"的既有写法)。
// 记录粒度：每次 tx(fn) 调用对应一条记录，字段是"谁、何时、在什么阶段/pending类型下、
// 由哪个函数发起"——commandName 用调用栈自动捕获直接调用者的函数名，不需要在全项目
// 上百个 tx() 调用点逐一手工传参数(那样改动面会大得多，而且这个项目从不做代码压缩/
// 混淆，函数名在生产环境下同样保留，栈解析不会因构建流程失真)。
// 【已知的、本期刻意不解决的局限】commandName 只是"哪个函数发起了这次tx"，不含具体
// 参数（比如 playCard 具体打了第几张牌、指定了哪个目标）——真正做到"seed+命令序列可
// 精确重演"需要参数级别的命令记录，这是第二期"重放器"要解决的问题，需要另外设计怎样
// 以最小改动面拿到参数（比如统一的动作分发入口，或者干脆逐点位手工传参）。这里如实
// 记录这个限制，不假装本期已经做到"可重放"。
let commandLog = [];
let commandLogSeq = 0;
const COMMAND_LOG_MAX = 500; // 和 aiSuspicionEvents(上限20)/recentLog(上限15)同一类
// 用途做法：无限增长的本地诊断数组会拖慢长局，早期项目里已经有多处这个上限惯例。
// captureCommandName:从调用栈解析"是谁调的 tx()"，纯尽力而为，任何解析失败都返回 null、
// 绝不抛异常影响主流程(和项目里"诊断类代码用 try/catch 包裹、失败静默"的既有纪律一致)。
function captureCommandName(){
  try{
    const stack = new Error().stack;
    if(typeof stack!=='string') return null;
    const lines = stack.split('\n');
    // lines[0] 是 "Error"；lines[1] 是 captureCommandName 自己那一帧；lines[2] 是 tx()
    // 那一帧；lines[3] 才是真正调用 tx() 的那个函数(playCard/respondShan等)。
    const callerLine = lines[3];
    if(!callerLine) return null;
    const m = /at\s+([A-Za-z0-9_$.]+)/.exec(callerLine);
    return m ? m[1] : null;
  }catch(e){ return null; }
}
function tx(fn, onCommitted){
  // 机器人控制端会暂时把 mySeat 切到机器人座位再调用现有动作函数。Firebase 事务可能
  // 因并发而重试，所以必须在创建事务时冻结行动座位。
  const actingSeat=mySeat;
  // CORE-77 第一期:在真正调用 gameRef.transaction 之前捕获调用者名字并立即入队——
  // 入队顺序因此和 tx() 被调用的顺序一致(不是"提交成功"的顺序,Firebase 事务在冲突时
  // 会重试,但本项目单房间几乎不存在真正并发写冲突,先按调用序入队足够)。entry 对象
  // 引用直接传进下面的 updater 闭包，重试时对同一个 entry 就地覆写 phase/pending 字段
  // 而不是重复 push——避免"重试几次就多出几条重复日志"。纯本地内存操作，不影响
  // 任何既有的 g 读写/返回值/normalize/stripUndefined 逻辑，插入点在这些逻辑之前。
  const commandEntry = {
    seq: ++commandLogSeq, ts: Date.now(), actingSeat,
    commandName: captureCommandName(),
    phaseAtStart: null, pendingTypeAtStart: null
  };
  commandLog.push(commandEntry);
  if(commandLog.length > COMMAND_LOG_MAX) commandLog.shift();
  const p = gameRef.transaction(g => {
    if(!g) return g;
    const visibleSeat=mySeat;
    mySeat=actingSeat;
    try{
      normalize(g);
      pruneExchangeCards(g);
      const pendingAtStart=g.pending;
      const responderAtStart=pendingResponderSeat(g,pendingAtStart);
      commandEntry.phaseAtStart = g.phase || null;
      commandEntry.pendingTypeAtStart = (pendingAtStart && pendingAtStart.type) || null;
      const result = fn(g) || g;
      // 连营队列:本 tx 内 effect/杀结算可能覆盖 pending;收尾再尝试挂起询问
      tryFlushLianying(result);
      // 当前被询问者仍在同一个 pending 中操作，说明玩家活跃，重置等待时间；其他玩家的 tx
      // 不得延长倒计时。新创建的 pending 则不依赖 type 登记，只要能解析响应者就自动打戳。
      if(result.pending===pendingAtStart && Number.isInteger(actingSeat) && actingSeat===responderAtStart){
        setResponseAskedAt(result.pending);
      }else if(result.pending && typeof result.pending.askedAt!=='number' &&
               isTimedResponsePending(result,result.pending)){
        setResponseAskedAt(result.pending);
      }
      return stripUndefined(result);
    } finally {
      mySeat=visibleSeat;
    }
  });
  // 【强C新增】可选提交回调:Firebase transaction 返回 Promise(真实 SDK 行为),
  // resolve 后把提交成功的快照 g 交给 onCommitted(供机器人拿新状态继续同窗循环)。
  // 不传 onCommitted 时行为与改动前逐字一致(fire-and-forget,返回值被忽略);
  // vm stub 若不返回 thenable 则回调分支不触发,同样零影响。
  if(typeof onCommitted === 'function' && p && typeof p.then === 'function'){
    p.then(function(res){
      const snap = res && res.snapshot && typeof res.snapshot.val === 'function' ? res.snapshot.val() : null;
      onCommitted(snap);
    }, function(){ onCommitted(null); });
  }
  return p;
}

function doDraw(){
  tx(g=>{
    if(g.phase!=='draw'||g.turn!==mySeat) return g;
    if(hasSkillName(g.players[mySeat],'英姿')) markSkillSound(g,'英姿');
    finishDrawPhase(g, mySeat, drawPhaseCount(g, mySeat));
    return g;
  });
}
function respondLiRang(activate, cardIdxs){
  tx(g=>{
    if(g.phase!=='lirangAsk'||!g.pending||g.pending.type!=='lirangAsk'||g.pending.from!==mySeat) return g;
    const from=g.pending.from, to=g.pending.to;
    const me=g.players[from], target=g.players[to];
    if(!me || !me.alive || !target || !target.alive || !hasCap(me,'lirang')) return g;
    if(!activate){
      g.log=pushLog(g.log, me.name+'：不发动【礼让】');
      g.pending=null;
      continueEnterDrawPhase(g);
      return g;
    }
    if(g.liRangRound===g.roundNum) return g;
    if(!Array.isArray(cardIdxs) || cardIdxs.length!==2) return g;
    const idxs=[...new Set(cardIdxs)].filter(i=>Number.isInteger(i)).sort((a,b)=>b-a);
    if(idxs.length!==2 || idxs.some(i=>i<0 || i>=(me.hand||[]).length)) return g;
    const moved=removeHandCards(g, mySeat, idxs).reverse();
    target.hand.push(...moved);
    g.liRangRound=g.roundNum;
    g.liRangRecord={round:g.roundNum, from, to, discarded:[]};
    g.pending=null;
    g.log=pushLog(g.log, me.name+' 发动【礼让】,交给 '+target.name+' 两张牌');
    markSkillSound(g, '礼让');
    continueEnterDrawPhase(g);
    return g;
  });
}
function respondLuoyi(activate){
  tx(g=>{
    if(g.phase!=='luoyiAsk'||!g.pending||g.pending.type!=='luoyiAsk'||g.pending.seat!==mySeat) return g;
    const me=g.players[mySeat];
    g.pending=null;
    const base=drawPhaseCount(g, mySeat);
    const n=activate ? Math.max(0, base-1) : base;
    if(activate){
      g.luoyiActive=true;
      g.log=pushLog(g.log, me.name+' 发动【裸衣】,少摸1张牌,本回合【杀】和【决斗】伤害+1');
      markSkillSound(g, '裸衣');
    } else {
      g.log=pushLog(g.log, me.name+'：不发动【裸衣】');
    }
    finishDrawPhase(g, mySeat, n);
    return g;
  });
}
function finishShuangxiongJudge(g, seat, card){
  const p=g.players[seat];
  g.pending=null;
  if(!p || !p.alive){ g.phase='draw'; return; }
  if(card){
    const idx=g.discard.lastIndexOf(card);
    if(idx>=0) g.discard.splice(idx,1);
    p.hand.push(card);
    p.shuangxiongColor=cardColorForPlayer(p, card);
    const opposite=p.shuangxiongColor==='red'?'黑色':'红色';
    g.log=pushLog(g.log, p.name+' 发动【双雄】,获得判定牌 '+card.suit+rankText(card.rank)+'【'+card.name+'】,本回合可将'+opposite+'手牌当【决斗】使用');
  } else {
    p.shuangxiongColor=null;
    g.log=pushLog(g.log, p.name+' 发动【双雄】,但牌堆没有可判定的牌');
  }
  markSkillSound(g, '双雄');
  advancePastPlay(g);
}
function respondShuangxiong(activate){
  tx(g=>{
    if(g.phase!=='shuangxiongAsk'||!g.pending||g.pending.type!=='shuangxiongAsk'||g.pending.seat!==mySeat) return g;
    const me=g.players[mySeat];
    if(!me || !me.alive || !hasCap(me,'shuangxiong')) return g;
    if(!activate){
      g.pending=null;
      me.shuangxiongColor=null;
      g.log=pushLog(g.log, me.name+'：不发动【双雄】');
      finishDrawPhase(g, mySeat, drawPhaseCount(g, mySeat));
      return g;
    }
    const card=judge(g);
    if(!card){ finishShuangxiongJudge(g, mySeat, null); return g; }
    if(maybeGuicai(g, mySeat, card, {kind:'shuangxiongJudge', seat:mySeat})==='pending') return g;
    finishShuangxiongJudge(g, mySeat, card);
    return g;
  });
}
// ===== 统一出牌入口:出牌阶段所有牌共用样板,各牌独特部分在 CARD_PLAYS 表里 =====
// actionId:除"杀"外都等于 card.name;杀固定为 '杀'(赵云的闪也走杀,物理牌名可能是'闪')。
// 每项:canPlay(身份+独特前置校验)、target(是否指定目标,决定走不走统一目标校验)、effect(独特效果+日志)。

// hasTargetCard: 角色是否至少有一张"可被操作的牌"(手牌+装备区+判定区)。顺手牵羊/过河拆桥
// 这类"必须拿走/拆掉一张牌"的锦囊统一用它做目标合法性判断——没有任何牌可拿/可拆的角色不能
// 成为目标。奇袭(甘宁把黑牌当拆桥)与实体过河拆桥走同一口径,避免各自维护一份逻辑分叉。
function hasTargetCard(player){
  return !!player && (
    (player.hand && player.hand.length>0)
    || (player.equips && EQUIP_SLOTS.some(slot=>player.equips[slot]))
    || (player.delays && player.delays.length>0)
  );
}

const CARD_PLAYS = {
  '杀': {
    target:true,
    canPlay:(g,me,card)=> {
      // 曹彰【将驰】选项1:本回合不能使用或打出杀
      if(me.jiangchiNoSlash) return false;
      // 太史慈【天义】:天义输时不能使用杀
      if(g.tianyiLose && hasCap(me,'tianyi')) return false;
      // 太史慈【天义】:天义赢时无视出杀次数限制
      if(g.tianyiWin && hasCap(me,'tianyi')) return canUseAs(me,card,'杀');
      if(!canUseAs(me,card,'杀')) return false;
      if(hasCap(me,'unlimitedSha')) return true; // 无限杀:张飞【咆哮】或诸葛连弩
      if(!g.shaUsed) return true;
      // 曹彰【将驰】选项2:额外出杀次数
      if(g.jiangchiExtraShaLeft > 0 && g.turn === mySeat) return true;
      return false;
    },
    canTarget:(g,me,card,targetSeat)=>{
      const target=g.players[targetSeat];
      const sourceSeat=g.players.indexOf(me);
      if(sourceSeat<0 || !target || !target.alive || targetSeat===sourceSeat) return false;
      // 陈宫【智迟】：检查免疫状态
      // canTarget 的语义已经确定是“作为【杀】使用”，不能再按转化前的实体牌名判断；
      // 否则武圣/龙胆等转化杀会绕过智迟。
      if(isZhichiImmune(g, targetSeat, {name:'杀'})) return false;
      // 诸葛亮【空城】(锁定技):若目标没有手牌,不能成为【杀】的目标——距离校验之外额外叠加的
      // 一层限制,和距离一样都是"canTarget"这个 seam 的用途(见架构约定:只有杀挂了canTarget)。
      if(target && hasCap(target,'kongcheng') && (target.hand||[]).length===0) return false;
      
      // 袁术【同疾】(锁定技):若袁术的手牌数大于体力值,且使用者在袁术的攻击范围内,只能选择袁术为目标
      for(let tongjiSeat=0;tongjiSeat<g.players.length;tongjiSeat++){
        const owner=g.players[tongjiSeat];
        if(!owner || !owner.alive || tongjiSeat===sourceSeat || !hasCap(owner,'tongji')) continue;
        if((owner.hand||[]).length<=owner.hp) continue;
        // 正式条件是“使用者在【同疾】拥有者的攻击范围内”，因此距离/范围从拥有者视角计算；
        // 每个满足条件的拥有者都形成独立限制，不能只取玩家数组里的第一人。
        if(distance(g,tongjiSeat,sourceSeat)<=attackRange(g,tongjiSeat) && targetSeat!==tongjiSeat) return false;
      }
      
      // 太史慈【天义】:天义赢时无距离限制
      if(g.tianyiWin && g.turn===sourceSeat && hasCap(me,'tianyi')) return true;
      // 曹彰【将驰】选项2:本回合使用杀无距离限制(仍过空城等合法性)
      if(me.jiangchiNoDistance && g.turn === sourceSeat) return true;
      // 【神速】等“视为使用一张无距离限制的杀”仍必须走本 canTarget 的智迟、空城、
      // 同疾等目标合法性；只在全部规则检查通过后跳过最后的距离判断。
      if(card && card.ignoreShaDistance) return true;
      return canReachSha(g, sourceSeat, targetSeat); // 只有杀受攻击距离限制
    },
    effect:(g,me,card,targetSeat)=>{
      const usedAs = isShaName(card.name) ? '出【'+card.name+'】' : '出【'+card.name+'】当【杀】';
      const shaWasAlreadyUsed=!!g.shaUsed;
      // 太史慈【天义】:天义赢时不消耗出杀次数（次数上限+1的效果）
      if(!(g.tianyiWin && hasCap(me,'tianyi'))) {
        if(!g.shaUsed){
          g.shaUsed=true; // 本回合出杀次数限制:这里(当前回合玩家在自己出牌阶段出杀)才该计入
        } else if(g.jiangchiExtraShaLeft > 0){
          g.jiangchiExtraShaLeft--;
        }
      }
      if(hasSkillName(me,'咆哮') && shaWasAlreadyUsed && (g.lastPaoxiaoSoundTurn!==g.roundNum)){
        markSkillSound(g,'咆哮');
        g.lastPaoxiaoSoundTurn=g.roundNum;
      }
      triggerJiangOnTarget(g, mySeat, targetSeat, 'sha', isRed(card));
      
      // 丁奉【短兵】:检查是否有短兵技能，并筛选距离为1的额外目标
      if (hasCap(me, 'duanbing') && g.phase === 'play' && g.turn === mySeat) {
        // 筛选距离为1的其他角色（排除自己和当前目标）
        const aliveSeats = [];
        for (let i = 0; i < g.players.length; i++) {
          // 必须同时排除自己和基础目标，避免重复选择
          if (g.players[i] && g.players[i].alive && i !== mySeat && i !== targetSeat) {
            const dist = distance(g, mySeat, i);
            // 额外目标除了距离为1，还必须满足这张杀的全部目标合法性（如空城、同疾）。
            if (dist === 1 && CARD_PLAYS['杀'].canTarget(g, me, card, i)) {
              aliveSeats.push(i);
            }
          }
        }
        
        if (aliveSeats.length > 0) {
          // 存储原始目标和卡牌信息，等待选择额外目标
          g.pending = setResponseAskedAt({
            type: 'duanbingChoose',
            sourceSeat: mySeat,
            baseTarget: targetSeat,
            card: card,
            availableTargets: aliveSeats
          });
          g.phase = 'duanbingChoose';
          g.log = pushLog(g.log, `${me.name} 可以发动【短兵】,多选择一名距离为1的角色为目标`);
          return;
        }
      }
      
      // 正常结算杀
      resolveShaUse(g, me, targetSeat, usedAs, singleCardShaColor(card), card, consumeJiuShaBonus(g, me));
    }
  },
  '桃': {
    target:false,
    canPlay:(g,me,card)=> card.name==='桃' && me.hp<me.maxHp,
    effect:(g,me,card)=>{ 
      me.hp++; 
      g.log=pushLog(g.log, me.name+' 使用【桃】回复1点体力'); 
      const seat = g.players.findIndex(p => p === me);
      if(seat !== -1) removeBuquCard(g, seat);
      // 法正【恩怨】：当其他角色令你回复1点体力后，其摸一张牌
      // 这里me是使用桃的角色，自己给自己回复体力，不触发恩怨
      // 恩怨仅在其他角色令法正回复体力时触发
    }
  },
  '酒': {
    target:false,
    canPlay:(g,me,card)=> card.name==='酒' && !g.jiuUsed,
    effect:(g,me,card)=>{
      me.jiuShaBonus=true;
      g.jiuUsed=true;
      g.log=pushLog(g.log, me.name+' 使用【酒】,本回合下一张【杀】伤害+1');
    }
  },
  '决斗': {
    target:true,
    canPlay:(g,me,card)=> canUseAs(me,card,'决斗'),
    // 诸葛亮【空城】(锁定技):若目标没有手牌,不能成为【决斗】的目标。决斗本身无距离限制,
    // 所以这里不像杀那样叠加 canReachSha,只单独处理这一条限制。
    // 贾诩【帷幕】:不能成为黑色锦囊牌的目标
    canTarget:(g,me,card,targetSeat)=>{
      const target=g.players[targetSeat];
      // 陈宫【智迟】：检查免疫状态
      if(isZhichiImmune(g, targetSeat, card)) return false;
      if(target && hasCap(target,'kongcheng') && (target.hand||[]).length===0) return false;
      // 帷幕检查：如果目标是贾诩且牌是黑色锦囊，不能成为目标
      if(target && hasCap(target,'weimu') && isBlackTactics(card)) return false;
      return true;
    },
    effect:(g,me,card,targetSeat)=>{
      const usedAs = card.name==='决斗' ? '使用【决斗】' : '将【'+card.name+'】当【决斗】使用';
      g.log=pushLog(g.log, me.name+' 对 '+g.players[targetSeat].name+' '+usedAs);
      triggerJiangOnTarget(g, mySeat, targetSeat, 'duel', false);
      // 先开无懈窗口；无人无懈才真正进入 duel 弃杀流程（见 resolveTrick）
      startTrick(g, {trick:'决斗', from:mySeat, to:targetSeat, sourceCard:card});
    }
  },
  '无中生有': {
    target:false,
    canPlay:(g,me,card)=> card.name==='无中生有',
    effect:(g,me,card)=>{
      g.log=pushLog(g.log, me.name+' 使用【无中生有】');
      // 目标是自己(只影响使用者本人):先开无懈窗口,无人无懈(或反制后恢复生效)才真正摸牌(见 resolveTrick)
      startTrick(g, {trick:'无中生有', from:mySeat, to:mySeat});
    }
  },
  '桃园结义': {
    target:false,
    canPlay:(g,me,card)=> card.name==='桃园结义',
    effect:(g,me,card)=>{
      g.log=pushLog(g.log, me.name+' 使用【桃园结义】');
      // 对全场存活角色生效(含自己),无懈抵消的是这次使用的整体效果(全场都不回血),
      // 不是逐个单独无懈——所以和无中生有同一个模板:开一次无懈窗口,to 只是占位
      // (resolveTrick 里真正生效时循环所有存活玩家,不会用 info.to 做单人操作)。
      startTrick(g, {trick:'桃园结义', from:mySeat, to:mySeat});
    }
  },
  // 借刀杀人:两个不同角色的目标(A 要有武器、B 要在 A 攻击范围内),不是标准单目标流程能表达的,
  // 客户端拦下 selectedCardIdx 选中后走专属的"选 A→选 B"两步流程,直接调 jieDaoShaRen 提交,
  // 不经过 playCard/这里的 effect(target:true 只是为了让点牌选中这一步复用现有 UI 高亮)。
  '借刀杀人': {
    target:true,
    canPlay:(g,me,card)=> card.name==='借刀杀人' && g.players.some((A,ai)=>
      A && A.alive && ai!==mySeat && A.equips && A.equips.weapon &&
      g.players.some((B,bi)=> B && B.alive && bi!==ai && canReachSha(g,ai,bi))
    ),
    canTarget:(g,me,card,targetSeat)=>{
      // 借刀杀人特殊：第一个目标是A（有武器的角色），所以这里的canTarget需要特别处理
      // 但是借刀杀人走的是专门的流程jieDaoShaRen，不是标准的目标选择流程
      // 所以这个canTarget可能不会被调用，但为了安全起见还是添加帷幕检查
      const target = g.players[targetSeat];
      if(!target || !target.alive) return false;
      // 陈宫【智迟】：检查免疫状态
      if(isZhichiImmune(g, targetSeat, card)) return false;
      // 贾诩【帷幕】:不能成为黑色锦囊牌的目标
      if(target && hasCap(target,'weimu') && isBlackTactics(card)) return false;
      return true;
    },
    effect:()=>{} // 正常流程不会走到这里(见上方注释);留空防御,避免万一被绕过时报错
  },
  '五谷丰登': {
    target:false,
    canPlay:(g,me,card)=> card.name==='五谷丰登',
    effect:(g,me,card)=>{
      const pool = revealPool(g, aliveCount(g));
      g.log=pushLog(g.log, me.name+' 使用【五谷丰登】,亮出'+pool.length+'张牌');
      // 目标是自己(占位,和无中生有/桃园结义同一模板):无懈抵消的是整体效果(亮出的牌全部作废进弃牌堆)
      startTrick(g, {trick:'五谷丰登', from:mySeat, to:mySeat, pool, sourceCard:card});
    }
  },
  '火攻': {
    target:true,
    allowSelf:true, // 火攻可对自己使用(需目标有手牌可展示,见 canTarget)
    canPlay:(g,me,card)=> card.name==='火攻',
    canTarget:(g,me,card,targetSeat)=>{
      const sourceSeat=g.players.indexOf(me);
      const target=g.players[targetSeat];
      if(!target || !target.alive) return false;
      let handCount=(target.hand||[]).length;
      // 自用(目标=使用者)时,正在使用的这张实体火攻还在手牌里——playCard 是先 canTarget
      // 后 splice,不能让它自己被数进去,否则"只剩这一张火攻"会被误判为有手牌可展示。
      // 蛊惑等转化路径的实际牌早已离手,claimedCard 与手牌对象引用不同,此过滤自然不生效。
      if(targetSeat===sourceSeat && card && Array.isArray(target.hand)){
        handCount=target.hand.filter(c=>c!==card).length;
      }
      if(handCount===0) return false;
      // 陈宫【智迟】：检查免疫状态
      if(isZhichiImmune(g, targetSeat, card)) return false;
      // 贾诩【帷幕】:不能成为黑色锦囊牌的目标
      if(target && hasCap(target,'weimu') && isBlackTactics(card)) return false;
      return true;
    },
    effect:(g,me,card,targetSeat)=>{
      g.log=pushLog(g.log, me.name+' 对 '+g.players[targetSeat].name+' 使用【火攻】');
      startTrick(g, {trick:'火攻', from:mySeat, to:targetSeat, sourceCard:card});
    }
  },
  '铁索连环': {
    target:true,
    allowSelf:true,
    canPlay:(g,me,card)=> card.name==='铁索连环',
    canTarget:(g,me,card,targetSeat)=>{
      const target = g.players[targetSeat];
      if(!target || !target.alive) return false;
      // 陈宫【智迟】：检查免疫状态
      if(isZhichiImmune(g, targetSeat, card)) return false;
      // 贾诩【帷幕】:不能成为黑色锦囊牌的目标
      if(target && hasCap(target,'weimu') && isBlackTactics(card)) return false;
      return true;
    },
    effect:(g,me,card,targetSeat)=>{
      const targets=(Array.isArray(targetSeat)?targetSeat:[targetSeat])
        .filter((seat, idx, arr)=>Number.isInteger(seat) && arr.indexOf(seat)===idx)
        .slice(0,2)
        .filter(seat=>g.players[seat] && g.players[seat].alive);
      if(targets.length===0) return;
      startTieSuoTargets(g, mySeat, targets);
    }
  },
  '顺手牵羊': {
    target:true,
    canPlay:(g,me,card)=> card.name==='顺手牵羊',
    canTarget:(g,me,card,targetSeat)=> {
      const target = g.players[targetSeat];
      if(!target || !target.alive) return false;
      // 顺手牵羊要拿走目标一张牌:没有任何可操作的牌(手牌/装备/判定区)的角色不能成为目标
      if(!hasTargetCard(target)) return false;
      if(distance(g, mySeat, targetSeat) > 1) return false;
      // 陈宫【智迟】：检查免疫状态
      if(isZhichiImmune(g, targetSeat, card)) return false;
      // 陆逊【谦逊】:不能成为顺手牵羊的目标
      if(hasCap(target,'qianxun')) return false;
      // 贾诩【帷幕】:不能成为黑色锦囊牌的目标
      if(target && hasCap(target,'weimu') && isBlackTactics(card)) return false;
      return true;
    },
    effect:(g,me,card,targetSeat)=>{
      g.log=pushLog(g.log, me.name+' 对 '+g.players[targetSeat].name+' 使用【顺手牵羊】');
      startTrick(g, {trick:'顺手牵羊', from:mySeat, to:targetSeat});
    }
  },
  '过河拆桥': {
    target:true,
    canPlay:(g,me,card)=> card.name==='过河拆桥',
    canTarget:(g,me,card,targetSeat)=>{
      const target = g.players[targetSeat];
      if(!target || !target.alive) return false;
      // 过河拆桥要拆目标一张牌:没有任何可操作的牌(手牌/装备/判定区)的角色不能成为目标
      if(!hasTargetCard(target)) return false;
      // 陈宫【智迟】：检查免疫状态
      if(isZhichiImmune(g, targetSeat, card)) return false;
      // 贾诩【帷幕】:不能成为黑色锦囊牌的目标
      if(target && hasCap(target,'weimu') && isBlackTactics(card)) return false;
      return true;
    },
    effect:(g,me,card,targetSeat)=>{
      g.log=pushLog(g.log, me.name+' 对 '+g.players[targetSeat].name+' 使用【过河拆桥】');
      startTrick(g, {trick:'过河拆桥', from:mySeat, to:targetSeat});
    }
  },
  '南蛮入侵': { target:false, canPlay:(g,me,card)=> card.name==='南蛮入侵', effect:(g,me,card)=> aoeEffect(g,me,card) },
  '万箭齐发': { target:false, canPlay:(g,me,card)=> card.name==='万箭齐发', effect:(g,me,card)=> aoeEffect(g,me,card) },
};
// 装备牌:所有装备共用同一个 spec。noDiscard=true → playCard 不把它塞进弃牌堆,改由 effect 放进装备区。
// 加新装备只需往 EQUIPS 加一项,下面的循环会自动挂进 CARD_PLAYS(actionId=牌名)。
const equipPlay = {
  target:false,
  noDiscard:true,
  canPlay:(g,me,card)=> !!getEquip(card.name),
  effect:(g,me,card)=> equipCard(g,me,card)
};
Object.keys(EQUIPS).forEach(name=>{ CARD_PLAYS[name] = equipPlay; });
// 延时锦囊:所有延时锦囊共用同一个 spec。noDiscard=true → 不立即进弃牌堆,效果是"放进目标判定区"
// (真正放置动作在 startTrick 打开的无懈窗口问完之后,见 resolveTrick 的 DELAY_TRICKS 分支)。
// allowSelf=true:playCard 默认拒绝自选目标,闪电这类"只能选自己"的延时锦囊需要放行这条限制。
// 加新延时锦囊只需往 DELAY_TRICKS 加一项,下面的循环自动挂进 CARD_PLAYS(actionId=牌名)。
function canTargetDelayTrick(g, me, card, targetSeat, bingliangMaxDistance){
    const spec=DELAY_TRICKS[card.name];
    if(!spec) return false;
    const fromSeat=g.players.indexOf(me);
    if(spec.onlySelf){ if(targetSeat!==fromSeat) return false; }
    else { if(targetSeat===fromSeat) return false; }
    if(card.name==='兵粮寸断' && distance(g, fromSeat, targetSeat) > (bingliangMaxDistance || 1)) return false;
    // 陆逊【谦逊】:不能成为乐不思蜀的目标
    if(card.name==='乐不思蜀' && hasCap(g.players[targetSeat],'qianxun')) return false;
    // 贾诩【帷幕】:不能成为黑色锦囊牌的目标
    if(hasCap(g.players[targetSeat],'weimu') && isBlackTactics(card)) return false;
    const tgt=g.players[targetSeat];
    if(!tgt) return false;
    return !(tgt.delays||[]).some(c=>c && c.name===card.name);
}
const delayTrickPlay = {
  target:true,
  noDiscard:true,
  allowSelf:true,
  canPlay:(g,me,card)=> !!DELAY_TRICKS[card.name],
  canTarget:(g,me,card,targetSeat)=>canTargetDelayTrick(g,me,card,targetSeat,1),
  effect:(g,me,card,targetSeat)=>{
    g.log=pushLog(g.log, me.name+' 对 '+g.players[targetSeat].name+' 使用【'+card.name+'】');
    // 打出时的无懈窗口:和决斗/顺手/拆桥同一套 startTrick,card 透传进 pending,
    // 供 finishWuxieRound(被无懈挡下→进弃牌堆)/resolveTrick(未被挡下→放进判定区)使用。
    startTrick(g, {trick:card.name, from:mySeat, to:targetSeat, card});
  }
};
Object.keys(DELAY_TRICKS).forEach(name=>{ CARD_PLAYS[name] = delayTrickPlay; });
// equipCard: 把已出手(被 playCard 从手牌 splice 出、且未进弃牌堆)的装备牌放进对应槽;同槽旧装备进弃牌堆。
function equipCard(g, me, card){
  const slot = getEquip(card.name).slot;
  const old = me.equips[slot];
  if(old) g.discard.push(old);   // 旧装备进弃牌堆
  me.equips[slot] = card;        // 新装备入槽(装备牌本身不进弃牌堆)
  const slotName = { weapon:'武器', armor:'防具', plus1:'+1马', minus1:'-1马' }[slot];
  g.log=pushLog(g.log, me.name+' 装备了【'+card.name+'】'+(old?'，替换下【'+old.name+'】':'')+'（'+slotName+'）');
  // 同槽换装 = 换下的旧装备离开装备区 → 触发失去装备钩子(如孙尚香【枭姬】)。恒失去 1 张。
  if(old) triggerHook(g, g.players.indexOf(me), 'onLoseEquip', { count:1 });
}
// ===== 距离机制(装备第2步):马的 dist、武器的 range 均从 EQUIPS 读,不硬编码 =====
// 读某槽装备的距离修正(的卢 plus1:+1、赤兔 minus1:-1);无装备/无 dist 返回 0。
function equipDist(player, slot){
  const c = player && player.equips && player.equips[slot];
  const info = c && getEquip(c.name);
  return (info && typeof info.dist==='number') ? info.dist : 0;
}
// distance: from 到 to 的实际距离。环形最近间隔只在"存活玩家"上数(阵亡者不占座位),
// 再叠加 目标的 +1马 与 from 的 -1马,最小为 1。
// from 方向的 -1 修正有两个独立来源、直接相加:装备的 -1 马(equipDist)+ 马超【马术】
// 这类"锁定技距离-1"的 cap(extraMinus1)——两者不互斥,同时存在时效果叠加。
// 公孙瓒【义从】:体力>2时自己计算距离-1;体力<=2时其他角色计算与他的距离+1
function distance(g, from, to){
  if(from===to) return 0;
  const alive = g.players.map((p,i)=>i).filter(i=>g.players[i] && g.players[i].alive);
  const m = alive.length;
  const pf = alive.indexOf(from), pt = alive.indexOf(to);
  if(pf<0 || pt<0 || m<2) return 1;                       // 兜底(出杀时双方必存活)
  const cw = (((pt-pf)%m)+m)%m;                            // 顺时针步数(只数存活者)
  const base = Math.min(cw, m-cw);                         // 顺/逆取较小
  const fromMinus1 = equipDist(g.players[from],'minus1') + (hasCap(g.players[from],'extraMinus1') ? -1 : 0);
  // 义从:公孙瓒体力>2时,自己计算与其他角色的距离-1
  const yicongFromModifier = (hasCap(g.players[from],'yicong') && 
                              g.players[from] && g.players[from].alive && 
                              (g.players[from].hp > 2)) ? -1 : 0;
  // 义从:公孙瓒体力<=2时,其他角色计算与他的距离+1
  const yicongToModifier = (hasCap(g.players[to],'yicong') && 
                            g.players[to] && g.players[to].alive && 
                            (g.players[to].hp <= 2)) ? 1 : 0;
  
  // 丁奉【奋迅】:使用玩家专属状态
  // 奋迅效果：当前是丁奉回合，且目标是对的
  const pFrom = g.players[from];
  const pTo = g.players[to];
  if (g.turn === from && pFrom && pFrom.alive && pFrom.fenxunTarget === to && hasCap(pFrom, 'fenxun')) {
    return 1;
  }
  
  // 奋迅效果：其他角色计算与丁奉的距离（互相视为1）
  if (g.turn === to && pTo && pTo.alive && pTo.fenxunTarget === from && hasCap(pTo, 'fenxun')) {
    return 1;
  }
  
  const d = base + equipDist(g.players[to],'plus1') + fromMinus1 + yicongFromModifier + yicongToModifier;
  return Math.max(1, d);
}
function distanceWithoutCharacterModifiers(g, from, to){
  if(from===to) return 0;
  const alive=g.players.map((p,i)=>i).filter(i=>g.players[i]&&g.players[i].alive);
  const pf=alive.indexOf(from), pt=alive.indexOf(to);
  if(pf<0||pt<0||alive.length<2) return 1;
  const cw=(((pt-pf)%alive.length)+alive.length)%alive.length;
  return Math.max(1,Math.min(cw,alive.length-cw)+equipDist(g.players[to],'plus1')+equipDist(g.players[from],'minus1'));
}
// attackRange: 该玩家攻击距离 = 武器 range,无武器默认 1。
function attackRange(g, seat){
  const p = g.players[seat];
  const w = p && p.equips && p.equips.weapon;
  const info = w && getEquip(w.name);
  return (info && typeof info.range==='number') ? info.range : 1;
}
// canReachSha: 我(mySeat)能否对 targetSeat 出杀 = 距离 <= 攻击距离。UI 与校验共用,避免口径分叉。

// 多个【祸首】同时触发时，按当前回合角色开始的行动顺序依次执行来源替换；后执行者覆盖前者，
// 因而最终来源是该顺序中的最后一名合法拥有者。结果在南蛮指定目标时固定，不随数组扫描或
// 结算中途状态变化而重新选择；若该来源随后死亡，依正式规则后续伤害变为无来源。
function nanmanHuoshouSource(g, fromSeat){
  const n=g.players.length;
  const start=Number.isInteger(g.turn) ? g.turn : fromSeat;
  let result=null;
  for(let k=0;k<n;k++){
    const seat=(start+k)%n;
    const p=g.players[seat];
    if(seat!==fromSeat && p&&p.alive&&hasCap(p,'huoshou')) result=seat;
  }
  return result;
}
// 群体锦囊效果:无目标,启动逐目标结算流程(南蛮要杀、万箭要闪)。
function aoeEffect(g, me, card){
  const need = (card.name==='南蛮入侵')?'杀':'闪';
  g.aoe={trick:card.name, from:mySeat, need, sourceCard:card};
  if(card.name==='南蛮入侵'){
    const huoshouSourceSeat=nanmanHuoshouSource(g,mySeat);
    if(huoshouSourceSeat!==null){
      g.aoe.huoshouSourceSeat=huoshouSourceSeat;
      g.log=pushLog(g.log,g.players[huoshouSourceSeat].name+'【祸首】成为本次【南蛮入侵】的伤害来源');
      markSkillSound(g,'祸首');
    }
  }
  g.log=pushLog(g.log, me.name+' 使用【'+card.name+'】');
  aoeAdvance(g, mySeat); // 从下家起结算第一个目标
}
// playCard: 统一校验(阶段/回合、取牌、身份+独特前置、目标存活、默认非自己)、出牌入弃牌堆(noDiscard 的装备/延时锦囊除外),再执行该牌独特效果。
function playCard(cardIdx, actionId, targetSeat, onCommitted){
  tx(g=>{
    if(g.phase!=='play'||g.turn!==mySeat) return g;
    const me=g.players[mySeat], card=me.hand[cardIdx];
    if(!card) return g;
    const spec=CARD_PLAYS[actionId];
    if(!spec || !spec.canPlay(g,me,card)) return g;
    if(spec.target){
      if(actionId==='铁索连环' && Array.isArray(targetSeat)){
        const targets=targetSeat
          .filter((seat, idx, arr)=>Number.isInteger(seat) && arr.indexOf(seat)===idx)
          .slice(0,2);
        if(targets.length===0) return g;
        // 多目标分支必须与单目标走同一 canTarget。任一目标非法时原子拒绝整次出牌，
        // 不能静默删掉非法目标后仍消耗牌，也不能让帷幕/智迟等保护被数组路径绕过。
        if(targets.some(seat=>!g.players[seat] || !g.players[seat].alive ||
            (spec.canTarget && !spec.canTarget(g,me,card,seat)))) return g;
        targetSeat=targets;
      } else {
      // 默认拒绝自选目标;spec.allowSelf(如闪电这类延时锦囊)放行
      if((targetSeat===mySeat && !spec.allowSelf) || !g.players[targetSeat] || !g.players[targetSeat].alive) return g;
      if(spec.canTarget && !spec.canTarget(g,me,card,targetSeat)){
        const blocked=g.players[targetSeat];
        if(blocked && hasSkillName(blocked,'空城') && actionId==='杀' && (blocked.hand||[]).length===0) markSkillSound(g,'空城');
        else if(blocked && hasSkillName(blocked,'帷幕') && isBlackTactics(card)) markSkillSound(g,'帷幕');
        else {
          const tongji=g.players.find((p,seat)=>p&&p.alive&&hasSkillName(p,'同疾')&&(p.hand||[]).length>p.hp&&seat!==mySeat&&distance(g,seat,mySeat)<=attackRange(g,seat)&&seat!==targetSeat);
          if(tongji) markSkillSound(g,'同疾');
        }
        return g;
      } // 额外目标限制(如杀的攻击距离)
      }
    }
    removeHandCards(g, mySeat, cardIdx);
    if(!spec.noDiscard) g.discard.push(card); // 装备牌 noDiscard:不进弃牌堆,由 effect 放进装备区
    spec.effect(g, me, card, targetSeat);
    if(hasCap(me,'jizhi') && isTrickCardName(actionId)){
      drawN(g, mySeat, 1);
      g.log=pushLog(g.log, me.name+' 发动【集智】,摸一张牌');
      markSkillSound(g, '集智');
    }
    markCardSound(g, actionId, mySeat, card, spec.target ? targetSeat : null); // playCard 是普通出牌的统一出口,这里加一次就覆盖所有走这个入口的牌
    return g;
  }, onCommitted);
}
// resolveShaUse: 杀的结算入口(设次数标记 + pending + 进入响应阶段 + 日志)。
// 普通杀(CARD_PLAYS['杀'])和丈八蛇矛两张当杀共用,保证响应/距离/次数口径不分叉。
// 马超【铁骑】:攻击者可选是否发动判定,红色则这张杀不可被闪抵消——这是攻击者自己的选择,
// 需要挂起等一次响应,原来"设好 pending 后直接走青釭剑/八卦阵/进响应阶段"这段尾巴抽成
// continueShaAfterTieqi,不管有没有铁骑、发不发动、判红判黑,最终都走这同一条尾巴。
// card(可选):转化后实际打出的物理牌(关羽红牌/龙胆闪牌等),供于禁【毅重】判断颜色;
// 丈八蛇矛两张当杀没有单一花色,调用方不传(undefined),毅重不生效。
// 注意:g.shaUsed(本回合出杀次数限制)不在这里设置——本函数不假设调用方一定是"当前回合玩家
// 在自己出牌阶段出杀"(借刀杀人打破了这个假设:A 可能根本不是当前回合玩家)。谁该计入次数
// 由各调用点自己在调用前决定:CARD_PLAYS['杀'].effect/playZhangbaSha 会设,借刀杀人不设。
// resolveShaUse 的 shaColor 参数:这张杀的颜色,'red'/'black'/'none'/undefined 之一——不是
// 直接传物理牌,由调用方各自算好再传入(普通杀/借刀杀人用 singleCardShaColor(card),丈八
// 蛇矛两张当杀用 combinedShaColor(c1,c2)),resolveShaUse 内部只认这一份统一的颜色结果,
// 不用再关心"这张杀是怎么凑出来的"。**这里曾经有一个真实 bug**:早期版本直接传物理牌
// `card`、丈八蛇矛不传(undefined),导致"黑色杀对某某无效"这类效果(毅重/仁王盾)对丈八蛇矛
// 的合成杀完全绕过、不管用两张什么颜色的牌合成都不生效——真实规则里合成杀是有颜色的
// (两张都红→红,两张都黑→黑,一红一黑→无色),不是"没有颜色"。改成 shaColor 之后这个
// bug 自然消失,不需要在这里特殊处理"丈八蛇矛"这个武器,颜色早在调用方就算对了。



// afterShaTargetSkills: 铁骑/烈弓结束后(或无这两技能)→ 雌雄双股剑 → 仁王/毅重 → continueShaAfterTieqi。
// 所有"目标已确定、武将技已问完"的入口统一走这里,避免铁骑后漏雌雄或仁王过早短路。

// respondLiegong: 仅攻击者(pending.from)可响应。不需要判定,玩家的选择直接就是 noShan 的值——
// 复用 continueShaAfterTieqi 同一条尾巴(和铁骑判红共用"不可被闪抵消"这一效果)。
function respondLiegong(activate){
  tx(g=>{
    if(g.phase!=='liegong'||!g.pending||g.pending.type!=='liegong'||g.pending.from!==mySeat) return g;
    const from=g.pending.from, to=g.pending.to;
    if(activate) markSkillSound(g, '烈弓');
    g.log=pushLog(g.log, activate
      ? g.players[from].name+' 发动【烈弓】,此【杀】不可被【闪】抵消'
      : g.players[from].name+'：不发动【烈弓】');
    afterShaTargetSkills(g, from, to, activate, g.pending.sourceCard, g.pending.shaColor, g.pending.jiuBonus ? {jiuBonus:true} : undefined);
    return g;
  });
}
// respondJiedao: 仅 A(pending.seatA)可响应。选杀:走 resolveShaUse(复用铁骑/烈弓/毅重等判定),
// 但故意不设 g.shaUsed——这张"借来的杀"不占用任何人(包括 A 自己、当前回合玩家)的次数限制,
// 也不重复校验距离(B 是否在 A 范围内,已经在 jieDaoShaRen 选目标那一步校验过)。
// 选弃武器:弃置 A 当前装备的武器(不是使用者选的牌),触发 onLoseEquip(孙尚香会摸两张)。

// continueShaAfterTieqi: 铁骑判定/烈弓数值条件阶段结束后(或从一开始就没有这两个技能)接回杀的
// 原有流程。noShan 为真时这张杀不可被闪抵消——包括八卦阵这类"视为闪"的效果,所以直接跳过
// tryBagua(根本不给判定机会),进响应阶段但 pending.noShan 标记会挡掉出闪。是谁、为什么触发
// noShan(铁骑判红、还是烈弓数值条件)由调用方(finishTieqiJudge/respondLiegong)自己记日志,
// 这里只管接回流程,不重复归因到某个具体技能。

// 陈宫【明策】入口：出牌阶段限一次，检查是否有可用的装备牌或杀
function startMingce(){
  tx(g=>{
    if(g.phase!=='play' || g.turn!==mySeat) return g;
    const me = g.players[mySeat];
    if(!me || !me.alive || !hasCap(me,'mingce')) return g;
    if(g.mingceUsed) return g;
    // 检查手牌是否有装备或杀
    const hasMingceCard = (me.hand||[]).some((c,i)=>c && (isEquipment(c) || canUseAs(me,c,'杀')));
    // 检查装备区是否有装备
    const hasMingceEquip = me.equips && Object.values(me.equips).some(eq=>eq!==null);
    if(!hasMingceCard && !hasMingceEquip) return g;
    // 必须有其他存活玩家
    const others = g.players.filter((p,i)=>p && p.alive && i!==mySeat);
    if(others.length===0) return g;
    g.mingceUsed = true;
    markSkillSound(g, '明策');
    g.pending = setResponseAskedAt({type:'mingcePickCard', sourceSeat:mySeat});
    g.phase = 'mingcePickCard';
    return g;
  });
}
// 陈宫【明策】检查是否有可用的牌（UI 按钮可见性用）
function checkMingceCard(p){
  if(!p || !p.alive || !hasCap(p,'mingce')) return false;
  // 必须用 currentG(render.js 每次 render 更新的那份快照),不能写裸 g:这个函数没有 g
  // 参数、全项目也没有全局 g,未声明的标识符 `g &&` 不是安全短路——求值 g 本身就先抛
  // ReferenceError,根本走不到 &&。它由 render-controls.js 在渲染时调用,所以只要场上有
  // 陈宫,每次渲染都会从这里断掉、后半段控件全渲染不出来(影响真人玩家,不只是机器人)。
  // 这是继曹冲称象 toggleChengxiangCard/confirmChengxiangSelection 之后同类问题第三次出现。
  if(typeof currentG!=='undefined' && currentG && currentG.mingceUsed) return false;
  const hand = (p.hand||[]).some((c,i)=>c && (isEquipment(c) || canUseAs(p,c,'杀')));
  const equip = p.equips && Object.values(p.equips).some(eq=>eq!==null);
  return hand || equip;
}
// 陈宫【明策】选择牌/装备
function pickMingceCard(cardIdx, isEquip){
  tx(g=>{
    if(g.phase!=='mingcePickCard'||!g.pending||g.pending.type!=='mingcePickCard'||g.pending.sourceSeat!==mySeat) return g;
    const me = g.players[mySeat];
    if(!me || !me.alive) return g;
    let card = null, cardName = '';
    if(isEquip){
      const equip = me.equips && me.equips[cardIdx];
      if(!equip) return g;
      card = equip;
      cardName = equip.name;
      me.equips[cardIdx] = null;
      // 交出装备 = 失去装备,必须触发 onLoseEquip(孙尚香【枭姬】/凌统【旋风】等)。
      // 写法照抄旋风那 8 个入口已确立的标准范式:先把 phase 设回休止相(让钩子里的
      // 旋风捕获到正确的 previousPhase,不是 mingcePickCard 这种死相),再拍 pendingBefore
      // 快照触发钩子;钩子若挂起了新 pending 就直接 return,不覆盖它。
      g.pending = null;
      g.phase = 'play';
      const pendingBefore = g.pending;
      triggerHook(g, mySeat, 'onLoseEquip', {count:1});
      if(g.pending !== pendingBefore && g.pending){
        // 钩子挂起了询问(如旋风):明策这次就到此为止,交出的牌按弃置处理避免凭空消失
        g.discard.push(card);
        g.log = pushLog(g.log, me.name+' 发动【明策】交出【'+cardName+'】时触发了其它技能,本次明策中止');
        return g;
      }
    }else{
      if(cardIdx<0 || cardIdx>=me.hand.length) return g;
      const c = me.hand[cardIdx];
      if(!c || (!isEquipment(c) && !canUseAs(me,c,'杀'))) return g;
      card = removeHandCards(g, mySeat, cardIdx)[0];
      cardName = card.name;
    }
    // 传入牌名与牌对象，进入选目标阶段
    g.pending = {
      type:'mingcePickTarget',
      sourceSeat:mySeat,
      targetSeat:null,
      cardToGive:[card],
      cardName:cardName
    };
    g.phase = 'mingcePickTarget';
    return g;
  });
}
// 陈宫【明策】选择接收牌的目标
function pickMingceTarget(targetSeat){
  tx(g=>{
    if(g.phase!=='mingcePickTarget'||!g.pending||g.pending.type!=='mingcePickTarget'||g.pending.sourceSeat!==mySeat) return g;
    const target = g.players[targetSeat];
    if(!target || !target.alive || targetSeat===mySeat) return g;
    g.pending.targetSeat = targetSeat;
    // 找出目标攻击范围内的其他角色
    // 官方原文:"交给一名【其他】角色…选择其攻击范围内的【另一名】角色"——两处限定词不同:
    // 接收牌的人必须是"其他角色"(排除陈宫自己),而被杀的第二目标只说"另一名角色",只相对
    // 接收者而言,并没有排除陈宫。所以这里【不能】再加 i!==mySeat —— 陈宫可以指自己
    // (常见打法:配合【智迟】主动吃一刀)。
    const virtualSha={name:'杀',virtual:true};
    const candidates = g.players.filter((p,i)=>p && p.alive && i!==targetSeat &&
      CARD_PLAYS['杀'].canTarget(g, target, virtualSha, i));
    if(candidates.length===0){
      // 无可选第二目标，直接进入选择阶段
      g.pending = {
        type:'mingceChoice',
        sourceSeat:mySeat,
        targetSeat:targetSeat,
        target2Seat:null,
        cardName:g.pending.cardName,
        cardToGive:g.pending.cardToGive
      };
      g.phase = 'mingceChoice';
    }else{
      g.pending = {
        type:'mingcePickTarget2',
        sourceSeat:mySeat,
        targetSeat:targetSeat,
        cardToGive:g.pending.cardToGive,
        cardName:g.pending.cardName,
        candidates:candidates.map(p=>g.players.indexOf(p))
      };
      g.phase = 'mingcePickTarget2';
    }
    return g;
  });
}
// 陈宫【明策】选择第二目标（被攻击者）
function pickMingceTarget2(seat){
  tx(g=>{
    if(g.phase!=='mingcePickTarget2'||!g.pending||g.pending.type!=='mingcePickTarget2'||g.pending.sourceSeat!==mySeat) return g;
    if(!g.pending.candidates.includes(seat)) return g;
    const attacker=g.players[g.pending.targetSeat];
    if(!attacker || !CARD_PLAYS['杀'].canTarget(g,attacker,{name:'杀',virtual:true},seat)) return g;
    g.pending = {
      type:'mingceChoice',
      sourceSeat:mySeat,
      targetSeat:g.pending.targetSeat,
      target2Seat:seat,
      cardName:g.pending.cardName,
      cardToGive:g.pending.cardToGive
    };
    g.phase = 'mingceChoice';
    return g;
  });
}
// 陈宫【明策】取消
function cancelMingce(){
  tx(g=>{
    if(!(g.phase==='mingcePickCard'||g.phase==='mingcePickTarget'||g.phase==='mingcePickTarget2'||g.phase==='mingceChoice')||!g.pending||g.pending.sourceSeat!==mySeat) return g;
    g.mingceUsed = false;
    g.pending = null;
    g.phase = 'play';
    return g;
  });
}
// 陈宫【明策】接收牌的角色选择：视为用杀 / 摸牌
function chooseMingceOption(option){
  tx(g=>{
    if(g.phase!=='mingceChoice'||!g.pending||g.pending.type!=='mingceChoice'||g.pending.targetSeat!==mySeat) return g;
    const source = g.players[g.pending.sourceSeat];
    const target = g.players[g.pending.targetSeat];
    const target2 = g.pending.target2Seat!==null ? g.players[g.pending.target2Seat] : null;
    const cardName = g.pending.cardName;
    const cardToGive = g.pending.cardToGive;
    if(!target || !target.alive) return g;
    // 服务端兜底:没有第二目标时"视为使用杀"不是合法选项(官方FAQ:此时只能选摸牌)。
    // UI 已经不渲染该按钮,这里再挡一层,避免出现"牌交出去了、两个选项的效果都不执行"
    // 这种半吊子状态(既有实现就是这样,牌白给)。
    if(option==='sha' && (!(target2 && target2.alive) ||
       !CARD_PLAYS['杀'].canTarget(g,target,{name:'杀',virtual:true},g.pending.target2Seat))) return g;
    if(option!=='sha' && option!=='draw') return g;
    // 先把牌交给目标
    if(cardToGive && cardToGive.length>0){
      cardToGive.forEach(c=>target.hand.push(c));
      g.log = pushLog(g.log, (source?source.name:'陈宫')+' 将 【'+cardName+'】 交给 '+target.name+'（明策）');
    }
    // 先收尾回休止相,再触发后续效果 —— 这样 resolveShaUse 挂起的响应 pending 才不会被
    // 我们自己的收尾覆盖掉(曾经是先 resolveShaUse、再无条件 g.pending=null;phase='play',
    // 结果视为的杀刚建立响应阶段就被抹掉,目标毫发无伤)。
    g.pending = null;
    g.phase = 'play';
    if(option==='sha'){
      // 视为对第二目标使用一张普通【杀】(无花色/无属性),使用者是接收牌的角色而非陈宫。
      // resolveShaUse 的第 2 参数是【玩家对象】(内部自己 indexOf 取座位),不是座位号 ——
      // 曾经传 g.players.indexOf(target) 这个数字,导致 indexOf(数字) 得到 -1、
      // 使用者变成不存在的座位(日志显示 "undefined 对 XX")。项目里其余 6 个调用点都传对象。
      g.log = pushLog(g.log, target.name+' 选择视为对 '+target2.name+' 使用【杀】（明策）');
      const pendingBefore = g.pending;
      resolveShaUse(g, target, g.players.indexOf(target2), '明策:视为杀', 'none', undefined);
      if(g.pending !== pendingBefore && g.pending) return g; // 杀已挂起响应,交给它继续
    }else{
      drawN(g, g.players.indexOf(target), 1);
      g.log = pushLog(g.log, target.name+' 选择摸一张牌（明策）');
    }
    return g;
  });
}

// respondTieqi: 仅攻击者(pending.from)可响应。不发动:直接接原尾巴(noShan=false)。
// 发动:judge() 翻牌(可被鬼才改判,和其它判定场景同一套 maybeGuicai),红则 noShan=true。
function respondTieqi(activate){
  tx(g=>{
    if(g.phase!=='tieqi'||!g.pending||g.pending.type!=='tieqi'||g.pending.from!==mySeat) return g;
    const from=g.pending.from, to=g.pending.to;
    if(!activate){
      g.log=pushLog(g.log, g.players[from].name+'：不发动【铁骑】');
      afterShaTargetSkills(g, from, to, false, g.pending.sourceCard, g.pending.shaColor, g.pending.jiuBonus ? {jiuBonus:true} : undefined);
      return g;
    }
    const card=judge(g);
    const shaInfo = g.pending.jiuBonus ? {jiuBonus:true} : undefined;
    if(!card){ afterShaTargetSkills(g, from, to, false, g.pending.sourceCard, g.pending.shaColor, shaInfo); return g; } // 无牌可判,视为未发动
    markSkillSound(g,'铁骑');
    if(maybeGuicai(g, from, card, {kind:'tieqiJudge', from, to, sourceCard:g.pending.sourceCard, shaColor:g.pending.shaColor, shaInfo})==='pending') return g;
    finishTieqiJudge(g, from, to, card, g.pending.sourceCard, g.pending.shaColor, shaInfo);
    return g;
  });
}
// finishTieqiJudge: 铁骑判定结算(不管是否被鬼才改判过)。红=不可被闪抵消,黑=无事发生。

// playZhangbaSha: 丈八蛇矛特效——任意两张手牌当一个【杀】。与 playCard 平级(playCard 只吃单张)。
// 次数/距离/目标响应与普通杀完全一致(共用 resolveShaUse);仅"凑杀"方式不同。

// playShaFangtian: 方天画戟——锁定技,若使用的杀是最后一张手牌,可额外选至多两个目标(总计最多3个)。
// 与 playCard/CARD_PLAYS['杀'] 平级的独立入口(不改动通用单目标出杀流程,普通玩家/普通情况完全不受影响)。
// 不强制选满(targets.length 1~3 都合法),结算顺序不由玩家提交顺序决定——按 nextAlive 回合方向从
// 攻击者起重排(官方原文"结算顺序固定、不可自选")。武器槽互斥:装备方天画戟时不可能同时装备
// 青龙偃月刀/寒冰剑/麒麟弓等其它武器,因此排队目标的后续响应/判定不会触碰那几把武器各自的专属分支。
// 额外目标是否也受方天画戟自身射程限制:查不到能逐字引用的官方原文,这里按"这仍是同一张杀、射程
// 限制作用于这张杀本身"的方向实现——是推断,不是确证的官方规则,已与用户确认按这个方向做。

function lianHuan(cardIdx, targetSeat){
  tx(g=>{
    if(g.phase!=='play'||g.turn!==mySeat) return g;
    const me=g.players[mySeat];
    if(!me || !me.alive || !hasCap(me,'lianhuan')) return g;
    const card=me.hand[cardIdx];
    if(!card || card.suit!=='♣') return g;
    const targets=(Array.isArray(targetSeat)?targetSeat:[targetSeat])
      .filter((seat, idx, arr)=>Number.isInteger(seat) && arr.indexOf(seat)===idx)
      .slice(0,2)
      .filter(seat=>g.players[seat] && g.players[seat].alive);
    if(targets.length===0) return g;
    removeHandCards(g, mySeat, cardIdx);
    g.discard.push(card);
    g.log=pushLog(g.log, me.name+' 将【'+card.name+'】当【铁索连环】使用,目标 '+targets.map(seat=>g.players[seat].name).join('、'));
    markSkillSound(g, '连环');
    startTieSuoTargets(g, mySeat, targets);
    return g;
  });
}
function advanceTieSuoQueue(g){
  const q=g.tiesuoQueue;
  if(!q){ g.phase='play'; return; }
  const from=g.players[q.from];
  while(q.idx<q.targets.length){
    const to=q.targets[q.idx++];
    const target=g.players[to];
    if(!from || !from.alive || !target || !target.alive) continue;
    g.log=pushLog(g.log, from.name+' 对 '+target.name+' 使用【铁索连环】');
    // 这里是队列推进函数,原始那张梅花实体牌在更早的 lianHuan/recastLianHuan 里已经处理完,
    // 这一步拿不到牌面对象(不同调用点各自持有,不应跨函数传值制造耦合),只传座位。
    markCardSound(g, '铁索连环', q.from, null, to);
    startTrick(g, {trick:'铁索连环', from:q.from, to});
    return;
  }
  g.tiesuoQueue=null;
  g.pending=null;
  g.phase='play';
}
function startTieSuoTargets(g, fromSeat, targetSeats){
  const seats=(Array.isArray(targetSeats)?targetSeats:[targetSeats])
    .filter((seat, idx, arr)=>Number.isInteger(seat) && arr.indexOf(seat)===idx)
    .slice(0,2)
    .filter(seat=>g.players[seat] && g.players[seat].alive);
  if(seats.length===0){ g.phase='play'; return; }
  g.tiesuoQueue={from:fromSeat, targets:seats, idx:0};
  advanceTieSuoQueue(g);
}
function liuliDiscardOptions(p){
  const list=[];
  (p.hand||[]).forEach((card, idx)=>list.push({kind:'hand', idx, label:'手牌【'+card.name+'】'}));
  EQUIP_SLOTS.forEach(slot=>{ if(p.equips && p.equips[slot]) list.push({kind:'equip', slot, label:EQUIP_SLOT_LABEL[slot]+'【'+p.equips[slot].name+'】'}); });
  return list;
}
function liuliTargets(g, from, to){
  // 多目标杀中，已经是此杀目标的其他角色不能再次成为【流离】的新目标，否则同一张杀会
  // 对同一角色结算两次。单目标杀时队列为空，不影响原逻辑。
  const queuedTargets=(g.fangtianQueue && Array.isArray(g.fangtianQueue.targets))
    ? g.fangtianQueue.targets : [];
  return g.players.map((p,i)=>({p,i}))
    .filter(o=>o.p && o.p.alive && o.i!==from && o.i!==to && !queuedTargets.includes(o.i) &&
      canReachSha(g, to, o.i) && !(hasCap(o.p,'kongcheng') && (o.p.hand||[]).length===0))
    .map(o=>o.i);
}

// maybeStartQiaomeng: 公孙瓒【趫猛】—— 使用黑色【杀】造成伤害后触发


// maybeStartLieRen: 祝融【烈刃】—— 使用【杀】对目标角色造成伤害后触发
function maybeStartLieRen(g, from, to) {
  const source = g.players[from];
  const target = g.players[to];
  // 检查条件:攻击者是祝融,有烈刃技能,目标存活
  if(!source || !source.alive || !target || !target.alive || from === to || !hasCap(source,'lieRen')) return false;
  
  // 进入烈刃选择阶段
  // 【A类修复】补setResponseAskedAt——此前没有,30秒超时兜底对这个pending形同虚设。
  g.pending=setResponseAskedAt({type:'lieRenChoose', sourceSeat:from, targetSeat:to});
  g.phase='lieRenChoose';
  g.log=pushLog(g.log, source.name + ' 可以发动【烈刃】,与 ' + target.name + ' 拼点');
  return true;
}
function respondLiuli(choice, newTargetSeat){
  tx(g=>{
    if(g.phase!=='liuli'||!g.pending||g.pending.type!=='liuli'||g.pending.to!==mySeat) return g;
    const {from, to, usedAs, shaColor, sourceCard}=g.pending;
    const me=g.players[to], newTarget=g.players[newTargetSeat];
    if(!choice){
      g.log=pushLog(g.log, me.name+'：不发动【流离】');
      // CORE-93(issue #140):这里回落到原目标(to)结算,原本这张杀已经在 CARD_PLAYS['杀']
      // 的 canTarget 里校验过一次攻击者→to 的距离(否则杀根本出不来),理论上重新校验也该
      // 通过——但为了和下面"真实转移"分支保持同一处理方式(不依赖"位置/装备中途没变"这个
      // 假设),同样传 {noDistance:true} 跳过 resolveShaUseNoLiuli 内部的二次距离校验。
      resolveShaUseNoLiuli(g, g.players[from], to, usedAs, shaColor, sourceCard, {noDistance:true});
      return g;
    }
    if(!newTarget || !newTarget.alive || newTargetSeat===from || newTargetSeat===to || !liuliTargets(g, from, to).includes(newTargetSeat)) return g;
    let discarded=null;
    if(choice.kind==='hand'){
      const idx=choice.idx;
      if(!Number.isInteger(idx) || !me.hand[idx]) return g;
      discarded=removeHandCards(g, to, idx)[0];
      g.discard.push(discarded);
    } else if(choice.kind==='equip'){
      const slot=choice.slot;
      if(!EQUIP_SLOTS.includes(slot) || !me.equips || !me.equips[slot]) return g;
      discarded=me.equips[slot];
      me.equips[slot]=null;
      g.discard.push(discarded);
    } else return g;
    markDiscardReveal(g, to, [discarded]);
    g.log=pushLog(g.log, me.name+' 弃置【'+discarded.name+'】发动【流离】,将此【杀】转移给 '+newTarget.name);
    markSkillSound(g, '流离');
    if(choice.kind==='equip'){
      const pendingBefore=g.pending;
      triggerHook(g,to,'onLoseEquip',{count:1});
      if(g.pending!==pendingBefore && g.pending){
        g.pending.resume={type:'liuliAfterDiscard',from,newTargetSeat,usedAs,shaColor,sourceCard};
        return g;
      }
    }
    // CORE-93(issue #140):流离转移后不能再用"原攻击者→新目标"的距离二次校验——转移的
    // 合法性已经由 liuliTargets()(canReachSha(g,to,o.i),即大乔自己的攻击范围)校验过
    // 一次,resolveShaUseNoLiuli 内部默认的距离校验对象是攻击者自己,和流离的规则基准
    // 完全不是同一个人,不该在这里重新生效。传 {noDistance:true} 跳过它(和神速
    // respondShensuSha 用同一套既有模式,skills.js 那边的"无距离限制的杀")。
    resolveShaUseNoLiuli(g, g.players[from], newTargetSeat, usedAs, shaColor, sourceCard, {noDistance:true});
    return g;
  });
}
// qiaobianDeclare: 真正弃牌+跳过阶段生效的提交。phaseChoice 是 'judge'/'draw'/'play'/'discard' 之一。
// - 'judge':判定阶段还没发生,直接跳过 resolveDelayTricks 这一次调用,判定区的牌原样保留,
//   留到下回合真正轮到判定阶段时再处理(不清空不作废)。
// - 'draw'/'discard':和乐不思蜀(skipPlay)/兵粮寸断(skipDraw)同款标志位机制,设标志位后
//   继续走原有链路,由 advancePastPlay/advancePastDiscard 在对应阶段的入口处消费。
// - 'play':还不能直接设 skipPlay——真实规则"移动一张装备/判定牌"是这个选项独有的后续效果,
//   要先问完"移动到哪"才算这次巧变完整结束,开新 pending qiaobianMove,skipPlay 留到那一步
//   (respondQiaobianMove)才设,避免"效果还没问完、标志已经生效"这种时序错乱。
function qiaobianDeclare(cardIdx, phaseChoice){
  tx(g=>{
    if(g.phase!=='qiaobianTurnStart'||!g.pending||g.pending.type!=='qiaobianTurnStart'||g.pending.seat!==mySeat) return g;
    if(!['judge','draw','play','discard'].includes(phaseChoice)) return g;
    const me=g.players[mySeat];
    const card=me.hand[cardIdx];
    if(!card) return g;
    removeHandCards(g, mySeat, cardIdx);
    markSkillSound(g, '巧变');
    g.discard.push(card);
    markDiscardReveal(g, mySeat, [card]);
    const phaseLabel={judge:'判定阶段',draw:'摸牌阶段',play:'出牌阶段',discard:'弃牌阶段'}[phaseChoice];
    g.log=pushLog(g.log, me.name+' 弃置一张牌,发动【巧变】,跳过'+phaseLabel);
    g.pending=null;
    if(phaseChoice==='judge'){
      // 跳过判定区结算,但仍须先过神速1询问(神速1 在判定前)
      g.qiaobianSkipJudge=true;
      continueShensu1Check(g, mySeat);
      return g;
    }
    if(phaseChoice==='draw'){
      g.skipDraw=true;
      continueShensu1Check(g, mySeat);
      return g;
    }
    if(phaseChoice==='discard'){
      g.skipDiscard=true;
      continueShensu1Check(g, mySeat);
      return g;
    }
    // phaseChoice==='play':先问是否移动一张装备/判定牌,skipPlay 留到 respondQiaobianMove 里设
    g.pending={type:'qiaobianMove', seat:mySeat};
    g.phase='qiaobianMove';
    g.log=pushLog(g.log, '【巧变】是否移动一张装备/判定牌…');
    return g;
  });
}

// heal: 通用体力回复函数，支持恩怨等触发
// heal(g, ...):被外层 tx 回调直接调用的辅助函数(目前唯一调用点在
// processBeigeJudgeResult 的红桃分支,而 processBeigeJudgeResult 本身又是被
// doBeigeJudge 的 tx 回调直接调用——两层都已经身处一次 tx 事务里),不该再自己开 tx。
// 和 finishBaguaColor/finishGuicai/finishDying/processBeigeJudgeResult 同一约定：
// 只有被客户端直接调用的入口函数才该调 tx,被 tx 回调内部调用的辅助函数直接操作
// 传入的 g。这是本项目第二次踩到同一类"辅助函数自己嵌套开 tx"的问题(第一次是
// processBeigeJudgeResult),新增任何类似的辅助函数时都要先确认它是不是已经在
// 某个 tx 回调内部被调用,是的话就不要再包一层 tx。
function heal(g, targetSeat, amount, sourceSeat, reason, srcType) {
  const target = g.players[targetSeat];
  if(!target || !target.alive) return g;

  const source = sourceSeat !== null && sourceSeat !== undefined ? g.players[sourceSeat] : null;
  const originalHp = target.hp || 0;
  target.hp = Math.min(target.maxHp || target.hp || 0, (target.hp || 0) + amount);
  const actualRecovered = (target.hp || 0) - originalHp;

  if(actualRecovered > 0) {
    const natureText = reason ? '(' + reason + ')' : '';
    g.log = pushLog(g.log, target.name + ' 回复' + actualRecovered + '点体力' + natureText + '（体力' + target.hp + '）');

    // 法正【恩怨】：当其他角色令你回复1点体力后，其摸一张牌
    // 每回复1点体力触发一次
    if (source && sourceSeat !== targetSeat && hasCap(target, 'enyuan')) {
      for (let i = 0; i < actualRecovered; i++) {
        ensureDeck(g);
        drawN(g, sourceSeat, 1);
        g.log = pushLog(g.log, target.name + ' 回复1点体力,' + source.name + ' 发动【恩怨】效果,摸一张牌');
      }
    }
  }
  return g;
}

// consumePendingHookQueue: 左慈"自己的hook + 借来的hook都想在同一次伤害上开pending"
// 这个冲突的排队消费点,接在resumeAfterInterrupt里startNextWangxi检查之后(同一类
// "还有一件排队的事没做完"的结构,但队列元素形状不同,见triggerHook的注释——不能
// 和wangxiQueue共用同一个字段)。
// 【关键点,推演天香/争义组合场景时发现的真实风险,不能省】:借来的hook(如遗计)自己
// 会用ctx.srcType构建一份全新的g.pending.resume;但这次resumeAfterInterrupt收到的
// resume可能早就被wrapPendingForTianxiang/wrapPendingForZhengyi包过一层(比如
// "还没做完天香的摸牌,做完才能回到最初被打断的流程")。如果放任借来的hook用它自己
// 建的那份干净resume,包过的那一层信息会被整个替换掉、永久丢失——所以这里跑完借来的
// hook之后,如果它确实开出了新pending,要强制用外部传入的resume覆盖它自己建的那个,
// 和startNextWangxi/wrapPendingForTianxiang"把外部resume原样接到新pending上"是同一
// 个道理。
function consumePendingHookQueue(g, resume){
  if(!g.pendingHookQueue) return false;
  const item = g.pendingHookQueue;
  g.pendingHookQueue = null;
  const p = g.players[item.seat];
  if(!p || !p.alive) return false; // 座位已失效:安全丢弃这条排队,不阻塞流程
  const borrowGen = item.source==='borrowed' ? getGeneral(p.huashenGeneral) : getGeneral(p.general);
  const fn = borrowGen && borrowGen.hooks && borrowGen.hooks[item.hookName];
  if(typeof fn !== 'function') return false;
  const pendingBefore = g.pending;
  fn(g, item.seat, item.ctx);
  if(g.pending !== pendingBefore && g.pending){
    g.pending.resume = resume;
    return true; // 挂起了新pending,调用方要return,交给玩家响应
  }
  return false; // 即时效果(如反馈/奸雄),没有新pending,继续往下走原有resume分派
}

// 同一次伤害可能同时满足多个受伤后技能。统一队列按固定顺序逐项执行；任何一项挂起
// pending 时，把恢复点改为 afterDamageEffects，响应完成后再继续下一项，避免覆盖或漏掉。
function continueAfterDamageEffects(g){
  const q=g.afterDamageEffects;
  if(!q || !Array.isArray(q.actions)) return false;
  const p=g.players[q.seat];
  if(!p || !p.alive){ g.afterDamageEffects=null; return false; }
  while(q.index<q.actions.length){
    const action=q.actions[q.index++];
    const pendingBefore=g.pending;
    if(action==='yaowu'){
      const src=Number.isInteger(q.sourceSeat)?g.players[q.sourceSeat]:null;
      if(hasCap(p,'yaowu') && q.sourceCard && isShaName(q.sourceCard.name) && isRed(q.sourceCard) && src && src.alive){
        g.pending={type:'yaowu_choose',seat:q.sourceSeat,target:q.seat,sourceCard:q.sourceCard};
        g.phase='yaowu_choose';
        g.log=pushLog(g.log,src.name+' 需选择【耀武】效果：回复1点体力 或 摸一张牌');
      }
    }else if(action==='enyuan'){
      const damager=Number.isInteger(q.sourceSeat)?g.players[q.sourceSeat]:null;
      if(hasCap(p,'enyuan') && q.sourceSeat!==q.seat && damager && damager.alive){
        g.pending={type:'enyuanChoose',sourceSeat:q.seat,damagerSeat:q.sourceSeat};
        g.phase='enyuanChoose';
        g.log=pushLog(g.log,damager.name+' 对 '+p.name+' 造成了伤害,'+damager.name+' 需要选择【恩怨】效果');
        markSkillSound(g,'恩怨');
      }
    }else if(action==='hooks'){
      const ctx={amount:q.amount,sourceSeat:q.sourceSeat,srcType:q.srcType};
      if(q.sourceCard!==undefined) ctx.sourceCard=q.sourceCard;
      triggerHook(g,q.seat,'onDamaged',ctx);
    }else if(action==='jiushi'){
      if(hasCap(p,'jiushi') && q.jiushiFacedownAtDamage && p.faceup===false){
        // 曹植【酒诗②】翻回正面:只是解除背面朝上状态,没有下行风险,不再询问,直接生效。
        p.faceup=true;
        g.log=pushLog(g.log, p.name+' 发动【酒诗】,翻回正面');
        markSkillSound(g, '酒诗');
      }
    }else if(action==='chengxiang'){
      if(hasCap(p,'chengxiang')){
        g.pending={type:'chengxiangAsk',seat:q.seat,damageInfo:{amount:q.amount,sourceSeat:q.sourceSeat,reason:q.reason,srcType:q.srcType,sourceCard:q.sourceCard}};
        g.phase='chengxiangAsk';
        g.log=pushLog(g.log,p.name+' 受到伤害，可发动【称象】');
      }
    }else if(action==='beige' && q.srcType==='sha'){
      const candidates=[];
      for(let i=0;i<g.players.length;i++){
        const beigeP=g.players[i];
        if(beigeP&&beigeP.alive&&hasCap(beigeP,'beige')&&i!==q.seat&&beigeCanDiscard(beigeP)) candidates.push(i);
      }
      if(candidates.length){
        g.beigeQueue={candidates,index:0,damagedSeat:q.seat,damageSource:q.sourceSeat,reason:q.reason};
        startNextBeigeOwner(g);
      }
    }
    if(g.pending!==pendingBefore && g.pending){
      g.pending.resume={type:'afterDamageEffects'};
      return true;
    }
  }
  g.afterDamageEffects=null;
  return false;
}
// dealDamage 调用方为 delay/xiaoguo/刚烈等补充专用恢复信息时，若当前正处于受伤后技能
// 队列，恢复目标属于整条队列而不是眼前这个子 pending；否则保持旧行为直接写 pending。
function setInterruptedDamageResume(g,resume){
  if(g.afterDamageEffects && g.pending && g.pending.resume && g.pending.resume.type==='afterDamageEffects'){
    g.afterDamageEffects.originalResume=resume;
  }else if(g.pending){
    g.pending.resume=resume;
  }
}
function enqueueWangxi(g, item){
  if(!Array.isArray(g.wangxiQueue)) g.wangxiQueue=[];
  g.wangxiQueue.push(item);
}
function enqueueDamageWangxi(g, seat, amount, sourceSeat){
  if(!(amount>0) || typeof sourceSeat!=='number' || sourceSeat===seat || sourceSeat>=g.players.length) return;
  const p=g.players[seat], other=g.players[sourceSeat];
  if(p && p.alive && hasCap(p,'wangxi') && other && other.alive){
    enqueueWangxi(g,{seat,otherSeat:sourceSeat,death:false,amount});
  }
  if(other && other.alive && p && p.alive && hasCap(other,'wangxi')){
    enqueueWangxi(g,{seat:sourceSeat,otherSeat:seat,death:false,amount});
  }
}
function startNextWangxi(g, resume){
  if(!Array.isArray(g.wangxiQueue) || g.wangxiQueue.length===0) return false;
  while(g.wangxiQueue.length>0){
    const item=g.wangxiQueue.shift();
    const p=g.players[item.seat];
    const other=g.players[item.otherSeat];
    if(!p || !p.alive) continue;
    if(!item.death && (!other || !other.alive)) continue;
    g.pending={
      type:'wangxiAsk',
      seat:item.seat,
      otherSeat:item.otherSeat,
      death:!!item.death,
      amount:item.amount,
      resume
    };
    g.phase='wangxiAsk';
    g.log=pushLog(g.log, p.name+' 是否发动【忘隙】…');
    return true;
  }
  return false;
}
function dealDamage(g, seat, amount, sourceSeat, reason, srcType, sourceCard, skipTianxiang, skipZhengyi, skipChain, skipZhimeng, skipRenxinSeats){
  const p=g.players[seat];
  if(!p) return false;

  // 徐庶【无言】:锦囊伤害防止(锁定技)。连环传导仍带原 sourceCard,同样防止。
  if(amount > 0 && sourceCard && isTrickCardName(sourceCard.name)){
    const src = (typeof sourceSeat === 'number') ? g.players[sourceSeat] : null;
    const tgt = g.players[seat];
    if(src && src.alive && hasCap(src, 'wuyan')){
      g.log = pushLog(g.log, src.name + ' 发动【无言】,防止其锦囊造成的伤害');
      markSkillSound(g, '无言');
      return false;
    }
    if(tgt && tgt.alive && hasCap(tgt, 'wuyan')){
      g.log = pushLog(g.log, tgt.name + ' 发动【无言】,防止锦囊伤害');
      markSkillSound(g, '无言');
      return false;
    }
  }

  // 曹植【酒诗②】:扣血前记录是否背面(受伤时状态)
  const jiushiFacedownAtDamage = (p.faceup === false);

  if(!skipZhengyi && maybeStartZhengyi(g, seat, amount, sourceSeat, reason, srcType, sourceCard)) return true;
  if(!skipTianxiang && maybeStartTianxiang(g, seat, amount, sourceSeat, reason, srcType, sourceCard)) return true;
  
  // 马谡【制蛮】:伤害结算前,无论目标身上能拿的候选牌是1张还是多张都要先问"是否发动"
  // (制蛮永远可选,不能因为候选唯一就自动结算跳过这一步),所以只会返回'ask'或false;
  // 'prevented'分支保留是防御性写法(triggerZhimeng当前实现不会再返回它)。
  if(!skipZhimeng && typeof sourceSeat === 'number') {
    const originalCtx = { amount, sourceSeat, reason, srcType, sourceCard, to: seat };
    const zhimengResult = triggerZhimeng(g, sourceSeat, seat, originalCtx);
    if(zhimengResult === 'prevented') return false; // 伤害已防止
    if(zhimengResult === 'ask') return true;        // 挂起询问,调用方 return
  }
  
  // 魏延【狂骨】:在扣减体力前计算距离(锁定技,造成伤害后若距离≤1则回复等同于伤害点数的体力)
  let kuangguDist = null;
  if(amount > 0 && typeof sourceSeat === 'number' && sourceSeat !== seat 
     && sourceSeat >= 0 && sourceSeat < g.players.length) {
    const attacker = g.players[sourceSeat];
    if(attacker && attacker.alive && hasCap(attacker, 'kuanggu')){
      kuangguDist = distance(g, sourceSeat, seat);
    }
  }

  // 曹冲【仁心】:在伤害扣减前检查是否可以发动(目标体力=1 且保护者有装备)
  // skipRenxinSeats: 已选择不发动的保护者座位,重放伤害时跳过,防死循环
  if(amount > 0 && p && p.alive && p.hp === 1) {
    const skipped = Array.isArray(skipRenxinSeats) ? skipRenxinSeats : [];
    for (let i = 0; i < g.players.length; i++) {
      if(skipped.includes(i)) continue;
      const candidate = g.players[i];
      if (i !== seat && candidate && candidate.alive && hasCap(candidate, 'renxin')) {
        // 真实装备区是 equips 四槽对象,不是数组
        const equipSlots = EQUIP_SLOTS.filter(s => candidate.equips && candidate.equips[s]);
        if (equipSlots.length > 0) {
          g.pending = {
            type: 'renxinChoose',
            seat: i,
            target: seat,
            damage: amount,
            sourceSeat: sourceSeat,
            equipSlots: equipSlots,
            originalDamageInfo: { amount, sourceSeat, reason, srcType, sourceCard, to: seat },
            skipRenxinSeats: skipped
          };
          g.phase = 'renxinChoose';
          g.log = pushLog(g.log, candidate.name + ' 可以发动【仁心】,保护 ' + p.name);
          return true;
        }
      }
    }
  }

  // 【体力值可以为负,这是有意为之,不要再在这里加 Math.max(0,...)】
  // 官方规则:伤害超过剩余体力时体力真的变成负数(1血挨闪电3点 -> -2),濒死救援要把体力
  // 补回 1 以上才能脱离,所以 -2 需要连续 3 个【桃】。曾经这里写的是 Math.max(0, p.hp-amount),
  // 是 d55d82c 为了修一个【显示】bug(血格公式 maxHp-hp 在 hp 为负时算出比满血还多的空血格)
  // 而加的——修在了错误的层:数据层被钳死在 0 之后,1血挨3点变成 0,一个桃 ++ 到 1 就脱离濒死,
  // 把规则整个改掉了(而且不是闪电特有,任何 amount>剩余hp 的伤害都中招)。
  // 现在的原则是【数据层说真话、渲染层负责好看】:这里保留真实的负数,显示钳制放在 render.js
  // 的血格公式里。凡是消费 hp 的地方(尤其是任何 maxHp-hp 形式的"已损失体力值")都必须自己
  // 考虑 hp<0 会让结果膨胀——完整点位清单见 CLAUDE.md。
  const hpBeforeThisDamage = p.hp;
  p.hp = p.hp - amount;
  if(amount>0){
    const damageSeq=(g.lastDamageEffect && Number.isInteger(g.lastDamageEffect.seq)) ? g.lastDamageEffect.seq : 0;
    g.lastDamageEffect={seq:damageSeq+1,target:seat,amount:amount};
  }
  const natureText=damageNatureText(cardDamageNature(sourceCard));
  g.log=logEvent(g.log, { kind:'damage', actor:(Number.isInteger(sourceSeat)?sourceSeat:undefined), targets:[seat], text: p.name+(reason?' '+reason+',':' ')+'受到'+amount+'点'+natureText+'伤害（体力'+p.hp+'）' });
  if(typeof recordBotDamageEvidence==='function') recordBotDamageEvidence(g,sourceSeat,seat,amount,srcType);
  // 连环状态在属性伤害发生后立即重置；真正向其他角色传导允许被当前角色的濒死流程
  // 中断，待其获救或死亡后再由 resumeAfterInterrupt 继续。
  const hasChainToPropagate=!skipChain && prepareChainedDamage(g,seat,amount,sourceSeat,reason,srcType,sourceCard);

  // 陈宫【智迟】：回合外受伤后立即标记(锁定技,不挂起)
  if (amount > 0 && p && p.alive && hasCap(p, 'zhichi') && g.turn !== seat) {
    g.zhichiImmunity = {
      seat: seat,
      turn: g.turn
    };
    g.log = pushLog(g.log, p.name + ' 发动【智迟】,【杀】和普通锦囊牌对其无效直至本回合结束');
    markSkillSound(g, '智迟');
  }

  // 魏延【狂骨】:锁定技回复,在濒死/询问之前结算(不挂起)
  if(amount > 0 && kuangguDist !== null && kuangguDist <= 1) {
    const attacker = g.players[sourceSeat];
    if(attacker && attacker.alive) {
      const healAmount = Math.min(amount, attacker.maxHp - attacker.hp);
      if(healAmount > 0) {
        attacker.hp += healAmount;
        g.log = pushLog(g.log, attacker.name + ' 发动【狂骨】,回复'+healAmount+'点体力（体力'+attacker.hp+'）');
        markSkillSound(g, '狂骨');
      }
    }
  }

  // 致命优先:先不屈/濒死,再处理受伤后可选技能(恩怨/耀武等),避免 0 血僵尸
  if(p.hp<=0){
    // 濒死/不屈只是暂时打断本次伤害。先保存尚未执行的受伤后队列；获救或不屈
    // 防死后由 resumeAfterInterrupt 接回，真死时则因角色不存活而安全丢弃。
    enqueueDamageWangxi(g,seat,amount,sourceSeat);
    g.afterDamageEffects={seat,amount,sourceSeat,reason,srcType,sourceCard,jiushiFacedownAtDamage,
      actions:['yaowu','enyuan','hooks','jiushi','chengxiang','beige'],index:0,originalResume:{type:srcType}};
    // 周泰【不屈】触发次数:"体力降到0或以下"这个区间里,这一下伤害一共有几点落在
    // 这个区间,就问几次(每点独立一次放置不屈牌的机会),不是"只要结算后≤0就问一次"。
    // 推导:把 amount 点伤害看成 amount 次连续的-1,第 k 次(k=1..amount)扣完后的体力是
    // hpBeforeThisDamage-k;落在"≤0"区间的次数 = amount 减去"结果仍>0"的次数。
    // 结果>0 当且仅当 k<hpBeforeThisDamage,即 k 从 1 到 max(hpBeforeThisDamage-1,0) 共
    // max(hpBeforeThisDamage-1,0) 次(hpBeforeThisDamage≤0 时打之前已经在区间内,这部分为0,
    // 后面 amount 次全部计入,与"已经是0血再挨打全部N点都算"的要求一致)。
    // 因此 overkillPoints = amount - max(hpBeforeThisDamage-1, 0),再夹到 [0, amount]。
    // 验证:hp=0挨2点→0-max(-1,0)=2-0=2(两次都问);hp=1挨2点→2-max(0,0)=2(两次都问,
    // 因为第1点刚好让体力到0、第2点让体力到-1,两次结果都≤0);hp=3挨2点→hp变1,不出现
    // 这个分支(不触发);hp=1挨1点→1-0=1(单点伤害维持改动前"触发1次"的行为,零回归)。
    const overkillPoints = Math.max(0, Math.min(amount, amount - Math.max(hpBeforeThisDamage-1, 0)));
    if(hasCap(p, 'buqu') && overkillPoints > 0 && (g.deck || []).length > 0) {
      g.pending = { type:'buquAsk', seat, resume:{type:'afterDamageEffects', sourceSeat, amount}, remaining: overkillPoints };
      g.phase = 'buquAsk';
      g.log = pushLog(g.log, p.name+' 体力降到0,是否发动【不屈】,放置一张不屈牌…'+(overkillPoints>1?'（本次伤害共需询问 '+overkillPoints+' 次）':''));
      return true;
    }
    startDying(g, seat, 'afterDamageEffects', sourceSeat, amount);
    return true;
  }
  // 李典【忘隙】统一入口:先把本次伤害加入队列。属性伤害若随后发生连环传导,传导伤害也会
  // 继续入队;整条伤害链结束后再逐个询问,避免第一次 pending 截断后续传导目标。
  enqueueDamageWangxi(g,seat,amount,sourceSeat);

  if(hasChainToPropagate){
    if(advanceChainedDamage(g)) return true;
    g.chainDamageQueue=null;
  }

  // 实际受伤且存活 -> 所有受伤后效果进入统一队列，挂起的技能响应后继续下一项。
  if(amount>0){
    g.afterDamageEffects={seat,amount,sourceSeat,reason,srcType,sourceCard,jiushiFacedownAtDamage,
      actions:['yaowu','enyuan','hooks','jiushi','chengxiang','beige'],index:0,originalResume:{type:srcType}};
    if(continueAfterDamageEffects(g)) return true;
  }
  if(!skipChain && startNextWangxi(g, {type:srcType})) return true;
  return false;
}
// ===== 濒死求桃:血量<=0 不立刻死亡,按座位顺序逐个询问是否打出【桃】救援 =====
// startDying: 由 dealDamage 在 hp<=0 时调用。从濒死者本人开始问(可自救),
// resume 记下"濒死解决后该接回哪条流程的尾巴"(取值就是调用方本来就在传的 srcType)。
function startDying(g, seat, resumeType, sourceSeat, amount){
  const p=g.players[seat];
  p.dying=true;
  const resume = {type:resumeType};
  if(typeof sourceSeat==='number') resume.sourceSeat=sourceSeat;
  if(typeof amount==='number') resume.amount=amount;
  
  // 贾诩【完杀】：检查是否在贾诩的回合内
  const jiaxuSeat = Number.isInteger(g.turn) && g.players[g.turn] && g.players[g.turn].alive && hasCap(g.players[g.turn],'wansha') ? g.turn : null;
  if (jiaxuSeat !== null) {
    // 濒死角色进入完杀效果范围
    g.wanshaActive = true;
    g.wanshaDyingSeat = seat;
    g.log = pushLog(g.log, `【完杀】发动,除 ${g.players[jiaxuSeat].name} 和 ${p.name} 以外的角色不能使用【桃】`);
    markSkillSound(g, '完杀');
  }
  
  g.pending=setResponseAskedAt({type:'dying', seat, asking:seat, resume});
  g.phase='dying';
  g.log=pushLog(g.log, p.name+' 濒死！询问 '+p.name+' 是否使用【桃】自救…');
}
// respondDying: 仅当前被问的人(pending.asking)可响应。
// 打出桃:回1点体力;若脱离濒死(hp>0)则 finishDying(false)结束;若仍<=0,留在同一个人身上,
// 允许其继续追加桃(接力仍在此人,若无更多桃则界面只剩"不救"可点)。
// 不救:用 nextAskee(from=濒死者座位) 推进到下一个存活玩家;绕回濒死者本人 = 问完一圈,无人救 -> finishDying(true)。
function useJijiuCard(g, me, choice){
  if(!choice || !hasCap(me,'jijiu') || g.turn===mySeat) return null;
  if(choice.kind==='hand'){
    const idx=choice.idx;
    const card=me.hand[idx];
    if(!card || !isRed(card)) return null;
    removeHandCards(g, mySeat, idx);
    g.discard.push(card);
    return card;
  }
  if(choice.kind==='equip'){
    const slot=choice.slot;
    if(!EQUIP_SLOTS.includes(slot) || !me.equips || !me.equips[slot] || !isRed(me.equips[slot])) return null;
    const card=me.equips[slot];
    me.equips[slot]=null;
    g.discard.push(card);
    triggerHook(g, mySeat, 'onLoseEquip', {count:1});
    return card;
  }
  return null;
}
function useDyingJiuCard(g, me){
  const idx=findUsableAs(me.hand, me, '酒');
  if(idx<0) return null;
  const card=removeHandCards(g, mySeat, idx)[0];
  g.discard.push(card);
  return card;
}
function useJiushiAsJiu(g, me){
  if(!me || !hasCap(me,'jiushi') || me.faceup===false) return null;
  me.faceup=false;
  markSkillSound(g, '酒诗');
  return {name:'酒', virtual:true};
}
function finishDyingRescueCard(g,responderSeat,card,asText,soundName,isJijiu){
  if(!g.pending||g.pending.type!=='dying') return;
  const dyingSeat=g.pending.seat;
  const me=g.players[responderSeat], dyingP=g.players[dyingSeat];
  if(!me||!me.alive||!dyingP||!dyingP.alive) return;
  const recovery=peachRecoveryAmount(g,responderSeat,dyingSeat);
  dyingP.hp=Math.min(dyingP.maxHp,dyingP.hp+recovery);
  if(typeof recordBotRescueEvidence==='function') recordBotRescueEvidence(g,responderSeat,dyingSeat);
  g.log=pushLog(g.log,me.name+' 对 '+dyingP.name+' '+asText+',回复'+recovery+'点体力（体力'+dyingP.hp+'）');
  removeBuquCard(g,dyingSeat);
  if(hasCap(dyingP,'enyuan')&&responderSeat!==dyingSeat){
    ensureDeck(g); drawN(g,responderSeat,1);
    g.log=pushLog(g.log,dyingP.name+' 回复1点体力,'+me.name+' 发动【恩怨】效果,摸一张牌');
  }
  if(isJijiu) markSkillSound(g,'急救');
  markCardSound(g,soundName,responderSeat,card,dyingSeat);
  if(dyingP.hp>0) finishDying(g,false);
}
function respondDying(useTao, jijiuChoice){
  tx(g=>{
    if(g.phase!=='dying'||!g.pending||g.pending.type!=='dying') return g;
    const me=g.players[mySeat];
    if(!me || !me.alive || g.pending.asking!==mySeat) return g;
    const dyingPending=g.pending;
    const dyingP=g.players[dyingPending.seat];
    
    // 辅诩【完杀】：检查是否受到完杀限制
    if(useTao && g.wanshaActive && g.wanshaDyingSeat === g.pending.seat) {
      const jiaxuSeat = Number.isInteger(g.turn) && g.players[g.turn] && g.players[g.turn].alive && hasCap(g.players[g.turn],'wansha') ? g.turn : null;
      if (jiaxuSeat !== null) {
        // 只有贾诩和濒死角色自己可以使用桃
        if (mySeat !== jiaxuSeat && mySeat !== g.pending.seat) {
          g.log = pushLog(g.log, me.name + ' 因【完杀】效果,不能对 ' + dyingP.name + ' 使用【桃】');
          return g; // 不能使用桃，直接返回
        }
      }
    }
    
    if(useTao){
      let card;
      let asText = '';
      let soundName = '桃';
      if(jijiuChoice && jijiuChoice.kind==='jiu'){
        if(g.pending.seat!==mySeat) return g;
        card=useDyingJiuCard(g, me);
        if(!card) return g;
        asText='使用【酒】';
        soundName='酒';
      } else if(jijiuChoice && jijiuChoice.kind==='jiushiJiu'){
        if(g.pending.seat!==mySeat) return g;
        card=useJiushiAsJiu(g, me);
        if(!card) return g;
        asText='发动【酒诗】,视为使用【酒】';
        soundName='酒';
      } else if(jijiuChoice){
        card=useJijiuCard(g, me, jijiuChoice);
        if(!card) return g;
        asText='打出【'+card.name+'】当【桃】';
      } else {
        const idx=findUsableAs(me.hand, me, '桃'); // 复用 canUseAs/findUsableAs seam,不硬编码牌名
        if(idx<0) return g; // 没有桃:状态不变(双重保险,按钮本就不该出现)
        card=removeHandCards(g, mySeat, idx)[0]; g.discard.push(card);
        asText='打出【'+card.name+'】';
      }
      const isJijiu=!!(jijiuChoice&&jijiuChoice.kind!=='jiu'&&jijiuChoice.kind!=='jiushiJiu');
      if(g.pending!==dyingPending&&g.pending){
        g.pending.resume={type:'dyingJijiu',dyingPending,responderSeat:mySeat,card,asText,soundName,isJijiu};
        return g;
      }
      finishDyingRescueCard(g,mySeat,card,asText,soundName,isJijiu);
      return g;
    }
    g.log=pushLog(g.log, me.name+'：不使用【桃】');
    const nxt=nextDyingAskee(g, g.pending.seat, mySeat);
    if(nxt===null){ finishDying(g, true); return g; }
    g.pending.asking=nxt;
    setResponseAskedAt(g.pending); // A1:切换被问者即重新计时
    g.log=pushLog(g.log, '询问 '+g.players[nxt].name+' 是否对 '+dyingP.name+' 使用【桃】…');
    return g;
  });
}
function jiushiUseJiu(){
  tx(g=>{
    if(g.phase!=='play'||g.turn!==mySeat) return g;
    const me=g.players[mySeat];
    if(!me || !me.alive || !hasCap(me,'jiushi') || me.faceup===false || g.jiuUsed) return g;
    me.faceup=false;
    me.jiuShaBonus=true;
    g.jiuUsed=true;
    g.log=pushLog(g.log, me.name+' 发动【酒诗】,翻面并视为使用一张【酒】,本回合下一张【杀】伤害+1');
    markSkillSound(g, '酒诗');
    markCardSound(g, '酒', mySeat, {name:'酒', virtual:true});
    return g;
  });
}
function useNiepan(){
  tx(g=>{
    if(g.phase!=='dying'||!g.pending||g.pending.type!=='dying'||g.pending.seat!==mySeat) return g;
    const me=g.players[mySeat];
    if(!me || !me.alive || !hasCap(me,'niepan') || me.nirvanaUsed) return g;
    const equipCards = EQUIP_SLOTS.map(s=> me.equips && me.equips[s]).filter(Boolean);
    const delayCards = me.delays || [];
    if((me.hand||[]).length) g.discard.push(...me.hand);
    if(equipCards.length) g.discard.push(...equipCards);
    if(delayCards.length) g.discard.push(...delayCards);
    me.hand=[];
    me.equips=emptyEquips();
    me.delays=[];
    me.chained=false;
    me.faceup=true;
    me.turnedOver=false;
    me.nirvanaUsed=true;
    const hpBefore = me.hp;
    me.hp=Math.min(me.maxHp, 3);
    if(me.hp>hpBefore) removeBuquCard(g,mySeat);
    drawN(g, mySeat, 3);
    g.log=pushLog(g.log, me.name+' 发动限定技【涅槃】,弃置所有牌,复原武将牌,摸3张牌并回复至'+me.hp+'点体力');
    markSkillSound(g, '涅槃');
    finishDying(g, false);
    return g;
  });
}
// respondBuqu: 周泰【不屈】选择响应。选择放置或不放置不屈牌。
// remaining:本次伤害"体力降到0或以下"一共触发了几次(见 dealDamage 的 overkillPoints
// 推导),每次响应(不管选择放置还是不放置)只消耗一次机会——每一点独立算一次询问,不是
// "选一次不发动就等于放弃剩下所有次数"。三种收尾路径:①放置后点数全部唯一→立即回复
// 体力、接回原流程,不管 remaining 是否还有剩余,直接结束(体力已经回正,没有继续问的意义);
// ②remaining 消耗完(减到0)仍未防死→进入 startDying 濒死流程;③期间牌堆耗尽(拿不出下一
// 张不屈牌)→同样直接进入濒死流程,不强行继续问。
function respondBuqu(useBuqu){
  tx(g=>{
    if(g.phase!=='buquAsk'||!g.pending||g.pending.type!=='buquAsk') return g;
    const me=g.players[mySeat];
    if(!me || !me.alive || g.pending.seat!==mySeat) return g;

    const seat = g.pending.seat;
    const p = g.players[seat];
    // 走 hasCap,不硬编码武将 id(断肠后 skillsLost 也会正确失效)
    if(!p || !p.alive || !hasCap(p, 'buqu')) return g;

    const resume = g.pending.resume || {type:'sha'};
    const remaining = Number.isInteger(g.pending.remaining) ? g.pending.remaining : 1;
    if(useBuqu && (g.deck || []).length > 0) {
      // 从牌堆顶放置一张不屈牌
      ensureDeck(g);
      if((g.deck || []).length === 0){
        g.log = pushLog(g.log, p.name+' 牌堆为空,无法发动【不屈】');
      } else {
        const card = g.deck.pop();
        if(!Array.isArray(p.buquCards)) p.buquCards = [];
        p.buquCards.push(card);
        g.log = pushLog(g.log, p.name+' 发动【不屈】,放置了一张不屈牌（'+card.name+' '+card.suit+card.rank+'）');
        markSkillSound(g, '不屈');

        // 检查防死条件:所有不屈牌点数都唯一
        const allUnique = checkBuquUnique(p);
        if(allUnique) {
          // 防止死亡：体力设置为0,接回原伤害流程(不可硬写 phase=play 丢 resume)
          // 体力已经回正,不需要再问剩余的 remaining 次(即使这次伤害本该还问几次)。
          p.hp = 0;
          g.log = pushLog(g.log, p.name+' 所有不屈牌点数唯一,防止死亡（体力设为0）');
          g.pending = null;
          if(checkWin(g)) return g;
          resumeAfterInterrupt(g, resume, seat);
          return g;
        }
        // 放置了不屈牌但防死条件不满足,继续进入濒死流程(或继续问下一次,见下方)
        g.log = pushLog(g.log, p.name+' 发动【不屈】但防死条件不满足');
      }
    } else {
      g.log = pushLog(g.log, p.name+' 选择不发动【不屈】');
    }

    // 这一点没能防死(选择不发动 / 放置了但点数不唯一 / 牌堆空拿不出牌):这次伤害如果还有
    // 剩余的"降到0以下"次数、且牌堆还有牌,继续问下一次;否则(次数问完或牌堆已耗尽)才真正
    // 进入濒死流程——startDying 自己会写 g.pending=dying,绝不可在其后 g.pending=null 覆盖掉。
    const remainingAfter = remaining - 1;
    if(remainingAfter > 0 && (g.deck || []).length > 0) {
      g.pending = { type:'buquAsk', seat, resume, remaining: remainingAfter };
      g.phase = 'buquAsk';
      g.log = pushLog(g.log, p.name+' 体力仍在0点以下,是否继续发动【不屈】,放置一张不屈牌…（还需询问 '+remainingAfter+' 次）');
      return g;
    }
    startDying(g, seat, resume.type, resume.sourceSeat, resume.amount);
    return g;
  });
}

// checkBuquUnique: 检查周泰的不屈牌是否所有点数都唯一
function checkBuquUnique(player) {
  const ranks = (player.buquCards || []).map(card => card.rank);
  const uniqueRanks = [...new Set(ranks)];
  return ranks.length === uniqueRanks.length && ranks.length > 0;
}

// removeBuquCard: 处理回复体力时移除一张不屈牌的逻辑
// 不屈状态下回复本身不改变体力，只移除一张不屈牌；最后一张移除后体力成为1。
function removeBuquCard(g, seat) {
  const p = g.players[seat];
  // 走 hasCap,不硬编码武将 id(断肠 skillsLost 后也不再移除)
  if(!p || !hasCap(p, 'buqu') || !p.buquCards || p.buquCards.length === 0) return false;
  
  // 移除最后一张不屈牌（从数组末尾移除）
  const removedCard = p.buquCards.pop();
  g.log = pushLog(g.log, p.name+' 回复体力,移除一张不屈牌（'+removedCard.name+' '+removedCard.suit+removedCard.rank+'）');
  
  // 调用者可能已先写入回复值；这里必须覆盖为不屈规则结果，不能在其上再 +1。
  if(p.buquCards.length === 0) {
    p.hp = Math.min(p.maxHp, 1);
    g.log = pushLog(g.log, p.name+' 移除最后一张不屈牌,体力恢复至1点');
    return true;
  }
  p.hp=0;
  return false;
}

// finishDying: 濒死解决(获救或真死)。真死时把原 dealDamage 里的"阵亡弃牌"逻辑搬到这里执行;
// 随后按 pending.resume.type 接回原来被 dealDamage 打断的那条流程的尾巴
// (respondShan/duelResponse/aoeRespond 各自原有的 checkWin+阶段推进逻辑,原样不变、只是延后到此刻执行)。
function finishDying(g, actuallyDied){
  const seat=g.pending.seat, resume=g.pending.resume;
  const p=g.players[seat];
  p.dying=false;
  
  // 贾诩【完杀】：清理完杀状态
  if (g.wanshaActive && g.wanshaDyingSeat === seat) {
    g.wanshaActive = false;
    g.wanshaDyingSeat = null;
    g.log = pushLog(g.log, `【完杀】效果结束`);
  }
  
  if(actuallyDied){
    p.alive=false;
    // 身份局:死亡翻开身份(主公本来就 revealed,再写无妨)
    if(g.gameMode==='identity' && p.role){
      p.roleRevealed = true;
      g.log = pushLog(g.log, p.name+' 的身份是【'+(ROLE_LABEL[p.role]||p.role)+'】');
    }
    // 阵亡:所有手牌 + 装备牌 + 判定区(延时锦囊)弃置进弃牌堆(标准规则),让牌回流、牌库不被抽干
    const equipCards = EQUIP_SLOTS.map(s=> p.equips && p.equips[s]).filter(Boolean);
    const delayCards = p.delays || [];
    const handCount = (p.hand||[]).length;
    if(handCount)          g.discard.push(...p.hand);
    if(equipCards.length)  g.discard.push(...equipCards);
    if(delayCards.length)  g.discard.push(...delayCards);
    p.hand = [];
    p.equips = emptyEquips(); // 四槽清空
    p.delays = [];            // 判定区清空
    const parts=[];
    if(handCount)          parts.push('弃置'+handCount+'张手牌');
    if(equipCards.length)  parts.push('弃置装备'+equipCards.map(c=>'【'+c.name+'】').join(''));
    if(delayCards.length)  parts.push('弃置判定区'+delayCards.map(c=>'【'+c.name+'】').join(''));
    g.log=pushLog(g.log, p.name+' 无人使用【桃】救援,阵亡！'+(parts.length?'（'+parts.join('，')+'）':''));
    // 阵亡弃装备刻意【不】触发 onLoseEquip 失去装备钩子(如枭姬):人已死,死亡结算不再发动常规技能。
    // ⚠️ 日后新增「主动卸载装备」入口时,记得在那里接入 triggerHook(g, seat, 'onLoseEquip', {count}),别漏了枭姬。

    // 身份局击杀奖惩(须在 checkWin 之前)。杀手=resume.sourceSeat(与断肠同源)。
    // onLoseEquip 可能挂起 pending(如旋风):终局 checkWin 优先;未终局则保留 hook pending。
    const killerForReward = resume && typeof resume.sourceSeat==='number' ? resume.sourceSeat : undefined;
    // 过场动画事件(武将死亡):于吉死→于吉以外玩家播 yuji1;杀手是于吉(于吉杀人)→于吉以外
    // 且存活玩家播 yuji0;左慈死→仅杀手播 zuoci0。优先级:左慈 > 于吉 > 阵营统一动画(用户
    // 指定)。同一次死亡可能命中多条(如于吉杀死左慈:yujiKill+zuociDeath),按优先级从低到高
    // 写入、最后一条(最高优先级)胜出,各客户端只播最后一条。
    if(p.general==='yuji') markMovieFx(g, 'yujiDeath', seat);
    if(typeof killerForReward==='number'){
      const killerP=g.players[killerForReward];
      if(killerP && killerP.general==='yuji') markMovieFx(g, 'yujiKill', killerForReward);
      if(p.general==='zuoci') markMovieFx(g, 'zuociDeath', killerForReward); // 左慈最优先,最后写
    }
    applyIdentityKillReward(g, seat, killerForReward);
    
    // 蔡文姬【断肠】：杀死你的角色失去所有武将技能(锁定技)
    // 技能查询走 getGeneral(player.general).caps,必须置 skillsLost 让 generalHasCap/hasCap/triggerHook 失效
    const killerSeat = resume.sourceSeat;
    if (hasCap(p, 'duanchang') && typeof killerSeat === 'number' && g.players[killerSeat]) {
      const killer = g.players[killerSeat];
      if (killer && killer.alive) {
        killer.skillsLost = true;
        killer.caps = {};
        if (killer.skills) killer.skills = [];
        g.log = pushLog(g.log, killer.name + ' 失去了所有武将技能（【断肠】效果）');
        markSkillSound(g, '断肠');
      }
    }
    
    // 李典【忘隙】致死造成侧：若 sourceSeat 是李典且 amount>0，在死亡结算后挂起 wangxiAsk
    if(typeof resume.sourceSeat==='number' && typeof resume.amount==='number' && resume.amount>0){
      const sourceP = g.players[resume.sourceSeat];
      if(sourceP && sourceP.alive && hasCap(sourceP, 'wangxi') && resume.sourceSeat !== seat){
        g.pending = { 
          type:'wangxiAsk', 
          seat: resume.sourceSeat,  // 李典是攻击者
          otherSeat: seat,          // 阵亡者
          death: true,               // 标记为致死情形
          amount: resume.amount,
          resume: {type: resume.type}
        };
        g.phase='wangxiAsk';
        g.log=pushLog(g.log, sourceP.name+' 是否发动【忘隙】…');
        return; // 返回，跳过后续的 resumeAfterInterrupt，等忘隙结算后再接回
      }
    }
  } else {
    g.log=pushLog(g.log, p.name+' 脱离濒死！');
  }
  // 死亡路径上奖惩/钩子可能已把 g.pending 从 dying 换成其它(旋风等);未终局须保留。
  const postDeathPending = (actuallyDied && g.pending && g.pending.type!=='dying') ? g.pending : null;
  if(checkWin(g)) return; // checkWin 会清 pending/aoe
  if(postDeathPending){
    g.pending = postDeathPending;
    return;
  }
  g.pending=null;
  resumeAfterInterrupt(g, resume, seat);
}
// respondWangxi: 李典【忘隙】技能的响应函数
// activate=true: 发动，双方各摸 amount 张（若 death=false）或仅李典摸（若 death=true）
// activate=false: 不发动，接回 resume 流程
function respondWangxi(activate){
  tx(g=>{
    if(g.phase!=='wangxiAsk'||!g.pending||g.pending.type!=='wangxiAsk') return g;
    if(g.pending.seat!==mySeat) return g;
    const me=g.players[mySeat];
    if(!me || !me.alive) return g;
    
    const {seat, otherSeat, death, amount, resume}=g.pending;
    const otherP = g.players[otherSeat];
    
    if(activate){
      g.log=pushLog(g.log, me.name+' 发动【忘隙】');
      markSkillSound(g, '忘隙');
      
      // 若 death=false: 双方各摸 amount 张
      if(!death && otherP && otherP.alive){
        drawN(g, seat, amount);
        drawN(g, otherSeat, amount);
        g.log=pushLog(g.log, me.name+' 和 '+otherP.name+' 各摸了'+amount+'张牌');
      }
      // 若 death=true: 仅李典（seat）摸 amount 张
      else if(death && me.alive){
        drawN(g, seat, amount);
        g.log=pushLog(g.log, me.name+' 摸了'+amount+'张牌');
      }
      
      g.pending=null;
      if(checkWin(g)) return g;
      if(startNextWangxi(g, resume)) return g;
      resumeAfterInterrupt(g, resume, seat);
      return g;
    }
    
    // 不发动
    g.log=pushLog(g.log, me.name+'：不发动【忘隙】');
    g.pending=null;
    if(checkWin(g)) return g;
    if(startNextWangxi(g, resume)) return g;
    resumeAfterInterrupt(g, resume, seat);
    return g;
  });
}

// resumeAfterInterrupt: "临时打断了原有流程、事后要接回被打断那条流程尾巴"这类场景的统一
// 出口——目前有两个来源会走到这里:①濒死解决(finishDying,可能真死也可能被救回);
// ②郭嘉【遗计】的可选发动结算完毕(不会死人,但同样需要接回被打断的流程)。两者的 resume
// 结构完全一致(`{type:srcType,...}`,取值就是 dealDamage 的 srcType 参数,'delay'/'xiaoguo'
// 需要额外字段,由各自的挂起入口负责补全——见 continueDelayResolution/finishGuicai 的
// delayJudge 分支/respondXiaoguoChoice),seat 是被打断的那个人(dealDamage 的 seat 参数,
// 也就是 resume.type==='sha'/'duel'/'aoe' 时这里需要的那个座位号)。
function resumeAfterInterrupt(g, resume, seat){
  if(resume && resume.type==='afterDamageEffects'){
    if(consumePendingHookQueue(g,resume)) return;
    const q=g.afterDamageEffects;
    const originalResume=q&&q.originalResume ? q.originalResume : {type:'sha'};
    const damagedSeat=q&&Number.isInteger(q.seat) ? q.seat : seat;
    if(continueAfterDamageEffects(g)) return;
    resumeAfterInterrupt(g,originalResume,damagedSeat);
    return;
  }
  if(startNextWangxi(g, resume)) return;
  if(consumePendingHookQueue(g, resume)) return;
  // 连环中的某名角色刚完成濒死/技能询问：先继续剩余传导目标，整条传导结束后才接回
  // 最初那次杀、火攻、闪电等流程。
  if(g.chainDamageQueue){
    const q=g.chainDamageQueue;
    if(!q.finalResume) q.finalResume=resume;
    if(advanceChainedDamage(g)) return;
    const finalResume=q.finalResume || resume;
    const originalSeat=q.originalSeat;
    g.chainDamageQueue=null;
    resumeAfterInterrupt(g,finalResume,originalSeat);
    return;
  }
  if(resume.type==='ganglie'){
    resumeAfterInterrupt(g, resume.resume, resume.seat);
  } else if(resume.type==='tianxiang'){
    finishTianxiangTransfer(g, resume.originalResume, resume.originalSeat, resume.drawSeat);
  } else if(resume.type==='zhengyi'){
    resumeAfterInterrupt(g, resume.originalResume, resume.originalSeat);
  } else if(resume.type==='duel'){
    // 这一行显式清空【不能】删掉、不能只依赖 pruneExchangeCards 的通用兜底规则(!pending&&!aoe)——
    // 已经用真实场景实测验证过:如果这里死的正是当前回合玩家(g.turn),下面 startTurn(nextAlive)
    // 换到下家时,如果下家恰好有许褚【裸衣】(luoyi 能力),startTurn 内部的
    // continueEnterDrawPhase 会在【同一个 tx 里】紧接着给下家开一个新的 luoyiAsk 询问——
    // 也就是说,这次 tx 提交时 g.pending 已经又变成非空(luoyiAsk,和这场决斗毫无关系)。
    // 通用兜底规则只看"现在全局是否空闲",这种情况下会判断"还没空闲"而不清空,导致已经结束的
    // 决斗展示会残留到下家的裸衣询问也问完为止——粒度太粗,抓不住"这条链具体在哪一刻结束"这个
    // 更精确的时机。这行放在 startTurn 调用之前,保证清空发生在"决斗真正结束"这一刻,不受
    // 它之后可能紧跟着冒出来的、完全不相关的新询问影响。
    g.exchangeCards=[];
    if(!g.players[g.turn].alive){
      startTurn(g, nextAlive(g, g.turn));
    } else {
      g.phase='play';
    }
  } else if(resume.type==='aoe'){
    aoeAdvance(g, seat);
  } else if(resume.type==='delay'){
    // 判定区的牌(如闪电)致命挂起后的接回:真死了就换到下一个存活玩家的回合(该玩家的判定阶段
    // 从头 startTurn);被桃救回(或郭嘉遗计这种非致命打断)就继续处理这位玩家判定区剩余的牌
    // (可能再次挂起濒死或鬼才或遗计,机制天然支持连续多次——具体怎么继续、怎么区分新挂起的
    // 类型,见 continueDelayResolution)。
    // CORE-92(issue #139)崩溃修复:resume.seat 可能是 undefined,必须回退到 seat 参数。
    // 【怎么发生的】dealDamage 建 afterDamageEffects 队列时写的是
    // `originalResume:{type:srcType}`(两处,致命分支和存活分支)——它只有 srcType 这个
    // 字符串,**不知道 seat 是谁**(这一点在 game.js 另外三处注释里早有记载:"resume 只有
    // {type:'delay'},这里要补上 seat")。那三处补丁只覆盖了 dying/yijiAsk 这类挂起路径;
    // 走 afterDamageEffects 队列时,resumeAfterInterrupt(g, originalResume, damagedSeat)
    // 把正确的座位放在**第三个参数**里传了进来,但这个分支只读 resume.seat、完全没用那个
    // 参数,于是 `g.players[undefined].alive` 直接 TypeError 崩掉整局。
    // 【为什么回退到 seat 是对的】delay 类伤害(闪电)的受伤者就是判定区的主人本人,
    // dealDamage 传进来的 damagedSeat 与"该继续处理谁的判定区"恒等。
    // 【为什么不在源头 originalResume 上补 seat】那会给所有 srcType('sha'/'duel'/'aoe'/
    // 'kurou'…)的 resume 都塞上一个 seat 字段,而别的分支对 resume.seat 有各自的语义
    // (见 3539/3611 行),平白改变它们的输入形状风险更大;在这个只属于 delay 的分支里
    // 回退到本来就已经正确传进来的参数,影响面最小。
    // 【怎么发现的】issue #139 新建的 E 层(确定性LLM压测)随机对局里崩出来的——
    // 触发链是"延时锦囊伤害 → 濒死 → 被桃救回 → finishDying → afterDamageEffects 队列
    // 接回",需要几个低概率条件同时凑齐,现有 FFA soak 与常规单元测试都没覆盖到。
    const delaySeat = Number.isInteger(resume.seat) ? resume.seat : seat;
    if(!g.players[delaySeat] || !g.players[delaySeat].alive){
      startTurn(g, nextAlive(g, delaySeat));
    } else {
      continueDelayResolution(g, delaySeat);
    }
  } else if(resume.type==='xiaoguo'){
    // 骁果"受到1点伤害"选项致命挂起(或遗计这种非致命打断)后的接回:不管目标是否真死,都
    // 继续找下一个有资格的候选乐进(或最终真正切换回合)——resume 在 respondXiaoguoChoice
    // 里已经带上完整信息。
    advanceXiaoguo(g, resume.endingSeat, resume.lastAsker);
  } else if(resume.type==='kurou'){
    // 黄盖【苦肉】主动自伤后的接回:若濒死被救回,继续摸两张;若真死且游戏未结束,轮到下个存活玩家。
    if(!g.players[seat] || !g.players[seat].alive){
      startTurn(g, nextAlive(g, seat));
    } else {
      drawN(g, seat, 2);
      g.log=pushLog(g.log, g.players[seat].name+' 【苦肉】结算,摸两张牌');
      g.phase='play';
    }
  } else if(resume.type==='quhu' || resume.type==='fanjian' || resume.type==='sanyao'){
    // 马谡【散谣】和驱虎/反间同一形状:发动者在自己的出牌阶段对(可能是别人的)某个目标造成
    // 伤害,伤害本身没有额外尾巴要做,只需要按"当前回合玩家(不是伤害目标)是否还活着"正确
    // 收尾——伤害目标死的若不是回合玩家,回合并不切换,继续留在原发动者的出牌阶段。
    if(g.players[g.turn] && g.players[g.turn].alive) g.phase='play';
    else startTurn(g, nextAlive(g, g.turn));
  } else if(resume.type==='guanshiDamage'){
    // 贯石斧(weapons.js)弃自己装备触发 onLoseEquip 钩子(如凌统旋风)中途打断后的接回:
    // 问完之后继续走原本被打断的、贯石斧强制命中的伤害结算。
    finishGuanshiDamage(g, resume.from, resume.to, resume.sourceCard, resume.jiuBonus);
  } else if(resume.type==='sanyaoDamage'){
    // 散谣的弃装备成本触发 onLoseEquip 钩子(如凌统旋风)中途打断后的接回:问完之后继续走
    // 原本被打断的伤害结算。当前项目里马谡自己没有 onLoseEquip 钩子,这条分支实际不可达
    // (一人只能是一个武将,不可能同时是马谡又是凌统/孙尚香),按"新增失去装备入口必须正确
    // 接 resume"这条强制约定补上,面向正确性,不是修一个能被打的漏洞。
    finishSanyaoDamage(g, resume.casterSeat, resume.target);
  } else if(resume.type==='leiji'){
    // 张角【雷击】2点雷电伤害致濒死(或触发仁心/制蛮等其它onDamaged打断)后的接回——不需要
    // 新逻辑,直接复用 finishLeijiChain(和判定完毕后正常收尾的那个函数完全一样):它只看
    // g.leijiResume(4/4引入的、独立于g.pending之外的字段,濒死这整段打断期间不会被碰到)
    // 决定该恢复到 aoeAdvance 续接(雷击是从南蛮/万箭响应里触发的)还是直接回到 play
    // (respondShan单体响应触发的普通场景),和雷击自己判完黑桃之后本该走的收尾完全一致。
    finishLeijiChain(g);
  } else if(resume.type==='enyuan'){
    // 恩怨反伤致死后接回原伤害流程
    resumeAfterInterrupt(g, resume.resume || {type:'sha'}, resume.seat);
  } else if(resume.type==='huanhuoTransfer'){
    enterHuanhuoTransfer(g, resume.sourceSeat, resume.firstTargetSeat, resume.transferCardId);
  } else if(resume.type==='luanwu'){
    // 乱武失体力濒死接回(杀路径走 luanwuResume + finishSingleShaTarget)
    if(g.luanwuResume) continueLuanwuAfterSha(g);
    else g.phase='play';
  } else if(resume.type==='shaOffset'){
    // 【v2】猛进(庞德拆装备)触发的失去装备钩子(如凌统旋风)打断后的接回。v1 曾经统一走
    // {type:'sha'},只接回 finishSingleShaTarget 这段尾巴,会跳过猛进之后本该继续检查的
    // 青龙偃月刀"再来一杀"/贯石斧——这是 v2 的修复点。这里不需要在 resume 里额外保存一份
    // "打断前算好的候选列表"快照:canStartQinglong/canStartGuanshifu 只依赖攻击者(from)
    // 自己当前的状态,和旋风打断的是目标(to)的装备完全无关,打断前后判断结果恒定一致,直接
    // 重新调用即可,不会因为"数据过期"算错。remainingAvailable 固定传
    // ['qinglong','guanshifu'](mengjin 已经处理完,不会再出现在候选里,和两个注入点未被
    // 打断时的既有写法逐字一致);continueShaOffsetEffects 内部自己会重新过滤掉已经不成立
    // 的选项,两者都不成立时自动等价于原来 {type:'sha'} 的收尾(finishSingleShaTarget),
    // 不需要在这里分别判断"有没有青龙"。
    continueShaOffsetEffects(g, resume.from, resume.to, resume.sourceCard, ['qinglong','guanshifu'], resume.jiuBonus);
  } else if(resume.type==='liuliAfterDiscard'){
    // 流离用装备支付后，失装技能（如旋风）先取得控制权；完成后再从这里继续转移后的杀。
    // CORE-93(issue #140):和 respondLiuli 的直达路径同一个修复——这次结算的仍然是流离
    // 已经转移完毕的那张杀,距离合法性早由 liuliTargets() 按大乔自己的攻击范围校验过,
    // 不能再走 resolveShaUseNoLiuli 默认的"攻击者→目标"距离校验,传 {noDistance:true}。
    const attacker=g.players[resume.from];
    const target=g.players[resume.newTargetSeat];
    if(attacker&&attacker.alive&&target&&target.alive){
      resolveShaUseNoLiuli(g,attacker,resume.newTargetSeat,resume.usedAs,resume.shaColor,resume.sourceCard,{noDistance:true});
    }else finishSingleShaTarget(g);
  } else if(resume.type==='dyingJijiu'){
    // 急救用红色装备触发失装技能后，恢复原 dying 快照，再完成这张牌的回复结算。
    g.pending=resume.dyingPending;
    g.phase='dying';
    finishDyingRescueCard(g,resume.responderSeat,resume.card,resume.asText,resume.soundName,resume.isJijiu);
  } else if(resume.type==='hanbing'){
    // 寒冰剑弃装备触发失装技能后，从下一次弃牌继续；不重复弃刚处理的牌。
    startHanbingRound(g,resume.from,resume.to,resume.round);
  } else { // 'sha' 及其它
    if(g.fangtianQueue){ advanceFangtianQueue(g); }
    else if(g.luanwuResume){ continueLuanwuAfterSha(g); }
    // CORE-112:回到出牌阶段之前必须确认当前回合玩家(g.turn)还活着——'sha'是最常见的
    // resume类型,涵盖绝大多数杀的响应/结算收尾;如果这张杀的伤害链条(或途中触发的任意
    // 打断)导致回合玩家自己死亡(比如反伤/连锁效果致命),旧代码在这里无条件写
    // g.phase='play',回合永远不会推进到下一个存活玩家,机器人/UI都对着一个死人的出牌
    // 阶段卡死。同一份修复上面 duel/delay/kurou/quhu/fanjian/sanyao 等resume分支早就在
    // 做(`if(!g.players[g.turn].alive){ startTurn(g,nextAlive(g,g.turn)); }`),这里
    // 补齐同一套既有写法,不是新发明的模式——只是default分支被漏掉了。真实用soak.js压测
    // 复现过(卡在 stuck@play:null,g.turn 指向的座位 alive:false)。
    else if(!g.players[g.turn] || !g.players[g.turn].alive){ startTurn(g, nextAlive(g, g.turn)); }
    else { g.phase='play'; }
  }
}
// ===== 夏侯惇【刚烈】:受伤后可选判定,非红桃则伤害来源弃2手牌或受1点伤害 =====
function finishGanglie(g, resume, seat){
  g.pending=null;
  if(checkWin(g)) return;
  resumeAfterInterrupt(g, resume, seat);
}
function dealGanglieDamage(g, seat, sourceSeat, resume){
  const source=g.players[sourceSeat];
  const self=g.players[seat];
  if(!source || !source.alive || !self || !self.alive){
    finishGanglie(g, resume, seat);
    return;
  }
  g.pending=null;
  const interrupted=dealDamage(g, sourceSeat, 1, seat, '【刚烈】', 'ganglie');
  if(interrupted){
    setInterruptedDamageResume(g,{type:'ganglie', resume, seat});
    return;
  }
  if(checkWin(g)) return;
  resumeAfterInterrupt(g, resume, seat);
}
function finishGanglieJudge(g, card, seat, sourceSeat, resume){
  const self=g.players[seat];
  const source=g.players[sourceSeat];
  if(card) maybeTiandu(g, seat, card);
  if(card && card.suit==='♥'){
    g.log=pushLog(g.log, (self?self.name:'夏侯惇')+' 【刚烈】判定为红桃,无事发生');
    finishGanglie(g, resume, seat);
    return;
  }
  if(!source || !source.alive){
    g.log=pushLog(g.log, (self?self.name:'夏侯惇')+' 【刚烈】判定不为红桃,但伤害来源已不存在');
    finishGanglie(g, resume, seat);
    return;
  }
  if((source.hand||[]).length<2){
    g.log=pushLog(g.log, source.name+' 手牌不足2张,必须受到【刚烈】伤害');
    dealGanglieDamage(g, seat, sourceSeat, resume);
    return;
  }
  g.pending=setResponseAskedAt({type:'ganglieChoice', seat, sourceSeat, resume});
  g.phase='ganglieChoice';
  g.log=pushLog(g.log, source.name+' 需选择弃置2张手牌或受到1点【刚烈】伤害');
}
function respondGanglieAsk(activate){
  tx(g=>{
    if(g.phase!=='ganglieAsk'||!g.pending||g.pending.type!=='ganglieAsk'||g.pending.seat!==mySeat) return g;
    const {seat, sourceSeat, resume}=g.pending;
    const self=g.players[seat];
    if(!activate){
      g.log=pushLog(g.log, self.name+'：不发动【刚烈】');
      finishGanglie(g, resume, seat);
      return g;
    }
    g.log=pushLog(g.log, self.name+' 发动【刚烈】');
    markSkillSound(g, '刚烈');
    const card=judge(g);
    if(!card){
      finishGanglie(g, resume, seat);
      return g;
    }
    if(maybeGuicai(g, seat, card, {kind:'ganglieJudge', seat, sourceSeat, resume})==='pending') return g;
    finishGanglieJudge(g, card, seat, sourceSeat, resume);
    return g;
  });
}
function respondGanglieChoice(action, picks){
  tx(g=>{
    if(g.phase!=='ganglieChoice'||!g.pending||g.pending.type!=='ganglieChoice'||g.pending.sourceSeat!==mySeat) return g;
    const {seat, sourceSeat, resume}=g.pending;
    const source=g.players[sourceSeat];
    if(!source || !source.alive){
      finishGanglie(g, resume, seat);
      return g;
    }
    if(action==='discard'){
      if(!Array.isArray(picks) || picks.length!==2 || new Set(picks).size!==2 || (source.hand||[]).length<2) return g;
      const idxs=picks.map(x=>Number(x));
      if(idxs.some(x=>!Number.isInteger(x) || x<0 || x>=source.hand.length)) return g;
      const discarded=removeHandCards(g, sourceSeat, idxs);
      g.discard.push(...discarded);
      markDiscardReveal(g, sourceSeat, discarded);
      g.log=pushLog(g.log, source.name+' 弃置2张手牌,抵消【刚烈】伤害');
      finishGanglie(g, resume, seat);
      return g;
    }
    if(action==='damage'){
      dealGanglieDamage(g, seat, sourceSeat, resume);
    }
    return g;
  });
}

// ===== 华雄【耀武】选择响应 =====
function respondYaowu(choice) {
  tx(g => {
    if (g.phase !== 'yaowu_choose' || !g.pending || g.pending.type !== 'yaowu_choose' || g.pending.seat !== mySeat) return g;
    const { seat: chooserSeat, target, resume } = g.pending;
    const chooser = g.players[chooserSeat];
    const huaxiong = g.players[target];
    
    if (!chooser || !chooser.alive) {
      g.pending = null;
      if (checkWin(g)) return g;
      resumeAfterInterrupt(g, resume || {type:'sha'}, target);
      return g;
    }
    
    if (choice === 'recover') {
      chooser.hp = Math.min(chooser.maxHp, chooser.hp + 1);
      g.log = pushLog(g.log, chooser.name + ' 因【耀武】回复1点体力（体力' + chooser.hp + '）');
      removeBuquCard(g, chooserSeat);
      markSkillSound(g, '耀武');
    } else if (choice === 'draw') {
      drawN(g, chooserSeat, 1);
      g.log = pushLog(g.log, chooser.name + ' 因【耀武】摸一张牌');
      markSkillSound(g, '耀武');
    }
    
    // 耀武发生在扣血之后、且仅存活时挂起;接回原伤害流程尾巴
    g.pending = null;
    if (checkWin(g)) return g;
    resumeAfterInterrupt(g, resume || {type:'sha'}, target);
    return g;
  });
}

// ===== 方天画戟/短兵:队列驱动的多目标杀,共用出口 =====
// finishSingleShaTarget: 一个目标的杀响应/判定彻底结束时统一走这里(毅重/仁王盾无效、八卦阵/鬼才改判
// 红色抵消、respondShan 出闪或命中受伤后的共用尾巴,均改走这个出口)——先 checkWin,再看 g.fangtianQueue
// 是否还有排队中的下一个目标,有则继续,没有(或本来就不是方天画戟触发的)才真正回到出牌阶段。

// 乱武中某次杀(完整 resolveShaUse 路径)结算完毕后接回"问下一个人"

// advanceFangtianQueue: 推进到多目标杀队列里的下一个目标,重新走一遍完整的 resolveShaUse(毅重/仁王盾/
// 铁骑/烈弓/青釭剑/八卦阵/响应阶段全部照常各自独立判定)。跳过中途已阵亡的排队目标(防御性,理论上
// 现有效果里没有会让排队目标之间互相致死的连锁,但仍做兜底)。问完/没有更多目标则清空队列回到出牌阶段。
function advanceFangtianQueue(g){
  const q=g.fangtianQueue;
  q.idx++;
  while(q.idx<q.targets.length && (!g.players[q.targets[q.idx]] || !g.players[q.targets[q.idx]].alive)) q.idx++;
  // CORE-112:同 finishSingleShaTarget 收尾处的同一条修复——方天画戟队列问完最后一个
  // 目标、回到出牌阶段时也要同步清空 g.pending,理由和触发路径完全相同(最后一个目标
  // 的杀链中途可能挂着 tieqi/liegong 这类未清空的过期 pending)。
  if(q.idx>=q.targets.length){ g.fangtianQueue=null; g.pending=null; g.phase='play'; return; }
  q.shaInfo=null;
  resolveShaUse(g, g.players[q.from], q.targets[q.idx], q.usedAs, q.shaColor, q.sourceCard, undefined);
}
// checkWin: 乱斗=存活<=1;身份局=阵营胜负(见 identity 规格)。
// 返回 true 表示已结束游戏。
function checkWin(g){
  if(g.gameMode==='team'){
    // 组队模式:存活队伍数 ≤1 结束;=1 该队胜,=0 无胜者(最后两队同时团灭)
    const aliveTeams = {};
    (g.players||[]).forEach(p=>{ if(p && p.alive && Number.isInteger(p.team)) aliveTeams[p.team]=true; });
    const teamKeys = Object.keys(aliveTeams);
    if(teamKeys.length<=1){
      g.phase='over';
      g.winSide = null;
      g.winner = teamKeys.length===1 ? ('队伍'+(Number(teamKeys[0])+1)) : '无';
      g.pending=null; g.aoe=null;
      g.log=pushLog(g.log, '游戏结束,胜方：'+g.winner);
      return true;
    }
    return false;
  }
  if(g.gameMode==='identity'){
    const alivePred = (pred)=> (g.players||[]).some(p=>p && p.alive && pred(p));
    const lordAlive = alivePred(p=>p.role==='zhu');
    const fanAlive  = alivePred(p=>p.role==='fan');
    const neiAlive  = alivePred(p=>p.role==='nei');
    let winSide = null;
    if(!lordAlive){
      if(fanAlive) winSide = 'fan';
      else if(neiAlive) winSide = 'nei';
      else winSide = 'none'; // 主死且无反无内 → 无胜者
    } else if(!fanAlive && !neiAlive){
      winSide = 'lord';
    }
    if(!winSide) return false;
    g.phase='over';
    g.winSide = winSide;
    g.winner = ({fan:'反贼', nei:'内奸', lord:'主公与忠臣', none:'无'})[winSide];
    g.pending=null; g.aoe=null;
    // 结束时全员身份揭晓(规格§6.5):roleRevealed 唯一消费者是 canSeeRole,批量翻转后
    // 座位卡 .seat-identity 靠既有渲染自动展示全部身份色块,不需要新增任何UI组件。
    // 只在真正判定出胜负(上面 if(!winSide) 这道守卫已通过)之后才翻转,不会在游戏未结束
    // 的路径上提前泄露隐藏身份。
    g.players.forEach(p=>{ if(p) p.roleRevealed=true; });
    g.log=pushLog(g.log, '游戏结束，胜方：'+g.winner);
    // 过场动画事件(胜负结算):写一个 gameOver 结果表,各客户端按自己身份分派动画——
    // 反贼输播 fanze-lost / 反贼胜播 fanzei-win / 主公输播 zhuzhong-lost / 忠臣输播 han;
    // 左慈玩家所在阵营输则播 zuoci1(左慈最优先)。winSide='none' 无人胜,全员视为输。
    // 优先级:左慈 > 于吉(结算无) > 阵营统一动画(见 render.js movieVideoKeyForMe)。
    const fanRes  = winSide==='fan'  ? 'win' : 'lose';
    const lordRes = winSide==='lord' ? 'win' : 'lose';
    const zhongRes= winSide==='lord' ? 'win' : 'lose';
    const neiRes  = winSide==='nei'  ? 'win' : 'lose';
    const roleResOf = (role)=> role==='fan' ? fanRes : role==='zhu' ? lordRes : role==='zhong' ? zhongRes : role==='nei' ? neiRes : (winSide==='nei' ? 'win' : 'lose');
    let zuociLose = false;
    g.players.forEach(pp=>{ if(pp && pp.general==='zuoci' && roleResOf(pp.role)==='lose') zuociLose=true; });
    markMovieFx(g, 'gameOver', null, { fan:fanRes, lord:lordRes, zhong:zhongRes, nei:neiRes, zuociLose });
    return true;
  }
  if(aliveCount(g)<=1){
    const w=g.players.find(p=>p&&p.alive);
    g.phase='over'; g.winner = w?w.name:'无';
    g.winSide = null;
    g.pending=null; g.aoe=null;
    g.log=pushLog(g.log, '游戏结束,胜者：'+g.winner);
    return true;
  }
  return false;
}

// 身份局击杀奖惩(finishDying 死亡分支调用)。killerSeat 非数字/杀手已死 → 无奖惩。
// 主杀忠:弃手牌+装备,判定区保留;弃装触发 onLoseEquip。
function applyIdentityKillReward(g, victimSeat, killerSeat){
  if(g.gameMode!=='identity') return;
  const victim = g.players[victimSeat];
  if(!victim || !victim.role) return;
  if(typeof killerSeat!=='number') return;
  const killer = g.players[killerSeat];
  if(!killer || !killer.alive) return;
  if(victim.role==='fan'){
    drawN(g, killerSeat, 3);
    g.log = pushLog(g.log, killer.name+' 杀死反贼，摸三张牌');
    return;
  }
  if(victim.role==='zhong' && killer.role==='zhu'){
    const punishedCards = [];
    if((killer.hand||[]).length){
      punishedCards.push(...killer.hand);
      g.discard.push(...killer.hand);
      killer.hand = [];
    }
    let lost = 0;
    EQUIP_SLOTS.forEach(s=>{
      const card = killer.equips && killer.equips[s];
      if(card){
        punishedCards.push(card);
        g.discard.push(card);
        killer.equips[s] = null;
        lost++;
      }
    });
    markDiscardReveal(g, killerSeat, punishedCards);
    // 判定区保留 — 不碰 killer.delays
    if(lost) triggerHook(g, killerSeat, 'onLoseEquip', {count:lost});
    g.log = pushLog(g.log, killer.name+' 误杀忠臣，弃置所有手牌和装备');
  }
}
// 决斗中由当前 active 玩家响应：打出【杀】则把出杀义务交给对方；认输则受伤、决斗结束。
// duelResponse: 决斗响应。吕布【无双】(锁定技)是"跟吕布决斗的对方每轮需连续打出两张杀,
// 吕布自己始终只需一张"——不是"决斗涉及吕布,双方都要两张"。所以 needed 不能只看
// "决斗双方有没有人是吕布",必须看"当前正要出杀的这个人(mySeat)是不是吕布本人":
// 是吕布本人 -> 恒为1;不是吕布本人、且这场决斗的对方是吕布 -> 2;都不是吕布 -> 1。
// g.pending.shaCount 记这一轮已出几张,换人时归零重新计数。选择认输就按原逻辑直接受伤,已出的杀不退回。
function duelResponse(useSha, cardIdx){
  tx(g=>{
    if(g.phase!=='duel'||!g.pending||g.pending.active!==mySeat) return g;
    const me=g.players[mySeat];
    const opp=(mySeat===g.pending.from)?g.pending.to:g.pending.from;
    const needed = (!hasCap(me,'wushuang') && hasCap(g.players[opp],'wushuang')) ? 2 : 1;
    if(needed===2 && !(g.pending.shaCount||0)) markSkillSound(g,'无双');
    if(useSha){
      // 曹彰【将驰】选项1:本回合不能打出杀
      if(me.jiangchiNoSlash) return g;
      // cardIdx 是客户端"多候选选牌"传来的具体下标(可选):传了且服务端复核确实能当杀才采信,
      // 不合法就当没传、回退 findUsableAs——不盲信客户端下标(和 respondShan 同一套写法)。
      const specifiedCard = (typeof cardIdx==='number') ? (me.hand||[])[cardIdx] : null;
      const idx = (specifiedCard && canUseAs(me, specifiedCard, '杀')) ? cardIdx : findUsableAs(me.hand,me,'杀'); // 龙胆:闪可当杀,优先用本名杀
      if(idx<0) return g;
      const card=removeHandCards(g, mySeat, idx)[0]; g.discard.push(card);
      const played=(g.pending.shaCount||0)+1;
      g.log=pushLog(g.log, me.name+(isShaName(card.name)?' 打出【'+card.name+'】':' 打出【'+card.name+'】当【杀】')+(needed>1?'（'+played+'/'+needed+'）':''));
      markCardSound(g, '杀', mySeat, card, opp);
      if(card.name!=='杀'){ if(hasCap(me,'longdan')) markSkillSound(g,'龙胆'); else if(hasCap(me,'wusheng')) markSkillSound(g,'武圣'); }
      if(mySeat===g.turn) g.shaPlayedInDuel=true;
      if(played<needed){ g.pending.shaCount=played; return g; } // 吕布【无双】:这一轮还没出满,留在同一个人身上
      g.pending.active = (mySeat===g.pending.from)?g.pending.to:g.pending.from;
      g.pending.shaCount = 0; // 换人,计数归零重新开始
      return g;
    }
    // 认输：受伤
    // 刘备【激将】:主公需出杀且未用过主公技 → 先进入求助流程;无人替出则回原响应
    if(canTriggerLordAsk(g, mySeat, 'jijiang')){
      startLordAsk(g, mySeat, '杀', 'jijiang');
      return g;
    }
    // sourceSeat 传 opp(决斗中的对方),不能传 g.pending.from——认输的可能是发起者本人,
    // 那种情况下 sourceSeat 必须是对手而不是受害者自己,否则司马懿【反馈】等依赖伤害来源的技能会出错。
    const dying = dealDamage(g, mySeat, damageAmount(g, opp, 1, 'duel'), opp, '不出【杀】', 'duel', g.pending.sourceCard);
    if(dying) return g; // 濒死流程接管,后续(轮转/阶段)延后到 finishDying 处理
    g.pending=null;
    // 这行显式清空同样不能删——和 resumeAfterInterrupt 的 'duel' 分支是结构一致的风险:
    // 这里同样可能在 checkWin 之后走到 startTurn(nextAlive(...)),如果换到的下家恰好也有
    // 需要在回合开始时被问一次的能力(许褚裸衣等),同一个 tx 里会紧接着重新给 g.pending 赋值,
    // 让通用兜底规则(!pending&&!aoe)暂时失效。目前看这个分支需要"回合玩家在非致命伤害后
    // 仍处于阵亡状态"才会触及 startTurn,按现有调用链路(死亡统一走 startDying→finishDying→
    // resumeAfterInterrupt,不会绕回这里)基本不可达,但删掉它没有任何收益、保留没有任何代价,
    // 不确定就不删——理由和上面 resumeAfterInterrupt 那处完全一致,一并保留。
    g.exchangeCards=[];
    if(checkWin(g)) return g;
    // 若回合玩家在决斗中阵亡,直接换下家;否则回合玩家继续出牌阶段
    if(!g.players[g.turn].alive){
      startTurn(g, nextAlive(g, g.turn));
    } else {
      g.phase='play';
    }
    return g;
  });
}
// ===== 无懈可击：锦囊结算前,按座位顺序逐个询问每个存活玩家 =====
// nextAskee: 从 current 的下家起,按座位号找下一个存活、且非使用者的玩家;
// 扫描中遇到 from(使用者)即代表问完一圈,返回 null。跳过阵亡者。
function nextAskee(g, from, current){
  const n=g.players.length; // 按实际玩家数取模,支持 2 或 3 人
  for(let k=1;k<=n;k++){
    const s=(current+k)%n;
    if(s===from) return null;                       // 绕回使用者 = 问完一圈
    if(g.players[s] && g.players[s].alive) return s; // 跳过阵亡者
  }
  return null;
}
// nextDyingAskee: 濒死轮询专用的 nextAskee 包装——贾诩【完杀】生效期间(g.wanshaActive
// 且当前濒死者是 g.wanshaDyingSeat),只有贾诩本人和濒死者本人能被问是否用桃,中间那些
// "问了也白问"(respondDying 会直接拒绝)的座位直接跳过、不产生等待响应的 pending,
// 等价于他们自动选择不救。非完杀场景(或完杀未命中当前濒死者)行为与 nextAskee 完全一致。
function nextDyingAskee(g, dyingSeat, current){
  let nxt = nextAskee(g, dyingSeat, current);
  if(g.wanshaActive && g.wanshaDyingSeat === dyingSeat){
    const jiaxuSeat = Number.isInteger(g.turn) && g.players[g.turn] && g.players[g.turn].alive && hasCap(g.players[g.turn],'wansha') ? g.turn : null;
    if(jiaxuSeat !== null){
      while(nxt !== null && nxt !== jiaxuSeat && nxt !== dyingSeat){
        nxt = nextAskee(g, dyingSeat, nxt);
      }
    }
  }
  return nxt;
}
// startTrick: 锦囊牌已进弃牌堆后调用。初始化无懈询问轮次(exclude/depth 见 openWuxieRound 注释),
// 交给 openWuxieRound 统一处理"算下一个问谁/问不到人就直接收尾"。
function startTrick(g, info){
  if(info.trick==='桃园结义' || info.trick==='五谷丰登'){
    resolveTrick(g, info);
    return;
  }
  // card(可选):延时锦囊的物理牌对象,随 pending 透传,供 finishWuxieRound(被挡下→弃牌堆)/
  // resolveTrick(未被挡下→放进判定区)使用。seatB(可选):借刀杀人的第二个目标。
  // pool(可选):五谷丰登亮出的公共池。三者都只有各自那张牌会传,其它锦囊不传——
  // **不能直接把 info.card/info.seatB/info.pool 无条件塞进 pending**:大多数锦囊这几个字段
  // 都是 undefined,而 Firebase 的 transaction 规则是"返回值里任何字段显式为 undefined 就整个
  // 拒绝写入"(真实 bug:曾经这样写,导致过河拆桥/无中生有/决斗/顺手牵羊/桃园结义/延时锦囊
  // 放置/五谷丰登——所有经过 startTrick 的锦囊——第一次使用就被 Firebase 拒绝,界面上表现为
  // "点确定没反应",且这类 bug 只有真连 Firebase 才会触发,本地 stub 测试完全测不出来)。
  // 只在真的有值时才把这个 key 放进对象(而不是塞一个 undefined 值)。
  g.pending=setResponseAskedAt({type:'wuxie', trick:info.trick, from:info.from, to:info.to, exclude:info.from, depth:0});
  // 初始无懈窗口允许所有持有无懈的存活角色响应（包括锦囊使用者本人），并记录本层已问座位。
  // 桃园/五谷原先单独打开 askAll，而其它锦囊走另一套遍历，容易出现范围不一致；现在统一。
  g.pending.askAll=true;
  g.pending.askStart=info.from;
  g.pending.asked=[];
  if(info.card!==undefined) g.pending.card=info.card;
  if(info.sourceCard!==undefined) g.pending.sourceCard=info.sourceCard;
  if(info.seatB!==undefined) g.pending.seatB=info.seatB;
  if(info.pool!==undefined) g.pending.pool=info.pool;
  g.phase='wuxie';
  openWuxieRound(g);
}
// ===== 无懈可击可被无懈可击反制(不限层数)=====
// 核心洞察:原锦囊/该 AOE 目标最终是否生效,只取决于"无懈可击总共被成功打出了几次"的奇偶性
// (depth 为奇数=作废,偶数含0=正常生效),不需要记录"每一层反制了谁"的完整历史栈——
// 每一层只是把 g.pending 的 exclude(当前这轮不问谁,即刚打出上一次无懈的人)/depth(成功次数)
// 原地更新,再重新走一遍座位遍历,不存在真正的递归调用,不会有调用栈风险。
// openWuxieRound: (重新)计算这一轮该问谁;问不到人(exclude 是唯一存活者,极端边界)则直接收尾。
function openWuxieRound(g){
  const asking=nextWuxieAskee(g, g.pending);
  if(asking===null){
    // 无人持有无懈时也保留统一的短暂公共响应窗口，避免旁观者通过“是否立即结算”
    // 反推出全场手牌中是否存在【无懈可击】。不让无资格玩家逐个等待。
    g.pending.type='wuxiePublicWait';
    g.pending.asking=Number.isInteger(g.pending.from)?g.pending.from:0;
    g.pending.publicUntil=Date.now()+1000;
    setResponseAskedAt(g.pending);
    return;
  }
  g.pending.asking=asking;
  setResponseAskedAt(g.pending); // A1:每次轮到下一位无懈候选人即重新计时
  markWuxieAsked(g);
  const verb = g.pending.depth>0 ? '反制' : '使用';
  g.log=pushLog(g.log, '询问 '+g.players[asking].name+' 是否'+verb+'【无懈可击】…');
}

// ===== 无懈轮询日志的脱敏规则(CORE-148 / issue #205) =====
// 【这条规则为什么放在规则层,而不是留在展示层】
// 无懈轮询**只会询问真正持有【无懈可击】的角色**,或手牌非空且仍满足【蛊惑】响应条件的
// 于吉。所以"正在问谁"这件事本身就等价于暴露了那个人的隐藏持牌/隐藏响应能力 ——
// 这是"什么信息不该公开"的**规则层事实**,不是展示细节。
// 改动前它只实现在 render-log.js 的 hideWuxiePollingPlayer 里(issue #59),于是
// **AI 可见状态整个绕过了它**:buildBotKeyEvents 直接读 g.log[].text,把原始的
// "询问 XXX 是否使用【无懈可击】…" 投影进 recentLog,再随决策 prompt 和
// updateAiSummary 的摘要 prompt 一起发出去 —— 机器人因此能推断出谁有无懈,
// 拿到真人玩家界面上根本没有的信息优势;用外部 provider 时还会把这条送给第三方模型。
// 现在规则本体放在这里,展示层(render-log.js)和 AI 可见状态(bot.js)都是它的消费者,
// 加载顺序上 game.js 在两者之前,谁都不必反向依赖谁。
// 【刻意不做的事】不改 g.log 里存的原文 —— issue #92 已经明确接受"共享 Firebase 下
// 手牌非真隐藏"这个朋友局边界,本次只修"项目自己的 AI 可见信息投影违反了自己的隐藏
// 信息原则"这一点,不重构共享状态。也不动无懈的询问顺序/超时/公共窗口/蛊惑资格/结算逻辑。
const WUXIE_POLLING_PUBLIC_TEXT = '等待其他玩家响应【无懈可击】…';
function redactWuxiePollingLog(text){
  if(typeof text!=='string') return text;
  // 与 openWuxieRound / respondWuxie(false) 两处 pushLog 的文本严格对应
  // (verb 是"使用"或"反制",取决于 pending.depth)。
  if(/^询问 .+ 是否(?:使用|反制)【无懈可击】…$/.test(text)) return WUXIE_POLLING_PUBLIC_TEXT;
  return text;
}
function finishWuxiePublicWait(){
  tx(g=>{
    if(g.phase!=='wuxie'||!g.pending||g.pending.type!=='wuxiePublicWait') return g;
    if(typeof g.pending.publicUntil==='number' && Date.now()<g.pending.publicUntil) return g;
    g.pending.type='wuxie';
    delete g.pending.publicUntil;
    delete g.pending.asking;
    finishWuxieRound(g);
    return g;
  });
}
// finishWuxieRound: 一轮问完无人再出(或问不到人)时收尾。depth 奇数=原锦囊/该 AOE 目标作废,
// 偶数(含0,从未被无懈或被反制回来)=正常生效。ctx==='aoe' 时走群体锦囊自己的推进函数。
function nextWuxieAskee(g, pending, current){
  // 无懈窗口只询问此刻确实持有【无懈可击】的角色。旧实现会把每个存活角色都问一遍；
  // 桃园结义/五谷丰登/南蛮入侵/万箭齐发又是逐目标结算，于是多人局会连续转好几圈，
  // 即使所有人都根本没有无懈也必须逐个点“不出”。所有锦囊及反制无懈统一从这里
  // 过滤，既不改变“每个目标分别可被无懈”的规则，也避免无意义的重复询问。
  // 值得被问的玩家 = 真实持有【无懈可击】,或拥有【蛊惑】且本回合未使用过
  // (蛊惑可把任意一张手牌当【无懈可击】打出,与 canStartGuhuoResponse 的守卫对齐:
  // hasCap 已覆盖化身/新生借用,skillsLost/缠怨锁技能也随 hasCap 一起失效;
  // "未使用过"用全局 g.guhuoUsed,本回合已蛊惑过就不再问。手牌非空才可能扣置,
  // 空手问毫无意义,符合 #67"只询问值得问的玩家"结论。能力/手牌数均为公开信息,不泄露)。
  const canWuxie = seat=>{
    const p=g.players[seat];
    if(!p || !p.alive || !Array.isArray(p.hand)) return false;
    if(p.hand.some(c=>c && c.name==='无懈可击')) return true;
    return p.hand.length>0 && hasCap(p,'guhuo') && !g.guhuoUsed;
  };
  if(pending && pending.askAll && pending.depth===0){
    const n=g.players.length;
    const asked=Array.isArray(pending.asked) ? pending.asked : [];
    const start=Number.isInteger(current)
      ? current
      : ((Number.isInteger(pending.askStart) ? pending.askStart : pending.from) + n - 1) % n;
    for(let k=1;k<=n;k++){
      const s=(start+k)%n;
      if(asked.includes(s)) continue;
      if(canWuxie(s)) return s;
    }
    return null;
  }
  const n=g.players.length;
  const stop=pending.exclude;
  const start=Number.isInteger(current) ? current : stop;
  for(let k=1;k<=n;k++){
    const s=(start+k)%n;
    if(s===stop) return null;
    if(canWuxie(s)) return s;
  }
  return null;
}
function markWuxieAsked(g){
  if(!(g.pending && g.pending.askAll && g.pending.depth===0 && Number.isInteger(g.pending.asking))) return;
  if(!Array.isArray(g.pending.asked)) g.pending.asked=[];
  if(!g.pending.asked.includes(g.pending.asking)) g.pending.asked.push(g.pending.asking);
}
function finishWuxieRound(g){
  const info={trick:g.pending.trick, from:g.pending.from, to:g.pending.to, card:g.pending.card, sourceCard:g.pending.sourceCard, seatB:g.pending.seatB, pool:g.pending.pool, order:g.pending.order, idx:g.pending.idx, ctx:g.pending.ctx};
  const blocked = (g.pending.depth % 2)===1;
  if(g.pending.ctx==='aoe'){
    if(blocked){ aoeAdvance(g, info.to); } else { startAoeRespond(g, info.to); }
  } else if(g.pending.ctx==='taoyuan'){
    finishTaoyuanTarget(g, info, blocked);
  } else if(g.pending.ctx==='wugu'){
    finishWuguTargetWuxie(g, info, blocked);
  } else {
    if(blocked){
      if(info.trick==='铁索连环' && g.tiesuoQueue){
        g.pending=null;
        advanceTieSuoQueue(g);
        return;
      }
      // 延时锦囊的物理牌在 playCard 那步是 noDiscard(没进弃牌堆);被无懈挡下=放置失败,这里补进弃牌堆
      // (虚拟牌如徐晃【断粮】用 discardOrVanish 直接消失,不进弃牌堆重新流通)。
      // 普通锦囊 info.card 恒为 undefined,这条判断对它们是无操作(它们的牌在 playCard 时已经进了弃牌堆)。
      if(info.card) discardOrVanish(g, info.card);
      // 五谷丰登被无懈:亮出的公共池是真实牌(不是虚拟牌),整体弃入弃牌堆,谁都拿不到
      if(info.pool && info.pool.length) g.discard.push(...info.pool);
      g.pending=null; g.phase='play';
    } else {
      resolveTrick(g, info);
    }
  }
}
function aliveOrderFrom(g, from, includeFrom){
  const order=[];
  if(includeFrom && g.players[from] && g.players[from].alive) order.push(from);
  let s=from;
  const max=g.players.length;
  for(let k=0;k<max;k++){
    s=nextAlive(g,s);
    if(s===null || s===from) break;
    order.push(s);
  }
  return order;
}
function startTaoyuanWuxie(g, from, order, idx){
  // CORE-147(issue #204):满体力角色必须**在开轮询之前**就跳过,不能等到结算时才发现。
  // 【规则依据】标准版 FAQ:结算【桃园结义】时满体力角色视为不受其影响,不能对该角色
  // 使用【无懈可击】,应直接跳过该角色的结算。
  // 【改动前的问题】这个 while 只跳过"不存在/已阵亡",满血角色照样往下走,于是
  // 对他开一整轮无懈询问(phase='wuxie' + openWuxieRound),等到 finishTaoyuanTarget
  // 才由 hp<maxHp 判断出"体力已满"、什么也没发生。代价是三重的:①每个满血角色都白等
  // 一轮询问(无人可响应时还有约 1 秒公共等待窗口,多名满血角色连续累积);②持有无懈或
  // 可蛊惑响应的 AI 会为此进入一次没有任何合法收益的决策、可能真的调用模型烧 token;
  // ③**规则错误**——它允许玩家在本不该存在的响应时机把【无懈可击】打出去并消耗掉。
  // 【为什么放在这里而不是调用点】三个调用点(首次进入、被无懈抵消后推进、正常结算后
  // 推进)全部经过这个 while,收敛在唯一出口修一次,不在各调用点分别打补丁。
  while(idx<order.length){
    const p=g.players[order[idx]];
    if(!p || !p.alive){ idx++; continue; }
    if(p.hp>=p.maxHp){
      // 日志保留,否则满血角色会从结算过程里凭空消失、看不出为什么没轮到他。
      // 文案沿用改动前 finishTaoyuanTarget 里那条,玩家看到的措辞不变。
      g.log=pushLog(g.log, p.name+' 受【桃园结义】影响,体力已满');
      idx++; continue;
    }
    break;
  }
  if(idx>=order.length){
    g.pending=null;
    g.phase='play';
    g.log=pushLog(g.log, '【桃园结义】结算完毕');
    return;
  }
  const to=order[idx];
  g.pending=setResponseAskedAt({type:'wuxie', ctx:'taoyuan', trick:'桃园结义', from, to, exclude:from, depth:0, order, idx});
  g.pending.askAll=true;
  g.pending.askStart=from;
  g.pending.asked=[];
  g.phase='wuxie';
  g.log=pushLog(g.log, '结算对 '+g.players[to].name+' 的【桃园结义】…');
  openWuxieRound(g);
}
function finishTaoyuanTarget(g, info, blocked){
  const order=info.order || [];
  const idx=Number.isInteger(info.idx) ? info.idx : 0;
  const target=g.players[info.to];
  const source=g.players[info.from];
  if(blocked){
    g.log=pushLog(g.log, '对 '+(target?target.name:'目标')+' 的【桃园结义】被抵消');
    startTaoyuanWuxie(g, info.from, order, idx+1);
    return;
  }
  if(target && target.alive && target.hp<target.maxHp){
    target.hp++;
    removeBuquCard(g, info.to);
    g.log=pushLog(g.log, target.name+' 受【桃园结义】影响,回复1点体力');
    if(source && info.to!==info.from && hasCap(target, 'enyuan')){
      ensureDeck(g);
      drawN(g, info.from, 1);
      g.log=pushLog(g.log, target.name+' 回复1点体力,'+source.name+' 发动【恩怨】效果,摸一张牌');
    }
  } else if(target && target.alive){
    g.log=pushLog(g.log, target.name+' 受【桃园结义】影响,体力已满');
  }
  startTaoyuanWuxie(g, info.from, order, idx+1);
}
function finishWugu(g, pool){
  if(pool && pool.length) g.discard.push(...pool);
  g.pending=null;
  g.phase='play';
  g.log=pushLog(g.log, '【五谷丰登】结算完毕');
}
function startWuguWuxie(g, from, pool, order, idx){
  while(idx<order.length && (!g.players[order[idx]] || !g.players[order[idx]].alive)) idx++;
  if(idx>=order.length || !pool || pool.length===0){
    finishWugu(g, pool || []);
    return;
  }
  const to=order[idx];
  g.pending=setResponseAskedAt({type:'wuxie', ctx:'wugu', trick:'五谷丰登', from, to, exclude:from, depth:0, pool, order, idx});
  g.pending.askAll=true;
  g.pending.askStart=from;
  g.pending.asked=[];
  g.phase='wuxie';
  g.log=pushLog(g.log, '结算对 '+g.players[to].name+' 的【五谷丰登】…');
  openWuxieRound(g);
}
function finishWuguTargetWuxie(g, info, blocked){
  const order=info.order || [];
  const idx=Number.isInteger(info.idx) ? info.idx : 0;
  const pool=info.pool || [];
  const target=g.players[info.to];
  if(blocked){
    g.log=pushLog(g.log, '对 '+(target?target.name:'目标')+' 的【五谷丰登】被抵消,跳过挑选');
    startWuguWuxie(g, info.from, pool, order, idx+1);
    return;
  }
  g.pending={type:'wugu', from:info.from, pool, order, idx};
  g.phase='wugu';
  g.log=pushLog(g.log, '轮到 '+(target?target.name:'目标')+' 从【五谷丰登】挑选');
}
// resolveTrick: 锦囊真正生效。决斗 -> 进入 duel 弃杀;顺手/拆桥 -> 作用于"手牌+装备",
// 有多种可拿对象时开"选牌"子阶段交使用者选,唯一对象则直接结算,全空则无效果。
function resolveTrick(g, info){
  const tgt=g.players[info.to];
  if(info.trick==='决斗'){
    g.pending=setResponseAskedAt({type:'duel', from:info.from, to:info.to, active:info.to});
    if(info.sourceCard!==undefined) g.pending.sourceCard=info.sourceCard;
    g.phase='duel';
    // 决斗发起牌本身不需要在这里手动补插:markCardSound 现在无条件 push(不再按阶段枚举
    // 判断该不该追加),playCard 主入口那次调用(此刻 phase 还是 'wuxie' 无懈询问窗口)已经
    // 把这张决斗发起牌记进 g.exchangeCards 了。这里如果再手动 push 一次,会造成同一张决斗
    // 发起牌被记录两次(重复出现在中央展示区)——这是 markCardSound 改成无条件 push 之后
    // 唯一需要一并删除的旧补丁,已核实并写了回归测试锁定。
    g.log=pushLog(g.log, '【决斗】开始,'+tgt.name+' 先出杀');
    return; // duel 流程自身不再触发无懈
  }
  if(info.trick==='无中生有'){
    drawN(g, info.from, 2);
    g.pending=null; g.phase='play';
    g.log=pushLog(g.log, g.players[info.from].name+' 【无中生有】生效,摸两张牌');
    return;
  }
  if(info.trick==='桃园结义'){
    const order=aliveOrderFrom(g, info.from, true);
    startTaoyuanWuxie(g, info.from, order, 0);
    return;
  }
  if(info.trick==='五谷丰登'){
    // 挑选顺序:从发起者起,按存活玩家环形顺序转一整圈(此刻的存活人数可能已和亮牌时不同,
    // 若无懈询问期间有人阵亡,顺序就按现在的存活玩家算——多出的牌在挑完一圈后兜底弃入弃牌堆,
    // 不追求"重新分配"这种复杂规则,只保证不会卡死)。
    if(!info.pool || info.pool.length===0){ g.pending=null; g.phase='play'; return; }
    const order=[info.from];
    let s=info.from;
    for(let k=1;k<aliveCount(g);k++){
      s=nextAlive(g,s);
      if(s===info.from || order.includes(s)) break;
      order.push(s);
    }
    g.log=pushLog(g.log, '【五谷丰登】开始,从 '+g.players[info.from].name+' 起依次挑选');
    startWuguWuxie(g, info.from, info.pool.slice(), order, 0);
    return;
  }
  if(info.trick==='火攻'){
    if(!tgt || !tgt.alive || !(tgt.hand||[]).length){
      g.pending=null; g.phase='play';
      g.log=pushLog(g.log, '【火攻】目标没有手牌,无效果');
      return;
    }
    g.pending=setResponseAskedAt({type:'huogongReveal', from:info.from, to:info.to, sourceCard:info.sourceCard});
    g.phase='huogongReveal';
    g.log=pushLog(g.log, '等待 '+tgt.name+' 为【火攻】展示一张手牌…');
    return;
  }
  if(info.trick==='铁索连环'){
    if(!tgt || !tgt.alive){
      g.pending=null;
      if(g.tiesuoQueue) advanceTieSuoQueue(g);
      else g.phase='play';
      return;
    }
    tgt.chained=!tgt.chained;
    g.log=pushLog(g.log, tgt.name+(tgt.chained?' 进入连环状态':' 解除连环状态'));
    g.pending=null;
    if(g.tiesuoQueue) advanceTieSuoQueue(g);
    else g.phase='play';
    return;
  }
  if(info.trick==='借刀杀人'){
    const A=g.players[info.to], B=g.players[info.seatB];
    // 无懈询问期间状态可能变化(A 阵亡/武器没了/B 阵亡):安全回 play,不做任何事,防软锁
    if(!A || !A.alive || !A.equips.weapon || !B || !B.alive){
      g.pending=null; g.phase='play';
      g.log=pushLog(g.log, '【借刀杀人】目标已失效,无事发生');
      return;
    }
    g.pending=setResponseAskedAt({type:'jiedaoChoice', from:info.from, seatA:info.to, seatB:info.seatB});
    g.phase='jiedaoChoice';
    g.log=pushLog(g.log, A.name+' 请选择:对 '+B.name+' 使用【杀】,或弃置武器【'+A.equips.weapon.name+'】…');
    return;
  }
  if(DELAY_TRICKS[info.trick]){
    // 放置未被无懈挡下:延时锦囊的物理牌(info.card)进目标判定区,不进弃牌堆,不立即生效——
    // 等目标下次回合开始时,resolveDelayTricks 才会翻判定、调具体牌的 effect、决定去向。
    tgt.delays = tgt.delays || [];
    tgt.delays.push(info.card);
    g.pending=null; g.phase='play';
    g.log=pushLog(g.log, tgt.name+' 的判定区放置了【'+info.trick+'】');
    return;
  }
  // 顺手/拆桥:目标手牌(隐藏,整体算1个"随机手牌"选项) + 每件已装备(公开,各1个具体选项)
  // + 判定区每张延时锦囊(公开,各1个具体选项,官方规则明确判定区也在可选范围内)
  if(!tgt || !tgt.alive){ g.pending=null; g.phase='play'; return; }
  const handCount=(tgt.hand||[]).length;
  const equipSlots=EQUIP_SLOTS.filter(s=>tgt.equips[s]);
  const delayCount=(tgt.delays||[]).length;
  const optCount=(handCount>0?1:0)+equipSlots.length+delayCount;
  if(optCount===0){
    g.log=pushLog(g.log, tgt.name+' 没有手牌、装备或判定区的牌,【'+info.trick+'】无效果');
    g.pending=null; g.phase='play'; return;
  }
  if(optCount===1){
    // 唯一选择:免弹窗直接结算。
    // 【失去装备钩子的正确接法,见 CLAUDE.md「凌统旋风」条】必须先把休止相设成 play 再结算:
    // ①applyTrickOnEquip 内部会触发 onLoseEquip 钩子,凌统【旋风】捕获的 previousPhase 得是 play
    //   (顺手/拆桥结算完、攻击者回合继续),否则会捕获到此刻的中间相(经无懈过来时是 'wuxie')、
    //   旋风结束后恢复到死相导致软锁;②钩子若挂起了新 pending(旋风)就 return、不覆盖。
    g.pending=null; g.phase='play';
    const pendingBefore=g.pending; // = null
    if(handCount>0) applyTrickOnHand(g, info);
    else if(equipSlots.length>0) applyTrickOnEquip(g, info, equipSlots[0]);
    else applyTrickOnDelay(g, info, 0);
    if(g.pending!==pendingBefore && g.pending) return; // 旋风等钩子挂起了,保留不覆盖
    return;
  }
  // 多个可选:开使用者选牌子阶段(只有 from 能操作)
  g.pending=setResponseAskedAt({type:'pick', trick:info.trick, from:info.from, to:info.to});
  g.phase='pick';
  g.log=pushLog(g.log, '等待 '+g.players[info.from].name+' 选择对 '+tgt.name+' 拿/拆哪张牌…');
}
// applyTrickOnHand: 随机拿/弃目标一张手牌。手牌是隐藏信息 -> 日志不写牌名。
function applyTrickOnHand(g, info){
  const me=g.players[info.from], tgt=g.players[info.to];
  const j=Math.floor(Math.random()*tgt.hand.length);
  const card=removeHandCards(g, info.to, j)[0];
  if(info.trick==='顺手牵羊'){ me.hand.push(card); g.log=pushLog(g.log, me.name+' 从 '+tgt.name+' 拿走一张手牌'); }
  else { g.discard.push(card); markDiscardReveal(g, info.to, [card]); g.log=pushLog(g.log, me.name+' 弃掉 '+tgt.name+' 一张手牌'); }
}
// applyTrickOnEquip: 拿/拆目标某槽装备。装备是公开信息 -> 日志写明牌名。顺手获得的装备进使用者手牌。
function applyTrickOnEquip(g, info, slot){
  const me=g.players[info.from], tgt=g.players[info.to];
  const card=tgt.equips[slot]; if(!card) return;
  tgt.equips[slot]=null;
  if(info.trick==='顺手牵羊'){ me.hand.push(card); g.log=pushLog(g.log, me.name+' 顺走 '+tgt.name+' 的装备【'+card.name+'】'); }
  else { g.discard.push(card); markDiscardReveal(g, info.to, [card]); g.log=pushLog(g.log, me.name+' 拆掉 '+tgt.name+' 的装备【'+card.name+'】'); }
  // 失主(info.to)的装备离开装备区 → 触发失去装备钩子(如孙尚香【枭姬】)。顺手/拆桥单次仅动一槽,恒失去 1 张。
  triggerHook(g, info.to, 'onLoseEquip', { count:1 });
}
// applyTrickOnDelay: 拿/拆目标判定区里第idx张延时锦囊。判定区是公开信息 -> 日志写明牌名。
// 顺手拿到的延时锦囊进使用者手牌后就是一张普通牌(和普通规则一致,可以再次正常打出使用)。
function applyTrickOnDelay(g, info, idx){
  const tgt=g.players[info.to];
  const card=(tgt.delays||[])[idx]; if(!card) return;
  tgt.delays.splice(idx,1);
  restoreOriginalCardName(card);
  const me=g.players[info.from];
  if(info.trick==='顺手牵羊'){ me.hand.push(card); g.log=pushLog(g.log, me.name+' 顺走 '+tgt.name+' 判定区的【'+card.name+'】'); }
  else { g.discard.push(card); markDiscardReveal(g, info.to, [card]); g.log=pushLog(g.log, me.name+' 拆掉 '+tgt.name+' 判定区的【'+card.name+'】'); }
}
// pickResolve: 选牌子阶段结算。choice='hand' 或装备槽名 或 'delay:'+下标(判定区第几张)。
// 仅使用者可操作;失效项(手牌已空/槽已空/判定区那张已不在)安全回 play 防软锁。
function pickResolve(choice){
  tx(g=>{
    if(g.phase!=='pick'||!g.pending||g.pending.type!=='pick'||g.pending.from!==mySeat) return g;
    const info={trick:g.pending.trick, from:g.pending.from, to:g.pending.to};
    const tgt=g.players[info.to];
    if(!tgt || !tgt.alive){ g.pending=null; g.phase='play'; return g; }
    // 【失去装备钩子的正确接法,见 CLAUDE.md「凌统旋风」条】先把休止相设成 play 再结算:
    // pickResolve 进来时 g.phase 是 'pick',若不先重置,applyTrickOnEquip 内触发的 onLoseEquip
    // 钩子(凌统旋风)会把 previousPhase 捕获成 'pick'、旋风结束后恢复到死相软锁。重置后:
    // 各失效兜底分支直接 return(状态已重置);正常结算后若钩子挂起了新 pending(旋风)就 return
    // 不覆盖(遗计/濒死同款约定)。
    g.pending=null; g.phase='play';
    const pendingBefore=g.pending; // = null
    if(choice==='hand'){
      if((tgt.hand||[]).length===0){ return g; } // 失效兜底(pending/phase 已重置)
      applyTrickOnHand(g, info);
    } else if(typeof choice==='string' && choice.startsWith('delay:')){
      const idx=Number(choice.slice(6));
      if(!Number.isInteger(idx) || !(tgt.delays||[])[idx]){ return g; } // 失效兜底
      applyTrickOnDelay(g, info, idx);
    } else {
      if(!EQUIP_SLOTS.includes(choice) || !tgt.equips[choice]){ return g; } // 失效兜底
      applyTrickOnEquip(g, info, choice);
    }
    if(g.pending!==pendingBefore && g.pending) return g; // 旋风等钩子挂起了,保留不覆盖
    return g;
  });
}
// respondWuxie: 仅当前被询问者(pending.asking)可响应。
// 出且确有无懈 -> depth++、exclude=自己,开新一轮反制窗口(openWuxieRound,可不限层数继续下去);
// 不出 -> 指针移到下一存活玩家,问完一圈(绕回 exclude)则收尾(finishWuxieRound,按 depth 奇偶判定)。
// 点"出"但其实没无懈的本地提示在按钮 onclick 里处理,不进 tx,避免改共享状态/泄露手牌。
function respondWuxie(useWuxie){
  tx(g=>{
    if(g.phase!=='wuxie'||!g.pending||g.pending.type!=='wuxie') return g;
    const me=g.players[mySeat];
    if(!me || !me.alive || g.pending.asking!==mySeat) return g;
    if(useWuxie){
      const idx=me.hand.findIndex(c=>c.name==='无懈可击');
      if(idx<0) return g; // 没牌:状态不变,仍停在本人这一轮(界面按钮保留)
      const card = removeHandCards(g, mySeat, idx)[0];
      g.discard.push(card);
      // depth===0(反制原锦囊)措辞不同于 depth>=1(反制上一次无懈可击)
      const target = g.pending.depth>0 ? g.players[g.pending.exclude].name+' 的【无懈可击】' : '对 '+g.players[g.pending.to].name+' 的【'+g.pending.trick+'】';
      g.log=pushLog(g.log, me.name+' 打出【无懈可击】,抵消了'+target);
      markCardSound(g, '无懈可击', mySeat, card);
      g.pending.depth++;
      g.pending.exclude=mySeat;
      delete g.pending.asking;
      if(g.pending.askAll) g.pending.asked=[];
      openWuxieRound(g);
      return g;
    }
    // 不出:指针推进到下一个存活玩家;绕回 exclude 即这一轮问完一圈 -> 收尾
    g.log=pushLog(g.log, me.name+'：不出');
    const nxt=nextWuxieAskee(g, g.pending, mySeat);
    if(nxt===null){
      finishWuxieRound(g);
    } else {
      g.pending.asking=nxt;
      setResponseAskedAt(g.pending); // A1:切换被问者即重新计时
      markWuxieAsked(g);
      const verb = g.pending.depth>0 ? '反制' : '使用';
      g.log=pushLog(g.log, '询问 '+g.players[nxt].name+' 是否'+verb+'【无懈可击】…');
    }
    return g;
  });
}

// ===== 群体锦囊：南蛮入侵(出杀)/ 万箭齐发(出闪),对使用者外所有存活角色逐个结算 =====
// 出牌阶段使用,无需选目标。
// aoeAdvance: 推进到 prevSeat 之后的下一个目标;问完(绕回 from)则结束整个群体结算回到 play。
// 每次都整体重建 g.pending,避免上一子阶段(尤其 asking)字段残留。
function aoeAdvance(g, prevSeat){
  const from=g.aoe.from;
  const next=nextAskee(g, from, prevSeat);
  
  // 祸首：南蛮入侵对孟获无效
  if(next!==null && g.aoe.trick==='南蛮入侵'){
    const nextPlayer=g.players[next];
    if(nextPlayer && nextPlayer.alive && hasCap(nextPlayer,'huoshou')){
      g.log=pushLog(g.log, nextPlayer.name+'【祸首】发动，南蛮入侵对其无效');
      return aoeAdvance(g, next);
    }
  }
  
  // 巨象：南蛮入侵对祝融无效
  if(next!==null && g.aoe.trick==='南蛮入侵'){
    const nextPlayer=g.players[next];
    if(nextPlayer && nextPlayer.alive && hasCap(nextPlayer,'juxiang')){
      markSkillSound(g,'巨象');
      g.log=pushLog(g.log, nextPlayer.name+'【巨象】发动，南蛮入侵对其无效');
      return aoeAdvance(g, next);
    }
  }
  
  if(next===null){
    // 巨象效果②：其他角色使用南蛮入侵结算结束后，所有祝融获得该锦囊牌
    if(g.aoe.trick==='南蛮入侵' && g.aoe.from !== null && g.players[g.aoe.from]){
      const isFromZhurong = hasCap(g.players[g.aoe.from], 'juxiang');
      if(!isFromZhurong){ // 只有其他角色使用的南蛮入侵才会触发
        // 寻找场上所有祝融
        const zhurongSeats = [];
        for(let i=0; i<g.players.length; i++){
          if(g.players[i] && g.players[i].alive && hasCap(g.players[i], 'juxiang')){
            zhurongSeats.push(i);
          }
        }
        
        if(zhurongSeats.length > 0){ // 场上有祝融
          // 为每个祝融都获得一张南蛮入侵牌
          for(const seat of zhurongSeats){
            const zhurong = g.players[seat];
            if(zhurong && zhurong.alive){
              // 寻找弃牌堆中的南蛮入侵牌
              const nanmanIdx = g.discard.findIndex(card => card && card.name === '南蛮入侵');
              if(nanmanIdx !== -1){ // 找到南蛮入侵牌
                const nanmanCard = g.discard[nanmanIdx];
                if(!zhurong.hand) zhurong.hand = [];
                zhurong.hand.push(nanmanCard);
                markSkillSound(g,'巨象');
                g.log = pushLog(g.log, zhurong.name + '【巨象】发动,获得了【南蛮入侵】');
                // 从弃牌堆中移除该南蛮入侵牌
                g.discard.splice(nanmanIdx, 1);
              }
            }
          }
        }
      }
    }
    
    g.aoe=null; g.pending=null; g.phase='play';
    // 这里不需要再手动清空 g.exchangeCards:pending/aoe 已经在上一行同时清空,这个分支到此
    // 为止不会再有后续代码在同一个 tx 里重新给 pending 赋值——pruneExchangeCards(见其定义
    // 处的说明)的通用兜底规则(!pending&&!aoe)在下一次 tx 开始时必然会命中并清空,手动清
    // 一次是纯粹的重复。这一点已经用真实场景实测验证过,不是凭"看起来应该没问题"就删的。
    g.log=pushLog(g.log, '【群体锦囊】结算完毕');
    return;
  }
  // 对该目标开启无懈询问子阶段(exclude/depth 初始化,交给 openWuxieRound 统一处理)
  g.pending=setResponseAskedAt({type:'wuxie', ctx:'aoe', trick:g.aoe.trick, from, to:next, exclude:from, depth:0});
  g.pending.askAll=true;
  g.pending.askStart=from;
  g.pending.asked=[];
  if(g.aoe.sourceCard!==undefined) g.pending.sourceCard=g.aoe.sourceCard;
  g.phase='wuxie';
  g.log=pushLog(g.log, '结算对 '+g.players[next].name+' 的【'+g.aoe.trick+'】…');
  openWuxieRound(g);
}
// startAoeRespond: 无人无懈后,要求当前目标打出 杀/闪。整体重建 pending。
function startAoeRespond(g, target){
  // 八卦阵:仅当需要出【闪】(万箭齐发)时先判定,红=视为出闪 → 免这一箭,推进下一目标(与打出闪同一条路)
  if(g.aoe.need==='闪'){
    const r=tryBagua(g, target, {type:'aoe', target});
    if(r==='pending') return; // 鬼才改判进行中,收尾延后到 finishGuicai
    if(r){
      g.log=pushLog(g.log, g.players[target].name+' 以【八卦阵】抵消【'+g.aoe.trick+'】');
      aoeAdvance(g, target);
      return;
    }
  }
  g.pending=setResponseAskedAt({type:'aoeResp', from:g.aoe.from, to:target, need:g.aoe.need});
  if(g.aoe.sourceCard!==undefined) g.pending.sourceCard=g.aoe.sourceCard;
  g.phase='aoeResp';
  g.log=pushLog(g.log, '要求 '+g.players[target].name+' 打出【'+g.aoe.need+'】');
}
// aoeRespond: 仅 pending.to 可响应;出 need 牌则抵消,否则受1点伤害(可能阵亡)。出杀不碰 shaUsed。
// cardIdx(可选):玩家在"有多个候选牌可当need"时(真实牌+龙胆/武圣转化)明确选中的那一张手牌
// 下标。不传(或非法)就回退 findUsableAs 自动挑,完全向后兼容,服务端同样要复核 canUseAs
// 合法性,见 respondShan 同款注释。
function aoeRespond(useCard, cardIdx){
  tx(g=>{
    if(g.phase!=='aoeResp'||!g.pending||g.pending.type!=='aoeResp'||!g.aoe) return g;
    const me=g.players[mySeat];
    if(!me || !me.alive || g.pending.to!==mySeat) return g;
    const need=g.pending.need;
    if(useCard){
      // 曹彰【将驰】选项1:本回合不能打出杀(南蛮响应)
      if(need==='杀' && me.jiangchiNoSlash) return g;
      const specifiedCard = (typeof cardIdx==='number') ? (me.hand||[])[cardIdx] : null;
      const idx = (specifiedCard && canUseAs(me, specifiedCard, need)) ? cardIdx : findUsableAs(me.hand,me,need); // 龙胆:杀/闪可互转,优先用本名牌
      if(idx<0) return g; // 没牌:界面按钮保留,等其改点"不出"
      const card=removeHandCards(g, mySeat, idx)[0]; g.discard.push(card);
      const label = card.name===need ? '打出【'+need+'】' : '打出【'+card.name+'】当【'+need+'】';
      g.log=pushLog(g.log, me.name+' '+label+',抵消【'+g.aoe.trick+'】');
      markCardSound(g, need, mySeat, card);
      if(card.name!==need){
        if(hasCap(me,'longdan')) markSkillSound(g,'龙胆');
        else if(need==='杀' && hasCap(me,'wusheng')) markSkillSound(g,'武圣');
      }
      // 张角【雷击】:使用或打出【闪】时可以发动雷击——和 respondShan(3/4)同一套写法,插入
      // 位置同理必须在 card 已经 splice 出来、aoeAdvance 推进到下一个目标之前,挂起就立即
      // return,不能让 aoeAdvance 在同一次 tx 里把刚挂起的 leijiChoose 冲掉。
      // 判断条件故意只看 card.name==='闪',不附加 need==='闪' 这个前置条件:aoeRespond 同时
      // 服务南蛮入侵(need==='杀')和万箭齐发(need==='闪')两种群体锦囊,而龙胆是双向转化
      // (canUseAs 里 role==='杀'&&card.name==='闪' 同样成立)——如果张角能拿到龙胆(目前只有
      // 左慈化身这一条路),用一张真闪当杀响应南蛮入侵,这张牌本身仍然是"打出了一张【闪】",
      // 按官方原文"当你使用或打出一张【闪】时"雷击依然应该触发,不该被 need==='杀' 挡住。
      // 第4个参数 {prevSeat:mySeat} 是"雷击从南蛮/万箭响应触发"的续接标记(见
      // maybeStartLeiji/finishLeijiChain 的注释)——respondShan(单体杀响应)不传这个参数,
      // 两种触发场景各自走各自的收尾行为,互不影响。
      if(hasCap(me,'leiji') && card.name==='闪'){
        if(maybeStartLeiji(g, mySeat, card, {prevSeat:mySeat})) return g;
      }
      aoeAdvance(g, mySeat);
      return g;
    }
    // 不出:受到1点伤害
    // 主公技:需出杀(南蛮)→激将,需出闪(万箭)→护驾;先进入求助流程,无人替出则回原响应
    const lordCap = need==='杀' ? 'jijiang' : 'hujia';
    if(canTriggerLordAsk(g, mySeat, lordCap)){
      startLordAsk(g, mySeat, need, lordCap);
      return g;
    }
    let actualSourceSeat = g.pending.from;
    
    // 祸首来源已在南蛮指定目标时按行动顺序固定；来源中途死亡后不改选另一名孟获。
    if(g.aoe.trick==='南蛮入侵' && Object.prototype.hasOwnProperty.call(g.aoe,'huoshouSourceSeat')){
      const huoshouSeat=g.aoe.huoshouSourceSeat;
      const huoshou=g.players[huoshouSeat];
      actualSourceSeat=(huoshou&&huoshou.alive&&hasCap(huoshou,'huoshou')) ? huoshouSeat : null;
    }
    
    const dying = dealDamage(g, mySeat, 1, actualSourceSeat, '未打出【'+need+'】', 'aoe', g.aoe.sourceCard);
    if(dying) return g; // 濒死流程接管,后续(aoeAdvance)延后到 finishDying 处理
    if(checkWin(g)) return g;
    aoeAdvance(g, mySeat); // 未结束才推进到下一目标
    return g;
  });
}

// ===== 主公技求助(刘备【激将】/曹操【护驾】) =====
// 触发点:respondShan/duelResponse/aoeRespond 的"不出/不闪"分支,若主公(身份局 role==='zhu'
// + 拥有对应 caps + 本回合未用过 + 场上还有其它存活角色)选择不自己出牌,先进入求助流程
// (jijiangAsk/hujiaAsk),从主公下家按 nextAskee 逐个问其他角色是否替出;有人替出则视为
// 主公已出(完成原响应),无人替出则恢复原 pending,主公回到正常响应继续(可再自己出牌或
// 不出——后一次不出因 used 已真直接走受伤/认输)。
// 守卫刻意用 hasCap(武将能力声明) + p.role==='zhu'(身份) 双条件,不硬编码武将名。
function canTriggerLordAsk(g, seat, cap){
  const p=g.players[seat];
  if(!p || !p.alive) return false;
  if(g.gameMode!=='identity') return false; // 主公技仅身份局
  if(p.role!=='zhu') return false;          // 仅主公身份可发动
  if(!hasCap(p,cap)) return false;          // 能力声明在 GENERALS.caps,业务点查表
  if(cap==='jijiang' && g.jijiangUsed) return false;
  if(cap==='hujia' && g.hujiaUsed) return false;
  const faction=cap==='jijiang'?'shu':'wei';
  return g.players.some((q,i)=>i!==seat && q && q.alive && generalFaction(q)===faction);
}
function nextLordAskee(g, lordSeat, current, cap){
  const faction=cap==='jijiang'?'shu':'wei',n=g.players.length;
  for(let k=1;k<=n;k++){
    const s=(current+k)%n;
    if(s===lordSeat) return null;
    const p=g.players[s];
    if(p && p.alive && generalFaction(p)===faction) return s;
  }
  return null;
}
function startLordAsk(g, lordSeat, need, cap, resumeOverride){
  const first=nextLordAskee(g, lordSeat, lordSeat, cap);
  if(first===null) return; // 无人可求助(守卫已排除,这里兜底)
  const resume=resumeOverride || {phase:g.phase, pending:g.pending};
  if(cap==='jijiang') g.jijiangUsed=true; else g.hujiaUsed=true;
  if(cap==='jijiang') markSkillSound(g,'激将');
  else markSkillSound(g,'护驾');
  const type=cap==='jijiang'?'jijiangAsk':'hujiaAsk';
  g.pending=setResponseAskedAt({type, lordSeat, need, asking:first, resume});
  g.phase=type;
  g.log=pushLog(g.log, g.players[lordSeat].name+' 发动【'+(cap==='jijiang'?'激将':'护驾')+'】,向同势力角色求助打出【'+need+'】…');
}
// 无人替出 → 恢复原 pending,主公回到正常响应
function restoreLordAsk(g, ask){
  g.pending=ask.resume.pending;
  g.phase=ask.resume.phase;
  if(g.pending && typeof g.pending.askedAt==='number') g.pending.askedAt=Date.now(); // 重新计时
  g.log=pushLog(g.log, g.players[ask.lordSeat].name+'【'+(ask.need==='杀'?'激将':'护驾')+'】无人响应,回到主公正常响应');
}
// 有人替出 → 恢复原 pending 后,按原场景完成"已出"语义(镜像于吉【蛊惑】的
// resolveGuhuoResponseShan/Sha/Aoe 同一套写法:换牌者只是物理出牌人,响应方仍是主公)。
function completeLordAsk(g, ask, card){
  const lordSeat=ask.lordSeat, helper=ask.helperSeat;
  const lord=g.players[lordSeat];
  g.pending=ask.resume.pending;
  g.phase=ask.resume.phase;
  if(g.pending && typeof g.pending.askedAt==='number') g.pending.askedAt=Date.now();
  if(ask.need==='闪'){
    if(g.phase==='respond' && g.pending && g.pending.to===lordSeat){
      // 单体杀响应:与 respondShan 出闪分支同款收尾(含吕布【无双】计数/杀被抵消后的武器特效)
      const attacker=g.players[g.pending.from];
      const needed=hasCap(attacker,'wushuang') ? 2 : 1;
      const played=(g.pending.shanCount||0)+1;
      g.discard.push(card);
      g.log=pushLog(g.log, lord.name+' 发动【护驾】,'+g.players[helper].name+' 替其打出【闪】'+(needed>1?('（'+played+'/'+needed+'）'):'抵消'));
      markCardSound(g, '闪', lordSeat, card);
      if(played<needed){ g.pending.shanCount=played; return; }
      if(maybeStartShaOffsetEffects(g, g.pending.from, lordSeat, g.pending.sourceCard, !!g.pending.jiuBonus)) return;
      g.pending=null;
      finishSingleShaTarget(g);
      return;
    }
    if(g.phase==='aoeResp' && g.pending && g.pending.to===lordSeat && g.pending.need==='闪'){
      // 万箭齐发响应:与 aoeRespond 出牌分支同款推进
      g.discard.push(card);
      g.log=pushLog(g.log, lord.name+' 发动【护驾】,'+g.players[helper].name+' 替其打出【闪】,抵消【'+g.aoe.trick+'】');
      markCardSound(g, '闪', lordSeat, card);
      aoeAdvance(g, lordSeat);
      return;
    }
  }
  if(ask.need==='杀'){
    if(ask.resume && Number.isInteger(ask.resume.jijiangTarget)){
      const targetSeat=ask.resume.jijiangTarget;
      g.discard.push(card);
      g.log=pushLog(g.log, lord.name+' 发动【激将】,'+g.players[helper].name+' 代其打出【杀】');
      markCardSound(g, '杀', lordSeat, card, targetSeat);
      CARD_PLAYS['杀'].effect(g, lord, card, targetSeat);
      return;
    }
    if(g.phase==='duel' && g.pending && g.pending.active===lordSeat){
      // 决斗响应:与 duelResponse 出杀分支同款换人
      const opp=(lordSeat===g.pending.from)?g.pending.to:g.pending.from;
      const needed=(!hasCap(lord,'wushuang') && hasCap(g.players[opp],'wushuang')) ? 2 : 1;
      const played=(g.pending.shaCount||0)+1;
      g.discard.push(card);
      g.log=pushLog(g.log, lord.name+' 发动【激将】,'+g.players[helper].name+' 替其打出【杀】响应【决斗】'+(needed>1?('（'+played+'/'+needed+'）'):''));
      markCardSound(g, '杀', lordSeat, card, opp);
      if(lordSeat===g.turn) g.shaPlayedInDuel=true;
      if(played<needed){ g.pending.shaCount=played; return; }
      g.pending.active=(lordSeat===g.pending.from)?g.pending.to:g.pending.from;
      g.pending.shaCount=0;
      return;
    }
    if(g.phase==='aoeResp' && g.pending && g.pending.to===lordSeat && g.pending.need==='杀'){
      // 南蛮入侵响应:与 aoeRespond 出牌分支同款推进
      g.discard.push(card);
      g.log=pushLog(g.log, lord.name+' 发动【激将】,'+g.players[helper].name+' 替其打出【杀】,抵消【'+g.aoe.trick+'】');
      markCardSound(g, '杀', lordSeat, card);
      aoeAdvance(g, lordSeat);
      return;
    }
  }
}

// 刘备【激将】的出牌阶段主动入口:先选定【杀】的合法目标,再依次询问蜀势力角色。
// 响应者提供的是实体【杀】,但使用者、伤害来源和出杀次数均属于刘备。
function useJijiang(targetSeat){
  tx(g=>{
    if(g.phase!=='play' || g.turn!==mySeat) return g;
    const me=g.players[mySeat];
    if(!canTriggerLordAsk(g,mySeat,'jijiang')) return g;
    const virtualSha={name:'杀',suit:'',rank:'',id:'jijiang'};
    if(!CARD_PLAYS['杀'].canPlay(g,me,virtualSha)) return g;
    if(targetSeat===mySeat || !g.players[targetSeat] || !g.players[targetSeat].alive) return g;
    if(!CARD_PLAYS['杀'].canTarget(g,me,virtualSha,targetSeat)) return g;
    startLordAsk(g,mySeat,'杀','jijiang',{phase:'play',pending:null,jijiangTarget:targetSeat});
    return g;
  });
}
// respondJijiangAsk/respondHujiaAsk:被求助者(asking===mySeat)响应。出牌=替主公认出这张
// 牌并完成原响应;不出=按 nextAskee 问下一个人,问完一圈无人 → 恢复原 pending。
// 曹彰【将驰】禁杀同样约束替出(服务端与机器人两侧都要判,规则26)。
function respondLordAskCore(useCard, cardIdx){
  tx(g=>{
    if(!g.pending || (g.pending.type!=='jijiangAsk' && g.pending.type!=='hujiaAsk')) return g;
    if(g.phase!=='jijiangAsk' && g.phase!=='hujiaAsk') return g;
    if(g.pending.asking!==mySeat) return g;
    const ask=g.pending;
    const need=ask.need;
    const me=g.players[mySeat];
    if(useCard){
      if(need==='杀' && me.jiangchiNoSlash) return g;
      const specifiedCard=(typeof cardIdx==='number') ? (me.hand||[])[cardIdx] : null;
      const idx=(specifiedCard && canUseAs(me,specifiedCard,need)) ? cardIdx : findUsableAs(me.hand,me,need);
      if(idx<0) return g; // 没牌:界面按钮保留,等其改点"不出"
      const card=removeHandCards(g, mySeat, idx)[0];
      ask.helperSeat=mySeat;
      completeLordAsk(g, ask, card);
      return g;
    }
    const nxt=nextLordAskee(g, ask.lordSeat, mySeat, ask.need==='杀'?'jijiang':'hujia');
    if(nxt===null){
      restoreLordAsk(g, ask);
      return g;
    }
    ask.asking=nxt;
    g.pending.askedAt=Date.now(); // 轮到下一位被求助者重新计时
    return g;
  });
}
function respondJijiangAsk(useCard, cardIdx){ respondLordAskCore(useCard, cardIdx); }
function respondHujiaAsk(useCard, cardIdx){ respondLordAskCore(useCard, cardIdx); }

// ===== 张角【黄天】:其他群势力角色出牌阶段限一次,交给主公一张闪或闪电 =====
function canUseHuangtian(g, seat){
  const donor=g.players[seat];
  if(!donor || !donor.alive || g.gameMode!=='identity' || g.phase!=='play' || g.turn!==seat) return false;
  if(generalFaction(donor)!=='qun' || donor.huangtianUsed) return false;
  const lord=g.players.find((p,i)=>i!==seat && p && p.alive && p.role==='zhu' && hasCap(p,'huangtian'));
  if(!lord) return false;
  return (donor.hand||[]).some(c=>c && (c.name==='闪' || c.name==='闪电'));
}
function useHuangtian(cardIdx){
  tx(g=>{
    if(!canUseHuangtian(g,mySeat)) return g;
    const donor=g.players[mySeat];
    const lordSeat=g.players.findIndex((p,i)=>i!==mySeat && p && p.alive && p.role==='zhu' && hasCap(p,'huangtian'));
    const card=(donor.hand||[])[cardIdx];
    if(lordSeat<0 || !card || (card.name!=='闪' && card.name!=='闪电')) return g;
    removeHandCards(g, mySeat, cardIdx);
    g.players[lordSeat].hand.push(card);
    donor.huangtianUsed=true;
    g.log=pushLog(g.log, donor.name+' 发动【黄天】,交给 '+g.players[lordSeat].name+' 一张【'+card.name+'】');
    markSkillSound(g,'黄天');
    return g;
  });
}

// 孙权【救援】:当前官网规则为锁定技,其他吴势力角色对主公使用桃时回复值+1。
function peachRecoveryAmount(g, sourceSeat, targetSeat){
  const source=g.players[sourceSeat], target=g.players[targetSeat];
  if(g.gameMode==='identity' && sourceSeat!==targetSeat && source && target && target.alive &&
     target.role==='zhu' && hasCap(target,'jiuyuan') && generalFaction(source)==='wu'){
    markSkillSound(g,'救援');
    return 2;
  }
  return 1;
}

// ===== 孙策【魂姿】觉醒后获得【英姿】【英魂】 =====
function maybeAwakenHunzi(g, seat){
  const p=g.players[seat];
  if(!p || !p.alive || !hasCap(p,'hunzi') || p.hunziAwakened || p.hp!==1) return false;
  p.hunziAwakened=true;
  p.maxHp=Math.max(1,p.maxHp-1);
  if(p.hp>p.maxHp) p.hp=p.maxHp;
  p.caps=p.caps||{};
  p.caps.extraDrawPhase=1;
  p.caps.yinghun=true;
  g.log=pushLog(g.log,p.name+' 发动【魂姿】觉醒,减1点体力上限并获得【英姿】和【英魂】');
  markSkillSound(g,'魂姿');
  return true;
}
function maybeStartYinghun(g, seat){
  const p=g.players[seat];
  if(!p || !p.alive || !hasCap(p,'yinghun')) return false;
  const x=Math.max(0,p.maxHp-p.hp);
  if(x<=0 || !g.players.some((q,i)=>i!==seat && q && q.alive)) return false;
  g.pending=setResponseAskedAt({type:'yinghunTarget',seat,x});
  g.phase='yinghunTarget';
  g.log=pushLog(g.log,p.name+' 可以发动【英魂】,请选择一名其他角色…');
  return true;
}
function chooseYinghunTarget(targetSeat){
  tx(g=>{
    if(g.phase!=='yinghunTarget'||!g.pending||g.pending.type!=='yinghunTarget'||g.pending.seat!==mySeat) return g;
    const target=g.players[targetSeat];
    if(!target||!target.alive||targetSeat===mySeat) return g;
    g.pending=setResponseAskedAt({type:'yinghunChoice',seat:mySeat,targetSeat,x:g.pending.x});
    g.phase='yinghunChoice';
    return g;
  });
}
function respondYinghunChoice(option){
  tx(g=>{
    if(g.phase!=='yinghunChoice'||!g.pending||g.pending.type!=='yinghunChoice'||g.pending.seat!==mySeat) return g;
    const d=g.pending,target=g.players[d.targetSeat],x=Math.max(1,d.x||1);
    if(!target||!target.alive) return g;
    const drawCount=option==='drawX' ? x : 1;
    const discardCount=option==='drawX' ? 1 : x;
    ensureDeck(g); drawN(g,d.targetSeat,drawCount);
    const discardable=(target.hand||[]).length+EQUIP_SLOTS.filter(slot=>target.equips&&target.equips[slot]).length;
    const actualDiscard=Math.min(discardCount,discardable);
    g.log=pushLog(g.log,g.players[d.seat].name+' 发动【英魂】,令 '+target.name+' 摸'+drawCount+'张牌并弃置'+actualDiscard+'张牌');
    markSkillSound(g,'英魂');
    if(actualDiscard>0){
      g.pending=setResponseAskedAt({type:'yinghunDiscard',ownerSeat:d.seat,targetSeat:d.targetSeat,remaining:actualDiscard});
      g.phase='yinghunDiscard';
      return g;
    }
    g.pending=null; g.phase='play'; continueHuashenChangeCheckAtTurnStart(g,d.seat);
    return g;
  });
}
function discardYinghunCard(selection){
  tx(g=>{
    if(g.phase!=='yinghunDiscard'||!g.pending||g.pending.type!=='yinghunDiscard'||g.pending.targetSeat!==mySeat) return g;
    const d=g.pending,target=g.players[mySeat];
    const choice=typeof selection==='number'?{kind:'hand',idx:selection}:selection;
    let card=null,lostEquip=false;
    if(choice&&choice.kind==='hand'&&Number.isInteger(choice.idx)) card=removeHandCards(g, mySeat, choice.idx)[0];
    else if(choice&&choice.kind==='equip'&&EQUIP_SLOTS.includes(choice.slot)&&target.equips&&target.equips[choice.slot]){
      card=target.equips[choice.slot]; target.equips[choice.slot]=null; lostEquip=true;
    }
    if(!card) return g;
    g.discard.push(card); d.remaining--;
    markDiscardReveal(g, d.targetSeat, [card]);
    g.log=pushLog(g.log,target.name+' 因【英魂】弃置一张牌');
    const noCards=(target.hand||[]).length+EQUIP_SLOTS.filter(slot=>target.equips&&target.equips[slot]).length===0;
    if(d.remaining<=0 || noCards){
      const owner=d.ownerSeat; g.pending=null; g.phase='play'; continueHuashenChangeCheckAtTurnStart(g,owner);
    }else setResponseAskedAt(d);
    if(lostEquip) triggerHook(g,mySeat,'onLoseEquip',{count:1});
    return g;
  });
}
function cancelYinghun(){
  tx(g=>{
    if(g.phase!=='yinghunTarget'||!g.pending||g.pending.type!=='yinghunTarget'||g.pending.seat!==mySeat) return g;
    const seat=g.pending.seat;
    g.pending=null; g.phase='play';
    continueHuashenChangeCheckAtTurnStart(g,seat);
    return g;
  });
}

// ===== 孙策【制霸】:其他吴势力角色的出牌阶段限一次,可以与主公孙策拼点 =====
function canTriggerZhiba(g, seat){
  const p=g.players[seat];
  if(!p || !p.alive) return false;
  if(g.phase!=='play' || g.turn!==seat) return false; // 仅自己的出牌阶段可发动
  if(g.gameMode!=='identity') return false;
  if(generalFaction(p)!=='wu') return false;
  if(g.zhibaUsed) return false;
  if((p.hand||[]).length===0) return false;
  return g.players.some((q,i)=>i!==seat && q && q.alive && q.role==='zhu' && hasCap(q,'zhiba') && (q.hand||[]).length>0);
}
function startZhiba(cardIdx){
  tx(g=>{
    if(!canTriggerZhiba(g, mySeat)) return g;
    const challenger=g.players[mySeat];
    const lordSeat=g.players.findIndex((q,i)=>i!==mySeat && q && q.alive && q.role==='zhu' && hasCap(q,'zhiba') && (q.hand||[]).length>0);
    const card=(challenger.hand||[])[cardIdx];
    if(lordSeat<0 || !card) return g;
    removeHandCards(g, mySeat, cardIdx);
    g.zhibaUsed=true;
    g.pending=setResponseAskedAt({type:'zhibaAsk', lordSeat, challengerSeat:mySeat, challengerCard:card, resume:{phase:'play', pending:null}});
    g.phase='zhibaAsk';
    g.log=pushLog(g.log, challenger.name+' 发动 '+g.players[lordSeat].name+' 的主公技【制霸】,请求拼点');
    markSkillSound(g, '制霸');
    return g;
  });
}
// 孙策选择拼点牌。魂姿觉醒后可用 cardIdx=-1 拒绝。
function respondZhiba(cardIdx){
  tx(g=>{
    if(g.phase!=='zhibaAsk' || !g.pending || g.pending.type!=='zhibaAsk') return g;
    if(g.pending.lordSeat!==mySeat) return g;
    const d=g.pending,lord=g.players[mySeat],challenger=g.players[d.challengerSeat];
    if(!lord || !lord.alive || lord.role!=='zhu' || !hasCap(lord,'zhiba') || !challenger || !challenger.alive ||
       d.challengerSeat===mySeat || generalFaction(challenger)!=='wu' || !d.challengerCard){
      if(d.challengerCard) g.discard.push(d.challengerCard);
      g.pending=null; g.phase='play'; return g;
    }
    if(cardIdx===-1 && lord.hunziAwakened){
      challenger.hand.push(d.challengerCard);
      g.log=pushLog(g.log,lord.name+' 拒绝了 '+challenger.name+' 的【制霸】拼点');
      g.pending=null; g.phase='play'; return g;
    }
    const card=(lord.hand||[])[cardIdx];
    if(!card) return g;
    removeHandCards(g, mySeat, cardIdx);
    const challengerWin=(d.challengerCard.rank||0)>(card.rank||0);
    if(challengerWin){
      g.discard.push(d.challengerCard,card);
    }else{
      g.pending=setResponseAskedAt({type:'zhibaGain',lordSeat:mySeat,cards:[d.challengerCard,card]});
      g.phase='zhibaGain';
      g.log=pushLog(g.log, challenger.name+' 出 '+pointText(d.challengerCard)+', '+lord.name+' 出 '+pointText(card)+', '+challenger.name+'没赢,主公可以获得两张拼点牌');
      return g;
    }
    g.log=pushLog(g.log, challenger.name+' 出 '+pointText(d.challengerCard)+', '+lord.name+' 出 '+pointText(card)+', 拼点'+challenger.name+'赢');
    g.pending=null;
    g.phase='play';
    return g;
  });
}
function respondZhibaGain(take){
  tx(g=>{
    if(g.phase!=='zhibaGain'||!g.pending||g.pending.type!=='zhibaGain'||g.pending.lordSeat!==mySeat) return g;
    const d=g.pending,lord=g.players[mySeat];
    if(take){ lord.hand.push(...d.cards); g.log=pushLog(g.log,lord.name+' 发动【制霸】,获得两张拼点牌'); }
    else { g.discard.push(...d.cards); g.log=pushLog(g.log,lord.name+' 不获得【制霸】拼点牌'); }
    g.pending=null; g.phase='play'; return g;
  });
}

// respondShan: 出闪响应。吕布【无双】(锁定技):攻击者是吕布时,needed=2——打出一张闪不够,
// g.pending.shanCount 记差几张,留在 respond 阶段原样再问一次(按钮/阶段都不变,只是 hint
// 文案会提示"还差几张");不选择继续出闪就按原逻辑直接受伤,已打出的闪不退回、只扣1点血。
// cardIdx(可选):玩家在"有多个候选牌可当闪"时(真实闪+龙胆转化的杀)明确选中的那一张手牌下标。
// 不传(或非法)就回退 findUsableAs 自动挑第一张,完全向后兼容——候选只有1张时客户端不需要
// 传这个参数。服务端必须对传入的下标做 canUseAs 合法性复核,不能盲信客户端("UI 漏判也拦得住"
// 的既有原则),下标不合法时静默按"没传"处理,不能让非法输入直接导致状态异常或被拒绝卡死。

function endPlay(onCommitted){
  tx(g=>{
    if(g.phase!=='play'||g.turn!==mySeat) return g;
    // 正常结束出牌阶段:仍要检查张郃【巧变】是否也跳过了弃牌阶段(理论上和"正常走完出牌阶段"
    // 不冲突——巧变一回合限一次,选了"出牌阶段"就不会再选"弃牌阶段",但不能假设这里一定
    // 不会发生,统一走 advancePastDiscard 判断,不重复写一遍 if/else)。
    advancePastDiscard(g);
    return g;
  }, onCommitted);
}
// 弃牌阶段手牌上限:基础 = 体力值。袁术【妄尊】令主公本回合上限 -1(仅身份局主公生效,
// gameMode 守卫防脏数据;lordHandCap 只在主公 startTurn 时由妄尊置 1、每次 startTurn 重置)。
function handCapLimit(g, seat){
  const p=g.players[seat];
  if(!p) return 0;
  let cap=p.hp;
  if(g.gameMode==='identity' && p.role==='zhu' && Number.isInteger(g.lordHandCap) && g.lordHandCap>0){
    cap-=g.lordHandCap;
  }
  // 袁绍【血裔】:仅作为身份局主公时生效,其他群势力角色每名令上限+2。
  if(g.gameMode==='identity' && p.role==='zhu' && hasCap(p,'xueyi')){
    const others=g.players.filter((q,i)=>i!==seat && q && q.alive && generalFaction(q)==='qun').length;
    cap+=others*2;
  }
  return Math.max(cap,0);
}
function discardCard(cardIdx){
  tx(g=>{
    if(g.phase!=='discard'||g.turn!==mySeat) return g;
    const me=g.players[mySeat];
    if(me.hand.length<=handCapLimit(g, mySeat)) return g;
    const card=removeHandCards(g, mySeat, cardIdx)[0]; g.discard.push(card);
    markDiscardReveal(g, mySeat, [card]);
    if(g.liRangRecord && g.liRangRecord.round===g.roundNum && g.liRangRecord.to===mySeat){
      g.liRangRecord.discarded = g.liRangRecord.discarded || [];
      g.liRangRecord.discarded.push(card);
    }
    g.log=pushLog(g.log, me.name+' 弃置一张牌');
    // 曹植【落英】
    if(maybeStartLuoying(g, mySeat, [card], 'discard', {phase:'discard'})) return g;
    return g;
  });
}
// discardCards: 弃牌阶段"多选后统一确认"的批量版本——UI 改成点击只是勾选/取消勾选,累积选好
// 几张,最后点"确认弃牌"才一次性提交到这里(不再是discardCard那种"点一张立即弃一张")。
// discardCard 本身保留不删,防止其它地方还在单独调用它,只是弃牌阶段UI不再走这个入口。
function discardCards(cardIdxList){
  tx(g=>{
    if(g.phase!=='discard'||g.turn!==mySeat) return g;
    const me=g.players[mySeat];
    if(!Array.isArray(cardIdxList) || cardIdxList.length===0) return g;
    // 校验:下标不重复、不越界
    const uniqueIdx = [...new Set(cardIdxList)];
    if(uniqueIdx.length!==cardIdxList.length) return g;
    if(!uniqueIdx.every(i=>Number.isInteger(i) && i>=0 && i<me.hand.length)) return g;
    const need = me.hand.length - handCapLimit(g, mySeat);
    if(need<=0) return g; // 没有超出上限,不需要弃牌
    if(cardIdxList.length < need) return g; // 弃的不够,拒绝(必须一次性弃够,不允许弃少了留着下次再弃)
    // 按下标从大到小依次移除,避免删除时下标错位(统一走 removeHandCards,内部触发连营)
    const sorted = [...uniqueIdx].sort((a,b)=>b-a);
    const discarded = removeHandCards(g, mySeat, sorted);
    g.discard.push(...discarded);
    markDiscardReveal(g, mySeat, discarded);
    // 凌统【旋风】:更新弃牌计数器
    g.discardedThisPhase = (g.discardedThisPhase || 0) + discarded.length;
    // 孔融【礼让】记录:和 discardCard 单张版本同一段逻辑,只是这里批量循环每一张都要记
    // (礼让回收的是"本弃牌阶段弃置的全部牌",不能因为改成批量提交就漏记)。
    if(g.liRangRecord && g.liRangRecord.round===g.roundNum && g.liRangRecord.to===mySeat){
      g.liRangRecord.discarded = g.liRangRecord.discarded || [];
      g.liRangRecord.discarded.push(...discarded);
    }
    g.log=pushLog(g.log, me.name+' 弃置了'+discarded.length+'张牌');
    // 曹植【落英】
    if(maybeStartLuoying(g, mySeat, discarded, 'discard', {phase:'discard'})) return g;
    return g;
  });
}
function endTurn(){
  tx(g=>{
    if(g.phase!=='discard'||g.turn!==mySeat) return g;
    const me=g.players[mySeat];
    const overLimit=me.hand.length>handCapLimit(g,mySeat);
    if(overLimit && !canSkipDiscard(g, mySeat)) return g; // 手牌超上限必须先弃;克己满足则放行
    if(overLimit && canSkipDiscard(g,mySeat)) markSkillSound(g,'克己');
    if(hasSkillName(me,'血裔') && g.gameMode==='identity' && me.role==='zhu'){
      const baseCap=Math.max(me.hp-(Number.isInteger(g.lordHandCap)?g.lordHandCap:0),0);
      if(me.hand.length>baseCap && me.hand.length<=handCapLimit(g,mySeat)) markSkillSound(g,'血裔');
    }
    if(maybeStartLiRangRecover(g, mySeat)) return g;
    // 贾诩完杀：回合结束时清理状态
    g.wanshaActive = false; g.wanshaDyingSeat = null;
    // 陈宫【智迟】：在回合结束时清理免疫状态
    if(g.zhichiImmunity && g.zhichiImmunity.turn === g.turn){
      g.zhichiImmunity = null;
    }
    // 乐进【骁果】只在"正常走完弃牌阶段、即将结束回合"这里触发。
    // 有候选人则挂起;无人可问则直接 continueEndPhaseAfterXiaoguo(旋风/举荐/据守)。
    {
      const xiaoguoAsker = nextXiaoguoAsker(g, mySeat, mySeat);
      if(xiaoguoAsker !== null){
        g.pending=setResponseAskedAt({type:'xiaoguo', endingSeat:mySeat, asking:xiaoguoAsker});
        g.phase='xiaoguo';
        g.log=pushLog(g.log, '结束阶段:询问 '+g.players[xiaoguoAsker].name+' 是否发动【骁果】…');
        return g;
      }
    }
    continueEndPhaseAfterXiaoguo(g, mySeat);
    return g;
  });
}
// finishTurn: 回合结束的统一入口,链条 finishTurn -> continueHuashenChangeCheckAtTurnEnd ->
// continueBiyueCheck -> startTurn(nextAlive)。之所以从原来的单个if/else重构成链条:
// 借来的【闭月】和左慈自己的"更改化身"是两个各自独立、可能同时成立的回合结束可选技能,
// if/else-if只能问一个、会让后问的那个被静默跳过,必须拆成两个独立链接分别询问。
function finishTurn(g, endingSeat){
  continueHuashenChangeCheckAtTurnEnd(g, endingSeat);
}
function continueHuashenChangeCheckAtTurnEnd(g, endingSeat){
  const p = g.players[endingSeat];
  if(p && p.alive && hasCap(p,'huashen') && p.huashenGeneral!==null){
    // 【超时修复】同 continueHuashenChangeCheckAtTurnStart——setResponseAskedAt 补时间戳,
    // 否则30秒自动超时机制对这个phase无效(g.pending.askedAt 是 undefined,
    // maybeAutoRespondTimeout 的守卫直接拦掉)。
    g.pending = setResponseAskedAt({type:'huashenChangeAskEnd', seat:endingSeat});
    g.phase = 'huashenChangeAskEnd';
    g.log = pushLog(g.log, p.name+' 是否更改【化身】声明的技能…');
    return;
  }
  continueBiyueCheck(g, endingSeat);
}
function continueBiyueCheck(g, endingSeat){
  const p=g.players[endingSeat];
  if(p && p.alive && hasCap(p,'biyue')){
    // 貂蝉【闭月】:回合结束摸1张牌,零代价、零下行风险,不再询问,直接生效。
    drawN(g, endingSeat, 1);
    g.log=pushLog(g.log, p.name+' 发动【闭月】,摸1张牌');
    markSkillSound(g, '闭月');
    startTurn(g, nextAlive(g, endingSeat));
    return;
  }
  startTurn(g, nextAlive(g, endingSeat));
}

// 凌统【旋风】相关函数
// 选择旋风目标
function pickXuanfengTarget(seat) {
  tx(g => {
    const pending = g.pending;
    if (!pending || pending.type !== 'xuanfengPick' || pending.from !== mySeat) return g;
    
    const me = g.players[mySeat];
    const target = g.players[seat];
    
    // 不能选择自己
    if (seat === mySeat) {
      g.log = pushLog(g.log, `${me.name} 不能选择自己作为【旋风】目标`);
      return g;
    }
    
    // 目标必须存活
    if (!target || !target.alive) {
      g.log = pushLog(g.log, `${me.name} 选择的目标 ${target ? target.name : '未知角色'} 已死亡`);
      return g;
    }
    
    // 同一目标只能选择一次。旧实现允许重复选择同一目标，但第二次会覆盖第一次记录的
    // discardedCounts，同时再次扣减 maxRemaining，最终出现“日志说选了两张、实际只弃一张”。
    const available = (target.hand || []).length +
      EQUIP_SLOTS.filter(slot => target.equips && target.equips[slot]).length +
      (target.delays || []).length;
    if (available <= 0) return g;

    pending.stage = 'chooseCard';
    pending.currentTargetSeat = seat;
    g.log = pushLog(g.log, `${me.name} 选择 ${target.name} 作为【旋风】目标,请选择要弃置的牌`);
    
    return g;
  });
}

// 选择弃置的牌数
function chooseXuanfengDiscardCount(count) {
  tx(g => {
    const pending = g.pending;
    if (!pending || pending.type !== 'xuanfengPick' || pending.from !== mySeat) return g;
    
    if (pending.stage !== 'chooseCount') return g;
    
    const me = g.players[mySeat];
    const targetSeat = pending.targets[pending.currentTargetIndex];
    const target = g.players[targetSeat];
    
    const available = (target.hand || []).length +
      EQUIP_SLOTS.filter(slot => target.equips && target.equips[slot]).length +
      (target.delays || []).length;

    // 检查数量是否合法。0表示放弃刚选的这个目标，不能留下一个0张的幽灵目标。
    if (!Number.isInteger(count) || count < 0 || count > pending.maxRemaining || count > available) {
      g.log = pushLog(g.log, `${me.name} 选择的弃牌数无效`);
      return g;
    }

    if (count === 0) {
      pending.targets.splice(pending.currentTargetIndex, 1);
      pending.discardedCounts.splice(pending.currentTargetIndex, 1);
      pending.currentTargetIndex = null;
      pending.stage = 'selecting';
      return g;
    }
    
    // 更新弃牌数量
    pending.discardedCounts[pending.currentTargetIndex] = count;
    pending.maxRemaining -= count;
    
    // 如果还有剩余可弃置牌数且还有其他目标可以选择
    if (pending.maxRemaining > 0) {
      // 回到目标选择阶段
      pending.stage = 'selecting';
      g.log = pushLog(g.log, `${me.name} 还可以弃置${pending.maxRemaining}张牌,请继续选择目标`);
    } else {
      // 开始执行旋风
      executeXuanfeng(g);
    }
    
    return g;
  });
}

// 手牌不可见，只能随机弃；装备区与判定区是明牌，可以指定。
function pickXuanfengCard(kind, value) {
  tx(g => {
    const pending=g.pending;
    if(!pending || pending.type!=='xuanfengPick' || pending.from!==mySeat || pending.stage!=='chooseCard') return g;
    const targetSeat=pending.currentTargetSeat;
    const target=g.players[targetSeat];
    if(!target || !target.alive || pending.maxRemaining<=0) return g;
    if(!Array.isArray(pending.selections)) pending.selections=[];
    let selection=null;
    if(kind==='hand'){
      const already=pending.selections.filter(s=>s.targetSeat===targetSeat && s.kind==='hand').length;
      if((target.hand||[]).length<=already) return g;
      selection={targetSeat, kind:'hand'};
    } else if(kind==='equip'){
      const slot=String(value||'');
      if(!EQUIP_SLOTS.includes(slot) || !target.equips || !target.equips[slot]) return g;
      if(pending.selections.some(s=>s.targetSeat===targetSeat && s.kind==='equip' && s.value===slot)) return g;
      selection={targetSeat, kind:'equip', value:slot};
    } else if(kind==='delay'){
      const idx=Number(value);
      if(!Number.isInteger(idx) || idx<0 || idx>=(target.delays||[]).length) return g;
      if(pending.selections.some(s=>s.targetSeat===targetSeat && s.kind==='delay' && s.value===idx)) return g;
      selection={targetSeat, kind:'delay', value:idx, cardId:target.delays[idx].id};
    } else return g;
    pending.selections.push(selection);
    pending.maxRemaining--;
    pending.currentTargetSeat=null;
    pending.stage='selecting';
    if(pending.maxRemaining===0) executeXuanfeng(g);
    return g;
  });
}

// “至多两张”允许只弃一张后主动结束。旧UI没有这个出口，玩家选1张后只能继续凑满2张，
// 或点“取消”把整次旋风作废，造成“日志显示发动、实际没有弃牌”的直接体验。
function finishXuanfengSelection() {
  tx(g => {
    const pending = g.pending;
    if (!pending || pending.type !== 'xuanfengPick' || pending.from !== mySeat || pending.stage !== 'selecting') return g;
    const selectedCount = Array.isArray(pending.selections) && pending.selections.length
      ? pending.selections.length
      : (pending.discardedCounts || []).reduce((sum, count) => sum + count, 0);
    if (selectedCount <= 0 || selectedCount > 2) return g;
    executeXuanfeng(g);
    return g;
  });
}

// 执行旋风效果
function executeXuanfeng(g) {
  const pending = g.pending;
  if (!pending || pending.type !== 'xuanfengPick') return g;
  
  const me = g.players[pending.from];
  const selections = Array.isArray(pending.selections) ? pending.selections : [];
  if(selections.length){
    for(const selection of selections){
      const targetSeat=selection.targetSeat;
      const target=g.players[targetSeat];
      if(!target || !target.alive) continue;
      let card=null;
      if(selection.kind==='hand'){
        const hand=target.hand||[];
        if(hand.length) card=removeHandCards(g, targetSeat, Math.floor(Math.random()*hand.length))[0];
      } else if(selection.kind==='equip'){
        const slot=selection.value;
        if(EQUIP_SLOTS.includes(slot) && target.equips && target.equips[slot]){
          card=target.equips[slot];
          target.equips[slot]=null;
          triggerHook(g, targetSeat, 'onLoseEquip', {count:1});
        }
      } else if(selection.kind==='delay'){
        let idx=(target.delays||[]).findIndex(c=>c && selection.cardId!=null && c.id===selection.cardId);
        if(idx<0) idx=selection.value;
        if(Number.isInteger(idx) && target.delays && target.delays[idx]){
          card=target.delays.splice(idx,1)[0];
          restoreOriginalCardName(card);
        }
      }
      if(card){
        g.discard.push(card);
        markDiscardReveal(g, targetSeat, [card]);
        g.log=pushLog(g.log, `${me.name} 发动【旋风】,弃置了 ${target.name} 的【${card.name}】`);
      }
    }
  } else {
  const targets = pending.targets;
  const counts = pending.discardedCounts;
  
  // 按照目标顺序依次弃置牌
  for (let i = 0; i < targets.length; i++) {
    const targetSeat = targets[i];
    const target = g.players[targetSeat];
    const discardCount = counts[i];
    
    if (!target || !target.alive || discardCount <= 0) continue;
    
    // 弃置目标角色的牌（随机弃置，符合标准规则）
    const cardsToDiscard = [];
    const hand = target.hand || [];
    const equips = target.equips || {};
    const delays = target.delays || [];
    
    // 收集所有可弃置的牌
    const allDiscardable = [...hand];
    // 添加装备区的牌
    ['weapon', 'armor', 'plus1', 'minus1'].forEach(slot => {
      if (equips[slot]) allDiscardable.push(equips[slot]);
    });
    // 添加判定区的牌
    allDiscardable.push(...delays);
    
    // 随机选择要弃置的牌（最多 discardCount 张）
    const shuffled = [...allDiscardable].sort(() => Math.random() - 0.5);
    const toDiscard = Math.min(discardCount, shuffled.length);
    const selectedCards = shuffled.slice(0, toDiscard);
    
    // 从原数组中移除被选中的牌
    for (const card of selectedCards) {
      // 从手牌中移除
      const handIndex = hand.indexOf(card);
      if (handIndex !== -1) {
        removeHandCards(g, targetSeat, handIndex);
        cardsToDiscard.push(card);
        continue;
      }
      
      // 从装备区中移除
      let equipFound = false;
      for (const slot of ['weapon', 'armor', 'plus1', 'minus1']) {
        if (equips[slot] === card) {
          equips[slot] = null;
          cardsToDiscard.push(card);
          triggerHook(g, targetSeat, 'onLoseEquip', { count: 1 });
          equipFound = true;
          break;
        }
      }
      if (equipFound) continue;
      
      // 从判定区中移除
      const delayIndex = delays.indexOf(card);
      if (delayIndex !== -1) {
        delays.splice(delayIndex, 1);
        restoreOriginalCardName(card);
        cardsToDiscard.push(card);
      }
    }
    
    // 将弃置的牌放入弃牌堆
    g.discard.push(...cardsToDiscard);
    markDiscardReveal(g, targetSeat, cardsToDiscard);
    
    g.log = pushLog(g.log, `${me.name} 发动【旋风】,令 ${target.name} 随机弃置${cardsToDiscard.length}张牌`);
  }
  }
  
  // 清理pending状态
  const endingSeat = (pending.endingSeat != null) ? pending.endingSeat : pending.from;
  const trigger = pending.trigger;
  const resume = pending.resume; // 杀结算中触发时(麒麟弓/猛进)由注入点挂上的续接标记,见下
  g.pending = null;
  markSkillSound(g, '旋风');
  // 旋风收尾分三种去向:
  // ①弃牌阶段结束触发:继续举荐/据守(原有);
  // ②杀结算中途触发(麒麟弓/猛进):pending.resume 存在 → 走 resumeAfterInterrupt 接回被打断的杀
  //   收尾尾巴(方天队列推进 / 回 play),和濒死/遗计打断杀命中时完全同一套 resume 范式,零新模式;
  // ③独立失去装备触发(顺手/拆桥/借刀):无 resume → 恢复到失去装备那一刻的休止相(原有,不变)。
  if(trigger === 'discard'){
    continueEndPhaseAfterXuanfeng(g, endingSeat);
  } else if(resume){
    resumeAfterInterrupt(g, resume, endingSeat);
  } else {
    g.phase = pending.previousPhase || g.phase;
  }

  return g;
}

// 取消旋风发动
function cancelXuanfeng() {
  tx(g => {
    if (g.pending && g.pending.type === 'xuanfengPick' && g.pending.from === mySeat) {
      const me = g.players[mySeat];
      const pending = g.pending;
      const endingSeat = (pending.endingSeat != null) ? pending.endingSeat : pending.from;
      const trigger = pending.trigger;
      const resume = pending.resume; // 同 executeXuanfeng:杀结算中触发时的续接标记
      g.pending = null;
      g.log = pushLog(g.log, me.name + ' 取消发动【旋风】');
      // 三种去向同 executeXuanfeng——"选择不发动"和"弃满2张"两条收尾路径必须一致:无论旋风有没有
      // 实际弃牌,被打断的杀收尾都必须继续,否则会漏 checkWin/方天队列、软锁。
      if(trigger === 'discard'){
        continueEndPhaseAfterXuanfeng(g, endingSeat);
      } else if(resume){
        resumeAfterInterrupt(g, resume, endingSeat);
      } else {
        g.phase = pending.previousPhase || 'play';
      }
    }
    return g;
  });
}

// advanceXiaoguo: (重新)找下一个有资格的候选人问;问完(或从一开始就没人有资格)则真正切换回合。
// 每个候选人发动或不发动之后都会调这个函数继续找下一个,直到问完一圈——理论上支持多个乐进都发动。
// **真实bug修复**:asker===null(问完一圈,没人发动)分支曾经直接调用 finishTurn,没有先把
// g.pending 置空——finishTurn/startTurn 这条链假定"进来时 pending 已经是 null",一旦这条
// 假定被违反,骁果这个已经问完、毫无意义的 pending 对象就会原样带进下一个玩家的整个回合,
// pruneExchangeCards 的 !g.pending 条件因此永远无法满足,导致这期间任何装备/出牌都会卡在
// 中央出牌区不消失,直到未来某个完全不相关的动作自己的收尾逻辑碰巧把 g.pending 置空为止
// (真实复现:乐进装备赤兔、黄忠装备绝影,两张牌都卡着不消失,直到后续一次杀伤害结算才
// 一起清空——见 CLAUDE.md 对应条目)。这不是"信号设计得不够精细",pruneExchangeCards 的
// !pending&&!aoe 判断本身完全够用、反应也很及时,问题纯粹是这个字段没有被正确置空。
// 这里是骁果这整条链**唯一**"决定问完、交出控制权"的地方,修在这一处能同时覆盖
// endTurn()/respondXiaoguo(false)/respondXiaoguoChoice 三条进入路径,不需要在各个调用点
// 分别打补丁——这是"循环型响应函数必须在结束分支显式置空pending"这条通用约定的一个实例,
// 同类模式见 enterDrawPhase(洛神)的说明。
function advanceXiaoguo(g, endingSeat, current){
  const asker=nextXiaoguoAsker(g, endingSeat, current);
  // 骁果问完一圈:必须先置空 pending,再交结束阶段后续(旋风/举荐/据守/finishTurn)。
  // 若不清空,过期 xiaoguo pending 会漏进下一回合,卡住中央出牌区(见 050d965 同类修复)。
  // ⚠️ continueEndPhaseAfterXiaoguo 自己内部就会在链条(旋风→举荐→据守)问完之后调用
  // finishTurn(见其函数体末尾及各个"没有更多可发动的技能"分支),这里不能再额外补一次——
  // 这行以前是 g.pending=null; continueEndPhaseAfterXiaoguo(g,endingSeat); finishTurn(g,endingSeat); return;
  // 那个多余的 finishTurn 调用是 2026-07-13 一次三方合并(f0c2b4890935)把两条分支各自
  // 独立正确的修改叠加在一起产生的遗留 bug:continueEndPhaseAfterXiaoguo 如果在中途挂起了
  // 旋风(或举荐/据守)的新 pending 并 return,这里紧跟着无条件执行的 finishTurn 会在同一次
  // tx 里把刚挂起的 pending 冲掉、直接推进到下一回合——和 endTurn() 自己调用
  // continueEndPhaseAfterXiaoguo(g,mySeat);return g;（其后没有多余的 finishTurn）是同一条链、
  // 同一个约定,两处调用方式必须一致。
  if(asker===null){ g.pending=null; continueEndPhaseAfterXiaoguo(g, endingSeat); return; }
  g.pending=setResponseAskedAt({type:'xiaoguo', endingSeat, asking:asker});
  g.phase='xiaoguo';
  g.log=pushLog(g.log, '结束阶段:询问 '+g.players[asker].name+' 是否发动【骁果】…');
}
// 骁果之后的结束阶段技能链:旋风 → 举荐 → 据守 → finishTurn
// 骁果/旋风挂起 return 后必须回到这里,否则举荐/据守永不触发
function continueEndPhaseAfterXiaoguo(g, endingSeat){
  const me = g.players[endingSeat];
  if(!me || !me.alive){
    finishTurn(g, endingSeat);
    return;
  }
  // 凌统【旋风】：弃牌阶段弃置过至少两张牌时触发
  if (hasCap(me, 'xuanfeng') && me.alive && !g.xuanfengDiscardUsed) {
    const discardCount = g.discardedThisPhase || 0;
    if (discardCount >= 2) {
      g.pending = {
        type: 'xuanfengPick',
        from: endingSeat,
        trigger: 'discard',
        targets: [],
        discardedCounts: [],
        selections: [],
        maxRemaining: 2,
        stage: 'selecting',
        previousPhase: 'discard',
        endingSeat: endingSeat
      };
      g.xuanfengDiscardUsed = true;
      g.phase = 'xuanfengPick';
      g.log = pushLog(g.log, me.name + ' 可以发动【旋风】,弃置其他角色的共计至多两张牌');
      return;
    }
  }
  continueEndPhaseAfterXuanfeng(g, endingSeat);
}
function continueEndPhaseAfterXuanfeng(g, endingSeat){
  const me = g.players[endingSeat];
  if(!me || !me.alive){
    finishTurn(g, endingSeat);
    return;
  }
  // 徐庶【举荐】
  if (hasCap(me, 'jujian') && me.alive && !me.jujianUsed) {
    const hasNonBasic = (me.hand || []).some(c => c && c.name && !BASIC_CARDS.includes(c.name));
    const hasOther = g.players.some((p, i) => i !== endingSeat && p && p.alive);
    if (hasNonBasic && hasOther) {
      g.pending = { type: 'jujianPickCard', sourceSeat: endingSeat, endingSeat: endingSeat };
      g.phase = 'jujianPickCard';
      g.log = pushLog(g.log, me.name + ' 是否发动【举荐】…');
      return;
    }
  }
  // 曹仁【据守】
  if (hasCap(me, 'jushou') && me.alive && me.faceup !== false) {
    g.pending = { type: 'jushouChoose', seat: endingSeat };
    g.phase = 'jushouChoose';
    g.log = pushLog(g.log, me.name + ' 可以发动【据守】,是否摸三张牌并翻面?');
    return;
  }
  finishTurn(g, endingSeat);
}
// startTurn: 统一的"切到某人回合开始"入口(endTurn 正常换人、决斗/濒死里回合玩家阵亡换人 都走这里)。
// 顺序:先声明轮到谁,再问张郃是否发动【巧变】(可能连判定阶段本身都跳过,必须在结算判定区
// 之前问),再结算判定区(回合开始的判定阶段,在摸牌之前),最后进摸牌阶段。
function startTurn(g, seat){
  if(!Array.isArray(g.roundSeatsActed)) g.roundSeatsActed=[];
  if(!Number.isInteger(g.roundNum)) g.roundNum=1;
  if(g.roundSeatsActed.includes(seat)){
    g.roundNum++;
    g.roundSeatsActed=[seat];
  } else {
    g.roundSeatsActed.push(seat);
  }
  // 翻面状态检查：如果处于翻面状态（背面朝上），则跳过回合
  const p = g.players[seat];
  if(p && p.alive && p.faceup === false) {
    p.faceup = true; // 翻回正面
    g.log=pushLog(g.log, p.name + ' 处于翻面状态，跳过回合并翻回正面');
    // 不可调 endTurn():endTurn 自开 tx 且要求 phase==='discard'。同函数内直接推进下一存活座位。
    startTurn(g, nextAlive(g, seat));
    return;
  }
  g.players.forEach(p=>{ if(p) p.shuangxiongColor=null; });
  g.turn=seat; g.shaUsed=false; g.shaPlayedInDuel=false; g.duanliangUsed=false; g.tiaoxinUsed=false; g.zhihengUsed=false; g.renDeCount=0; g.qingNangUsed=false; g.quHuUsed=false; g.liJianUsed=false; g.fanJianUsed=false; g.guhuoUsed=false; g.jiuUsed=false; g.luoyiActive=false; g.sanyaoUsed=false; g.dimengUsed=false; g.huanhuoUsed=false; g.tianyiUsed=false; g.tianyiWin=false; g.tianyiLose=false; g.qiangxiUsed=false; g.mingceUsed=false; g.xuanfengDiscardUsed=false; g.discardedThisPhase=0; g.jiangchiExtraShaLeft=0; g.jijiangUsed=false; g.hujiaUsed=false; g.zhibaUsed=false; g.lordHandCap=0;
  
  // 丁奉【奋迅】:重置当前回合玩家的专属状态
  const currentPlayer = g.players[seat];
  g.players.forEach(p=>{ if(p) p.jiuShaBonus=false; });
  // 曹彰【将驰】是"本回合"限定,必须对【所有人】清 —— 只清 currentPlayer 的话,曹彰在自己
  // 回合设下的标志要等他【下一个】回合开始才失效,中间所有人的回合都还带着它(实测跨了
  // 整整一圈)。放进这个 forEach 后,曹彰回合一结束、下一个人 startTurn 就清掉,正好等价于
  // 官方的"本回合结束时失效"(曹彰自己的结束阶段仍在他回合内,标志还在,也是对的)。
  // 写法对齐同一批的 shuangxiongColor/jiuShaBonus,不新造模式。
  g.players.forEach(p=>{ if(p){ p.jiangchiNoSlash=false; p.jiangchiNoDistance=false; } });
  if(currentPlayer) {
    currentPlayer.fenxunUsed = false;
    currentPlayer.fenxunTarget = null;
    currentPlayer.jujianUsed = false;
    currentPlayer.huangtianUsed = false;
  }
  // 贾诩完杀：回合开始时重置状态
  g.wanshaActive = false; g.wanshaDyingSeat = null;
  // 夏侯渊【神速】:shensuUsed1/shensuUsed2 各自独立重置,不是共用一个标志位。
  g.shensuUsed1 = false; g.shensuUsed2 = false; g.shensuSkipJudgingAndDraw = false; g.shensuSkipPlay = false; g.shensuShaRemaining = 0;
  g.qiaobianSkipJudge = false;
  g.log=pushLog(g.log, '轮到 '+g.players[seat].name);
  // 袁术【妄尊】:主公的准备阶段,若场上存在存活且拥有 wangzun 的非主公角色(袁术),
  // 袁术摸一张牌、主公本回合手牌上限-1(简版:自动触发不询问,只对身份局主公回合生效)。
  if(g.gameMode==='identity' && p && p.alive && p.role==='zhu'){
    for(let i=0;i<g.players.length;i++){
      if(i===seat) continue;
      const ys=g.players[i];
      if(ys && ys.alive && hasCap(ys,'wangzun')){
        ensureDeck(g);
        drawN(g, i, 1);
        g.lordHandCap=1;
        g.log=pushLog(g.log, ys.name+' 发动【妄尊】,摸一张牌,主公本回合手牌上限-1');
        markSkillSound(g, '妄尊');
        break;
      }
    }
  }
  // 孙策【魂姿】在准备阶段觉醒。刚觉醒获得的【英魂】从下个准备阶段起询问，
  // 避免在同一个“准备阶段开始时”时点倒序补触发一个刚获得的技能。
  const hunziJustAwakened=maybeAwakenHunzi(g,seat);
  if(!hunziJustAwakened && maybeStartYinghun(g,seat)) return;
  // 姜维【志继】觉醒检查:准备阶段,若没有手牌(走 cap,不硬编码武将 id)
  if(p && p.alive && hasCap(p,'zhiji') && (p.hand||[]).length===0 && !p.zhijiAwakened){
    p.zhijiAwakened = true;
    p.maxHp--; // 减1点体力上限
    // 如果当前体力超过新的体力上限，需要调整
    if(p.hp > p.maxHp) p.hp = p.maxHp;
    // 需要玩家选择：回复1点体力 或 摸两张牌
    // 观星技能会在选择完成后获得
    // 【B类修复】补setResponseAskedAt——此前没有,30秒超时兜底对这个pending形同虚设,
    // 和郭嘉遗计/刚烈/将驰/鬼道那批同一个遗漏点。
    g.pending = setResponseAskedAt({ type:'zhijiChoice', seat });
    g.phase = 'zhijiChoice';
    g.log = pushLog(g.log, p.name + ' 发动【志继】觉醒,体力上限-1,请选择:回复1点体力或摸两张牌');
    markSkillSound(g,'志继');
    return; // 等待玩家选择
  }
  continueHuashenChangeCheckAtTurnStart(g, seat);
}
// enterDrawPhase: 回合开始判定阶段结束、即将进入摸牌阶段前的统一入口(startTurn 正常路径、
// finishDying 的 delay-resume 分支都走这里,别各自重复判断)。
// 兵粮寸断的 g.skipDraw 在这里消费:为真则直接跳过摸牌阶段,交给 advancePastPlay 继续判断
// 出牌/弃牌阶段是否也被跳过——不在这里各自重复"检查下一个标志"的逻辑。
// **真实bug修复(历史记录)**:甄姬【洛神】的三个"循环判定结束"分支(当时还是respondLuoshen
// 的"不发动"/"牌堆无牌可判",现已随"确定正收益技能自动发动"改造合并进 autoLuoshenRound,
// finishLuoshenJudge 的判红分支)原本都是直接调用这个函数,没有先把
// g.pending 置空——和骁果(advanceXiaoguo)是完全独立的第二个真实bug,但同一种模式:
// 洛神判定结束、马上要进入摸牌阶段,这个函数假定"进来时 pending 已经是 null",一旦这条
// 假定被违反,已经问完的洛神 pending 就会带着过期数据漏进摸牌/出牌阶段,同样会卡住
// pruneExchangeCards。这里统一在入口显式置空,一次性覆盖洛神那三个结束分支,不需要
// 在三处各自打补丁——这是"循环型响应函数必须在结束分支显式置空pending"这条通用约定的
// 另一个实例(见 CLAUDE.md 对应条目和 advanceXiaoguo 的说明)。这个函数的全部现有调用点
// (continueTurnStart 没有洛神能力时、洛神三个结束分支)本来就都是"pending 应该已经是
// null"的边界,这里显式置空只是把这条隐含假设变成函数自己保证的事实,不依赖调用方记性。
function enterDrawPhase(g){
  // 洛神/判定链等"循环结束"入口假定进来时 pending 已空;统一在此置空,避免过期 pending 漏进摸牌/出牌阶段卡住中央区。
  // 后续神速/礼让等会按需重新赋值 pending。
  g.pending=null;
  const p = g.players[g.turn];
  if(!p || !p.alive) return;
  
  // 神速1 已挪到 continueShensu1Check(判定区结算之前)。此处只处理「已发动神速1、跳过摸牌」的兜底,
  // 以及神速2(摸牌结束后,由 finishDrawPhase 等路径挂起,不在这里开 shensuChoose1)。
  if (g.shensuSkipJudgingAndDraw) {
    g.shensuSkipJudgingAndDraw = false;
    g.phase = 'play';
    g.log = pushLog(g.log, p.name + ' 【神速1】效果生效，跳过判定和摸牌阶段');
    return;
  }
  
  if(g.skipDraw){
    g.skipDraw=false;
    g.log=pushLog(g.log, g.players[g.turn].name+' 因【兵粮寸断】跳过摸牌阶段');
    advancePastPlay(g);
  } else {
    const lirangSeat=eligibleLiRangSeat(g, g.turn);
    if(lirangSeat!==null){
      g.pending=setResponseAskedAt({type:'lirangAsk', from:lirangSeat, to:g.turn});
      g.phase='lirangAsk';
      g.log=pushLog(g.log, g.players[g.turn].name+' 的摸牌阶段开始,询问 '+g.players[lirangSeat].name+' 是否发动【礼让】…');
      return;
    }
    continueEnterDrawPhase(g);
  }
}
function continueEnterDrawPhase(g){
  if(hasCap(g.players[g.turn], 'shuangxiong')){
    g.pending={type:'shuangxiongAsk', seat:g.turn};
    g.phase='shuangxiongAsk';
    g.log=pushLog(g.log, g.players[g.turn].name+' 是否发动【双雄】,放弃摸牌并进行一次判定…');
  } else if(hasCap(g.players[g.turn], 'luoyi')){
    g.pending={type:'luoyiAsk', seat:g.turn};
    g.phase='luoyiAsk';
    g.log=pushLog(g.log, g.players[g.turn].name+' 是否发动【裸衣】,少摸1张牌换取本回合伤害加成…');
  } else if(hasCap(g.players[g.turn], 'jiangchi')){
    // 曹彰【将驰】:摸牌阶段三选一
    const seat = g.turn;
    const p = g.players[seat];
    // 【系统性扫描发现的遗漏,和郭嘉遗计yijiAsk同一批】补setResponseAskedAt。
    g.pending = setResponseAskedAt({ type:'jiangchiAsk', seat, baseDraw: drawPhaseCount(g, seat) });
    g.phase = 'jiangchiAsk';
    g.log = pushLog(g.log, p.name + ' 是否发动【将驰】…');
  } else {
    g.phase='draw';
  }
}

// respondXunxunStart: 李典【恂恂】手动启动（当在draw阶段点击"发动【恂恂】"按钮）
// 服务端会检查 phase===draw && hasCap(mySeat,'xunxun') && deck.length>0
function respondXunxunStart(){
  tx(g=>{
    if(g.phase!=='draw') return g;
    if(g.turn!==mySeat) return g;
    const me = g.players[mySeat];
    if(!me || !me.alive || !hasCap(me,'xunxun')) return g;
    if((g.deck||[]).length === 0) return g;
    
    // 启动恂恂：亮出牌堆顶至多4张牌
    if(ensureDeck(g) && g.deck.length > 0){
      const n = Math.min(4, g.deck.length);
      const cards = g.deck.splice(g.deck.length - n, n);
      g.pending = { type:'xunxunPick', seat: mySeat, cards, takeN: Math.min(2, n) };
      g.phase = 'xunxunPick';
      g.log = pushLog(g.log, me.name+' 发动【恂恂】,亮出牌堆顶'+n+'张牌…');
      markSkillSound(g, '恂恂');
      return g;
    }
    return g;
  });
}

// advancePastPlay/advancePastDiscard: 出牌阶段、弃牌阶段各自"这个阶段是否被跳过"的统一判断,
// 从 enterDrawPhase(跳过摸牌阶段直接来到这里)、doDraw(正常摸完牌来到这里)、endPlay(正常结束
// 出牌来到这里)三处共用——之前 skipPlay 的消费点分散写在 enterDrawPhase/doDraw 两处、各自内嵌
// 一段"顺便检查下一个标志"的 if/else,这次新增 skipDiscard 后如果继续照抄,"检查 skipDiscard"就要
// 在三处分别重复一遍,容易漏改。抽成这两个级联函数后,"摸牌→出牌→弃牌"三个阶段谁被跳过、
// 跳过几个,只在这里维护一份逻辑,三个调用点都共享。
function advancePastPlay(g){
  if(g.skipPlay){
    g.skipPlay=false;
    g.log=pushLog(g.log, g.players[g.turn].name+' 因【乐不思蜀】跳过出牌阶段');
    advancePastDiscard(g);
  } else if(g.shensuSkipPlay){
    g.shensuSkipPlay=false;
    g.log=pushLog(g.log, g.players[g.turn].name+' 【神速2】效果生效，跳过出牌阶段');
    advancePastDiscard(g);
  } else {
    // 太史慈【天义】:出牌阶段开始时重置阶段标志
    g.tianyiWin = false;
    g.tianyiLose = false;
    g.phase='play';
  }
}
function advancePastDiscard(g){
  if(g.skipDiscard){
    g.skipDiscard=false;
    g.log=pushLog(g.log, g.players[g.turn].name+' 因【巧变】跳过弃牌阶段');
    finishTurn(g, g.turn);
  } else {
    g.phase='discard';
  }
}
// resolveDelayTricks: 按放置顺序(数组顺序,先放先判——真实规则里玩家可自选顺序,这里简化成固定顺序)
// 结算判定区里的延时锦囊,逐张调用 processOneDelayCard;返回 'pending'(某张牌挂起了,可能是鬼才
// 改判或效果内部触发的濒死,立刻停止处理该玩家判定区剩余的牌,把控制权交还给调用方)或 'done'。
function resolveDelayTricks(g, seat){
  const p=g.players[seat];
  while(p.delays && p.delays.length>0){
    if(processOneDelayCard(g, seat)==='pending') return 'pending';
  }
  return 'done';
}
// processOneDelayCard: 处理 seat 判定区最前面一张牌——judge 翻牌 + 鬼才改判窗口(maybeGuicai)。
// 若无人有资格发起鬼才,直接用原判定牌走 finishDelayCard;否则挂起,返回 'pending'(收尾延后到
// finishGuicai 按 resume.kind==='delayJudge' 接回,用最终判定牌重新调 finishDelayCard)。
function processOneDelayCard(g, seat){
  const p=g.players[seat];
  const card=p.delays[0];
  const spec=DELAY_TRICKS[card.name];
  if(!spec){ p.delays.shift(); restoreOriginalCardName(card); g.discard.push(card); return 'done'; } // 未知/尚未实现的延时锦囊,安全丢弃防卡死
  const judgeCard=judge(g);
  p.delays.shift();
  if(maybeGuicai(g, seat, judgeCard, {kind:'delayJudge', seat, trickName:card.name, card})==='pending') return 'pending';
  return finishDelayCard(g, seat, spec, judgeCard, card);
}
// maybeTiandu: 郭嘉【天妒】——若 seat 是郭嘉(caps.tiandu)且这张判定牌确实在弃牌堆里
// (judge() 已经把牌推进 g.discard),从弃牌堆移除、改放进郭嘉手牌,记日志。返回 true=已获得,
// 返回 false=不是郭嘉或条件不满足(调用方不需要做任何额外处理,判定牌该在哪还在哪)。
// 边界(官方FAQ已确认,当前项目无此场景但先注释说明):由他人技能造成的判定(如马超【铁骑】,
// 判定归属永远是马超本人而不是郭嘉,除非将来某种机制打破"一人一将"的假设)、或郭嘉的技能造成
// 他人的判定,都不适用天妒——这里只处理"seat 自己进行的判定"这一种情况,调用方传入的 seat
// 必须是判定的真正归属者(闪电/兵粮寸断/乐不思蜀是判定区所有者、铁骑是马超本人、洛神是甄姬本人)。
// 注意:天妒作用于"判定牌"本身(finalCard,judge() 抽出来的那张牌),和延时锦囊牌自身
// (闪电/乐不思蜀/兵粮寸断这张锦囊卡)是两个不同的对象、两件独立的事——天妒只影响判定牌的
// 归属,不影响延时锦囊卡本身该弃置还是传给下家(那部分逻辑不变,continueTiandu 无关)。
function maybeTiandu(g, seat, card){
  const p=g.players[seat];
  if(!p || !hasCap(p,'tiandu') || !card) return false;
  const idx=g.discard.lastIndexOf(card);
  if(idx<0) return false;
  g.discard.splice(idx,1);
  p.hand.push(card);
  g.log=pushLog(g.log, p.name+' 【天妒】发动,获得判定牌【'+card.name+'】');
  markSkillSound(g, '天妒');
  return true;
}
// finishDelayCard: 用最终判定牌(可能被鬼才替换过)调用该延时锦囊的 effect,处理去向(传下家/弃置)。
// 返回 'pending'=effect 内部触发了濒死(如闪电致命,牌本身仍正常进弃牌堆,和是否致命无关)、'done'=处理完毕。
function finishDelayCard(g, seat, spec, finalCard, card){
  const result=spec.effect(g, seat, finalCard, card);
  // 天妒:判定牌(finalCard)生效后,若 seat 是郭嘉可以收下——这是独立于延时锦囊卡(card)本身
  // 去向的另一件事,不管 card 接下来是传给下家还是弃置,finalCard 该不该被天妒收走都不受影响。
  maybeTiandu(g, seat, finalCard);
  if(typeof result==='number' && g.players[result]){
    g.players[result].delays = g.players[result].delays || [];
    g.players[result].delays.push(card);
    g.log=pushLog(g.log, '【'+card.name+'】传给了 '+g.players[result].name);
  } else {
    discardOrVanish(g, card);
  }
  // 曹植【落英】:其他角色的判定梅花牌进入弃牌堆后可获得(finalCard 已在 discard)
  // 若 effect 已挂起濒死,不再覆盖 pending
  if(result!=='pending' && finalCard && maybeStartLuoying(g, seat, [finalCard], 'judge', {type:'delay', seat})){
    return 'pending';
  }
  return result==='pending' ? 'pending' : 'done';
}
// restoreOriginalCardName: 转化牌离开判定区后恢复物理牌身份。国色等技能只在结算期间
// 改变规则牌名，不能让修改后的 name 随弃牌堆重洗而永久污染牌堆。
function restoreOriginalCardName(card){
  if(!card || !card.originalName) return card;
  card.name=card.originalName;
  delete card.originalName;
  return card;
}
// discardOrVanish: 延时锦囊的牌"离场"时的统一去向——真实牌进弃牌堆;虚拟牌(card.virtual,
// 如徐晃【断粮】"视为使用一张兵粮寸断"临时构造的牌)用完即焚,直接消失、不进弃牌堆,
// 否则会被 ensureDeck 当真牌重新洗回牌堆,凭空多出一张不在 buildDeck 统计里的牌、污染牌堆构成。
function discardOrVanish(g, card){
  restoreOriginalCardName(card);
  if(!card.virtual) g.discard.push(card);
}
// continueDelayResolution: resolveDelayTricks(g,seat) 结果的统一处理——startTurn、finishDying 的
// resume.type==='delay' 分支、finishGuicai 的 resume.kind==='delayJudge' 分支三处共用。
// 'pending' 时:若新挂起是濒死或郭嘉【遗计】(g.pending.type==='dying'||'yijiAsk'),它的 resume
// 只有 {type:'delay'}(因为 dealDamage/startDying 只知道 srcType 字符串,不知道 seat),这里补上
// seat;若新挂起是鬼才(g.pending.type==='guicai'),它的 resume 在 maybeGuicai 里已经自带完整
// 信息,绝不能覆盖。'done' 时统一走 enterDrawPhase,进入(或跳过)摸牌阶段。
function continueDelayResolution(g, seat){
  // 巧变跳过判定:不翻判定区,直接进洛神/摸牌链路(神速1 已在 continueShensu1Check 问过)
  if(g.qiaobianSkipJudge){
    g.qiaobianSkipJudge=false;
    continueTurnStart(g, seat);
    return;
  }
  if(resolveDelayTricks(g, seat)==='pending'){
    if(g.pending && (g.pending.type==='dying' || g.pending.type==='yijiAsk' || g.pending.type==='luoyingAsk')){
      // luoyingAsk 若已自带 resume 则不覆盖
      if(g.pending.type!=='luoyingAsk' || !g.pending.resume){
        setInterruptedDamageResume(g,{type:'delay',seat});
      }
    }
    return;
  }
  continueTurnStart(g, seat);
}
// ===== 甄姬【洛神】:回合开始阶段(判定区处理完毕之后、摸牌之前)甄姬自己选择要不要发动的循环判定 =====
// continueTurnStart: 判定区处理完毕后的下一步——轮到的人若有洛神,问是否发动(可连续判定);
// 没有则直接进摸牌阶段。startTurn/finishDying 的 delay 分支/finishGuicai 的 delayJudge 分支
// 都经 continueDelayResolution 走到这里,不用各自重复判断。
function continueTurnStart(g, seat){
  if(hasCap(g.players[seat],'luoshen')){
    autoLuoshenRound(g, seat);
    return;
  }
  enterDrawPhase(g);
}
// autoLuoshenRound: 甄姬【洛神】自动判定一轮——黑色继续拿牌(没有下行风险,循环判定
// 直到判红/无牌可判为止),红色结束,不再询问是否发动("不发动"和"发动后判红"结果
// 完全等价,只是多耗一张判定牌,不存在真人/机器人会因此变差的分支)。判定牌仍会经过
// maybeGuicai(可能被别人的鬼才/鬼道改判),那是另一名玩家的独立决策,不是这里要跳过的
// "洛神本人是否继续发动"这一层,遇到改判进行中(返回'pending')照常等待、不催不跳过。
function autoLuoshenRound(g, seat){
  const card=judge(g);
  if(!card){ enterDrawPhase(g); return; } // 无牌可判,视为发动失败,直接进摸牌阶段
  markHongyanIfConverted(g,g.players[seat],card);
  markSkillSound(g, '洛神');
  if(maybeGuicai(g, seat, card, {kind:'luoshenJudge', seat})==='pending') return; // 鬼才/鬼道改判进行中,等待响应
  finishLuoshenJudge(g, seat, card);
}
// finishLuoshenJudge: 洛神判定结算(不管是否被鬼才改判过)。红色=判定失败,牌进弃牌堆,洛神结束;
// 黑色=判定牌归玩家所有——judge(g) 已经把牌推进了 g.discard,这里要把它弹出来改放进手牌,
// 不能"弃牌堆+手牌各一份"。留在同一个 'luoshen' 阶段,再问一次要不要继续发动(循环判定)。
function finishLuoshenJudge(g, seat, card){
  const p=g.players[seat];
  if(isRedForPlayer(p, card)){
    g.log=pushLog(g.log, p.name+' 发动【洛神】,判定为红,洛神结束');
    // 天妒:洛神判红时判定牌留在弃牌堆(洛神本身没有拿走它),若 seat 恰好是郭嘉可以额外收下——
    // 这是唯一需要在这里调用 maybeTiandu 的分支。黑色分支(下面 else)本来就会把判定牌搬进
    // p.hand,如果也调用 maybeTiandu 会变成"先被天妒判定为已在弃牌堆里"(此时其实不在,已被
    // 洛神搬进手牌了)而返回 false、不会真的重复移动,但语义上容易让人误以为两个技能在竞争
    // 同一张牌,所以刻意不在黑色分支调用,避免这种"看起来在做什么、实际上什么也没做"的死代码。
    maybeTiandu(g, seat, card);
    enterDrawPhase(g);
  } else {
    const idx=g.discard.lastIndexOf(card);
    if(idx>=0) g.discard.splice(idx,1); // 从弃牌堆移除,改成玩家获得
    p.hand.push(card);
    g.log=pushLog(g.log, p.name+' 发动【洛神】,判定为黑,获得判定牌,继续判定');
    autoLuoshenRound(g, seat);
  }
}

// 陆逊【连营】:失去最后1张手牌时可摸1张。
// 实现为队列:调用点只入队,不立刻写 g.pending——避免 playCard 里 effect/resolveShaUse
// 随后覆盖 pending 导致连营永远问不到。真正挂起由 tryFlushLianying 在 pending 空闲时做
// (tx 收尾统一调用一次)。
// 返回:条件满足并入队则 true,否则 false。
function maybeStartLianying(g, seat, cardsLost=1){
  const p = g.players[seat];
  if(!p || !p.alive || !hasCap(p,'lianying')) return false;
  const handAfter = (p.hand || []).length;
  const handBefore = handAfter + cardsLost;
  // 失去最后一张手牌 → 由有牌变为 0。cardsLost 可以>1(一次失去多张全部离手,如丈八蛇矛两张
  // 当杀/制衡弃光/批量弃牌),只要是"失去后手牌为 0"就触发一次;队列按座位去重保证不重复。
  if(handBefore >= 1 && handAfter === 0 && cardsLost >= 1){
    if(!Array.isArray(g.lianyingQueue)) g.lianyingQueue=[];
    if(!g.lianyingQueue.includes(seat)) g.lianyingQueue.push(seat);
    return true;
  }
  return false;
}
// removeHandCards: 统一"从角色手牌移除若干张"的业务入口。所有把牌从 hand 移除的路径
// (普通出牌/响应打出/弃置/被获得/转移/拼点等)都应经过它,移除后统一触发陆逊【连营】的
// 失去手牌判断(由有牌变为 0 时入队,由 tryFlushLianying 在 pending 空闲时挂起询问,既不丢
// 询问也不重复)。返回值是被移除的牌数组,调用点自行决定去向(弃牌堆/转移/拼点比较)。
// indices:单个下标(number)或下标数组(乱序安全,内部排序从大到小 splice 避免错位)。
function removeHandCards(g, seat, indices){
  const p = g.players && g.players[seat];
  if(!p || !Array.isArray(p.hand)) return [];
  const list = Array.isArray(indices)
    ? [...new Set(indices)].filter(i=>Number.isInteger(i) && i>=0 && i<p.hand.length).sort((a,b)=>b-a)
    : (Number.isInteger(indices) ? [indices] : []);
  const removed = list.map(i=>p.hand.splice(i,1)[0]);
  if(removed.length > 0) maybeStartLianying(g, seat, removed.length);
  return removed;
}
// 陆逊【连营】:失去最后1张手牌时摸1张,零代价、零下行风险,不再询问,直接生效。队列里
// 可能同时排了多个连营角色(同一次操作让多人各自弃光最后一张手牌),不再像"发起询问"那样
// 一次只处理队首一个就 return——既然每一项都是确定性生效,直接把整条队列在这次调用里
// 处理完(仍然遵守"当前无其它更高优先级挂起"这条前提,保持和原来一致的调用时机)。
function tryFlushLianying(g){
  if(!g || g.pending || g.aoe) return false;
  if(!Array.isArray(g.lianyingQueue) || g.lianyingQueue.length===0) return false;
  let flushed=false;
  while(g.lianyingQueue.length>0){
    const seat = g.lianyingQueue.shift();
    const p = g.players[seat];
    if(!p || !p.alive || !hasCap(p,'lianying')) continue;
    drawN(g, seat, 1);
    g.log = pushLog(g.log, p.name+' 发动【连营】,摸一张牌');
    markSkillSound(g, '连营');
    flushed=true;
  }
  return flushed;
}

// respondLianying: 响应连营询问
function respondLianying(activate){
  tx(g=>{
    if(g.phase!=='lianyingAsk'||!g.pending||g.pending.type!=='lianyingAsk'||g.pending.seat!==mySeat) return g;
    const seat = mySeat;
    const p = g.players[seat];
    if(!p || !p.alive || !hasCap(p,'lianying')) return g;
    
    if(activate){
      drawN(g, seat, 1);
      g.log = pushLog(g.log, p.name+' 发动【连营】,摸一张牌');
      markSkillSound(g, '连营');
    } else {
      g.log = pushLog(g.log, p.name+'：不发动【连营】');
    }
    g.pending = null;
    // 回到出牌阶段(若仍是自己的回合且无其它链);队列里若还有人,tx 收尾 tryFlush 会再挂
    if(g.players[g.turn] && g.players[g.turn].alive) g.phase = 'play';
    else g.phase = 'play';
    return g;
  });
}

// findPlayerWithCap: 找到拥有指定能力(cap)的玩家座位号,返回座位号或null(如果没找到)
function findPlayerWithCap(g, cap) {
  if (!g || !g.players || !Array.isArray(g.players)) return null;
  for (let i = 0; i < g.players.length; i++) {
    const player = g.players[i];
    if (player && player.alive && hasCap(player, cap)) {
      return i;
    }
  }
  return null;
}

// isBlackTactics: 判断是否为黑色锦囊牌
function isBlackTactics(card) {
  if (!card || !card.suit) return false;
  return (card.suit==='♠'||card.suit==='♣') && isTrickCardName(card.name);
}

// 陈宫【智迟】:检查目标是否受到智迟免疫
// 如果targetSeat受到智迟免疫，且card是【杀】或普通锦囊牌，则不能成为目标
function isZhichiImmune(g, targetSeat, card) {
  if (g.zhichiImmunity && g.zhichiImmunity.seat === targetSeat) {
    // 当前免疫是否仍然有效（即当前回合是否为触发时的回合）
    if (g.zhichiImmunity.turn === g.turn) {
      // 检查是否为【杀】
      const isSha = isShaName(card.name);
      // 检查是否为普通锦囊牌（非延时）
      const isNormalTactics = isNormalTacticsCard(card);
      
      if (isSha || isNormalTactics) {
        return true; // 免疫生效，不能成为目标
      }
    }
  }
  return false; // 无免疫或免疫不适用
}

// 辅助函数：判断是否为普通锦囊牌（非延时）
// 延时锦囊牌仅有：乐不思蜀、兵粮寸断、闪电
// 五谷丰登是普通锦囊牌，不是延时锦囊
function isNormalTacticsCard(card) {
  if (!card || !card.name) return false;
  // 锦囊身份统一由 isTrickCardName 判断，延时与否统一由 DELAY_TRICKS 数据表判断。
  return isTrickCardName(card.name) && !DELAY_TRICKS[card.name];
}

// ===================== 蔡文姬技能实现 =====================

function beigeCanDiscard(p){
  return !!(p && ((p.hand||[]).length || EQUIP_SLOTS.some(slot=>p.equips&&p.equips[slot])));
}
function startNextBeigeOwner(g){
  const q=g.beigeQueue;
  if(!q) return false;
  while(q.index<q.candidates.length){
    const sourceSeat=q.candidates[q.index++];
    const source=g.players[sourceSeat], damaged=g.players[q.damagedSeat];
    if(!source||!source.alive||!damaged||!damaged.alive||!hasCap(source,'beige')||!beigeCanDiscard(source)) continue;
    g.pending={type:'beigeChoose',sourceSeat,damagedSeat:q.damagedSeat,damageSource:q.damageSource,reason:q.reason,
      resume:{type:'afterDamageEffects'}};
    g.phase='beigeChoose';
    g.log=pushLog(g.log,source.name+' 可以发动【悲歌】,是否弃置一张牌令 '+damaged.name+' 进行判定?');
    return true;
  }
  g.beigeQueue=null;
  return false;
}
function continueBeigeOwners(g){
  const q=g.beigeQueue;
  const damagedSeat=q&&q.damagedSeat;
  g.pending=null;
  if(startNextBeigeOwner(g)) return;
  resumeAfterInterrupt(g,{type:'afterDamageEffects'},damagedSeat);
}

// 悲歌选择是否发动
function triggerBeige(doTrigger) {
  tx(g => {
    const pending = g.pending;
    if (!pending || pending.type !== 'beigeChoose' || pending.sourceSeat !== mySeat) return g;
    
    if (!doTrigger) {
      // 不发动
      g.log = pushLog(g.log, g.players[mySeat].name + ' 取消发动【悲歌】');
      continueBeigeOwners(g);
      return g;
    }
    
    const source = g.players[mySeat];
    const damagedSeat = pending.damagedSeat;
    const damageSource = pending.damageSource;
    
    if (!source || !source.alive || !g.players[damagedSeat] || !g.players[damagedSeat].alive) {
      continueBeigeOwners(g);
      return g;
    }
    
    // 检查是否有牌可以弃置（手牌或装备）
    const canDiscard = (source.hand && source.hand.length > 0) || 
                      (source.equips && Object.values(source.equips).some(eq => eq && eq !== null));
    
    if (!canDiscard) {
      g.log = pushLog(g.log, source.name + ' 没有牌可以弃置,无法发动【悲歌】');
      continueBeigeOwners(g);
      return g;
    }
    
    // 进入弃牌选择阶段
    g.pending = {
      type: 'beigeDiscard',
      sourceSeat: mySeat,
      damagedSeat: damagedSeat,
      damageSource: damageSource,
      reason: pending.reason
    };
    g.phase = 'beigeDiscard';
    markSkillSound(g, '悲歌');
    g.log = pushLog(g.log, source.name + ' 发动【悲歌】,请选择一张牌弃置');
    
    return g;
  });
}

// 悲歌选择弃置的牌
function beigeDiscard(cardIndex, isEquip, equipType) {
  tx(g => {
    const pending = g.pending;
    if (!pending || pending.type !== 'beigeDiscard' || pending.sourceSeat !== mySeat) return g;
    
    const source = g.players[mySeat];
    const damagedSeat = pending.damagedSeat;
    const damageSource = pending.damageSource;
    
    if (!source || !source.alive || !g.players[damagedSeat] || !g.players[damagedSeat].alive) {
      continueBeigeOwners(g);
      return g;
    }
    
    let discardedCard = null;
    
    if (isEquip && equipType) {
      // 弃置装备
      if (source.equips && source.equips[equipType] !== null) {
        discardedCard = source.equips[equipType];
        source.equips[equipType] = null;
      }
    } else {
      // 弃置手牌
      if (source.hand && source.hand.length > cardIndex) {
        discardedCard = removeHandCards(g, mySeat, cardIndex)[0];
      }
    }
    
    if (!discardedCard) {
      g.log = pushLog(g.log, source.name + ' 弃牌失败');
      continueBeigeOwners(g);
      return g;
    }
    
    // 弃置牌到弃牌堆
    g.discard.push(discardedCard);
    markDiscardReveal(g, mySeat, [discardedCard]);
    g.log = pushLog(g.log, source.name + ' 弃置了【' + discardedCard.name + '】');
    
    // 进入判定阶段
    g.pending = {
      type: 'beigeJudge',
      sourceSeat: mySeat,
      damagedSeat: damagedSeat,
      damageSource: damageSource,
      resume: { kind: 'beigeJudge', sourceSeat: mySeat, damagedSeat: damagedSeat, damageSource: damageSource }
    };
    g.phase = 'beigeJudge';
    g.log = pushLog(g.log, g.players[damagedSeat].name + ' 进行判定…');
    
    return g;
  });
}

// 悲歌判定处理
function doBeigeJudge() {
  tx(g => {
    const pending = g.pending;
    if (!pending || pending.type !== 'beigeJudge' || pending.sourceSeat !== mySeat) return g;
    
    const { sourceSeat, damagedSeat, damageSource, resume } = pending;
    const source = g.players[sourceSeat];
    const damaged = g.players[damagedSeat];
    
    if (!source || !source.alive || !damaged || !damaged.alive) {
      continueBeigeOwners(g);
      return g;
    }
    
    // 进行判定
    const judgeCard = judge(g);
    if(!judgeCard) {
      continueBeigeOwners(g);
      return g;
    }
    
    g.log = pushLog(g.log, damaged.name + ' 判定为' + judgeCard.suit + rankText(judgeCard.rank));
    
    // 检查是否有改判技能需要处理
    // 先保存判定结果，等待可能的改判
    if(maybeGuicai(g, damagedSeat, judgeCard, resume) === 'pending') {
      return g; // 等待改判处理
    }
    
    // 处理判定结果
    return processBeigeJudgeResult(g, judgeCard, sourceSeat, damagedSeat, damageSource);
  });
}

// 处理悲歌判定结果——注意:这个函数被 doBeigeJudge 自己的 tx 回调内部直接调用
// （`return processBeigeJudgeResult(g, ...)`），不是客户端直接调用的入口，所以不应该
// 再自己包一层 tx(...)。和 finishBaguaColor/finishGuicai/finishDying 同一约定：只有
// 被客户端直接调用的入口函数才该调 tx，被 tx 回调内部调用的收尾/辅助函数直接操作
// 传入的 g、不再嵌套开 tx。嵌套 tx 会触发 Firebase transaction 的重试机制，导致外层
// doBeigeJudge 的整个 tx 回调被反复重新执行，每次重执行都会重新调用一次 judge(g)
// （真实从牌堆 pop 一张、写一条判定日志）——这正是"连续判定好几张牌才最终生效一次"
// 这个 bug 的成因。
function processBeigeJudgeResult(g, judgeCard, sourceSeat, damagedSeat, damageSource) {
  const damaged = g.players[damagedSeat];

  if (!damaged || !damaged.alive) {
    continueBeigeOwners(g);
    return g;
  }

  // 根据花色执行不同效果
  switch(judgeCard.suit) {
    case '♥': // 红桃 - 受伤角色回复1点体力
      heal(g, damagedSeat, 1, sourceSeat, '悲歌');
      g.log = pushLog(g.log, damaged.name + ' 回复1点体力');
      break;

    case '♦': // 方块 - 受伤角色摸两张牌
      drawN(g, damagedSeat, 2);
      g.log = pushLog(g.log, damaged.name + ' 摸两张牌');
      break;

    case '♣': // 梅花 - 伤害来源弃置两张牌
      if (damageSource !== null && typeof damageSource === 'number' && g.players[damageSource] && g.players[damageSource].alive) {
        const sourcePlayer = g.players[damageSource];
        const cardsToDiscard = [];

        // 先弃置手牌
        if (sourcePlayer.hand && sourcePlayer.hand.length > 0) {
          const discardCount = Math.min(2, sourcePlayer.hand.length);
          for (let i = 0; i < discardCount; i++) {
            cardsToDiscard.push(removeHandCards(g, damageSource, 0)[0]);
          }
        }

        // 如果手牌不足2张，继续弃置装备
        if (cardsToDiscard.length < 2 && sourcePlayer.equips) {
          const equipSlots = ['weapon', 'armor', 'plus1', 'minus1'];
          for (const eqType of equipSlots) {
            if (cardsToDiscard.length >= 2) break;
            if (sourcePlayer.equips[eqType] !== null) {
              cardsToDiscard.push(sourcePlayer.equips[eqType]);
              sourcePlayer.equips[eqType] = null;
            }
          }
        }

        g.discard.push(...cardsToDiscard);
        markDiscardReveal(g, damageSource, cardsToDiscard);
        g.log = pushLog(g.log, sourcePlayer.name + ' 弃置了' + cardsToDiscard.length + '张牌');
      }
      break;

    case '♠': // 黑桃 - 伤害来源翻面
      if (damageSource !== null && typeof damageSource === 'number' && g.players[damageSource] && g.players[damageSource].alive) {
        const sourcePlayer = g.players[damageSource];
        sourcePlayer.faceup = !sourcePlayer.faceup;
        g.log = pushLog(g.log, sourcePlayer.name + ' 翻面');
      }
      break;
  }

  // 当前拥有者结算完成后继续询问下一名悲歌拥有者；全部问完才恢复伤害后队列。
  continueBeigeOwners(g);

  return g;
}

// 取消悲歌
function cancelBeige() {
  tx(g => {
    if (g.pending && (g.pending.type === 'beigeChoose' || 
                      g.pending.type === 'beigeDiscard' || 
                      g.pending.type === 'beigeJudge') &&
        g.pending.sourceSeat === mySeat) {
      g.log = pushLog(g.log, g.players[mySeat].name + ' 取消发动【悲歌】');
      continueBeigeOwners(g);
    }
    return g;
  });
}

// 曹仁【据守】确认发动
function confirmJushou() {
  tx(g => {
    const pending = g.pending;
    if (!pending || pending.type !== 'jushouChoose' || pending.seat !== mySeat) return g;
    
    const me = g.players[mySeat];
    if (!me || !me.alive) return g;
    
    // 执行据守效果：摸三张牌
    drawN(g, mySeat, 3);
    
    // 翻面
    me.faceup = false;
    g.log = pushLog(g.log, `${me.name} 发动【据守】,摸了三张牌并翻面`);
    markSkillSound(g, '据守');
    
    // 清理状态
    g.pending = null;
    finishTurn(g, mySeat);
    
    return g;
  });
}

// 曹仁【据守】取消发动
function cancelJushou() {
  tx(g => {
    if (g.pending && g.pending.type === 'jushouChoose' && g.pending.seat === mySeat) {
      const me = g.players[mySeat];
      g.pending = null;
      g.phase = 'end';
      g.log = pushLog(g.log, `${me.name} 取消发动【据守】`);
      finishTurn(g, mySeat);
    }
    return g;
  });
}



// ===== 丁奉【短兵】和【奋迅】技能实现 =====

// 丁奉【奋迅】:开始发动奋迅
function startFenxun() {
  tx(g => {
    const me = g.players[mySeat];
    if (!me || !me.alive) return g;
    
    if (!hasCap(me, "fenxun") || me.fenxunUsed) return g;
    
    const hand = me.hand || [];
    if (hand.length === 0) {
      g.log = pushLog(g.log, `${me.name} 手牌为空,无法发动【奋迅】`);
      return g;
    }
    
    // 进入弃牌选择阶段
    g.pending = {
      type: "fenxunDiscard",
      seat: mySeat
    };
    g.phase = "fenxunDiscard";
    g.log = pushLog(g.log, `${me.name} 发动【奋迅】,请选择要弃置的一张牌`);
    markSkillSound(g, "奋迅");
    
    return g;
  });
}

// 丁奉【奋迅】:选择弃置的牌
function pickFenxunDiscard(cardIndex) {
  tx(g => {
    const pending = g.pending;
    if (!pending || pending.type !== "fenxunDiscard" || pending.seat !== mySeat) return g;
    
    const me = g.players[mySeat];
    if (!me || !me.alive || !me.hand || cardIndex >= me.hand.length) return g;
    
    // 弃置选中的牌
    const card = removeHandCards(g, mySeat, cardIndex)[0];
    g.discard.push(card);
    markDiscardReveal(g, mySeat, [card]);
    
    // 进入目标选择阶段
    const availableTargets = [];
    for (let i = 0; i < g.players.length; i++) {
      if (g.players[i] && g.players[i].alive && i !== mySeat) {
        availableTargets.push(i);
      }
    }
    
    g.pending = {
      type: "fenxunTarget",
      seat: mySeat,
      availableTargets: availableTargets
    };
    g.phase = "fenxunTarget";
    g.log = pushLog(g.log, `${me.name} 弃置了【${card.name}】,请选择一名其他角色`);
    
    return g;
  });
}

// 丁奉【奋迅】:选择目标角色
function pickFenxunTarget(targetSeat) {
  tx(g => {
    const pending = g.pending;
    if (!pending || pending.type !== "fenxunTarget" || pending.seat !== mySeat) return g;
    
    if (!pending.availableTargets.includes(targetSeat)) return g;
    
    const me = g.players[mySeat];
    const target = g.players[targetSeat];
    
    if (!me || !me.alive || !target || !target.alive) return g;
    
    // 设置玩家专属状态
    me.fenxunTarget = targetSeat;
    me.fenxunUsed = true;
    
    g.log = pushLog(g.log, `${me.name} 发动【奋迅】,本回合内与 ${target.name} 的距离视为1`);
    markSkillSound(g, "奋迅");
    
    // 清理pending状态
    g.pending = null;
    g.phase = "play";
    
    return g;
  });
}

// 丁奉【奋迅】:取消发动
function cancelFenxun() {
  tx(g => {
    if (g.pending && (g.pending.type === "fenxunDiscard" || g.pending.type === "fenxunTarget") &&
        g.pending.seat === mySeat) {
      g.pending = null;
      g.phase = "play";
      g.log = pushLog(g.log, `${g.players[mySeat].name} 取消发动【奋迅】`);
    }
    return g;
  });
}


// 丁奉【短兵】:选择额外目标
function triggerDuanbing(extraTarget) {
  tx(g => {
    const pending = g.pending;
    if (!pending || pending.type !== 'duanbingChoose' || pending.sourceSeat !== mySeat) return g;
    
    if (!pending.availableTargets.includes(extraTarget)) return g;
    
    const me = g.players[mySeat];
    const extra = g.players[extraTarget];
    
    if (!me || !me.alive || !extra || !extra.alive) return g;
    
    const baseTarget = pending.baseTarget;
    const card = pending.card || {};
    const usedAs = isShaName(card.name) ? '出【'+card.name+'】' : '出【'+card.name+'】当【杀】';

    // 与方天画戟共用成熟的多目标杀队列：前一个目标完整结束（流离、铁骑、武器、
    // 防具、闪、伤害及濒死）后，finishSingleShaTarget 才推进下一个，绝不能连续调用
    // 两次 resolveShaUse 覆盖 pending。
    const targets=[baseTarget,extraTarget];
    const order=[]; let s=mySeat;
    for(let i=0;i<g.players.length;i++){ s=nextAlive(g,s); if(targets.includes(s)) order.push(s); }
    const shaInfo=consumeJiuShaBonus(g,me);
    g.pending=null;
    g.fangtianQueue={
      kind:'duanbing',from:mySeat,targets:order,idx:0,usedAs,
      shaColor:singleCardShaColor(card),sourceCard:card,shaInfo
    };
    triggerJiangOnTarget(g,mySeat,extraTarget,'sha',isRed(card));
    g.log = pushLog(g.log, `${me.name} 发动【短兵】,对 ${order.map(seat=>g.players[seat].name).join(' 和 ')} 使用【杀】`);
    markSkillSound(g, '短兵');
    resolveShaUse(g,me,order[0],usedAs,singleCardShaColor(card),card,shaInfo);
    
    return g;
  });
}

// 丁奉【短兵】:取消发动
function cancelDuanbing() {
  tx(g => {
    if (g.pending && g.pending.type === 'duanbingChoose' && g.pending.sourceSeat === mySeat) {
      const me = g.players[mySeat];
      const baseTarget = g.pending.baseTarget;
      const card = g.pending.card;
      
      g.pending = null;
      g.phase = 'play';
      g.log = pushLog(g.log, `${me.name} 取消发动【短兵】,使用【杀】对 ${g.players[baseTarget].name} 生效`);
      
      // 直接结算单目标的杀
      const usedAs = isShaName(card.name) ? '出【'+card.name+'】' : '出【'+card.name+'】当【杀】';
      resolveShaUse(g, me, baseTarget, usedAs, singleCardShaColor(card), card, consumeJiuShaBonus(g, me));
    }
    return g;
  });
}

// ===================== 法正技能实现 =====================

// 【恩怨】要求的是“失去1点体力”，不是受到伤害：直接扣体力，不触发仁心、天香、遗计、
// 刚烈、狂骨或另一轮恩怨等伤害事件；若降到0或以下，仍按通用濒死流程求桃并在结束后接回
// 原伤害链的尾巴。
function resolveEnyuanLoseHp(g, pending, resume){
  const damager=g.players[pending.damagerSeat];
  if(!damager || !damager.alive) return false;
  damager.hp--;
  g.log=pushLog(g.log,damager.name+' 因【恩怨】失去1点体力（体力'+damager.hp+'）');
  if(damager.hp<=0){
    startDying(g,pending.damagerSeat,'enyuan',undefined,1);
    g.pending.resume={type:'enyuan',resume,seat:pending.sourceSeat};
    return true;
  }
  return false;
}

// 法正【恩怨】：处理选择触发
function triggerEnyuan() {
  tx(g => {
    const pending = g.pending;
    if (!pending || pending.type !== 'enyuanChoose' || pending.damagerSeat!==mySeat) return g;
    
    const damager = g.players[pending.damagerSeat];
    const source = g.players[pending.sourceSeat]; // 法正
    const resume = pending.resume || { type: 'sha' };
    
    if (!damager || !damager.alive || !source || !source.alive) {
      g.pending = null;
      if(checkWin(g)) return g;
      resumeAfterInterrupt(g, resume, pending.sourceSeat);
      return g;
    }
    
    // 检查damager是否有♥手牌
    const heartCards = (damager.hand || []).filter(card => card.suit === '♥');
    
    if (heartCards.length > 0) {
      // 进入选择阶段：交♥手牌或失去1点体力
      g.pending = {
        type: 'enyuanChooseOption',
        sourceSeat: pending.sourceSeat,
        damagerSeat: pending.damagerSeat,
        heartCards: heartCards,
        resume: resume
      };
      g.phase = 'enyuanChooseOption';
      g.log = pushLog(g.log, damager.name + ' 需要选择：交一张♥手牌给' + source.name + '，或失去1点体力');
    } else {
      // 没有♥手牌，只能选择失去1点体力
      g.pending = null;
      g.log = pushLog(g.log, damager.name + ' 没有♥手牌，发动【恩怨】效果');
      if(resolveEnyuanLoseHp(g,pending,resume)) return g;
      if(checkWin(g)) return g;
      resumeAfterInterrupt(g, resume, pending.sourceSeat);
    }
    
    return g;
  });
}

// 法正【恩怨】：选择选项处理
function chooseEnyuanOption(option) {
  tx(g => {
    const pending = g.pending;
    if (!pending || pending.type !== 'enyuanChooseOption' || pending.damagerSeat!==mySeat) return g;
    
    const damager = g.players[pending.damagerSeat];
    const source = g.players[pending.sourceSeat]; // 法正
    const resume = pending.resume || { type: 'sha' };
    
    if (!damager || !damager.alive || !source || !source.alive) {
      g.pending = null;
      if(checkWin(g)) return g;
      resumeAfterInterrupt(g, resume, pending.sourceSeat);
      return g;
    }
    
    if (option === 'giveCard') {
      // 选择交一张♥手牌
      g.pending = {
        type: 'enyuanGiveCard',
        sourceSeat: pending.sourceSeat,
        damagerSeat: pending.damagerSeat,
        resume: resume
      };
      g.phase = 'enyuanGiveCard';
      g.log = pushLog(g.log, damager.name + ' 选择交一张♥手牌给' + source.name);
    } else if (option === 'loseHp') {
      g.pending = null;
      g.log = pushLog(g.log, damager.name + ' 选择失去1点体力');
      if(resolveEnyuanLoseHp(g,pending,resume)) return g;
      if(checkWin(g)) return g;
      resumeAfterInterrupt(g, resume, pending.sourceSeat);
    }
    
    return g;
  });
}

// 法正【恩怨】：选择要交的♥手牌处理
function giveEnyuanCard(cardIndex) {
  tx(g => {
    const pending = g.pending;
    if (!pending || pending.type !== 'enyuanGiveCard' || pending.damagerSeat!==mySeat) return g;
    
    const damager = g.players[pending.damagerSeat];
    const source = g.players[pending.sourceSeat]; // 法正
    const resume = pending.resume || { type: 'sha' };
    
    if (!damager || !damager.alive || !source || !source.alive) {
      g.pending = null;
      if(checkWin(g)) return g;
      resumeAfterInterrupt(g, resume, pending.sourceSeat);
      return g;
    }
    
    const hand = damager.hand || [];
    if(!Number.isInteger(cardIndex) || cardIndex<0 || cardIndex>=hand.length || hand[cardIndex].suit!=='♥') return g;
    const card=removeHandCards(g, pending.damagerSeat, cardIndex)[0];
    
    // 添加到source手牌
    if (!source.hand) source.hand = [];
    source.hand.push(card);
    
    g.log = pushLog(g.log, damager.name + ' 交给 ' + source.name + ' 一张♥手牌【' + card.name + '】');
    g.pending = null;
    if(checkWin(g)) return g;
    resumeAfterInterrupt(g, resume, pending.sourceSeat);
    
    return g;
  });
}

// 法正【眩惑】：启动眩惑
function startHuanhuo() {
  tx(g => {
    if(g.phase!=='play' || g.turn!==mySeat || g.huanhuoUsed) return g;
    const me=g.players[mySeat];
    if(!me || !me.alive || !hasCap(me,'huanhuo')) return g;
    const heartCards=(me.hand||[]).filter(card=>card.suit==='♥');
    const candidates=g.players.map((p,i)=>i!==mySeat&&p&&p.alive?i:null).filter(i=>i!==null);
    // 获得第一名角色的牌后必须交给另一名其他角色，所以场上至少需要两名其他存活角色。
    if(!heartCards.length || candidates.length<2) return g;
    // 【B类审计收尾】补setResponseAskedAt,和这四个子阶段的其余三处同一批修复。
    g.pending=setResponseAskedAt({type:'huanhuoPick',sourceSeat:mySeat,candidates});
    g.phase='huanhuoPick';
    g.log=pushLog(g.log,me.name+' 发动【眩惑】,选择目标角色…');
    return g;
  });
}

// 法正【眩惑】：选择目标角色
function pickHuanhuoTarget(seat) {
  tx(g => {
    if(!g.pending || g.pending.type!=='huanhuoPick' || g.pending.sourceSeat!==mySeat) return g;
    if(seat===mySeat || !g.pending.candidates.includes(seat)) return g;
    const me = g.players[mySeat];
    const target = g.players[seat];
    if (!target || !target.alive) return g;
    // 重新按当前手牌校验，不能信任开始发动时保存的旧快照。
    const heartCards=(me.hand||[]).filter(card=>card.suit==='♥');
    if(!heartCards.length) return g;
    // 进入选择♥手牌阶段
    g.pending = setResponseAskedAt({
      type: 'huanhuoPickCard',
      sourceSeat: mySeat,
      targetSeat: seat
    });
    g.phase='huanhuoPickCard';
    
    g.log = pushLog(g.log, me.name + ' 选择 ' + target.name + ' 作为目标,请选择一张♥手牌');
    
    return g;
  });
}

// 法正【眩惑】：选择要交出的♥手牌
function pickHuanhuoHeartCard(cardIndex) {
  tx(g => {
    if(!g.pending || g.pending.type!=='huanhuoPickCard' || g.pending.sourceSeat!==mySeat) return g;
    const me = g.players[mySeat];
    const target = g.players[g.pending.targetSeat];
    if(!me || !me.alive || !target || !target.alive) return g;
    const hand = me.hand || [];
    if(!Number.isInteger(cardIndex) || cardIndex<0 || cardIndex>=hand.length || hand[cardIndex].suit!=='♥') return g;
    const card=removeHandCards(g, mySeat, cardIndex)[0];
    
    // 将这张牌交给目标角色
    if (!target.hand) target.hand = [];
    target.hand.push(card);
    
    // 检查目标角色是否有手牌可获得
    const targetHand = target.hand || [];
    if (targetHand.length === 0) {
      // 目标没有手牌，直接清理状态
      g.log = pushLog(g.log, target.name + ' 没有手牌，【眩惑】无法继续');
      g.pending = null;
      g.phase = 'play';
      return g;
    }
    
    // 进入选择要获得的牌阶段
    g.pending = setResponseAskedAt({
      type: 'huanhuoPickGotCard',
      sourceSeat: mySeat,
      targetSeat: g.pending.targetSeat
    });
    g.phase='huanhuoPickGotCard';
    
    g.log = pushLog(g.log, me.name + ' 交给 ' + target.name + ' 一张♥手牌,请选择要获得的牌');
    
    return g;
  });
}

// 法正【眩惑】：选择要获得的牌
function enterHuanhuoTransfer(g, sourceSeat, firstTargetSeat, transferCardId) {
  const me=g.players[sourceSeat];
  const target=g.players[firstTargetSeat];
  const gotCard=me && (me.hand||[]).find(card=>card && card.id===transferCardId);
  if(!me || !me.alive || !target || !target.alive || !gotCard){
    g.pending=null;
    g.phase='play';
    return;
  }
  const candidates=[];
  for(let i=0;i<g.players.length;i++){
    if(i!==sourceSeat && i!==firstTargetSeat && g.players[i] && g.players[i].alive) candidates.push(i);
  }
  g.pending=setResponseAskedAt({type:'huanhuoPickSecond',sourceSeat,firstTargetSeat,transferCard:gotCard,candidates});
  g.phase='huanhuoPickSecond';
  g.log=pushLog(g.log,me.name+' 获得了 '+target.name+' 的一张牌，请选择要交给的角色');
}

// 目标的手牌是暗置信息，只能随机取得；装备区是公开信息，可以指定一张装备。
function pickHuanhuoGotCard(kind, value) {
  tx(g => {
    if(!g.pending || g.pending.type!=='huanhuoPickGotCard' || g.pending.sourceSeat!==mySeat) return g;
    const me = g.players[mySeat];
    const firstTargetSeat=g.pending.targetSeat;
    const target = g.players[firstTargetSeat];
    if(!me || !me.alive || !target || !target.alive) return g;
    let gotCard=null;
    let lostEquip=false;
    if(kind==='hand'){
      const hand=target.hand||[];
      if(!hand.length) return g;
      gotCard=removeHandCards(g, firstTargetSeat, Math.floor(Math.random()*hand.length))[0];
    } else if(kind==='equip'){
      const slot=String(value||'');
      if(!EQUIP_SLOTS.includes(slot) || !target.equips || !target.equips[slot]) return g;
      gotCard=target.equips[slot];
      target.equips[slot]=null;
      lostEquip=true;
    } else if(Number.isInteger(kind)){
      const hand=target.hand||[];
      if(!hand.length) return g;
      gotCard=removeHandCards(g, firstTargetSeat, Math.floor(Math.random()*hand.length))[0];
    } else return g;
    
    // 添加到自己手牌
    if (!me.hand) me.hand = [];
    me.hand.push(gotCard);
    
    const transferCardId=gotCard.id;
    g.pending=null;
    g.phase='play';
    if(lostEquip){
      triggerHook(g,firstTargetSeat,'onLoseEquip',{count:1});
      if(g.pending && g.pending.type==='xuanfengPick'){
        g.pending.resume={type:'huanhuoTransfer',sourceSeat:mySeat,firstTargetSeat,transferCardId};
        return g;
      }
    }
    enterHuanhuoTransfer(g,mySeat,firstTargetSeat,transferCardId);
    
    return g;
  });
}

// 法正【眩惑】：选择第二个目标角色（交给牌）
function pickHuanhuoSecondTarget(seat) {
  tx(g => {
    if(!g.pending || g.pending.type!=='huanhuoPickSecond' || g.pending.sourceSeat!==mySeat) return g;
    
    if (!g.pending.candidates.includes(seat)) return g;
    
    const me = g.players[mySeat];
    const secondTarget = g.players[seat];
    
    if (!secondTarget || !secondTarget.alive) return g;
    
    // 从自己手牌中移除获得的牌
    const hand = me.hand || [];
    const idx = hand.findIndex(c => c.id === g.pending.transferCard.id);
    if(idx===-1) return g;
    removeHandCards(g, mySeat, idx);
    
    // 将牌交给第二个目标
    if (!secondTarget.hand) secondTarget.hand = [];
    secondTarget.hand.push(g.pending.transferCard);
    
    // 标记已使用眩惑
    g.huanhuoUsed = true;
    
    const firstTarget=g.players[g.pending.firstTargetSeat];
    g.log = pushLog(g.log, me.name + ' 发动【眩惑】,交给 ' + (firstTarget?firstTarget.name:'?') + ' 一张♥手牌,获得其一张牌后交给 ' + secondTarget.name);
    markSkillSound(g, '眩惑');
    
    // 清理状态
    g.pending = null;
    g.phase = 'play';
    
    return g;
  });
}

// 法正【眩惑】：取消眩惑
// 仅允许在选择目标和选择自己的♥手牌阶段取消
function cancelHuanhuo() {
  tx(g => {
    if (g.pending && 
        (g.pending.type === 'huanhuoPick' || g.pending.type === 'huanhuoPickCard') &&
        g.pending.sourceSeat === mySeat) {
      g.pending = null;
      g.phase = 'play';
      g.log = pushLog(g.log, g.players[mySeat].name + ' 取消发动【眩惑】');
    }
    return g;
  });
}

// ========== 曹冲技能实现 ==========

// 曹冲【称象】：获取牌的点数
function getCardValue(card) {
  const rank = card.rank;
  if (rank === 'A' || rank === 'a') return 1;
  if (rank === 'J' || rank === 'j') return 11;
  if (rank === 'Q' || rank === 'q') return 12;
  if (rank === 'K' || rank === 'k') return 13;
  const num = parseInt(rank);
  return isNaN(num) ? 0 : num;
}

// 曹冲【称象】：计算可选组合，包含空集
function calculateChengxiangOptions(cardValues, sumLimit) {
  const n = cardValues.length;
  const selectable = [];
  
  for (let mask = 0; mask < (1 << n); mask++) {
    let sum = 0;
    const indices = [];
    for (let i = 0; i < n; i++) {
      if (mask & (1 << i)) {
        sum += cardValues[i].value;
        indices.push(i);
      }
    }
    if (sum <= sumLimit) {
      selectable.push({ indices, sum });
    }
  }
  
  if (selectable.length === 0) {
    selectable.push({ indices: [], sum: 0 });
  }
  
  return selectable;
}

// 曹冲【称象】：确认发动称象（从询问阶段进入选择阶段）
function confirmChengxiangAsk() {
  tx(g => {
    if (g.pending.type !== 'chengxiangAsk') return g;

    const seat = g.pending.seat;
    const resume = g.pending.resume || {type:'sha'};
    if (seat !== mySeat) return g; // 仅曹冲本人可发动,和 chooseRenxinEquip 同一守卫写法
    const me = g.players[seat];
    
    // 确保牌堆有至少4张牌
    ensureDeck(g, 4);
    
    // 亮出牌堆顶的 min(4, remaining) 张牌
    const drawCount = Math.min(4, g.deck.length);
    const revealed = [];
    for(let i=0;i<drawCount;i++) revealed.push(g.deck.pop());
    
    // 如果牌堆为空，直接取消
    if (revealed.length === 0) {
      g.pending = null;
      g.log = pushLog(g.log, me.name + ' 牌堆为空，无法发动【称象】');
      resumeAfterInterrupt(g,resume,seat);
      return g;
    }
    
    // 计算每张牌的点数
    const cardValues = revealed.map(card => ({ 
      card, 
      value: getCardValue(card) 
    }));
    
    // 预计算所有可能的选择组合
    const selectable = calculateChengxiangOptions(cardValues, 13);
    
    // 进入选择阶段
    g.pending = {
      type: 'chengxiangChoose',
      seat: seat,
      revealedCards: revealed,
      cardValues: cardValues,
      sumLimit: 13,
      selectable: selectable,
      resume
    };
    
    g.log = pushLog(g.log, me.name + ' 发动【称象】,亮出了 ' + drawCount + ' 张牌');
    markSkillSound(g, '称象');
    return g;
  });
}

// 曹冲【称象】：取消发动称象
function cancelChengxiangAsk() {
  tx(g => {
    if (g.pending.type !== 'chengxiangAsk') return g;
    if (g.pending.seat !== mySeat) return g; // 仅曹冲本人可取消——任务未明确点名的第4处同型缺口,一并修
    const seat=g.pending.seat, resume=g.pending.resume||{type:'sha'};
    g.pending = null;
    resumeAfterInterrupt(g,resume,seat);
    return g;
  });
}

// 曹冲【称象】：选择完成
function confirmChengxiang(selection) {
  tx(g => {
    if (g.pending.type !== 'chengxiangChoose') return g;
    const seat = g.pending.seat;
    if (seat !== mySeat) return g; // 仅曹冲本人可确认选牌
    const me = g.players[seat];
    const pending = g.pending;
    const resume = pending.resume || {type:'sha'};
    
    const selectedIndices = selection && Array.isArray(selection.indices) ? selection.indices : [];
    const uniqueIndices=[...new Set(selectedIndices)];
    if(uniqueIndices.length!==selectedIndices.length || uniqueIndices.some(idx=>!Number.isInteger(idx)||idx<0||idx>=pending.revealedCards.length)) return g;
    const selectedSum=uniqueIndices.reduce((sum,idx)=>sum+pending.cardValues[idx].value,0);
    if(selectedSum>pending.sumLimit) return g;
    const selectedCards = selectedIndices.map(idx => pending.revealedCards[idx]);
    
    if (selectedCards.length > 0) {
      me.hand = me.hand || [];
      me.hand.push(...selectedCards);
    }
    
    const unselectedCards = pending.revealedCards.filter(
      (_, idx) => !selectedIndices.includes(idx)
    );
    g.discard = g.discard || [];
    g.discard.push(...unselectedCards);
    
    g.log = pushLog(g.log, me.name + ' 获得了' + (selectedIndices.length > 0 ? selectedCards.map(c => c.name).join(',') : '0张牌'));
    g.pending = null;
    resumeAfterInterrupt(g,resume,seat);
    return g;
  });
}

// 曹冲【称象】：选择0张牌
function cancelChengxiang() {
  tx(g => {
    if (g.pending.type !== 'chengxiangChoose') return g;
    const seat = g.pending.seat;
    if (seat !== mySeat) return g; // 仅曹冲本人可选择0张
    const me = g.players[seat];
    const resume=g.pending.resume||{type:'sha'};
    g.discard = g.discard || [];
    g.discard.push(...g.pending.revealedCards);
    g.log = pushLog(g.log, me.name + ' 选择了0张牌，所有牌置入弃牌堆');
    g.pending = null;
    resumeAfterInterrupt(g,resume,seat);
    return g;
  });
}

// 曹冲【仁心】：选择装备牌弃置并防止伤害
// slot 是 EQUIP_SLOTS 之一(weapon/armor/plus1/minus1)
function chooseRenxinEquip(slot) {
  tx(g => {
    if (!g.pending || g.pending.type !== 'renxinChoose') return g;
    const seat = g.pending.seat;
    if (seat !== mySeat) return g;
    const me = g.players[seat];
    const target = g.players[g.pending.target];
    const pending = g.pending;
    const info = pending.originalDamageInfo || {};
    
    if (!(pending.equipSlots || []).includes(slot) || !me.equips || !me.equips[slot]) {
      return g;
    }
    
    const equipCard = me.equips[slot];
    me.equips[slot] = null;
    g.discard = g.discard || [];
    g.discard.push(equipCard);
    markDiscardReveal(g, seat, [equipCard]);
    triggerHook(g, seat, 'onLoseEquip', {count:1});
    
    // 翻面(真实字段 faceup)
    me.faceup = (me.faceup === false) ? true : false;
    
    g.log = pushLog(g.log, me.name + ' 发动【仁心】,弃置装备【' + equipCard.name + '】,' + (me.faceup !== false ? '正面朝上' : '背面朝上') + ',防止了对 ' + (target?target.name:'?') + ' 的伤害');
    markSkillSound(g, '仁心');
    g.pending = null;
    // 伤害被防止:接回原流程尾巴
    if(checkWin(g)) return g;
    resumeAfterInterrupt(g, {type: info.srcType || 'sha'}, info.sourceSeat);
    return g;
  });
}

// 曹冲【仁心】：不发动 → 按原参数重放伤害(跳过已拒绝的保护者,防死循环)
function cancelRenxin() {
  tx(g => {
    if (!g.pending || g.pending.type !== 'renxinChoose') return g;
    if (g.pending.seat !== mySeat) return g;
    const pending = g.pending;
    const info = pending.originalDamageInfo || {};
    const to = (info.to != null) ? info.to : pending.target;
    const skipList = Array.isArray(pending.skipRenxinSeats) ? pending.skipRenxinSeats.slice() : [];
    skipList.push(pending.seat);
    g.pending = null;
    g.log = pushLog(g.log, g.players[mySeat].name + '：不发动【仁心】');
    const dying = dealDamage(
      g, to, info.amount, info.sourceSeat, info.reason, info.srcType, info.sourceCard,
      false, false, false, false, skipList
    );
    if(dying) return g;
    if(checkWin(g)) return g;
    resumeAfterInterrupt(g, {type: info.srcType || 'sha'}, info.sourceSeat);
    return g;
  });
}
