import { IntegrationError } from "./error.ts";

export function usdMinor(amount: unknown): number {
  const text = typeof amount === "number" && Number.isFinite(amount) ? String(amount) : amount;
  if (typeof text !== "string" || !/^\d+(?:\.\d+)?$/.test(text)) {
    throw new IntegrationError(
      "invalid_amount",
      "Use an unsigned decimal amount, for example 25.00.",
    );
  }
  const [whole, fraction = ""] = text.split(".");
  if (fraction.slice(2).replaceAll("0", "")) {
    throw new IntegrationError("unsupported_precision", "USD amounts must be exact to the cent.");
  }
  const minor = Number(whole) * 100 + Number(fraction.slice(0, 2).padEnd(2, "0"));
  if (!Number.isSafeInteger(minor))
    throw new IntegrationError("invalid_amount", "Amount is too large.");
  return minor;
}

export function priceWithFee(amount: unknown, currency: unknown) {
  if (currency !== "usd")
    throw new IntegrationError("unsupported_currency", "This starter supports USD only.");
  const amountMinor = usdMinor(amount);
  if (amountMinor <= 0 || amountMinor > 100_000_000) {
    throw new IntegrationError(
      "invalid_amount",
      "Price must be positive and at most USD 1,000,000.",
    );
  }
  // All operands are bounded integers: round 8% to the nearest cent, half up.
  const feeMinor = Math.floor((amountMinor * 8 + 50) / 100);
  if (feeMinor <= 0 || feeMinor >= amountMinor) {
    throw new IntegrationError(
      "invalid_fee",
      "The rounded fee must be positive and below the price.",
    );
  }
  return {
    amountMinor,
    feeMinor,
    sellerShareMinor: amountMinor - feeMinor,
    currency: "usd" as const,
  };
}

export function decimal(minor: number) {
  if (!Number.isSafeInteger(minor) || minor < 0)
    throw new IntegrationError("invalid_amount", "Invalid minor-unit amount.");
  return `${Math.floor(minor / 100)}.${String(minor % 100).padStart(2, "0")}`;
}
