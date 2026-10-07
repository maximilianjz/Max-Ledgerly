# Operations guide

Start with the [README](../README.md) for setup and money flows. This guide covers the details needed to operate or extend the integration.

## Configuration and permissions

Keep credentials in `.env.local` or server-side deployment variables. The app and reconciliation job must share the same platform ID, environment, database, and storage namespace.

The core variables are listed in the README. Additional settings are documented in [.env.example](../.env.example):

| Variable | Purpose |
| --- | --- |
| `WHOP_ENVIRONMENT` | API environment: `production` by default, or `sandbox` for an isolated reconciliation job. The app uses production. |
| `WHOP_ACCOUNT_ID` | Optional fallback account for payout API requests without a seller; the UI always selects a registered seller. |
| `WHOP_WEBHOOK_SECRET` | Signing secret for connected-account events. |
| `WHOP_PARENT_WEBHOOK_SECRET` | Separate signing secret for parent-account payments. |
| `LEDGERLY_STORAGE_NAMESPACE` | Defaults to `ledgerly-v1`; isolate preview environments. |
| `LEDGERLY_DATA_DIR` | Local file-storage directory; defaults to `.data/ledgerly`. |

Tests use fixtures and do not call Whop. The app and reconciliation job use the configured account key.

| Operation | Required actions |
| --- | --- |
| Create/read connected accounts | `company:create_child`, `payout:account:read` |
| Create/recover inline checkouts | `checkout_configuration:create`, `checkout_configuration:basic:read`, `plan:create`, `access_pass:create`, `access_pass:update` |
| Reconcile payments and transfers | `payment:basic:read`, `payout:transfer:read` |
| Register/manage webhooks | `developer:manage_webhook` |
| Configure seller fee markups | `company:update_child_fees` |
| Embedded payouts | `company:balance:read`, `stats:read`, `payout:destination:read`, `payout:withdrawal:read`, `payout:create_destination`, `payout:withdraw_funds` |

Only the six embedded-payout actions enter browser tokens. The parent key stays on the server.

API pins are explicit in [whop-api.ts](../src/lib/whop-api.ts) and [provider.ts](../src/lib/integration/provider.ts): `2026-09-29` for account and read operations, and `2025-01-01` for inline checkout creation. The latter supports `plan.product` and `application_fee_amount`, with `plan.company_id` selecting the charging account. Validate live checkout responses and fee settlement separately from fixture tests.

## Onboard a seller

Use the app's `/sellers` flow to enter seller ID, email, and country. It sends these fields to `POST /api/sellers`:

```json
{ "externalId": "seller-123", "email": "seller@example.com", "country": "US" }
```

The response contains the connected seller. The status page opens a fresh verification link through `POST /api/sellers/{externalId}/onboarding`, using HTTPS callbacks on your deployment. Complete verification at that URL; the app reads the account again after return rather than assuming approval. Backend integrations can call [onboardSeller](../src/lib/integration/onboarding.ts) directly to create or fetch a seller and return a fresh link in one operation.

- `externalId` identifies the seller and is saved as `metadata.external_id`. Repeating the same identity returns the same account and a fresh link.
- Changing the email or country under an existing external ID is rejected. Country codes are normalized to ISO 3166-1 uppercase codes; Whop determines eligibility.
- The account-create contract infers the parent from the API key. The integration checks `/accounts/me` against `WHOP_PLATFORM_ACCOUNT_ID` and validates the returned child's parent.
- Payout access resolves the seller server-side and checks its current parent and status. Suspended, unknown, or mismatched sellers are rejected.

The app has no built-in visitor authentication or per-user seller authorization. Its same-origin checks prevent cross-site browser requests; they do not authenticate a visitor. Use deployment access controls for the operator demo and add seller identity/ownership checks before customer access.

## Create a checkout

Open a registered seller's **Account** tab, enter a product name and USD price, then choose **Create payment link**. The page previews the 8% split; `POST /api/sellers/{externalId}/checkout` recalculates it on the server and creates a direct seller checkout. Its only accepted fields are `orderId`, `title`, and `amount`; the server chooses the seller, fee, currency, flow, and HTTPS return URL.

The browser saves the request in session storage before sending it. After a lost response or reload, **Retry payment link** keeps the same order ID and inputs. **Create another link** starts a new order after a successful result. Creating a link does not charge the buyer or establish that funds have settled.

For backend use, including platform checkouts, call the same integration function:

```ts
import { getWhopKey } from "@/lib/config";
import { createCheckout } from "@/lib/integration/checkout";
import { WhopProvider } from "@/lib/integration/provider";
import { createStore } from "@/lib/integration/storage";

const { checkout } = await createCheckout(createStore(), new WhopProvider(getWhopKey()), {
  orderId: "order-123",
  sellerExternalId: "seller-123",
  title: "Acme Preset Pack",
  amount: "25.00",
  currency: "usd",
  flow: "direct",
  redirectUrl: "https://YOUR_DOMAIN/orders/thanks",
});

// Send checkout.purchaseUrl to the buyer.
```

The server computes the fee using integer cents and rounds 8% to the nearest cent, half up. This starter supports USD, positive prices up to $1,000,000, and fees greater than zero but below the price. Caller-supplied fees and fractional cents are not accepted.

For a platform sale, use a new `orderId` and `flow: "platform"`. The checkout charges Ledgerly and omits `application_fee_amount`; the recorded $23 seller share is an expected allocation. An operator must separately check available funds and submit the transfer. Checkout creation does not pay, refund, or transfer money.

An order ID binds the seller, flow, price, title, and return URL. Repeating those inputs reuses the checkout; changed inputs require a new ID. Order and seller metadata allow parent-account payments to be attributed later.

### Retry behavior

Before creating an account or checkout, the integration saves its inputs, idempotency key, API version, credential fingerprint, and start time. A retry searches Whop by metadata to recover a successful create whose response or local write was lost.

Retries preserve the original key and inputs. If no resource can be recovered, the implementation stops after 23 hours or a credential change to avoid another create after Whop's 24-hour idempotency window. Review an uncertain outcome before changing keys or deleting operation records. See the [Whop idempotency contract](https://docs.whop.com/developer/api/idempotency).

## Webhooks

Use two platform-account hooks to capture both money flows:

| Hook | Endpoint | Signing secret | `child_resource_events` |
| --- | --- | --- | --- |
| Connected accounts | `/api/webhooks/whop` | `WHOP_WEBHOOK_SECRET` | `true` |
| Ledgerly parent | `/api/webhooks/whop/parent` | `WHOP_PARENT_WEBHOOK_SECRET` | `false` |

Subscribe the connected-account hook to:

```text
payment.succeeded
payment.failed
refund.created
dispute.created
transfer.completed
payout.created
payout.updated
account.updated
```

The parent hook subscribes to `payment.succeeded` and `payment.failed`. Check existing hooks before creating another, pin their payload version to `2026-09-29`, and deploy each signing secret before enabling deliveries. The parent endpoint returns `503` when its secret is missing; it never uses the child hook's secret.

### Test and replay

1. Send a test event from Whop to the deployed endpoint and check for HTTP `200`.
2. Replay that delivery with `regenerate_id: false`.
3. Confirm `duplicate: true` and that the stored receipt count did not increase.

HTTP `200` confirms durable receipt storage. Dashboard samples often use placeholder accounts and correctly return `disposition: "quarantined"`. To prove real seller routing, use an event whose account or saved order matches the registry, then check its `seller` and `disposition: "routed"` fields.

### Signatures, routing, and the ledger

The receiver verifies the raw body using HMAC-SHA256, constant-time comparison, a five-minute timestamp tolerance, and matching signed-header/body IDs. Each event ID has one durable receipt across concurrent deliveries and restarts. Changed content under the same ID returns `409`; storage failures are not acknowledged as successful.

Routing uses registered account identities and saved orders. A configured webhook version chooses the expected `account_id` or legacy `company_id` field. Without a pin, either signed field is accepted, but conflicting IDs are rejected.

| Missing envelope owner | Receiver behavior |
| --- | --- |
| Payment or dispute | Use the resource's version-appropriate account field, otherwise quarantine. |
| Refund or payout | Preserve the receipt; quarantine when no owner is available. |
| Transfer | Match signed origin/destination identities to registered sellers. |
| Account update | Use `data.id`, the updated account itself. |

Unknown ownership is recorded as a quarantined receipt and requires later investigation. The receiver does not make synchronous Whop lookups to acknowledge events or automatically resolve quarantined receipts. Parent payments need a saved order/checkout mapping; the parent account ID alone cannot identify the seller.

Payments and completed transfers are projected into the local transaction ledger. Multiple observations of one resource collapse to one transaction using the latest provider timestamp; equal-time conflicts are reported. Refund, dispute, payout, and account events remain audit receipts. The ledger supports reconciliation, not double-entry bookkeeping or available-balance calculation.

The Next.js app serves both webhook endpoints. `npm test` checks all eight event types, signature failures, concurrency, and replay against fresh store instances. Use Whop's test and replay controls for deployed delivery evidence.

### Inspect deliveries for a walkthrough

With the local app pointing at the deployment's database and namespace, open [localhost:3000/activity](http://localhost:3000/activity). Search the order reference shown after checkout creation, or use a payment or event ID. A receipt shows its original seller assignment, routing disposition, stored receipt count, and selected payload fields. This view only reads existing records; it does not repair quarantined events or trigger deliveries.

For replay evidence, show Whop's replay response with `duplicate: true`, then refresh the activity view and show the same event ID with one stored receipt. Replay attempts are not stored as new rows or counted as deliveries. Whop's dashboard test fixtures may have placeholder ownership; a signed, quarantined sample does not prove a real payment was matched to a seller.

The activity route is restricted to loopback hosts in development and returns `404` in production, including Vercel. Add operator authentication and authorization before exposing platform-wide activity on a deployment.

## Reconciliation

The [reconciliation job](../scripts/reconcile.mjs) compares a registered seller over a specified creation-time window. It accepts a seller ID, start time, and end time as shown in the [README](../README.md#tests-and-reconciliation). Run it manually or invoke the same command from your scheduler with a new window. It paginates seller payments, parent payments attributed through saved orders, and transfers in both directions, then compares identities, owning accounts, amounts, status, creation time, and transfer ledger IDs.

The report includes missing records, changed fields, duplicate IDs, unresolved identities, and pagination coverage. Exit codes are `0` for a match, `2` for differences, and `1` for a failed or incomplete run. The job performs GETs and does not repair records or invent missing ownership mappings.

Whop's creation-time boundaries are exclusive; overlap consecutive windows. Use a quiet historical window because paginated reads are not an atomic provider snapshot. Manually created platform orders need a trusted seller mapping before their payments can be attributed.

## Seller payouts

Each seller has one workspace at `/sellers/{externalId}`. **Account** is the default tab; **Payouts** uses `?tab=payouts`, so refresh, shared links, and browser history preserve the selection. Existing `/payouts?seller=...` bookmarks and Whop callbacks redirect to that tab; `/payouts` without a seller opens the account picker.

Under **Move your money**, **Withdraw in Ledgerly** opens the embedded withdrawal flow using a scoped, ten-minute access token. **Open Whop portal** opens Whop's hosted page through a `payouts_portal` account link. Both operate on the selected connected seller.

### Payout pricing

The example crypto markup is 1%, already configured for the US demo seller. Apply it separately for each new connected account. The app has no pricing editor; `PATCH /api/fees` returns `403` without calling Whop. Loading payouts does not modify fees.

A platform operator uses a private key with `company:update_child_fees`. Set `WHOP_ACCOUNT_ID` to the intended connected seller. First read its fees and check the crypto rail's `adjustable` and `maximum.percentage` fields:

```sh
curl -sS "https://api.whop.com/api/v1/accounts/$WHOP_ACCOUNT_ID/fees" \
  -H "Authorization: Bearer $WHOP_API_KEY" \
  -H 'Api-Version-Date: 2026-09-29'
```

Apply the percentage, then repeat the GET to confirm the saved value:

```sh
curl -sS -X PATCH "https://api.whop.com/api/v1/accounts/$WHOP_ACCOUNT_ID/fees" \
  -H "Authorization: Bearer $WHOP_API_KEY" \
  -H 'Api-Version-Date: 2026-09-29' \
  -H 'Content-Type: application/json' \
  -d '{"markups":{"payouts":{"crypto":{"percentage":1}}}}'
```

## Storage and deployment

PostgreSQL is selected when `DATABASE_URL` is present. The [TypeScript schema](../src/lib/integration/schema.ts) stores platform context, seller operations/bindings, orders, checkouts, and webhook receipts. Atomic inserts preserve the original operation or receipt. The ledger is derived from those receipts, so there is no separate financial write to lose after acknowledgment.

Records are scoped by storage namespace, environment, and platform account. Whop requests stay outside database transactions; the app uses at most three database connections per process. The [store interface](../src/lib/integration/store.ts) can be implemented against an existing Ledgerly database.

For Vercel or another hosted deployment:

1. Provision PostgreSQL, set its pooled TLS connection URL, and review/apply the schema with `npm run db:push`. Schema setup is an explicit operator step.
2. Set the server-side variables from `.env.example`, including the exact HTTPS `APP_URL` and both webhook secrets. Leave `WHOP_WEBHOOK_MODE` unset for live deliveries.
3. Use a separate database or namespace for previews. Configure backups and database connection limits.
4. Restrict workspace/operator access while keeping signed webhook endpoints reachable by Whop.
5. Deploy, repeat onboarding for the same seller to verify reuse, and run the webhook test/replay steps above.

PostgreSQL is required on Vercel. Private files remain available on persistent local Node hosts and for offline fixtures. PostgreSQL failures never fall back to files. Changing the database configuration does not copy existing records: review and complete any data cutover first.

## Checks and evidence

`npm test` runs unit and component tests without a database. `npm run test:db` uses PGlite in a disposable directory by default and never loads `.env.local` or reads `DATABASE_URL`. For native PostgreSQL tests, `TEST_DATABASE_URL` must point to a local database named `ledgerly_test` with an empty schema.

CI runs unit tests, a fresh PostgreSQL 17 test service, Biome, route-type generation, and TypeScript validation. Keep live credentials, seller records, and financial evidence out of the public repository; see the [evidence index](../evidence/README.md).
