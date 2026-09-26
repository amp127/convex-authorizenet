import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

const intervalUnit = v.union(v.literal("days"), v.literal("months"));

export default defineSchema({
  customers: defineTable({
    customerProfileId: v.string(),
    email: v.optional(v.string()),
    name: v.optional(v.string()),
    metadata: v.optional(v.any()),
    userId: v.optional(v.string()),
  })
    .index("by_customer_profile_id", ["customerProfileId"])
    .index("by_email", ["email"])
    .index("by_user_id", ["userId"]),

  payment_profiles: defineTable({
    customerPaymentProfileId: v.string(),
    customerProfileId: v.string(),
    brand: v.optional(v.string()),
    last4: v.optional(v.string()),
    isDefault: v.boolean(),
  })
    .index("by_customer_profile_id", ["customerProfileId"])
    .index("by_customer_payment_profile_id", ["customerPaymentProfileId"]),

  subscriptions: defineTable({
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
    orgId: v.optional(v.string()),
    userId: v.optional(v.string()),
  })
    .index("by_subscription_id", ["subscriptionId"])
    .index("by_customer_profile_id", ["customerProfileId"])
    .index("by_org_id", ["orgId"])
    .index("by_user_id", ["userId"]),

  checkout_sessions: defineTable({
    checkoutId: v.string(),
    customerProfileId: v.optional(v.string()),
    status: v.string(),
    mode: v.union(
      v.literal("payment"),
      v.literal("subscription"),
      v.literal("setup"),
    ),
    amount: v.number(),
    quantity: v.number(),
    planKey: v.optional(v.string()),
    intervalLength: v.optional(v.number()),
    intervalUnit: v.optional(intervalUnit),
    subscriptionId: v.optional(v.string()),
    metadata: v.optional(v.any()),
  })
    .index("by_checkout_id", ["checkoutId"])
    .index("by_customer_profile_id", ["customerProfileId"]),

  payments: defineTable({
    transId: v.string(),
    customerProfileId: v.optional(v.string()),
    subscriptionId: v.optional(v.string()),
    amount: v.number(),
    currency: v.string(),
    status: v.string(),
    created: v.number(),
    metadata: v.optional(v.any()),
    orgId: v.optional(v.string()),
    userId: v.optional(v.string()),
  })
    .index("by_trans_id", ["transId"])
    .index("by_customer_profile_id", ["customerProfileId"])
    .index("by_subscription_id", ["subscriptionId"])
    .index("by_org_id", ["orgId"])
    .index("by_user_id", ["userId"]),

  invoices: defineTable({
    transId: v.string(),
    subscriptionId: v.optional(v.string()),
    customerProfileId: v.string(),
    status: v.string(),
    amountDue: v.number(),
    amountPaid: v.number(),
    created: v.number(),
    metadata: v.optional(v.any()),
    orgId: v.optional(v.string()),
    userId: v.optional(v.string()),
  })
    .index("by_trans_id", ["transId"])
    .index("by_customer_profile_id", ["customerProfileId"])
    .index("by_subscription_id", ["subscriptionId"])
    .index("by_org_id", ["orgId"])
    .index("by_user_id", ["userId"]),

  webhook_events: defineTable({
    notificationId: v.string(),
    eventType: v.string(),
  }).index("by_notification_id", ["notificationId"]),
});
