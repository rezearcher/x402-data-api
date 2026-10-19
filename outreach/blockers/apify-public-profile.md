# Apify actor can't go public (needs public profile)
Actor grey-ridge-base-onchain (id OPrriAiWxVnYxHgmw, user boon_polypody) PUT isPublic=true -> "username-required: owner needs a public profile". Profile can't be edited via API.
Fix (Rez, 2 min): console.apify.com -> Settings -> Account -> Public profile: set name/bio, enable. Then the loop re-runs the PUT in outreach/blockers/apify-public-profile.md (curl PUT /v2/acts/OPrriAiWxVnYxHgmw {"isPublic":true,"categories":["DEVELOPER_TOOLS","OTHER"],"seoTitle":"Base token safety check & on-chain data API"}).
Unlocks: Apify Store = human dev discovery surface none of our x402 directories reach.
