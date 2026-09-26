import { defineApp } from "convex/server";
import authorizenet from "@convex-dev/authorizenet/convex.config.js";

const app = defineApp();
app.use(authorizenet);

export default app;
