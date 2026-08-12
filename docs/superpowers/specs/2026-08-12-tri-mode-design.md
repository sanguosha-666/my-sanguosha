# tri 三密钥直连模式设计

日期：2026-08-12
状态：已确认

## 背景

项目已有 groq/cohere/cerebras 三个直连适配器 + hf 路由适配器。用户希望新增一个 **tri** 模式：一次性输入三个密钥（`cohere密钥/groq密钥/cerebras密钥`，斜杠分隔固定顺序），模型池、轮换策略参照 hf 模式（provider 优先级），但每次调用走各自的直连端点（不经 HF 路由）。reasoning 模型的处理复用各 adapter 已修好的 `reasoning_effort` 逻辑。

## 设计

### 1. 密钥输入与识别

- 一个输入框，格式 `cohere密钥/groq密钥/cerebras密钥`（斜杠分隔，固定顺序）
- `detectAiProvider`：识别到三斜杠段 → 返回 `'tri'`
- 三段宽松校验（能拆三段就接受，前缀不强校验）
- sessionStorage 存原始三斜杠字符串（`AI_MODEL_STORAGE_KEY` 类似的新 key）；内存按顺序拆三段：`triKeys = [cohereKey, groqKey, cerebrasKey]`

### 2. 模型池（合并池）

- 拉取三家模型列表（复用 `MODEL_LIST_API.cohere/groq/cerebras`）合并
- 条目 ID 用 `provider:模型ID` 格式区分归属（groq/cerebras 都有 gpt-oss-120b，必须能分辨）
- 显示 `提供商名：模型名`
- 合并后按 provider 分组排序（cerebras→groq→cohere 优先级序）

### 3. 默认勾选（DEFAULT_TRI_MODELS，共 10 个）

| 来源 | 模型 |
|---|---|
| groq（参考单独调用 6 个） | groq/compound、llama-3.3-70b-versatile、openai/gpt-oss-120b、qwen3.6-27b、openai/gpt-oss-20b、openai/gpt-oss-safeguard-20b |
| cerebras 全部 3 个 | zai-glm-4.7、gpt-oss-120b、gemma-4-31b |
| cohere 1 个 | command-a-plus-05-2026 |

### 4. 轮换（provider 优先级直连）

- 复用 `HF_PROVIDER_PRIORITY`（cerebras>groq>cohere）扫描选中池
- 冷却自动降级：cerebras 429 → groq → cohere
- 每次调用按条目 `provider:` 前缀选对应 adapter 的直连端点 + 对应段密钥
- `resolveAiModel('tri')` 返回 `{provider, model}` 结构（或编码成 `provider:模型ID` 字符串再在 callAI 层拆解）

### 5. reasoning 处理

- 复用各 adapter 已修好的 `reasoning_effort` 逻辑：
  - zai-glm-4.7 / command-a-reasoning → `'none'`
  - gpt-oss-120b → `'low'`
- 零新增逻辑，按选中的 adapter 自动生效

### 6. 失败路径

- 单次失败自动换下一个选中模型（复用 callAiChooseIndex 已有 rotating 循环）
- 全部失败 → 本地兜底

## 测试

- `run_model_rotation_test.js` 新增：tri 识别/拆段、合并池、provider 优先级轮换、冷却降级
- `run_ai_bus_core_test.js` 新增：tri 失败自动换下一个、reasoning_effort 透传
- `run_ai_model_picker_test.js` 新增：DEFAULT_TRI_MODELS、detectAiProvider tri 识别

## 实施范围

- `ai-bot.js`：detectAiProvider tri、PROVIDER_ADAPTERS.tri（或三 adapter 复用）、MODEL_LIST_API.tri（合并）、DEFAULT_TRI_MODELS、resolveAiModel tri 分支、UI renderModelPicker tri 多选
- `bot-ai-bus.js`：callAiChooseIndex rotating 判定加 tri
- 测试文件更新
- `index.html` ?v= bump
- `docs/progress-log-9.md` 记录
