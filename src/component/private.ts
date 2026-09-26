import { v } from "convex/values";
import { mutation } from "./_generated/server.js";

const intervalUnit = v.union(v.literal("days"), v.literal("months"));
const checkoutMode = v.union(
  v.literal("payment"),
  v.literal("subscription"),
  v.literal("setup"),
);

function linkage(metadata: unknown): {
  metadata: Record<string, unknown>;
  orgId?: string;
  userId?: string;
} {
  const record =
    metadata && typeof metadata === "object"
      ? (metadata as Record<string, unknown>)
      : {};
  return {
    metadata: record,
    orgId: typeof record.orgId === "string" ? record.orgId : undefined,
    userId: typeof record.userId === "string" ? record.userId : undefined,
  };
}

const INVOICE_STATUS_ORDER: Record<string, number> = {
  open: 0,
  failed: 1,
  paid: 2,
};

function latestInvoiceStatus(existingStatus: string, incomingStatus: string) {
  const existingOrder = INVOICE_STATUS_ORDER[existingStatus] ?? 0;
  const incomingOrder = INVOICE_STATUS_ORDER[incomingStatus] ?? 0;
  return incomingOrder >= existingOrder ? incomingStatus : existingStatus;
}

function shouldApplyInvoiceLifecycleFields(
  existingStatus: string,
  incomingStatus: string,
) {
  const existingOrder = INVOICE_STATUS_ORDER[existingStatus] ?? 0;
  const incomingOrder = INVOICE_STATUS_ORDER[incomingStatus] ?? 0;
  return incomingOrder >= existingOrder;
}

const PAYMENT_STATUS_RANK: Record<string, number> = {
  failed: 0,
  held: 1,
  succeeded: 2,
  refunded: 3,
  voided: 3,
};

function shouldApplyPaymentStatus(existingStatus: string, incomingStatus: string) {
  const existingRank = PAYMENT_STATUS_RANK[existingStatus] ?? 0;
  const incomingRank = PAYMENT_STATUS_RANK[incomingStatus] ?? 0;
  return incomingRank >= existingRank;
}

export const claimWebhookNotification = mutation({
  args: {
    notificationId: v.string(),
    eventType: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("webhook_events")
      .withIndex("by_notification_id", (q) =>
        q.eq("notificationId", args.notificationId),
      )
      .unique();
    if (existing) return false;
    await ctx.db.insert("webhook_events", {
      notificationId: args.notificationId,
      eventType: args.eventType,
    });
    return true;
  },
});

export const releaseWebhookNotification = mutation({
  args: { notificationId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("webhook_events")
      .withIndex("by_notification_id", (q) =>
        q.eq("notificationId", args.notificationId),
      )
      .unique();
    if (existing) {
      await ctx.db.delete("webhook_events", existing._id);
    }
    return null;
  },
});

export const insertCheckoutSession = mutation({
  args: {
    checkoutId: v.string(),
    customerProfileId: v.optional(v.string()),
    mode: checkoutMode,
    amount: v.number(),
    quantity: v.number(),
    planKey: v.optional(v.string()),
    intervalLength: v.optional(v.number()),
    intervalUnit: v.optional(intervalUnit),
    metadata: v.optional(v.any()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("checkout_sessions")
      .withIndex("by_checkout_id", (q) => q.eq("checkoutId", args.checkoutId))
      .unique();
    if (existing) return null;
    await ctx.db.insert("checkout_sessions", {
      checkoutId: args.checkoutId,
      customerProfileId: args.customerProfileId,
      status: "open",
      mode: args.mode,
      amount: args.amount,
      quantity: args.quantity,
      planKey: args.planKey,
      intervalLength: args.intervalLength,
      intervalUnit: args.intervalUnit,
      metadata: args.metadata,
    });
    return null;
  },
});

export const handleCheckoutCompleted = mutation({
  args: {
    checkoutId: v.string(),
    customerProfileId: v.optional(v.string()),
    subscriptionId: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("checkout_sessions")
      .withIndex("by_checkout_id", (q) => q.eq("checkoutId", args.checkoutId))
      .unique();
    if (!existing) return null;
    await ctx.db.patch("checkout_sessions", existing._id, {
      status: "complete",
      ...(args.customerProfileId !== undefined && {
        customerProfileId: args.customerProfileId,
      }),
      ...(args.subscriptionId !== undefined && {
        subscriptionId: args.subscriptionId,
      }),
    });
    return null;
  },
});

export const handleCustomerCreated = mutation({
  args: {
    customerProfileId: v.string(),
    email: v.optional(v.string()),
    name: v.optional(v.string()),
    metadata: v.optional(v.any()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("customers")
      .withIndex("by_customer_profile_id", (q) =>
        q.eq("customerProfileId", args.customerProfileId),
      )
      .unique();
    if (existing) return null;
    const { userId } = linkage(args.metadata);
    await ctx.db.insert("customers", {
      customerProfileId: args.customerProfileId,
      email: args.email,
      name: args.name,
      metadata: args.metadata ?? {},
      userId,
    });
    return null;
  },
});

export const handleCustomerUpdated = mutation({
  args: {
    customerProfileId: v.string(),
    email: v.optional(v.string()),
    name: v.optional(v.string()),
    metadata: v.optional(v.any()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const customer = await ctx.db
      .query("customers")
      .withIndex("by_customer_profile_id", (q) =>
        q.eq("customerProfileId", args.customerProfileId),
      )
      .unique();
    if (!customer) return null;
    const { userId } = linkage(args.metadata);
    await ctx.db.patch("customers", customer._id, {
      ...(args.email !== undefined && { email: args.email }),
      ...(args.name !== undefined && { name: args.name }),
      ...(args.metadata !== undefined && { metadata: args.metadata }),
      ...(userId !== undefined && { userId }),
    });
    return null;
  },
});

export const handleCustomerDeleted = mutation({
  args: { customerProfileId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const customer = await ctx.db
      .query("customers")
      .withIndex("by_customer_profile_id", (q) =>
        q.eq("customerProfileId", args.customerProfileId),
      )
      .unique();
    if (!customer) return null;
    await ctx.db.patch("customers", customer._id, {
      email: undefined,
      name: undefined,
      metadata: {},
    });
    return null;
  },
});

export const upsertPaymentProfile = mutation({
  args: {
    customerProfileId: v.string(),
    customerPaymentProfileId: v.string(),
    brand: v.optional(v.string()),
    last4: v.optional(v.string()),
    isDefault: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("payment_profiles")
      .withIndex("by_customer_payment_profile_id", (q) =>
        q.eq("customerPaymentProfileId", args.customerPaymentProfileId),
      )
      .unique();
    if (existing) {
      await ctx.db.patch("payment_profiles", existing._id, {
        customerProfileId: args.customerProfileId,
        brand: args.brand,
        last4: args.last4,
        isDefault: args.isDefault,
      });
    } else {
      await ctx.db.insert("payment_profiles", args);
    }
    return null;
  },
});

export const handlePaymentProfileDeleted = mutation({
  args: { customerPaymentProfileId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("payment_profiles")
      .withIndex("by_customer_payment_profile_id", (q) =>
        q.eq("customerPaymentProfileId", args.customerPaymentProfileId),
      )
      .unique();
    if (existing) {
      await ctx.db.delete("payment_profiles", existing._id);
    }
    return null;
  },
});

export const handleSubscriptionUpsert = mutation({
  args: {
    subscriptionId: v.string(),
    customerProfileId: v.optional(v.string()),
    customerPaymentProfileId: v.optional(v.string()),
    status: v.string(),
    amount: v.optional(v.number()),
    unitAmount: v.optional(v.number()),
    quantity: v.optional(v.number()),
    intervalLength: v.optional(v.number()),
    intervalUnit: v.optional(intervalUnit),
    planKey: v.optional(v.string()),
    currentPeriodEnd: v.optional(v.number()),
    cancelAtPeriodEnd: v.optional(v.boolean()),
    cancelAt: v.optional(v.number()),
    metadata: v.optional(v.any()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("subscriptions")
      .withIndex("by_subscription_id", (q) =>
        q.eq("subscriptionId", args.subscriptionId),
      )
      .unique();

    const linked = linkage(args.metadata);
    let cancelAtPeriodEnd = args.cancelAtPeriodEnd;
    let cancelAt = args.cancelAt;
    let status = args.status;

    if (existing) {
      if (cancelAtPeriodEnd === undefined) {
        cancelAtPeriodEnd = existing.cancelAtPeriodEnd;
      }
      if (cancelAt === undefined) {
        cancelAt = existing.cancelAt;
      }
      const nowSeconds = Date.now() / 1000;
      if (
        cancelAtPeriodEnd &&
        cancelAt !== undefined &&
        cancelAt > nowSeconds &&
        status === "canceled"
      ) {
        status = "active";
      }

      const quantity = args.quantity ?? existing.quantity;
      let unitAmount = args.unitAmount ?? existing.unitAmount;
      const amount = args.amount ?? existing.amount;
      if (
        args.unitAmount === undefined &&
        args.amount !== undefined &&
        quantity > 0 &&
        unitAmount * quantity !== amount
      ) {
        unitAmount = Math.round(amount / quantity);
      }

      await ctx.db.patch("subscriptions", existing._id, {
        status,
        amount,
        unitAmount,
        quantity,
        ...(args.customerProfileId !== undefined && {
          customerProfileId: args.customerProfileId,
        }),
        ...(args.customerPaymentProfileId !== undefined && {
          customerPaymentProfileId: args.customerPaymentProfileId,
        }),
        ...(args.intervalLength !== undefined && {
          intervalLength: args.intervalLength,
        }),
        ...(args.intervalUnit !== undefined && { intervalUnit: args.intervalUnit }),
        ...(args.planKey !== undefined && { planKey: args.planKey }),
        ...(args.currentPeriodEnd !== undefined && {
          currentPeriodEnd: args.currentPeriodEnd,
        }),
        cancelAtPeriodEnd: cancelAtPeriodEnd ?? existing.cancelAtPeriodEnd,
        ...(cancelAt !== undefined && { cancelAt }),
        ...(args.metadata !== undefined && { metadata: linked.metadata }),
        ...(linked.orgId !== undefined && { orgId: linked.orgId }),
        ...(linked.userId !== undefined && { userId: linked.userId }),
      });
      return null;
    }

    if (!args.customerProfileId) {
      throw new Error("Cannot store a subscription without a customer profile");
    }

    const amount = args.amount ?? 0;
    const quantity = args.quantity ?? 1;
    await ctx.db.insert("subscriptions", {
      subscriptionId: args.subscriptionId,
      customerProfileId: args.customerProfileId,
      customerPaymentProfileId: args.customerPaymentProfileId,
      status,
      amount,
      unitAmount: args.unitAmount ?? amount,
      quantity,
      intervalLength: args.intervalLength ?? 1,
      intervalUnit: args.intervalUnit ?? "months",
      planKey: args.planKey ?? "",
      currentPeriodEnd: args.currentPeriodEnd ?? 0,
      cancelAtPeriodEnd: cancelAtPeriodEnd ?? false,
      cancelAt,
      metadata: args.metadata === undefined ? undefined : linked.metadata,
      orgId: linked.orgId,
      userId: linked.userId,
    });

    if (linked.orgId || linked.userId) {
      const invoices = await ctx.db
        .query("invoices")
        .withIndex("by_subscription_id", (q) =>
          q.eq("subscriptionId", args.subscriptionId),
        )
        .collect();
      for (const invoice of invoices) {
        if (!invoice.orgId || !invoice.userId) {
          await ctx.db.patch("invoices", invoice._id, {
            ...(linked.orgId && !invoice.orgId && { orgId: linked.orgId }),
            ...(linked.userId && !invoice.userId && { userId: linked.userId }),
          });
        }
      }
    }

    return null;
  },
});

export const updateSubscriptionQuantityInternal = mutation({
  args: {
    subscriptionId: v.string(),
    quantity: v.number(),
    amount: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const subscription = await ctx.db
      .query("subscriptions")
      .withIndex("by_subscription_id", (q) =>
        q.eq("subscriptionId", args.subscriptionId),
      )
      .unique();
    if (!subscription) return null;
    await ctx.db.patch("subscriptions", subscription._id, {
      quantity: args.quantity,
      amount: args.amount,
    });
    return null;
  },
});

export const handlePaymentUpsert = mutation({
  args: {
    transId: v.string(),
    refTransId: v.optional(v.string()),
    customerProfileId: v.optional(v.string()),
    subscriptionId: v.optional(v.string()),
    amount: v.number(),
    currency: v.string(),
    status: v.string(),
    created: v.number(),
    metadata: v.optional(v.any()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const linked = linkage(args.metadata);

    if (
      args.refTransId &&
      (args.status === "refunded" || args.status === "voided")
    ) {
      const original = await ctx.db
        .query("payments")
        .withIndex("by_trans_id", (q) => q.eq("transId", args.refTransId!))
        .unique();
      if (
        original &&
        shouldApplyPaymentStatus(original.status, args.status)
      ) {
        await ctx.db.patch("payments", original._id, { status: args.status });
        return null;
      }
    }

    const existing = await ctx.db
      .query("payments")
      .withIndex("by_trans_id", (q) => q.eq("transId", args.transId))
      .unique();

    if (!existing) {
      await ctx.db.insert("payments", {
        transId: args.transId,
        customerProfileId: args.customerProfileId,
        subscriptionId: args.subscriptionId,
        amount: args.amount,
        currency: args.currency,
        status: args.status,
        created: args.created,
        metadata: args.metadata === undefined ? undefined : linked.metadata,
        orgId: linked.orgId,
        userId: linked.userId,
      });
      return null;
    }

    await ctx.db.patch("payments", existing._id, {
      ...(args.customerProfileId &&
        !existing.customerProfileId && {
          customerProfileId: args.customerProfileId,
        }),
      ...(args.subscriptionId &&
        !existing.subscriptionId && { subscriptionId: args.subscriptionId }),
      ...(shouldApplyPaymentStatus(existing.status, args.status) && {
        status: args.status,
      }),
      ...(linked.orgId && !existing.orgId && { orgId: linked.orgId }),
      ...(linked.userId && !existing.userId && { userId: linked.userId }),
    });
    return null;
  },
});

export const handleInvoiceUpsert = mutation({
  args: {
    transId: v.string(),
    customerProfileId: v.string(),
    subscriptionId: v.optional(v.string()),
    status: v.string(),
    amountDue: v.number(),
    amountPaid: v.number(),
    created: v.number(),
    metadata: v.optional(v.any()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("invoices")
      .withIndex("by_trans_id", (q) => q.eq("transId", args.transId))
      .unique();

    const linked = linkage(args.metadata);
    let orgId = linked.orgId;
    let userId = linked.userId;

    if ((!orgId || !userId) && args.subscriptionId) {
      const subscription = await ctx.db
        .query("subscriptions")
        .withIndex("by_subscription_id", (q) =>
          q.eq("subscriptionId", args.subscriptionId!),
        )
        .unique();
      if (subscription) {
        orgId = orgId ?? subscription.orgId;
        userId = userId ?? subscription.userId;
      }
    }

    if (!existing) {
      await ctx.db.insert("invoices", {
        transId: args.transId,
        customerProfileId: args.customerProfileId,
        subscriptionId: args.subscriptionId,
        status: args.status,
        amountDue: args.amountDue,
        amountPaid: args.amountPaid,
        created: args.created,
        metadata: args.metadata === undefined ? undefined : linked.metadata,
        orgId,
        userId,
      });
      return null;
    }

    const useIncoming = shouldApplyInvoiceLifecycleFields(
      existing.status,
      args.status,
    );
    await ctx.db.patch("invoices", existing._id, {
      customerProfileId: args.customerProfileId,
      ...(args.subscriptionId !== undefined && {
        subscriptionId: args.subscriptionId,
      }),
      status: latestInvoiceStatus(existing.status, args.status),
      amountDue: useIncoming ? args.amountDue : existing.amountDue,
      amountPaid: useIncoming ? args.amountPaid : existing.amountPaid,
      created: useIncoming ? args.created : existing.created,
      metadata: useIncoming ? linked.metadata : existing.metadata,
      ...(useIncoming && orgId !== undefined && { orgId }),
      ...(useIncoming && userId !== undefined && { userId }),
    });
    return null;
  },
});
