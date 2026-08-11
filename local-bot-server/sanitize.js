// sanitize.js —— pending 快照脱敏白名单,复用 debug-log.js 里 sanitizePendingForLog 的
// 同一套"白名单收录结构性字段、牌面相关字段名保留但值替换成占位符、其余静默丢弃"思路。
//
// 【为什么这里是独立的一份拷贝,不是 require('../debug-log.js')】local-bot-server 这个
// 目录的定位是"和浏览器端代码物理隔离的独立 Node 项目"(阶段1骨架的既定原则,见
// docs/local-bot-server-feasibility.md)。debug-log.js 是给浏览器全局作用域写的(顶层
// let/function 声明、依赖 gameRef/roomId/firebase 等浏览器端变量做真正的写入),不是一个
// CommonJS 模块,直接 require 它要么报错、要么被迫把它改造成两用文件、引入浏览器端和
// Node 端共享一份加载路径的复杂度——这些都超出"阶段1只读打印"这一步该做的事。
//
// 这份拷贝只搬运"哪些字段允许原样打印、哪些字段名要保留但脱敏、其余一律丢弃"这张名单本身
// （复用的是设计思路,不是文件),两份名单的字段清单必须保持同步——debug-log.js 那份如果
// 新增/删除字段,这里也要跟着改。两处都在文件头写明了这条同步义务。

'use strict';

// ⚠️ 与 debug-log.js 的 PENDING_SNAPSHOT_ALLOWED_FIELDS 保持同步(新增/删除字段两处都要改)
const PENDING_SNAPSHOT_ALLOWED_FIELDS = [
  'type', 'seat', 'from', 'to', 'asking', 'sourceSeat', 'targetSeat', 'target', 'target2Seat', 'targets',
  'otherSeat', 'judgedSeat', 'damagedSeat', 'damagerSeat', 'damageSource', 'baseTarget', 'currentSeat',
  'firstTargetSeat', 'endingSeat', 'seatA', 'seatB', 'lordSeat', 'exclude', 'active', 'available',
  'amount', 'death', 'needed', 'noDistance', 'half', 'played', 'wasFacedown', 'previousPhase',
  'costType', 'sumLimit', 'takeN', 'askedAt', 'depth', 'idx', 'need', 'kind', 'index', 'value', 'label',
  'phase', 'askedSeats', 'availableTargets', 'availableSlots', 'questioners', 'answered', 'candidates',
  'remainingSeats', 'remaining', 'discardedCounts', 'equipSlots', 'weaponIndices', 'cardIndices',
  'cardIds', 'availablePairs', 'order', 'selectable', 'options', 'selections', 'resume',
];
// ⚠️ 与 debug-log.js 的 PENDING_SNAPSHOT_REDACTED_FIELDS 保持同步
const PENDING_SNAPSHOT_REDACTED_FIELDS = [
  'actualCard', 'claimedCard', 'judgeCard', 'sourceCard', 'cards', 'cardToGive', 'cardName',
  'heartCards', 'transferCard', 'revealedCards', 'selfCard', 'damageInfo', 'originalDamageInfo',
  'originalCtx', 'pool', 'shaColor', 'suit', 'card', 'hand', 'delays', 'equips',
];
const REDACT_PLACEHOLDER = '[已隐藏:可能含具体牌面/手牌内容,不写入日志]';

// sanitizePendingForLog: 递归过滤,数组元素/嵌套对象(如 resume)都过同一套名单。
function sanitizePendingForLog(value, depth) {
  depth = depth || 0;
  if (depth > 6) return null; // 防御性熔断,正常 pending 结构不会嵌套这么深
  if (Array.isArray(value)) {
    return value.map(function (item) { return sanitizePendingForLog(item, depth + 1); });
  }
  if (value && typeof value === 'object') {
    const out = {};
    Object.keys(value).forEach(function (key) {
      if (PENDING_SNAPSHOT_ALLOWED_FIELDS.indexOf(key) >= 0) {
        out[key] = sanitizePendingForLog(value[key], depth + 1);
      } else if (PENDING_SNAPSHOT_REDACTED_FIELDS.indexOf(key) >= 0) {
        out[key] = REDACT_PLACEHOLDER;
      }
      // 其余字段名一律不出现在结果里(白名单默认拒绝)。
    });
    return out;
  }
  return value; // 基本类型(数字/字符串/布尔/null)原样保留
}

// playersSummary: 只取公开信息(座位/名字/血量/存活/是否机器人),与 debug-log.js 的
// debugLogPlayersSummary 同一份口径——绝不包含手牌内容/判定牌/装备之外的隐藏信息。
function playersSummary(g) {
  try {
    if (!g || !Array.isArray(g.players)) return null;
    return g.players.map(function (p, i) {
      if (!p) return null;
      return {
        seat: i,
        name: p.name || null,
        hp: (typeof p.hp === 'number' ? p.hp : null),
        alive: !!p.alive,
        isBot: !!p.isBot,
      };
    });
  } catch (e) { return null; }
}

module.exports = { sanitizePendingForLog, playersSummary };
