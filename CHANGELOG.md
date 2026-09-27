# Changelog

## 0.2.1

- Put `profile` before `order` on Accept Hosted requests. Authorize.net rejects `profile` after `order`. Guest checkout no longer sends `createProfile` on `transactionRequest`.
- Put `order` before `profile` on ARB create requests. The subscription schema is the reverse of `transactionRequest`.

## 0.2.0

- Accept Hosted checkout can show a bank account (eCheck) via `paymentMethods`.
- Payments store `accountType` and Authorize.net `transactionStatus`.
- An eCheck stays `pending` until the transaction status is `settledSuccessfully`.

## 0.1.0

- Initial release of the Authorize.net Convex component.
- Accept Hosted checkout, CIM customer profiles, ARB subscriptions, and webhook sync.
