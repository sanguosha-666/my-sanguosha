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
  const text = (result.text || '').trim();
  if(text){
    aiSummary = text.slice(0, 500);
    aiSummarySeat = seat;
  }
}

function buildBotDefaultSystemPrompt(/* g, seat, ctx */){
  return '你在扮演网页版三国杀的AI机器人。根据局面与武将技能说明，从候选列表选一个index。'
    +'只能选列表内选项。只输出 {"choice":数字}，不要解释。';
}

function buildBotDefaultUserPrompt(state, candidates){
  return '当前局面:\n'+JSON.stringify(state)
    +'\n\n合法候选(index从0开始):\n'+JSON.stringify(candidates.map(c=>({
      index:c.index, label:c.label, action:c.action, card:c.card, seat:c.seat,
      handIndex:c.handIndex, cardIdx:c.cardIdx, target:c.target, targets:c.targets,
      pickKey:c.pickKey, discardIndices:c.discardIndices
    })))
    +'\n\n只返回 {"choice":数字}';
}

// callAiChooseIndex:一次"候选列表→索引"的AI询问,返回规范化后的合法下标或 null。
// 守卫/超时/解析失败/越界全部收敛到这一处,与 tryAiBotPlay 同一套取舍:任何失败都
// 返回 null 交给调用方回退本地逻辑,不重试、不阻塞、不抛异常。
async function callAiChooseIndex(opts){
  const candidates = opts.candidates || [];
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
      systemPrompt: (opts.systemPrompt || buildBotDefaultSystemPrompt()) + summaryNote,
      userPrompt: opts.userPrompt,
      maxTokens: opts.maxTokens || 80,
      model: (typeof aiApiModel!=='undefined' && aiApiModel) || undefined,
    });
  }catch(e){
    result = { ok:false, reason:'other', detail:String(e) };
  }finally{
    hideAiThinkingIndicator();
  }
  if(!result || !result.ok) return null;
  const idx = parseBotPlayAiChoice(result.text);
  if(idx===null || idx<0 || idx>=candidates.length) return null;
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
