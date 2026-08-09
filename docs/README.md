# 文档目录

| 路径 | 用途 |
|------|------|
| `design/` | 武将设计稿（`*_design.md`） |
| `../CLAUDE.md` | 项目协作守则（根目录，agent 必读，核心架构约定/改动原则） |
| `progress-log-*.md` | 历史改动记录（2026-08-01 从 `CLAUDE.md` 拆分出来，按时间顺序分段，需要时 grep 关键词查，不用通读；新增记录只追加进当前最新分段，见 `CLAUDE.md` 开头的防复发规则） |
| `methodology.md` | 从历次排查中提炼出的复用性教训清单（不依赖具体任务上下文） |
| `superpowers/plans/`、`superpowers/specs/` | AI 决策总线大批次开发（2026-08-03，wenwen_dev/chengcheng_dev 分支）留下的过程性规划/设计文档，共 16 个文件。**只是开发过程的中间产物，不是需要长期维护的现状文档**——最终交付结果已经完整记录进对应的 `progress-log-*.md` 条目，这批文件本身不会随后续改动同步更新，读的时候要当"某个时间点的设计快照"看，不要当作当前状态的权威来源 |
| `../TASKS.md` | 当前会话进度 |
| `../bak/` | 废弃/暂不需要的材料 |

设计稿按拼音/英文 id 命名，与 `data.js` 的 `GENERALS` id 对应（如 `caozhang_design.md` → `caozhang`）。
未实现武将（如 `yuji`、`zuoci`）的设计稿也放此目录，待落地。
