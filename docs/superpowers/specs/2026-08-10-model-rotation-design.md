# 多模型轮换（Model Rotation）设计文档

日期：2026-08-10
状态：已确认（用户逐节确认数据/轮换机制/UI/边界四节 + 默认勾选列表调整）
分支：main（开发），同步 wenwen_dev

## 一、需求背景

Groq 免费层各模型限额**按模型独立池计算**（org 管归属、模型管分池）：groq/compound(70K TPM/RPD 250)、llama-3.3-70b-versatile(12K/1K)、gpt-oss-120b(8K/1K)、qwen3.6-27b(8K/1K) 各自独立，撞了其中一个模型的 TPD/TPM 墙不影响其它模型。用户希望**输入密钥后默认选择多个模型、每次调用轮换使用**，撞 429 时根据返回的"Please try again in Xm Ys"在该模型限额解除前跳过它（冷却）。

## 二、数据与配置

| 项 | 方案 |
|---|---|
| `aiApiModels` | 数组（用户勾选的多模型），替代单选 `aiApiModel`（后者保留兼容：手动选了单模型就不轮换） |
| 默认勾选（groq 免费层，用户确认） | `groq/compound`、`llama-3.3-70b-versatile`、`openai/gpt-oss-120b`、`qwen/qwen3.6-27b` |
| 持久化 | sessionStorage 新 key（`AI_MODELS_STORAGE_KEY`）；**冷却状态不持久化**（会话内有效，刷新即重置） |
| 其它 provider | 不轮换（claude/openrouter 单模型照旧，`aiApiModel` 语义不变） |

## 三、轮换 + 冷却机制

### resolveAiModel(provider)
```
非 groq / aiApiModels 未配置（空数组）/ aiApiModel 手动选了单模型 → 返回 aiApiModel || undefined（原行为零变化）
groq 且多选 → 从 aiApiModels 按 round-robin 指针取"下一个未冷却"的模型
              全部冷却中 → 返回第一个（本次注定 429，走既有本地兜底）
返回模型 id（undefined = 用 adapter 默认档位）
```

- 调用点统一改 `model: aiApiModel || undefined` → `model: resolveAiModel(provider)`（bot-ai-bus.js 的 callAiChooseIndex / updateAiSummary 等 callAI 调用点）
- 模块级 `let _modelRotateIdx = 0`（round-robin 指针）+ `const _modelCooldowns = {}`（modelId → retryAt 时间戳）

### 429 冷却（callAI 的 !res.ok 分支增强）
- 识别 `res.status === 429` → 解析错误体正则 `/try again in (\d+)m([\d.]+)?s/` 拿秒数（解析失败默认 60s）→ 写 `_modelCooldowns[当前模型] = Date.now() + 秒数*1000` + `console.warn` 记录
- 冷却中的模型被 resolveAiModel 跳过；到点自动恢复
- 冷却表在会话内有效（不持久化）

## 四、UI

- 模型选择：单选下拉 → **复选列表**（checkbox，各 provider 分组）
- groq 默认勾选上述 4 模型；claude/openrouter 保持单选（现有多选不适用）
- 勾选写入 `aiApiModels`（sessionStorage）。优先级：手动单选（`aiApiModel` 非空）> 多选轮换（`aiApiModels` 非空且 `aiApiModel` 空）> 默认档位

## 五、边界

- 全部模型冷却中 → 本次调用注定失败 → 走既有本地兜底（不阻塞、不重试）
- 解析失败（报错格式变化）→ 默认 60s 冷却，保守但安全
- `aiApiModel` 旧值兼容：用户手动选过单模型（非空）→ 不轮换
- 轮换不改变 prompt/参数，只换 model 字段
- 冷却状态不持久化：刷新页面后所有模型恢复可用（重试周期重新开始）
- 其它 provider / 无密钥路径零变化（回归红线）

## 六、测试计划

- 新建 `run_model_rotation_test.js`（vm 沙箱 + mock fetch，仿 ai_model_picker 套件惯例）：
  1. resolveAiModel：非 groq 返回 undefined / aiApiModel 单选优先 / 多选轮换顺序正确（round-robin）
  2. 429 解析：mock fetch 返回 429 + "try again in 15m21s" → 冷却写入正确（retryAt 距今 ~921s）
  3. 冷却跳过：模型 A 冷却中 → resolveAiModel 跳过 A 选 B；全部冷却 → 返回第一个
  4. 恢复：冷却时间到（mock Date）→ 重新参与轮换
  5. 解析失败兜底：429 体不含时间 → 默认 60s
  6. 其它 provider / 无多选零变化回归
- 回归：`run_ai_model_picker_test.js`（模型选择 UI 改动相关）、`run_ai_test_button_test.js`、ai-bus 套件
- `?v=` 同步 +1

## 七、影响面

| 文件 | 改动 |
|---|---|
| `ai-bot.js` | `aiApiModels` 数组 + `resolveAiModel()` + 冷却表 + callAI 429 解析 + 模型选择 UI（单选→复选）+ sessionStorage key |
| `bot-ai-bus.js` | callAI 调用点 `model: aiApiModel` → `model: resolveAiModel(provider)` |
| `index.html` | `?v=` +1 |
| 测试 | 新 `run_model_rotation_test.js` + 既有套件回归 |
