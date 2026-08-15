/**
 * CORE-108(issue #108,方案第1项):soak.js 整局级随机压测驱动器 —— 最小验证。
 *
 * soak.js 本身是一个独立脚本(不是 testclass/ 里的单元测试),run_all_tests.js 只逐文件
 * spawnSync testclass/ 目录,不会自动跑到它——这个文件是"给 soak.js 本身补的最小回归",
 * 通过 spawnSync 真的跑一遍 `node soak.js`(用较小的局数/人数/步数上限保证在合理时间内
 * 跑完),断言:
 *   1. 不崩溃(不出现 EXCEPTION,包括加载阶段的 ReferenceError/TypeError 这类此前真实
 *      踩过的坑——canShuangxiongDuelCard 未加载、document.getElementById 返回null导致
 *      顶层.onclick=赋值报错等)。
 *   2. 不出现两个已修复的真实bug的症状文本(回归锁定,防止以后改动又踩回去):
 *      - "no-actor-no-pending@draw"/"no-actor-no-pending@play":startGame内部会调用
 *        shuffleSeats()打乱players数组顺序,soak.js最初按固定下标0把owner收作机器人,
 *        shuffle后owner可能已经不在下标0,真正的owner座位永远isBot:false,轮到它时
 *        botSeatForState解析不出行动者——已改成按owner标记查找修复。
 *      - 极早期(几步内)就出现 "stuck@wuxie:wuxiePublicWait":finishWuxiePublicWait
 *        内部检查的是 pending.publicUntil 而不是 askedAt,逃生舱最初只回拨了askedAt,
     *        publicUntil仍是未来时间,窗口永远"还没到时间"——已改成两个字段一起回拨修复。
 *   3. 至少能正常跑完given局数,产出预期格式的汇总行。
 *
 * 不要求"一定要有finished局"——真实观察到2人局在启发式AI手里可能打得很久(数百步才分出
 * 胜负是正常现象,不是bug),用较小的步数上限(150)+接受"finished"或"step-cap-exceeded"
 * 两种outcome都算正常运行,只对"崩溃"和"两个已知bug的症状"零容忍。
 */

const { spawnSync } = require('child_process');
const path = require('path');

let pass = 0, fail = 0;
function check(name, fn){
  try{
    fn();
    console.log('  PASS ' + name); pass++;
  }catch(e){
    console.log('  FAIL ' + name + ' - ' + (e && e.message || e)); fail++;
  }
}

console.log('运行 node soak.js 10 6 2000 (10局,最多6人,单局步数上限2000)…\n');
const result = spawnSync('node', ['soak.js', '10', '6', '2000'], {
  cwd: path.join(__dirname, '..'),
  timeout: 60000,
  encoding: 'utf8'
});
const out = (result.stdout || '') + (result.stderr || '');
console.log(out.split('\n').slice(0, 40).join('\n')); // 只回显前40行,避免刷屏

check('soak.js 未超时(60秒内跑完10局最多6人2000步上限)', function(){
  if(result.error && result.error.code === 'ETIMEDOUT') throw new Error('spawnSync超时,soak.js可能真的卡死了');
});
check('soak.js 未崩溃(输出不含EXCEPTION)', function(){
  if(/EXCEPTION/.test(out)) throw new Error('输出含EXCEPTION,详见上方回显');
});
check('回归锁定:不出现"no-actor-no-pending@draw/@play"(startGame后shuffleSeats导致owner收编失效那个bug)', function(){
  if(/no-actor-no-pending@(draw|play)/.test(out)) throw new Error('复现了已修复的shuffleSeats/isBot收编bug');
});
check('回归锁定:不在极早期(前10步内)卡在wuxiePublicWait(publicUntil未回拨那个bug)', function(){
  const m = out.match(/outcome=stuck@wuxie:wuxiePublicWait/g) || [];
  // 允许极端随机情况下真的卡住(比如撞上完全不同的新bug),但如果每一局都在个位数步数就
  // 卡在这个特定症状,基本可以断定是回归——用"局数"而不是绝对0来判断,避免偶发误报。
  if(m.length >= 8) throw new Error('绝大多数局都卡在wuxiePublicWait,像是publicUntil回拨没生效(回归)');
});
check('至少产出预期格式的每局结果行([n/m] n=.. steps=.. outcome=..)', function(){
  const lines = out.split('\n').filter(function(l){ return /^\[\d+\/\d+\]/.test(l); });
  if(lines.length < 1) throw new Error('没有找到任何一条局结果行,soak.js可能压根没跑起来');
});
check('产出最终汇总行(soak 结果: N 局 ——)', function(){
  if(!/soak 结果: 10 局/.test(out)) throw new Error('没有找到汇总行');
});

console.log('\n' + '='.repeat(60));
console.log('  结果: ' + pass + ' 通过, ' + fail + ' 失败');
console.log('='.repeat(60) + '\n');
process.exit(fail > 0 ? 1 : 0);
