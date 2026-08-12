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
// 模型不影响密钥/提供商这两件事的既有行为。bot-ai-bus.js 的 callAI 调用点统一传
// model: resolveAiModel(provider)——多模型轮换选实际模型,429 冷却依赖 opts.model。
let aiApiModel = '';

// ===== 多模型轮换(2026-08):groq 免费层各模型限额独立池(org×model),输入密钥后默认勾选
// 多模型、每次调用 round-robin 轮换,撞 429 时按响应冷却跳过该模型,绕过单模型 TPM/TPD 墙。
// 优先级:手动单选(aiApiModel 非空) > 多选轮换(aiApiModels 非空且 aiApiModel 空) > 默认档位。
const AI_MODELS_STORAGE_KEY = 'sgsAiModels';
// 默认勾选(groq 免费层独立池模型,用户确认;2026-08-11 补充:除既有 4 条外,再选中所有
// 20B 以上体积的模型——实测 groq 生产表 20B+ 共 5 个:gpt-oss-120b/llama-3.3-70b/
// gpt-oss-20b/gpt-oss-safeguard-20b/qwen3.6-27b,其中 gpt-oss-20b 与 safeguard-20b
// 是本次新加的,groq/compound 是路由系统保留作默认)。
const DEFAULT_GROQ_MODELS = ['groq/compound','llama-3.3-70b-versatile','openai/gpt-oss-120b','qwen/qwen3.6-27b','openai/gpt-oss-20b','openai/gpt-oss-safeguard-20b'];
// 默认勾选(hf:用户已在 HF 设置页给 groq/cohere/cerebras 各配了 custom key,id 自带
// :provider 后缀——选谁 HF 就路由到谁、服务端自动换 custom key,provider 直接计费,
// 不消耗 HF credits)。用户指定(2026-08-11):groq 全部 4 个 + cerebras 全部 3 个 +
// cohere command-a-reasoning-08-2025(用户原想用 command-a-plus-05-2026,但该模型
// 未注册到 HF,实测 /api/partners/cohere/models 无此映射,换成已注册的 reasoning 版)。
const DEFAULT_HF_MODELS = [
  'openai/gpt-oss-120b:groq',
  'openai/gpt-oss-20b:groq',
  'meta-llama/Llama-3.3-70B-Instruct:groq',
  'openai/gpt-oss-safeguard-20b:groq',
  'openai/gpt-oss-120b:cerebras',
  'google/gemma-4-31B-it:cerebras',
  'zai-org/GLM-4.7:cerebras',
  'CohereLabs/command-a-reasoning-08-2025:cohere',
];
let aiApiModels = [];
let _modelRotateIdx = 0;          // round-robin 指针
let _modelCooldowns = {};         // modelId → retryAt(时间戳);会话内有效,不持久化

// parseGroqRetrySeconds:从 429 错误体解析 "try again in Xm Ys",失败返回 null(调用方给默认)。
function parseGroqRetrySeconds(text){
  if(typeof text!=='string') return null;
  const m = text.match(/try again in (\d+)m([\d.]+)?s/);
  if(!m) return null;
  const sec = parseInt(m[1],10) * 60 + (m[2] ? Math.round(parseFloat(m[2])) : 0);
  return (Number.isFinite(sec) && sec>0) ? sec : null;
}
// HF_PROVIDER_PRIORITY:用户指定的 hf 轮换优先级(2026-08-11)——优先使用 cerebras,
// 其次 groq,再次 cohere。resolveAiModel 对 hf 按这个顺序扫描选中池,冷却中的 provider
// 自动跳过(降级到下一优先级);同 provider 内按勾选顺序取第一个未冷却的。
// 优先级数值越小越优先,未列出的 provider(理论上 hf 池不会出现)排最后。
const HF_PROVIDER_PRIORITY = { cerebras: 0, groq: 1, cohere: 2 };
function hfProviderOf(modelId){
  // 从 HF 模型条目 id 提取 provider:格式 {HF模型ID}:{provider}(如 openai/gpt-oss-120b:cerebras)。
  const idx = String(modelId||'').lastIndexOf(':');
  return idx>=0 ? String(modelId).slice(idx+1) : '';
}
// resolveAiModel:轮换选模型。非groq/hf/无多选/手动单选 → aiApiModel||undefined(零变化)。
// groq 与 hf 都走多选,但策略不同:groq 是"免费层各模型独立配额池"用 round-robin 均匀
// 分散绕过 TPD/TPM 墙;hf 是"用户在 HF 设置页给 groq/cohere/cerebras 各配了 custom key,
// 按用户指定的 provider 优先级选模型条目"(条目 id 自带 :provider 后缀,选谁就等于路由
// 到谁,HF 服务端自动换 custom key)。hf 不用 round-robin——用户要求固定优先级,
// 冷却降级天然实现"cerebras 挂了才用 groq、再挂才用 cohere"。
function resolveAiModel(provider){
  if(provider!=='groq' && provider!=='hf') return (typeof aiApiModel==='string' && aiApiModel) ? aiApiModel : undefined;
  if(typeof aiApiModel==='string' && aiApiModel) return aiApiModel;   // 手动单选优先
  const list = (Array.isArray(aiApiModels) && aiApiModels.length) ? aiApiModels : null;
  if(!list) return undefined;
  const now = Date.now();
  if(provider==='hf'){
    // hf 优先级策略:按 HF_PROVIDER_PRIORITY 顺序扫描,每次从头选最高优先级的未冷却模型。
    // 不记 round-robin 指针——"优先使用 cerebras"要求可用时永远选它,而不是轮流。
    const order = Object.keys(HF_PROVIDER_PRIORITY).sort(function(a,b){ return HF_PROVIDER_PRIORITY[a]-HF_PROVIDER_PRIORITY[b]; });
    for(let pi=0; pi<order.length; pi++){
      const prov = order[pi];
      for(let i=0;i<list.length;i++){
        const model = list[i];
        if(hfProviderOf(model) !== prov) continue;                    // 只要当前优先级的
        if(_modelCooldowns[model] && _modelCooldowns[model] > now) continue; // 冷却中跳过
        return model;
      }
    }
    // 全部冷却中 → 返回空串哨兵:调用点据此短路,不再发起注定失败的请求
    return '';
  }
  // groq:round-robin(免费层独立池,均匀分散)
  for(let i=0;i<list.length;i++){
    const idx = (_modelRotateIdx + i) % list.length;
    const model = list[idx];
    if(_modelCooldowns[model] && _modelCooldowns[model] > now) continue; // 冷却中跳过
    _modelRotateIdx = (idx + 1) % list.length; // 指针前进
    return model;
  }
  // 全部冷却中 → 返回空串哨兵:调用点据此短路,不再发起注定失败的请求
  // (此前返回 list[0] 会照发一次必失败的请求,浪费配额噪音;改后行为=直接本地兜底)
  return '';
}

// ===== AI托管(纯客户端本地状态,不写入Firebase) =====
// active:托管开关;seat:被托管的座位(当前浏览器玩家的 mySeat);records:本次托管期间
// 的决策记录(供信息窗展示,关闭弹窗不清空、刷新即丢)。
let aiTestAutopilot = { active:false, seat:null, records:[] };
let aiTestAutopilotDisconnectRef = null;

(function hydrateAiStateFromSession(){
  try{
    aiApiKey = sessionStorage.getItem(AI_KEY_STORAGE_KEY) || '';
    aiProvider = sessionStorage.getItem(AI_PROVIDER_STORAGE_KEY) || null;
    aiPromptDismissed = sessionStorage.getItem(AI_PROMPT_DISMISSED_STORAGE_KEY) === '1';
    aiApiModel = sessionStorage.getItem(AI_MODEL_STORAGE_KEY) || '';
    try{
      const rawModels = sessionStorage.getItem(AI_MODELS_STORAGE_KEY);
      aiApiModels = rawModels ? JSON.parse(rawModels) : [];
      if(!Array.isArray(aiApiModels)) aiApiModels = [];
    }catch(e){ aiApiModels = []; }
    // 【多模型轮换】groq 密钥下若用户从未配置过多选,默认勾选 DEFAULT_GROQ_MODELS;
    // hf 密钥下默认勾选 DEFAULT_HF_MODELS(三家各一,走 custom key 轮换)。
    // 都只在内存生效、不写 sessionStorage——默认值随列表改动自动跟进,见 renderModelPicker。
    if(aiProvider==='groq' && aiApiModels.length===0){
      aiApiModels = DEFAULT_GROQ_MODELS.slice();
    }
    if(aiProvider==='hf' && aiApiModels.length===0){
      aiApiModels = DEFAULT_HF_MODELS.slice();
    }
  }catch(e){
    // 隐私模式等场景下 sessionStorage 可能整体不可用——静默回退到空值,不影响
    // 本次会话内内存里正常使用,只是刷新后无法恢复(每次刷新都会重新弹一次询问框,
    // 这是这种环境下唯一的合理退化,不算 bug)。
    aiApiKey = ''; aiProvider = null; aiPromptDismissed = false; aiApiModel = ''; aiApiModels = [];
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
    if(Array.isArray(aiApiModels) && aiApiModels.length) sessionStorage.setItem(AI_MODELS_STORAGE_KEY, JSON.stringify(aiApiModels));
    else sessionStorage.removeItem(AI_MODELS_STORAGE_KEY);
  }catch(e){ /* 同上,静默忽略 */ }
}

// ---------- 密钥格式识别(纯函数) ----------
// Claude 密钥固定 sk-ant- 前缀(Anthropic 官方格式);OpenRouter 密钥固定 sk-or- 前缀;
// 密钥格式识别(纯函数):Claude 密钥固定 sk-ant- 前缀;OpenRouter 固定 sk-or-;
// Groq 固定 gsk_;HF 固定 hf_;Cohere 固定 co-(Trial key);Cerebras 固定 csk-
// (2026-08-11 用户确认,此前调研猜的 cerebras- 前缀一并保留兼容)。
// 各家前缀互不冲突,不需要考虑优先级顺序。空字符串返回 null(没填密钥不算任何
// provider);其余识别不出的密钥一律 fallback 到 cohere(2026-08-11 用户要求——
// "其他未被识别的密钥则分配到cohere",所以正常情况不再返回 null)。
function detectAiProvider(key){
  const k = (key||'').trim();
  if(!k) return null;
  if(/^sk-ant-/.test(k)) return 'claude';
  if(/^sk-or-/.test(k)) return 'openrouter';
  if(/^gsk_/.test(k)) return 'groq';
  if(/^hf_/.test(k)) return 'hf';
  if(/^co-/i.test(k)) return 'cohere';
  if(/^csk-/.test(k)) return 'cerebras';
  if(/^cerebras-/.test(k)) return 'cerebras';
  return 'cohere'; // 未识别 → 默认分配到 cohere(用户要求)
}

// ---------- Provider 适配层 ----------
// 每个 adapter 只负责两件事:①按自己的协议格式构造请求(url/headers/body,纯函数,
// 不发起网络请求)②从响应 JSON 里把纯文本抠出来。网络请求本身、超时、错误归类统一
// 收在下面的 callAI() 里,不在每个 adapter 里重复实现——以后新增 provider 只需要在
// 这里加一项,不需要碰 callAI。
const PROVIDER_ADAPTERS = {
  claude: {
    label: 'Claude',
    defaultModel: 'claude-haiku-4-5-20251001',
    endpoint: 'https://api.anthropic.com/v1/messages',
    buildRequest(apiKey, opts){
      const body = {
        model: opts.model || this.defaultModel,
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
    defaultModel: 'openai/gpt-4o-mini',
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
          model: opts.model || this.defaultModel,
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
    defaultModel: 'groq/compound',
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
          model: opts.model || this.defaultModel,
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
  hf: {
    // Hugging Face Inference Providers(router.huggingface.co):统一路由入口,一把 HF
    // token 覆盖 groq/cohere/cerebras/novita/together 等多家推理商。OpenAI 兼容格式,
    // 已实测(2026-08-11)支持浏览器直连 CORS(access-control-allow-origin: *),不需要
    // 像 Anthropic 那样的特殊 header。模型 ID 格式是 `{HF规范模型ID}:{provider}` 后缀,
    // 不是 `provider/模型名` 前缀(后者 404)——例如 openai/gpt-oss-120b:groq 走 groq、
    // :cerebras 走 cerebras、CohereLabs/c4ai-command-a-03-2025:cohere 走 cohere;
    // 不加后缀默认 :fastest(auto,同模型多 provider 时按健康状态自动 failover)。
    // 密钥:HF fine-grained token,创建时勾选 "Make calls to Inference Providers"
    // (inference.serverless.write),前缀 hf_。
    label: 'HF 推理路由(Groq/Cohere/Cerebras)',
    defaultModel: 'openai/gpt-oss-120b',
    endpoint: 'https://router.huggingface.co/v1/chat/completions',
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
          model: opts.model || this.defaultModel,
          max_tokens: opts.maxTokens || 512,
          messages,
        }),
      };
    },
    parseResponse(json){
      const msg = json && Array.isArray(json.choices) && json.choices[0] && json.choices[0].message;
      if(!msg || typeof msg.content !== 'string') throw new Error('未识别的 HF 响应结构');
      return msg.content;
    },
  },
  cohere: {
    // Cohere(api.cohere.com)直连吃 Trial 免费额度(1000 calls/月,注册即送无需绑卡)。
    // 已实测(2026-08-11)支持浏览器直连 CORS(原生 /v2/chat 与 OpenAI 兼容端点都返回
    // access-control-allow-origin: *)——实测带假 key 的 POST 响应也带 ACAO:*。
    // 用 OpenAI 兼容端点 api.cohere.com/compatibility/v1/chat/completions(适配器结构
    // 与 groq 一致),不是原生 /v2/chat(非 OpenAI 格式)。⚠️ 系统提示用 developer 角色
    // 而不是 system(Cohere 兼容端点的要求)。
    // 【reasoning 模型适配(2026-08-11, 第二次修复——上次没打在点上)】
    // command-a-reasoning-08-2025 是 hybrid reasoning 模型,**thinking 默认开启**:
    // 先输出大段英文思考链且与最终输出共享 max_tokens 预算,思考链吃光预算后响应
    // 在 finish_reason:"length" 截断、JSON 从未生成(托管记录两次实证:content 全是
    // "Okay, let's see..." 思考链,无任何 JSON)。response_format json_object 约束的
    // 是最终输出格式、管不到 thinking,所以上次的 json_object+max_tokens300 无效。
    // 【正解】Cohere 兼容端点官方文档明确支持 reasoning_effort:"none" 关闭 thinking
    // (等价于原生 API 的 thinking:disabled),关闭后模型就是普通 111B LLM、直接输出
    // 最终回答;对"从候选列表选 index"这种决策任务,思考链对输出 JSON 零价值,关闭
    // 纯省预算。max_tokens 下限提到 500(关闭 thinking 后足够 JSON + 理由)。
    label: 'Cohere(免费Trial)',
    defaultModel: 'command-a-03-2025',
    endpoint: 'https://api.cohere.com/compatibility/v1/chat/completions',
    buildRequest(apiKey, opts){
      const messages = [];
      if(opts.systemPrompt) messages.push({ role:'developer', content: opts.systemPrompt });
      messages.push({ role:'user', content: opts.userPrompt });
      return {
        url: this.endpoint,
        headers: {
          'content-type': 'application/json',
          'authorization': 'Bearer '+apiKey,
        },
        body: JSON.stringify({
          model: opts.model || this.defaultModel,
          max_tokens: Math.max(opts.maxTokens || 0, 500),
          messages,
          reasoning_effort: 'none',      // 关闭 thinking:reasoning 模型直接回答(关键修复)
          response_format: { type: 'json_object' },
        }),
      };
    },
    parseResponse(json){
      const msg = json && Array.isArray(json.choices) && json.choices[0] && json.choices[0].message;
      if(!msg || typeof msg.content !== 'string') throw new Error('未识别的 Cohere 响应结构');
      return msg.content;
    },
  },
  cerebras: {
    // Cerebras(api.cerebras.ai)直连。⚠️ 免费额度是 $5 一次性 credits(必须绑卡、30天
    // 过期),不是持续免费层——接入是满足"直连吃额度"的需求,实际是计费 API。已实测
    // CORS preflight 返回 200+ACAO:*(2026-08-11);成功路径有第三方生产实证(Big-AGI
    // 默认开启浏览器直连),真 key 复核过可用。OpenAI 兼容格式,适配器结构与 groq 一致。
    label: 'Cerebras(直连)',
    defaultModel: 'gpt-oss-120b',
    endpoint: 'https://api.cerebras.ai/v1/chat/completions',
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
          model: opts.model || this.defaultModel,
          max_tokens: opts.maxTokens || 512,
          messages,
        }),
      };
    },
    parseResponse(json){
      const msg = json && Array.isArray(json.choices) && json.choices[0] && json.choices[0].message;
      if(!msg || typeof msg.content !== 'string') throw new Error('未识别的 Cerebras 响应结构');
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
    { id: 'groq/compound', label: 'Groq Compound(默认)' },
    { id: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B(更强)' },
    { id: 'qwen/qwen3.6-27b', label: 'Qwen 3.6 27B(开源)' },
    { id: 'llama-3.1-8b-instant', label: 'Llama 3.1 8B(更快更省)' },
    { id: 'openai/gpt-oss-120b', label: 'GPT-OSS 120B(更强)' },
    { id: 'openai/gpt-oss-20b', label: 'GPT-OSS 20B(更快)' },
    { id: 'openai/gpt-oss-safeguard-20b', label: 'GPT-OSS Safeguard 20B' },
  ],
  hf: [
    // HF 模型 ID 格式: {HF规范模型ID}:{provider} 后缀(不是 provider 前缀!)。以下
    // 条目是 2026-08-11 从 https://router.huggingface.co/v1/models 实测快照里挑的
    // status=live 的真实模型,覆盖 groq/cohere/cerebras 三家。第一项=adapter 默认
    // openai/gpt-oss-120b(不加后缀=:fastest auto,同模型多 provider 自动 failover)。
    { id: 'openai/gpt-oss-120b', label: 'GPT-OSS 120B(默认·auto多商路由)' },
    { id: 'openai/gpt-oss-120b:groq', label: 'GPT-OSS 120B·Groq' },
    { id: 'openai/gpt-oss-120b:cerebras', label: 'GPT-OSS 120B·Cerebras' },
    { id: 'meta-llama/Llama-3.3-70B-Instruct:groq', label: 'Llama 3.3 70B·Groq' },
    { id: 'CohereLabs/c4ai-command-a-03-2025:cohere', label: 'Command A·Cohere' },
    { id: 'CohereLabs/c4ai-command-r7b-12-2024:cohere', label: 'Command R7B·Cohere' },
    { id: 'google/gemma-4-31B-it:cerebras', label: 'Gemma 4 31B·Cerebras' },
    { id: 'zai-org/GLM-4.7:cerebras', label: 'GLM-4.7·Cerebras' },
  ],
  cohere: [
    // Cohere 直连(吃 Trial 免费额度)。模型名是 Cohere 自家 ID(chat 端点认这个),
    // 不是 HF 的 CohereLabs/* 前缀。已从官方 models 文档核实(2026-08-11),列活跃
    // (live)模型;弃用别名(command-r/command-r-plus 无版本号等)不列。
    { id: 'command-a-plus-05-2026', label: 'Command A Plus(最新·最强)' },
    { id: 'command-a-03-2025', label: 'Command A(默认)' },
    { id: 'command-a-reasoning-08-2025', label: 'Command A Reasoning(推理)' },
    { id: 'command-a-vision-07-2025', label: 'Command A Vision(视觉)' },
    { id: 'command-a-translate-08-2025', label: 'Command A Translate(翻译)' },
    { id: 'command-r-plus-08-2024', label: 'Command R Plus' },
    { id: 'command-r7b-12-2024', label: 'Command R7B(更快更省)' },
    { id: 'command-r-08-2024', label: 'Command R' },
  ],
  cerebras: [
    // Cerebras 直连。模型名实测自 /public/v1/models(2026-08-11)。
    { id: 'gpt-oss-120b', label: 'GPT-OSS 120B(默认)' },
    { id: 'zai-glm-4.7', label: 'GLM-4.7' },
    { id: 'gemma-4-31b', label: 'Gemma 4 31B' },
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
      return res.text().then(t=>{
        if((provider==='groq'||provider==='hf') && opts && typeof opts.model==='string' && (res.status===429 || res.status===413)){
          // 429=限流(解析 retry_after);413=请求过大——该模型不适合当前输入规模,
          // 冷却 300s 固定值(解析不到 retry_after),两种都写 _modelCooldowns 让轮换跳过。
          // groq 与 hf 都接:groq 是免费层独立池、hf 是 custom key 路由,两家的 429/413
          // 都要让轮换知道"这个模型暂时不可用",否则下次又选它。
          const is413 = res.status===413;
          const sec = is413 ? null : parseGroqRetrySeconds(t);
          const coolSec = is413 ? 300 : (sec!==null ? sec : 60);
          const retryAt = Date.now() + (coolSec * 1000);
          _modelCooldowns[opts.model] = retryAt;
          console.warn('[AI] 模型 '+opts.model+' '+(is413?'请求过大(413)':'触发限流(429)')
            +',冷却 '+coolSec+'s(到 '+new Date(retryAt).toTimeString().slice(0,8)+')');
        }
        return { ok:false, reason:'other', detail:'HTTP '+res.status+': '+t.slice(0,200) };
      });
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

// ---------- 动态模型列表拉取(替代写死的候选表) ----------
// 每个 provider 的模型清单接口协议各不相同,按 provider 描述 url/headers/label 提取,
// 语义与 callAI 同一套"从不 reject"约定:未知 provider / fetch reject / 非 2xx /
// JSON 结构不符 / 超时一律 resolve null,由 renderModelPicker 回退到静态表
// AI_MODEL_OPTIONS(那张候选表保留作离线兜底,见其顶部注释)。
const AI_DEFAULT_MODEL = {
  // 单一来源=PROVIDER_ADAPTERS[x].defaultModel:默认档位只在各 adapter 的 defaultModel
  // 字段里维护(buildRequest 的 opts.model || this.defaultModel 同源读取),这里派生,
  // 不再双处写死;动态列表里匹配该项的模型追加「(默认)」,aiApiModel 为空时视觉预选它。
  // 测试用例钉死了三个 id,改 adapter 的 defaultModel 记得同步改测试。
  claude: PROVIDER_ADAPTERS.claude.defaultModel,
  openrouter: PROVIDER_ADAPTERS.openrouter.defaultModel,
  groq: PROVIDER_ADAPTERS.groq.defaultModel,
  hf: PROVIDER_ADAPTERS.hf.defaultModel,
  cohere: PROVIDER_ADAPTERS.cohere.defaultModel,
  cerebras: PROVIDER_ADAPTERS.cerebras.defaultModel,
};
// HF_PROVIDER_LABEL:HF router 的 provider 字符串(小写) → 显示名。只在 HF 模型列表
// 展开(entriesOf)里用,展示"提供商名：模型名"。目前只展示用户配置了 custom key 的
// groq/cohere/cerebras 三家;以后要加 provider 在这里补一行。
const HF_PROVIDER_LABEL = { groq:'Groq', cohere:'Cohere', cerebras:'Cerebras' };
const MODEL_LIST_API = {
  claude: {
    url: 'https://api.anthropic.com/v1/models?limit=1000',
    headers(apiKey){ return {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      // 与 messages 端点同规则:没有这个头浏览器直连会被拒,见 PROVIDER_ADAPTERS.claude
      'anthropic-dangerous-direct-browser-access': 'true',
    }; },
    labelOf(m){ return (m && (m.display_name || m.id)) || ''; },
  },
  openrouter: {
    url: 'https://openrouter.ai/api/v1/models', // 公开接口,不需要鉴权头
    headers(){ return {}; },
    labelOf(m){ return (m && (m.name || m.id)) || ''; },
  },
  groq: {
    url: 'https://api.groq.com/openai/v1/models',
    headers(apiKey){ return { 'authorization': 'Bearer ' + apiKey }; },
    labelOf(m){ return (m && m.id) || ''; },
  },
  hf: {
    // HF /v1/models 是公开接口(不需要鉴权头,实测 2026-08-11 返回全量列表,
    // 每项带 id/providers[].status)。返回的 id 是 HF 规范模型 ID(如 openai/gpt-oss-120b),
    // 不带 provider 后缀——轮换需要精确到"哪个 provider 跑这个模型",用 entriesOf 展开:
    // 同一个模型被多家服务(如 openai/gpt-oss-120b 同时有 groq/cerebras/novita...)时
    // 生成多条 {id: 'HF模型ID:provider', label: '提供商名：模型名'},并只保留用户
    // 关心的 groq/cohere/cerebras 三家 status=live 的条目(其余 provider 一律丢弃,
    // 避免列表被 novita/together 等一堆用不到的服务刷屏)。
    url: 'https://router.huggingface.co/v1/models?limit=1000',
    headers(){ return {}; },
    labelOf(m){ return (m && m.id) || ''; },
    // 只有 hf 用 entriesOf:响应结构是 {data:[{id, providers:[{provider,status}]}]},
    // 一个模型可能多家服务,展开成按 provider 拆开的条目;claude/openrouter/groq 的
    // 响应是平铺数组没有这个字段,自然走默认 labelOf 路径。
    entriesOf(json){
      const out = [];
      const want = { groq:1, cohere:1, cerebras:1 };
      (json && Array.isArray(json.data) ? json.data : []).forEach(function(m){
        const id = (m && m.id) || '';
        if(!id) return;
        (m.providers || []).forEach(function(p){
          if(!want[p.provider]) return;                    // 只保留三家
          if(p.status !== 'live') return;                  // 只保留可用
          const provLabel = HF_PROVIDER_LABEL[p.provider] || p.provider;
          out.push({ id: id + ':' + p.provider, label: provLabel + '：' + id });
        });
      });
      return out;
    },
  },
  cohere: {
    // Cohere 模型列表(2026-08-11 排查修复):原来用 /compatibility/v1/models 且不带
    // 认证头 → 必然 401 → 回退静态表(只有3个模型,用户看到"模型不全")。正确用法:
    // ①用原生 API GET /v1/models?endpoint=chat(官方文档定义,兼容端点没有稳定的
    // OpenAI 格式列表);②必须带 Bearer key(无 key 返回 401 "no api key supplied");
    // ③返回的是 Cohere 原生格式 {models:[{name,is_deprecated,...}]},不是 OpenAI 的
    // {data:[{id}]}——用 entriesOf 解析,过滤已弃用模型,id 取 name(与 chat/completions
    // 的 model 参数同一个名字)。模型列表请求也计入 trial 1000 calls/月,会话缓存已兜底。
    url: 'https://api.cohere.com/v1/models?endpoint=chat&page_size=100',
    headers(apiKey){ return { 'authorization': 'Bearer ' + apiKey }; },
    labelOf(m){ return (m && m.name) || ''; },
    entriesOf(json){
      return (json && Array.isArray(json.models) ? json.models : [])
        .filter(function(m){ return !m.is_deprecated; })
        .map(function(m){ return { id: (m && m.name) || '', label: (m && m.name) || '' }; })
        .filter(function(x){ return !!x.id; });
    },
  },
  cerebras: {
    // Cerebras 模型列表免认证 GET /public/v1/models(2026-08-11 实测),返回
    // {data:[{id,...}]} 平铺结构。
    url: 'https://api.cerebras.ai/public/v1/models',
    headers(){ return {}; },
    labelOf(m){ return (m && m.id) || ''; },
  },
};

// 模块级会话缓存:provider → {models, ts}。同一 provider 会话内只拉一次,之后弹窗
// 重开/输入密钥过程反复重渲染都直接命中;provider 切换因 key 不同自然不命中。
// OpenRouter 无鉴权、Claude/Groq 的密钥在会话内基本不变——刻意不按密钥区分缓存
// (保持简单,换密钥不重拉,任务说明已确认接受)。
const modelListCache = {};

// fetchProviderModels(provider, apiKey) -> Promise<Array<{id,label}> | null>
// null = 失败(不抛异常,与 callAI 同约定)。超时复用 AI_CALL_TIMEOUT_MS 的 15s
// AbortController 竞速模式。成功后结果写进 modelListCache,同 provider 第二次调用
// 直接命中缓存不再发请求。
function fetchProviderModels(provider, apiKey){
  const cached = modelListCache[provider];
  if(cached) return Promise.resolve(cached.models);
  const spec = MODEL_LIST_API[provider];
  if(!spec) return Promise.resolve(null);
  const hasAbort = typeof AbortController !== 'undefined';
  const controller = hasAbort ? new AbortController() : null;
  const timeoutId = controller ? setTimeout(function(){ controller.abort(); }, AI_CALL_TIMEOUT_MS) : null;
  return fetch(spec.url, {
    method: 'GET',
    headers: spec.headers(apiKey || ''),
    signal: controller ? controller.signal : undefined,
  }).then(function(res){
    if(timeoutId) clearTimeout(timeoutId);
    if(!res.ok) return null;
    return res.json().then(function(json){
      if(!json) return null;
      // 默认要求 OpenAI 平铺结构 data[];有 entriesOf 的 provider(如 hf/cohere)用
      // 自定义解析,可接受其它结构(cohere 原生格式是 models[],没有 data 数组)。
      if(!Array.isArray(json.data) && typeof spec.entriesOf!=='function') return null;
      // hf 用 entriesOf 展开(同一模型多家 provider 拆成多条);cohere 用它解析原生
      // models[] 结构;其余 provider 走默认 labelOf 平铺(OpenAI 格式 data[])。
      const models = (typeof spec.entriesOf==='function')
        ? spec.entriesOf(json)
        : json.data.map(function(m){
            return { id: (m && m.id) || '', label: spec.labelOf(m) };
          }).filter(function(x){ return !!x.id; });
      if(models.length) modelListCache[provider] = { models: models, ts: Date.now() };
      return models;
    }, function(){ return null; });
  }, function(){
    if(timeoutId) clearTimeout(timeoutId);
    return null;
  });
}

// ---------- 模型列表渲染(顶层可测函数) ----------
// renderModelPicker 把"搜索框 + 过滤按钮列表 + 自定义入口"这一整块抽成顶层函数,
// 便于 vm 测试直接调用(renderModelPicker 本身是 showAiKeyModal 的闭包,测试够不到)。
// opts = { selectedId, defaultValueId, onPick, multi, selectedIds }:
//   selectedId     —— 当前 aiApiModel(可能为空;为空时默认项视觉高亮但不写入,语义
//                     见 renderModelPicker 的注释,和旧版"预选第一项不写入"等价)
//   defaultValueId —— 该 provider 内置默认档位,匹配的项 label 追加「(默认)」
//   onPick(id, checked) —— 点击列表项/自定义项后的回调(单选:写入 aiApiModel +
//                     persistAiState;多选:写入 aiApiModels + persistAiState。
//                     checked 仅多选模式传:该次点击后该项是否处于选中态)
//   multi          —— true 时进入多选模式(groq 轮换用):点击项 toggle 进/出选集,
//                     高亮=在选集中,onPick 收到 toggle 结果;默认 false 保持单选行为
//   selectedIds    —— 多选模式下的当前选集(数组),用于初始高亮
// 搜索框的 input 事件只重建 #aiModelList 容器、不重建搜索框自身 → 打字不丢焦点;
// 点击选项后清空搜索框并重建列表,选中态高亮由内部 curSel/curSelSet 维护,
// 不依赖调用方重渲染。
function renderModelListInto(modelWrap, list, opts){
  opts = opts || {};
  const defaultValueId = opts.defaultValueId || null;
  const onPick = opts.onPick || function(){};
  const multi = !!opts.multi;
  let curSel = opts.selectedId || '';
  let curSelSet = new Set(Array.isArray(opts.selectedIds) ? opts.selectedIds : []);

  const searchInput = document.createElement('input');
  searchInput.type = 'text';
  searchInput.id = 'aiModelSearchInput';
  searchInput.className = 'ai-model-search';
  searchInput.placeholder = '搜索模型…';
  searchInput.autocomplete = 'off';
  modelWrap.appendChild(searchInput);

  const listWrap = document.createElement('div');
  listWrap.id = 'aiModelList';
  listWrap.className = 'ai-model-list';
  modelWrap.appendChild(listWrap);

  function renderList(){
    listWrap.innerHTML = '';
    const kw = (searchInput.value || '').trim();
    const shown = kw ? list.filter(function(m){
      return m.id.indexOf(kw) >= 0 || m.label.indexOf(kw) >= 0;
    }) : list;
    if(multi){
      // 多选模式(groq 轮换):点击 toggle 选集,高亮=在选集中
      shown.forEach(function(m){
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = m.label + (m.id === defaultValueId ? '(默认)' : '');
        const inSel = curSelSet.has(m.id);
        if(inSel) b.classList.add('selected');
        b.onclick = function(){
          searchInput.value = '';
          if(inSel) curSelSet.delete(m.id); else curSelSet.add(m.id);
          onPick(m.id, !inSel);
          renderList();
        };
        listWrap.appendChild(b);
      });
    } else {
      // 单选模式(claude/openrouter):既有逻辑一字不变
      const effectiveSel = curSel || defaultValueId;
      shown.forEach(function(m){
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = m.label + (m.id === defaultValueId ? '(默认)' : '');
        if(m.id === effectiveSel) b.classList.add('selected');
        b.onclick = function(){
          searchInput.value = '';
          curSel = m.id;
          onPick(m.id);
          renderList();
        };
        listWrap.appendChild(b);
      });
    }
    // 固定排在列表末尾的"自定义"入口:当前模型ID不在列表里(自定义遗留)时高亮。
    // 多选模式下仍是"手动单选"入口(写 aiApiModel,优先级高于轮换,见 resolveAiModel)。
    const isCustom = !!curSel && !list.some(function(m){ return m.id === curSel; });
    const customBtn = document.createElement('button');
    customBtn.type = 'button';
    customBtn.textContent = '自定义(手动输入模型ID)';
    if(isCustom) customBtn.classList.add('selected');
    customBtn.onclick = function(){
      searchInput.value = '';
      curSel = AI_MODEL_CUSTOM_VALUE;
      onPick(AI_MODEL_CUSTOM_VALUE);
      renderList();
    };
    listWrap.appendChild(customBtn);
  }

  searchInput.oninput = renderList;
  renderList();
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

  // 清除AI记忆按钮:主动清除入口(替代已移除的页面刷新警告)——只清记忆(本局 AI 自
  // 维护摘要),密钥/模型选择等配置不清;点击后弹窗不关闭,就地替换成"已清除"提示。
  const clearBtn = document.createElement('button');
  clearBtn.className = 'ghost';
  clearBtn.id = 'aiMemoryClearBtn';
  clearBtn.textContent = '清除AI记忆';
  clearBtn.onclick = function(){
    aiSummaryReset();          // 清空本局 AI 自维护摘要
    // 【未来扩展】若叠加了会话历史窗口(aiSessionHistory),同样在此清空
    const note = document.createElement('div');
    note.className = 'ai-key-warn';
    note.textContent = '已清除本局AI记忆。';
    clearBtn.replaceWith(note); // 就地替换成提示,不关闭弹窗
  };
  btnRow.appendChild(clearBtn);

  wrap.appendChild(btnRow);

  function updateSaveBtnState(){
    // 已经填了字符、但还没解析出 provider(既没被自动识别、也没手动选择)时禁用
    // "确定"——防止"有密钥但不知道发给谁用"这种半成品状态被当作已配置好而结束弹窗。
    // 空字段时"确定"必须保持可点(效果上等同于跳过,见下面的 onclick),不能被这条
    // 规则误伤——判断条件因此是 aiApiKey && !aiProvider,而不是简单的 !aiProvider。
    saveBtn.disabled = !!(aiApiKey && !aiProvider);
  }

  // renderModelPicker:provider 确定之后才渲染的"模型选择器"。数据源优先级:
  // modelListCache[provider](会话缓存)→ 拉取成功 → AI_MODEL_OPTIONS[provider]
  // 静态表回退(拉取失败)。选中态由 aiApiModel 当前值决定:①aiApiModel 匹配列表里
  // 某一项 → 那一项高亮;②aiApiModel 非空但不在列表里(自定义遗留)→ 显示自定义
  // 文本框并预填;③aiApiModel 为空 → 该 provider 内置默认档位视觉高亮但不写入——
  // 留空就是"不覆盖,交给 buildRequest 自己的默认值"这条既定语义(见 AI_DEFAULT_MODEL
  // 注释,和旧版"预选第一项不写入"等价)。列表本体渲染在顶层函数 renderModelListInto
  // (搜索框+过滤按钮+自定义项),这里只负责数据源选择和状态行。
  function renderModelPicker(){
    modelWrap.innerHTML = '';
    if(!aiProvider) return;
    const provider = aiProvider;
    // 【多模型轮换】groq 密钥下默认勾选免费层模型、hf 密钥下默认勾选三家 custom key
    // 模型(用户从未配置过多选时自动填入,只在内存生效、不写 sessionStorage——默认值随
    // DEFAULT_GROQ_MODELS/DEFAULT_HF_MODELS 改动自动跟进;用户主动勾选/取消勾选时由
    // onPick → persistAiState 持久化真实选择)。
    // 用户全部取消勾选后 aiApiModels 为空,下次进设置会恢复默认勾选——想彻底不用轮换
    // 可用自定义入口写手动单选(aiApiModel,优先级高于多选,见 resolveAiModel)。
    const defaultModels = (provider==='groq') ? DEFAULT_GROQ_MODELS : (provider==='hf' ? DEFAULT_HF_MODELS : null);
    if(defaultModels && (!Array.isArray(aiApiModels) || aiApiModels.length===0)){
      aiApiModels = defaultModels.slice();
    }

    const label = document.createElement('label');
    label.textContent = '模型';
    label.style.cssText = 'margin-top:8px;';
    modelWrap.appendChild(label);

    const statusNote = document.createElement('div');
    statusNote.id = 'aiModelStatusNote';
    statusNote.className = 'ai-key-warn';
    statusNote.style.cssText = 'margin-top:4px;';
    modelWrap.appendChild(statusNote);

    const isRotating = (provider==='groq' || provider==='hf');
    function applyList(list, fromFallback){
      statusNote.textContent = fromFallback ? '模型列表加载失败,使用内置列表' : ('共 ' + list.length + ' 个模型')
        + (isRotating ? ';勾选项按顺序轮换使用(429自动冷却跳过),想固定单模型请用自定义输入;自定义输入会退出轮换(点勾选恢复)' : '');
      // 自定义遗留(aiApiModel 非空且不在列表)→ 显示文本框并预填
      const isCustom = !!aiApiModel && !list.some(function(m){ return m.id === aiApiModel; });
      const customInput = document.createElement('input');
      customInput.type = 'text';
      customInput.id = 'aiModelCustomInput';
      customInput.placeholder = '精确的模型ID,例如 openai/gpt-5.4-mini';
      customInput.autocomplete = 'off';
      customInput.style.marginLeft = '8px';
      customInput.style.display = isCustom ? 'inline-block' : 'none';
      customInput.value = isCustom ? aiApiModel : '';
      function commitCustomModel(){
        aiApiModel = customInput.value.trim();
        persistAiState();
      }
      customInput.addEventListener('input', commitCustomModel);
      customInput.addEventListener('blur', commitCustomModel);
      // 先渲染搜索框+列表;自定义文本框跟在列表末尾的"自定义"按钮下方,超时提示垫底
      renderModelListInto(modelWrap, list, {
        selectedId: aiApiModel,
        selectedIds: isRotating ? aiApiModels : undefined,
        multi: isRotating,
        defaultValueId: AI_DEFAULT_MODEL[provider] || null,
        onPick: function(id, checked){
          if(id === AI_MODEL_CUSTOM_VALUE){
            customInput.style.display = 'inline-block';
            aiApiModel = customInput.value.trim(); // 可能是空字符串,commitCustomModel 会在用户真正输入后覆盖
          } else if(isRotating){
            // 多选 toggle:维护 aiApiModels(轮换池),并同时清空 aiApiModel——用户点勾选
            // 的意图就是回到轮换模式,否则自定义输入残留的 aiApiModel 会让 resolveAiModel
            // 手动单选优先,轮换静默失效(checked=本次点击后的选中态,由 renderModelListInto
            // 计算)。
            aiApiModel = '';
            const arr = Array.isArray(aiApiModels) ? aiApiModels.slice() : [];
            const i = arr.indexOf(id);
            if(checked){ if(i<0) arr.push(id); } else { if(i>=0) arr.splice(i,1); }
            aiApiModels = arr;
            customInput.style.display = 'none';
            customInput.value = '';
          } else {
            customInput.style.display = 'none';
            customInput.value = '';
            aiApiModel = id;
          }
          persistAiState();
        },
      });
      modelWrap.appendChild(customInput);
      const modelNote = document.createElement('div');
      modelNote.className = 'ai-key-warn';
      modelNote.style.cssText = 'margin-top:4px;';
      modelNote.textContent = '更强的模型通常更贵、单次决策也可能更慢——如果响应超过'
        +(AI_CALL_TIMEOUT_MS/1000)+'秒会自动回退到本地机器人规则,不会卡住游戏。';
      modelWrap.appendChild(modelNote);
    }

    // 数据源优先级:会话缓存 → 拉取成功 → 静态表 AI_MODEL_OPTIONS 回退
    const cached = modelListCache[provider];
    if(cached){
      applyList(cached.models, false);
    } else {
      statusNote.textContent = '加载模型列表…';
      fetchProviderModels(provider, aiApiKey).then(function(list){
        // 拉取期间 provider 可能又变了(输入框继续敲键)——这次结果已不属于当前
        // provider,丢弃即可;每次输入都会重新走这里,不会丢列表。
        if(aiProvider !== provider) return;
        if(list && list.length){
          applyList(list, false);
        } else {
          applyList(AI_MODEL_OPTIONS[provider] || [], true);
        }
      });
    }
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
      // aiApiModel 是手动单选、aiApiModels 是多选轮换池:groq 换 hf 时 groq 默认勾选的
      // 那几个模型(无 :provider 后缀)如果残留,会直接进 hf 的轮换池变成无效请求
      // (HF 只认带 :后缀的 id),所以两个都要清。
      if(prevProvider!==aiProvider){
        aiApiModel = '';
        aiApiModels = [];
      }
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

// ============================================================
// AI托管:开关 + 信息窗(渲染/拖动/调整大小)
// ============================================================
// 纯客户端本地功能:状态只存在本文件的 aiTestAutopilot(模块级 let),从不写入
// Firebase/g。游戏调度侧(bot.js)用 typeof aiTestAutopilot!=='undefined' 防御式
// 读取,本文件是 aiTestAutopilot 的全项目唯一定义点。

// 顶部机器人按钮只负责打开信息窗；开始/结束托管由信息窗底部两个明确按钮控制。
function toggleAiTestAutopilot(){
  openAiTestModal();
}
function startAiTestAutopilot(){
  if(aiTestAutopilot.active) return;
  if(typeof aiApiKey==='undefined' || !aiApiKey || !aiProvider){
    if(typeof showAiKeyModal==='function') showAiKeyModal();
    return;
  }
  aiTestAutopilot.active=true;
  aiTestAutopilot.seat=mySeat;
  publishAiTestAutopilot(true, mySeat);
  updateAiTestStatus();
  const btn=document.getElementById('aiTestBtn');
  if(btn) btn.classList.add('aitest-active');
}
function stopAiTestAutopilot(){
  const seat=aiTestAutopilot.seat;
  aiTestAutopilot.active=false;
  publishAiTestAutopilot(false, seat);
  updateAiTestStatus();
  const btn=document.getElementById('aiTestBtn');
  if(btn) btn.classList.remove('aitest-active');
}

// 房间里只公开“该座位是否托管”这一项。cid 校验保证当前浏览器只能修改自己的座位；
// 密钥、prompt、AI回复和记录仍保留在 aiTestAutopilot 本地对象中，绝不写入 Firebase。
function publishAiTestAutopilot(active, seat){
  if(!Number.isInteger(seat) || typeof tx!=='function') return;
  tx(function(g){
    const p=g && g.players && g.players[seat];
    if(!p || p.cid!==myClientId) return g;
    p.aiAutopilot=!!active;
    return g;
  });
  // 浏览器异常关闭或断线时自动撤掉公开标识，避免房间里永久显示“托管中”。
  if(aiTestAutopilotDisconnectRef && typeof aiTestAutopilotDisconnectRef.cancel==='function'){
    aiTestAutopilotDisconnectRef.cancel();
  }
  aiTestAutopilotDisconnectRef=null;
  if(active && gameRef && typeof gameRef.child==='function'){
    const ref=gameRef.child('players/'+seat+'/aiAutopilot');
    if(ref && typeof ref.onDisconnect==='function'){
      aiTestAutopilotDisconnectRef=ref.onDisconnect();
      if(aiTestAutopilotDisconnectRef && typeof aiTestAutopilotDisconnectRef.set==='function'){
        aiTestAutopilotDisconnectRef.set(false);
      }
    }
  }
}
function updateAiTestStatus(){
  const el=document.getElementById('aiTestStatus');
  if(el) el.textContent = aiTestAutopilot.active ? ('托管中·座位'+aiTestAutopilot.seat) : '未托管';
  const startBtn=document.getElementById('aiTestStartBtn');
  const stopBtn=document.getElementById('aiTestStopBtn');
  if(startBtn) startBtn.disabled=aiTestAutopilot.active;
  if(stopBtn) stopBtn.disabled=!aiTestAutopilot.active;
  syncAiTestSeatBadge();
}

// 开始/结束托管不会修改 Firebase 游戏状态，也不一定触发 render；直接同步座位卡角标，
// 让按钮操作后立即得到视觉反馈。后续正常 render 时 renderSeatCard 也会按同一状态重建。
function syncAiTestSeatBadge(){
  if(!Number.isInteger(aiTestAutopilot.seat)) return;
  const seatEl=document.querySelector('.seat[data-seat="'+aiTestAutopilot.seat+'"]');
  if(!seatEl) return;
  const oldBadge=seatEl.querySelector('.seat-autopilot-badge');
  if(oldBadge) oldBadge.remove();
  seatEl.classList.remove('autopilot');
  // 这里只即时更新自己的座位；其他玩家的公开标识由 Firebase render 维护，不能误删。
  if(!aiTestAutopilot.active) return;
  const badge=document.createElement('div');
  badge.className='seat-autopilot-badge';
  badge.title='AI托管中';
  badge.setAttribute('aria-label','AI托管中');
  badge.innerHTML='<span class="seat-autopilot-robot">🤖</span>'
    +'<span class="seat-autopilot-lazy">在偷懒</span>';
  seatEl.classList.add('autopilot');
  seatEl.appendChild(badge);
}

function openAiTestModal(){
  const m=document.getElementById('aiTestModal');
  if(!m) return;
  m.classList.remove('hidden');
  const p=m.querySelector('.aitest-panel');
  if(p) p.onclick=(e)=>e.stopPropagation();
  renderAiTestRecords();
}
function closeAiTestModal(){
  const m=document.getElementById('aiTestModal');
  if(m) m.classList.add('hidden');
}
function renderAiTestRecords(){
  const body=document.getElementById('aiTestBody');
  if(!body) return;
  body.innerHTML = aiTestAutopilot.records.map(recordHtml).join('');
}
// recordHtml:单条记录的完整 HTML(摘要行 + 详情区)。索引来自 records 数组位置,
// 与 DOM 中 data-idx 一致,供 toggleAiTestRecord / aiTestFillPendingRecord 定位。
function recordHtml(rec, i){
  return '<div class="aitest-record">'
    +'<div class="aitest-record-summary" onclick="toggleAiTestRecord('+i+')">'
    +'<span class="aitest-arrow">▸</span><b>'+escapeHtml(rec.time)+'</b>'
    +'<span>['+escapeHtml(rec.phaseLabel)+']</span><span>'+escapeHtml(rec.summary)+'</span>'
    +'</div>'
    +recordDetailHtml(rec, i)
    +'</div>';
}
// recordDetailHtml:单条记录的详情区 HTML(默认折叠)。回填时只替换这一小段 DOM,
// 不动其它记录节点——窗口滚动位置、已展开的其它记录全部保持原样。
function recordDetailHtml(rec, i){
  return '<div class="aitest-record-detail hidden" data-idx="'+i+'">'
    +'<div class="aitest-sec">① AI获取的信息</div><pre>'+escapeHtml(rec.stateInfo)+'</pre>'
    +(rec.prompt ? '<div class="aitest-sec">发送的Prompt</div><pre>'+escapeHtml(rec.prompt)+'</pre>' : '')
    +'<div class="aitest-sec">② AI返回的信息</div><pre>'+escapeHtml(rec.rawResponse || '(无)')+'</pre>'
    +'<div class="aitest-sec">解析choice</div><div>'+(rec.choice===null?'(无动作/本地兜底)':escapeHtml(String(rec.choice)))+'</div>'
    +'<div class="aitest-sec">③ 理由</div><div>'+escapeHtml(rec.reason || '(无)')+'</div>'
    +'</div>';
}
function toggleAiTestRecord(idx){
  const el=document.querySelector('.aitest-record-detail[data-idx="'+idx+'"]');
  if(!el) return;
  el.classList.toggle('hidden');
}
function clearAiTestRecords(){
  aiTestAutopilot.records = [];
  aiTestPendingRecord = null;
  renderAiTestRecords();
}
let aiTestLastObservedPhase = null;
function syncAiTestGamePhase(phase){
  if(phase==='over' && aiTestLastObservedPhase!=='over'){
    clearAiTestRecords();
    if(aiTestAutopilot.active) stopAiTestAutopilot();
  }
  aiTestLastObservedPhase=phase;
}
// appendAiTestRecord:每次托管决策完成后追加一条记录。增量插入单条 DOM、不整窗重建
// innerHTML——整窗重建会把已展开的详情全部收起、滚动位置重置回顶部;增量插入只动
// 新记录自己的节点,其余原样。
function appendAiTestRecord(rec){
  aiTestAutopilot.records.push(rec);
  const body=document.getElementById('aiTestBody');
  const m=document.getElementById('aiTestModal');
  if(!body || (m && m.classList.contains('hidden'))) return;
  body.insertAdjacentHTML('beforeend', recordHtml(rec, aiTestAutopilot.records.length-1));
}

// aiTestPendingRecord:最近一次由 aiTestDecisionHook 建立的"待回填"骨架记录。
// 骨架记录创建于 runBotDecision 决策分支执行前(此时本次 AI 调用尚未发生,prompt/
// rawResponse/choice/reason 都还没数据);等 callAiChooseIndex 解析完成后,经
// aiTestFillPendingRecord 回填本次真实数据。模块级变量,和 aiTestAutopilot 同一生命周期。
let aiTestPendingRecord = null;
// aiTestDecisionHook:托管决策采集钩子。只建立"骨架记录"(时间/阶段/状态快照/摘要),
// prompt/rawResponse/choice/reason 留待 callAiChooseIndex 解析完成后回填——
// 绝不在决策前读 aiTestLastCall/aiTestLastReason(那是上一条决策的缓存,读了会把上一条
// AI 数据错贴到本条记录,多条记录重复显示同一内容)。
function aiTestDecisionHook(g, seat, info){
  try{
    if(typeof info!=='object' || !info) return;
    if(typeof aiTestAutopilot==='undefined' || !aiTestAutopilot) return;
    // phaseName 是 render.js 里 render() 的局部 const,这里拿不到中文名,直接用原始
    // phase 字符串(信息窗里展示英文 phase 已足够定位阶段)。
    const phaseLabel = (g && g.phase) || '';
    const stateInfo = (typeof buildBotVisibleState==='function')
      ? JSON.stringify(buildBotVisibleState(g, seat)) : '';
    aiTestPendingRecord = {
      time: (typeof debugLogIsoTime==='function')
        ? debugLogIsoTime(Date.now()) : new Date().toTimeString().slice(0,8),
      phaseLabel: phaseLabel,
      summary: info.summary || ('决策(' + (g && g.phase) + ')'),
      stateInfo: stateInfo,
      prompt: '',
      rawResponse: '',
      choice: null,
      reason: null
    };
    appendAiTestRecord(aiTestPendingRecord);
  }catch(e){ /* 静默:采集失败不影响决策主流程 */ }
}
// aiTestFillPendingRecord:callAiChooseIndex 托管命中解析完成后调用,把本次 AI 调用的
// 真实数据(prompt/rawResponse/choice/reason)回填进"最后一条待回填骨架记录"。
// 骨架记录被多次决策先后建立时,只回填最近一条;回填后置 null 防重复/防残留。
function aiTestFillPendingRecord(fields){
  try{
    if(!aiTestPendingRecord) return;
    if(fields){
      if(fields.prompt!==undefined) aiTestPendingRecord.prompt = fields.prompt;
      if(fields.rawResponse!==undefined) aiTestPendingRecord.rawResponse = fields.rawResponse;
      if(fields.choice!==undefined) aiTestPendingRecord.choice = fields.choice;
      if(fields.reason!==undefined) aiTestPendingRecord.reason = fields.reason;
    }
    const idx = aiTestAutopilot.records.indexOf(aiTestPendingRecord);
    aiTestPendingRecord = null;
    const m=document.getElementById('aiTestModal');
    if(!m || m.classList.contains('hidden') || idx<0) return;
    const det = m.querySelector('.aitest-record-detail[data-idx="'+idx+'"]');
    if(!det) return;
    // 只替换这一条记录的详情区,保留其它记录节点与滚动位置;替换前记住展开状态,
    // 用户正点开看着的这条记录回填后保持展开(内容实时可见)。
    const wasOpen = !det.classList.contains('hidden');
    det.outerHTML = recordDetailHtml(aiTestAutopilot.records[idx], idx);
    if(wasOpen){
      const nd = m.querySelector('.aitest-record-detail[data-idx="'+idx+'"]');
      if(nd) nd.classList.remove('hidden');
    }
  }catch(e){ /* 静默:回填失败不影响决策主流程 */ }
}

// 拖动:header mousedown/mousemove 更新 left/top;resize:右下角手柄更新 width/height。
// 桌面 mouse 事件;触屏依赖浏览器合成 mouse 序列(体验可接受,测试工具场景)。
(function initAiTestModalDrag(){
  if(typeof document==='undefined'||!document.addEventListener) return;
  document.addEventListener('mousedown', function(e){
    const hd=e.target && e.target.closest ? e.target.closest('.aitest-header') : null;
    if(!hd) return;
    const m=document.getElementById('aiTestModal');
    if(!m || m.classList.contains('hidden')) return;
    e.preventDefault();
    const sx=e.clientX, sy=e.clientY, ox=m.offsetLeft, oy=m.offsetTop;
    function move(ev){
      m.style.left=Math.max(0, ox+ev.clientX-sx)+'px';
      m.style.top=Math.max(0, oy+ev.clientY-sy)+'px';
      m.style.right='auto'; m.style.bottom='auto';
    }
    function up(){
      document.removeEventListener('mousemove',move);
      document.removeEventListener('mouseup',up);
    }
    document.addEventListener('mousemove',move);
    document.addEventListener('mouseup',up);
  });
  document.addEventListener('mousedown', function(e){
    const hd=e.target && e.target.closest ? e.target.closest('.aitest-resize-handle') : null;
    if(!hd) return;
    const m=document.getElementById('aiTestModal');
    if(!m || m.classList.contains('hidden')) return;
    e.preventDefault(); e.stopPropagation();
    const sx=e.clientX, sy=e.clientY, ow=m.offsetWidth, oh=m.offsetHeight;
    function move(ev){
      m.style.width=Math.max(280, ow+ev.clientX-sx)+'px';
      m.style.height=Math.max(200, oh+ev.clientY-sy)+'px';
    }
    function up(){
      document.removeEventListener('mousemove',move);
      document.removeEventListener('mouseup',up);
    }
    document.addEventListener('mousemove',move);
    document.addEventListener('mouseup',up);
  });
})();

