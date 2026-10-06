# Ledgerly

A small Whop platform integration: seller onboarding, an 8% checkout fee, a durable webhook inbox, seller reconciliation, and an embedded payouts workspace. The backend uses TypeScript functions and one CLI, with PostgreSQL for shared persistence and private JSON files for offline development. The schema is defined in TypeScript; no SQL migration files or queue service are required.

## Try it without credentials

Use Node.js 22.22 or newer (the version used for local verification).

```sh
npm ci
npm run ledgerly -- demo
npm test
```

The demo uses an in-memory Whop fixture provider with no network transport. It creates US and Brazil fixture sellers, repeats onboarding, creates both checkout flows, verifies signed events and a duplicate, and runs both a clean reconciliation and an intentional $1 mismatch. It writes an isolated `.data/demo-*` directory and a labeled report under `evidence/integration/`. It never calls Whop or uses your API key.

## Configure a real integration

```sh
npm run setup
```

Setup creates `.env.local`, which is ignored by Git and Vercel. Existing configuration is preserved; add any missing variables from [.env.example](.env.example) yourself. Keep seller input files under `.data/` so their emails stay private.

### Start a local database

With Docker installed, start the included PostgreSQL service:

```sh
docker compose up -d
```

Set `DATABASE_URL` in `.env.local` to `postgresql://ledgerly:ledgerly_development@127.0.0.1:5432/ledgerly`, then run:

```sh
npm run db:push
```

This operator command compares the TypeScript schema with the configured database and asks you to review changes before applying them. It does not produce SQL migration files or import existing records. It is never run by the app or during deployment. The Docker volume persists across restarts; its credentials are for local development only. [Drizzle schema push](https://orm.drizzle.team/docs/drizzle-kit-push).

For a hosted database, use the provider's PostgreSQL connection URL instead. The app and CLI must use the same database and namespace. Offline demos always use their own files, even when `DATABASE_URL` is set.

| Variable | Purpose |
| --- | --- |
| `WHOP_API_KEY` | Parent account API key; server/operator process only |
| `WHOP_PLATFORM_ACCOUNT_ID` | Parent `biz_` ID, checked against `/accounts/me`; required for onboarding |
| `WHOP_ENVIRONMENT` | `production` by default; `sandbox` uses a separate API origin |
| `DATABASE_URL` | Primary PostgreSQL connection; use a provider's pooled connection with TLS when hosted |
| `LEDGERLY_DATA_DIR` | Private directory for local file storage; defaults to `.data/ledgerly` |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | Legacy Redis storage, used only when `DATABASE_URL` is absent; `KV_REST_API_URL` / `KV_REST_API_TOKEN` aliases are accepted |
| `LEDGERLY_STORAGE_NAMESPACE` | Defaults to `ledgerly-v1`; use the same value in the hosted app and CLI, and a different value for preview deployments |
| `WHOP_WEBHOOK_SECRET` | Whop-issued `ws_` secret for live deliveries |
| `WHOP_PARENT_WEBHOOK_SECRET` | Separate Whop-issued secret for Ledgerly's own payment hook |
| `WHOP_ACCOUNT_ID` | Optional existing seller for `/payouts` without a selection; registered sellers use their own account |
| `APP_URL` | App origin: localhost for development, exact HTTPS origin when hosted |

The assessment uses production following Whop's clarification. CLI commands that call Whop require `--live`; `demo` is always offline. Use a separate data directory and credentials for each environment. Never prefix these variables with `NEXT_PUBLIC_`. The payouts page itself uses production.

### Onboard a seller in the app

Run `npm run dev` and open [Ledgerly](http://localhost:3000). Choose **Manage your payouts** to pick an existing seller at `/accounts`, or **Create a new seller account** to start setup at `/sellers`. Both paths open directly, without a workspace password.

1. Follow the three steps: seller's stable Ledgerly ID, email, then country. Continue with Enter or the button; **Back** keeps the details you've entered. Choose **Connect seller** on the final step to call the same idempotent backend used by the CLI and open that seller's account page.
2. Choose **Continue on Whop** to get a fresh hosted verification link. The server controls both callback URLs. Creating/finding accounts works locally, but verification links require an HTTPS `APP_URL`; that button explains the requirement on localhost.
3. After Whop returns to `/sellers/{externalId}?returned=1`, the page reads current verification, required actions, and payment/payout capabilities from Whop. Returning is not treated as proof of approval. An expired link returns with `?refresh=1`, where Continue on Whop creates another link.
4. **Open seller payouts** follows that same registered seller. The token, portal, fee reads, and fee changes all resolve the external ID server-side and verify its current parent and status. Unknown, mismatched, and suspended sellers cannot obtain payout access through this flow.

This operator demo has no built-in visitor authentication or seller-specific access control. Anyone who can reach the workspace can manage its registered sellers and configured payout account. Restrict access to trusted operators at the deployment or network layer when using live credentials. A public marketplace needs individual identities and per-seller authorization. Legacy `/login?next=...` URLs redirect directly to allowed workspace paths.

The routes are `POST /api/sellers`, `GET /api/sellers/{externalId}`, and `POST /api/sellers/{externalId}/onboarding`. Mutations require the configured origin; this blocks cross-site browser requests but does not authenticate visitors. The workspace displays registered seller details. The parent API key and raw provider responses stay on the server; only short-lived, explicitly scoped tokens are issued to the payout components.

### Onboard a seller from the CLI

Save `.data/seller.json`, substituting the seller's actual identity:

```json
{ "externalId": "seller-123", "email": "seller@example.com", "country": "US" }
```

```sh
npm run ledgerly -- onboard --input .data/seller.json \
  --return-url https://your-app.example/onboarding/return \
  --refresh-url https://your-app.example/onboarding/refresh --live
```

The output contains the account ID and a fresh onboarding URL. Open that URL to complete verification. Replace both callbacks with HTTPS pages you control, or use the app's `/sellers/{externalId}?returned=1` and `?refresh=1` pages with the same configured store and registry.

`externalId` identifies the seller; email alone does not. The function stores `metadata.external_id`, verifies the returned parent/email/country, and keeps an immutable seller binding. Repeating it returns the same account and a new link. The searchable selector and backend share the 249 ISO 3166-1 country/territory codes; the API and CLI normalize lowercase input to uppercase. Country options describe business locations, not guaranteed account or payout eligibility: Whop makes that decision during account setup. US, DE, and BR remain assessment examples. Changing identity fields under an existing external ID is rejected.

The current accounts contract infers the parent from the Account API key. The legacy assessment's `parent_company_id` is therefore not sent to `/accounts`; `/accounts/me` is checked against the configured parent before creating anything. [Account contract](https://docs.whop.com/api-reference/beta/accounts/create-account).

### Create a checkout

Save `.data/order.json`:

```json
{
  "orderId": "order-123",
  "sellerExternalId": "seller-123",
  "title": "Acme Preset Pack",
  "amount": "25.00",
  "currency": "usd",
  "flow": "direct",
  "redirectUrl": "https://your-app.example/orders/thanks"
}
```

```sh
npm run ledgerly -- checkout --input .data/order.json --live
```

The function computes the fee itself: **$25.00 → $2.00 fee and $23.00 seller allocation before processing fees**. USD amounts use integer cents; 8% rounds to the nearest cent, half up. Prices must be positive, at most $1,000,000, and produce a nonzero fee below the price. No caller-provided fee is trusted. Other currencies and fractional cents are rejected.

For a platform sale, use a new `orderId` and `"flow": "platform"`. Its checkout charges the parent and omits `application_fee_amount`. The $23 share is an expected allocation; an operator submits the transfer separately after the sale and available-funds check. The CLI does not charge a card, refund, or automatically transfer funds.

An order ID always identifies the same seller, flow, price, title, and return URL. Repeats reuse the checkout; changed inputs require a new order ID. Both flows include order and seller metadata so platform-owned payments can be attributed later.

### Retry behavior

Before an account or checkout POST, its input, idempotency key, API version, credential fingerprint, and start time are saved atomically. Retries first search for the existing remote resource by metadata, recovering a successful create even if its response or the following local write was lost.

Whop caches authenticated POST outcomes for 24 hours, including 4xx errors. Retries use the original key and inputs. If no resource can be recovered, this implementation stops after 23 hours or a credential change rather than risk another create. Concurrent `409` responses can be retried with the same operation ID. Review cached validation failures manually; do not delete the journal or rotate keys to bypass an unknown outcome. [Idempotency contract](https://docs.whop.com/developer/api/idempotency).

### Contracts and permissions

| Operation | Pin and required actions |
| --- | --- |
| Account create/list | `2026-09-29`; `company:create_child`, `payout:account:read` |
| Inline checkout create | `2025-01-01`; `checkout_configuration:create`, `plan:create`, `access_pass:create`, `access_pass:update`, `checkout_configuration:basic:read` |
| Checkout recovery reads | `2026-09-29`; `checkout_configuration:basic:read` |
| Reconciliation reads | `2026-09-29`; `payment:basic:read`, `payout:transfer:read` |
| Register/manage webhooks | `developer:manage_webhook`; registration remains an operator step |

Use the parent credential with access to its direct children. Inline checkout uses the legacy contract because it documents `plan.product` and `application_fee_amount`; the current SDK 2.2.0 input does not expose that shape. Its charging owner is `plan.company_id`. This version boundary is explicit in `provider.ts`. The new CLI has only been exercised against fixtures; confirm real responses before relying on it in production. Checkout responses may omit the fee, so validating the request does not prove fee settlement. [Checkout schema](https://docs.whop.com/api-reference/checkout-configurations/create-checkout-configuration), [account listing](https://docs.whop.com/api-reference/beta/accounts/list-accounts), [payments](https://docs.whop.com/api-reference/beta/payments/list-payments), [transfers](https://docs.whop.com/api-reference/beta/transfers/list-transfers).

## Webhooks and the local ledger

`POST /api/webhooks/whop` verifies the raw body using Whop's Standard Webhooks contract: HMAC-SHA256, constant-time comparison, a five-minute timestamp tolerance, and matching signed-header/body event IDs. It atomically saves one sanitized receipt per event ID. Deduplication survives concurrent deliveries and restarts; changed content under the same ID returns 409. Storage failures are not acknowledged. [Signature and delivery contract](https://docs.whop.com/developer/guides/webhooks).

Routing uses the persisted registry. Direct payments use their account; platform payments use the saved order/checkout; transfers use their source and destination. Unknown or conflicting identities are quarantined. All eight requested event types are retained, but only payments and completed transfers are projected into the transaction ledger.

An explicit webhook version pin selects its documented `account_id` or legacy `company_id` envelope field. Without a pin, the receiver accepts either signed field and rejects conflicting IDs. Configure a dated version on the webhook to keep future payloads predictable.

The envelope account is optional in Whop's event schemas and SDK 2.2.0. A signed event with no identifiable owner is saved with `account_id: null`, `seller: null`, and `disposition: "quarantined"`. HTTP 200 means the receipt was durably stored, not that it produced a seller transaction. Missing ownership never bypasses signature verification or storage, and malformed or conflicting supplied account IDs are still rejected. No synchronous Whop API lookup is required to acknowledge a delivery.

| Events | Routing when the envelope has no account |
| --- | --- |
| [payment.succeeded](https://docs.whop.com/api-reference/beta/payments/payment-succeeded), [payment.failed](https://docs.whop.com/api-reference/beta/payments/payment-failed) | Use the payment's version-appropriate account field, otherwise quarantine. |
| [refund.created](https://docs.whop.com/api-reference/refunds/refund-created) | The documented webhook uses a legacy refund body with a payment reference but no account. Preserve that reference and quarantine; do not infer ownership from buyer or order metadata. |
| [dispute.created](https://docs.whop.com/api-reference/beta/disputes/dispute-created) | Use the dispute's version-appropriate account field, otherwise quarantine. |
| [transfer.completed](https://docs.whop.com/api-reference/beta/transfers/transfer-completed) | Keep the envelope account null; route only to registered sellers matching the signed origin or destination. |
| [payout.created](https://docs.whop.com/api-reference/beta/payouts/payout-created), [payout.updated](https://docs.whop.com/api-reference/beta/payouts/payout-updated) | These bodies have no owning account field. Quarantine if the envelope has none. |
| [account.updated](https://docs.whop.com/api-reference/beta/accounts/account-updated) | Use `data.id`, the updated account itself, never its parent account. |

Quarantined receipts remain available for investigation; refunds and payouts with no account require a trusted ownership lookup before seller processing. The receiver does not perform that later resolution automatically. Tests cover all eight contracts with omitted/null and legacy envelope identities, durable deduplication, and exclusion of unassigned test events from seller transactions. These are schema-derived fixtures, not proof that all eight Whop dashboard tests have passed. Whop's sample account `biz_xxxxxxxxxxxxxx` is deliberately unregistered; a successful synthetic test proves receipt handling, not routing for a real seller.

The **ledger is rebuilt from durable receipts**, so acknowledging an event cannot lose a separate financial write. Different events for one resource collapse to one transaction; the latest provider timestamp wins. Conflicting observations at the same timestamp are reported. Refund, dispute, account, and payout events remain audit receipts. This is a transaction reconciliation ledger, not double-entry bookkeeping or available-balance arithmetic.

```sh
npm run ledgerly -- ledger
```

To inspect an offline demo, set `LEDGERLY_DATA_DIR` to the `.data/demo-*` path it printed. Fixture and live observations cannot be combined.

### Local HTTP receiver

```sh
npm run webhooks:setup
npm run webhooks:dev
# In another terminal:
npm run webhooks:test
```

These commands use a separate private `.env.webhooks.local`, fixture seller registry, and random local signing key. The server binds only to `127.0.0.1:3001`. Restart it, then run `npm run webhooks:test -- --replay <events-report-path>` using the path printed by your test. Generated HTTP reports stay local; the [public evidence index](evidence/README.md) explains what is included in the repository.

A live receiver uses the same database connection, namespace, platform account, and Whop environment as onboarding and the CLI. With file storage, all processes must share `LEDGERLY_DATA_DIR` on a persistent Node host; the standalone entrypoint is `node --experimental-strip-types --env-file=.env.local scripts/webhook-server.mjs`. `WHOP_WEBHOOK_STORAGE_DIR` overrides only local receipt storage. Local fixture mode always uses files and never accesses PostgreSQL or Redis.

### Receive parent-account payments

The assessment's `child_resource_events: true` hook receives child events only. Ledgerly's own sales use a second hook. Both endpoints call the same consumer and share the seller registry, orders, and durable event IDs:

| Hook | Endpoint | Signing secret | Events |
| --- | --- | --- | --- |
| Connected accounts | `/api/webhooks/whop` | `WHOP_WEBHOOK_SECRET` | The eight assessment events; `child_resource_events: true` |
| Ledgerly parent | `/api/webhooks/whop/parent` | `WHOP_PARENT_WEBHOOK_SECRET` | `payment.succeeded`, `payment.failed`; `child_resource_events: false` |

Check the platform's existing hooks before creating another. A parent hook can be prepared with `POST /api/v1/webhooks` using this body, replacing the account and URL:

```json
{
  "resource_id": "biz_YOUR_PLATFORM",
  "url": "https://YOUR_DOMAIN/api/webhooks/whop/parent",
  "child_resource_events": false,
  "enabled": false,
  "api_version_date": "2026-09-29",
  "events": ["payment.succeeded", "payment.failed"]
}
```

Save its Whop-issued signing secret as `WHOP_PARENT_WEBHOOK_SECRET` in the server environment. Deploy the endpoint and secret before enabling the hook. The parent endpoint returns 503 if its secret is missing; it never falls back to the connected-account secret. The standalone Node receiver supports both paths too. [Whop setup and signing](https://docs.whop.com/developer/guides/webhooks).

Create platform checkouts through the integration with `flow: "platform"`. Its saved order and checkout identify the seller entitled to the sale. A parent payment without that mapping remains quarantined; a webhook's parent account ID alone does not identify a seller. Tests cover routing a platform payment to its seller, replay after a fresh store instance, deduplication across both endpoints, and separation of the signing secrets.

For a live check, verify the first mapped payment returns `seller: "YOUR_EXTERNAL_ID"` and `disposition: "routed"`. Replay it with `regenerate_id: false`, confirm `duplicate: true`, then run reconciliation. Dashboard samples use placeholder identities and can correctly remain quarantined. Until parent payment events are captured, reconciliation reports those payments as missing locally.

## Reconcile one seller

```sh
npm run --silent ledgerly -- reconcile --seller seller-123 \
  --from 2026-10-01T00:00:00Z --to 2026-10-06T00:00:00Z --live
```

The job performs only GETs and does not modify local files. It paginates the seller's payments, parent payments attributed through saved orders, and transfers in both directions. It compares resource identity, owning account, USD cents, status, creation time, and transfer ledger IDs against the local projection.

The report includes page coverage, missing local/provider resources, duplicate IDs, changed fields, and unresolved identities. Exit codes: `0` clean, `2` differences, `1` failed/incomplete run. Broken pagination prevents a complete report. Unattributed parent payments are reported because their seller cannot safely be inferred.

Whop's **exclusive creation-time boundaries** apply, not settlement time; overlap consecutive windows. Page reads are not an atomic provider snapshot, so use a quiet historical window to investigate differences. Manually created orders need an explicit identity mapping before their platform payments can be attributed. The job never invents mappings or repairs records.

## Both money flows

These amounts show the commercial split before processing fees, reserves, and settlement delays. They do not represent immediately withdrawable balance.

```mermaid
sequenceDiagram
    participant Buyer
    participant Ledgerly
    participant Whop
    participant Seller as US seller ledger
    participant Platform as Ledgerly ledger
    participant Inbox as Durable local inbox
    Ledgerly->>Whop: Create seller checkout, $25 with $2 application fee
    Whop-->>Ledgerly: Purchase URL
    Buyer->>Whop: Complete payment
    Whop->>Seller: $23 seller proceeds before processing fees
    Whop->>Platform: $2 application fee
    Whop->>Inbox: Signed child payment.succeeded
    Inbox->>Inbox: Verify, route seller, persist event once
    Ledgerly->>Whop: Read seller payments
    Ledgerly->>Inbox: Compare with projected transactions
```

```mermaid
sequenceDiagram
    participant Buyer
    participant Ledgerly
    participant Whop
    participant Platform as Ledgerly ledger
    participant Seller as Brazil seller ledger
    participant Inbox as Durable local inbox
    Ledgerly->>Whop: Create parent checkout, $25, seller/order metadata
    Buyer->>Whop: Complete payment
    Whop->>Platform: Sale proceeds less processing fees
    Whop->>Inbox: Signed parent payment.succeeded via parent hook
    Inbox->>Inbox: Map saved order to Brazilian seller
    Ledgerly->>Whop: Separately check funds, then transfers.create $23
    Whop->>Platform: Debit transfer amount and applicable fees
    Whop->>Seller: Credit $23 transfer
    Whop->>Inbox: Signed transfer.completed
    Inbox->>Inbox: Persist once, project seller transaction
    Ledgerly->>Whop: Read parent payments and seller transfers
    Ledgerly->>Inbox: Compare against local ledger
```

## Existing payouts page

Run `npm run dev` and open [localhost:3000](http://localhost:3000). Choose an existing seller to open payouts, or set `WHOP_ACCOUNT_ID` for the existing `/payouts` shortcut. Workspace access is controlled by your deployment, not by an application password.

The Next.js/React page provides ten-minute Whop tokens, embedded balance/withdrawal/activity components, token renewal, and a hosted `payouts_portal` alternative. Withdrawals open in Whop's viewport-sized overlay so nested bank-linking dialogs remain visible. The parent key stays on the server; browser tokens stay in memory. Hosted portal callbacks require HTTPS.

The components need `company:balance:read`, `stats:read`, `payout:destination:read`, `payout:withdrawal:read`, `payout:create_destination`, and `payout:withdraw_funds`. Only these six scopes enter browser tokens; fee-management permissions are excluded.

Ledgerly's example crypto withdrawal markup is **1%**, already saved in Whop for the US demo seller. Sellers cannot edit pricing: the editor is removed and `PATCH /api/fees` always returns `403` without calling Whop. The application does not change fee settings while loading payouts. This withdrawal markup is separate from the 8% checkout application fee.

For a new connected account, a platform operator provisions the same rate directly in Whop using a private key with `company:update_child_fees`. First read `/accounts/{account_id}/fees` and check the crypto rail's `adjustable` and `maximum.percentage` fields. Then apply the percentage and read it back to confirm. These commands use the selected connected account's `WHOP_ACCOUNT_ID`; no fee-management endpoint is exposed to sellers:

```bash
curl -sS -X PATCH "https://api.whop.com/api/v1/accounts/$WHOP_ACCOUNT_ID/fees" \
  -H "Authorization: Bearer $WHOP_API_KEY" \
  -H 'Api-Version-Date: 2026-09-29' \
  -H 'Content-Type: application/json' \
  -d '{"markups":{"payouts":{"crypto":{"percentage":1}}}}'

curl -sS "https://api.whop.com/api/v1/accounts/$WHOP_ACCOUNT_ID/fees" \
  -H "Authorization: Bearer $WHOP_API_KEY" \
  -H 'Api-Version-Date: 2026-09-29'
```

## Persistence, hosting, and completion status

The app, webhook handler, and live CLI select `PostgresStore` when `DATABASE_URL` is set. An atomic `INSERT ... ON CONFLICT DO NOTHING` preserves the first operation or webhook receipt. A retry reads that original record, including after a concurrent insert or a lost response. The receipt itself is the event's deduplication record; there is no separate marker or expiration. Whop HTTP calls stay outside database transactions.

Each row belongs to a scope containing the storage namespace, Whop environment, and platform account ID. The original operation or sanitized receipt is an immutable JSONB document. Stored generated columns expose identities and monetary fields for indexing and constraints without maintaining a second copy in application code. This is a small relational schema around the existing operation journal, not a separate accounting system.

### Database records

| Table | Guarantee |
| --- | --- |
| `ledgerly_contexts` | One immutable platform/environment identity per scope |
| `ledgerly_seller_operations` | Original onboarding input, idempotency key, credential fingerprint, API version, and start time |
| `ledgerly_sellers` | Unique external ID and connected-account binding within the scope |
| `ledgerly_orders` | Immutable checkout operation, foreign key to its seller, integer cents, positive price, and the computed 8% fee |
| `ledgerly_checkouts` | Foreign key to the order and a unique Whop checkout ID |
| `ledgerly_webhook_events` | Unique event ID, payload hash, selected event data, received time, and routed/quarantined state; nullable ownership for unresolved events |

Account-to-seller and checkout-to-order routing use indexed lookups. The ledger remains derived from the durable inbox; reconciliation still reads the scoped receipt collection. Large ledgers will need paginated event reads or a stored projection. A stored projection should update its resource record and processing state in one transaction. Ownership resolution for quarantined events remains a separate task. [PostgreSQL constraints](https://www.postgresql.org/docs/current/ddl-constraints.html).

The store contract keeps Whop transport, fee calculation, and reconciliation independent of PostgreSQL. A fork can implement that contract against an existing Ledgerly database. Configure provider backups and connection limits for your deployment; the application uses at most three database connections per process.

### Existing Redis and local records

When `DATABASE_URL` is absent, existing Upstash credentials still select `RedisStore`. Its atomic conditional writes and original records are preserved. PostgreSQL failures never fall back to Redis or files. Switching configuration does **not** copy seller bindings, operations, or webhook receipts: existing installations need a reviewed data-transfer and cutover plan before setting `DATABASE_URL`. This repository does not run a backfill or dual-write to both stores.

`LocalStore` remains available for offline demos and local development, with private permissions, fsync, and atomic hard-link publication. Back up the whole data directory together. Vercel refuses file storage; configure PostgreSQL or retain the existing Redis adapter. Storage failures never acknowledge a webhook as successful.

### Enable the complete app on Vercel

1. Provision PostgreSQL and review/apply the schema with `npm run db:push` against that database. For an existing Redis deployment, complete the reviewed cutover first. Use a separate database for previews, or at least a separate namespace in a database with the same schema.
2. Set `DATABASE_URL` for Production to the provider's pooled PostgreSQL URL with TLS, along with `WHOP_API_KEY`, `WHOP_PLATFORM_ACCOUNT_ID`, `WHOP_ENVIRONMENT=production`, `APP_URL`. Keep `WHOP_ACCOUNT_ID` for the existing payout shortcut. These values must remain server-side.
3. Set `WHOP_WEBHOOK_SECRET` to the actual hook's `ws_` signing secret. Keep `WHOP_WEBHOOK_MODE` unset for live deliveries. Point the platform hook to `https://YOUR_DOMAIN/api/webhooks/whop`, pin its payload version to `2026-09-29`, and subscribe to the eight events listed above with `child_resource_events: true`.
4. Restrict the workspace and operator APIs to trusted users before hosting with live credentials; leave the signed webhook endpoints reachable by Whop. Deploy after connecting storage. Open `/sellers`, create or find a seller, repeat the same input, and confirm that it returns the same account. Existing Whop accounts are recovered using their original external ID, email, and country; local registry files are not automatically uploaded. Signed events for sellers not yet registered are stored as quarantined receipts.
5. Send a test event from Whop and verify HTTP 200. Replay that delivery preserving its event ID (`regenerate_id: false`), then confirm HTTP 200, `duplicate: true`, and no extra receipt. The first authenticated delivery initializes the platform context if the registry is empty.

Database integration tests exercise concurrent onboarding, identity and fee constraints, retry recovery, restart persistence, signed deliveries, replay, and reconciliation. HTTP fixtures also cover the existing Redis adapter and Vercel routes. These tests do not establish a deployed database connection or a real Whop delivery. The [public evidence index](evidence/README.md) links synthetic reports; credentials, seller records, working notes, and real financial evidence remain excluded from Git.

## Code map and checks

| File | Responsibility |
| --- | --- |
| `src/lib/integration/store.ts` | Seller/order identities and atomic persistence |
| `src/lib/integration/storage.ts` | Storage selection and legacy Upstash REST adapter |
| `src/lib/integration/postgres.ts`, `schema.ts` | PostgreSQL persistence, indexed lookups, and declarative table constraints |
| `drizzle.config.ts`, `compose.yaml` | Operator schema setup and local PostgreSQL service |
| `src/lib/integration/provider.ts` | Whop transport, version pins, pagination |
| `src/lib/integration/onboarding.ts` | Shared create-or-fetch logic and fresh onboarding links |
| `src/app/accounts`, `src/app/sellers`, `src/lib/sellers.ts` | Existing seller picker, operator onboarding screens, live status, and registered seller access |
| `src/lib/integration/money.ts`, `checkout.ts` | Exact cents, 8% fee, checkout identity |
| `src/lib/whop-webhooks.ts`, `integration/ledger.ts` | Signatures, durable inbox, routing, ledger projection |
| `src/lib/integration/reconciliation.ts` | Read-only provider/local comparison |
| `scripts/ledgerly.mjs`, `scripts/fixtures.ts` | CLI and shared offline provider |

`npm test` covers the backend and existing payouts app without a database. `npm run test:db` exercises PostgreSQL semantics using PGlite in a temporary directory, then removes that directory. It never loads `.env.local` or reads `DATABASE_URL`. To use a disposable native PostgreSQL instance instead, set `TEST_DATABASE_URL`; it must point to a local database named `ledgerly_test` with an empty schema. CI runs these tests against a fresh PostgreSQL 17 service, plus the unit tests, Biome, route type generation, and full TypeScript validation. No hosted credentials are needed.

`npm run ledgerly -- demo` writes labeled offline evidence. Neither the demo nor database tests call Whop. The declarative schema is compiled in memory for database tests; no SQL migration files are generated.
