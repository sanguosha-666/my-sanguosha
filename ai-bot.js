// ai-bot.js — AI机器人接入,第一阶段:适配层 + 密钥输入UI(弹窗形式)。
//
// 【范围声明,务必遵守】本文件本身、以及本次改动对 render-controls.js 的追加,
// 完全不接入任何游戏逻辑——callAI/PROVIDER_ADAPTERS 目前没有任何调用方连到
// botPlay/botBestTarget/runBotDecision/scheduleBotTurn 等既有机器人调度代码,
// 那批文件(bot.js)在本次改动中一行未动。这里只是把"密钥怎么存、怎么识别提供商、
// 怎么发起一次AI调用"这三件事先做成独立、可单测的模块,接入机器人决策是后续阶段
// 的范围。
//
// 【确认方案:Claude直连 + OpenRouter/Groq覆盖其它模型,不加后端】
// Claude(api.anthropic.com)官方支持浏览器直连(anthropic-dangerous-direct-browser-
// access 请求头,是 Anthropic 自己文档化的"自带密钥的客户端应用"场景);OpenAI 的
// api.openai.com 不支持浏览器直连 CORS,要接 GPT 必须经服务器代理——这个项目是纯静态
// 多文件、无构建流程、无后端(见 CLAUDE.md),不引入服务器。所以"GPT/其它模型"这个槽位
// 统一走 OpenRouter(和 OpenAI 的 Chat Completions 格式兼容、且支持浏览器直连
// CORS)中转,不是直接调用 OpenAI 官方接口——UI 上必须如实标注"OpenRouter(GPT/多模型)"
// 而不是让用户误以为在直接用自己的 OpenAI 密钥。持有 OpenAI 密钥的用户需要另外去
// OpenRouter 申请一把密钥,这是这个方案已知、已确认接受的代价。
//
// 【Groq 正式加入为第三个 provider,2026-07-30】Groq(api.groq.com,OpenAI 兼容格式)
// 已经用真实网络请求验证过支持浏览器直连 CORS——不是查文档推断,是真的用一把真实密钥
// 通过本文件里现在这套 callAI/adapter 机制发起过一次请求,收到 {ok:true,text:'OK'} 的
// 真实响应,验证脚本本身没有落进代码库(不是这几行 adapter 代码,只是证明了"能不能连
// 上"这件事)。以后不需要再重新怀疑 Groq 是否可行——如果连接失败,先怀疑密钥本身或
// Groq 那边的策略变化,不要重新去查"Groq 是否支持浏览器直连"这个已经验证过的问题。
//
// 【密钥安全设计,务必遵守】密钥只存在 sessionStorage(本标签页内存级持久化,刷新/
// 关闭标签页即清空)+ 本文件的模块级变量里,绝不写入 g/Firebase 共享状态、绝不用
// localStorage(那会跨标签页/跨刷新持久化,超出"这一局"的生命周期)、绝不出现在
// 任何会被其他玩家读到的地方(座位卡、日志、pending 等)。持有密钥的只有触发
// addBot() 的那个人(mySeat===0,和现有"添加机器人"按钮同一个身份边界,
// room-lifecycle.js 的 addBot()/removeBot() 服务端本来就要求 mySeat===0),
// 费用由这把密钥的账户承担,UI 上必须给出明确提示。
//
// 【弹窗触发时机的设计决定,替代第一阶段的常驻折叠面板】折叠面板容易被忽略,改成
// 弹窗:第一次点击"添加机器人"(mySeat===0)时,如果这个标签页内还没有已保存的密钥、
// 且这个会话内还没有明确表示过"跳过",就弹出这个询问框;一旦密钥保存成功,或者玩家
// 点了"跳过",这个会话内不会再自动弹出——这就是需求里"以后不再询问"要的效果,不需要
// 再加一个单独的复选框:密钥非空 → 触发条件 !aiApiKey 天然不再成立;点跳过 → 显式记
// aiPromptDismissed=true。两条状态都写回 sessionStorage(和密钥同一生命周期:刷新
// 保留、关闭标签页清空),避免"同一局中途刷新一次页面又被问一遍"。
// 另外在"添加/移除机器人"按钮旁常驻一个小的"AI机器人设置"入口(renderAiStatusButton),
// 不受 aiPromptDismissed 影响、随时可点开——覆盖"第一次跳过了,后来想加/想改密钥"
// 这类需求,不需要重新触发一次添加机器人才能找到配置入口。

// ---------- sessionStorage 持久化 ----------
const AI_KEY_STORAGE_KEY = 'sgsAiKey';
const AI_PROVIDER_STORAGE_KEY = 'sgsAiProvider';
const AI_PROMPT_DISMISSED_STORAGE_KEY = 'sgsAiPromptDismissed';
const AI_MODEL_STORAGE_KEY = 'sgsAiModel';

// 模块级变量,和 game.js 顶部 myClientId 同一处理方式:加载时尝试从 sessionStorage
// 恢复一次(应对"同一标签页内因为JS错误等原因整页刷新"这类场景——标签页本身没关闭,
// sessionStorage 依然在),之后由弹窗/状态按钮的事件处理器持续保持同步、并写回 storage。
let aiApiKey = '';
let aiProvider = null; // 'claude' | 'openrouter' | 'groq' | null(尚未识别/尚未选择)
// 这个会话内是否已经明确回应过密钥询问(填了密钥,或点了"跳过")——true 时
// handleAddBotClick 不会再自动弹窗,但常驻的"AI机器人设置"按钮始终不受这个影响。
let aiPromptDismissed = false;
// 用户手动选择/输入的具体模型ID。空字符串="不覆盖,交给 PROVIDER_ADAPTERS 各自的
// buildRequest 用其内置默认档位"——这条约定和 aiApiKey/aiProvider 完全独立,选不选
// 模型不影响密钥/提供商这两件事的既有行为。bot.js 的 5 处 callAI(...) 调用点统一传
// model: aiApiModel || undefined,undefined 时 opts.model||'默认档位' 这行既有代码
// 天然兜底,不需要为"用户没选模型"这个最常见情形写任何特殊分支。
let aiApiModel = '';

(function hydrateAiStateFromSession(){
  try{
    aiApiKey = sessionStorage.getItem(AI_KEY_STORAGE_KEY) || '';
    aiProvider = sessionStorage.getItem(AI_PROVIDER_STORAGE_KEY) || null;
    aiPromptDismissed = sessionStorage.getItem(AI_PROMPT_DISMISSED_STORAGE_KEY) === '1';
    aiApiModel = sessionStorage.getItem(AI_MODEL_STORAGE_KEY) || '';
  }catch(e){
    // 隐私模式等场景下 sessionStorage 可能整体不可用——静默回退到空值,不影响
    // 本次会话内内存里正常使用,只是刷新后无法恢复(每次刷新都会重新弹一次询问框,
    // 这是这种环境下唯一的合理退化,不算 bug)。
    aiApiKey = ''; aiProvider = null; aiPromptDismissed = false; aiApiModel = '';
  }
})();

function persistAiState(){
  try{
    if(aiApiKey) sessionStorage.setItem(AI_KEY_STORAGE_KEY, aiApiKey);
    else sessionStorage.removeItem(AI_KEY_STORAGE_KEY);
    if(aiProvider) sessionStorage.setItem(AI_PROVIDER_STORAGE_KEY, aiProvider);
    else sessionStorage.removeItem(AI_PROVIDER_STORAGE_KEY);
    if(aiPromptDismissed) sessionStorage.setItem(AI_PROMPT_DISMISSED_STORAGE_KEY, '1');
    else sessionStorage.removeItem(AI_PROMPT_DISMISSED_STORAGE_KEY);
    if(aiApiModel) sessionStorage.setItem(AI_MODEL_STORAGE_KEY, aiApiModel);
    else sessionStorage.removeItem(AI_MODEL_STORAGE_KEY);
  }catch(e){ /* 同上,静默忽略 */ }
}

// ---------- 密钥格式识别(纯函数) ----------
// Claude 密钥固定 sk-ant- 前缀(Anthropic 官方格式);OpenRouter 密钥固定 sk-or- 前缀;
// Groq 密钥固定 gsk_ 前缀(三者互不冲突,不需要考虑优先级顺序)。都识别不出时返回
// null,由 UI 侧退化成手动选择下拉框。
function detectAiProvider(key){
  const k = (key||'').trim();
  if(!k) return null;
  if(/^sk-ant-/.test(k)) return 'claude';
  if(/^sk-or-/.test(k)) return 'openrouter';
  if(/^gsk_/.test(k)) return 'groq';
  return null;
}

// ---------- Provider 适配层 ----------
// 每个 adapter 只负责两件事:①按自己的协议格式构造请求(url/headers/body,纯函数,
// 不发起网络请求)②从响应 JSON 里把纯文本抠出来。网络请求本身、超时、错误归类统一
// 收在下面的 callAI() 里,不在每个 adapter 里重复实现——以后新增 provider 只需要在
// 这里加一项,不需要碰 callAI。
const PROVIDER_ADAPTERS = {
  claude: {
    label: 'Claude',
    endpoint: 'https://api.anthropic.com/v1/messages',
    buildRequest(apiKey, opts){
      const body = {
        model: opts.model || 'claude-haiku-4-5-20251001',
        max_tokens: opts.maxTokens || 512,
        messages: [{ role:'user', content: opts.userPrompt }],
      };
      if(opts.systemPrompt) body.system = opts.systemPrompt;
      return {
        url: this.endpoint,
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          // 【必需】没有这个头,api.anthropic.com 会直接拒绝浏览器发起的跨域请求——
          // 这是 Anthropic 自己文档化的、专门为"用户自带密钥的客户端应用"场景开的口子。
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify(body),
      };
    },
    parseResponse(json){
      const block = json && Array.isArray(json.content) && json.content[0];
      if(!block || typeof block.text !== 'string') throw new Error('未识别的 Claude 响应结构');
      return block.text;
    },
  },
  openrouter: {
    label: 'OpenRouter(GPT/多模型)',
    endpoint: 'https://openrouter.ai/api/v1/chat/completions',
    buildRequest(apiKey, opts){
      const messages = [];
      if(opts.systemPrompt) messages.push({ role:'system', content: opts.systemPrompt });
      messages.push({ role:'user', content: opts.userPrompt });
      return {
        url: this.endpoint,
        headers: {
          'content-type': 'application/json',
          'authorization': 'Bearer '+apiKey,
        },
        body: JSON.stringify({
          model: opts.model || 'openai/gpt-4o-mini',
          max_tokens: opts.maxTokens || 512,
          messages,
        }),
      };
    },
    parseResponse(json){
      const msg = json && Array.isArray(json.choices) && json.choices[0] && json.choices[0].message;
      if(!msg || typeof msg.content !== 'string') throw new Error('未识别的 OpenRouter 响应结构');
      return msg.content;
    },
  },
  groq: {
    // Groq(api.groq.com)是 OpenAI 兼容格式,adapter 结构和 openrouter 逐字一致(仅
    // endpoint/默认模型不同)——已用真实网络请求验证过支持浏览器直连 CORS,见文件头部
    // 【Groq 正式加入为第三个 provider】那段说明,不是没测过就先加进来。
    label: 'Groq(极速推理)',
    endpoint: 'https://api.groq.com/openai/v1/chat/completions',
    buildRequest(apiKey, opts){
      const messages = [];
      if(opts.systemPrompt) messages.push({ role:'system', content: opts.systemPrompt });
      messages.push({ role:'user', content: opts.userPrompt });
      return {
        url: this.endpoint,
        headers: {
          'content-type': 'application/json',
          'authorization': 'Bearer '+apiKey,
        },
        body: JSON.stringify({
          model: opts.model || 'llama-3.3-70b-versatile',
          max_tokens: opts.maxTokens || 512,
          messages,
        }),
      };
    },
    parseResponse(json){
      const msg = json && Array.isArray(json.choices) && json.choices[0] && json.choices[0].message;
      if(!msg || typeof msg.content !== 'string') throw new Error('未识别的 Groq 响应结构');
      return msg.content;
    },
  },
};

// ---------- 模型选择候选表 ----------
// 【每家的候选列表都是真实核实过的,不是凭旧印象假设——2026-08-01 用 WebSearch/
// WebFetch 分别核实】Claude:官方模型表(见 CLAUDE.md「当前模型」);OpenRouter:直接
// 请求了公开的 https://openrouter.ai/api/v1/models 这个不需要鉴权的模型清单接口,
// 逐个确认了下面这几个 id 字符串在当次抓取里确实存在、且价格字段真实(不是猜的);
// Groq:WebFetch 了 console.groq.com/docs/models.md,逐条对照生产模型表。每家列表
// 第一项都固定等于 PROVIDER_ADAPTERS 对应 buildRequest 里硬编码的默认值——这样
// aiApiModel 为空(用户没手动选)时,下拉框视觉上预选的就是"当前实际生效"的那一项,
// 不会出现"UI显示的默认选项"和"实际调用的模型"对不上的情况。
// 【自定义(__custom__)选项存在的原因】OpenRouter 这类聚合平台的可选模型有300+个、
// 且随时可能上新/下架,这里只给3~5个有代表性的常见选项(任务要求,不需要穷举全部)——
// 真正的自由度靠这个特殊值实现:选中后展示一个文本框,允许用户输入任何自己核实过
// 有效的精确模型ID,不受这份候选表的限制。三家 provider 统一提供这个选项,不只是
// OpenRouter 独有(以防 Anthropic/Groq 在这份表更新前就发布了新档位)。
const AI_MODEL_CUSTOM_VALUE = '__custom__';
const AI_MODEL_OPTIONS = {
  claude: [
    { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5(默认·最快最省)' },
    { id: 'claude-sonnet-5', label: 'Sonnet 5(更聪明·成本更高)' },
    { id: 'claude-opus-5', label: 'Opus 5(最强·最贵最慢)' },
  ],
  openrouter: [
    { id: 'openai/gpt-4o-mini', label: 'GPT-4o mini(默认)' },
    { id: 'google/gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash Lite(更快更省)' },
    { id: 'deepseek/deepseek-v3.2', label: 'DeepSeek V3.2(性价比均衡)' },
    { id: 'meta-llama/llama-3.3-70b-instruct', label: 'Llama 3.3 70B(开源)' },
  ],
  groq: [
    { id: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B(默认)' },
    { id: 'llama-3.1-8b-instant', label: 'Llama 3.1 8B(更快更省)' },
    { id: 'openai/gpt-oss-120b', label: 'GPT-OSS 120B(更强)' },
    { id: 'openai/gpt-oss-20b', label: 'GPT-OSS 20B(更快)' },
  ],
};

// ---------- 统一网络层 ----------
// callAI(provider, apiKey, {systemPrompt, userPrompt, maxTokens, model}) ->
//   Promise<{ok:true, text} | {ok:false, reason:'network'|'auth'|'timeout'|'parse'|'other', detail}>
// fetch/超时竞速/错误归类只在这一处实现,adapter 本身完全不碰网络。
const AI_CALL_TIMEOUT_MS = 15000;

function callAI(provider, apiKey, opts){
  const adapter = PROVIDER_ADAPTERS[provider];
  if(!adapter){
    return Promise.resolve({ ok:false, reason:'other', detail:'未知的AI提供商: '+provider });
  }
  let req;
  try{
    req = adapter.buildRequest(apiKey, opts||{});
  }catch(e){
    return Promise.resolve({ ok:false, reason:'other', detail:'构造请求失败: '+e.message });
  }
  const hasAbort = typeof AbortController !== 'undefined';
  const controller = hasAbort ? new AbortController() : null;
  const timeoutId = controller ? setTimeout(()=>controller.abort(), AI_CALL_TIMEOUT_MS) : null;
  return fetch(req.url, {
    method: 'POST',
    headers: req.headers,
    body: req.body,
    signal: controller ? controller.signal : undefined,
  }).then(res=>{
    if(timeoutId) clearTimeout(timeoutId);
    if(res.status===401 || res.status===403){
      return res.text().then(t=>({ ok:false, reason:'auth', detail:'密钥无效或无权限('+res.status+'): '+t.slice(0,200) }));
    }
    if(!res.ok){
      return res.text().then(t=>({ ok:false, reason:'other', detail:'HTTP '+res.status+': '+t.slice(0,200) }));
    }
    return res.json().then(json=>{
      try{
        const text = adapter.parseResponse(json);
        return { ok:true, text };
      }catch(e){
        return { ok:false, reason:'parse', detail:'响应解析失败: '+e.message };
      }
    }, e=>({ ok:false, reason:'parse', detail:'响应不是合法JSON: '+e.message }));
  }, e=>{
    if(timeoutId) clearTimeout(timeoutId);
    if(e && e.name==='AbortError'){
      return { ok:false, reason:'timeout', detail:'请求超时(超过 '+(AI_CALL_TIMEOUT_MS/1000)+' 秒)' };
    }
    return { ok:false, reason:'network', detail:'网络请求失败: '+(e && e.message || String(e)) };
  });
}

// ---------- 密钥询问弹窗 ----------
// showAiKeyModal(onDone) 渲染进 index.html 里静态占位的 #aiKeyModal(和 #confirmModal
// 同一套"fixed 遮罩 + 圆角卡片"结构,但内容形状不同——一段文字+确定/取消这个固定形状
// 是 showConfirm 的语义,这里是"密钥输入表单",所以不复用 showConfirm 本身,做法和
// confirmOwnOrSha 复用 #confirmModal 容器、但不复用 showConfirm 函数是同一个道理)。
//
// 弹窗关闭(不管走哪条路径——"确定"/"跳过"/点遮罩空白处)后统一做两件事:
// ①如果 currentG 存在,调 render(currentG) 让"AI机器人设置"状态按钮的文案刷新成最新
// 状态(这个弹窗本身不改变任何 g 字段,单靠 render(g) 的自然触发时机不会覆盖到它,
// 必须显式补一次,和 confirmAndPlay 确定/取消后都显式 render(currentG) 同一个道理);
// ②调用方传入的 onDone(如果有)——handleAddBotClick 用它接上"关掉弹窗之后再真正
// 调用 addBot()"这一步,renderAiStatusButton 的"仅供查看/修改配置"这种手动打开场景
// 不需要额外动作,不传 onDone 即可。
//
// 【为什么表单内部的输入/识别交互不走 render(g) 整体重绘】和第一阶段折叠面板版本
// 同一个原因:renderControls 每次调用都会先 c.innerHTML='' 整体清空再重建,如果输入框
// 的 input 事件处理器自己也去调 render(g),等于每敲一个字符就整体销毁重建一次
// #controls,新生成的 input 节点不会继承旧节点的焦点。所以表单内部的状态更新(重新
// 识别提供商、显示/隐藏手动选择下拉框、"确定"按钮的可点状态)全部走弹窗自己内部的
// 局部 DOM 操作,只有真正关闭弹窗那一刻才触发一次 render。
function showAiKeyModal(onDone){
  const m = document.getElementById('aiKeyModal');

  const wrap = document.createElement('div');
  wrap.className = 'ai-key-panel';

  const h3 = document.createElement('h3');
  h3.textContent = '接入 AI 机器人？(可选)';
  wrap.appendChild(h3);

  const label = document.createElement('label');
  label.textContent = 'AI 密钥';
  wrap.appendChild(label);

  const input = document.createElement('input');
  input.type = 'password';
  input.id = 'aiKeyInput';
  input.placeholder = '粘贴 Claude / OpenRouter / Groq 密钥,留空则机器人使用本地规则';
  input.autocomplete = 'off';
  input.value = aiApiKey;
  wrap.appendChild(input);

  const statusLine = document.createElement('div');
  statusLine.className = 'ai-key-status';
  wrap.appendChild(statusLine);

  const modelWrap = document.createElement('div');
  modelWrap.className = 'ai-model-picker';
  wrap.appendChild(modelWrap);

  const warn = document.createElement('div');
  warn.className = 'ai-key-warn';
  warn.textContent = '填入密钥后,本局全部AI机器人的调用费用由这把密钥的账户承担;'
    +'密钥仅保存在本标签页内存中,刷新或关闭页面即清空,不会写入房间数据、不会被其他玩家看到。';
  wrap.appendChild(warn);

  const btnRow = document.createElement('div');
  btnRow.className = 'ai-key-btns';

  const skipBtn = document.createElement('button');
  skipBtn.className = 'ghost';
  skipBtn.id = 'aiKeySkipBtn';
  skipBtn.textContent = '跳过,使用本地机器人';
  btnRow.appendChild(skipBtn);

  const saveBtn = document.createElement('button');
  saveBtn.className = 'primary';
  saveBtn.id = 'aiKeySaveBtn';
  saveBtn.textContent = '确定';
  btnRow.appendChild(saveBtn);

  wrap.appendChild(btnRow);

  function updateSaveBtnState(){
    // 已经填了字符、但还没解析出 provider(既没被自动识别、也没手动选择)时禁用
    // "确定"——防止"有密钥但不知道发给谁用"这种半成品状态被当作已配置好而结束弹窗。
    // 空字段时"确定"必须保持可点(效果上等同于跳过,见下面的 onclick),不能被这条
    // 规则误伤——判断条件因此是 aiApiKey && !aiProvider,而不是简单的 !aiProvider。
    saveBtn.disabled = !!(aiApiKey && !aiProvider);
  }

  // renderModelPicker:provider 确定之后才渲染的"选择模型"下拉框——没有 provider
  // (还没识别出来/还没手动选)时留空,不渲染任何内容。选项来自 AI_MODEL_OPTIONS[provider]
  // + 一个固定的"自定义"项(AI_MODEL_CUSTOM_VALUE)。默认选中态由 aiApiModel 当前值
  // 决定:①aiApiModel 匹配候选表里某一项 → 选中那一项;②aiApiModel 非空但不在候选表
  // 里(比如上次手动填过一个自定义ID)→ 选中"自定义"并把文本框预填这个值;③aiApiModel
  // 为空 → 选中候选表第一项(=该 provider 的内置默认档位)但不写入 aiApiModel——留空
  // 就是"不覆盖,交给 buildRequest 自己的默认值"这条既定语义,视觉上预选第一项只是让
  // 用户看得到"现在实际用的是哪个",不代表这个值已经被写进 aiApiModel。
  function renderModelPicker(){
    modelWrap.innerHTML = '';
    if(!aiProvider) return;
    const options = AI_MODEL_OPTIONS[aiProvider] || [];
    const label = document.createElement('label');
    label.textContent = '模型';
    label.style.cssText = 'margin-top:8px;';
    modelWrap.appendChild(label);

    const sel = document.createElement('select');
    sel.id = 'aiModelSelect';
    const knownIds = options.map(o=>o.id);
    const isCustom = !!aiApiModel && !knownIds.includes(aiApiModel);
    // aiApiModel 为空(!isCustom 且不匹配任何已知项)时,视觉上默认预选候选表第一项——
    // 这一项本来就等于该 provider 的内置默认档位(见文件顶部 AI_MODEL_OPTIONS 注释里
    // "第一项固定等于 buildRequest 硬编码默认值"这条约定),只是"预选"不等于"写入
    // aiApiModel",不选默认档位对应的 option.selected 也不会让 aiApiModel 变成非空。
    options.forEach((o,i)=>{
      const opt = document.createElement('option');
      opt.value = o.id; opt.textContent = o.label;
      if(aiApiModel===o.id || (!aiApiModel && i===0)) opt.selected = true;
      sel.appendChild(opt);
    });
    const optCustom = document.createElement('option');
    optCustom.value = AI_MODEL_CUSTOM_VALUE; optCustom.textContent = '自定义(手动输入模型ID)';
    if(isCustom) optCustom.selected = true;
    sel.appendChild(optCustom);
    modelWrap.appendChild(sel);

    const customInput = document.createElement('input');
    customInput.type = 'text';
    customInput.id = 'aiModelCustomInput';
    customInput.placeholder = '精确的模型ID,例如 openai/gpt-5.4-mini';
    customInput.autocomplete = 'off';
    // 统一用逐个属性直接赋值(不用 style.cssText 塞一整条字符串)——下面 sel.onchange
    // 切换显隐时用的就是这种写法,创建时的初始状态也保持同一种写法,不要混用两种方式
    // 表达同一件事。
    customInput.style.marginLeft = '8px';
    customInput.style.display = isCustom ? 'inline-block' : 'none';
    customInput.value = isCustom ? aiApiModel : '';
    modelWrap.appendChild(customInput);

    function commitCustomModel(){
      aiApiModel = customInput.value.trim();
      persistAiState();
    }
    customInput.addEventListener('input', commitCustomModel);
    customInput.addEventListener('blur', commitCustomModel);

    sel.onchange = ()=>{
      if(sel.value===AI_MODEL_CUSTOM_VALUE){
        customInput.style.display = 'inline-block';
        aiApiModel = customInput.value.trim(); // 可能是空字符串,commitCustomModel 会在用户真正输入后覆盖
      } else {
        customInput.style.display = 'none';
        customInput.value = '';
        aiApiModel = sel.value;
      }
      persistAiState();
    };

    const modelNote = document.createElement('div');
    modelNote.className = 'ai-key-warn';
    modelNote.style.cssText = 'margin-top:4px;';
    modelNote.textContent = '更强的模型通常更贵、单次决策也可能更慢——如果响应超过'
      +(AI_CALL_TIMEOUT_MS/1000)+'秒会自动回退到本地机器人规则,不会卡住游戏。';
    modelWrap.appendChild(modelNote);
  }

  function updateStatusLine(){
    statusLine.innerHTML = '';
    if(!aiApiKey){
      statusLine.textContent = '未填写密钥,机器人将使用本地规则(不产生任何费用)。';
      // 密钥清空时,provider 已经在 commitKey 里被清过了(见其注释);这里连带清空
      // 已选模型——避免密钥/提供商都清空了、却在 sessionStorage 里留一个不再对应
      // 任何provider的孤儿模型ID。
      aiApiModel = '';
      modelWrap.innerHTML = '';
    } else {
      const prevProvider = aiProvider;
      const detected = detectAiProvider(aiApiKey);
      if(detected){
        aiProvider = detected;
        statusLine.appendChild(document.createTextNode('已识别为 '+PROVIDER_ADAPTERS[detected].label));
      } else {
        statusLine.appendChild(document.createTextNode('未能自动识别密钥格式,请手动选择提供商:'));
        const sel = document.createElement('select');
        sel.id = 'aiProviderSelect';
        sel.style.cssText = 'margin-left:8px;';
        const optNone = document.createElement('option');
        optNone.value = ''; optNone.textContent = '请选择…';
        sel.appendChild(optNone);
        Object.keys(PROVIDER_ADAPTERS).forEach(key=>{
          const opt = document.createElement('option');
          opt.value = key; opt.textContent = PROVIDER_ADAPTERS[key].label;
          if(aiProvider===key) opt.selected = true;
          sel.appendChild(opt);
        });
        sel.onchange = ()=>{
          if(aiProvider!==sel.value) aiApiModel = '';
          aiProvider = sel.value || null;
          persistAiState();
          updateSaveBtnState();
          renderModelPicker();
        };
        statusLine.appendChild(sel);
      }
      // provider 真的发生了变化(不是同一个 provider 重复识别)才清空已选模型——避免
      // 把上一个 provider 的模型ID带进新 provider(两者的候选表/合法值域互不相通)。
      if(prevProvider!==aiProvider) aiApiModel = '';
    }
    renderModelPicker();
    updateSaveBtnState();
  }

  function commitKey(){
    aiApiKey = input.value;
    // 密钥被改空时同步清掉已识别/已选的 provider——避免"输入框已经清空,但上一次
    // 识别出的 provider 还残留着"这种和输入框内容对不上的半成品状态被"确定"接受。
    if(!aiApiKey) aiProvider = null;
    // 【顺序很重要】必须先 updateStatusLine()(它会把 aiProvider 从"未识别"更新成
    // detectAiProvider 算出的值)再 persistAiState()——反过来的话,单次 input 事件
    // (比如一次性粘贴完整密钥)写入 sessionStorage 时 aiProvider 还是上一轮的旧值,
    // 要等下一次 input/blur 才会追上,造成"填完一次却没存对"这种一次性写入不完整
    // 的假象。
    updateStatusLine();
    persistAiState();
  }
  // 【blur+input 双重保存兜底】用 input 事件(不是字面的 keydown)——keydown 在字符
  // 真正插入输入框之前就先触发,这一刻读 input.value 会读到"慢一拍"的旧值,粘贴/
  // 输入法候选字这类场景也未必逐字触发 keydown;input 事件在值真正变化后才触发,
  // 覆盖打字、粘贴、自动填充等全部输入方式,是这个"每次改动都立即保存"需求在技术上
  // 更准确的实现。blur 是第二层兜底,和 input 是同一份保存逻辑,重复调用无副作用。
  input.addEventListener('input', commitKey);
  input.addEventListener('blur', commitKey);

  function finish(){
    m.classList.add('hidden');
    m.innerHTML = '';
    m.onclick = null;
    if(typeof currentG!=='undefined' && currentG) render(currentG);
    if(typeof onDone==='function') onDone();
  }

  function doSkip(){
    // 显式清空——跳过必须真的是"不带任何密钥/不带任何已选模型",不能因为输入框/模型
    // 下拉框已经被操作过(被 input/onchange 事件顺手自动保存过)而在跳过之后仍然残留
    // 半打完的配置。
    input.value = '';
    aiApiKey = ''; aiProvider = null; aiApiModel = '';
    aiPromptDismissed = true;
    persistAiState();
    finish();
  }
  skipBtn.onclick = doSkip;

  saveBtn.onclick = ()=>{
    if(!aiApiKey){
      // 没填任何内容就点"确定",效果上等同于跳过——同样要标记为已回应过,否则这个
      // 会话内每次点"添加机器人"都会重新弹出这个空表单,达不到"以后不再询问"的效果。
      aiPromptDismissed = true;
      persistAiState();
    }
    finish();
  };

  updateStatusLine();
  m.innerHTML = '';
  m.appendChild(wrap);
  m.classList.remove('hidden');
  // 点遮罩空白处 == 跳过,和 #confirmModal 的既有惯例("点击外部视为放弃当前操作")一致。
  m.onclick = (e)=>{ if(e.target===m) doSkip(); };
}

// ---------- 常驻的"AI机器人设置"入口 ----------
// 由 render-controls.js 在 renderControls() 的大厅阶段(!g.started)、mySeat===0
// 分支里调用——和"添加/移除机器人"按钮同一个身份边界、同一次渲染,取代第一阶段那个
// 常驻展开的密钥输入面板。这颗按钮不受 aiPromptDismissed 影响、随时可点,覆盖"第一次
// 点了跳过,后来想加/想改密钥"这类需求——不需要靠重新触发一次"添加机器人"才能找到
// 配置入口。文案直接反映当前状态,不需要额外的状态提示区域。
function renderAiStatusButton(container){
  const btn = document.createElement('button');
  btn.className = 'ghost';
  btn.id = 'aiBotSettingsBtn';
  btn.textContent = (aiApiKey && aiProvider)
    ? 'AI机器人:'+PROVIDER_ADAPTERS[aiProvider].label+'(点击修改)'
    : 'AI机器人:未设置(点击配置)';
  btn.onclick = ()=>{ showAiKeyModal(); };
  container.appendChild(btn);
}

// ---------- "添加机器人"按钮的入口包装 ----------
// 替代 render-controls.js 原来直接绑定的 add.onclick=addBot——第一次点击时(这个会话
// 内还没有已保存的密钥、也没有点过跳过)先弹出密钥询问框,关闭后(不管填没填)再真正
// 调用 addBot();已经回应过一次(填了密钥,或点过跳过)之后,后续点击直接 addBot(),
// 不再重复打断。
function handleAddBotClick(){
  if(!aiApiKey && !aiPromptDismissed){
    showAiKeyModal(function(){ addBot(); });
  } else {
    addBot();
  }
}
