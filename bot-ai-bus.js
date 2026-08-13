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

// parseBotPlayAiChoiceWithReason:AI托管模式的解析——AI 在返回 choice 的同时附一句
// 中文理由({"choice":N,"reason":"..."})。复用老解析的宽容策略(JSON.parse失败剥代码块
// 重试一次);解析出 choice 时顺带提取 reason(无 reason 字段则为 null);整体失败回退
// 老解析函数(仍失败则 idx=null)。返回 {idx, reason}。
// 【reasoning 模型兜底(2026-08-11)】command-a-reasoning-08-2025 这类推理型模型即使
// 响应里带 response_format json_object,部分实现仍会把思考链和最终 JSON 混在 content
// 里(托管记录实证:content 是"Okay, let's see... 思考链",JSON 在最末尾)。因此再加
// 一层"提取最后一个 JSON 对象"——从文本末尾向前找平衡的 { } 块,尝试解析;思考链在
// JSON 之前的混合文本也能命中(JSON 通常排在最后)。提取仍失败才回退老解析。
function extractTrailingJson(text){
  const start=text.lastIndexOf('{');
  if(start<0) return null;
  let depth=0, inStr=false, esc=false;
  for(let i=start;i<text.length;i++){
    const ch=text[i];
    if(inStr){
      if(esc) esc=false;
      else if(ch==='\\') esc=true;
      else if(ch==='"') inStr=false;
      continue;
    }
    if(ch==='"'){ inStr=true; continue; }
    if(ch==='{') depth++;
    else if(ch==='}'){ depth--; if(depth===0) return text.slice(start, i+1); }
  }
  return null;
}
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
  // reasoning 模型混合文本:提取末尾 JSON 对象再试(思考链 + {"choice":N,...} 场景)
  const trailing=extractTrailingJson(stripped);
  if(trailing!==null && trailing!==stripped){
    r=tryParse(trailing);
    if(r!==null) return r;
  }
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
let aiSummaryKey = null;
let aiSummaryByBot = Object.create(null);
// aiTestLastReason:AI托管模式(AI托管按钮)下,最近一次托管命中的 AI 询问里解析出的
// 中文选择理由。模块级变量,供信息窗 record 采集(aiTestDecisionHook)。未托管时恒为
// null——callAiChooseIndex 在未托管路径会把 reason 恒写 null,与未托管行为零变化。
// 【为何是顶层声明】计划初稿把声明写在 callAiChooseIndex 函数体内(var 提升后是该函数
// 的局部变量),函数外的测试/采集代码永远读不到——必须放模块顶层才符合"供 record 采集"
// 的语义。
let aiTestLastReason = null;
// aiTestLastChoice:AI托管模式下,最近一次托管命中的 AI 询问里解析出的 choice 下标。
// 与 aiTestLastReason 同一机制(模块顶层声明,供信息窗 record 采集)。未托管时恒为
// null——赋值只发生在 autopilotHit 分支,与未托管行为零变化。
let aiTestLastChoice = null;
// aiTestLastCall:AI托管模式下,最近一次托管命中的 callAiChooseIndex 实际发送的
// prompt 全文 + AI 原始返回文本。模块级变量,供信息窗 record 采集(aiTestDecisionHook /
// runBotDecision 采集分支)。未托管时恒为 null——赋值只发生在 autopilotHit 分支,与未
// 托管行为零变化。同样必须放模块顶层:函数体内声明(var 提升后是函数局部变量)外部读不到。
let aiTestLastCall = null;
function aiSummaryReset(){
  aiSummaryByBot = Object.create(null);
  aiSummary = '';
  aiSummarySeat = null;
  aiSummaryRound = 0;
  aiSummaryTurn = -1;
  aiSummaryKey = null;
}
function getAiSummaryKey(g, seat){
  const p = g && g.players && g.players[seat];
  return p && p.cid ? 'cid:'+p.cid : 'seat:'+seat;
}
function saveActiveAiSummary(){
  if(aiSummaryKey===null) return;
  aiSummaryByBot[aiSummaryKey] = {
    text: aiSummary,
    seat: aiSummarySeat,
    round: aiSummaryRound,
    turn: aiSummaryTurn
  };
}
function selectAiSummary(g, seat){
  const key = getAiSummaryKey(g, seat);
  if(aiSummaryKey===key){ aiSummarySeat=seat; return; }
  saveActiveAiSummary();
  const saved = aiSummaryByBot[key];
  aiSummary = saved ? saved.text : '';
  aiSummarySeat = seat;
  aiSummaryRound = saved ? saved.round : 0;
  aiSummaryTurn = saved ? saved.turn : -1;
  aiSummaryKey = key;
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
  selectAiSummary(g, seat);
  const requestKey = aiSummaryKey;
  const state = buildBotVisibleState(g, seat);
  const oldSummary = aiSummary ? ('旧摘要:\n'+aiSummary+'\n\n') : '';
  const userPrompt = oldSummary
    + '最近局面信息:\n' + JSON.stringify({ round: g.roundNum, recentLog: state.recentLog, players: state.players })
    + '\n\n请输出更新后的摘要(≤200字)。';
  showAiThinkingIndicator(g, seat);
  let result;
  try{
    // 多模型轮换:实际选中的模型由 resolveAiModel(provider) 决定(手动单选优先,
    // 其次多选 round-robin,都无则 undefined 走默认档位)。typeof 防御跨文件加载
    // 顺序(ai-bot.js 最后加载)。关键:opts.model 必须传实际模型不能 undefined 掉——
    // callAI 的 429/413 分支靠它知道当前模型、写 _modelCooldowns 冷却。
    const model = (typeof resolveAiModel==='function' ? resolveAiModel(aiProvider) : undefined);
    if(model === ''){
      // 全池冷却(哨兵空串):不发注定失败的请求,沿用旧摘要返回(和 callAI 失败零差异,
      // 只是省掉一次无效网络往返)。
      return;
    }
    result = await callAI(aiProvider, aiApiKey, {
      systemPrompt: buildSummaryPrompt(g, seat),
      userPrompt: userPrompt,
      maxTokens: 300,
      model,
    });
  }catch(e){
    result = { ok:false, reason:'other', detail:String(e) };
  }finally{
    hideAiThinkingIndicator();
  }
  if(!result || !result.ok) return;
  const text = (result.text || '').trim();
  if(text){
    const saved = aiSummaryByBot[requestKey] || { text:'', seat, round:g.roundNum||0, turn:g.turn };
    saved.text = text.slice(0, 500);
    saved.seat = seat;
    aiSummaryByBot[requestKey] = saved;
    if(aiSummaryKey===requestKey){
      aiSummary = saved.text;
      aiSummarySeat = seat;
    }
  }
}

function buildBotDefaultSystemPrompt(/* g, seat, ctx */){
  return '你在扮演网页版三国杀的AI机器人。根据局面与武将技能说明，从候选列表选一个index。'
    +'只能选列表内选项。只输出 {"choice":数字}，不要解释。'
    +'决策参考(是判断优先级的参考,不是必须遵守的硬规则):1点体力大致相当于2张手牌的价值;'
    +'关键防御牌(无懈/闪/桃)要留到关键时刻,别为试探而消耗;'
    +'杀等进攻资源牌有机会就该果断打出——造成伤害/逼出闪/压低血量,收益远大于存着不用'
    +'(存着也可能被弃置/被顺手牵羊,等于浪费);一直不出牌等于让对手零压力发育;'
    +'但别冒进:对方有明显克制(技能克制/防具/手牌充裕)时该收手就收手,不冒进不等于不出;'
    +'对手处于低血量(1~2血)时,有伤害手段(杀/决斗/AOE)就该果断出手终结,别给对手留回合翻盘的机会,濒死时宁可多打也不收手;'
    +'装备牌大多数情况直接穿上就对了——立即获得射程/防御/距离修正或装备能力,收益远大于留在手里,'
    +'别因为怕被拆/被顺手牵羊就不穿;'
    +'注定会被弃置的无用牌,打出优于弃置(至少可能逼出闪/无懈);打出无用且不会被弃置的牌'
    +'可保留(垫手牌稀释被顺手牵羊抽中核心牌的概率);空城这类"手牌清零=防御"的技能除外;'
    +'局面有队伍号(组队模式)时:优先攻击/拆解敌方队伍,不要把伤害/锦囊/拆牌浪费在队友身上,'
    +'队友濒死时优先救援;';
}

function buildBotDefaultUserPrompt(state, candidates){
  const hasScore = (candidates||[]).some(function(c){ return typeof c.localHeuristicScore === 'number'; });
  return '当前局面:\n'+JSON.stringify(state)
    +'\n\n合法候选(index从0开始):\n'+JSON.stringify(candidates.map(c=>({
      index:c.index, label:c.label, action:c.action,
      seat:c.seat, handIndex:c.handIndex, cardIdx:c.cardIdx,
      target:c.target, targets:c.targets, pickKey:c.pickKey, discardIndices:c.discardIndices
    })))
    +(hasScore ? '\n\n说明:localHeuristicScore是本地算法的参考分,只是排序参考,不代表最优解;请结合局面与你的判断选择,不一定要选分数最高的。' : '')
    +'\n\n只返回 {"choice":数字}';
}

// ===== AI托管专用 prompt 构造(与默认模板互不干扰,未托管路径零触碰) =====
// 背景:默认模板里有两条和"附理由"冲突的指令——system 的"只输出 {"choice":数字}，
// 不要解释。"和 user 末尾的"只返回 {"choice":数字}"。AI 服从最后一条指令,
// 托管模式下这些残留会让它只回 choice 不回 reason(真实用户反馈"都不返回决策理由了")。
// 所以托管命中时把这两处替换成"返回choice+理由"口径;若传入的自定义 prompt 里仍
// 残留"不要解释",在末尾追加一条理由指令压过它(AI 服从最后指令)。未托管路径
// 完全不经过这两个函数,行为零变化。
function buildAutopilotSystemPrompt(systemPrompt){
  const base = systemPrompt || buildBotDefaultSystemPrompt();
  // 把"只输出 {"choice":数字}，不要解释。"整体去掉(前面已有"只能选列表内选项。")——
  // 格式说明统一收敛到末尾的托管标记行,只在 prompt 里出现一次:既消除"不要解释"与
  // "附理由"的矛盾,又不重复格式指令浪费 token。自定义 prompt 若残留"不要解释",
  // 末尾标记行作为最后指令压过它(AI 服从最后指令)。
  const s = base.replace('只输出 {"choice":数字}，不要解释。', '');
  return s + '\n\n(本次为AI托管)返回choice时必须同时附一句中文理由,格式 {"choice":数字,"reason":"理由文本"}。';
}
function buildAutopilotUserPrompt(userPrompt){
  const reasonLine = '请按格式返回 {"choice":数字,"reason":"理由文本"}';
  let s = String(userPrompt || '').replace(/只返回 \{"choice":数字\}\s*$/, reasonLine);
  if(s.indexOf(reasonLine) < 0){
    s = s ? s + '\n\n' + reasonLine : reasonLine;
  }
  return s;
}

// callAiChooseIndex:一次"候选列表→索引"的AI询问,返回规范化后的合法下标或 null。
// 守卫/超时/解析失败/越界全部收敛到这一处,与 tryAiBotPlay 同一套取舍:任何失败都
// 返回 null 交给调用方回退本地逻辑,不阻塞、不抛异常。
// 【多模型轮换的失败自动换下一个】轮换模式(groq/hf 多选)下,一次调用失败(429/413
// 限流、网络错误、超时、500 等任意 !ok)不会立刻放弃——尝试下一个被选中的模型,
// 试完整个轮换池都失败才返回 null 走本地兜底。429/413 会写 _modelCooldowns,
// 下一次 resolveAiModel 自然跳过该模型;非限流错误(网络/500)不写冷却,靠 round-robin
// 指针前进换下一个。手动单选(aiApiModel 非空)与非轮换 provider(claude/openrouter)
// 保持单次调用零变化(那两种场景重试只会重复打同一个模型)。
async function callAiChooseIndex(opts){
  const candidates = opts.candidates || [];
  // 【AI托管】检测当前座位是否处于托管模式:命中则该次询问要求 AI 附理由,
  // 并把解析出的理由存入模块级 aiTestLastReason(供信息窗 record 采集)。
  const autopilotHit = (typeof aiTestAutopilot!=='undefined') && aiTestAutopilot
    && aiTestAutopilot.active && aiTestAutopilot.seat===opts.seat;
  if(typeof aiApiKey==='undefined' || !aiApiKey || !aiProvider) return null;
  if(candidates.length<=1) return candidates.length===1 ? 0 : null;
  // 【AI摘要】按机器人稳定 cid 分仓；切换机器人只切换当前摘要，不清除其它机器人的记忆。
  // 不在这里重建可见状态——buildBotVisibleState 的开销留给各调用方已有的那次调用。
  selectAiSummary(opts.g, opts.seat);
  // 摘要注入:有摘要且座位匹配时,追加进 systemPrompt
  const summaryNote = aiSummary && aiSummarySeat===opts.seat
    ? '\n\n本局记忆摘要(你自己维护的,参考即可):\n'+aiSummary
    : '';
  const g = opts.g, seat = opts.seat;
  // 【AI托管】prompt 构造:托管命中时用托管专用模板(把 system 的"不要解释"/user 末尾的
  // "只返回 {choice}" 替换成"返回choice+理由"口径,消除互相矛盾的指令),平时用默认模板
  // 一字不变——两条路径互不干扰。aiTestLastCall 采集的 prompt 与下方实发逐字一致。
  let sysText = (opts.systemPrompt || buildBotDefaultSystemPrompt()) + summaryNote;
  let userPromptText = opts.userPrompt;
  if(autopilotHit){
    sysText = buildAutopilotSystemPrompt(sysText);
    userPromptText = buildAutopilotUserPrompt(opts.userPrompt);
    aiTestLastCall = { prompt: sysText + '\n\n' + userPromptText, rawResponse: null };
  }
  // 轮换模式判定:groq/hf/cerebras/tri 且走多选轮换(aiApiModel 为空 = 不是手动单选)。
  // 这四种场景才有"换下一个模型"可言;手动单选/非轮换 provider 重试只会打同一个模型,
  // 维持单次。groq/cerebras 是 round-robin、hf/tri 是优先级扫描,统一在这里进重试循环。
  const rotating = (aiProvider==='groq'||aiProvider==='hf'||aiProvider==='cerebras'||aiProvider==='tri')
    && !(typeof aiApiModel==='string' && aiApiModel)
    && Array.isArray(aiApiModels) && aiApiModels.length>0;
  showAiThinkingIndicator(g, seat);
  let result;
  try{
    // 轮换模式:最多试完整个池子(每个模型至多一次——429/413 写冷却后 resolveAiModel
    // 会跳过,非限流错误靠指针前进换下一个,但池子只有一个模型时不无限重打它);
    // 非轮换模式:单次调用(与改动前逐字一致)。
    const maxAttempts = rotating ? aiApiModels.length : 1;
    result = null;
    for(let attempt=0; attempt<maxAttempts; attempt++){
      const model = (typeof resolveAiModel==='function' ? resolveAiModel(aiProvider) : undefined);
      if(model === ''){
        // 全池冷却(哨兵空串):不发注定失败的请求,直接走本地兜底(null)。
        result = null;
        break;
      }
      result = await callAI(aiProvider, aiApiKey, {
        systemPrompt: sysText,
        userPrompt: userPromptText,
        maxTokens: opts.maxTokens || 80,
        // 多模型轮换:同 updateAiSummary 的 callAI 调用点,见该处注释。
        model,
      });
      if(result && result.ok) break; // 成功:停止重试
      // 失败:继续下一轮拿下一个未冷却的模型(429/413 已被 callAI 写入冷却,
      // resolveAiModel 会跳过它;非限流错误不写冷却,靠 round-robin 指针前进)。
    }
  }catch(e){
    result = { ok:false, reason:'other', detail:String(e) };
  }finally{
    hideAiThinkingIndicator();
  }
  if(autopilotHit && aiTestLastCall) aiTestLastCall.rawResponse = result && result.ok ? result.text : null;
  if(!result || !result.ok){
    if(autopilotHit){ aiTestLastReason = null; aiTestLastChoice = null; } // 未托管零触碰
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
  if(autopilotHit) aiTestLastChoice = idx;
  // 【AI托管回填】解析完成后,把本次 AI 调用的真实数据回填进"最后一条待回填骨架记录"
  // (runBotDecision 决策前由 aiTestDecisionHook 建立)。注意:只有解析成功(idx 合法)才回填
  // choice/reason;解析失败/越界时本条记录保持骨架状态(choice 显示"(无动作/本地兜底)"是
  // 真实语义——AI 没能给出合法选择,走了本地兜底)。
  if(autopilotHit && typeof aiTestFillPendingRecord==='function'){
    aiTestFillPendingRecord({
      prompt: (aiTestLastCall && aiTestLastCall.prompt) || '',
      rawResponse: (aiTestLastCall && aiTestLastCall.rawResponse) || '',
      choice: idx,
      reason: reason
    });
  }
  if(idx===null || idx<0 || idx>=candidates.length){
    if(autopilotHit){ aiTestLastReason = null; aiTestLastChoice = null; }
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
// 每个阶段的超时动作直接登记在统一 STAGE_TABLE；同一阶段保持旧 if 链的首个匹配语义。
function registerStageTimeoutAction(types, factory){
  (Array.isArray(types)?types:[types]).forEach(function(type){
    const spec=STAGE_TABLE[type]||registerStage(type,{});
    if(typeof spec.timeoutAction!=='function') registerStage(type,{timeoutAction:factory});
  });
}
registerStageTimeoutAction("wuxiePublicWait", function(g){ return function(){ finishWuxiePublicWait(); }; });
registerStageTimeoutAction("respond", function(g){ return function(){ respondShan(false); }; });
registerStageTimeoutAction("aoeResp", function(g){ return function(){ aoeRespond(false); }; });
registerStageTimeoutAction("duel", function(g){ return function(){ duelResponse(false); }; });
registerStageTimeoutAction("dying", function(g){ return function(){ respondDying(false); }; });
registerStageTimeoutAction("wuxie", function(g){ return function(){ respondWuxie(false); }; });
registerStageTimeoutAction("pick", function(g){ return function(){                                          // 顺手/拆桥:固定选首个合法对象
    const target=g.players[g.pending.to];
    if(target&&(target.hand||[]).length) pickResolve('hand');
    else{
      const slot=target&&target.equips&&EQUIP_SLOTS.find(function(s){return target.equips[s];});
      if(slot) pickResolve(slot);
      else if(target&&(target.delays||[]).length) pickResolve('delay:0');
    }
  }; });
registerStageTimeoutAction("guicai", function(g){ return function(){ respondGuicai(false); }; });
registerStageTimeoutAction("jiedaoChoice", function(g){ return function(){ respondJiedao(false); }; });
registerStageTimeoutAction("ganglieChoice", function(g){ return function(){ respondGanglieChoice('damage',[]); }; });
registerStageTimeoutAction("guhuoQuestion", function(g){ return function(){ respondGuhuoQuestion(false); }; });
registerStageTimeoutAction("xiaoguo", function(g){ return function(){ respondXiaoguo(false); }; });
registerStageTimeoutAction("xiaoguoChoice", function(g){ return function(){ respondXiaoguoChoice('damage'); }; });
registerStageTimeoutAction("lirangAsk", function(g){ return function(){ respondLiRang(false,[]); }; });
registerStageTimeoutAction("lirangRecover", function(g){ return function(){ respondLiRangRecover(false); }; });
registerStageTimeoutAction("zhengyi", function(g){ return function(){ respondZhengyi(false); }; });
registerStageTimeoutAction("tianxiang", function(g){ return function(){ respondTianxiang(null,null); }; });
registerStageTimeoutAction("liuli", function(g){ return function(){ respondLiuli(null,null); }; });
registerStageTimeoutAction("quhuRespond", function(g){ return function(){ respondQuhu(0); }; });
registerStageTimeoutAction("fanjianSuit", function(g){ return function(){ respondFanjianSuit(SUITS[Math.floor(Math.random()*SUITS.length)]); }; });
registerStageTimeoutAction("huogong", function(g){ return function(){ respondHuogong(false); }; });
registerStageTimeoutAction("huogongReveal", function(g){ return function(){ respondHuogongReveal(0); }; });
registerStageTimeoutAction("jijiangAsk", function(g){ return function(){ respondJijiangAsk(false); }; });
registerStageTimeoutAction("hujiaAsk", function(g){ return function(){ respondHujiaAsk(false); }; });
registerStageTimeoutAction("zhibaAsk", function(g){ return function(){ respondZhiba(0); }; });
registerStageTimeoutAction("zhibaGain", function(g){ return function(){ respondZhibaGain(true); }; });
registerStageTimeoutAction("yinghunTarget", function(g){ return function(){ cancelYinghun(); }; });
registerStageTimeoutAction("yinghunChoice", function(g){ return function(){ respondYinghunChoice('drawX'); }; });
registerStageTimeoutAction("yinghunDiscard", function(g){ return function(){ const p=g.players[g.pending.targetSeat],slot=EQUIP_SLOTS.find(function(s){return p.equips&&p.equips[s];}); discardYinghunCard((p.hand||[]).length?0:{kind:'equip',slot:slot}); }; });
registerStageTimeoutAction("huashenChangeAskStart", function(g){ return function(){ respondHuashenChangeAskStart(false); }; });
registerStageTimeoutAction("huashenChangeAskEnd", function(g){ return function(){ respondHuashenChangeAskEnd(false); }; });
registerStageTimeoutAction("huashenChangePickStart", function(g){ return function(){
    const me = g.players[g.pending.seat];
    const generalId = me && (me.huashenPool||[]).find(function(id){ return (HUASHEN_SKILL_TABLE[id]||[]).length; });
    if(!generalId){ abandonHuashenChangePickStart(); return; }
    const entry = (HUASHEN_SKILL_TABLE[generalId]||[])[0];
    respondHuashenChangePickStart(generalId, entry && entry.name);
  }; });
registerStageTimeoutAction("huashenChangePickEnd", function(g){ return function(){
    const me = g.players[g.pending.seat];
    const generalId = me && (me.huashenPool||[]).find(function(id){ return (HUASHEN_SKILL_TABLE[id]||[]).length; });
    if(!generalId){ abandonHuashenChangePickEnd(); return; }
    const entry = (HUASHEN_SKILL_TABLE[generalId]||[])[0];
    respondHuashenChangePickEnd(generalId, entry && entry.name);
  }; });
registerStageTimeoutAction("yijiAsk", function(g){ return function(){ respondYijiAsk(false); }; });
registerStageTimeoutAction("ganglieAsk", function(g){ return function(){ respondGanglieAsk(false); }; });
registerStageTimeoutAction("guiduAsk", function(g){ return function(){ cancelGuidu(); }; });
registerStageTimeoutAction("jiangchiAsk", function(g){ return function(){ respondJiangchi('none'); }; });
registerStageTimeoutAction("zhijiChoice", function(g){ return function(){ respondZhijiChoice(true); }; });
registerStageTimeoutAction("tiaoxinChoice", function(g){ return function(){ respondTiaoxinChoice(false); }; });
registerStageTimeoutAction("huanhuoPick", function(g){ return function(){
    const target=(g.pending.candidates||[])[0];
    if(typeof target==='number') pickHuanhuoTarget(target); else cancelHuanhuo();
  }; });
registerStageTimeoutAction("huanhuoPickCard", function(g){ return function(){
    const me=g.players[g.pending.sourceSeat];
    const idx=(me&&me.hand||[]).findIndex(function(c){ return c&&c.suit==='♥'; });
    if(idx>=0) pickHuanhuoHeartCard(idx); else cancelHuanhuo();
  }; });
registerStageTimeoutAction("huanhuoPickGotCard", function(g){ return function(){
    const target=g.players[g.pending.targetSeat];
    const slot=target&&target.equips&&EQUIP_SLOTS.find(function(s){ return target.equips[s]; });
    if(slot) pickHuanhuoGotCard('equip',slot);
    else if(target&&(target.hand||[]).length>0) pickHuanhuoGotCard('hand',null);
  }; });
registerStageTimeoutAction("huanhuoPickSecond", function(g){ return function(){
    const target=(g.pending.candidates||[])[0];
    if(typeof target==='number') pickHuanhuoSecondTarget(target);
  }; });
registerStageTimeoutAction("lieRenChoose", function(g){ return function(){ cancelLieRen(); }; });
registerStageTimeoutAction("lieRenPickCard", function(g){ return function(){
    const me=g.players[g.pending.sourceSeat];
    if(me && (me.hand||[]).length>0) pickLieRenCard(0);
    else cancelLieRen();
  }; });
registerStageTimeoutAction("shensuChoose1", function(g){ return function(){ skipShensu1(); }; });
registerStageTimeoutAction("shensuChoose2", function(g){ return function(){ skipShensu2(); }; });
registerStageTimeoutAction("qiaobianTurnStart", function(g){ return function(){ qiaobianDecline(); }; });
registerStageTimeoutAction("duanbingChoose", function(g){ return function(){ cancelDuanbing(); }; });
registerStageTimeoutAction("mingcePickCard", function(g){ return function(){ cancelMingce(); }; });
registerStageTimeoutAction("qiaomengChoose", function(g){ return function(){ cancelQiaomeng(); }; });
registerStageTimeoutAction("lianyingAsk", function(g){ return function(){ respondLianying(false); }; });
registerStageTimeoutAction("tieqi", function(g){ return function(){ respondTieqi(false); }; });
registerStageTimeoutAction("liegong", function(g){ return function(){ respondLiegong(false); }; });
registerStageTimeoutAction("qiangxiChooseCost", function(g){ return function(){ cancelQiangxi(); }; });
registerStageTimeoutAction("qiangxiChooseWeaponFromHand", function(g){ return function(){ cancelQiangxi(); }; });
registerStageTimeoutAction("qiangxiPickTarget", function(g){ return function(){
    const target=(g.pending.candidates||[])[0];
    if(typeof target==='number') pickQiangxiTarget(target);
  }; });
registerStageTimeoutAction(["luanjiChoose","luanjiConfirm"], function(g){ return function(){ cancelLuanji(); }; });
registerStageTimeoutAction("haoshiPick", function(g){ return function(){ const target=(g.pending.candidates||[])[0]; if(typeof target==='number') respondHaoshi(target); }; });
registerStageTimeoutAction("leijiChoose", function(g){ return function(){ cancelLeiji(); }; });
registerStageTimeoutAction("leijiJudge", function(g){ return function(){ doLeijiJudge(); }; });
registerStageTimeoutAction("mengjin", function(g){ return function(){ const choice=(g.pending.available||[])[0]; if(choice) mengjinPick(choice); }; });
registerStageTimeoutAction("mingcePickTarget", function(g){ return function(){ cancelMingce(); }; });
registerStageTimeoutAction("mingcePickTarget2", function(g){ return function(){ cancelMingce(); }; });
registerStageTimeoutAction("mingceChoice", function(g){ return function(){ chooseMingceOption('draw'); }; });
registerStageTimeoutAction("qiaobianMove", function(g){ return function(){ respondQiaobianMove(null); }; });
registerStageTimeoutAction("enyuanChoose", function(g){ return function(){ triggerEnyuan(); }; });
registerStageTimeoutAction("jiushiFlipAsk", function(g){ return function(){ respondJiushiFlip(false); }; });
registerStageTimeoutAction("wangxiAsk", function(g){ return function(){ respondWangxi(false); }; });
registerStageTimeoutAction("buquAsk", function(g){ return function(){ respondBuqu(true); }; });
registerStageTimeoutAction("luanwuChoose", function(g){ return function(){ chooseLuanwuOption('hp'); }; });
registerStageTimeoutAction("wugu", function(g){ return function(){ const d=g.pending,card=(d.pool||[])[0]; if(card) wuguPick(0,d.idx,card.id); }; });
registerStageTimeoutAction("hanbingAsk", function(g){ return function(){ respondHanbingAsk(false); }; });
registerStageTimeoutAction("jujianPickCard", function(g){ return function(){ cancelJujian(); }; });
registerStageTimeoutAction("jushouChoose", function(g){ return function(){ cancelJushou(); }; });
registerStageTimeoutAction("shuangxiongAsk", function(g){ return function(){ respondShuangxiong(false); }; });
registerStageTimeoutAction("luoyiAsk", function(g){ return function(){ respondLuoyi(false); }; });
registerStageTimeoutAction("xunxunPick", function(g){ return function(){ const d=g.pending,all=(d.cards||[]).map(function(_,i){return i;}),take=d.takeN||2; respondXunxun(all.slice(0,take),all.slice(take)); }; });
registerStageTimeoutAction("luoshen", function(g){ return function(){ respondLuoshen(false); }; });
registerStageTimeoutAction("enyuanChooseOption", function(g){ return function(){ chooseEnyuanOption('giveCard'); }; });
registerStageTimeoutAction("enyuanGiveCard", function(g){ return function(){ const p=g.players[g.pending.damagerSeat],idx=(p&&p.hand||[]).findIndex(function(c){return c&&c.suit==='♥';}); if(idx>=0) giveEnyuanCard(idx); }; });
registerStageTimeoutAction("guhuoTarget", function(g){ return function(){ cancelGuhuoTarget(); }; });
registerStageTimeoutAction("guanxingReview", function(g){ return function(){ const all=(g.pending.cards||[]).map(function(_,i){return i;}); respondGuanxing(all,[]); }; });
registerStageTimeoutAction("quhuDamageChoice", function(g){ return function(){ const target=(g.pending.targets||[])[0]; if(typeof target==='number') respondQuhuDamage(target); }; });
registerStageTimeoutAction("tianyiRespond", function(g){ return function(){ respondTianyi(0); }; });
registerStageTimeoutAction("jiemingAsk", function(g){ return function(){ respondJieming(null); }; });
registerStageTimeoutAction("xinshengAsk", function(g){ return function(){ respondXinshengAsk(false); }; });
registerStageTimeoutAction("yijiAssign", function(g){ return function(){ respondYijiAssign((g.pending.cards||[]).map(function(){return g.pending.seat;})); }; });
registerStageTimeoutAction("tiaoxinDiscard", function(g){ return function(){ const target=g.players[g.pending.to],opt=target&&tiaoxinDiscardOptions(target)[0]; if(opt) pickTiaoxinDiscard(opt.kind,opt.kind==='hand'?opt.idx:opt.slot); }; });
registerStageTimeoutAction("qiaomengPickEquip", function(g){ return function(){ const slot=(g.pending.availableSlots||[])[0]; if(slot) pickQiaomengEquip(slot); }; });
registerStageTimeoutAction("lieRenRespond", function(g){ return function(){ respondLieRen(0); }; });
registerStageTimeoutAction("jujianPickTarget", function(g){ return function(){ const target=(g.pending.candidates||[])[0]; if(typeof target==='number') respondJujianPickTarget(target); else cancelJujian(); }; });
registerStageTimeoutAction("jujianChooseEffect", function(g){ return function(){ respondJujianEffect('draw'); }; });
registerStageTimeoutAction("luoyingAsk", function(g){ return function(){ respondLuoying(false); }; });
registerStageTimeoutAction("cixiongAsk", function(g){ return function(){ respondCixiongAsk(false); }; });
registerStageTimeoutAction("chengxiangAsk", function(g){ return function(){ cancelChengxiangAsk(); }; });
registerStageTimeoutAction("chengxiangChoose", function(g){ return function(){ cancelChengxiang(); }; });
registerStageTimeoutAction("renxinChoose", function(g){ return function(){ cancelRenxin(); }; });
registerStageTimeoutAction("xuanfengPick", function(g){ return function(){ cancelXuanfeng(); }; });
registerStageTimeoutAction("beigeChoose", function(g){ return function(){ triggerBeige(false); }; });
registerStageTimeoutAction("beigeDiscard", function(g){ return function(){ const p=g.players[g.pending.sourceSeat],slot=p&&p.equips&&EQUIP_SLOTS.find(function(s){return p.equips[s];}); if(p&&(p.hand||[]).length) beigeDiscard(0,false,null); else if(slot) beigeDiscard(null,true,slot); }; });
registerStageTimeoutAction("beigeJudge", function(g){ return function(){ doBeigeJudge(); }; });
registerStageTimeoutAction(["tianyiPickCard","tianyiPickTarget"], function(g){ return function(){ cancelTianyi(); }; });
registerStageTimeoutAction("zhimengAsk", function(g){ return function(){ respondZhimeng(false); }; });
registerStageTimeoutAction("zhimengPick", function(g){ return function(){ const opt=(g.pending.options||[])[0]; if(opt) respondZhimengPick(opt.type,opt.index); }; });
registerStageTimeoutAction("biyue", function(g){ return function(){ respondBiyue(false); }; });
registerStageTimeoutAction("yaowu_choose", function(g){ return function(){ const p=g.players[g.pending.seat]; respondYaowu(p&&p.hp<p.maxHp?'recover':'draw'); }; });
registerStageTimeoutAction("shensuSha", function(g){ return function(){ cancelShensuSha(); }; });
registerStageTimeoutAction("shaOffsetChoice", function(g){ return function(){ respondShaOffsetChoice(null); }; });
registerStageTimeoutAction(["fenxunDiscard","fenxunTarget"], function(g){ return function(){ cancelFenxun(); }; });
function autoRespondAction(g){
  const type=(g.pending&&g.pending.type)||'';
  const typeSpec=STAGE_TABLE[type];
  const phaseSpec=STAGE_TABLE[g.phase];
  const factory=typeSpec&&typeof typeSpec.timeoutAction==='function' ? typeSpec.timeoutAction
    : (phaseSpec&&typeof phaseSpec.timeoutAction==='function' ? phaseSpec.timeoutAction : null);
  if(factory) return factory(g);
  if(canDefaultAbandonPending(g)) return function(){ defaultAbandonPending(g); };
  return null;
}
function canDefaultAbandonPending(g){
  if(!g || !g.pending || !Number.isInteger(pendingResponderSeat(g,g.pending))) return false;
  const d=g.pending;
  if(d.resume && typeof d.resume.type==='string') return true;
  if(typeof d.resumePhase==='string' || typeof d.previousPhase==='string') return true;
  return Number.isInteger(g.turn) && pendingResponderSeat(g,d)===g.turn;
}
function defaultAbandonPending(snapshot){
  if(!snapshot || !snapshot.pending) return;
  const expectedType=snapshot.pending.type;
  const expectedAskedAt=snapshot.pending.askedAt;
  tx(function(g){
    const d=g.pending;
    if(!d || d.type!==expectedType || d.askedAt!==expectedAskedAt) return g;
    const responder=pendingResponderSeat(g,d);
    if(!Number.isInteger(responder) || responder!==mySeat) return g;
    if(Date.now()-d.askedAt<RESPONSE_TIMEOUT_MS) return g;
    const resume=d.resume;
    const resumePhase=typeof d.resumePhase==='string' ? d.resumePhase
      : (typeof d.previousPhase==='string' ? d.previousPhase : null);
    const canReturnToPlay=Number.isInteger(g.turn) && responder===g.turn;
    if(!(resume&&typeof resume.type==='string') && !resumePhase && !canReturnToPlay) return g;
    g.pending=null;
    if(resume && typeof resume.type==='string') resumeAfterInterrupt(g,resume,responder);
    else g.phase=resumePhase||'play';
    g.log=pushLog(g.log,(g.players[responder]&&g.players[responder].name||'玩家')+' 响应超时，自动放弃当前操作');
    return g;
  });
}
// maybeAutoRespondTimeout: 检测器单次 tick。读当前 g,若存在超时的询问型 pending 且
// 该阶段有保守动作,则 botInvoke 到被问者座位提交。幂等:服务端守卫通过才生效。
// 返回 true 表示本次提交了动作(供测试断言用),未提交返回 false。
function maybeAutoRespondTimeout(g){
  if(!g || !g.pending || typeof g.pending.askedAt !== 'number') return false;
  const timeoutMs=g.pending.type==='wuxiePublicWait' ? 1000 : RESPONSE_TIMEOUT_MS;
  if(Date.now() - g.pending.askedAt < timeoutMs) return false;
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
  // 公共无懈窗口没有真正的响应玩家，任意客户端直接提交幂等收尾事务即可；
  // 不经过 botInvoke，避免被误当成某个座位的私人决策并异步延后。
  if(g.pending.type==='wuxiePublicWait'){
    act();
    return true;
  }
  const actor = pendingResponderSeat(g,g.pending);
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
