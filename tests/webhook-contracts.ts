import type { JsonObject } from "@/lib/integration/store";

// Selected fields from Whop's eight event schemas and SDK 2.2.0, not live captures.
// See the contract links in README.md. The sample account is deliberately unregistered.
const accountId = "biz_xxxxxxxxxxxxxx";
const createdAt = "2026-10-06T15:00:00Z";
const payment = {
  id: "pay_contract",
  account_id: accountId,
  total: { amount: "25.00", currency: "usd" },
  currency: "usd",
  created_at: createdAt,
  updated_at: createdAt,
};
const payout = {
  id: "wdrl_contract",
  amount: "25.00",
  currency: "usd",
  fee_amount: "0.00",
  net_amount: "25.00",
  created_at: createdAt,
};

export const webhookContracts: { type: string; data: JsonObject; accountId: string | null }[] = [
  { type: "payment.succeeded", data: { ...payment, status: "paid" }, accountId },
  { type: "payment.failed", data: { ...payment, status: "uncollectible" }, accountId },
  {
    type: "refund.created",
    data: {
      id: "rf_contract",
      payment: { id: payment.id },
      amount: 25,
      currency: "usd",
      status: "succeeded",
      created_at: createdAt,
    },
    accountId: null,
  },
  {
    type: "dispute.created",
    data: {
      id: "dspt_contract",
      account_id: accountId,
      payment: { id: payment.id },
      amount: 25,
      currency: "usd",
      status: "needs_response",
      created_at: createdAt,
    },
    accountId,
  },
  {
    type: "transfer.completed",
    data: {
      id: "ctt_contract",
      origin: { id: "biz_fixtureplatform" },
      destination: { id: accountId },
      amount: 23,
      currency: "usd",
      status: "succeeded",
      created_at: createdAt,
    },
    accountId: null,
  },
  { type: "payout.created", data: { ...payout, status: "requested" }, accountId: null },
  { type: "payout.updated", data: { ...payout, status: "completed" }, accountId: null },
  {
    type: "account.updated",
    data: { id: accountId, status: "suspended", parent_account: { id: "biz_fixtureplatform" } },
    accountId,
  },
];
