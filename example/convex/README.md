# Example Convex functions

These functions show how an app uses `@convex-dev/authorizenet`.

| File | Purpose |
| --- | --- |
| `convex.config.ts` | Installs the component |
| `authorizenet.ts` | Authenticated checkout, subscriptions, seats, and queries |
| `http.ts` | Webhook route at `/authorizenet/webhook` |

```typescript
import { defineApp } from "convex/server";
import authorizenet from "@convex-dev/authorizenet/convex.config.js";

const app = defineApp();
app.use(authorizenet);

export default app;
```

```typescript
import { AuthorizeNet } from "@convex-dev/authorizenet";
import { components } from "./_generated/api";

const payments = new AuthorizeNet(components.authorizenet, {});
```

The component stores customers, payment profiles, subscriptions, checkout references, payments, invoices synthesized from subscription charges, and webhook notification ids. Card numbers are not stored. Payment profiles keep a brand and last four digits when Authorize.net returns them.
