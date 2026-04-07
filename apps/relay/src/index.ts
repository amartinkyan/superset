import { serve } from "@hono/node-server";
import { createNodeWebSocket } from "@hono/node-ws";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { env } from "./env";
import { registerProxyRoutes } from "./proxy";
import { registerTunnelRoute, TunnelManager } from "./tunnel";

const app = new Hono();
const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });
const tunnelManager = new TunnelManager(env.REQUEST_TIMEOUT_MS);

app.use("*", cors());

app.get("/health", (c) => c.json({ ok: true }));

registerTunnelRoute({
	app,
	upgradeWebSocket,
	tunnelManager,
	tunnelSecret: env.RELAY_TUNNEL_SECRET,
});

registerProxyRoutes({
	app,
	upgradeWebSocket,
	tunnelManager,
	authUrl: env.AUTH_URL,
});

const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
	console.log(`[relay] listening on http://localhost:${info.port}`);
});
injectWebSocket(server);
