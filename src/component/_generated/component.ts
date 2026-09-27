/* eslint-disable */
/**
 * Generated `ComponentApi` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type { FunctionReference } from "convex/server";

/**
 * A utility for referencing a Convex component's exposed API.
 *
 * Useful when expecting a parameter like `components.myComponent`.
 * Usage:
 * ```ts
 * async function myFunction(ctx: QueryCtx, component: ComponentApi) {
 *   return ctx.runQuery(component.someFile.someQuery, { ...args });
 * }
 * ```
 */
export type ComponentApi<Name extends string | undefined = string | undefined> =
  {
    private: {
      claimWebhookNotification: FunctionReference<
        "mutation",
        "internal",
        { eventType: string; notificationId: string },
        boolean,
        Name
      >;
      handleCheckoutCompleted: FunctionReference<
        "mutation",
        "internal",
        {
          checkoutId: string;
          customerProfileId?: string;
          subscriptionId?: string;
        },
        null,
        Name
      >;
      handleCustomerCreated: FunctionReference<
        "mutation",
        "internal",
        {
          customerProfileId: string;
          email?: string;
          metadata?: any;
          name?: string;
        },
        null,
        Name
      >;
      handleCustomerDeleted: FunctionReference<
        "mutation",
        "internal",
        { customerProfileId: string },
        null,
        Name
      >;
      handleCustomerUpdated: FunctionReference<
        "mutation",
        "internal",
        {
          customerProfileId: string;
          email?: string;
          metadata?: any;
          name?: string;
        },
        null,
        Name
      >;
      handleInvoiceUpsert: FunctionReference<
        "mutation",
        "internal",
        {
          amountDue: number;
          amountPaid: number;
          created: number;
          customerProfileId: string;
          metadata?: any;
          status: string;
          subscriptionId?: string;
          transId: string;
        },
        null,
        Name
      >;
      handlePaymentProfileDeleted: FunctionReference<
        "mutation",
        "internal",
        { customerPaymentProfileId: string },
        null,
        Name
      >;
      handlePaymentUpsert: FunctionReference<
        "mutation",
        "internal",
        {
          accountType?: "card" | "bank";
          amount: number;
          created: number;
          currency: string;
          customerProfileId?: string;
          metadata?: any;
          refTransId?: string;
          status: string;
          subscriptionId?: string;
          transactionStatus?: string;
          transId: string;
        },
        null,
        Name
      >;
      handleSubscriptionUpsert: FunctionReference<
        "mutation",
        "internal",
        {
          amount?: number;
          cancelAt?: number;
          cancelAtPeriodEnd?: boolean;
          currentPeriodEnd?: number;
          customerPaymentProfileId?: string;
          customerProfileId?: string;
          intervalLength?: number;
          intervalUnit?: "days" | "months";
          metadata?: any;
          planKey?: string;
          quantity?: number;
          status: string;
          subscriptionId: string;
          unitAmount?: number;
        },
        null,
        Name
      >;
      insertCheckoutSession: FunctionReference<
        "mutation",
        "internal",
        {
          amount: number;
          checkoutId: string;
          customerProfileId?: string;
          intervalLength?: number;
          intervalUnit?: "days" | "months";
          metadata?: any;
          mode: "payment" | "subscription" | "setup";
          planKey?: string;
          quantity: number;
        },
        null,
        Name
      >;
      releaseWebhookNotification: FunctionReference<
        "mutation",
        "internal",
        { notificationId: string },
        null,
        Name
      >;
      updateSubscriptionQuantityInternal: FunctionReference<
        "mutation",
        "internal",
        { amount: number; quantity: number; subscriptionId: string },
        null,
        Name
      >;
      upsertPaymentProfile: FunctionReference<
        "mutation",
        "internal",
        {
          brand?: string;
          customerPaymentProfileId: string;
          customerProfileId: string;
          isDefault: boolean;
          last4?: string;
        },
        null,
        Name
      >;
    };
    public: {
      createOrUpdateCustomer: FunctionReference<
        "mutation",
        "internal",
        {
          customerProfileId: string;
          email?: string;
          metadata?: any;
          name?: string;
        },
        string,
        Name
      >;
      getCheckoutSession: FunctionReference<
        "query",
        "internal",
        { checkoutId: string },
        {
          amount: number;
          checkoutId: string;
          customerProfileId?: string;
          intervalLength?: number;
          intervalUnit?: "days" | "months";
          metadata?: any;
          mode: "payment" | "subscription" | "setup";
          planKey?: string;
          quantity: number;
          status: string;
          subscriptionId?: string;
        } | null,
        Name
      >;
      getCustomer: FunctionReference<
        "query",
        "internal",
        { customerProfileId: string },
        {
          customerProfileId: string;
          email?: string;
          metadata?: any;
          name?: string;
          userId?: string;
        } | null,
        Name
      >;
      getCustomerByEmail: FunctionReference<
        "query",
        "internal",
        { email: string },
        {
          customerProfileId: string;
          email?: string;
          metadata?: any;
          name?: string;
          userId?: string;
        } | null,
        Name
      >;
      getCustomerByUserId: FunctionReference<
        "query",
        "internal",
        { userId: string },
        {
          customerProfileId: string;
          email?: string;
          metadata?: any;
          name?: string;
          userId?: string;
        } | null,
        Name
      >;
      getPayment: FunctionReference<
        "query",
        "internal",
        { transId: string },
        {
          accountType?: "card" | "bank";
          amount: number;
          created: number;
          currency: string;
          customerProfileId?: string;
          metadata?: any;
          orgId?: string;
          status: string;
          subscriptionId?: string;
          transactionStatus?: string;
          transId: string;
          userId?: string;
        } | null,
        Name
      >;
      getSubscription: FunctionReference<
        "query",
        "internal",
        { subscriptionId: string },
        {
          amount: number;
          cancelAt?: number;
          cancelAtPeriodEnd: boolean;
          currentPeriodEnd: number;
          customerPaymentProfileId?: string;
          customerProfileId: string;
          intervalLength: number;
          intervalUnit: "days" | "months";
          metadata?: any;
          orgId?: string;
          planKey: string;
          quantity: number;
          status: string;
          subscriptionId: string;
          unitAmount: number;
          userId?: string;
        } | null,
        Name
      >;
      getSubscriptionByOrgId: FunctionReference<
        "query",
        "internal",
        { orgId: string },
        {
          amount: number;
          cancelAt?: number;
          cancelAtPeriodEnd: boolean;
          currentPeriodEnd: number;
          customerPaymentProfileId?: string;
          customerProfileId: string;
          intervalLength: number;
          intervalUnit: "days" | "months";
          metadata?: any;
          orgId?: string;
          planKey: string;
          quantity: number;
          status: string;
          subscriptionId: string;
          unitAmount: number;
          userId?: string;
        } | null,
        Name
      >;
      listCheckoutSessions: FunctionReference<
        "query",
        "internal",
        { customerProfileId: string },
        Array<{
          amount: number;
          checkoutId: string;
          customerProfileId?: string;
          intervalLength?: number;
          intervalUnit?: "days" | "months";
          metadata?: any;
          mode: "payment" | "subscription" | "setup";
          planKey?: string;
          quantity: number;
          status: string;
          subscriptionId?: string;
        }>,
        Name
      >;
      listInvoices: FunctionReference<
        "query",
        "internal",
        { customerProfileId: string },
        Array<{
          amountDue: number;
          amountPaid: number;
          created: number;
          customerProfileId: string;
          metadata?: any;
          orgId?: string;
          status: string;
          subscriptionId?: string;
          transId: string;
          userId?: string;
        }>,
        Name
      >;
      listInvoicesByOrgId: FunctionReference<
        "query",
        "internal",
        { orgId: string },
        Array<{
          amountDue: number;
          amountPaid: number;
          created: number;
          customerProfileId: string;
          metadata?: any;
          orgId?: string;
          status: string;
          subscriptionId?: string;
          transId: string;
          userId?: string;
        }>,
        Name
      >;
      listInvoicesByUserId: FunctionReference<
        "query",
        "internal",
        { userId: string },
        Array<{
          amountDue: number;
          amountPaid: number;
          created: number;
          customerProfileId: string;
          metadata?: any;
          orgId?: string;
          status: string;
          subscriptionId?: string;
          transId: string;
          userId?: string;
        }>,
        Name
      >;
      listPaymentProfiles: FunctionReference<
        "query",
        "internal",
        { customerProfileId: string },
        Array<{
          brand?: string;
          customerPaymentProfileId: string;
          customerProfileId: string;
          isDefault: boolean;
          last4?: string;
        }>,
        Name
      >;
      listPayments: FunctionReference<
        "query",
        "internal",
        { customerProfileId: string },
        Array<{
          accountType?: "card" | "bank";
          amount: number;
          created: number;
          currency: string;
          customerProfileId?: string;
          metadata?: any;
          orgId?: string;
          status: string;
          subscriptionId?: string;
          transactionStatus?: string;
          transId: string;
          userId?: string;
        }>,
        Name
      >;
      listPaymentsByOrgId: FunctionReference<
        "query",
        "internal",
        { orgId: string },
        Array<{
          accountType?: "card" | "bank";
          amount: number;
          created: number;
          currency: string;
          customerProfileId?: string;
          metadata?: any;
          orgId?: string;
          status: string;
          subscriptionId?: string;
          transactionStatus?: string;
          transId: string;
          userId?: string;
        }>,
        Name
      >;
      listPaymentsByUserId: FunctionReference<
        "query",
        "internal",
        { userId: string },
        Array<{
          accountType?: "card" | "bank";
          amount: number;
          created: number;
          currency: string;
          customerProfileId?: string;
          metadata?: any;
          orgId?: string;
          status: string;
          subscriptionId?: string;
          transactionStatus?: string;
          transId: string;
          userId?: string;
        }>,
        Name
      >;
      listSubscriptions: FunctionReference<
        "query",
        "internal",
        { customerProfileId: string },
        Array<{
          amount: number;
          cancelAt?: number;
          cancelAtPeriodEnd: boolean;
          currentPeriodEnd: number;
          customerPaymentProfileId?: string;
          customerProfileId: string;
          intervalLength: number;
          intervalUnit: "days" | "months";
          metadata?: any;
          orgId?: string;
          planKey: string;
          quantity: number;
          status: string;
          subscriptionId: string;
          unitAmount: number;
          userId?: string;
        }>,
        Name
      >;
      listSubscriptionsByOrgId: FunctionReference<
        "query",
        "internal",
        { orgId: string },
        Array<{
          amount: number;
          cancelAt?: number;
          cancelAtPeriodEnd: boolean;
          currentPeriodEnd: number;
          customerPaymentProfileId?: string;
          customerProfileId: string;
          intervalLength: number;
          intervalUnit: "days" | "months";
          metadata?: any;
          orgId?: string;
          planKey: string;
          quantity: number;
          status: string;
          subscriptionId: string;
          unitAmount: number;
          userId?: string;
        }>,
        Name
      >;
      listSubscriptionsByUserId: FunctionReference<
        "query",
        "internal",
        { userId: string },
        Array<{
          amount: number;
          cancelAt?: number;
          cancelAtPeriodEnd: boolean;
          currentPeriodEnd: number;
          customerPaymentProfileId?: string;
          customerProfileId: string;
          intervalLength: number;
          intervalUnit: "days" | "months";
          metadata?: any;
          orgId?: string;
          planKey: string;
          quantity: number;
          status: string;
          subscriptionId: string;
          unitAmount: number;
          userId?: string;
        }>,
        Name
      >;
      updateSubscriptionMetadata: FunctionReference<
        "mutation",
        "internal",
        {
          metadata: any;
          orgId?: string;
          subscriptionId: string;
          userId?: string;
        },
        null,
        Name
      >;
    };
  };
