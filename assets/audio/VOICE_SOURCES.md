# Skill voice sources

The skill-name clips in this batch were generated with Microsoft Edge online neural voices:

- Male generals: `zh-CN-YunyangNeural` (professional Chinese news voice).
- Female generals: `zh-CN-XiaoxiaoNeural` (warm Chinese news voice).

Each clip contains only its skill name. No music, ambient sound, crowd sound, voice conversion, or cloned personal voice is used.

Generated files cover every skill currently listed by the existing generals and every extra skill emitted through `markSkillSound` in `game.js` and `skills.js`. Skills without a discrete activation event keep their audio ready but are not forced to play during continuous rule checks. The legacy `qiaomeng` event and its displayed name `趫猛` intentionally share `qiaomeng.mp3`.
