import { serve } from "@hono/node-server";
import { createNodeWebSocket } from "@hono/node-ws";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { checkHostAccess } from "./access";
import { verifyJWT } from "./auth";
import { env } from "./env";
import { registerProxyRoutes } from "./proxy";
import { TunnelManager } from "./tunnel";

const app = new Hono();
const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });
const tunnelManager = new TunnelManager(env.REQUEST_TIMEOUT_MS);

app.use("*", logger());
app.use("*", cors());

app.get("/health", (c) => c.json({ ok: true }));

// Tunnel endpoint — host-services connect here
app.get(
	"/tunnel",
	upgradeWebSocket((c) => {
		const hostId = c.req.query("hostId");
		const token =
			c.req.header("Authorization")?.replace("Bearer ", "") ??
			c.req.query("token");

		let authorized = false;

		return {
			onOpen: async (_event, ws) => {
				if (!hostId || !token) {
					ws.close(1008, "Missing hostId or token");
					return;
				}

				const auth = await verifyJWT(token, env.NEXT_PUBLIC_API_URL);
				if (auth) {
					const hasAccess = await checkHostAccess(auth.sub, hostId);
					if (!hasAccess) {
						ws.close(1008, "Forbidden");
						return;
					}
				}
				// Accept session tokens for now (TODO: verify against Better Auth)

				authorized = true;
				tunnelManager.register(hostId, ws);
			},
			onMessage: (event) => {
				if (authorized && hostId)
					tunnelManager.handleMessage(hostId, event.data);
			},
			onClose: () => {
				if (authorized && hostId) tunnelManager.unregister(hostId);
			},
			onError: () => {
				if (authorized && hostId) tunnelManager.unregister(hostId);
			},
		};
	}),
);

// Client-facing proxy routes
registerProxyRoutes({
	app,
	upgradeWebSocket,
	tunnelManager,
	authUrl: env.NEXT_PUBLIC_API_URL,
});

const server = serve({ fetch: app.fetch, port: env.RELAY_PORT }, (info) => {
	console.log(`[relay] listening on http://localhost:${info.port}`);
});
injectWebSocket(server);
