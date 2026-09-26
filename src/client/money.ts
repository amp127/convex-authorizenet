/**
 * Authorize.net speaks decimal dollars. Convex stores integer cents.
 */
export function centsToDollars(cents: number): string {
  if (!Number.isInteger(cents) || cents < 0) {
    throw new Error("Amount must be a non-negative integer number of cents");
  }
  const dollars = Math.floor(cents / 100);
  const remainder = cents % 100;
  return `${dollars}.${remainder.toString().padStart(2, "0")}`;
}

export function dollarsToCents(amount: number | string): number {
  const raw = String(amount).trim();
  if (!/^-?\d+(\.\d+)?$/.test(raw)) {
    throw new Error(`Invalid dollar amount: ${amount}`);
  }
  const negative = raw.startsWith("-");
  const unsigned = negative ? raw.slice(1) : raw;
  const [whole, fraction = ""] = unsigned.split(".");
  const cents = parseInt(whole || "0", 10) * 100 + parseInt((fraction + "00").slice(0, 2), 10);
  return negative ? -cents : cents;
}
