# Guide Community Data

This directory contains the campus-specific data and policies consumed by the pinned `@information-community/runtime` package. Its tracked source files contain no live participant records, credentials, private reports, or production database exports. Runtime state and local demo secrets are ignored.

## Files

| File | Responsibility |
| --- | --- |
| `runtime.config.json` | Stable community ID, runtime data location, and business/content file paths. Open the runtime with this directory as its consumer root. |
| `business.json` | Role permissions, participant self-service allowlists and credential lifetimes, anonymous report DTO, and business file references. |
| `content-profile.json` | Answer/source types, sentence evidence rules, publication restrictions, scope dimensions, and search aliases. |
| `content.json` | Four original `stage1-demo-v1` cards plus the source-backed initial handbook drafts. Import alone does not publish them. |
| `handbook/` | Research inputs, reading-status notes, coverage index and standalone draft import bundle; readable text is generated into `docs/handbook.md`. |
| `catalog.json` | Topics, applicability scopes, and publishers retained from the legacy demonstration seed. |
| `lifecycle.json` | Campus intake/report state machines and retention periods. |
| `policy.json` | Business enums, conditional resolution rules, and the explicit public revision metadata allowlist for the guide gateway. |
| `consent.json` | Versioned participant notice and consent text. Its version matches every research workflow. |
| `review-records.mjs` | Small business schema for append-only encrypted editorial reasons; runtime supplies persistence, encryption and transactions. |
| `ui/editor.*` | Thin review queue and content-review forms using platform-authenticated APIs. |
| `pages.config.json` | Explicit answer/source revision allowlist for the public, read-only demonstration site. |
| `pages-ui/` | Static reader with relative assets and hash routes; no authentication, write APIs, or private data. |

`catalogFile`, `policyFile`, and `consentFile` are guide-specific references. The gateway loads the catalog and notice; `policy.json` documents business enums and must stay aligned with `server/business-validation.mjs`, rather than acting as an automatic rule engine. The platform loads `contentProfileFile` and `lifecycleFile`. The ignored `.runtime/` directory belongs to the deployed consumer, not to the installed package.

## Demo Content

The initial handbook adds research-backed candidates to this same content bundle. See [the handbook](../docs/handbook.md) and [maintenance instructions](../docs/handbook-maintenance.md). All new cards retain `origin: ai_draft`, `demo: false`, blank `verifiedAt`, and a separate `researchedAt`. Source retrieval is not human verification. Initial demo setup imports these candidates but only publishes the four historical demo cards; existing databases need an explicit append import. The Pages revision allowlist is unchanged. The `handbook:build` command generates the first-import v1 snapshot, not revisions for a database that already imported it.

The four cards preserve their original answer IDs, revision IDs, slugs, titles, summaries, source URLs, topic IDs, information date (`2026-08-29`), verification time, and review deadline (`2026-11-30`). They are demonstration seed records, not a fresh verification of external university pages. Answer revision data explicitly sets `demo: true`.

The first three sources remain link-only: no remote text, snapshot, or hash is retained. The method source quotes the guide's own seeded method statement and retains the original `evidence-method` identity in the citation. Its old relative `/about#method` URL is expanded to `http://localhost:4317/about#method` for the local demonstration. A production legacy conversion must receive its actual public origin; it must not silently reuse this demonstration origin.

Answer entity extensions contain `slug`, `topicId`, and `riskLevel`. The revision's `data.scope` contains scope **codes**, such as `campus: ["suzhou"]`; `data.scopeIds` separately preserves legacy scope IDs. Universal content explicitly includes `universal` for every configured scope dimension. Extra revision data is not automatically public: the gateway first obtains the runtime-approved projection, then attaches explicit display fields in `guideAnswer`.

The profile preserves `impact: low | high` and `origin: human | ai_draft`. High-risk and AI-draft content cannot publish. Every factual sentence requires a citation at write time. The original legacy database publication state must be preserved through a reviewed offline migration, not by automatically publishing every imported revision.

## Private Workflows

GitHub Pages uses `npm run build:pages`, not the server UI build. It projects only the
explicit demo revision allowlist in memory and emits six public files into ignored
`pages-dist/`. It never opens a runtime database. Time-limited source rights are
rejected; static snapshots cannot guarantee immediate withdrawal of downloaded
copies. See [Pages deployment](../docs/github-pages.md).

- `question` and `material` preserve the old intake states `submitted`, `screening`, `actioned`, `rejected`, and `expired`, with the old decision-code vocabulary. They require current research consent and reviewed `adult` / `eligible` qualifications and retain payloads for 30 days.
- `report` preserves `received`, `reviewing`, `resolved`, and `closed` and the old report decision codes. Non-privacy participant reports require current research consent.
- `privacy_report` uses the same report state vocabulary but requires neither enrollment nor research consent. Its anonymous DTO is restricted to `type`, `cardId`, and `affectedArea`; the guide gateway requires `type: privacy`, a valid affected area or existing card, and rejects arbitrary report text.
- `research_event` records the guide's minimal interaction measurements for at most 120 days. The gateway must enforce the configured field allowlist and never store the original search query in event payloads.

Research collection is disabled in the checked-in business configuration. An operator
must approve an explicit batch and finite time window before enabling it. Offline
reports aggregate only the selected current batch; old imported experiments are not
silently combined with new observations.

Platform retention clears payloads and associations using `purgedAt`; it does not rewrite a workflow status to the legacy `expired` label. `expired` is retained in the schema for historical mappings, not exposed as an operator transition that could bypass cleanup. Participant summaries use the platform's expiry and withdrawal filtering.

The platform enforces allowed state transitions and decision-code membership. The guide gateway additionally enforces campus-specific conditions from `policy.json`, such as a content link for an actioned intake or a corrected report. Public result text is a configured decision label, never free-form internal notes. No private records are seeded.

## Identity And Consent

Invitations expire after one day and can only be redeemed once. A redeemed session lasts at most one day, with a one-hour inactivity limit. Invitation principals remain non-MFA and have only the configured self-service operations. `pilot_operator` receives only the narrow `guide:participants:manage` business permission; it does not receive generic lifecycle, account, or publication management permissions.

The notice version `stage1-runtime-v1-2026-09-09` replaces the old 28-day session description. Existing consent is not silently relabeled. A production deployment must supply the full research notice, contact channels, and audited backup/metadata retention details before accepting enrollment. Logout affects one device; withdrawal revokes the subject's devices and pending invitations and clears its retained private payloads and associations.
