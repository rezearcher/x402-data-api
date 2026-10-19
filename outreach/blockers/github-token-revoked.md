# GitHub tokens revoked (found 2026-10-19 22:40Z)
Both GH_TOKEN and GH_TOKEN_CLASSIC in ~/.hermes/.env return 401 "Bad credentials" (api.github.com/user); `git push` fails; gh auth status says invalid.
Effect: no GitHub pitch issues, no reply-sensor polling of issues, no pushes (commits stay local).
Fix (Rez, ~2 min): github.com/settings/tokens -> generate classic token (scopes: repo, public_repo), then replace BOTH GH_TOKEN= and GH_TOKEN_CLASSIC= lines in ~/.hermes/.env. Likely GitHub auto-revoked it (token leaked in a pushed file?) - check `git grep ghp_` in repos if a notice email arrived.
Why it unlocks money: GH issues are the main channel producing integrator replies (Krystian-type threads).
RESOLVED 2026-10-19T22:43:58Z: tokens rotated into 1Password (op://Division/GH_TOKEN_CLASSIC); verified 200. Use: . ~/.config/greyridge/op.env; op read op://Division/GH_TOKEN_CLASSIC/credential. Push with git -c credential.helper= push https://x-access-token:$T@github.com/rezearcher/x402-data-api.git main
