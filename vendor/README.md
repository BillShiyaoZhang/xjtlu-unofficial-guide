# Fixed Platform Artifacts

These are npm-pack distributions, not copied platform source maintained by this consumer. Update them only after contract and consumer tests pass. `package-lock.json` pins their integrity.

| Package | SHA-256 |
| --- | --- |
| information-community-core-0.2.0.tgz | 6A7F216BAC199061FA1507F1D8D62606CE947AA95F5AC2D4E0E129B9E17DDD96 |
| information-community-runtime-0.2.0.tgz | 29B0852EB9EA602DDC82AE5B7F2F9E48FFCEBAF3C4A54B9771ABD3E9F7FC665E |
| information-community-runtime-0.3.0.tgz | CD4024B157B59107F12C678804A620D8A7190FB17A2EA05BEC20844724F55D69 |

The active dependency is runtime **0.3.0**, packed from the clean upstream commit
[`0d0661790b77380fa29497c80e639013745debc3`](https://github.com/BillShiyaoZhang/decentralized-information-community/commit/0d0661790b77380fa29497c80e639013745debc3),
which also matches GitHub main at verification. Its lockfile integrity is
`sha512-jDelCeoVFOUDNoVPFlOB4htDWRLM9VkEFZ+WX7Hy0mPMCcL1tNQcJwaa03NutEEqcXb6HBCmRHKEwcVV3+f9Nw==`.
Core remains the already verified 0.2.0 artifact. Both include upstream LICENSE files.

The old runtime 0.2.0 artifact is retained only as historical verification evidence,
not loaded by the consumer. It was packed on 2026-09-09 from an uncommitted tree
based on `a436f19e60cb8c395a2c3e986e20d4c4d001b931`; that older commit alone does
not contain those fixes. Never substitute artifacts solely by matching a version number.
