import { defineApp } from "convex/server";
import authorizenet from "convex-authorizenet/convex.config.js";

const app = defineApp();
app.use(authorizenet);

export default app;
