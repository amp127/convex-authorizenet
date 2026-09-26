# convex-authorizenet

A Convex component for Authorize.net payments, customer profiles, and recurring billing.

Requires Node.js 18 or later.

## Features

- Accept Hosted checkout for one-time payments and subscription signup
- Customer Information Manager (CIM) profiles linked to your users
- Automated Recurring Billing (ARB) subscriptions
- Seat quantity, stored as unit amount times quantity
- Hosted profile page for saved payment methods
- User and organization linking
- Webhook sync into Convex
- Real-time queries for payments, subscriptions, and billing history

## Limits

Authorize.net does not provide Stripe-style Checkout sessions, Price IDs, invoices, or a billing portal.

- Checkout returns a form token. The browser must POST that token to Accept Hosted. It cannot redirect to a URL.
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

Add these in the Convex dashboard under Settings, then Environment Variables.

| Variable | Description |
| --- | --- |
| `AUTHORIZENET_API_LOGIN_ID` | API Login ID from Account, then API Credentials & Keys |
| `AUTHORIZENET_TRANSACTION_KEY` | Transaction Key from the same page |
| `AUTHORIZENET_SIGNATURE_KEY` | Signature Key, used to verify webhooks |
| `AUTHORIZENET_ENVIRONMENT` | `sandbox` or `production` |

Sandbox API calls go to `apitest.authorize.net`. Production calls go to `api.authorize.net`.

### 4. Configure webhooks

In the Merchant Interface, open Account, then Webhooks, then add an endpoint:

```text
https://<your-convex-deployment>.convex.site/authorizenet/webhook
```

Subscribe to:

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

Create a Signature Key under Account, then Settings, then Security Settings, then API Credentials and Keys, and save it as `AUTHORIZENET_SIGNATURE_KEY`.

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
      successUrl: "http://localhost:5173/?success=true",
      cancelUrl: "http://localhost:5173/?canceled=true",
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
| `createHostedCheckout()` | Accept Hosted payment, or a hosted profile page when `mode` is `setup` |
| `createHostedProfilePage()` | Hosted page for managing saved payment methods |
| `cancelSubscription()` | Cancel now, or stop future billings after the current cycle |
| `reactivateSubscription()` | Restore an open-ended ARB occurrence count |
| `updateSubscriptionQuantity()` | Set seats. The billed amount becomes unit amount times quantity |

`createHostedCheckout` `amount` is the unit price in cents. Subscription checkout charges that amount times quantity immediately, then the payment webhook creates the ARB subscription starting on the next interval so the first period is not billed twice.

Queries on `components.authorizenet.public` include customers, subscriptions, payments, invoices, checkout sessions, and payment profiles, with indexes for customer profile id, user id, and org id.

## Development

Use `npx convex dev` while building. `npx convex deploy` is for production only.

```bash
npm test
npm run lint
npm run typecheck
```
