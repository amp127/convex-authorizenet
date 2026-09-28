# convex-authorizenet

A Convex component for Authorize.net payments, customer profiles, and recurring billing.

Requires Node.js 18 or later.

## Authorize.net coverage

This is not a full Authorize.net SDK. The table is the source of truth for what the component does. If a product is not listed as **Yes**, it is not implemented.

| Product | Capability | Status | Notes |
| --- | --- | --- | --- |
| Accept Hosted | One-time card payment | Yes | `createHostedCheckout({ mode: "payment" })` |
| Accept Hosted | eCheck (bank account) | Partial | `paymentMethods: { bankAccount: true }`. Merchant needs eCheck.Net |
| Accept Hosted | Subscription signup | Yes | `mode: "subscription"` charges the first period, then creates ARB for later cycles |
| Accept Hosted | Save a payment method | Yes | `mode: "setup"` or `createHostedProfilePage()` |
| Accept.js / Accept Customer | Client-side nonce / iframe | No | Public Client Key is unused |
| Apple Pay / Google Pay / PayPal | Wallets | No | |
| CIM | Create customer profile | Yes | `getOrCreateCustomer()`, `createCustomer()` |
| CIM | Charge a saved payment profile | Yes | `createProfileCharge()` |
| CIM | Refresh local payment methods | Yes | `refreshCustomerProfiles()` |
| CIM | Hosted payment-method page | Yes | Adds, updates, and deletes cards/eCheck |
| CIM | Create / update / delete payment profiles via API | No | Use the hosted profile page |
| CIM | Shipping addresses | No | |
| ARB | Create from hosted checkout | Yes | Payment webhook creates the subscription |
| ARB | Create from a saved CIM profile | Yes | `createSubscription()` |
| ARB | Cancel, period-end cancel, reactivate | Yes | `cancelSubscription()`, `reactivateSubscription()` |
| ARB | Seat quantity | Yes | `updateSubscriptionQuantity()`. Amount is unit × quantity |
| ARB | Refresh from the gateway | Yes | `refreshSubscription()` |
| ARB | Trial period / trial amount | No | |
| ARB | Change interval after create | No | Authorize.net does not allow this |
| ARB | Switch the card on a subscription | No | |
| ARB | Merchant-wide subscription list | No | Query Convex by customer, user, or org |
| Payments | authCapture | Yes | Hosted checkout and `createProfileCharge` |
| Payments | authOnly / capture later | No | |
| Payments | Refund / void via API | No | Webhooks sync refunds and voids done in the Merchant Interface |
| Payments | Transaction lists / unsettled / batches | No | `getTransactionDetails` is used for webhooks only |
| Fraud Detection | Held / approved / declined webhooks | Yes | Stored as `held`, `succeeded`, or `failed` |
| Fraud Detection | Approve or decline a held payment | No | |
| 3-D Secure | Cardinal / payer authentication | No | |
| Invoicing | Authorize.net Invoicing product | No | Local invoice rows exist for subscription charges only |
| Account Updater | Card updater | No | |
| Partner boarding | Webhooks | No | |

## Limits

Authorize.net does not provide Stripe-style Checkout sessions, Price IDs, invoices, or a billing portal.

- Checkout returns a form token. The browser must POST that token to Accept Hosted. It cannot redirect to a URL.
- `successUrl` and `cancelUrl` must be `http://` or `https://` with no query string or hash. Authorize.net rejects `?` and `#` with a misleading "url must begin with http://" error. Use a path-only URL, then redirect in your app.
- Bank account fields require eCheck.Net on the merchant account. Pass `paymentMethods: { card: true, bankAccount: true }` to `createHostedCheckout`. The default is card only. An unsettled eCheck is stored as `pending` until Authorize.net reports `settledSuccessfully`.
- There is no price catalog. Pass an amount in cents and, for subscriptions, a billing interval.
- The hosted profile page manages payment methods only. Cancel, reactivate, and seat changes use the API.
- Cancel-at-period-end is emulated. ARB is updated so `totalOccurrences` equals the number of payments already collected, and the local row keeps `cancelAtPeriodEnd`.
- A merchant account uses one currency. Amounts are stored as integer cents and sent to Authorize.net as decimal dollars.
- Webhook notifications contain an id, not the full object. The handler reads the transaction, subscription, or customer profile before writing Convex.
- `merchantCustomerId` is limited to 20 characters, so user ids are stored in Convex metadata.

## Quick Start

### 1. Install the component

```bash
npm install convex-authorizenet
```

### 2. Add it to your Convex app

```typescript
import { defineApp } from "convex/server";
import authorizenet from "convex-authorizenet/convex.config.js";

const app = defineApp();
app.use(authorizenet);

export default app;
```

### 3. Set environment variables

Get keys from the **new Merchant Interface (2.0)**, then add them in the Convex dashboard under Settings, then Environment Variables.

Sandbox: [sandbox.authorize.net](https://sandbox.authorize.net). Production: [account.authorize.net](https://account.authorize.net). Switch to the new experience if the classic menu is still showing.

1. Open **Account** in the left navigation.
2. Open **Account and API Settings**.
3. Open **API Credentials & Keys** (under Security Settings).

That page has four values:

| Field on the page | Convex variable | Notes |
| --- | --- | --- |
| **API Login ID** | `AUTHORIZENET_API_LOGIN_ID` | Always visible. Identifies the merchant on API requests. It cannot log you into the Merchant Interface. |
| **Transaction Key** | `AUTHORIZENET_TRANSACTION_KEY` | 16-character secret. Click **Generate new transaction key**. It is shown only once, so copy it immediately. |
| **Signature Key** | `AUTHORIZENET_SIGNATURE_KEY` | 128-character hex value. Click **Generate new signature key**. Required before webhooks will send. Shown only once. This component uses the hex string as-is. |
| **Public Client Key** | not used | For Accept.js and other client-side Accept products. This component uses Accept Hosted with server-side tokens, so you can skip it. |

When you generate a Transaction Key or Signature Key, Authorize.net asks you to expire the old key now or in 24 hours, then verifies with a PIN or email one-time passcode. If you leave the old key active for 24 hours, webhook signature checks keep using the old Signature Key until it expires.

Also set:

| Variable | Description |
| --- | --- |
| `AUTHORIZENET_ENVIRONMENT` | `sandbox` or `production` |

Sandbox API calls go to `apitest.authorize.net`. Production calls go to `api.authorize.net`.

### 4. Configure webhooks

In the new Merchant Interface (2.0): **Account**, then **Account and API Settings**, then **Webhook Notifications**, then **Create a webhook notification**.

Generate a Signature Key on the API Credentials & Keys page first. Webhooks will not send until that key exists.

| Field | Suggested value |
| --- | --- |
| **Name** | Optional, for example `Convex` |
| **Endpoint URL** | `https://<your-convex-deployment>.convex.site/authorizenet/webhook` |
| **Status** | **Inactive** while you click **Test Webhook**. **Active** once Convex returns HTTP 200. Only active endpoints receive live events. |
| **Events** | The three categories below. Do not subscribe to partner boarding events. |

Suggested event categories (choose each category, or select all events):

- **Customer Events** — CIM profiles and payment profiles
- **Subscription Events** — ARB create, update, cancel, fail, expire
- **Payment Events** — captures, refunds, voids, and fraud holds

Selecting those categories is enough. If you pick events one by one, subscribe to:

- `net.authorize.customer.created`
- `net.authorize.customer.updated`
- `net.authorize.customer.deleted`
- `net.authorize.customer.paymentProfile.created`
- `net.authorize.customer.paymentProfile.updated`
- `net.authorize.customer.paymentProfile.deleted`
- `net.authorize.customer.subscription.created`
- `net.authorize.customer.subscription.updated`
- `net.authorize.customer.subscription.cancelled`
- `net.authorize.customer.subscription.suspended`
- `net.authorize.customer.subscription.terminated`
- `net.authorize.customer.subscription.expired`
- `net.authorize.customer.subscription.expiring`
- `net.authorize.customer.subscription.failed`
- `net.authorize.payment.authcapture.created`
- `net.authorize.payment.refund.created`
- `net.authorize.payment.void.created`
- `net.authorize.payment.fraud.approved`
- `net.authorize.payment.fraud.declined`
- `net.authorize.payment.fraud.held`

The Payment category also includes `authorization.created`, `capture.created`, and `priorAuthCapture.created`. This component ignores those, so leaving them on is fine.

After the HTTP route in step 5 is registered, set the webhook status to **Active**.

### 5. Register the webhook route

```typescript
import { httpRouter } from "convex/server";
import { components } from "./_generated/api";
import { registerRoutes } from "convex-authorizenet";

const http = httpRouter();

registerRoutes(http, components.authorizenet, {
  webhookPath: "/authorizenet/webhook",
});

export default http;
```

### 6. Use the client

```typescript
import { action } from "./_generated/server";
import { components } from "./_generated/api";
import { AuthorizeNet } from "convex-authorizenet";
import { v } from "convex/values";

const payments = new AuthorizeNet(components.authorizenet, {});

export const createSubscriptionCheckout = action({
  args: {},
  returns: v.object({
    checkoutId: v.string(),
    token: v.string(),
    formUrl: v.string(),
  }),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    const customer = await payments.getOrCreateCustomer(ctx, {
      userId: identity.subject,
      email: identity.email,
      name: identity.name,
    });

    return await payments.createHostedCheckout(ctx, {
      customerId: customer.customerId,
      mode: "subscription",
      amount: 2900,
      planKey: "hat_monthly",
      interval: { length: 1, unit: "months" },
      successUrl: "http://localhost:5173/return",
      cancelUrl: "http://localhost:5173/cancel",
      subscriptionMetadata: { userId: identity.subject },
    });
  },
});
```

The browser posts the token. Do not navigate directly to `formUrl`.

```typescript
import { submitHostedForm } from "convex-authorizenet/react";

submitHostedForm({ token: result.token, formUrl: result.formUrl });
```

## API

```typescript
const payments = new AuthorizeNet(components.authorizenet, {
  apiLoginId: "login",
  transactionKey: "key",
  signatureKey: "hex",
  environment: "sandbox",
  currency: "usd",
});
```

| Method | Description |
| --- | --- |
| `getOrCreateCustomer()` | Find a local customer or create a CIM profile |
| `createCustomer()` | Create a CIM customer profile |
| `createHostedCheckout()` | Accept Hosted payment, or a hosted profile page when `mode` is `setup`. `paymentMethods.bankAccount` shows eCheck when the merchant has eCheck.Net |
| `createHostedProfilePage()` | Hosted page for managing saved payment methods |
| `createProfileCharge()` | Charge a saved CIM payment profile (merchant-initiated, no hosted form) |
| `refreshCustomerProfiles()` | Re-read a CIM customer and upsert local payment profiles |
| `createSubscription()` | Create an ARB subscription on a saved CIM payment profile |
| `refreshSubscription()` | Re-read an ARB subscription and upsert the local row |
| `cancelSubscription()` | Cancel now, or stop future billings after the current cycle |
| `reactivateSubscription()` | Restore an open-ended ARB occurrence count |
| `updateSubscriptionQuantity()` | Set seats. The billed amount becomes unit amount times quantity |

`createHostedCheckout` `amount` is the unit price in cents. Subscription checkout charges that amount times quantity immediately, then the payment webhook creates the ARB subscription starting on the next interval so the first period is not billed twice.

`createSubscription` does not charge separately. ARB bills on `startDate` (UTC today unless you pass one).

Queries on `components.authorizenet.public` include customers, subscriptions, payments, invoices, checkout sessions, and payment profiles, with indexes for customer profile id, user id, and org id.

## Development

Use `npx convex dev` while building. `npx convex deploy` is for production only.

```bash
npm test
npm run lint
npm run typecheck
```
