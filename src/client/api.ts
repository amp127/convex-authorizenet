import { dollarsToCents } from "./money.js";
import type { IntervalUnit } from "./billing.js";

export type Environment = "sandbox" | "production";

export type AuthorizeNetEndpoints = {
  api: string;
  paymentForm: string;
  profileForm: string;
};

export function endpointsFor(environment: Environment): AuthorizeNetEndpoints {
  if (environment === "production") {
    return {
      api: "https://api.authorize.net/xml/v1/request.api",
      paymentForm: "https://accept.authorize.net/payment/payment",
      profileForm: "https://accept.authorize.net/customer/manage",
    };
  }
  return {
    api: "https://apitest.authorize.net/xml/v1/request.api",
    paymentForm: "https://test.authorize.net/payment/payment",
    profileForm: "https://test.authorize.net/customer/manage",
  };
}

export class AuthorizeNetError extends Error {
  readonly code: string | undefined;

  constructor(message: string, code?: string) {
    super(message);
    this.name = "AuthorizeNetError";
    this.code = code;
  }
}

export type GatewayPaymentProfile = {
  customerPaymentProfileId: string;
  brand?: string;
  last4?: string;
};

export type GatewayCustomer = {
  customerProfileId: string;
  email?: string;
  description?: string;
  paymentProfiles: GatewayPaymentProfile[];
};

export type GatewaySubscription = {
  subscriptionId: string;
  status: string;
  amountCents: number;
  intervalLength: number;
  intervalUnit: IntervalUnit;
  startDate?: string;
  customerProfileId?: string;
  customerPaymentProfileId?: string;
  name?: string;
  completedPayments: number;
  latestTransId?: string;
};

export type PaymentAccountType = "card" | "bank";

export type HostedPaymentMethods = {
  card?: boolean;
  bankAccount?: boolean;
};

export type GatewayTransaction = {
  transId: string;
  refTransId?: string;
  responseCode?: number;
  amountCents: number;
  customerProfileId?: string;
  customerPaymentProfileId?: string;
  subscriptionId?: string;
  invoiceNumber?: string;
  submitTimeUTC?: string;
  /** Card brand, or bank account type such as checking. */
  cardType?: string;
  last4?: string;
  accountType?: PaymentAccountType;
  transactionStatus?: string;
};

type JsonObject = Record<string, unknown>;

function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function asObject(value: unknown): JsonObject | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as JsonObject;
}

function asString(value: unknown): string | undefined {
  if (typeof value === "string" && value.length > 0) return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && !Number.isNaN(Number(value))) {
    return Number(value);
  }
  return undefined;
}

export function parseAuthorizeNetJson(text: string): JsonObject {
  const cleaned = text.replace(/^\uFEFF/, "").trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new AuthorizeNetError("Authorize.net returned invalid JSON");
  }
  const body = asObject(parsed);
  if (!body) {
    throw new AuthorizeNetError("Authorize.net returned an unexpected payload");
  }
  return body;
}

function assertOk(body: JsonObject): void {
  const messages = asObject(body.messages);
  const resultCode = asString(messages?.resultCode);
  if (resultCode && resultCode !== "Ok") {
    const list = asArray(asObject(messages?.message) ? [messages?.message as JsonObject] : (messages?.message as JsonObject[] | undefined));
    const text = list
      .map((message) => asString(asObject(message)?.text))
      .filter((value): value is string => Boolean(value))
      .join("; ");
    const code = asString(asObject(list[0])?.code);
    throw new AuthorizeNetError(text || "Authorize.net request failed", code);
  }
}

export function cardLast4(cardNumber: string | undefined): string | undefined {
  if (!cardNumber) return undefined;
  const digits = cardNumber.replace(/\D/g, "");
  if (digits.length < 4) return undefined;
  return digits.slice(-4);
}

function parsePaymentInstrument(payment: JsonObject | undefined): {
  accountType?: PaymentAccountType;
  brand?: string;
  last4?: string;
} {
  const card = asObject(payment?.creditCard);
  if (card) {
    return {
      accountType: "card",
      brand: asString(card.cardType),
      last4: cardLast4(asString(card.cardNumber)),
    };
  }
  const bank = asObject(payment?.bankAccount);
  if (bank) {
    return {
      accountType: "bank",
      brand: asString(bank.accountType),
      last4: cardLast4(asString(bank.accountNumber)),
    };
  }
  return {};
}

export function hostedPaymentMethodFlags(
  methods?: HostedPaymentMethods,
): { showCreditCard: boolean; showBankAccount: boolean } {
  const showCreditCard = methods?.card ?? true;
  const showBankAccount = methods?.bankAccount ?? false;
  if (!showCreditCard && !showBankAccount) {
    throw new Error("At least one hosted payment method must be enabled");
  }
  return { showCreditCard, showBankAccount };
}

function parsePaymentProfile(value: unknown): GatewayPaymentProfile | undefined {
  const profile = asObject(value);
  const customerPaymentProfileId = asString(profile?.customerPaymentProfileId);
  if (!profile || !customerPaymentProfileId) return undefined;
  const instrument = parsePaymentInstrument(asObject(profile.payment));
  return {
    customerPaymentProfileId,
    brand: instrument.brand,
    last4: instrument.last4,
  };
}

export function parseCustomerProfile(body: JsonObject): GatewayCustomer {
  const profile = asObject(body.profile);
  const customerProfileId = asString(profile?.customerProfileId);
  if (!profile || !customerProfileId) {
    throw new AuthorizeNetError("Authorize.net did not return a customer profile");
  }
  const paymentProfiles = asArray(profile.paymentProfiles)
    .map(parsePaymentProfile)
    .filter((item): item is GatewayPaymentProfile => Boolean(item));
  return {
    customerProfileId,
    email: asString(profile.email),
    description: asString(profile.description),
    paymentProfiles,
  };
}

function parseIntervalUnit(value: unknown): IntervalUnit {
  return value === "days" ? "days" : "months";
}

export function parseSubscription(
  body: JsonObject,
  subscriptionId: string,
): GatewaySubscription {
  const subscription = asObject(body.subscription);
  if (!subscription) {
    throw new AuthorizeNetError("Authorize.net did not return a subscription");
  }
  const schedule = asObject(subscription.paymentSchedule);
  const interval = asObject(schedule?.interval);
  const profile = asObject(subscription.profile);
  const paymentProfile = asObject(profile?.paymentProfile) ?? asObject(profile?.customerPaymentProfile);
  const transactions = asArray(subscription.arbTransactions)
    .map(asObject)
    .filter((item): item is JsonObject => Boolean(item));
  const successful = transactions.filter((transaction) => {
    const response = asString(transaction.response) ?? "";
    return !/declin|fail|error/i.test(response);
  });
  const latest = successful[successful.length - 1] ?? transactions[transactions.length - 1];
  const amount = asNumber(subscription.amount) ?? 0;
  return {
    subscriptionId: asString(subscription.id) ?? asString(body.subscriptionId) ?? subscriptionId,
    status: asString(subscription.status) ?? "active",
    amountCents: dollarsToCents(amount),
    intervalLength: asNumber(interval?.length) ?? 1,
    intervalUnit: parseIntervalUnit(interval?.unit),
    startDate: asString(schedule?.startDate),
    customerProfileId: asString(profile?.customerProfileId),
    customerPaymentProfileId: asString(
      paymentProfile?.customerPaymentProfileId,
    ),
    name: asString(subscription.name),
    completedPayments: successful.length,
    latestTransId: asString(latest?.transId),
  };
}

export function parseTransaction(body: JsonObject): GatewayTransaction {
  const transaction = asObject(body.transaction);
  const transId = asString(transaction?.transId);
  if (!transaction || !transId) {
    throw new AuthorizeNetError("Authorize.net did not return a transaction");
  }
  const profile = asObject(transaction.profile);
  const order = asObject(transaction.order);
  const subscription = asObject(transaction.subscription);
  const payment = asObject(transaction.payment);
  const instrument = parsePaymentInstrument(payment);
  const amount = asNumber(transaction.settleAmount) ?? asNumber(transaction.authAmount) ?? 0;
  return {
    transId,
    refTransId: asString(transaction.refTransId),
    responseCode: asNumber(transaction.responseCode),
    amountCents: dollarsToCents(amount),
    customerProfileId: asString(profile?.customerProfileId),
    customerPaymentProfileId: asString(profile?.customerPaymentProfileId),
    subscriptionId: asString(subscription?.id),
    invoiceNumber: asString(order?.invoiceNumber),
    submitTimeUTC: asString(transaction.submitTimeUTC),
    cardType: instrument.brand,
    last4: instrument.last4,
    accountType: instrument.accountType,
    transactionStatus: asString(transaction.transactionStatus),
  };
}

export class AuthorizeNetClient {
  readonly endpoints: AuthorizeNetEndpoints;

  constructor(
    private readonly apiLoginId: string,
    private readonly transactionKey: string,
    environment: Environment,
  ) {
    this.endpoints = endpointsFor(environment);
  }

  private async request(requestKey: string, request: JsonObject): Promise<JsonObject> {
    const response = await fetch(this.endpoints.api, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        [requestKey]: {
          merchantAuthentication: {
            name: this.apiLoginId,
            transactionKey: this.transactionKey,
          },
          ...request,
        },
      }),
    });
    const body = parseAuthorizeNetJson(await response.text());
    assertOk(body);
    if (!response.ok) {
      throw new AuthorizeNetError(`Authorize.net request failed (${response.status})`);
    }
    return body;
  }

  async createCustomerProfile(args: {
    email?: string;
    description?: string;
  }): Promise<string> {
    const profile: JsonObject = {};
    if (args.email) profile.email = args.email;
    if (args.description) profile.description = args.description.slice(0, 255);
    if (!profile.email && !profile.description) {
      profile.description = "Customer";
    }
    const body = await this.request("createCustomerProfileRequest", { profile });
    const customerProfileId = asString(body.customerProfileId);
    if (!customerProfileId) {
      throw new AuthorizeNetError("Authorize.net did not return a customer profile id");
    }
    return customerProfileId;
  }

  async getCustomerProfile(customerProfileId: string): Promise<GatewayCustomer> {
    const body = await this.request("getCustomerProfileRequest", {
      customerProfileId,
    });
    return parseCustomerProfile(body);
  }

  async updateCustomerProfile(args: {
    customerProfileId: string;
    email?: string;
    description?: string;
  }): Promise<void> {
    const profile: JsonObject = { customerProfileId: args.customerProfileId };
    if (args.email) profile.email = args.email;
    if (args.description) profile.description = args.description.slice(0, 255);
    await this.request("updateCustomerProfileRequest", { profile });
  }

  async deleteCustomerProfile(customerProfileId: string): Promise<void> {
    await this.request("deleteCustomerProfileRequest", { customerProfileId });
  }

  async getHostedPaymentPage(args: {
    amount: string;
    invoiceNumber: string;
    description?: string;
    customerProfileId?: string;
    successUrl: string;
    cancelUrl: string;
    paymentMethods?: HostedPaymentMethods;
  }): Promise<string> {
    // transactionRequestType is an XSD sequence: profile must come before order.
    const transactionRequest: JsonObject = {
      transactionType: "authCaptureTransaction",
      amount: args.amount,
    };
    if (args.customerProfileId) {
      transactionRequest.profile = { customerProfileId: args.customerProfileId };
    }
    transactionRequest.order = {
      invoiceNumber: args.invoiceNumber,
      description: (args.description ?? args.invoiceNumber).slice(0, 255),
    };
    const body = await this.request("getHostedPaymentPageRequest", {
      transactionRequest,
      hostedPaymentSettings: {
        setting: [
          {
            settingName: "hostedPaymentReturnOptions",
            settingValue: JSON.stringify({
              showReceipt: true,
              url: args.successUrl,
              urlText: "Continue",
              cancelUrl: args.cancelUrl,
              cancelUrlText: "Cancel",
            }),
          },
          {
            settingName: "hostedPaymentButtonOptions",
            settingValue: JSON.stringify({ text: "Pay" }),
          },
          {
            settingName: "hostedPaymentPaymentOptions",
            settingValue: JSON.stringify({
              cardCodeRequired: true,
              ...hostedPaymentMethodFlags(args.paymentMethods),
            }),
          },
          {
            settingName: "hostedPaymentCustomerOptions",
            settingValue: JSON.stringify({ addPaymentProfile: true }),
          },
        ],
      },
    });
    const token = asString(body.token);
    if (!token) {
      throw new AuthorizeNetError("Authorize.net did not return a hosted payment token");
    }
    return token;
  }

  async getHostedProfilePage(args: {
    customerProfileId: string;
    returnUrl: string;
  }): Promise<string> {
    const body = await this.request("getHostedProfilePageRequest", {
      customerProfileId: args.customerProfileId,
      hostedProfileSettings: {
        setting: [
          {
            settingName: "hostedProfileReturnUrl",
            settingValue: args.returnUrl,
          },
          {
            settingName: "hostedProfileManageOptions",
            settingValue: "showPayment",
          },
        ],
      },
    });
    const token = asString(body.token);
    if (!token) {
      throw new AuthorizeNetError("Authorize.net did not return a hosted profile token");
    }
    return token;
  }

  async getTransactionDetails(transId: string): Promise<GatewayTransaction> {
    const body = await this.request("getTransactionDetailsRequest", { transId });
    return parseTransaction(body);
  }

  async createSubscription(args: {
    name: string;
    amount: string;
    intervalLength: number;
    intervalUnit: IntervalUnit;
    startDate: string;
    customerProfileId: string;
    customerPaymentProfileId: string;
    invoiceNumber?: string;
    description?: string;
  }): Promise<string> {
    // ARBSubscriptionType is an XSD sequence: order must come before profile.
    const subscription: JsonObject = {
      name: args.name.slice(0, 50),
      paymentSchedule: {
        interval: {
          length: args.intervalLength,
          unit: args.intervalUnit,
        },
        startDate: args.startDate,
        totalOccurrences: 9999,
      },
      amount: args.amount,
    };
    subscription.order = {
      invoiceNumber: args.invoiceNumber,
      description: args.description?.slice(0, 255),
    };
    subscription.profile = {
      customerProfileId: args.customerProfileId,
      customerPaymentProfileId: args.customerPaymentProfileId,
    };
    const body = await this.request("ARBCreateSubscriptionRequest", {
      subscription,
    });
    const subscriptionId = asString(body.subscriptionId);
    if (!subscriptionId) {
      throw new AuthorizeNetError("Authorize.net did not return a subscription id");
    }
    return subscriptionId;
  }

  async getSubscription(subscriptionId: string): Promise<GatewaySubscription> {
    const body = await this.request("ARBGetSubscriptionRequest", {
      subscriptionId,
      includeTransactions: true,
    });
    return parseSubscription(body, subscriptionId);
  }

  async updateSubscription(
    subscriptionId: string,
    update: { amount?: string; totalOccurrences?: number },
  ): Promise<void> {
    const subscription: JsonObject = {};
    if (update.amount !== undefined) subscription.amount = update.amount;
    if (update.totalOccurrences !== undefined) {
      subscription.paymentSchedule = {
        totalOccurrences: update.totalOccurrences,
      };
    }
    await this.request("ARBUpdateSubscriptionRequest", {
      subscriptionId,
      subscription,
    });
  }

  async cancelSubscription(subscriptionId: string): Promise<void> {
    await this.request("ARBCancelSubscriptionRequest", { subscriptionId });
  }
}
