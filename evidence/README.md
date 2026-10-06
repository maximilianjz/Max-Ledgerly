# Verification evidence

The public repository includes [synthetic onboarding, fee, webhook, and reconciliation reports](integration/README.md). These exercise the implementation without calling Whop or moving money. Every report is labeled as a local fixture.

Credentials, seller records, live API responses, screenshots of financial accounts, and working assessment notes remain local and are ignored by Git. Any private `part-*` and `snapshots` directories in an existing workspace are intentionally absent from this repository. Share reviewed live evidence separately when needed.

For fresh delivery evidence, use Whop's test and replay controls as described in the [operations guide](../docs/operations.md#test-and-replay). Keep API responses and webhook payloads private until reviewed for credentials and personal information.
