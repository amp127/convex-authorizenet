import { httpActionGeneric } from "convex/server";
import {
  AuthorizeNetClient,
  type Environment,
  type GatewayCustomer,
  type GatewaySubscription,
} from "./api.js";
import {
  addInterval,
  createCheckoutId,
  currentPeriodEndUnix,
  mapSubscriptionStatus,
  paymentStatusFromEvent,
  type BillingInterval,
  type IntervalUnit,
} from "./billing.js";
import { centsToDollars } from "./money.js";
import { verifyWebhookSignature } from "./signature.js";
import type {
  ActionCtx,
  AuthorizeNetEventHandlers,
  AuthorizeNetNotification,
  HttpRouter,
  RegisterRoutesConfig,
} from "./types.js";
import type { ComponentApi } from "../component/_generated/component.js";

export type AuthorizeNetComponent = ComponentApi;

export type { RegisterRoutesConfig, AuthorizeNetEventHandlers, AuthorizeNetNotification };

const OPEN_ENDED_OCCURRENCES = 9999;

type CheckoutSession = {
  checkoutId: string;
  customerProfileId?: string;
  status: string;
  mode: "payment" | "subscription" | "setup";
  amount: number;
  quantity: number;
  planKey?: string;
  intervalLength?: number;
  intervalUnit?: IntervalUnit;
  subscriptionId?: string;
  metadata?: Record<string, unknown>;
};

type StoredSubscription = {
  subscriptionId: string;
  customerProfileId: string;
  customerPaymentProfileId?: string;
  status: string;
  amount: number;
  unitAmount: number;
  quantity: number;
  intervalLength: number;
  intervalUnit: IntervalUnit;
  planKey: string;
  currentPeriodEnd: number;
  cancelAtPeriodEnd: boolean;
  cancelAt?: number;
  metadata?: Record<string, unknown>;
};

type Credentials = {
  apiLoginId?: string;
  transactionKey?: string;
  signatureKey?: string;
  environment: Environment;
  currency: string;
};

function environmentFrom(value: string | undefined): Environment {
  if (!value || value === "sandbox") return "sandbox";
  if (value === "production") return "production";
  throw new Error(
    "AUTHORIZENET_ENVIRONMENT must be sandbox or production",
  );
}

function credentialsFrom(options?: {
  apiLoginId?: string;
  transactionKey?: string;
  signatureKey?: string;
  environment?: Environment;
  currency?: string;
}): Credentials {
  return {
    apiLoginId: options?.apiLoginId ?? process.env.AUTHORIZENET_API_LOGIN_ID,
    transactionKey:
      options?.transactionKey ?? process.env.AUTHORIZENET_TRANSACTION_KEY,
    signatureKey: options?.signatureKey ?? process.env.AUTHORIZENET_SIGNATURE_KEY,
    environment:
      options?.environment ??
      environmentFrom(process.env.AUTHORIZENET_ENVIRONMENT),
    currency: options?.currency ?? "usd",
  };
}

function requireApiCredentials(credentials: Credentials): {
  apiLoginId: string;
  transactionKey: string;
} {
  if (!credentials.apiLoginId || !credentials.transactionKey) {
    throw new Error(
      "AUTHORIZENET_API_LOGIN_ID and AUTHORIZENET_TRANSACTION_KEY must be set",
    );
  }
  return {
    apiLoginId: credentials.apiLoginId,
    transactionKey: credentials.transactionKey,
  };
}

function isNotification(value: unknown): value is AuthorizeNetNotification {
  if (!value || typeof value !== "object") return false;
  const event = value as Partial<AuthorizeNetNotification>;
  return (
    typeof event.notificationId === "string" &&
    typeof event.eventType === "string" &&
    typeof event.eventDate === "string" &&
    typeof event.webhookId === "string" &&
    !!event.payload &&
    typeof event.payload === "object" &&
    (typeof event.payload.id === "string" || typeof event.payload.id === "number")
  );
}

function createdUnix(submitTimeUTC: string | undefined, eventDate: string): number {
  const parsed = Date.parse(submitTimeUTC ?? eventDate);
  if (Number.isNaN(parsed)) return Math.floor(Date.now() / 1000);
  return Math.floor(parsed / 1000);
}

/**
 * Authorize.net payments, customer profiles, and ARB subscriptions.
 *
 * API credentials stay in the app process. The component only stores synced records.
 * Authorize.net has no idempotency key, so two overlapping getOrCreateCustomer calls
 * for a brand-new user can create two customer profiles. Call it once per user.
 */
export class AuthorizeNet {
  private readonly credentials: Credentials;

  constructor(
    public component: AuthorizeNetComponent,
    options?: {
      apiLoginId?: string;
      transactionKey?: string;
      signatureKey?: string;
      environment?: Environment;
      currency?: string;
    },
  ) {
    this.credentials = credentialsFrom(options);
  }

  private gateway(): AuthorizeNetClient {
    const credentials = requireApiCredentials(this.credentials);
    return new AuthorizeNetClient(
      credentials.apiLoginId,
      credentials.transactionKey,
      this.credentials.environment,
    );
  }

  /**
   * Create a CIM customer profile and store it.
   * `userId` is kept in Convex metadata. Authorize.net's merchantCustomerId
   * field is limited to 20 characters and cannot hold a typical auth subject.
   */
  async createCustomer(
    ctx: ActionCtx,
    args: {
      email?: string;
      name?: string;
      metadata?: Record<string, string>;
    },
  ) {
    const customerProfileId = await this.gateway().createCustomerProfile({
      email: args.email,
      description: args.name,
    });
    await ctx.runMutation(this.component.public.createOrUpdateCustomer, {
      customerProfileId,
      email: args.email,
      name: args.name,
      metadata: args.metadata,
    });
    return { customerId: customerProfileId };
  }

  async getOrCreateCustomer(
    ctx: ActionCtx,
    args: {
      userId: string;
      email?: string;
      name?: string;
    },
  ) {
    const existingByUserId = await ctx.runQuery(
      this.component.public.getCustomerByUserId,
      { userId: args.userId },
    );
    if (existingByUserId) {
      return { customerId: existingByUserId.customerProfileId, isNew: false };
    }

    if (args.email) {
      const existingByEmail = await ctx.runQuery(
        this.component.public.getCustomerByEmail,
        { email: args.email },
      );
      if (existingByEmail) {
        return { customerId: existingByEmail.customerProfileId, isNew: false };
      }
    }

    const existingSubs = await ctx.runQuery(
      this.component.public.listSubscriptionsByUserId,
      { userId: args.userId },
    );
    if (existingSubs.length > 0) {
      return { customerId: existingSubs[0]!.customerProfileId, isNew: false };
    }

    const existingPayments = await ctx.runQuery(
      this.component.public.listPaymentsByUserId,
      { userId: args.userId },
    );
    if (existingPayments[0]?.customerProfileId) {
      return {
        customerId: existingPayments[0].customerProfileId,
        isNew: false,
      };
    }

    const created = await this.createCustomer(ctx, {
      email: args.email,
      name: args.name,
      metadata: { userId: args.userId },
    });
    return { customerId: created.customerId, isNew: true };
  }

  /**
   * Start an Accept Hosted payment, or a hosted profile page when mode is `setup`.
   * `amount` is the unit price in cents. The hosted form charges amount × quantity.
   * Subscription checkout records the plan locally, then the payment webhook creates the ARB subscription.
   */
  async createHostedCheckout(
    ctx: ActionCtx,
    args: {
      mode: "payment" | "subscription" | "setup";
      customerId?: string;
      successUrl: string;
      cancelUrl: string;
      amount?: number;
      quantity?: number;
      planKey?: string;
      interval?: BillingInterval;
      metadata?: Record<string, string>;
      subscriptionMetadata?: Record<string, string>;
    },
  ) {
    const quantity = args.quantity ?? 1;
    const metadata = {
      ...(args.metadata ?? {}),
      ...(args.mode === "subscription" ? (args.subscriptionMetadata ?? {}) : {}),
    };
    const checkoutId = createCheckoutId();
    const gateway = this.gateway();

    if (args.mode === "setup") {
      if (!args.customerId) {
        throw new Error("A customer profile is required to save a payment method");
      }
      await ctx.runMutation(this.component.private.insertCheckoutSession, {
        checkoutId,
        customerProfileId: args.customerId,
        mode: "setup",
        amount: 0,
        quantity: 1,
        metadata,
      });
      const token = await gateway.getHostedProfilePage({
        customerProfileId: args.customerId,
        returnUrl: args.successUrl,
      });
      return {
        checkoutId,
        token,
        formUrl: gateway.endpoints.profileForm,
      };
    }

    if (args.amount === undefined || !Number.isInteger(args.amount) || args.amount < 0) {
      throw new Error("amount must be a non-negative integer number of cents");
    }
    if (!Number.isInteger(quantity) || quantity < 1) {
      throw new Error("quantity must be a positive integer");
    }
    if (args.mode === "subscription") {
      if (!args.interval || !Number.isInteger(args.interval.length) || args.interval.length < 1) {
        throw new Error("interval is required for subscription checkout");
      }
    }

    await ctx.runMutation(this.component.private.insertCheckoutSession, {
      checkoutId,
      customerProfileId: args.customerId,
      mode: args.mode,
      amount: args.amount,
      quantity,
      planKey: args.planKey,
      intervalLength: args.interval?.length,
      intervalUnit: args.interval?.unit,
      metadata,
    });

    const token = await gateway.getHostedPaymentPage({
      amount: centsToDollars(args.amount * quantity),
      invoiceNumber: checkoutId,
      description: args.planKey,
      customerProfileId: args.customerId,
      successUrl: args.successUrl,
      cancelUrl: args.cancelUrl,
    });

    return {
      checkoutId,
      token,
      formUrl: gateway.endpoints.paymentForm,
    };
  }

  async createHostedProfilePage(
    _ctx: ActionCtx,
    args: {
      customerId: string;
      returnUrl: string;
    },
  ) {
    const gateway = this.gateway();
    const token = await gateway.getHostedProfilePage({
      customerProfileId: args.customerId,
      returnUrl: args.returnUrl,
    });
    return {
      token,
      formUrl: gateway.endpoints.profileForm,
    };
  }

  /**
   * Cancel immediately, or stop future ARB billings after the current cycle.
   * ARB has no cancel-at-period-end flag. Period-end cancel sets totalOccurrences
   * to the number of payments already collected and records the flag locally.
   */
  async cancelSubscription(
    ctx: ActionCtx,
    args: {
      subscriptionId: string;
      cancelAtPeriodEnd?: boolean;
    },
  ) {
    const cancelAtPeriodEnd = args.cancelAtPeriodEnd ?? true;
    const gateway = this.gateway();
    const remote = await gateway.getSubscription(args.subscriptionId);
    const local = await ctx.runQuery(this.component.public.getSubscription, {
      subscriptionId: args.subscriptionId,
    });

    if (!cancelAtPeriodEnd) {
      await gateway.cancelSubscription(args.subscriptionId);
      await syncSubscriptionRecord(ctx, this.component, remote, {
        status: "canceled",
        cancelAtPeriodEnd: false,
        customerProfileId: remote.customerProfileId ?? local?.customerProfileId,
        unitAmount: local?.unitAmount,
        quantity: local?.quantity,
        planKey: local?.planKey ?? remote.name,
        metadata: local?.metadata,
      });
      return null;
    }

    await gateway.updateSubscription(args.subscriptionId, {
      totalOccurrences: remote.completedPayments,
    });
    const periodEnd = local?.currentPeriodEnd || currentPeriodEndUnix(remote);
    await syncSubscriptionRecord(ctx, this.component, remote, {
      status: "active",
      cancelAtPeriodEnd: true,
      cancelAt: periodEnd,
      currentPeriodEnd: periodEnd,
      customerProfileId: remote.customerProfileId ?? local?.customerProfileId,
      unitAmount: local?.unitAmount,
      quantity: local?.quantity,
      planKey: local?.planKey ?? remote.name,
      metadata: local?.metadata,
    });
    return null;
  }

  /**
   * Undo a period-end cancel by restoring an open-ended occurrence count.
   * This only works before Authorize.net has actually ended the subscription.
   */
  async reactivateSubscription(
    ctx: ActionCtx,
    args: {
      subscriptionId: string;
    },
  ) {
    const local = await ctx.runQuery(this.component.public.getSubscription, {
      subscriptionId: args.subscriptionId,
    });
    if (!local) throw new Error("Subscription not found");
    if (!local.cancelAtPeriodEnd) {
      throw new Error("Subscription is not set to cancel");
    }
    const nowSeconds = Math.floor(Date.now() / 1000);
    if (local.status === "canceled" && (local.cancelAt ?? 0) <= nowSeconds) {
      throw new Error("Subscription has already ended");
    }

    const gateway = this.gateway();
    const remote = await gateway.getSubscription(args.subscriptionId);
    if (mapSubscriptionStatus(remote.status) === "canceled") {
      throw new Error("Subscription has already ended");
    }
    await gateway.updateSubscription(args.subscriptionId, {
      totalOccurrences: OPEN_ENDED_OCCURRENCES,
    });
    await syncSubscriptionRecord(ctx, this.component, remote, {
      status: "active",
      cancelAtPeriodEnd: false,
      customerProfileId: remote.customerProfileId ?? local.customerProfileId,
      unitAmount: local.unitAmount,
      quantity: local.quantity,
      planKey: local.planKey,
      currentPeriodEnd: local.currentPeriodEnd,
      metadata: local.metadata,
    });
    return null;
  }

  /**
   * Seat changes bill unitAmount × quantity. ARB stores a single amount and
   * cannot change the billing interval after creation.
   */
  async updateSubscriptionQuantity(
    ctx: ActionCtx,
    args: {
      subscriptionId: string;
      quantity: number;
    },
  ) {
    if (!Number.isInteger(args.quantity) || args.quantity < 1) {
      throw new Error("quantity must be a positive integer");
    }
    const local = await ctx.runQuery(this.component.public.getSubscription, {
      subscriptionId: args.subscriptionId,
    });
    if (!local) throw new Error("Subscription not found");

    const amount = local.unitAmount * args.quantity;
    await this.gateway().updateSubscription(args.subscriptionId, {
      amount: centsToDollars(amount),
    });
    await ctx.runMutation(this.component.private.updateSubscriptionQuantityInternal, {
      subscriptionId: args.subscriptionId,
      quantity: args.quantity,
      amount,
    });
    return null;
  }
}

async function syncCustomer(
  ctx: ActionCtx,
  component: AuthorizeNetComponent,
  profile: GatewayCustomer,
) {
  await ctx.runMutation(component.public.createOrUpdateCustomer, {
    customerProfileId: profile.customerProfileId,
    email: profile.email,
    name: profile.description,
  });
  for (const [index, paymentProfile] of profile.paymentProfiles.entries()) {
    await ctx.runMutation(component.private.upsertPaymentProfile, {
      customerProfileId: profile.customerProfileId,
      customerPaymentProfileId: paymentProfile.customerPaymentProfileId,
      brand: paymentProfile.brand,
      last4: paymentProfile.last4,
      isDefault: index === 0,
    });
  }
}

async function syncSubscriptionRecord(
  ctx: ActionCtx,
  component: AuthorizeNetComponent,
  remote: GatewaySubscription,
  overrides: {
    status: string;
    cancelAtPeriodEnd?: boolean;
    cancelAt?: number;
    currentPeriodEnd?: number;
    customerProfileId?: string;
    customerPaymentProfileId?: string;
    unitAmount?: number;
    quantity?: number;
    planKey?: string;
    metadata?: Record<string, unknown>;
  },
) {
  await ctx.runMutation(component.private.handleSubscriptionUpsert, {
    subscriptionId: remote.subscriptionId,
    customerProfileId: overrides.customerProfileId ?? remote.customerProfileId,
    customerPaymentProfileId:
      overrides.customerPaymentProfileId ?? remote.customerPaymentProfileId,
    status: overrides.status,
    amount: remote.amountCents,
    unitAmount: overrides.unitAmount,
    quantity: overrides.quantity,
    intervalLength: remote.intervalLength,
    intervalUnit: remote.intervalUnit,
    planKey: overrides.planKey ?? remote.name,
    currentPeriodEnd: overrides.currentPeriodEnd ?? currentPeriodEndUnix(remote),
    cancelAtPeriodEnd: overrides.cancelAtPeriodEnd,
    cancelAt: overrides.cancelAt,
    metadata: overrides.metadata,
  });
}

async function handleCustomerEvent(
  ctx: ActionCtx,
  component: AuthorizeNetComponent,
  event: AuthorizeNetNotification,
  gateway: AuthorizeNetClient,
) {
  const id = String(event.payload.id);
  if (event.eventType.endsWith(".deleted") && !event.eventType.includes("paymentProfile")) {
    await ctx.runMutation(component.private.handleCustomerDeleted, {
      customerProfileId: id,
    });
    return;
  }
  const customerProfileId = String(event.payload.customerProfileId ?? id);
  const profile = await gateway.getCustomerProfile(customerProfileId);
  await syncCustomer(ctx, component, profile);
}

async function handlePaymentProfileEvent(
  ctx: ActionCtx,
  component: AuthorizeNetComponent,
  event: AuthorizeNetNotification,
  gateway: AuthorizeNetClient,
) {
  if (event.eventType.endsWith(".deleted")) {
    await ctx.runMutation(component.private.handlePaymentProfileDeleted, {
      customerPaymentProfileId: String(event.payload.id),
    });
    return;
  }
  if (event.payload.customerProfileId === undefined) {
    throw new Error("Payment profile webhook is missing customerProfileId");
  }
  const profile = await gateway.getCustomerProfile(
    String(event.payload.customerProfileId),
  );
  await syncCustomer(ctx, component, profile);
}

async function handleSubscriptionEvent(
  ctx: ActionCtx,
  component: AuthorizeNetComponent,
  event: AuthorizeNetNotification,
  gateway: AuthorizeNetClient,
) {
  const subscriptionId = String(event.payload.id);
  const remote = await gateway.getSubscription(subscriptionId);
  const local = (await ctx.runQuery(component.public.getSubscription, {
    subscriptionId: remote.subscriptionId,
  })) as StoredSubscription | null;
  const failed = event.eventType.endsWith(".failed");
  await syncSubscriptionRecord(ctx, component, remote, {
    status: mapSubscriptionStatus(remote.status, failed),
    customerProfileId: remote.customerProfileId ?? local?.customerProfileId,
    metadata: local?.metadata,
    unitAmount: local?.unitAmount,
    quantity: local?.quantity,
    planKey: local?.planKey ?? remote.name,
  });

  const customerProfileId = remote.customerProfileId ?? local?.customerProfileId;
  if (failed && remote.latestTransId && customerProfileId) {
    const created = createdUnix(undefined, event.eventDate);
    await ctx.runMutation(component.private.handleInvoiceUpsert, {
      transId: remote.latestTransId,
      customerProfileId,
      subscriptionId: remote.subscriptionId,
      status: "failed",
      amountDue: remote.amountCents,
      amountPaid: 0,
      created,
      metadata: local?.metadata,
    });
  }
}

async function handlePaymentEvent(
  ctx: ActionCtx,
  component: AuthorizeNetComponent,
  event: AuthorizeNetNotification,
  gateway: AuthorizeNetClient,
  currency: string,
) {
  const transaction = await gateway.getTransactionDetails(String(event.payload.id));
  const status = paymentStatusFromEvent(
    event.eventType,
    transaction.responseCode ?? event.payload.responseCode,
  );
  const checkout = transaction.invoiceNumber
    ? ((await ctx.runQuery(component.public.getCheckoutSession, {
        checkoutId: transaction.invoiceNumber,
      })) as CheckoutSession | null)
    : null;

  let metadata = checkout?.metadata;
  if (!metadata && transaction.subscriptionId) {
    const linked = (await ctx.runQuery(component.public.getSubscription, {
      subscriptionId: transaction.subscriptionId,
    })) as StoredSubscription | null;
    metadata = linked?.metadata;
  }

  const created = createdUnix(transaction.submitTimeUTC, event.eventDate);
  await ctx.runMutation(component.private.handlePaymentUpsert, {
    transId: transaction.transId,
    refTransId: transaction.refTransId,
    customerProfileId: transaction.customerProfileId,
    subscriptionId: transaction.subscriptionId,
    amount: transaction.amountCents,
    currency,
    status,
    created,
    metadata,
  });

  if (transaction.customerProfileId && transaction.customerPaymentProfileId) {
    await ctx.runMutation(component.private.upsertPaymentProfile, {
      customerProfileId: transaction.customerProfileId,
      customerPaymentProfileId: transaction.customerPaymentProfileId,
      brand: transaction.cardType,
      last4: transaction.last4,
      isDefault: true,
    });
  }

  let subscriptionId = transaction.subscriptionId ?? checkout?.subscriptionId;
  if (
    checkout &&
    checkout.status === "open" &&
    checkout.mode === "subscription" &&
    !checkout.subscriptionId &&
    status === "succeeded" &&
    transaction.customerProfileId &&
    transaction.customerPaymentProfileId &&
    checkout.intervalLength &&
    checkout.intervalUnit
  ) {
    const interval = {
      length: checkout.intervalLength,
      unit: checkout.intervalUnit,
    };
    const startDate = addInterval(new Date(), interval);
    subscriptionId = await gateway.createSubscription({
      name: checkout.planKey || "Subscription",
      amount: centsToDollars(checkout.amount * checkout.quantity),
      intervalLength: interval.length,
      intervalUnit: interval.unit,
      startDate,
      customerProfileId: transaction.customerProfileId,
      customerPaymentProfileId: transaction.customerPaymentProfileId,
      invoiceNumber: checkout.checkoutId,
      description: checkout.planKey,
    });
    await ctx.runMutation(component.private.handleSubscriptionUpsert, {
      subscriptionId,
      customerProfileId: transaction.customerProfileId,
      customerPaymentProfileId: transaction.customerPaymentProfileId,
      status: "active",
      amount: checkout.amount * checkout.quantity,
      unitAmount: checkout.amount,
      quantity: checkout.quantity,
      intervalLength: interval.length,
      intervalUnit: interval.unit,
      planKey: checkout.planKey ?? "",
      currentPeriodEnd: currentPeriodEndUnix({
        startDate,
        intervalLength: interval.length,
        intervalUnit: interval.unit,
      }),
      cancelAtPeriodEnd: false,
      metadata: checkout.metadata,
    });
  }

  if (checkout && checkout.status === "open" && status === "succeeded") {
    await ctx.runMutation(component.private.handleCheckoutCompleted, {
      checkoutId: checkout.checkoutId,
      customerProfileId: transaction.customerProfileId ?? checkout.customerProfileId,
      subscriptionId,
    });
  }

  const customerProfileId = transaction.customerProfileId ?? checkout?.customerProfileId;
  const invoiceSubscriptionId = subscriptionId;
  const isSubscriptionCharge =
    Boolean(invoiceSubscriptionId) &&
    (checkout?.mode === "subscription" || Boolean(transaction.subscriptionId));
  if (
    isSubscriptionCharge &&
    customerProfileId &&
    invoiceSubscriptionId &&
    (status === "succeeded" || status === "failed")
  ) {
    const invoiceStatus =
      status === "succeeded" ? "paid" : status === "failed" ? "failed" : "open";
    await ctx.runMutation(component.private.handleInvoiceUpsert, {
      transId: transaction.transId,
      customerProfileId,
      subscriptionId: invoiceSubscriptionId,
      status: invoiceStatus,
      amountDue: transaction.amountCents,
      amountPaid: invoiceStatus === "paid" ? transaction.amountCents : 0,
      created,
      metadata,
    });
  }
}

/**
 * Apply an Authorize.net webhook notification to the component tables.
 * Notifications only carry an id, so this reads the customer, subscription, or
 * transaction before writing. A repeated notificationId is ignored.
 */
export async function processEvent(
  ctx: ActionCtx,
  component: AuthorizeNetComponent,
  event: AuthorizeNetNotification,
  gateway: AuthorizeNetClient,
  options?: { currency?: string },
): Promise<void> {
  const claimed = await ctx.runMutation(component.private.claimWebhookNotification, {
    notificationId: event.notificationId,
    eventType: event.eventType,
  });
  if (!claimed) return;

  try {
    if (event.eventType.includes(".paymentProfile.")) {
      await handlePaymentProfileEvent(ctx, component, event, gateway);
    } else if (event.eventType.includes(".subscription.")) {
      await handleSubscriptionEvent(ctx, component, event, gateway);
    } else if (event.eventType.startsWith("net.authorize.customer.")) {
      await handleCustomerEvent(ctx, component, event, gateway);
    } else if (event.eventType.startsWith("net.authorize.payment.")) {
      await handlePaymentEvent(
        ctx,
        component,
        event,
        gateway,
        options?.currency ?? "usd",
      );
    } else {
      console.log(`Unhandled Authorize.net event: ${event.eventType}`);
    }
  } catch (error) {
    await ctx.runMutation(component.private.releaseWebhookNotification, {
      notificationId: event.notificationId,
    });
    throw error;
  }
}

export async function handleWebhookRequest(
  ctx: ActionCtx,
  component: AuthorizeNetComponent,
  req: Request,
  config?: RegisterRoutesConfig,
): Promise<Response> {
  const credentials = credentialsFrom(config);
  if (!credentials.signatureKey) {
    console.error("AUTHORIZENET_SIGNATURE_KEY is not set");
    return new Response("Webhook signature key not configured", { status: 500 });
  }
  const apiCredentials = (() => {
    try {
      return requireApiCredentials(credentials);
    } catch (error) {
      console.error(error);
      return undefined;
    }
  })();
  if (!apiCredentials) {
    return new Response("Authorize.net API credentials are not configured", {
      status: 500,
    });
  }

  const signature = req.headers.get("X-ANET-Signature");
  if (!signature) {
    console.error("No Authorize.net signature in headers");
    return new Response("No signature provided", { status: 400 });
  }

  const body = await req.text();
  const valid = await verifyWebhookSignature(body, signature, credentials.signatureKey);
  if (!valid) {
    console.error("Webhook signature verification failed");
    return new Response("Webhook signature verification failed", { status: 400 });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return new Response("Invalid webhook payload", { status: 400 });
  }
  if (!isNotification(parsed)) {
    return new Response("Invalid webhook payload", { status: 400 });
  }

  const gateway = new AuthorizeNetClient(
    apiCredentials.apiLoginId,
    apiCredentials.transactionKey,
    credentials.environment,
  );

  try {
    await processEvent(ctx, component, parsed, gateway, {
      currency: credentials.currency,
    });
    if (config?.onEvent) {
      await config.onEvent(ctx, parsed);
    }
    const customHandler = config?.events?.[parsed.eventType];
    if (customHandler) {
      await customHandler(ctx, parsed);
    }
  } catch (error) {
    console.error("Error processing webhook", error);
    return new Response("Error processing webhook", { status: 500 });
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

export function registerRoutes(
  http: HttpRouter,
  component: AuthorizeNetComponent,
  config?: RegisterRoutesConfig,
) {
  const webhookPath = config?.webhookPath ?? "/authorizenet/webhook";
  http.route({
    path: webhookPath,
    method: "POST",
    handler: httpActionGeneric(async (ctx, req) => {
      return await handleWebhookRequest(ctx, component, req, config);
    }),
  });
}

export default AuthorizeNet;
