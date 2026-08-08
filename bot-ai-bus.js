// ================= bot-ai-bus.js:AI可操作面决策总线核心(Task D2拆分) =================
// 【本文件是什么】从 bot.js 拆分出的"总线核心"定义:parseBotPlayAiChoice/BOT_DECISIONS
// (空骨架声明)/aiSummary 状态与 aiSummaryReset/updateAiSummary/buildBotDefaultSystemPrompt/
// buildBotDefaultUserPrompt/callAiChooseIndex/botDecide。bot.js 里的 BOT_DECISIONS.xxx
// 注册项、各决策点专属 buildSystemPrompt、BOT_PHASE_ACTOR 调度、runBotDecision/
// runBotActionWindow 等全部留在 bot.js,向同一个全局 BOT_DECISIONS 追加(共享脚本作用域,
// 无需 import)。
// 【加载顺序,必须遵守】本文件必须排在 bot.js 之前加载:const BOT_DECISIONS 是词法绑定、
// 有 TDZ,bot.js 顶层的 BOT_DECISIONS.xxx = {...} 注册项在声明之后执行才不抛错。本文件
// 引用 callAI/aiApiKey/aiProvider/aiApiModel(定义在 ai-bot.js,位于其后)与
// buildBotVisibleState(bot.js 内)——都是函数体内运行时引用,调用时均已加载,无碍。

// parseBotPlayAiChoice:从AI原始回复文本里尽量宽容地抠出 {"choice":N}——直接
// JSON.parse失败时,再剥掉常见的```/```json代码块包裹重试一次(小模型经常无视"不要
// 代码块"的指示);两次都失败,或者解析出来的 choice 不是合法整数,一律返回 null——
// 不细分"到底是格式错误还是数值不对",按第一阶段方案确认的原则,parse失败和索引越权
// 都统一交给调用方走同一条"回退本地逻辑"的路径,不单独区分。
function parseBotPlayAiChoice(text){
  if(typeof text!=='string') return null;
  const tryParse=(s)=>{
    try{
      const obj=JSON.parse(s.trim());
      if(obj && typeof obj.choice==='number' && Number.isInteger(obj.choice)) return obj.choice;
    }catch(e){}
    return null;
  };
  let r=tryParse(text);
  if(r!==null) return r;
  const stripped=text.replace(/```(?:json)?/gi,'').trim();
  if(stripped!==text) r=tryParse(stripped);
  return r;
}

// parseBotPlayAiChoiceWithReason:AI测试托管模式的解析——AI 在返回 choice 的同时附一句
// 中文理由({"choice":N,"reason":"..."})。复用老解析的宽容策略(JSON.parse失败剥代码块
// 重试一次);解析出 choice 时顺带提取 reason(无 reason 字段则为 null);整体失败回退
// 老解析函数(仍失败则 idx=null)。返回 {idx, reason}。
function parseBotPlayAiChoiceWithReason(text){
  if(typeof text!=='string') return {idx:null, reason:null};
  const tryParse=(s)=>{
    try{
      const obj=JSON.parse(s.trim());
      if(obj && typeof obj.choice==='number' && Number.isInteger(obj.choice)){
        return {idx:obj.choice, reason:(typeof obj.reason==='string' && obj.reason) ? obj.reason : null};
      }
    }catch(e){}
    return null;
  };
  let r=tryParse(text);
  if(r!==null) return r;
  const stripped=text.replace(/```(?:json)?/gi,'').trim();
  if(stripped!==text) r=tryParse(stripped);
  if(r!==null) return r;
  const old=parseBotPlayAiChoice(text);
  return {idx:old, reason:null};
}

// ================= AI可操作面决策总线(骨架,Task B0) =================
// 【本段是什么】把"一个可操作面决策点"收敛成统一的注册-匹配-候选-询问-执行五段式:
// 新决策点只需往 BOT_DECISIONS 注册 {match, buildCandidates, execute, localFallback,
// onEmpty?, extraState?, buildSystemPrompt?, maxTokens?},其余(密钥守卫、候选规范化、
// AI 调用、超时兜底、本地回退)全部由 botDecide 统一处理,和既有的 tryAiBotPlay/
// tryAiBotBestTarget 共用同一套 parseBotPlayAiChoice 解析与 callAI 基础设施。
// 【当前状态】本阶段只交付骨架:注册表为空、botDecide 对未注册的 decisionId 返回
// false(调用方按"无此决策点"处理)。首个真实决策点由后续任务注册。
const BOT_DECISIONS = Object.create(null);

// ================= AI自维护回合摘要(aiSummary) =================
// 机器人自己维护的"本局记忆摘要":updateAiSummary(g,seat) 异步调用 callAI,把旧摘要
// (如有)+最近公开事件压缩成 ≤200字 的新摘要存进模块级 aiSummary;callAiChooseIndex
// 每次做决策时把这份摘要注入 systemPrompt,帮 AI 跨回合记住"谁打过谁、谁救过谁、
// 自己的留牌计划"这类会被日志滚掉的长程信息。aiSummarySeat 记录这份摘要属于哪个
// 座位:座位变化(重连/换机器人)时清空,同座位累积。aiSummaryRound/aiSummaryTurn
// 记录摘要对应的回合节点,留给后续调度逻辑(如"每轮更新一次")判断是否该更新,
// 本任务只定义状态不消费。
let aiSummary = '';
let aiSummarySeat = null;
let aiSummaryRound = 0;
let aiSummaryTurn = -1;
// aiTestLastReason:AI测试托管模式(AI测试按钮)下,最近一次托管命中的 AI 询问里解析出的
// 中文选择理由。模块级变量,供信息窗 record 采集(aiTestDecisionHook)。未托管时恒为
// null——callAiChooseIndex 在未托管路径会把 reason 恒写 null,与未托管行为零变化。
// 【为何是顶层声明】计划初稿把声明写在 callAiChooseIndex 函数体内(var 提升后是该函数
// 的局部变量),函数外的测试/采集代码永远读不到——必须放模块顶层才符合"供 record 采集"
// 的语义。
let aiTestLastReason = null;
function aiSummaryReset(){
  aiSummary = '';
  aiSummarySeat = null;
  aiSummaryRound = 0;
  aiSummaryTurn = -1;
}

// updateAiSummary:异步调用 callAI 生成/迭代本座位的局内摘要。fire-and-forget——
// 调用方不 await(摘要只是辅助记忆,不能阻塞任何决策/回合推进);失败静默沿用旧摘要。
// 只有成功写出新文本时才把 aiSummarySeat 挪到本座位:旧摘要若还在,它仍属于旧座位,
// 等 callAiChooseIndex 的座位校验去清;若本座位是第一次写摘要(aiSummarySeat 还是
// null),也必须立刻归属本座位,否则紧接着的第一次决策会把刚写好的摘要当成
// "座位变化"误清掉。
// 【跨座位异步竟态防护】调用方(scheduleBotTurn)在发起这次请求之前已经把 aiSummarySeat
// 同步设成了 seat——但这次 callAI 是真实网络请求,等待期间(可能几百毫秒到几秒)归属
// 完全可能被别的座位抢走:多机器人共用一个浏览器时,scheduleBotTurn 每次渲染都会跑,
// 只要中途换了一个不同的当前行动座位,aiSummarySeat 就会被正确地清空+改成新座位——
// 这时如果本次(旧座位)的响应姗姗来迟才 resolve,不加区分直接写回,会用"出发时的旧
// seat"把刚刚正确建立的新归属强行覆盖回去,新座位刚攒的记忆被撕掉。修法和
// botDecisionInFlight 那次同类竟态修复同一思路:异步操作完成时,判断结果是否还适用于
// 当前状态——写回前重新检查一次 aiSummarySeat 是否仍是出发时的 seat,变了就说明这次
// 响应已经过期,直接丢弃,不写入(旧摘要/新归属原样保留,不受影响)。
async function updateAiSummary(g, seat){
  if(typeof aiApiKey==='undefined' || !aiApiKey || !aiProvider) return;
  const state = buildBotVisibleState(g, seat);
  const oldSummary = aiSummary ? ('旧摘要:\n'+aiSummary+'\n\n') : '';
  const userPrompt = oldSummary
    + '最近局面信息:\n' + JSON.stringify({ round: g.roundNum, recentLog: state.recentLog, players: state.players })
    + '\n\n请输出更新后的摘要(≤200字)。';
  showAiThinkingIndicator(g, seat);
  let result;
  try{
    result = await callAI(aiProvider, aiApiKey, {
      systemPrompt: buildSummaryPrompt(g, seat),
      userPrompt: userPrompt,
      maxTokens: 300,
      model: (typeof aiApiModel!=='undefined' && aiApiModel) || undefined,
    });
  }catch(e){
    result = { ok:false, reason:'other', detail:String(e) };
  }finally{
    hideAiThinkingIndicator();
  }
  if(!result || !result.ok) return;
  if(aiSummarySeat !== seat) return; // 归属已易主,这次响应过期,丢弃不写入
  const text = (result.text || '').trim();
  if(text){
    aiSummary = text.slice(0, 500);
    aiSummarySeat = seat;
  }
}

function buildBotDefaultSystemPrompt(/* g, seat, ctx */){
  return '你在扮演网页版三国杀的AI机器人。根据局面与武将技能说明，从候选列表选一个index。'
    +'只能选列表内选项。只输出 {"choice":数字}，不要解释。'
    +'决策参考(是判断优先级的参考,不是必须遵守的硬规则):1点体力大致相当于2张手牌的价值;'
    +'关键防御牌(无懈/闪/桃)要留到关键时刻,别为试探而消耗;手牌耗尽裸拼往往替别人火中取栗;'
    +'多数决策宁可保守不出,也不要打空自己。';
}

function buildBotDefaultUserPrompt(state, candidates){
  const hasScore = (candidates||[]).some(function(c){ return typeof c.localHeuristicScore === 'number'; });
  return '当前局面:\n'+JSON.stringify(state)
    +'\n\n合法候选(index从0开始):\n'+JSON.stringify(candidates.map(c=>({
      index:c.index, label:c.label, action:c.action, card:c.card, seat:c.seat,
      handIndex:c.handIndex, cardIdx:c.cardIdx, target:c.target, targets:c.targets,
      pickKey:c.pickKey, discardIndices:c.discardIndices
    })))
    +(hasScore ? '\n\n说明:localHeuristicScore是本地算法的参考分,只是排序参考,不代表最优解;请结合局面与你的判断选择,不一定要选分数最高的。' : '')
    +'\n\n只返回 {"choice":数字}';
}

// callAiChooseIndex:一次"候选列表→索引"的AI询问,返回规范化后的合法下标或 null。
// 守卫/超时/解析失败/越界全部收敛到这一处,与 tryAiBotPlay 同一套取舍:任何失败都
// 返回 null 交给调用方回退本地逻辑,不重试、不阻塞、不抛异常。
async function callAiChooseIndex(opts){
  const candidates = opts.candidates || [];
  // 【AI测试托管】检测当前座位是否处于托管模式:命中则该次询问要求 AI 附理由,
  // 并把解析出的理由存入模块级 aiTestLastReason(供信息窗 record 采集)。
  const autopilotHit = (typeof aiTestAutopilot!=='undefined') && aiTestAutopilot
    && aiTestAutopilot.active && aiTestAutopilot.seat===opts.seat;
  if(typeof aiApiKey==='undefined' || !aiApiKey || !aiProvider) return null;
  if(candidates.length<=1) return candidates.length===1 ? 0 : null;
  // 【AI摘要】座位校验:座位变化(重连/换机器人)清空记忆;同座位累积。摘要只注入文本,
  // 不在这里重建可见状态——buildBotVisibleState 的开销留给各调用方已有的那次调用。
  if(aiSummarySeat !== opts.seat) aiSummaryReset();
  aiSummarySeat = opts.seat;
  // 摘要注入:有摘要且座位匹配时,追加进 systemPrompt
  const summaryNote = aiSummary && aiSummarySeat===opts.seat
    ? '\n\n本局记忆摘要(你自己维护的,参考即可):\n'+aiSummary
    : '';
  const g = opts.g, seat = opts.seat;
  showAiThinkingIndicator(g, seat);
  let result;
  try{
    result = await callAI(aiProvider, aiApiKey, {
      systemPrompt: (opts.systemPrompt || buildBotDefaultSystemPrompt()) + summaryNote
        + (autopilotHit ? '\n\n(本次为AI测试托管)在返回choice的同时,用一句中文解释你的选择理由。返回格式:{"choice":数字,"reason":"理由文本"}' : ''),
      userPrompt: opts.userPrompt,
      maxTokens: opts.maxTokens || 80,
      model: (typeof aiApiModel!=='undefined' && aiApiModel) || undefined,
    });
  }catch(e){
    result = { ok:false, reason:'other', detail:String(e) };
  }finally{
    hideAiThinkingIndicator();
  }
  if(!result || !result.ok){
    aiTestLastReason = null;
    return null;
  }
  let idx, reason;
  if(autopilotHit){
    const pr = parseBotPlayAiChoiceWithReason(result.text);
    idx = pr.idx; reason = pr.reason;
  } else {
    idx = parseBotPlayAiChoice(result.text);
    reason = null;
  }
  aiTestLastReason = reason;
  if(idx===null || idx<0 || idx>=candidates.length){
    if(autopilotHit) aiTestLastReason = null;
    return null;
  }
  return idx;
}

// botDecide:决策总线入口。匹配失败/无候选且无 onEmpty 时返回 false(调用方按
// "无此决策点"处理);否则总是执行(spec.execute 负责真正落子)并返回 true。
// 注意:即使返回 true,execute 内部也可能因服务端校验失败而静默不生效——那是
// 具体决策点自己的职责,不在总线层保证。
async function botDecide(decisionId, g, seat){
  const spec = BOT_DECISIONS[decisionId];
  if(!spec || typeof spec.match!=='function' || !spec.match(g, seat)) return false;
  const candidates = spec.buildCandidates(g, seat) || [];
  if(!candidates.length){
    if(typeof spec.onEmpty==='function'){ spec.onEmpty(g, seat); return true; }
    return false;
  }
  // 规范 index
  candidates.forEach((c,i)=>{ c.index = i; });
  let idx = null;
  const aiReady = typeof aiApiKey!=='undefined' && aiApiKey && aiProvider;
  if(aiReady && candidates.length>1){
    const state = buildBotVisibleState(g, seat);
    if(typeof spec.extraState==='function'){
      Object.assign(state, spec.extraState(g, seat) || {});
    }
    const systemPrompt = (typeof spec.buildSystemPrompt==='function')
      ? spec.buildSystemPrompt(g, seat, { state, candidates })
      : buildBotDefaultSystemPrompt(g, seat);
    const userPrompt = buildBotDefaultUserPrompt(state, candidates);
    idx = await callAiChooseIndex({ g, seat, systemPrompt, userPrompt, candidates, maxTokens: spec.maxTokens||80 });
  } else if(aiReady && candidates.length===1){
    idx = 0;
  }
  let choice;
  if(idx===null){
    choice = spec.localFallback(g, seat, candidates);
  } else {
    choice = candidates[idx];
  }
  if(choice===null || choice===undefined){
    // 本地回退显式返回 null/undefined = 该决策点"无动作"(如 seatPick 的旧行为=不发动),
    // 视为已处理,不再执行 execute。既有注册项的 fallback 永不返回 null,行为不受影响。
    return true;
  }
  spec.execute(g, seat, choice);
  return true;
}

// ================= A1 响应超时托管(30s+倒数+保守提交) =================
// 【本段是什么】询问型 pending 超时(askedAt + RESPONSE_TIMEOUT_MS)自动提交"保守动作",
// 画面显示"⏱ Ns 后自动…"倒计时,避免有人挂机/关页面整局卡死。服务端在每次询问
// (pending 创建/asking 切换)用 setResponseAskedAt 打戳,normalize 对遗漏的询问型 pending
// 兜底补戳;这里提供检测器与展示计算。任意客户端都可提交,幂等——服务端响应函数自带
// 守卫(asking/to/from===mySeat 等),提交时阶段已变则守卫拦截、原地 return,无副作用。
// 【无密钥零变化】检测器只在超时时提交保守动作,不调用 callAI/不碰任何 AI 决策路径;
// 无密钥对局的正常响应流程与改动前逐字一致。
function renderResponseCountdown(g){
  if(!g || !g.pending || typeof g.pending.askedAt !== 'number') return null;
  const remain = Math.ceil((g.pending.askedAt + RESPONSE_TIMEOUT_MS - Date.now()) / 1000);
  return '⏱ ' + Math.max(remain, 0) + 's 后自动…';
}
// autoRespondAction: 保守动作表(spec §2.2 逐条)。返回"该阶段超时该提交的动作闭包",
// 非保守表阶段返回 null(只计时不自动提交)。闭包体内引用响应函数标识符是运行时查找,
// 测试可直接把响应函数替换成 spy 验证"被调"。
function autoRespondAction(g){
  const phase = g.phase;
  const type = (g.pending && g.pending.type) || '';
  if(phase==='respond') return function(){ respondShan(false); };               // 出闪:不出
  if(phase==='aoeResp') return function(){ aoeRespond(false); };                // AOE:不出
  if(phase==='duel') return function(){ duelResponse(false); };                 // 决斗:不出杀
  if(phase==='dying') return function(){ respondDying(false); };                // 求桃:不救
  if(type==='wuxie') return function(){ respondWuxie(false); };                 // 无懈:不出
  if(type==='guicai') return function(){ respondGuicai(false); };               // 鬼才:不发动
  if(type==='jiedaoChoice') return function(){ respondJiedao(false); };         // 借刀:弃武器
  if(type==='ganglieChoice') return function(){ respondGanglieChoice('damage',[]); }; // 刚烈:受伤
  if(type==='guhuoQuestion') return function(){ respondGuhuoQuestion(false); }; // 蛊惑:不质疑
  if(type==='xiaoguo') return function(){ respondXiaoguo(false); };             // 骁果:不发动
  if(type==='xiaoguoChoice') return function(){ respondXiaoguoChoice('damage'); }; // 骁果目标:受伤害
  if(type==='lirangAsk') return function(){ respondLiRang(false,[]); };         // 礼让:不发动
  if(type==='lirangRecover') return function(){ respondLiRangRecover(false); }; // 礼让回收:不获得
  if(type==='zhengyi') return function(){ respondZhengyi(false); };             // 争义:不发动
  if(type==='tianxiang') return function(){ respondTianxiang(null,null); };     // 天香:不发动
  if(type==='liuli') return function(){ respondLiuli(null,null); };             // 流离:不发动
  if(type==='quhuRespond') return function(){ respondQuhu(0); };                // 驱虎拼点:出第0张
  if(type==='fanjianSuit') return function(){ respondFanjianSuit(SUITS[Math.floor(Math.random()*SUITS.length)]); }; // 反间:随机花色
  if(type==='huogong') return function(){ respondHuogong(false); };             // 火攻:不弃牌
  if(type==='huogongReveal') return function(){ respondHuogongReveal(0); };     // 火攻亮牌:亮第0张
  if(type==='jijiangAsk') return function(){ respondJijiangAsk(false); };       // 激将求助:不出
  if(type==='hujiaAsk') return function(){ respondHujiaAsk(false); };           // 护驾求助:不出
  if(type==='zhibaAsk') return function(){ respondZhiba(0); };                  // 制霸拼点:出第0张
  // 左慈【化身/新生】"是否更改化身"超时兜底(真实bug修复:这四个pending此前既没有登记
  // 在这张白名单里,创建时也没有setResponseAskedAt补时间戳——两处都不改,30秒超时机制
  // 对这四个phase形同虚设,机器人一旦在这四步没有正常响应就永久卡死,重试也救不回来。
  // AskStart/AskEnd:直接提交"不更改",和respondHuashenChangeAskStart/End的参数语义
  // 一致(activate=false)。
  if(type==='huashenChangeAskStart') return function(){ respondHuashenChangeAskStart(false); };
  if(type==='huashenChangeAskEnd') return function(){ respondHuashenChangeAskEnd(false); };
  // PickStart/PickEnd:不能传null/undefined——respondHuashenChangePickStart/End内部用
  // validateHuashenPick(me.huashenPool, generalId, skillName)校验,generalId必须在
  // huashenPool里、skillName必须是HUASHEN_SKILL_TABLE[generalId]里真实存在的技能名,
  // 传非法值会被守卫直接拒绝、pending原地不动、等于没修。这里镜像runBotDecision里
  // 已有的huashenChangePickStart/PickEnd确定性分支同一条兜底规则:选huashenPool里第一个
  // 技能表非空的武将+它的第一个技能条目,必然合法。
  // 【真实bug修复,和bot.js里runBotDecision的同款分支同一处根因】generalId找不到时
  // (huashenPool里没有任何一个在HUASHEN_SKILL_TABLE里有可用技能条目的武将)不能什么都
  // 不做——那样这条30秒超时安全网本身也形同虚设,遇到同一个边界条件照样永久卡死。
  // 回退到abandonHuashenChangePickStart/End(等价于respondHuashenChangeAskStart/End的
  // activate=false分支,按"放弃这次更改"处理,推进到continueGuanxingCheck/
  // continueBiyueCheck),不重新发明收尾逻辑。
  if(type==='huashenChangePickStart') return function(){
    const me = g.players[g.pending.seat];
    const generalId = me && (me.huashenPool||[]).find(function(id){ return (HUASHEN_SKILL_TABLE[id]||[]).length; });
    if(!generalId){ abandonHuashenChangePickStart(); return; }
    const entry = (HUASHEN_SKILL_TABLE[generalId]||[])[0];
    respondHuashenChangePickStart(generalId, entry && entry.name);
  };
  if(type==='huashenChangePickEnd') return function(){
    const me = g.players[g.pending.seat];
    const generalId = me && (me.huashenPool||[]).find(function(id){ return (HUASHEN_SKILL_TABLE[id]||[]).length; });
    if(!generalId){ abandonHuashenChangePickEnd(); return; }
    const entry = (HUASHEN_SKILL_TABLE[generalId]||[])[0];
    respondHuashenChangePickEnd(generalId, entry && entry.name);
  };
  // 【真实bug修复】郭嘉【遗计】是否发动这第一问:超时默认"不发动"(respondYijiAsk(false)),
  // 和这批"询问型pending超时兜底"的既有基调一致(激将/护驾/制霸等亦是保守默认,不是照抄
  // runBotDecision里"默认发动"这条正常决策路径——这里管的是"真人/机器人都没能在30秒内
  // 响应"这种异常情况,统一走最保守的分支,不重新引入判断)。
  if(type==='yijiAsk') return function(){ respondYijiAsk(false); };
  // 【系统性扫描发现的遗漏,和yijiAsk同一批】夏侯惇【刚烈】/张角【鬼道】/曹彰【将驰】:
  // 超时统一走各自最保守的"不发动"分支,和上面这批既有兜底同一基调。
  if(type==='ganglieAsk') return function(){ respondGanglieAsk(false); };
  if(type==='guiduAsk') return function(){ cancelGuidu(); };
  if(type==='jiangchiAsk') return function(){ respondJiangchi('none'); };
  // 【B类修复,机器人技能覆盖审计】超时兜底统一走各自最保守/最省判断的分支:
  // 志继两个选项都是纯收益,固定回复体力(不用再判断局面);骁果二选一优先弃装备,没有
  // 装备时受伤害;挑衅目标超时默认被弃牌(不主动出杀,和这批既有兜底同一保守基调);
  // 眩惑四个子阶段固定选候选/手牌第一项,和明策的确定性兜底同一写法。
  if(type==='zhijiChoice') return function(){ respondZhijiChoice(true); };
  if(type==='xiaoguoChoice') return function(){
    const target=g.players[g.pending.to];
    const slot=target&&target.equips&&EQUIP_SLOTS.find(function(s){ return target.equips[s]; });
    respondXiaoguoChoice(slot||'damage');
  };
  if(type==='tiaoxinChoice') return function(){ respondTiaoxinChoice(false); };
  if(type==='huanhuoPick') return function(){
    const target=(g.pending.candidates||[])[0];
    if(typeof target==='number') pickHuanhuoTarget(target); else cancelHuanhuo();
  };
  if(type==='huanhuoPickCard') return function(){
    const me=g.players[g.pending.sourceSeat];
    const idx=(me&&me.hand||[]).findIndex(function(c){ return c&&c.suit==='♥'; });
    if(idx>=0) pickHuanhuoHeartCard(idx); else cancelHuanhuo();
  };
  if(type==='huanhuoPickGotCard') return function(){
    const target=g.players[g.pending.targetSeat];
    const slot=target&&target.equips&&EQUIP_SLOTS.find(function(s){ return target.equips[s]; });
    if(slot) pickHuanhuoGotCard('equip',slot);
    else if(target&&(target.hand||[]).length>0) pickHuanhuoGotCard('hand',null);
  };
  if(type==='huanhuoPickSecond') return function(){
    const target=(g.pending.candidates||[])[0];
    if(typeof target==='number') pickHuanhuoSecondTarget(target);
  };
  // 【A类修复,机器人技能覆盖审计】超时兜底:liuli/tianxiang默认不转移(保守,和"没有明确
  // 判断依据时不主动改变默认结果"一致);lirangRecover零代价纯收益,默认获得;zhengyi/
  // shensuChoose1/shensuChoose2/qiaobianTurnStart都是有真实代价的选项,默认不发动;
  // lieRenChoose拼点默认不发动(超时说明没人真的在决策,不主动开赌);lieRenPickCard
  // 若已经进了这一步说明已经决定拼点,固定选手牌第0张收尾,不重新判断。
  if(type==='liuli') return function(){ respondLiuli(null, null); };
  if(type==='tianxiang') return function(){ respondTianxiang(null, null); };
  if(type==='lirangRecover') return function(){ respondLiRangRecover(true); };
  if(type==='zhengyi') return function(){ respondZhengyi(false); };
  if(type==='lieRenChoose') return function(){ cancelLieRen(); };
  if(type==='lieRenPickCard') return function(){
    const me=g.players[g.pending.sourceSeat];
    if(me && (me.hand||[]).length>0) pickLieRenCard(0);
    else cancelLieRen();
  };
  if(type==='shensuChoose1') return function(){ skipShensu1(); };
  if(type==='shensuChoose2') return function(){ skipShensu2(); };
  if(type==='qiaobianTurnStart') return function(){ qiaobianDecline(); };
  return null;
}
// maybeAutoRespondTimeout: 检测器单次 tick。读当前 g,若存在超时的询问型 pending 且
// 该阶段有保守动作,则 botInvoke 到被问者座位提交。幂等:服务端守卫通过才生效。
// 返回 true 表示本次提交了动作(供测试断言用),未提交返回 false。
function maybeAutoRespondTimeout(g){
  if(!g || !g.pending || typeof g.pending.askedAt !== 'number') return false;
  if(Date.now() - g.pending.askedAt < RESPONSE_TIMEOUT_MS) return false;
  const act = autoRespondAction(g);
  if(!act){
    // 30秒超时后没有保守动作可提交:pending 会一直悬在这里直到有人手动操作,是"卡死"
    // 的直接信号,记一条 timeout_stuck(fire-and-forget,不影响这次tick本身的返回值)。
    if(typeof writeDebugLog==='function'){
      writeDebugLog(typeof roomId!=='undefined'?roomId:null, 'timeout_stuck', {
        phase: g.phase, pendingType: g.pending.type||null, turn: g.turn, roundNum: g.roundNum,
        message: '30秒超时后autoRespondAction返回null,未提交任何动作',
        // 【隐私修复,2026-08】原来直接 JSON.parse(JSON.stringify(g.pending)) 原样转存,
        // 和 logPendingOrphan 同一个漏洞——改用白名单化的 sanitizePendingForLog(debug-log.js),
        // 不在这里重新发明一套过滤规则。
        pendingSnapshot: (function(){ try{ return typeof sanitizePendingForLog==='function' ? sanitizePendingForLog(g.pending) : null; }catch(e){ return null; } })(),
        playersSummary: typeof debugLogPlayersSummary==='function' ? debugLogPlayersSummary(g) : null
      });
    }
    return false;
  }
  const actorField = (typeof BOT_PHASE_ACTOR!=='undefined' && BOT_PHASE_ACTOR) ? BOT_PHASE_ACTOR[g.phase] : undefined;
  const actor = actorField!==undefined ? g.pending[actorField] : null;
  if(typeof actor!=='number' || !g.players || !g.players[actor]) return false;
  if(typeof botInvoke==='function'){
    botInvoke(actor, act);
  } else {
    act();
  }
  return true;
}
// refreshCountdownSpans: 每秒把页面上所有 .resp-countdown 文本刷成最新剩余秒数
// (倒计时数字不随状态变化自动走,必须靠检测器的 tick 主动刷新;测试环境 querySelectorAll
// 返回空数组,天然 no-op)。
function refreshCountdownSpans(){
  if(typeof document==='undefined' || typeof document.querySelectorAll!=='function') return;
  const spans = document.querySelectorAll('.resp-countdown');
  const cd = (typeof currentG!=='undefined' && currentG) ? renderResponseCountdown(currentG) : null;
  for(let i=0;i<spans.length;i++){
    spans[i].textContent = cd || '';
  }
}
// startAutoRespondTimer: 启动 1s 检测器。任意客户端都可启动(提交幂等);用标志位保证
// 全局只启动一个实例。render() 每次渲染时调用它确保已启动(浏览器环境);vm 测试沙箱
// 没有 setInterval/不需要启动,直接调 maybeAutoRespondTimeout 单步验证。
let __autoRespondTimerStarted = false;
function startAutoRespondTimer(){
  if(__autoRespondTimerStarted) return;
  if(typeof setInterval==='undefined') return;
  __autoRespondTimerStarted = true;
  setInterval(function(){
    if(typeof currentG!=='undefined' && currentG){
      maybeAutoRespondTimeout(currentG);
      refreshCountdownSpans();
    }
  }, 1000);
}
