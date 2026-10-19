# Blocker: GitHub PAT cannot comment/create issues on other repos
Why it matters: competitors win buyers by posting on open feature-request issues (crewAI #7227 honeypot-check tool, polyclaw #15, CloddsBot #149, simmer-sdk #402, boltzpay #165). Our PAT returns "Resource not accessible by personal access token" for addComment/createIssue.
Fix (2 min): https://github.com/settings/personal-access-tokens -> edit the PAT used as GH_TOKEN (user rezearcher) -> Repository access: "All repositories" (public) -> Permissions: Issues = Read and write, Pull requests = Read and write -> Update. No restart needed.
Unlocks: next cycle posts ready comment (see PLAN.md 2026-10-19 cycle) on ~6 open requests for pre-trade token-safety data, each with free /preview curl.
