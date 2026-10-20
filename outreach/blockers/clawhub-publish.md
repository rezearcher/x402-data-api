# Publish greyridge-token-safety skill to ClawHub (OpenClaw registry)
Why: OpenClaw users discover skills only via clawhub.ai; our rival true402 ships an OpenClaw skill. Skill is ready: https://github.com/rezearcher/greyridge-token-safety-skill (SKILL.md).
Steps: 1) `npx clawhub login` (GitHub OAuth in browser as rezearcher). 2) `git clone https://github.com/rezearcher/greyridge-token-safety-skill && cd greyridge-token-safety-skill && npx clawhub publish .` 
Note: awesome-openclaw-skills bans crypto/DeFi skills and brand-new skills; ClawHub listing itself is still the discovery surface.
