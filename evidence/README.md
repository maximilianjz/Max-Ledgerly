# Verification evidence

The public repository includes [synthetic onboarding, fee, webhook, and reconciliation reports](integration/README.md). These exercise the implementation without calling Whop or moving money. Every report is labeled as a local fixture.

Credentials, seller records, live API responses, screenshots of financial accounts, and working assessment notes remain local and are ignored by Git. Any private `part-*` and `snapshots` directories in an existing workspace are intentionally absent from this repository. Share reviewed live evidence separately when needed.

## Save another account or transfer snapshot

From the project root, with `WHOP_API_KEY` already set in `.env.local`:

```sh
node --env-file=.env.local scripts/capture-whop-evidence.mjs account biz_REPLACE
node --env-file=.env.local scripts/capture-whop-evidence.mjs transfer ctt_REPLACE
```

Substitute your actual account or transfer ID. The helper performs only a GET against Whop production, pins API version `2026-09-29`, and creates a new timestamped JSON file in the ignored `evidence/snapshots/` directory. It saves selected fields plus HTTP status, capture time, API version, and request ID. It does not overwrite earlier snapshots or replay mutations. On an API error it records the HTTP metadata and omits the response body. Review each capture before sharing it; selected financial fields are still private information.

For an upcoming onboarding step, capture the account immediately before opening onboarding and again after completing it. This preserves the actual before-and-after states.

Focused checks for the helper:

```sh
node --test scripts/capture-whop-evidence.test.mjs
./node_modules/.bin/biome check scripts/capture-whop-evidence.mjs scripts/capture-whop-evidence.test.mjs
```
