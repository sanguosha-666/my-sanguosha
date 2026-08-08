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
function logPendingOrphan(g, reason){
  try{
    if(!g || !g.pending) return;
    const snap = JSON.parse(JSON.stringify(g.pending));
    writeDebugLog(typeof roomId !== 'undefined' ? roomId : null, 'pending_orphan_detected', {
      phase: g.phase || null,
      pendingType: snap.type || null,
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
