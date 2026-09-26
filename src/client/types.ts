import type {
  HttpRouter,
  GenericActionCtx,
  GenericMutationCtx,
  GenericDataModel,
  GenericQueryCtx,
} from "convex/server";
import type { Environment } from "./api.js";

export type QueryCtx = Pick<GenericQueryCtx<GenericDataModel>, "runQuery">;
export type MutationCtx = Pick<
  GenericMutationCtx<GenericDataModel>,
  "runQuery" | "runMutation"
>;
export type ActionCtx = Pick<
  GenericActionCtx<GenericDataModel>,
  "runQuery" | "runMutation" | "runAction"
>;

export type AuthorizeNetNotification = {
  notificationId: string;
  eventType: string;
  eventDate: string;
  webhookId: string;
  payload: {
    responseCode?: number;
    authAmount?: number;
    entityName?: string;
    id: string | number;
    invoiceNumber?: string;
    customerProfileId?: string | number;
    name?: string;
    amount?: number;
    status?: string;
  };
};

export type AuthorizeNetEventHandler = (
  ctx: ActionCtx,
  event: AuthorizeNetNotification,
) => Promise<void>;

export type AuthorizeNetEventHandlers = Record<string, AuthorizeNetEventHandler | undefined>;

/**
 * Configuration for webhook registration.
 * Credentials default to AUTHORIZENET_* environment variables.
 */
export type RegisterRoutesConfig = {
  webhookPath?: string;
  events?: AuthorizeNetEventHandlers;
  onEvent?: AuthorizeNetEventHandler;
  apiLoginId?: string;
  transactionKey?: string;
  signatureKey?: string;
  environment?: Environment;
  currency?: string;
};

export type { HttpRouter };
