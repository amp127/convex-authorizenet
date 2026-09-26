/**
 * Benji's Store - Authorize.net integration
 *
 * Demonstrates the @convex-dev/authorizenet component with Clerk authentication.
 */

import { action, mutation, query } from "./_generated/server";
import { components } from "./_generated/api";
import { AuthorizeNet } from "@convex-dev/authorizenet";
import { v } from "convex/values";

const payments = new AuthorizeNet(components.authorizenet, {});

const intervalUnit = v.union(v.literal("days"), v.literal("months"));

const subscriptionResult = v.object({
  subscriptionId: v.string(),
  customerProfileId: v.string(),
  customerPaymentProfileId: v.optional(v.string()),
  status: v.string(),
  amount: v.number(),
  unitAmount: v.number(),
  quantity: v.number(),
  intervalLength: v.number(),
  intervalUnit,
  planKey: v.string(),
  currentPeriodEnd: v.number(),
  cancelAtPeriodEnd: v.boolean(),
  cancelAt: v.optional(v.number()),
  metadata: v.optional(v.any()),
  userId: v.optional(v.string()),
  orgId: v.optional(v.string()),
});

const paymentResult = v.object({
  transId: v.string(),
  customerProfileId: v.optional(v.string()),
  subscriptionId: v.optional(v.string()),
  amount: v.number(),
  currency: v.string(),
  status: v.string(),
  created: v.number(),
  metadata: v.optional(v.any()),
  userId: v.optional(v.string()),
  orgId: v.optional(v.string()),
});

const invoiceResult = v.object({
  transId: v.string(),
  customerProfileId: v.string(),
  subscriptionId: v.optional(v.string()),
  status: v.string(),
  amountDue: v.number(),
  amountPaid: v.number(),
  created: v.number(),
  metadata: v.optional(v.any()),
  orgId: v.optional(v.string()),
  userId: v.optional(v.string()),
});

const customerResult = v.object({
  customerProfileId: v.string(),
  email: v.optional(v.string()),
  name: v.optional(v.string()),
  metadata: v.optional(v.any()),
  userId: v.optional(v.string()),
});

const hostedFormResult = v.object({
  checkoutId: v.string(),
  token: v.string(),
  formUrl: v.string(),
});

function getAppUrl(): string {
  const url = process.env.APP_URL;
  if (!url) {
    throw new Error(
      "APP_URL environment variable is not set. Add it in your Convex dashboard.",
    );
  }
  return url;
}

export const getOrCreateCustomer = action({
  args: {},
  returns: v.object({
    customerId: v.string(),
    isNew: v.boolean(),
  }),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    return await payments.getOrCreateCustomer(ctx, {
      userId: identity.subject,
      email: identity.email,
      name: identity.name,
    });
  },
});

export const createSubscriptionCheckout = action({
  args: {
    amount: v.number(),
    planKey: v.string(),
    intervalLength: v.number(),
    intervalUnit,
    quantity: v.optional(v.number()),
  },
  returns: hostedFormResult,
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    const customer = await payments.getOrCreateCustomer(ctx, {
      userId: identity.subject,
      email: identity.email,
      name: identity.name,
    });

    return await payments.createHostedCheckout(ctx, {
      amount: args.amount,
      planKey: args.planKey,
      customerId: customer.customerId,
      mode: "subscription",
      quantity: args.quantity,
      interval: { length: args.intervalLength, unit: args.intervalUnit },
      successUrl: `${getAppUrl()}/?success=true`,
      cancelUrl: `${getAppUrl()}/?canceled=true`,
      metadata: {
        userId: identity.subject,
        productType: "hat_subscription",
      },
      subscriptionMetadata: {
        userId: identity.subject,
      },
    });
  },
});

export const createTeamSubscriptionCheckout = action({
  args: {
    amount: v.number(),
    planKey: v.string(),
    intervalLength: v.number(),
    intervalUnit,
    orgId: v.string(),
    quantity: v.optional(v.number()),
  },
  returns: hostedFormResult,
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    const customer = await payments.getOrCreateCustomer(ctx, {
      userId: identity.subject,
      email: identity.email,
      name: identity.name,
    });

    return await payments.createHostedCheckout(ctx, {
      amount: args.amount,
      planKey: args.planKey,
      customerId: customer.customerId,
      mode: "subscription",
      quantity: args.quantity ?? 1,
      interval: { length: args.intervalLength, unit: args.intervalUnit },
      successUrl: `${getAppUrl()}/?success=true&org=${args.orgId}`,
      cancelUrl: `${getAppUrl()}/?canceled=true`,
      metadata: {
        userId: identity.subject,
        orgId: args.orgId,
        productType: "team_subscription",
      },
      subscriptionMetadata: {
        userId: identity.subject,
        orgId: args.orgId,
      },
    });
  },
});

export const createPaymentCheckout = action({
  args: {
    amount: v.number(),
    planKey: v.string(),
  },
  returns: hostedFormResult,
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    const customer = await payments.getOrCreateCustomer(ctx, {
      userId: identity.subject,
      email: identity.email,
      name: identity.name,
    });

    return await payments.createHostedCheckout(ctx, {
      amount: args.amount,
      planKey: args.planKey,
      customerId: customer.customerId,
      mode: "payment",
      successUrl: `${getAppUrl()}/?success=true`,
      cancelUrl: `${getAppUrl()}/?canceled=true`,
      metadata: {
        userId: identity.subject,
        productType: "hat",
      },
    });
  },
});

export const updateSeats = action({
  args: {
    subscriptionId: v.string(),
    seatCount: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    const subscription = await ctx.runQuery(
      components.authorizenet.public.getSubscription,
      { subscriptionId: args.subscriptionId },
    );

    if (!subscription || subscription.userId !== identity.subject) {
      throw new Error("Subscription not found or access denied");
    }

    await payments.updateSubscriptionQuantity(ctx, {
      subscriptionId: args.subscriptionId,
      quantity: args.seatCount,
    });
    return null;
  },
});

export const getOrgSubscription = query({
  args: { orgId: v.string() },
  returns: v.union(subscriptionResult, v.null()),
  handler: async (ctx, args) => {
    return await ctx.runQuery(
      components.authorizenet.public.getSubscriptionByOrgId,
      { orgId: args.orgId },
    );
  },
});

export const getOrgPayments = query({
  args: { orgId: v.string() },
  returns: v.array(paymentResult),
  handler: async (ctx, args) => {
    return await ctx.runQuery(components.authorizenet.public.listPaymentsByOrgId, {
      orgId: args.orgId,
    });
  },
});

export const getOrgInvoices = query({
  args: { orgId: v.string() },
  returns: v.array(invoiceResult),
  handler: async (ctx, args) => {
    return await ctx.runQuery(components.authorizenet.public.listInvoicesByOrgId, {
      orgId: args.orgId,
    });
  },
});

export const linkSubscriptionToOrg = mutation({
  args: {
    subscriptionId: v.string(),
    orgId: v.string(),
    userId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.runMutation(
      components.authorizenet.public.updateSubscriptionMetadata,
      {
        subscriptionId: args.subscriptionId,
        orgId: args.orgId,
        userId: args.userId,
        metadata: {
          linkedAt: new Date().toISOString(),
        },
      },
    );
    return null;
  },
});

export const getSubscriptionInfo = query({
  args: { subscriptionId: v.string() },
  returns: v.union(subscriptionResult, v.null()),
  handler: async (ctx, args) => {
    return await ctx.runQuery(components.authorizenet.public.getSubscription, {
      subscriptionId: args.subscriptionId,
    });
  },
});

export const cancelSubscription = action({
  args: {
    subscriptionId: v.string(),
    immediately: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    const subscription = await ctx.runQuery(
      components.authorizenet.public.getSubscription,
      { subscriptionId: args.subscriptionId },
    );

    if (!subscription || subscription.userId !== identity.subject) {
      throw new Error("Subscription not found or access denied");
    }

    await payments.cancelSubscription(ctx, {
      subscriptionId: args.subscriptionId,
      cancelAtPeriodEnd: !args.immediately,
    });
    return null;
  },
});

export const reactivateSubscription = action({
  args: { subscriptionId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    const subscription = await ctx.runQuery(
      components.authorizenet.public.getSubscription,
      { subscriptionId: args.subscriptionId },
    );

    if (!subscription || subscription.userId !== identity.subject) {
      throw new Error("Subscription not found or access denied");
    }

    if (!subscription.cancelAtPeriodEnd) {
      throw new Error("Subscription is not set to cancel");
    }

    await payments.reactivateSubscription(ctx, {
      subscriptionId: args.subscriptionId,
    });
    return null;
  },
});

export const getPaymentProfilePage = action({
  args: {},
  returns: v.union(
    v.object({
      token: v.string(),
      formUrl: v.string(),
    }),
    v.null(),
  ),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    const subscriptions = await ctx.runQuery(
      components.authorizenet.public.listSubscriptionsByUserId,
      { userId: identity.subject },
    );

    if (subscriptions.length > 0) {
      return await payments.createHostedProfilePage(ctx, {
        customerId: subscriptions[0].customerProfileId,
        returnUrl: `${getAppUrl()}/`,
      });
    }

    const customerPayments = await ctx.runQuery(
      components.authorizenet.public.listPaymentsByUserId,
      { userId: identity.subject },
    );

    if (customerPayments.length > 0 && customerPayments[0].customerProfileId) {
      return await payments.createHostedProfilePage(ctx, {
        customerId: customerPayments[0].customerProfileId,
        returnUrl: `${getAppUrl()}/`,
      });
    }

    return null;
  },
});

export const getCustomerData = query({
  args: { customerId: v.string() },
  returns: v.object({
    customer: v.union(customerResult, v.null()),
    subscriptions: v.array(subscriptionResult),
    invoices: v.array(invoiceResult),
  }),
  handler: async (ctx, args) => {
    const customer = await ctx.runQuery(components.authorizenet.public.getCustomer, {
      customerProfileId: args.customerId,
    });
    const subscriptions = await ctx.runQuery(
      components.authorizenet.public.listSubscriptions,
      { customerProfileId: args.customerId },
    );
    const invoices = await ctx.runQuery(components.authorizenet.public.listInvoices, {
      customerProfileId: args.customerId,
    });
    return { customer, subscriptions, invoices };
  },
});

export const getUserSubscriptions = query({
  args: {},
  returns: v.array(subscriptionResult),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];

    return await ctx.runQuery(
      components.authorizenet.public.listSubscriptionsByUserId,
      { userId: identity.subject },
    );
  },
});

export const getUserPayments = query({
  args: {},
  returns: v.array(paymentResult),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];

    return await ctx.runQuery(components.authorizenet.public.listPaymentsByUserId, {
      userId: identity.subject,
    });
  },
});

export const getFailedPaymentSubscriptions = query({
  args: {},
  returns: v.array(
    v.object({
      subscriptionId: v.string(),
      customerProfileId: v.string(),
      status: v.string(),
      currentPeriodEnd: v.number(),
    }),
  ),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];

    const subscriptions = await ctx.runQuery(
      components.authorizenet.public.listSubscriptionsByUserId,
      { userId: identity.subject },
    );

    return subscriptions
      .filter((sub) => sub.status === "past_due")
      .map((sub) => ({
        subscriptionId: sub.subscriptionId,
        customerProfileId: sub.customerProfileId,
        status: sub.status,
        currentPeriodEnd: sub.currentPeriodEnd,
      }));
  },
});
