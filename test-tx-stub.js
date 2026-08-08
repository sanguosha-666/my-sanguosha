/**
 * 可复用的 Firebase `gameRef.transaction` 测试 stub —— "快照隔离"版本。
 *
 * ## 背景:两种 stub 的行为差异
 *
 * 项目里绝大多数 run_*.js 测试文件（包括这个文件出现之前写的全部测试）用的都是
 * "共享引用"式 stub，典型写法（见各测试文件里 game.js 加载钩子那一行）：
 *   gameRef = { transaction: function(fn) { return fn(typeof _g !== "undefined" ? _g : {}); } };
 * 这种写法每次 transaction() 调用都把同一个 JS 对象引用 `_g` 直接交给回调——回调对它的
 * 就地修改（`g.pending=null` 这种赋值、`arr.push(...)` 这种原地修改）立刻对所有持有同一个
 * 引用的代码可见，不存在"快照"和"提交"这两个独立阶段。
 *
 * 真实的 Firebase `transaction()` 不是这样：每次调用都从服务端**当前已提交**的状态取一份
 * 独立快照交给回调，回调的返回值再整体覆盖服务端状态（这中间还有真正的网络异步往返）。
 * 这意味着如果一次 transaction 回调内部又同步发起了另一次 transaction（嵌套调用），内层
 * 拿到的快照是"外层事务还没提交时的服务端旧状态"，内层提交后，外层事务自己的回调返回值
 * 会在**之后**整体覆盖服务端状态——如果外层的返回值没有正确吸收内层刚做的修改（比如内层
 * 调用点忘了 return、外层套的是 `fn(g)||g` 这种兜底逻辑），外层提交时会把内层刚写入的
 * 状态推进整体覆盖掉。
 *
 * 用"共享引用"stub 测不出这类问题：因为内外层操作的是同一个对象引用，任何一层的原地修改
 * 都立刻对另一层可见，返回值对不对根本不影响最终对象的内容——这正是张角【鬼道】那次
 * askNextGuidu 嵌套 tx() bug（commit 45a36c5）在"共享引用"stub 下测不出来、只有换成这个
 * 文件里的"快照隔离"stub 才能测出来的原因（见 run_guidu_nested_tx_fix_test.js 的差分验证：
 * 同一段测试代码，换了 stub 就从"3/3 通过"变成"3/3 检测到 bug"）。
 *
 * ## 什么时候该用这个 stub，而不是继续用旧的"共享引用"stub
 *
 * - 新写的测试如果要验证"一个 tx() 回调内部同步调用了另一个可能包含 pending/phase 状态推进
 *   逻辑的函数"这类场景（尤其是该函数本身也可能自带 tx() 包裹，或者未来会不会自带不确定），
 *   优先用这个 stub，不要用旧的共享引用 stub——旧 stub 在这类场景下即使被测函数写错了，测试
 *   也会"看起来通过"，是假阴性。
 * - 单纯测试"某个顶层动作函数改了哪些字段"这种不涉及嵌套调用的场景，两种 stub 效果一样，
 *   继续用旧的共享引用 stub 没问题，不需要为了"用新工具"而迁移旧测试文件（历史测试文件的
 *   迁移成本和收益不对等，不强求）。
 *
 * ## 用法
 *
 * ```js
 * const { SNAPSHOT_TX_STUB_SOURCE } = require('./test-tx-stub');
 * // ...在 vm sandbox 里加载完 game.js（它会覆盖一次 gameRef，见各测试文件里的加载钩子）之后:
 * vm.runInContext(SNAPSHOT_TX_STUB_SOURCE, sandbox);
 * // 之后在 sandbox 里(包括 testCode 字符串的 IIFE 内部)就能用:
 * //   commitGameState(g)   —— 把 g 深拷贝一份作为"当前已提交的服务端状态"的初始值
 * //   currentGameState()   —— 读取当前"已提交"的状态,做断言时用这个,不要用原始的g对象
 * //     (原始g对象在调用被测函数之后不再代表最终提交结果,尤其是涉及嵌套tx()的场景)
 * ```
 */
const SNAPSHOT_TX_STUB_SOURCE = `
  // 见 test-tx-stub.js 顶部注释:这是"快照隔离"版本的 gameRef.transaction stub,
  // 每次 transaction 都从 serverState 深拷贝一份快照交给回调,回调返回值整体覆盖
  // serverState——能真实检测出"内层tx先commit、外层tx后commit、外层用没吸收内层
  // 修改的旧快照覆盖回去"这类嵌套事务竞争,是旧的"共享引用"stub 结构性做不到的。
  var serverState = null;
  gameRef = {
    transaction: function(fn){
      var snapshot = serverState ? JSON.parse(JSON.stringify(serverState)) : {};
      var result = fn(snapshot) || snapshot;
      serverState = result;
      return result;
    }
  };
  function commitGameState(g){ serverState = JSON.parse(JSON.stringify(g)); }
  function currentGameState(){ return serverState; }
`;

module.exports = { SNAPSHOT_TX_STUB_SOURCE };
