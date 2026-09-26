import { describe, expect, test, vi, afterEach } from "vitest";
import { AuthorizeNetClient } from "./api.js";
import { mapSubscriptionStatus } from "./billing.js";
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
      request.getHostedPaymentPageRequest.transactionRequest.profile.createProfile,
    ).toBe(true);
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
