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
