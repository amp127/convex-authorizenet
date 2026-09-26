import { v } from "convex/values";
import { mutation, query } from "./_generated/server.js";
import schema from "./schema.js";

const customerValidator = schema.tables.customers.validator;
const subscriptionValidator = schema.tables.subscriptions.validator;
const checkoutSessionValidator = schema.tables.checkout_sessions.validator;
const paymentValidator = schema.tables.payments.validator;
const invoiceValidator = schema.tables.invoices.validator;
const paymentProfileValidator = schema.tables.payment_profiles.validator;

function withoutSystemFields<T extends { _id: string; _creationTime: number }>(
  doc: T,
): Omit<T, "_id" | "_creationTime"> {
  const { _id, _creationTime, ...data } = doc;
  return data;
}

export const getCustomer = query({
  args: { customerProfileId: v.string() },
  returns: v.union(customerValidator, v.null()),
  handler: async (ctx, args) => {
    const customer = await ctx.db
      .query("customers")
      .withIndex("by_customer_profile_id", (q) =>
        q.eq("customerProfileId", args.customerProfileId),
      )
      .unique();
    return customer ? withoutSystemFields(customer) : null;
  },
});

export const getCustomerByEmail = query({
  args: { email: v.string() },
  returns: v.union(customerValidator, v.null()),
  handler: async (ctx, args) => {
    const customer = await ctx.db
      .query("customers")
      .withIndex("by_email", (q) => q.eq("email", args.email))
      .first();
    return customer ? withoutSystemFields(customer) : null;
  },
});

export const getCustomerByUserId = query({
  args: { userId: v.string() },
  returns: v.union(customerValidator, v.null()),
  handler: async (ctx, args) => {
    const customer = await ctx.db
      .query("customers")
      .withIndex("by_user_id", (q) => q.eq("userId", args.userId))
      .first();
    return customer ? withoutSystemFields(customer) : null;
  },
});

export const getSubscription = query({
  args: { subscriptionId: v.string() },
  returns: v.union(subscriptionValidator, v.null()),
  handler: async (ctx, args) => {
    const subscription = await ctx.db
      .query("subscriptions")
      .withIndex("by_subscription_id", (q) =>
        q.eq("subscriptionId", args.subscriptionId),
      )
      .unique();
    return subscription ? withoutSystemFields(subscription) : null;
  },
});

export const listSubscriptions = query({
  args: { customerProfileId: v.string() },
  returns: v.array(subscriptionValidator),
  handler: async (ctx, args) => {
    const subscriptions = await ctx.db
      .query("subscriptions")
      .withIndex("by_customer_profile_id", (q) =>
        q.eq("customerProfileId", args.customerProfileId),
      )
      .collect();
    return subscriptions.map(withoutSystemFields);
  },
});

export const getSubscriptionByOrgId = query({
  args: { orgId: v.string() },
  returns: v.union(subscriptionValidator, v.null()),
  handler: async (ctx, args) => {
    const subscription = await ctx.db
      .query("subscriptions")
      .withIndex("by_org_id", (q) => q.eq("orgId", args.orgId))
      .first();
    return subscription ? withoutSystemFields(subscription) : null;
  },
});

export const listSubscriptionsByOrgId = query({
  args: { orgId: v.string() },
  returns: v.array(subscriptionValidator),
  handler: async (ctx, args) => {
    const subscriptions = await ctx.db
      .query("subscriptions")
      .withIndex("by_org_id", (q) => q.eq("orgId", args.orgId))
      .collect();
    return subscriptions.map(withoutSystemFields);
  },
});

export const listSubscriptionsByUserId = query({
  args: { userId: v.string() },
  returns: v.array(subscriptionValidator),
  handler: async (ctx, args) => {
    const subscriptions = await ctx.db
      .query("subscriptions")
      .withIndex("by_user_id", (q) => q.eq("userId", args.userId))
      .collect();
    return subscriptions.map(withoutSystemFields);
  },
});

export const getPayment = query({
  args: { transId: v.string() },
  returns: v.union(paymentValidator, v.null()),
  handler: async (ctx, args) => {
    const payment = await ctx.db
      .query("payments")
      .withIndex("by_trans_id", (q) => q.eq("transId", args.transId))
      .unique();
    return payment ? withoutSystemFields(payment) : null;
  },
});

export const listPayments = query({
  args: { customerProfileId: v.string() },
  returns: v.array(paymentValidator),
  handler: async (ctx, args) => {
    const payments = await ctx.db
      .query("payments")
      .withIndex("by_customer_profile_id", (q) =>
        q.eq("customerProfileId", args.customerProfileId),
      )
      .collect();
    return payments.map(withoutSystemFields);
  },
});

export const listPaymentsByUserId = query({
  args: { userId: v.string() },
  returns: v.array(paymentValidator),
  handler: async (ctx, args) => {
    const payments = await ctx.db
      .query("payments")
      .withIndex("by_user_id", (q) => q.eq("userId", args.userId))
      .collect();
    return payments.map(withoutSystemFields);
  },
});

export const listPaymentsByOrgId = query({
  args: { orgId: v.string() },
  returns: v.array(paymentValidator),
  handler: async (ctx, args) => {
    const payments = await ctx.db
      .query("payments")
      .withIndex("by_org_id", (q) => q.eq("orgId", args.orgId))
      .collect();
    return payments.map(withoutSystemFields);
  },
});

export const listInvoices = query({
  args: { customerProfileId: v.string() },
  returns: v.array(invoiceValidator),
  handler: async (ctx, args) => {
    const invoices = await ctx.db
      .query("invoices")
      .withIndex("by_customer_profile_id", (q) =>
        q.eq("customerProfileId", args.customerProfileId),
      )
      .collect();
    return invoices.map(withoutSystemFields);
  },
});

export const listInvoicesByOrgId = query({
  args: { orgId: v.string() },
  returns: v.array(invoiceValidator),
  handler: async (ctx, args) => {
    const invoices = await ctx.db
      .query("invoices")
      .withIndex("by_org_id", (q) => q.eq("orgId", args.orgId))
      .collect();
    return invoices.map(withoutSystemFields);
  },
});

export const listInvoicesByUserId = query({
  args: { userId: v.string() },
  returns: v.array(invoiceValidator),
  handler: async (ctx, args) => {
    const invoices = await ctx.db
      .query("invoices")
      .withIndex("by_user_id", (q) => q.eq("userId", args.userId))
      .collect();
    return invoices.map(withoutSystemFields);
  },
});

export const getCheckoutSession = query({
  args: { checkoutId: v.string() },
  returns: v.union(checkoutSessionValidator, v.null()),
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("checkout_sessions")
      .withIndex("by_checkout_id", (q) => q.eq("checkoutId", args.checkoutId))
      .unique();
    return session ? withoutSystemFields(session) : null;
  },
});

export const listCheckoutSessions = query({
  args: { customerProfileId: v.string() },
  returns: v.array(checkoutSessionValidator),
  handler: async (ctx, args) => {
    const sessions = await ctx.db
      .query("checkout_sessions")
      .withIndex("by_customer_profile_id", (q) =>
        q.eq("customerProfileId", args.customerProfileId),
      )
      .collect();
    return sessions.map(withoutSystemFields);
  },
});

export const listPaymentProfiles = query({
  args: { customerProfileId: v.string() },
  returns: v.array(paymentProfileValidator),
  handler: async (ctx, args) => {
    const profiles = await ctx.db
      .query("payment_profiles")
      .withIndex("by_customer_profile_id", (q) =>
        q.eq("customerProfileId", args.customerProfileId),
      )
      .collect();
    return profiles.map(withoutSystemFields);
  },
});

export const createOrUpdateCustomer = mutation({
  args: {
    customerProfileId: v.string(),
    email: v.optional(v.string()),
    name: v.optional(v.string()),
    metadata: v.optional(v.any()),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("customers")
      .withIndex("by_customer_profile_id", (q) =>
        q.eq("customerProfileId", args.customerProfileId),
      )
      .unique();

    const metadata = args.metadata as { userId?: unknown } | undefined;
    const userId = typeof metadata?.userId === "string" ? metadata.userId : undefined;

    if (existing) {
      await ctx.db.patch("customers", existing._id, {
        ...(args.email !== undefined && { email: args.email }),
        ...(args.name !== undefined && { name: args.name }),
        ...(args.metadata !== undefined && { metadata: args.metadata }),
        ...(userId !== undefined && { userId }),
      });
    } else {
      await ctx.db.insert("customers", {
        customerProfileId: args.customerProfileId,
        email: args.email,
        name: args.name,
        metadata: args.metadata,
        userId,
      });
    }
    return args.customerProfileId;
  },
});

export const updateSubscriptionMetadata = mutation({
  args: {
    subscriptionId: v.string(),
    metadata: v.any(),
    orgId: v.optional(v.string()),
    userId: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const subscription = await ctx.db
      .query("subscriptions")
      .withIndex("by_subscription_id", (q) =>
        q.eq("subscriptionId", args.subscriptionId),
      )
      .unique();

    if (!subscription) {
      throw new Error(`Subscription ${args.subscriptionId} not found in database`);
    }

    await ctx.db.patch("subscriptions", subscription._id, {
      metadata: args.metadata,
      ...(args.orgId !== undefined && { orgId: args.orgId }),
      ...(args.userId !== undefined && { userId: args.userId }),
    });
    return null;
  },
});
