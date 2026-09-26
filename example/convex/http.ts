import { httpRouter } from "convex/server";
import { components } from "./_generated/api";
import { registerRoutes } from "@convex-dev/authorizenet";

const http = httpRouter();

// Webhook URL: https://<deployment>.convex.site/authorizenet/webhook
registerRoutes(http, components.authorizenet, {
  webhookPath: "/authorizenet/webhook",
  events: {
    "net.authorize.customer.subscription.updated": async (_ctx, event) => {
      console.log("Subscription updated", {
        id: event.payload.id,
        status: event.payload.status,
      });
    },
    "net.authorize.payment.authcapture.created": async (_ctx, event) => {
      console.log("Payment captured", {
        id: event.payload.id,
        amount: event.payload.authAmount,
      });
    },
  },
  onEvent: async (_ctx, event) => {
    console.log(`Event received: ${event.eventType}`, {
      id: event.notificationId,
      created: event.eventDate,
    });
  },
});

export default http;
