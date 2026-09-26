# Benji's Store

Example app for `convex-authorizenet` with Clerk authentication.

## What it shows

- One-time Accept Hosted payments
- Monthly ARB subscriptions
- Profile page with orders, cancel, and reactivate
- Hosted payment-profile page
- Team seats and organization lookup
- Past-due subscriptions

## Setup

1. Install dependencies from the repository root with `npm install`.
2. Create a Clerk application and set `VITE_CLERK_PUBLISHABLE_KEY` in `.env.local`.
3. In the Convex dashboard, set:
   - `AUTHORIZENET_API_LOGIN_ID`
   - `AUTHORIZENET_TRANSACTION_KEY`
   - `AUTHORIZENET_SIGNATURE_KEY`
   - `AUTHORIZENET_ENVIRONMENT` to `sandbox` or `production`
   - `APP_URL` to the frontend origin, such as `http://localhost:5173`
4. Point an Authorize.net webhook at `https://<deployment>.convex.site/authorizenet/webhook`.
5. Start the app with `npm run dev` from the repository root.

Product amounts live in `example/src/App.tsx`. The sandbox test card is `4111 1111 1111 1111`.

Checkout opens Authorize.net with a form POST. The return URL brings the shopper back to the app. Payment and subscription rows appear after the webhook is processed.
