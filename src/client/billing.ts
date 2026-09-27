export type IntervalUnit = "days" | "months";

export type BillingInterval = {
  length: number;
  unit: IntervalUnit;
};

export type AppSubscriptionStatus = "active" | "past_due" | "canceled";

export function createCheckoutId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `c${hex}`;
}

export function addInterval(from: Date, interval: BillingInterval): string {
  const next = new Date(from.getTime());
  if (interval.unit === "months") {
    next.setUTCMonth(next.getUTCMonth() + interval.length);
  } else {
    next.setUTCDate(next.getUTCDate() + interval.length);
  }
  return next.toISOString().slice(0, 10);
}

/**
 * ARB has no cancel-at-period-end flag. `suspended` is a failed-payment hold.
 * Expired, terminated, and canceled subscriptions are done.
 */
export function mapSubscriptionStatus(
  arbStatus: string,
  failed = false,
): AppSubscriptionStatus {
  if (failed) return "past_due";
  const normalized = arbStatus.toLowerCase();
  if (normalized === "active") return "active";
  if (normalized === "suspended") return "past_due";
  return "canceled";
}

export function currentPeriodEndUnix(
  schedule: {
    startDate?: string;
    intervalLength: number;
    intervalUnit: IntervalUnit;
  },
  now = new Date(),
): number {
  if (!schedule.startDate) return 0;
  const start = new Date(`${schedule.startDate}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime())) return 0;

  const advance = (date: Date) => {
    const next = new Date(date.getTime());
    if (schedule.intervalUnit === "months") {
      next.setUTCMonth(next.getUTCMonth() + schedule.intervalLength);
    } else {
      next.setUTCDate(next.getUTCDate() + schedule.intervalLength);
    }
    return next;
  };

  let cursor = start;
  if (cursor.getTime() > now.getTime()) {
    return Math.floor(cursor.getTime() / 1000);
  }

  let guard = 0;
  while (cursor.getTime() <= now.getTime() && guard < 10000) {
    cursor = advance(cursor);
    guard += 1;
  }
  return Math.floor(cursor.getTime() / 1000);
}

export type StoredPaymentStatus =
  | "succeeded"
  | "pending"
  | "failed"
  | "held"
  | "refunded"
  | "voided";

export function paymentStatusFromEvent(
  eventType: string,
  responseCode: number | undefined,
): Exclude<StoredPaymentStatus, "pending"> {
  if (eventType.endsWith(".refund.created")) return "refunded";
  if (eventType.endsWith(".void.created")) return "voided";
  if (eventType.endsWith(".fraud.held")) return "held";
  if (eventType.endsWith(".fraud.declined")) return "failed";
  if (eventType.endsWith(".fraud.approved")) return "succeeded";
  if (responseCode === 1) return "succeeded";
  if (responseCode === 4) return "held";
  return "failed";
}

/**
 * eCheck is accepted before the bank settles it. A bank payment stays pending
 * until Authorize.net reports settledSuccessfully. Voids and refunds are unchanged.
 */
export function resolvePaymentStatus(args: {
  eventType: string;
  responseCode: number | undefined;
  accountType?: "card" | "bank";
  transactionStatus?: string;
}): StoredPaymentStatus {
  const status = paymentStatusFromEvent(args.eventType, args.responseCode);
  if (
    status === "succeeded" &&
    args.accountType === "bank" &&
    args.transactionStatus !== "settledSuccessfully"
  ) {
    return "pending";
  }
  return status;
}
