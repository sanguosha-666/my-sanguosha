# Project Working Rules

- Project root: `D:\Codex\my-sanguosha`.
- Preserve the existing vanilla HTML/JavaScript structure and coding style.
- Keep changes limited to the current task; do not refactor unrelated game code.
- Do not discard uncommitted user changes.
- Review relevant files before editing, then inspect the diff and run proportionate checks.
- Do not push, deploy, or change remote state unless the user explicitly requests it.

## External Text File Encoding

- Treat externally supplied Markdown and other text files as UTF-8 unless the user specifies another encoding.
- On Windows PowerShell, always read external text with an explicit UTF-8 encoding, for example: `Get-Content -Raw -Encoding UTF8 -LiteralPath <path>`; do not rely on the shell's default encoding.
- Preserve UTF-8 when copying external text into the repository.
- After writing, read the destination again as UTF-8 and scan for common mojibake indicators, including the characters represented by Unicode code points `U+8B5B`, `U+873F`, and `U+879F`.
- If the encoding check fails, stop before committing, pushing, or creating GitHub Issues, and correct the file first.

## Bug Management

- GitHub Issues are the single source of truth for bugs; do not maintain a duplicate bug list in repository Markdown files.
- Each `CORE-xx` identifier must map to exactly one GitHub Issue; never combine multiple CORE identifiers in one Issue.
- Keep related CORE Issues separate and express their relationship with `Related: #<issue-number>` in each Issue body.
- Start every CORE Issue body with explicit `编号`, `优先度`, `严重程度`, and `可信度` fields; do not rely on the title or labels as the only record of priority or severity.
- Start every bug Issue title with exactly one primary module and its priority, using `[AI|GAME|UI][P0|P1|P2] Bug标题`; no other first-level modules are allowed.
- Classify by the domain of the primary fixer: `AI` for model/provider/API/bot decision/request/fallback behavior, `GAME` for rules/cards/skills/damage/turns/pending/state/room game state, and `UI` for display/buttons/dialogs/rendering/animation/interaction/prompts/layout.
- Keep finer classifications in the Issue body or labels; the title's module segment must contain only `AI`, `GAME`, or `UI`.
- Before fixing a bug, read only the target Issue unless broader triage is explicitly requested.
- Use `Fixes #<issue-number>` in the fixing commit when automatic closure is intended.
- Do not create, edit, close, or delete Issues unless the user explicitly requests it.
