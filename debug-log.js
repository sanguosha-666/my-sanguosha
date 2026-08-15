// ==================== 调试日志系统(debugLogs) ====================
// 排查"机器人卡死/报错"这类难以复现的问题用——纯前端项目、机器人跑在真人浏览器里,
// 出问题后此前没有任何留痕手段。只在异常/该关注的情况下写,不是每次 tx 都写。
//
// 存储结构:顶层独立节点(和 rooms/ 平级,不挂在 rooms/{房间号} 下——生命周期不同,
// 混在一起以后不好单独清理):
//   debugLogs/{房间号}/{反向时间戳}_{随机后缀}: { ...单条记录... }
// key 用反向时间戳(9999999999999 - Date.now(),补零到13位定长)+ 随机后缀,让
// Firebase 控制台默认的字典序展开时最新记录排在最上面,同时避免同一毫秒内 key 冲突。
//
// kind 枚举(维护这份清单,不要在各处随手写新字符串):
//   js_error                —— 未捕获异常/未处理的Promise rejection,stack 字段带完整堆栈
//   timeout_stuck           —— 30秒超时后 autoRespondAction 返回 null,没有保守动作可提交
//   bot_decision_failed     —— 机器人决策分支执行了但没能成功提交动作(状态提交前后未变化)
//   pending_orphan_detected —— normalize 发现不合法 pending,已被强制清空(记录清空前内容)
//   bot_decision_trace      —— (CORE-109,CORE-72 收窄)AI 决策的**异常**信号。
//                              目前只剩 source=ai_response_unusable(AI 返回 200 但解析失败/
//                              索引越界,本次退本地兜底)。CORE-72 起 source=llm 的正常决策
//                              流水不再写这里——debugLogs 只记异常,正常流水由 AI 决策面板
//                              (aiDecisionRecords,CORE-73)承载,数据更全(带prompt/原始返回/
//                              理由/武将/模型)。只在配置了 AI 密钥时才可能产生。
//   ai_call_failed          —— (CORE-109)callAI 失败(超时/网络/解析/HTTP错误/鉴权/全池冷却),
//                              含 provider/model/失败类别/耗时
//   ai_lock_stuck           —— (CORE-109)botDecisionInFlight 决策锁超过看门狗阈值未释放,
//                              已被强制清零(可能AI调用挂死或浏览器被节流)
const DEBUG_LOG_KINDS = [
  'js_error', 'timeout_stuck', 'bot_decision_failed', 'pending_orphan_detected',
  'bot_decision_trace', 'ai_call_failed', 'ai_lock_stuck'
];

// debugLogIsoTime: 本地时区人类可读时间,'YYYY-MM-DD HH:mm:ss'。
function debugLogIsoTime(ts){
  const d = new Date(ts);
  function p2(n){ return n < 10 ? '0' + n : '' + n; }
  return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) + ' '
    + p2(d.getHours()) + ':' + p2(d.getMinutes()) + ':' + p2(d.getSeconds());
}

// debugLogPlayersSummary: 只取公开信息(座位/名字/血量/存活/是否机器人)。
// 绝不能包含手牌内容、判定牌具体是什么、装备之外的隐藏信息——朋友局也不该让调试日志
// 变成看牌器。
function debugLogPlayersSummary(g){
  try{
    if(!g || !Array.isArray(g.players)) return null;
    return g.players.map(function(p, i){
      if(!p) return null;
      return { seat: i, name: p.name || null, hp: (typeof p.hp === 'number' ? p.hp : null), alive: !!p.alive, isBot: !!p.isBot };
    });
  }catch(e){ return null; }
}

// writeDebugLog: 唯一的写入入口,所有触发点都调用这一个函数,不要各处分别拼 JSON。
// fire-and-forget:失败绝不能反过来影响正常游戏逻辑(和 render-table.js 飞牌动画那段
// try/catch 的既定原则一致),但**不再完全静默**——写入失败时在 Console 留一条
// console.warn(带上原始 err),否则线上出问题时(比如 Firebase Rules 没有放行
// debugLogs/{roomId},见 CORE-71)开发者连"到底是不是权限问题"都无从判断。
function writeDebugLog(roomIdArg, kind, payload){
  try{
    if(typeof db === 'undefined' || !db) return; // Firebase 未配置,静默跳过
    if(!roomIdArg) return; // 没有房间号(比如还没加入房间时的早期错误),静默跳过
    if(DEBUG_LOG_KINDS.indexOf(kind) < 0){
      if(typeof console !== 'undefined') console.warn('writeDebugLog: 未知 kind', kind);
      return;
    }
    const now = Date.now();
    const revTs = String(9999999999999 - now).padStart(13, '0');
    const suffix = Math.random().toString(36).slice(2, 8);
    const key = revTs + '_' + suffix;
    const entry = Object.assign({
      ts: now,
      isoTime: debugLogIsoTime(now),
      kind: kind,
      phase: null,
      pendingType: null,
      turn: null,
      roundNum: null,
      seat: null,
      message: '',
      pendingSnapshot: null,
      playersSummary: null,
      stack: null
    }, payload || {});
    const ref = db.ref('debugLogs/' + roomIdArg + '/' + key);
    const p = ref.set(entry);
    if(p && typeof p.catch === 'function'){
      p.catch(function(err){
        if(typeof console !== 'undefined') console.warn('写入调试日志失败:', err);
      });
    }
  }catch(e){
    if(typeof console !== 'undefined') console.warn('writeDebugLog 出错:', e);
  }
}

// logPendingOrphan: normalize() 里"检测到不合法 pending、强制清空"的统一入口。
// 【调用时机要求】必须在真正执行 g.pending=null 之前调用——此时 g.pending 还是清空前
// 的原始内容,记录下来的 pendingSnapshot 才有意义("被清空前是什么",不是清空后的 null)。
//
// 【A/B 分类,2026-08 复核后引入】normalize() 里 105 处调用点全部传一个以 'A:' 或 'B:'
// 开头的 reason 字符串,标注这次复核对该分支的判断——不是自由文本,是这两个前缀的约定:
//   'A:' —— 校验条件包含"结构不合法"(字段类型不对、必须非空的数组为空、resume/judgeCard
//           这类子对象缺失等),这些字段只有创建/收尾这条链的 respond*/finish* 函数自己
//           写错了才会出现,和"引用的座位是否还存活"这个会随时随外部事件变化的条件无关。
//           一旦触发基本可以断定是上游某个收尾函数漏写了、真正的bug信号,不做频率控制,
//           每次都记(这类分支设计上就该几乎不触发,不存在"正常游戏里也会频繁触发"的
//           风险,限流反而会把唯一一次报警埋掉)。
//   'B:' —— 校验条件只是"引用的座位是否还存活"(或同等的纯粹存在性检查),而这个项目里
//           大量pending代表的是"多方参与的、可被并发中断的流程"(比如决斗/AOE响应/濒死
//           求桃期间另一方因为完全不相关的伤害/技能而阵亡)——CLAUDE.md"濒死求桃"那段
//           明确写了阵亡随时可能挂起并打断进行中的流程,所以这类校验在正常游戏里确实
//           会不时合理触发,不是bug信号,但同一类型短时间内反复触发也没有额外信息量,
//           所以做60秒频率控制(同一 pendingType+reason 一个窗口只记一次),避免刷屏。
// 复核结论:105处里没有发现"设计上就有问题、这次任务应该顺带修"的分支(逐条读过一遍,
// 结论就是上述二分类),如果以后复核出这类问题,应该在这里补一条"C:"标注单独列出,而不是
// 顺手在这次改动里修掉。
// ==================== pendingSnapshot 白名单化(隐私修复,2026-08) ====================
// 【根因】此前 pendingSnapshot 一律 JSON.parse(JSON.stringify(g.pending)) 原样转存,没有
// 任何字段过滤——蛊惑(guhuoQuestion/guhuoTarget)的 actualCard(诡称牌真实身份)、恩怨
// (enyuanChooseOption)的 heartCards(伤害来源自己的红色手牌列表)、眩惑(huanhuoPickSecond)
// 的 transferCard(转手途中的具体牌)三个真实泄露案例都是这么产生的(见
// docs/debug-log-audit.md)。
//
// 【设计原则:白名单,不是黑名单】黑名单("逐个排除敏感字段")每次新增一个带隐藏信息的技能都
// 要记得同步更新排除清单,这正是上面三个漏洞的产生方式——写技能的时候完全没想到"这个字段会被
// debugLogs 原样转存"这件事。改成白名单后,默认姿态反过来:只有显式列在 PENDING_SNAPSHOT_
// ALLOWED_FIELDS 里的字段才会被保留原始内容,任何新增技能往 pending 里塞的新字段,只要没有
// 被显式加进这份名单,默认就不会出现在 debugLogs 里——不需要每次新增技能时都记得"排除"什么,
// 从源头堵住这类问题再次发生的可能。
//
// 【名单是怎么定出来的】通读了一遍 game.js normalize() 里全部 105 处校验分支实际用到的字段名
// (逐条核对过每个字段的赋值来源,不是猜的),按语义分两类:
//   - ALLOWED:纯结构性信息——座位号/座位号数组、数量、布尔、阶段/枚举字符串、下标/索引这类,
//     不涉及任何具体牌的名字/花色/点数/内容。包括 resume(它是常见的"接回被打断流程"嵌套对象,
//     递归应用同一套过滤规则,不是整体放行)。
//   - REDACTED:字段名本身就代表"这里挂着一张/一组具体的牌"(actualCard/claimedCard/judgeCard/
//     sourceCard/cards/cardToGive/cardName/heartCards/transferCard/revealedCards/selfCard/
//     damageInfo/originalDamageInfo/originalCtx/pool/shaColor/suit/card/hand/delays/equips等)
//     ——保留字段名本身(排查时"知道这里涉及一张牌"这个事实有用),但把值替换成占位符,不暴露
//     具体内容。judgeCard/sourceCard 严格说很多场景下已经是公开信息(判定牌翻出来、杀已经打出
//     都是公开的),但这次统一按"只要字段名语义上可能带牌面内容就脱敏"处理,不逐个论证"这次
//     具体是不是真的已公开"——多脱敏一点不会有安全代价,少脱敏一次就可能是下一次真实泄露。
//   - 其余没在这两份名单里出现过的字段名,一律静默丢弃(连 key 都不出现),不留占位符。
const PENDING_SNAPSHOT_ALLOWED_FIELDS = [
  'type','seat','from','to','asking','sourceSeat','targetSeat','target','target2Seat','targets',
  'otherSeat','judgedSeat','damagedSeat','damagerSeat','damageSource','baseTarget','currentSeat',
  'firstTargetSeat','endingSeat','seatA','seatB','lordSeat','exclude','active','available',
  'amount','death','needed','noDistance','half','played','wasFacedown','previousPhase',
  'costType','sumLimit','takeN','askedAt','depth','idx','need','kind','index','value','label',
  'phase','askedSeats','availableTargets','availableSlots','questioners','answered','candidates',
  'remainingSeats','remaining','discardedCounts','equipSlots','weaponIndices','cardIndices',
  'cardIds','availablePairs','order','selectable','options','selections','resume'
];
const PENDING_SNAPSHOT_REDACTED_FIELDS = [
  'actualCard','claimedCard','judgeCard','sourceCard','cards','cardToGive','cardName',
  'heartCards','transferCard','revealedCards','selfCard','damageInfo','originalDamageInfo',
  'originalCtx','pool','shaColor','suit','card','hand','delays','equips'
];
const PENDING_SNAPSHOT_REDACT_PLACEHOLDER = '[已隐藏:可能含具体牌面/手牌内容,不写入日志]';
// sanitizePendingForLog: 递归过滤,数组元素/嵌套对象(如 resume)都过同一套名单,不是只在
// 最外层做一次浅过滤——resume 内部还可能挂着 sourceCard/shaColor 这类同名的敏感字段。
function sanitizePendingForLog(value, depth){
  depth = depth || 0;
  if(depth > 6) return null; // 防御性熔断,正常 pending 结构不会嵌套这么深
  if(Array.isArray(value)){
    return value.map(function(item){ return sanitizePendingForLog(item, depth + 1); });
  }
  if(value && typeof value === 'object'){
    const out = {};
    Object.keys(value).forEach(function(key){
      if(PENDING_SNAPSHOT_ALLOWED_FIELDS.indexOf(key) >= 0){
        out[key] = sanitizePendingForLog(value[key], depth + 1);
      } else if(PENDING_SNAPSHOT_REDACTED_FIELDS.indexOf(key) >= 0){
        out[key] = PENDING_SNAPSHOT_REDACT_PLACEHOLDER;
      }
      // 其余字段名一律不出现在结果里(白名单默认拒绝)。
    });
    return out;
  }
  return value; // 基本类型(数字/字符串/布尔/null)原样保留
}

const PENDING_ORPHAN_RATE_LIMIT_MS = 60000;
let __pendingOrphanLastLogged = {}; // key(roomId+type+reason) -> 上次记录的ts,纯内存、不跨刷新持久化
function isSharedDebugLogReporter(g){
  const controller = (g.players || []).find(function(p){ return p && !p.isBot && p.cid; });
  if(!controller) return true; // 尚无可识别控制端时保留单客户端诊断能力
  return typeof myClientId !== 'undefined' && controller.cid === myClientId;
}
function logPendingOrphan(g, reason){
  try{
    if(!g || !g.pending) return;
    if(!isSharedDebugLogReporter(g)) return;
    const type = g.pending.type || 'unknown';
    const isRateLimited = typeof reason === 'string' && reason.indexOf('B:') === 0;
    if(isRateLimited){
      const roomKey = typeof roomId !== 'undefined' && roomId !== null ? String(roomId) : 'unknown-room';
      const key = roomKey + '|' + type + '|' + reason;
      const now = Date.now();
      const last = __pendingOrphanLastLogged[key];
      if(last !== undefined && (now - last) < PENDING_ORPHAN_RATE_LIMIT_MS) return; // 60秒内已经记过同一种,跳过
      __pendingOrphanLastLogged[key] = now;
    }
    const rawType = g.pending.type || null; // 取type用来分类,不经过白名单(type本身就在白名单里,这里只是避免下面snap还没算出来前用不到)
    const snap = sanitizePendingForLog(g.pending);
    writeDebugLog(typeof roomId !== 'undefined' ? roomId : null, 'pending_orphan_detected', {
      phase: g.phase || null,
      pendingType: rawType,
      turn: (typeof g.turn === 'number' ? g.turn : null),
      roundNum: (typeof g.roundNum === 'number' ? g.roundNum : null),
      message: 'normalize发现不合法的pending,已强制清空(' + reason + ')',
      pendingSnapshot: snap,
      playersSummary: debugLogPlayersSummary(g)
    });
  }catch(e){ /* 静默 */ }
}

// ---- 1. 全局未捕获异常 / Promise rejection 兜底捕获 ----
if(typeof window !== 'undefined' && typeof window.addEventListener === 'function'){
  window.addEventListener('error', function(ev){
    try{
      const g = (typeof currentG !== 'undefined') ? currentG : null;
      writeDebugLog(typeof roomId !== 'undefined' ? roomId : null, 'js_error', {
        phase: g ? g.phase : null,
        turn: g ? g.turn : null,
        roundNum: g ? g.roundNum : null,
        seat: (typeof mySeat !== 'undefined') ? mySeat : null,
        message: '未捕获异常: ' + ((ev && ev.message) || '未知错误'),
        stack: (ev && ev.error && ev.error.stack) || null,
        playersSummary: g ? debugLogPlayersSummary(g) : null
      });
    }catch(e){ /* 静默 */ }
  });
  window.addEventListener('unhandledrejection', function(ev){
    try{
      const g = (typeof currentG !== 'undefined') ? currentG : null;
      const reason = ev && ev.reason;
      writeDebugLog(typeof roomId !== 'undefined' ? roomId : null, 'js_error', {
        phase: g ? g.phase : null,
        turn: g ? g.turn : null,
        roundNum: g ? g.roundNum : null,
        seat: (typeof mySeat !== 'undefined') ? mySeat : null,
        message: '未处理的Promise rejection: ' + ((reason && reason.message) || String(reason)),
        stack: (reason && reason.stack) || null,
        playersSummary: g ? debugLogPlayersSummary(g) : null
      });
    }catch(e){ /* 静默 */ }
  });
}

// ---- 清理机制:手动触发,清掉超过7天的记录。不设定时器(给朋友玩的项目,不需要
// 常驻的自动清理逻辑),在浏览器 console 里手动调用即可:
//   cleanupOldDebugLogs()            —— 清理所有房间超过7天的记录
//   cleanupOldDebugLogs('1234')      —— 只清理房间1234的
function cleanupOldDebugLogs(roomIdArg){
  try{
    if(typeof db === 'undefined' || !db){ console.warn('cleanupOldDebugLogs: Firebase 未配置'); return; }
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    // revTs 随 ts 增大而减小,所以"早于 cutoff"等价于"revTs 大于 cutoffRevTs"(字符串定长
    // 补零,字典序比较等价于数值比较)。
    const cutoffRevTs = String(9999999999999 - cutoff).padStart(13, '0');
    function collectAndDelete(snap, roomKey, updates){
      snap.forEach(function(child){
        const key = child.key;
        const revPart = key.split('_')[0];
        if(revPart > cutoffRevTs) updates['debugLogs/' + roomKey + '/' + key] = null;
      });
    }
    const rootRef = roomIdArg ? db.ref('debugLogs/' + roomIdArg) : db.ref('debugLogs');
    rootRef.get().then(function(snap){
      if(!snap.exists()){ console.log('cleanupOldDebugLogs: 没有记录'); return; }
      const updates = {};
      if(roomIdArg){
        collectAndDelete(snap, roomIdArg, updates);
      }else{
        snap.forEach(function(roomSnap){ collectAndDelete(roomSnap, roomSnap.key, updates); });
      }
      const n = Object.keys(updates).length;
      if(n === 0){ console.log('cleanupOldDebugLogs: 没有超过7天的记录需要清理'); return; }
      db.ref().update(updates).then(function(){
        console.log('cleanupOldDebugLogs: 已清理 ' + n + ' 条超过7天的记录');
      }).catch(function(e){ console.warn('cleanupOldDebugLogs: 清理失败', e); });
    }).catch(function(e){ console.warn('cleanupOldDebugLogs: 读取失败', e); });
  }catch(e){ console.warn('cleanupOldDebugLogs 出错', e); }
}

// ---- 历史脏数据清理:隐私修复(2026-08,sanitizePendingForLog白名单化)之前写入的记录,
// pendingSnapshot 里可能还留着 actualCard/heartCards/transferCard 等未脱敏的原始牌面内容
// (guhuoQuestion/guhuoTarget/enyuanChooseOption/huanhuoPickSecond 四个已确认的真实泄露
// 场景,见 docs/debug-log-audit.md)。这个函数只重写 pendingSnapshot 字段本身(用新的
// sanitizePendingForLog 重新过滤一遍),不删除整条记录——同一惯例,手动在浏览器 console 里
// 调用,不设自动触发:
//   sanitizeExistingDebugLogs()          —— 扫描所有房间,重写pendingSnapshot不合规的记录
//   sanitizeExistingDebugLogs('1234')    —— 只扫描房间1234的
// 【这次修复没有代替你执行这个函数】——本地开发环境拿不到生产 Firebase 的读写权限/凭据,
// 也不应该在没有明确确认的情况下对线上数据做批量改写,这是你自己决定要不要跑的操作。
function sanitizeExistingDebugLogs(roomIdArg){
  try{
    if(typeof db === 'undefined' || !db){ console.warn('sanitizeExistingDebugLogs: Firebase 未配置'); return; }
    function scanAndFix(snap, roomKey, updates, stats){
      snap.forEach(function(child){
        const entry = child.val();
        if(!entry || entry.pendingSnapshot === undefined || entry.pendingSnapshot === null) return;
        stats.scanned++;
        const resanitized = sanitizePendingForLog(entry.pendingSnapshot);
        const before = JSON.stringify(entry.pendingSnapshot);
        const after = JSON.stringify(resanitized);
        if(before !== after){
          updates['debugLogs/' + roomKey + '/' + child.key + '/pendingSnapshot'] = resanitized;
          stats.fixed++;
        }
      });
    }
    const rootRef = roomIdArg ? db.ref('debugLogs/' + roomIdArg) : db.ref('debugLogs');
    rootRef.get().then(function(snap){
      if(!snap.exists()){ console.log('sanitizeExistingDebugLogs: 没有记录'); return; }
      const updates = {};
      const stats = { scanned: 0, fixed: 0 };
      if(roomIdArg){
        scanAndFix(snap, roomIdArg, updates, stats);
      }else{
        snap.forEach(function(roomSnap){ scanAndFix(roomSnap, roomSnap.key, updates, stats); });
      }
      console.log('sanitizeExistingDebugLogs: 扫描了 ' + stats.scanned + ' 条带pendingSnapshot的记录,其中 ' + stats.fixed + ' 条需要重新脱敏');
      if(stats.fixed === 0){ console.log('sanitizeExistingDebugLogs: 没有需要修复的记录'); return; }
      db.ref().update(updates).then(function(){
        console.log('sanitizeExistingDebugLogs: 已重写 ' + stats.fixed + ' 条记录的pendingSnapshot');
      }).catch(function(e){ console.warn('sanitizeExistingDebugLogs: 写入失败', e); });
    }).catch(function(e){ console.warn('sanitizeExistingDebugLogs: 读取失败', e); });
  }catch(e){ console.warn('sanitizeExistingDebugLogs 出错', e); }
}

// ==================== "查看调试日志"按钮 / 弹窗(showDebugLog) ====================
// 入口:index.html 里 #debugLogBtn(挂在 #closeRoomBtn 正下方,44x44圆形图标🐛),
// onclick 直接调这里。复用 render.js 的 showInfo/#infoModal 机制(和帮助/日志浮层
// 同一套弹窗骨架),不新建一套弹窗系统。

// kind 中文映射:维护这一份,不在渲染代码里散着写文案。
const DEBUG_LOG_KIND_LABELS = {
  js_error: '❌ JS异常',
  timeout_stuck: '⏱️ 超时卡死',
  bot_decision_failed: '🤖 机器人决策失败',
  pending_orphan_detected: '🧹 pending被清空',
  bot_decision_trace: '📋 AI响应不可用',
  ai_call_failed: '📡 AI调用失败',
  ai_lock_stuck: '🔒 AI决策锁卡死'
};

// DEBUG_LOG_KIND_HINTS: 每种 kind 的"可能原因"一句话提示(不宣称是百分百根因,只是
// 缩小排查范围的起点),展示在展开详情里、JSON pretty-print 之前一行。
const DEBUG_LOG_KIND_HINTS = {
  js_error: '可能原因:查看下方 stack 里第一条属于项目源码的位置',
  timeout_stuck: '可能原因:当前 pending 类型可能没有配置超时保守动作',
  bot_decision_failed: '可能原因:机器人进入该阶段但没有成功提交合法动作',
  pending_orphan_detected: '可能原因:pending 结构异常,或引用的玩家状态已失效',
  bot_decision_trace: '可能原因:AI返回了内容但解析失败或选了候选外的下标,本次已退本地兜底(正常决策流水见AI决策面板)',
  ai_call_failed: '可能原因:AI服务超时/网络问题/密钥或额度问题/响应格式解析失败,message 里有具体分类',
  ai_lock_stuck: '可能原因:控制器浏览器被节流/切后台,或某次AI调用异常挂死未能resolve'
};

// DEBUG_LOG_ERROR_CODE_HINTS: showDebugLog() 整体读取失败时,按 Firebase 错误 code 给
// 的提示(和上面 DEBUG_LOG_KIND_HINTS 是两回事——那个是"记录本身讲了什么故障",这个是
// "为什么连记录都读不到")。目前只有 CORE-71 实测确认过的 PERMISSION_DENIED 一种,以后
// 遇到新的错误 code 再补,不预先猜测穷举。
const DEBUG_LOG_ERROR_CODE_HINTS = {
  PERMISSION_DENIED: 'Firebase Rules 可能未允许 debugLogs/{roomId} 访问'
};

// extractProjectSourceLocation: 从一段浏览器 stack trace 文本里提取第一条"文件名:行号"。
// 按"是不是 .js 文件"这个通用形状匹配文件名本身,不维护本项目文件名清单——新增/拆分
// 文件(game.js/render*.js/skills.js 等)不需要同步更新这里。
// 【子目录前缀】项目按域拆分出的子目录当前只有 sha//skills//stages/ 三个(KNOWN_SUBFOLDERS),
// 只有这三个名字出现在文件名紧邻前一段路径时才拼上"子目录/文件名"——不能用通用规则把
// URL 路径里任意一段都当子目录(会把 "github.io/my-sanguosha/xxx.js" 误拼成
// "my-sanguosha/xxx.js")。以后如果再拆出新的子目录,把名字加进这份小名单即可,维护量
// 远小于维护一份逐文件清单。
// 唯一需要主动排除的是明确不属于本项目业务代码的第三方脚本(目前只有 Firebase compat
// SDK,按域名/文件名关键字排除)。cache-bust 的 "?v=123" 查询串会被剥掉,只留"文件名:行号"。
const DEBUG_LOG_KNOWN_SUBFOLDERS = ['sha', 'skills', 'stages'];
function extractProjectSourceLocation(stack){
  if(!stack || typeof stack !== 'string') return null;
  const lines = stack.split('\n');
  for(let i = 0; i < lines.length; i++){
    const line = lines[i];
    if(/firebase[-.]|gstatic\.com|googleapis\.com/i.test(line)) continue;
    const m = /([^\/\s()?]+\.js)(?:\?[^:()]*)?:(\d+)(?::\d+)?/.exec(line);
    if(!m) continue;
    const before = line.slice(0, line.indexOf(m[0]));
    const seg = /([A-Za-z0-9_-]+)\/$/.exec(before);
    const file = (seg && DEBUG_LOG_KNOWN_SUBFOLDERS.indexOf(seg[1]) >= 0) ? (seg[1] + '/' + m[1]) : m[1];
    return file + ':' + m[2];
  }
  return null;
}

// debugLogActorLabel: 从 entry.seat + entry.playersSummary(写入时的公开信息快照)里
// 反查"当前行动玩家"的显示名字。两者任一缺失都返回空串(老记录/早期错误可能没有这两个
// 字段,不强行拼出"座位undefined"这种半成品文案)。
function debugLogActorLabel(entry){
  if(typeof entry.seat !== 'number' || !Array.isArray(entry.playersSummary)) return '';
  const p = entry.playersSummary[entry.seat];
  return (p && p.name) ? p.name : ('座位' + entry.seat);
}

// debugLogEntryHtml: 单条记录的默认视图(摘要行,一直显示)+ 展开详情(默认隐藏,点摘要行
// 切换)。
// 默认视图:时间 + kind中文(js_error 额外拼上"文件名:行号") + phase(如果有) +
// 当前行动玩家(如果能反查到) + message——控制在"10秒内看懂大概是什么"这个目标内,
// 不默认铺开 pendingSnapshot/playersSummary/stack 这类大段 JSON。
// 展开详情:先一行 kind 对应的"可能原因"提示,再是 turn/roundNum/seat/pendingType/
// pendingSnapshot/playersSummary/stack 整体格式化成 JSON pretty-print(stack 放在
// detailObj 里,js_error 时是排查的重点)。
function debugLogEntryHtml(entry, idx){
  const kindLabel = (DEBUG_LOG_KIND_LABELS[entry.kind] !== undefined) ? DEBUG_LOG_KIND_LABELS[entry.kind] : String(entry.kind);
  const loc = (entry.kind === 'js_error') ? extractProjectSourceLocation(entry.stack) : null;
  const kindText = loc ? (kindLabel + ' | ' + loc) : kindLabel;
  const phaseHtml = entry.phase ? ('<span class="dbglog-phase">phase=' + escapeHtml(String(entry.phase)) + '</span>') : '';
  const actor = debugLogActorLabel(entry);
  const actorHtml = actor ? ('<span class="dbglog-actor">' + escapeHtml(actor) + '</span>') : '';
  const summary = '<div class="dbglog-row" data-idx="' + idx + '">'
    + '<span class="dbglog-time">' + escapeHtml(entry.isoTime || '') + '</span>'
    + '<span class="dbglog-kind">' + escapeHtml(kindText) + '</span>'
    + phaseHtml
    + actorHtml
    + '<div class="dbglog-msg">' + escapeHtml(entry.message || '') + '</div>'
    + '</div>';
  const hint = DEBUG_LOG_KIND_HINTS[entry.kind];
  const hintHtml = hint ? ('<span class="dbglog-hint">' + escapeHtml(hint) + '</span>') : '';
  const detailObj = {
    turn: entry.turn, roundNum: entry.roundNum, seat: entry.seat, pendingType: entry.pendingType,
    pendingSnapshot: entry.pendingSnapshot, playersSummary: entry.playersSummary, stack: entry.stack
  };
  const detail = '<div class="dbglog-detail hidden" data-idx="' + idx + '">'
    + hintHtml
    + '<pre>' + escapeHtml(JSON.stringify(detailObj, null, 2)) + '</pre>'
    + '</div>';
  return '<div class="dbglog-item">' + summary + detail + '</div>';
}

// debugLogStatsHtml: 顶部统计条——这一批(默认最近50条)里四类各出现几次,帮着一眼判断
// "这段时间大概出了什么类型的问题",不是精确的历史全量统计(受 limitToFirst(50) 限制)。
function debugLogStatsHtml(entries){
  const counts = { js_error: 0, timeout_stuck: 0, pending_orphan_detected: 0, bot_decision_failed: 0 };
  entries.forEach(function(e){
    if(e && Object.prototype.hasOwnProperty.call(counts, e.kind)) counts[e.kind]++;
  });
  return '<div class="dbglog-stats">最近' + entries.length + '条 —— '
    + '❌JS异常 ' + counts.js_error + ' ／ '
    + '⏱️超时卡死 ' + counts.timeout_stuck + ' ／ '
    + '🧹pending异常 ' + counts.pending_orphan_detected + ' ／ '
    + '🤖机器人失败 ' + counts.bot_decision_failed
    + '</div>';
}

// showDebugLog: 拉取当前房间最近50条记录(orderByKey().limitToFirst(50)——key是反向
// 时间戳,数值最小=时间最新,天然拿到"最近的50条"而不是"最早的50条")展示。
function showDebugLog(){
  if(typeof showInfo !== 'function') return; // render.js 未加载(理论上不会发生),静默跳过
  if(typeof db === 'undefined' || !db){
    showInfo('调试日志', '<div class="dbglog-empty">Firebase 未配置,无法查看调试日志</div>');
    return;
  }
  const rid = (typeof roomId !== 'undefined') ? roomId : null;
  if(!rid){
    showInfo('调试日志', '<div class="dbglog-empty">当前不在房间中,没有可查看的调试日志</div>');
    return;
  }
  showInfo('调试日志(房间 ' + escapeHtml(String(rid)) + ')', '<div class="dbglog-loading">加载中…</div>');
  db.ref('debugLogs/' + rid).orderByKey().limitToFirst(50).get().then(function(snap){
    // 拉取是异步的,期间用户可能已经手动关闭了弹窗——这时不要再往(可能已经被清空的)
    // #infoModal 里塞内容,否则下一次打开无关的浮层(比如帮助面板)会突然被这次的结果覆盖。
    const m = document.getElementById('infoModal');
    if(!m || m.classList.contains('hidden')) return;
    const body = m.querySelector('.info-body');
    if(!body) return;
    if(!snap.exists()){
      body.innerHTML = '<div class="dbglog-empty">暂无调试日志记录(这是好事)</div>';
      return;
    }
    const entries = [];
    snap.forEach(function(child){ entries.push(child.val() || {}); });
    let html = debugLogStatsHtml(entries);
    entries.forEach(function(entry, idx){ html += debugLogEntryHtml(entry, idx); });
    body.innerHTML = '<div class="dbglog-list">' + html + '</div>';
    const rows = body.querySelectorAll('.dbglog-row');
    for(let i = 0; i < rows.length; i++){
      rows[i].onclick = function(){
        const d = body.querySelector('.dbglog-detail[data-idx="' + this.getAttribute('data-idx') + '"]');
        if(d) d.classList.toggle('hidden');
      };
    }
  }).catch(function(err){
    // CORE-71:此前这里完全丢弃 err,页面只显示笼统文案、Console 也没有任何原始错误——
    // 权限问题(Firebase Rules 没放行 debugLogs/{roomId})和网络问题在用户看来完全一样,
    // 排查时无从下手。现在 Console 留一条带原始 err 的 warn,页面显示简短错误 code,
    // 常见 code(目前只有 PERMISSION_DENIED)额外给一句排查提示。
    if(typeof console !== 'undefined') console.warn('读取调试日志失败:', err);
    const m = document.getElementById('infoModal');
    if(!m || m.classList.contains('hidden')) return;
    const body = m.querySelector('.info-body');
    if(!body) return;
    const code = (err && err.code) ? String(err.code) : '未知错误';
    const hint = DEBUG_LOG_ERROR_CODE_HINTS[code];
    body.innerHTML = '<div class="dbglog-empty">调试日志读取失败<br>错误：' + escapeHtml(code)
      + (hint ? ('<br><span class="dbglog-hint">' + escapeHtml(hint) + '</span>') : '')
      + '</div>';
  });
}
