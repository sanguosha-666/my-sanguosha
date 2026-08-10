# 聊天语音播报（Chat TTS）设计文档

日期：2026-08-10
状态：已确认（用户逐节确认数据流/性别声音/开关/影响面四节）
分支：main（2026-08-10 起只碰 main）

## 一、需求背景

用户要求"当有人发送聊天消息时，用语音念出来"。经 brainstorming 澄清，最终需求：

- **范围**：全部聊天消息都念（快捷语 + 手输文本），**emoji 表情不念**（TTS 读 emoji 易乱码/无声）。
- **播报形式**：**只念内容**（不念发送者名字），但**按发送角色性别选择声音**（男角色男声、女角色女声）。
- **自己发的也念**（统一处理，不排除自己）。
- **语音开关**：默认开，可静音，本地持久化。

## 二、数据流与触发

```
chatQuery.on('value')（room-lifecycle.js enterGame 内，聊天 Firebase 同步回调）
  → chatMessages = [{id, text, type, seat, playerName, general, ts}, ...]（已有）
  → 新消息检测：遍历消息，id 不在"已念集合"的才处理（去重，防同步重复触发）
  → type==='emoji' 跳过
  → 文本内容 + 发送者 gender → TTS 念内容
  → 把 id 加入已念集合
```

- **触发点**：`room-lifecycle.js` enterGame 里 `chatQuery.on('value')` 回调（chatMessages 更新处），在 `renderLogPanel(currentG)` 调用附近挂"新消息检测 + TTS"。聊天同步与渲染共用这一处，新消息检测在这里做最自然。
- **去重**：模块级 `Set`（已念消息 id）。每次 value 回调只念新增的；重进房间（enterGame 重新执行）时重置为空集合。
- **emoj 跳过**：`m.type==='emoji'` 直接不念。

## 三、性别声音（voice + pitch 组合）

- **性别来源**：消息的 `general` 字段 → `getGeneral(generalId).gender`（GENERALS 表已有 `gender:'male'/'female'`）。查不到（大厅未选将/脏数据）→ 默认男声。
- **选声**（函数 `pickChatVoice(gender)`）：
  1. 优先 `speechSynthesis.getVoices()` 里按名字关键词挑中文 voice——男：名字含 `male|男|zh-CN`；女：含 `female|女|Huihui|Xiaoxiao|Xiaoyi`。gender 匹配命中即用该 voice。
  2. 找不到对应 voice → 用任意中文 voice（或默认 voice），靠 **pitch** 区分：男 0.8 / 女 1.2。
- **播报**（函数 `speakChatMessage(text, gender)`）：
  ```js
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'zh-CN';
  u.voice = 选中的voice;  u.pitch = 按gender;
  window.speechSynthesis.cancel(); // 防排队堆积(复用 announceMyTurn 同款)
  window.speechSynthesis.speak(u);
  ```
  与 `announceMyTurn`（render.js）同款写法：`speechSynthesis in window` 守卫 + try/catch 静默失败 + `cancel()` 防堆积。

## 四、语音开关

- 模块级 `let chatVoiceEnabled = true;` + `localStorage` 持久化（key `sgs_chat_voice`，`'1'/'0'`）。
- 聊天面板输入区（render-log.js renderLogPanel 的 chat-compose）加一个小按钮 🔊/🔇（`toggleChatVoice()`），点击切换。
- 关闭时跳过 TTS（消息仍正常渲染）。

## 五、影响面与实现位置

| 文件 | 改动 |
|---|---|
| `render-log.js` | 新增：`chatVoiceEnabled`/已念集合/`toggleChatVoice()`/`speakChatMessage()`/`pickChatVoice()`/`detectAndSpeakNewChat()`；renderLogPanel 的 chat-compose 加 🔊/🔇 按钮 |
| `room-lifecycle.js` | `chatQuery.on('value')` 回调里调用 `detectAndSpeakNewChat(chatMessages)`（在 renderLogPanel 前或后均可） |

- 语音播放是客户端本地行为，**不写入 Firebase**（无持久化字段，normalize 无需改）。
- 其它文件零改动；`announceMyTurn` 不动（"轮到你了"保持原样）。

## 六、边界与已知决策

- **自动播放策略**：浏览器可能在玩家未交互前拒绝 TTS（不抛错、没声音）——聊天消息本身是"别人发的"（接收场景）通常已过交互手势；自己发的（发送场景）必有交互。不做额外手势处理（与 announceMyTurn 同一取舍）。
- **voice 列表异步加载**：`getVoices()` 首次可能为空（`voiceschanged` 事件后才填充）——`pickChatVoice` 在列表空时返回 null，`speakChatMessage` 用默认 voice + pitch 兜底，不阻塞。
- **60 字截断**：消息已有 `maxlength=60`，无需额外处理。
- **多消息连发**：`cancel()` 打断上一条，只念最新（防堆积，与 announceMyTurn 一致）。
- **已念集合上限**：会话内消息最多 80 条（limitToLast(80)），Set 不会无限增长，无需清理。

## 七、测试计划

- 新建 `run_chat_tts_test.js`（vm 沙箱，仿既有套件惯例，mock `window.speechSynthesis`）：
  1. 新消息触发：speak 被调用，参数文本 = 消息内容
  2. 去重：同一 id 出现两次只念一次
  3. emoji 跳过：type==='emoji' 不念
  4. 开关关闭：`toggleChatVoice()` 后不念
  5. gender 映射：male → pitch 0.8 / female → pitch 1.2（无 voice 列表 fallback）
  6. voice 选择：mock getVoices 返回中文男/女 voice 时选中正确 voice
- 回归：既有套件（render-log/room-lifecycle 改动相关：`run_ai_bus_info_test.js` 等）。
