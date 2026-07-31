# 文档目录

| 路径 | 用途 |
|------|------|
| `design/` | 武将设计稿（`*_design.md`） |
| `../CLAUDE.md` | 项目协作守则（根目录，agent 必读，核心架构约定/改动原则） |
| `progress-log-*.md` | 历史改动记录（2026-08-01 从 `CLAUDE.md` 拆分出来，按时间顺序分段，需要时 grep 关键词查，不用通读；新增记录只追加进当前最新分段，见 `CLAUDE.md` 开头的防复发规则） |
| `methodology.md` | 从历次排查中提炼出的复用性教训清单（不依赖具体任务上下文） |
| `../TASKS.md` | 当前会话进度 |
| `../bak/` | 废弃/暂不需要的材料 |

设计稿按拼音/英文 id 命名，与 `data.js` 的 `GENERALS` id 对应（如 `caozhang_design.md` → `caozhang`）。
未实现武将（如 `yuji`、`zuoci`）的设计稿也放此目录，待落地。
