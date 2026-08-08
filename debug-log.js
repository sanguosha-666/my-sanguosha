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
const DEBUG_LOG_KINDS = ['js_error', 'timeout_stuck', 'bot_decision_failed', 'pending_orphan_detected'];

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
// fire-and-forget:内部 catch 住一切失败,绝不能因为日志写失败反过来影响正常游戏逻辑
// (和 render-table.js 飞牌动画那段 try/catch 的既定原则一致)。
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
    if(p && typeof p.catch === 'function') p.catch(function(){ /* 静默:日志写失败不影响主流程 */ });
  }catch(e){ /* 调试日志本身出错绝不能影响主流程 */ }
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
let __pendingOrphanLastLogged = {}; // key(type+reason) -> 上次记录的ts,纯内存、不跨刷新持久化
function logPendingOrphan(g, reason){
  try{
    if(!g || !g.pending) return;
    const type = g.pending.type || 'unknown';
    const isRateLimited = typeof reason === 'string' && reason.indexOf('B:') === 0;
    if(isRateLimited){
      const key = type + '|' + reason;
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
  pending_orphan_detected: '🧹 pending被清空'
};

// debugLogEntryHtml: 单条记录的默认视图(摘要行,一直显示)+ 展开详情(默认隐藏,点摘要行
// 切换)。默认视图:时间 + kind中文 + phase(如果有) + message。展开详情:turn/roundNum/
// seat/pendingType/pendingSnapshot/playersSummary/stack 整体格式化成 JSON pretty-print。
function debugLogEntryHtml(entry, idx){
  const kindLabel = (DEBUG_LOG_KIND_LABELS[entry.kind] !== undefined) ? DEBUG_LOG_KIND_LABELS[entry.kind] : String(entry.kind);
  const phaseHtml = entry.phase ? ('<span class="dbglog-phase">phase=' + escapeHtml(String(entry.phase)) + '</span>') : '';
  const summary = '<div class="dbglog-row" data-idx="' + idx + '">'
    + '<span class="dbglog-time">' + escapeHtml(entry.isoTime || '') + '</span>'
    + '<span class="dbglog-kind">' + escapeHtml(kindLabel) + '</span>'
    + phaseHtml
    + '<div class="dbglog-msg">' + escapeHtml(entry.message || '') + '</div>'
    + '</div>';
  const detailObj = {
    turn: entry.turn, roundNum: entry.roundNum, seat: entry.seat, pendingType: entry.pendingType,
    pendingSnapshot: entry.pendingSnapshot, playersSummary: entry.playersSummary, stack: entry.stack
  };
  const detail = '<pre class="dbglog-detail hidden" data-idx="' + idx + '">'
    + escapeHtml(JSON.stringify(detailObj, null, 2)) + '</pre>';
  return '<div class="dbglog-item">' + summary + detail + '</div>';
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
    let html = '';
    let idx = 0;
    snap.forEach(function(child){
      html += debugLogEntryHtml(child.val() || {}, idx);
      idx++;
    });
    body.innerHTML = '<div class="dbglog-list">' + html + '</div>';
    const rows = body.querySelectorAll('.dbglog-row');
    for(let i = 0; i < rows.length; i++){
      rows[i].onclick = function(){
        const d = body.querySelector('.dbglog-detail[data-idx="' + this.getAttribute('data-idx') + '"]');
        if(d) d.classList.toggle('hidden');
      };
    }
  }).catch(function(){
    const m = document.getElementById('infoModal');
    if(!m || m.classList.contains('hidden')) return;
    const body = m.querySelector('.info-body');
    if(body) body.innerHTML = '<div class="dbglog-empty">拉取调试日志失败,请检查网络或 Firebase 配置</div>';
  });
}
