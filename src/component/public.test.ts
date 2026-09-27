import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api.js";
import schema from "./schema.js";
import { modules } from "./setup.test.js";

test("customer creation and retrieval", async () => {
  const t = convexTest(schema, modules);

  const customerId = await t.mutation(api.public.createOrUpdateCustomer, {
    customerProfileId: "profile_123",
    email: "test@example.com",
    name: "Test User",
    metadata: { userId: "user_123" },
  });

  expect(customerId).toBe("profile_123");

  const customer = await t.query(api.public.getCustomer, {
    customerProfileId: "profile_123",
  });
  expect(customer?.email).toBe("test@example.com");
  expect(customer?.name).toBe("Test User");
  expect(customer?.userId).toBe("user_123");

  const byUser = await t.query(api.public.getCustomerByUserId, {
    userId: "user_123",
  });
  expect(byUser?.customerProfileId).toBe("profile_123");
});

test("customer update keeps the same profile id", async () => {
  const t = convexTest(schema, modules);

  await t.mutation(api.public.createOrUpdateCustomer, {
    customerProfileId: "profile_456",
    email: "old@example.com",
    name: "Old Name",
  });
  await t.mutation(api.public.createOrUpdateCustomer, {
    customerProfileId: "profile_456",
    email: "new@example.com",
    name: "New Name",
    metadata: { updated: true },
  });

  const customer = await t.query(api.public.getCustomer, {
    customerProfileId: "profile_456",
  });
  expect(customer?.email).toBe("new@example.com");
  expect(customer?.name).toBe("New Name");
  expect(customer?.metadata).toEqual({ updated: true });
});

test("customer deletion scrubs personal information", async () => {
  const t = convexTest(schema, modules);

  await t.mutation(api.private.handleCustomerCreated, {
    customerProfileId: "profile_delete",
    email: "gone@example.com",
    name: "Gone User",
    metadata: { userId: "user_delete" },
  });
  await t.mutation(api.private.handleCustomerDeleted, {
    customerProfileId: "profile_delete",
  });

  const customer = await t.query(api.public.getCustomer, {
    customerProfileId: "profile_delete",
  });
  expect(customer).not.toBeNull();
  expect(customer?.email).toBeUndefined();
  expect(customer?.name).toBeUndefined();
  expect(customer?.metadata).toEqual({});
  expect(customer?.userId).toBe("user_delete");
});

test("subscription stores quantity and cancel-at-period-end", async () => {
  const t = convexTest(schema, modules);

  await t.mutation(api.private.handleSubscriptionUpsert, {
    subscriptionId: "sub_seats",
    customerProfileId: "profile_seats",
    status: "active",
    amount: 8700,
    unitAmount: 2900,
    quantity: 3,
    intervalLength: 1,
    intervalUnit: "months",
    planKey: "hat_monthly",
    currentPeriodEnd: 1_800_000_000,
    cancelAtPeriodEnd: false,
    metadata: { userId: "user_seats", orgId: "org_seats" },
  });
  await t.mutation(api.private.updateSubscriptionQuantityInternal, {
    subscriptionId: "sub_seats",
    quantity: 5,
    amount: 14500,
  });
  await t.mutation(api.private.handleSubscriptionUpsert, {
    subscriptionId: "sub_seats",
    status: "active",
    cancelAtPeriodEnd: true,
    cancelAt: 1_800_000_000,
  });

  const subscription = await t.query(api.public.getSubscription, {
    subscriptionId: "sub_seats",
  });
  expect(subscription?.quantity).toBe(5);
  expect(subscription?.amount).toBe(14500);
  expect(subscription?.unitAmount).toBe(2900);
  expect(subscription?.cancelAtPeriodEnd).toBe(true);
  expect(subscription?.cancelAt).toBe(1_800_000_000);
  expect(subscription?.orgId).toBe("org_seats");

  const byOrg = await t.query(api.public.getSubscriptionByOrgId, {
    orgId: "org_seats",
  });
  expect(byOrg?.subscriptionId).toBe("sub_seats");
});

test("a gateway cancel does not clear an in-period cancel flag", async () => {
  const t = convexTest(schema, modules);
  const cancelAt = Math.floor(Date.now() / 1000) + 60 * 60 * 24;

  await t.mutation(api.private.handleSubscriptionUpsert, {
    subscriptionId: "sub_period",
    customerProfileId: "profile_period",
    status: "active",
    amount: 2900,
    unitAmount: 2900,
    quantity: 1,
    intervalLength: 1,
    intervalUnit: "months",
    planKey: "hat_monthly",
    currentPeriodEnd: cancelAt,
    cancelAtPeriodEnd: true,
    cancelAt,
  });
  await t.mutation(api.private.handleSubscriptionUpsert, {
    subscriptionId: "sub_period",
    status: "canceled",
  });

  const subscription = await t.query(api.public.getSubscription, {
    subscriptionId: "sub_period",
  });
  expect(subscription?.status).toBe("active");
  expect(subscription?.cancelAtPeriodEnd).toBe(true);
});

test("payment customer can be linked after the first write", async () => {
  const t = convexTest(schema, modules);

  await t.mutation(api.private.handlePaymentUpsert, {
    transId: "txn_guest",
    amount: 4900,
    currency: "usd",
    status: "succeeded",
    created: 1_700_000_000,
  });
  await t.mutation(api.private.handlePaymentUpsert, {
    transId: "txn_guest",
    customerProfileId: "profile_guest",
    amount: 4900,
    currency: "usd",
    status: "succeeded",
    created: 1_700_000_000,
    metadata: { userId: "user_guest", orgId: "org_guest" },
  });

  const payment = await t.query(api.public.getPayment, { transId: "txn_guest" });
  expect(payment?.customerProfileId).toBe("profile_guest");
  expect(payment?.userId).toBe("user_guest");
  expect(payment?.orgId).toBe("org_guest");

  const byUser = await t.query(api.public.listPaymentsByUserId, {
    userId: "user_guest",
  });
  expect(byUser).toHaveLength(1);
});

test("refund updates the original payment", async () => {
  const t = convexTest(schema, modules);

  await t.mutation(api.private.handlePaymentUpsert, {
    transId: "txn_original",
    amount: 4900,
    currency: "usd",
    status: "succeeded",
    created: 1_700_000_000,
  });
  await t.mutation(api.private.handlePaymentUpsert, {
    transId: "txn_refund",
    refTransId: "txn_original",
    amount: 4900,
    currency: "usd",
    status: "refunded",
    created: 1_700_000_100,
  });

  const original = await t.query(api.public.getPayment, {
    transId: "txn_original",
  });
  expect(original?.status).toBe("refunded");
});

test("bank payment stays pending until it settles", async () => {
  const t = convexTest(schema, modules);

  await t.mutation(api.private.handlePaymentUpsert, {
    transId: "txn_bank",
    amount: 2500,
    currency: "usd",
    status: "pending",
    accountType: "bank",
    transactionStatus: "capturedPendingSettlement",
    created: 1_700_000_000,
  });
  await t.mutation(api.private.handlePaymentUpsert, {
    transId: "txn_bank",
    amount: 2500,
    currency: "usd",
    status: "succeeded",
    accountType: "bank",
    transactionStatus: "settledSuccessfully",
    created: 1_700_000_000,
  });

  const payment = await t.query(api.public.getPayment, { transId: "txn_bank" });
  expect(payment?.status).toBe("succeeded");
  expect(payment?.accountType).toBe("bank");
  expect(payment?.transactionStatus).toBe("settledSuccessfully");
});

test("invoice status does not move backwards from paid", async () => {
  const t = convexTest(schema, modules);

  await t.mutation(api.private.handleInvoiceUpsert, {
    transId: "txn_invoice",
    customerProfileId: "profile_invoice",
    subscriptionId: "sub_invoice",
    status: "paid",
    amountDue: 2900,
    amountPaid: 2900,
    created: 1_700_000_000,
    metadata: { userId: "user_invoice" },
  });
  await t.mutation(api.private.handleInvoiceUpsert, {
    transId: "txn_invoice",
    customerProfileId: "profile_invoice",
    subscriptionId: "sub_invoice",
    status: "failed",
    amountDue: 0,
    amountPaid: 0,
    created: 1_700_000_100,
  });

  const invoices = await t.query(api.public.listInvoices, {
    customerProfileId: "profile_invoice",
  });
  expect(invoices).toHaveLength(1);
  expect(invoices[0]?.status).toBe("paid");
  expect(invoices[0]?.amountPaid).toBe(2900);

  await t.mutation(api.private.handleInvoiceUpsert, {
    transId: "txn_retry",
    customerProfileId: "profile_invoice",
    status: "failed",
    amountDue: 2900,
    amountPaid: 0,
    created: 1_700_000_200,
  });
  await t.mutation(api.private.handleInvoiceUpsert, {
    transId: "txn_retry",
    customerProfileId: "profile_invoice",
    status: "paid",
    amountDue: 2900,
    amountPaid: 2900,
    created: 1_700_000_300,
  });
  const allInvoices = await t.query(api.public.listInvoices, {
    customerProfileId: "profile_invoice",
  });
  expect(allInvoices.find((invoice) => invoice.transId === "txn_retry")?.status).toBe(
    "paid",
  );
});

test("duplicate webhook notifications are ignored until released", async () => {
  const t = convexTest(schema, modules);

  const first = await t.mutation(api.private.claimWebhookNotification, {
    notificationId: "notice_1",
    eventType: "net.authorize.payment.authcapture.created",
  });
  const second = await t.mutation(api.private.claimWebhookNotification, {
    notificationId: "notice_1",
    eventType: "net.authorize.payment.authcapture.created",
  });
  expect(first).toBe(true);
  expect(second).toBe(false);

  await t.mutation(api.private.releaseWebhookNotification, {
    notificationId: "notice_1",
  });
  const third = await t.mutation(api.private.claimWebhookNotification, {
    notificationId: "notice_1",
    eventType: "net.authorize.payment.authcapture.created",
  });
  expect(third).toBe(true);
});
