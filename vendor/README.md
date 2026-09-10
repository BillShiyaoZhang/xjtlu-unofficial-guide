# Fixed Platform Artifacts

These are npm-pack distributions, not copied platform source maintained by this consumer. Update them only after contract and consumer tests pass. `package-lock.json` pins their integrity.

| Package | SHA-256 |
| --- | --- |
| information-community-core-0.2.0.tgz | 6A7F216BAC199061FA1507F1D8D62606CE947AA95F5AC2D4E0E129B9E17DDD96 |
| information-community-runtime-0.2.0.tgz | 29B0852EB9EA602DDC82AE5B7F2F9E48FFCEBAF3C4A54B9771ABD3E9F7FC665E |
| information-community-runtime-0.3.0.tgz | CD4024B157B59107F12C678804A620D8A7190FB17A2EA05BEC20844724F55D69 |
| information-community-core-0.3.0.tgz | 7C35DBE10CC747999D4459F8EBDD5C467394EDCA0E3AB5AE9E68EA1E4EF3B330 |
| information-community-runtime-0.3.0-branches.tgz | A1370E0C4048E2C78D524659905D466F7A38DF3B4ED3F758107073AE46EE518F |

The active dependencies are core **0.3.0** and runtime **0.3.0**, copied on
2026-09-10 from upstream's existing npm-pack artifacts. These branch-support
artifacts were generated from an **uncommitted working tree** based on
[`0d0661790b77380fa29497c80e639013745debc3`](https://github.com/BillShiyaoZhang/decentralized-information-community/commit/0d0661790b77380fa29497c80e639013745debc3),
not from that commit alone or a formal release. All 6 core files and all 18 runtime
files in the archives were compared byte-for-byte with that upstream working tree
before installation. Both include upstream LICENSE files.

Core adds the public `buildBranchTree`, `branchPath`, and `visibleBranchRows` APIs;
Graph / Change schemaVersion remains 1. The runtime archive differs from the
historical 0.3.0 package below only in its package manifest and README: its core
dependency changes from `0.2.0` to `0.2.x || 0.3.x`. Its consumer filename includes
`-branches` to distinguish it from the existing same-version artifact. Installed
runtime resolves the same top-level core 0.3.0 package; no nested core is installed.

The active lockfile integrities are:

- Core: `sha512-FxmNJ4QU1RGDaKSp6OpNvPQsZM5CcbJ+1YGC0ezekmZDUhjyD5y1tQJRzsof4ob8eEZvHfZTBHVfNTG2viSuhQ==`
- Runtime branches artifact: `sha512-ROiv9qXWVxEeA7AW9+xCFbwzygDIv0a0O58dQZ3JcSu+zzYnyzh0yeBVuIGJMEdmP1f3j95/HpLz0L5ZdHylTw==`

Verification used `npm install --ignore-scripts --offline --no-audit --no-fund`
with a fresh temporary cache, followed by `npm ls` to confirm the deduplicated
dependency tree. The upstream branch and QandA adapter tests passed (13 tests).
Installed files were also compared with both archives, and archive SHA-512 hashes
were checked against the lockfile. Installed branch API checks and the consumer's
`npm run test:platform` regression probes passed (13 tests).

The historical `information-community-runtime-0.3.0.tgz` was packed from the clean
upstream commit above. Its original lockfile integrity was
`sha512-jDelCeoVFOUDNoVPFlOB4htDWRLM9VkEFZ+WX7Hy0mPMCcL1tNQcJwaa03NutEEqcXb6HBCmRHKEwcVV3+f9Nw==`.
It and core 0.2.0 are retained as historical evidence and are not active dependencies.

The old runtime 0.2.0 artifact is retained only as historical verification evidence,
not loaded by the consumer. It was packed on 2026-09-09 from an uncommitted tree
based on `a436f19e60cb8c395a2c3e986e20d4c4d001b931`; that older commit alone does
not contain those fixes. Never substitute artifacts solely by matching a version number.
