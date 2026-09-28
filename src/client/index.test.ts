import { describe, expect, test, vi, afterEach } from "vitest";
import { AuthorizeNetClient, parseTransaction, assertHostedReturnUrl } from "./api.js";
import { mapSubscriptionStatus, resolvePaymentStatus } from "./billing.js";
import {
  AuthorizeNet,
  handleWebhookRequest,
  processEvent,
  registerRoutes,
} from "./index.js";
import { centsToDollars, dollarsToCents } from "./money.js";
import { verifyWebhookSignature } from "./signature.js";
import type { ActionCtx } from "./types.js";
import { components } from "./setup.test.js";

const credentials = {
  apiLoginId: "login",
  transactionKey: "transaction-key",
  signatureKey: "00112233445566778899aabbccddeeff",
  environment: "sandbox" as const,
};

function ok(body: Record<string, unknown>) {
  return {
    messages: {
      resultCode: "Ok",
      message: [{ code: "I00001", text: "Successful." }],
    },
    ...body,
  };
}

function jsonResponse(body: unknown, bom = false) {
  const text = `${bom ? "\uFEFF" : ""}${JSON.stringify(body)}`;
  return new Response(text, {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("money and status", () => {
  test("converts cents and dollars", () => {
    expect(centsToDollars(4900)).toBe("49.00");
    expect(centsToDollars(0)).toBe("0.00");
    expect(dollarsToCents("10.50")).toBe(1050);
    expect(dollarsToCents(27)).toBe(2700);
  });

  test("maps ARB statuses", () => {
    expect(mapSubscriptionStatus("active")).toBe("active");
    expect(mapSubscriptionStatus("suspended")).toBe("past_due");
    expect(mapSubscriptionStatus("expired")).toBe("canceled");
    expect(mapSubscriptionStatus("terminated")).toBe("canceled");
    expect(mapSubscriptionStatus("canceled")).toBe("canceled");
    expect(mapSubscriptionStatus("active", true)).toBe("past_due");
  });
});

describe("Authorize.net JSON client", () => {
  test("strips the response BOM before parsing", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(
        ok({
          token: "hosted-token",
        }),
        true,
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = new AuthorizeNetClient(
      credentials.apiLoginId,
      credentials.transactionKey,
      "sandbox",
    );
    const token = await client.getHostedPaymentPage({
      amount: "49.00",
      invoiceNumber: "c123",
      successUrl: "https://example.com/success",
      cancelUrl: "https://example.com/cancel",
    });

    expect(token).toBe("hosted-token");
    const hostedCall = fetchMock.mock.calls[0] as unknown as
      | [string, RequestInit]
      | undefined;
    const request = JSON.parse(String(hostedCall?.[1]?.body));
    expect(request.getHostedPaymentPageRequest.transactionRequest.amount).toBe(
      "49.00",
    );
    expect(
      request.getHostedPaymentPageRequest.transactionRequest.profile,
    ).toBeUndefined();
    const options = JSON.parse(
      request.getHostedPaymentPageRequest.hostedPaymentSettings.setting.find(
        (setting: { settingName: string }) =>
          setting.settingName === "hostedPaymentPaymentOptions",
      ).settingValue,
    );
    expect(options).toMatchObject({
      showCreditCard: true,
      showBankAccount: false,
    });
  });

  test("can show a bank account on Accept Hosted", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(ok({ token: "hosted-token" })));
    vi.stubGlobal("fetch", fetchMock);
    const client = new AuthorizeNetClient(
      credentials.apiLoginId,
      credentials.transactionKey,
      "sandbox",
    );
    await client.getHostedPaymentPage({
      amount: "10.00",
      invoiceNumber: "c123",
      successUrl: "https://example.com/success",
      cancelUrl: "https://example.com/cancel",
      paymentMethods: { card: true, bankAccount: true },
    });
    const hostedCall = fetchMock.mock.calls[0] as unknown as
      | [string, RequestInit]
      | undefined;
    const request = JSON.parse(String(hostedCall?.[1]?.body));
    const options = JSON.parse(
      request.getHostedPaymentPageRequest.hostedPaymentSettings.setting.find(
        (setting: { settingName: string }) =>
          setting.settingName === "hostedPaymentPaymentOptions",
      ).settingValue,
    );
    expect(options).toMatchObject({
      showCreditCard: true,
      showBankAccount: true,
    });
  });

  test("puts customerProfileId before order on Accept Hosted", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(ok({ token: "hosted-token" })));
    vi.stubGlobal("fetch", fetchMock);
    const client = new AuthorizeNetClient(
      credentials.apiLoginId,
      credentials.transactionKey,
      "sandbox",
    );
    await client.getHostedPaymentPage({
      amount: "10.00",
      invoiceNumber: "c123",
      customerProfileId: "123456",
      successUrl: "https://example.com/success",
      cancelUrl: "https://example.com/cancel",
    });
    const hostedCall = fetchMock.mock.calls[0] as unknown as
      | [string, RequestInit]
      | undefined;
    const request = JSON.parse(String(hostedCall?.[1]?.body));
    const transactionRequest =
      request.getHostedPaymentPageRequest.transactionRequest as Record<
        string,
        unknown
      >;
    expect(transactionRequest.profile).toEqual({ customerProfileId: "123456" });
    expect(Object.keys(transactionRequest)).toEqual([
      "transactionType",
      "amount",
      "profile",
      "order",
    ]);
  });

  test("rejects Accept Hosted return URLs with a query string or hash", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(ok({ token: "hosted-token" })));
    vi.stubGlobal("fetch", fetchMock);
    const client = new AuthorizeNetClient(
      credentials.apiLoginId,
      credentials.transactionKey,
      "sandbox",
    );
    const page = {
      amount: "10.00",
      invoiceNumber: "c123",
      cancelUrl: "https://example.com/cancel",
    };
    await expect(
      client.getHostedPaymentPage({
        ...page,
        successUrl: "https://example.com/?payment=sandbox",
      }),
    ).rejects.toThrow(/no query string or hash/);
    await expect(
      client.getHostedPaymentPage({
        ...page,
        successUrl: "https://example.com/#payment=sandbox",
      }),
    ).rejects.toThrow(/no query string or hash/);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(() =>
      assertHostedReturnUrl("https://example.com/return", "successUrl"),
    ).not.toThrow();
  });

  test("puts order before profile on ARB create", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(ok({ subscriptionId: "sub_1" })),
    );
    vi.stubGlobal("fetch", fetchMock);
    const client = new AuthorizeNetClient(
      credentials.apiLoginId,
      credentials.transactionKey,
      "sandbox",
    );
    await client.createSubscription({
      name: "hat_monthly",
      amount: "29.00",
      intervalLength: 1,
      intervalUnit: "months",
      startDate: "2026-10-27",
      customerProfileId: "123456",
      customerPaymentProfileId: "789",
      invoiceNumber: "ccheckout",
      description: "hat_monthly",
    });
    const createCall = fetchMock.mock.calls[0] as unknown as
      | [string, RequestInit]
      | undefined;
    const request = JSON.parse(String(createCall?.[1]?.body));
    const subscription = request.ARBCreateSubscriptionRequest
      .subscription as Record<string, unknown>;
    expect(subscription.order).toEqual({
      invoiceNumber: "ccheckout",
      description: "hat_monthly",
    });
    expect(subscription.profile).toEqual({
      customerProfileId: "123456",
      customerPaymentProfileId: "789",
    });
    expect(Object.keys(subscription)).toEqual([
      "name",
      "paymentSchedule",
      "amount",
      "order",
      "profile",
    ]);
  });

  test("reads a bank account from a transaction", () => {
    const transaction = parseTransaction({
      transaction: {
        transId: "txn_bank",
        responseCode: 1,
        authAmount: 12.5,
        transactionStatus: "capturedPendingSettlement",
        payment: {
          bankAccount: {
            accountType: "checking",
            accountNumber: "XXXX6789",
          },
        },
      },
    });
    expect(transaction.accountType).toBe("bank");
    expect(transaction.cardType).toBe("checking");
    expect(transaction.last4).toBe("6789");
    expect(transaction.transactionStatus).toBe("capturedPendingSettlement");
    expect(
      resolvePaymentStatus({
        eventType: "net.authorize.payment.authcapture.created",
        responseCode: 1,
        accountType: transaction.accountType,
        transactionStatus: transaction.transactionStatus,
      }),
    ).toBe("pending");
    expect(
      resolvePaymentStatus({
        eventType: "net.authorize.payment.authcapture.created",
        responseCode: 1,
        accountType: "bank",
        transactionStatus: "settledSuccessfully",
      }),
    ).toBe("succeeded");
    expect(
      resolvePaymentStatus({
        eventType: "net.authorize.payment.void.created",
        responseCode: 1,
        accountType: "bank",
        transactionStatus: "voided",
      }),
    ).toBe("voided");
    expect(
      resolvePaymentStatus({
        eventType: "net.authorize.payment.authcapture.created",
        responseCode: 1,
        accountType: "card",
        transactionStatus: "capturedPendingSettlement",
      }),
    ).toBe("succeeded");
  });

  test("charges a saved CIM payment profile as a subsequent auth", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(
        ok({
          transactionResponse: {
            transId: "txn_profile",
            responseCode: "1",
          },
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const client = new AuthorizeNetClient(
      credentials.apiLoginId,
      credentials.transactionKey,
      "sandbox",
    );
    const created = await client.createProfileTransaction({
      amount: "12.34",
      customerProfileId: "123456",
      customerPaymentProfileId: "789",
      invoiceNumber: "ccharge",
      description: "Account balance",
    });
    expect(created).toEqual({ transId: "txn_profile", responseCode: 1 });
    const createCall = fetchMock.mock.calls[0] as unknown as
      | [string, RequestInit]
      | undefined;
    const request = JSON.parse(String(createCall?.[1]?.body));
    const transactionRequest = request.createTransactionRequest
      .transactionRequest as Record<string, unknown>;
    expect(transactionRequest.profile).toEqual({
      customerProfileId: "123456",
      paymentProfile: { paymentProfileId: "789" },
    });
    expect(transactionRequest.processingOptions).toEqual({
      isSubsequentAuth: "true",
    });
    expect(Object.keys(transactionRequest)).toEqual([
      "transactionType",
      "amount",
      "profile",
      "order",
      "processingOptions",
    ]);
  });

  test("surfaces a declined CIM charge", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          messages: {
            resultCode: "Error",
            message: [{ code: "E00027", text: "The transaction was unsuccessful." }],
          },
          transactionResponse: {
            responseCode: "2",
            transId: "0",
            errors: [{ errorCode: "2", errorText: "This transaction has been declined." }],
          },
        }),
      ),
    );
    const client = new AuthorizeNetClient(
      credentials.apiLoginId,
      credentials.transactionKey,
      "sandbox",
    );
    await expect(
      client.createProfileTransaction({
        amount: "10.00",
        customerProfileId: "123456",
        customerPaymentProfileId: "789",
      }),
    ).rejects.toThrow(/declined/);
  });

  test("updates and deletes customer profiles", async () => {
    const keys: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        const key = Object.keys(body)[0];
        if (key) keys.push(key);
        return jsonResponse(ok({}));
      }),
    );
    const client = new AuthorizeNetClient(
      credentials.apiLoginId,
      credentials.transactionKey,
      "sandbox",
    );
    await client.updateCustomerProfile({
      customerProfileId: "profile_1",
      email: "ada@example.com",
      description: "Ada",
    });
    await client.deleteCustomerProfile("profile_1");
    expect(keys).toEqual([
      "updateCustomerProfileRequest",
      "deleteCustomerProfileRequest",
    ]);
  });
});

describe("webhook signatures", () => {
  test("accepts a matching signature and rejects a mismatch", async () => {
    const body = '{"notificationId":"abc"}';
    const keyBytes = Uint8Array.from(
      credentials.signatureKey.match(/../g)!.map((pair) => parseInt(pair, 16)),
    );
    const key = await crypto.subtle.importKey(
      "raw",
      keyBytes,
      { name: "HMAC", hash: "SHA-512" },
      false,
      ["sign"],
    );
    const signature = await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(body),
    );
    const hex = Array.from(new Uint8Array(signature), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");

    expect(
      await verifyWebhookSignature(
        body,
        `sha512=${hex}`,
        credentials.signatureKey,
      ),
    ).toBe(true);
    expect(
      await verifyWebhookSignature(body, "sha512=deadbeef", credentials.signatureKey),
    ).toBe(false);
    expect(
      await verifyWebhookSignature(`${body} `, `sha512=${hex}`, credentials.signatureKey),
    ).toBe(false);
  });

  test("registerRoutes is exported and a bad signature is rejected", async () => {
    expect(typeof registerRoutes).toBe("function");
    const response = await handleWebhookRequest(
      {
        runQuery: vi.fn(),
        runMutation: vi.fn(),
        runAction: vi.fn(),
      },
      components.authorizenet,
      new Request("https://example.com/authorizenet/webhook", {
        method: "POST",
        headers: { "X-ANET-Signature": "sha512=deadbeef" },
        body: "{}",
      }),
      credentials,
    );
    expect(response.status).toBe(400);
  });
});

describe("AuthorizeNet client", () => {
  test("hosted checkout stores a reference and returns a form token", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(ok({ token: "pay-token" })));
    vi.stubGlobal("fetch", fetchMock);
    const runMutation = vi.fn().mockResolvedValue(null);
    const client = new AuthorizeNet(components.authorizenet, credentials);

    const result = await client.createHostedCheckout(
      { runQuery: vi.fn(), runMutation, runAction: vi.fn() },
      {
        mode: "payment",
        amount: 4900,
        quantity: 1,
        planKey: "hat_onetime",
        successUrl: "https://example.com/success",
        cancelUrl: "https://example.com/cancel",
        metadata: { userId: "user_1" },
      },
    );

    expect(result.token).toBe("pay-token");
    expect(result.formUrl).toBe("https://test.authorize.net/payment/payment");
    expect(result.checkoutId).toMatch(/^c[0-9a-f]{16}$/);
    expect(runMutation).toHaveBeenCalledWith(
      components.authorizenet.private.insertCheckoutSession,
      expect.objectContaining({
        checkoutId: result.checkoutId,
        mode: "payment",
        amount: 4900,
        planKey: "hat_onetime",
        metadata: { userId: "user_1" },
      }),
    );
    const checkoutCall = fetchMock.mock.calls[0] as unknown as
      | [string, RequestInit]
      | undefined;
    const request = JSON.parse(String(checkoutCall?.[1]?.body));
    expect(request.getHostedPaymentPageRequest.transactionRequest.amount).toBe(
      "49.00",
    );
  });

  test("createProfileCharge stores the payment and profile", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      if (body.createTransactionRequest) {
        return jsonResponse(
          ok({
            transactionResponse: { transId: "txn_saved", responseCode: "1" },
          }),
        );
      }
      return jsonResponse(
        ok({
          transaction: {
            transId: "txn_saved",
            responseCode: 1,
            settleAmount: 40,
            submitTimeUTC: "2026-09-28T18:00:00Z",
            profile: {
              customerProfileId: "profile_1",
              customerPaymentProfileId: "pay_1",
            },
            payment: {
              creditCard: { cardNumber: "XXXX4242", cardType: "Visa" },
            },
            transactionStatus: "capturedPendingSettlement",
          },
        }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    const runMutation = vi.fn().mockResolvedValue(null);
    const client = new AuthorizeNet(components.authorizenet, credentials);
    const result = await client.createProfileCharge(
      { runQuery: vi.fn(), runMutation, runAction: vi.fn() },
      {
        customerProfileId: "profile_1",
        customerPaymentProfileId: "pay_1",
        amount: 4000,
        metadata: { userId: "revio:42", revioCustomerId: "42" },
        description: "Account balance",
      },
    );
    expect(result).toMatchObject({
      transId: "txn_saved",
      amountCents: 4000,
      status: "succeeded",
      accountType: "card",
    });
    expect(runMutation).toHaveBeenCalledWith(
      components.authorizenet.private.handlePaymentUpsert,
      expect.objectContaining({
        transId: "txn_saved",
        customerProfileId: "profile_1",
        amount: 4000,
        status: "succeeded",
        metadata: { userId: "revio:42", revioCustomerId: "42" },
      }),
    );
    expect(runMutation).toHaveBeenCalledWith(
      components.authorizenet.private.upsertPaymentProfile,
      expect.objectContaining({
        customerProfileId: "profile_1",
        customerPaymentProfileId: "pay_1",
        last4: "4242",
        brand: "Visa",
      }),
    );
  });

  test("refreshCustomerProfiles upserts payment methods", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(
          ok({
            profile: {
              customerProfileId: "profile_1",
              email: "ada@example.com",
              paymentProfiles: {
                customerPaymentProfileId: "pay_9",
                payment: {
                  creditCard: { cardNumber: "XXXX1111", cardType: "Visa" },
                },
              },
            },
          }),
        ),
      ),
    );
    const runMutation = vi.fn().mockResolvedValue(null);
    const client = new AuthorizeNet(components.authorizenet, credentials);
    const result = await client.refreshCustomerProfiles(
      { runQuery: vi.fn(), runMutation, runAction: vi.fn() },
      { customerProfileId: "profile_1" },
    );
    expect(result.paymentProfiles).toEqual([
      { customerPaymentProfileId: "pay_9", brand: "Visa", last4: "1111" },
    ]);
    expect(runMutation).toHaveBeenCalledWith(
      components.authorizenet.public.createOrUpdateCustomer,
      expect.objectContaining({ customerProfileId: "profile_1" }),
    );
    expect(runMutation).toHaveBeenCalledWith(
      components.authorizenet.private.upsertPaymentProfile,
      expect.objectContaining({
        customerPaymentProfileId: "pay_9",
        last4: "1111",
      }),
    );
  });

  test("createSubscription starts ARB on a saved payment profile", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(ok({ subscriptionId: "sub_api" })));
    vi.stubGlobal("fetch", fetchMock);
    const runMutation = vi.fn().mockResolvedValue(null);
    const client = new AuthorizeNet(components.authorizenet, credentials);
    const result = await client.createSubscription(
      { runQuery: vi.fn(), runMutation, runAction: vi.fn() },
      {
        customerProfileId: "profile_1",
        customerPaymentProfileId: "pay_1",
        amount: 2900,
        quantity: 2,
        planKey: "hat_monthly",
        interval: { length: 1, unit: "months" },
        startDate: "2026-09-28",
        metadata: { userId: "user_1" },
      },
    );
    expect(result).toEqual({ subscriptionId: "sub_api" });
    const createCall = fetchMock.mock.calls[0] as unknown as
      | [string, RequestInit]
      | undefined;
    const request = JSON.parse(String(createCall?.[1]?.body));
    const subscription = request.ARBCreateSubscriptionRequest
      .subscription as Record<string, unknown>;
    expect(subscription.amount).toBe("58.00");
    expect(subscription.paymentSchedule).toEqual({
      interval: { length: 1, unit: "months" },
      startDate: "2026-09-28",
      totalOccurrences: 9999,
    });
    expect(subscription.profile).toEqual({
      customerProfileId: "profile_1",
      customerPaymentProfileId: "pay_1",
    });
    expect(runMutation).toHaveBeenCalledWith(
      components.authorizenet.private.handleSubscriptionUpsert,
      expect.objectContaining({
        subscriptionId: "sub_api",
        customerProfileId: "profile_1",
        amount: 5800,
        unitAmount: 2900,
        quantity: 2,
        planKey: "hat_monthly",
        cancelAtPeriodEnd: false,
        metadata: { userId: "user_1" },
      }),
    );
  });

  test("refreshSubscription upserts the local ARB row", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(
          ok({
            subscription: {
              id: "sub_1",
              name: "hat_monthly",
              amount: 29,
              status: "active",
              paymentSchedule: {
                interval: { length: 1, unit: "months" },
                startDate: "2026-09-01",
              },
              profile: {
                customerProfileId: "profile_1",
                paymentProfile: { customerPaymentProfileId: "pay_1" },
              },
            },
          }),
        ),
      ),
    );
    const runMutation = vi.fn().mockResolvedValue(null);
    const client = new AuthorizeNet(components.authorizenet, credentials);
    const result = await client.refreshSubscription(
      {
        runQuery: vi.fn().mockResolvedValue({
          subscriptionId: "sub_1",
          customerProfileId: "profile_1",
          unitAmount: 2900,
          quantity: 1,
          planKey: "hat_monthly",
          metadata: { userId: "user_1" },
        }),
        runMutation,
        runAction: vi.fn(),
      },
      { subscriptionId: "sub_1" },
    );
    expect(result).toMatchObject({
      subscriptionId: "sub_1",
      status: "active",
      amountCents: 2900,
    });
    expect(runMutation).toHaveBeenCalledWith(
      components.authorizenet.private.handleSubscriptionUpsert,
      expect.objectContaining({
        subscriptionId: "sub_1",
        customerProfileId: "profile_1",
        status: "active",
        planKey: "hat_monthly",
        metadata: { userId: "user_1" },
      }),
    );
  });

  test("throws when API credentials are missing", async () => {
    const previousLogin = process.env.AUTHORIZENET_API_LOGIN_ID;
    const previousKey = process.env.AUTHORIZENET_TRANSACTION_KEY;
    delete process.env.AUTHORIZENET_API_LOGIN_ID;
    delete process.env.AUTHORIZENET_TRANSACTION_KEY;
    const client = new AuthorizeNet(components.authorizenet);
    await expect(
      client.createHostedProfilePage(
        { runQuery: vi.fn(), runMutation: vi.fn(), runAction: vi.fn() },
        { customerId: "profile_1", returnUrl: "https://example.com" },
      ),
    ).rejects.toThrow(/AUTHORIZENET_API_LOGIN_ID/);
    if (previousLogin) process.env.AUTHORIZENET_API_LOGIN_ID = previousLogin;
    if (previousKey) process.env.AUTHORIZENET_TRANSACTION_KEY = previousKey;
  });

  test("period-end cancel sends totalOccurrences", async () => {
    const bodies: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body));
        bodies.push(body);
        if (body.ARBGetSubscriptionRequest) {
          return jsonResponse(
            ok({
              subscription: {
                name: "hat_monthly",
                amount: 58,
                status: "active",
                paymentSchedule: {
                  interval: { length: 1, unit: "months" },
                  startDate: "2026-01-01",
                },
                profile: {
                  customerProfileId: "profile_1",
                  paymentProfile: { customerPaymentProfileId: "pay_1" },
                },
                arbTransactions: [
                  { transId: "txn_1", response: "approved" },
                  { transId: "txn_2", response: "approved" },
                ],
              },
            }),
          );
        }
        return jsonResponse(ok({}));
      }),
    );

    const runMutation = vi.fn().mockResolvedValue(null);
    const client = new AuthorizeNet(components.authorizenet, credentials);
    await client.cancelSubscription(
      {
        runQuery: vi.fn().mockResolvedValue({
          subscriptionId: "sub_1",
          customerProfileId: "profile_1",
          status: "active",
          amount: 5800,
          unitAmount: 2900,
          quantity: 2,
          intervalLength: 1,
          intervalUnit: "months",
          planKey: "hat_monthly",
          currentPeriodEnd: 1_800_000_000,
          cancelAtPeriodEnd: false,
        }),
        runMutation,
        runAction: vi.fn(),
      },
      { subscriptionId: "sub_1", cancelAtPeriodEnd: true },
    );

    const update = bodies.find(
      (body) =>
        typeof body === "object" &&
        body !== null &&
        "ARBUpdateSubscriptionRequest" in body,
    ) as {
      ARBUpdateSubscriptionRequest: {
        subscription: { paymentSchedule: { totalOccurrences: number } };
      };
    };
    expect(
      update.ARBUpdateSubscriptionRequest.subscription.paymentSchedule
        .totalOccurrences,
    ).toBe(2);
    expect(runMutation).toHaveBeenCalledWith(
      components.authorizenet.private.handleSubscriptionUpsert,
      expect.objectContaining({
        subscriptionId: "sub_1",
        cancelAtPeriodEnd: true,
        status: "active",
      }),
    );
  });
});

describe("processEvent", () => {
  test("creates an ARB subscription once for a subscription checkout", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body));
        const key = Object.keys(body)[0] ?? "";
        calls.push(key);
        if (key === "getTransactionDetailsRequest") {
          return jsonResponse(
            ok({
              transaction: {
                transId: "txn_1",
                responseCode: 1,
                settleAmount: 29,
                submitTimeUTC: "2026-09-25T12:00:00Z",
                order: { invoiceNumber: "ccheckout" },
                profile: {
                  customerProfileId: "profile_1",
                  customerPaymentProfileId: "pay_1",
                },
                payment: {
                  creditCard: { cardNumber: "XXXX1111", cardType: "Visa" },
                },
              },
            }),
          );
        }
        return jsonResponse(ok({ subscriptionId: "sub_created" }));
      }),
    );

    const seen = new Set<string>();
    const runMutation = vi.fn(async (_ref: unknown, args: Record<string, unknown>) => {
      if (
        typeof args.notificationId === "string" &&
        typeof args.eventType === "string"
      ) {
        if (seen.has(args.notificationId)) return false;
        seen.add(args.notificationId);
        return true;
      }
      return null;
    });
    const checkout = {
      checkoutId: "ccheckout",
      customerProfileId: "profile_1",
      status: "open",
      mode: "subscription" as const,
      amount: 2900,
      quantity: 1,
      planKey: "hat_monthly",
      intervalLength: 1,
      intervalUnit: "months" as const,
      metadata: { userId: "user_1" },
    };
    const ctx = {
      runQuery: vi.fn(async (_ref: unknown, args?: unknown) => {
        const checkoutId =
          args && typeof args === "object" && "checkoutId" in args
            ? args.checkoutId
            : undefined;
        if (checkoutId === "ccheckout") return checkout;
        return null;
      }),
      runMutation,
      runAction: vi.fn(),
    };
    const gateway = new AuthorizeNetClient(
      credentials.apiLoginId,
      credentials.transactionKey,
      "sandbox",
    );
    const event = {
      notificationId: "notice_1",
      eventType: "net.authorize.payment.authcapture.created",
      eventDate: "2026-09-25T12:00:00Z",
      webhookId: "hook_1",
      payload: { id: "txn_1", responseCode: 1, entityName: "transaction" },
    };

    await processEvent(ctx as unknown as ActionCtx, components.authorizenet, event, gateway);
    await processEvent(ctx as unknown as ActionCtx, components.authorizenet, event, gateway);

    expect(calls.filter((call) => call === "ARBCreateSubscriptionRequest")).toHaveLength(
      1,
    );
    expect(runMutation).toHaveBeenCalledWith(
      components.authorizenet.private.handleSubscriptionUpsert,
      expect.objectContaining({
        subscriptionId: "sub_created",
        unitAmount: 2900,
        quantity: 1,
        planKey: "hat_monthly",
        metadata: { userId: "user_1" },
      }),
    );
  });
});
