import type { NodeWebSocket } from "@hono/node-ws";
import type { Context, Hono, MiddlewareHandler } from "hono";
import { checkHostAccess } from "./access";
import { verifyJWT } from "./auth";
import type { TunnelManager } from "./tunnel";

function extractToken(c: Context): string | null {
	const header = c.req.header("Authorization");
	if (header?.startsWith("Bearer ")) return header.slice(7);
	return c.req.query("token") ?? null;
}

function createAuthMiddleware(
	authUrl: string,
	tunnelManager: TunnelManager,
): MiddlewareHandler {
	return async (c, next) => {
		const token = extractToken(c);
		if (!token) return c.json({ error: "Unauthorized" }, 401);

		const auth = await verifyJWT(token, authUrl);
		if (!auth) return c.json({ error: "Unauthorized" }, 401);

		const hostId = c.req.param("hostId");
		if (!hostId) return c.json({ error: "Missing hostId" }, 400);

		const hasAccess = await checkHostAccess(auth.sub, hostId);
		if (!hasAccess) return c.json({ error: "Forbidden" }, 403);

		if (!tunnelManager.hasTunnel(hostId))
			return c.json({ error: "Host not connected" }, 503);

		c.set("auth", auth);
		c.set("hostId", hostId);
		return next();
	};
}

export interface RegisterProxyRoutesOptions {
	app: Hono;
	upgradeWebSocket: NodeWebSocket["upgradeWebSocket"];
	tunnelManager: TunnelManager;
	authUrl: string;
}

export function registerProxyRoutes({
	app,
	upgradeWebSocket,
	tunnelManager,
	authUrl,
}: RegisterProxyRoutesOptions) {
	const auth = createAuthMiddleware(authUrl, tunnelManager);

	// HTTP proxy — strips /hosts/:hostId prefix, forwards to host-service
	app.all("/hosts/:hostId/trpc/*", auth, async (c) => {
		const hostId = c.req.param("hostId");
		const path = c.req.path.replace(`/hosts/${hostId}`, "");
		const body = (await c.req.text().catch(() => "")) || undefined;

		const headers: Record<string, string> = {};
		for (const [key, value] of c.req.raw.headers.entries()) {
			if (key !== "host" && key !== "authorization") headers[key] = value;
		}

		try {
			const res = await tunnelManager.sendHttpRequest(hostId, {
				method: c.req.method,
				path,
				headers,
				body,
			});
			return new Response(res.body ?? null, {
				status: res.status,
				headers: res.headers,
			});
		} catch (error) {
			return c.json(
				{ error: error instanceof Error ? error.message : "Proxy error" },
				502,
			);
		}
	});

	// WS proxy — any WS upgrade under /hosts/:hostId/ gets tunneled
	app.get(
		"/hosts/:hostId/*",
		auth,
		upgradeWebSocket((c) => {
			const hostId = c.req.param("hostId")!;
			const path = c.req.path.replace(`/hosts/${hostId}`, "");
			const query = c.req.url.split("?")[1];
			let channelId: string | null = null;

			return {
				onOpen: (_event, ws) => {
					try {
						channelId = tunnelManager.openWsChannel(hostId, path, query, ws);
					} catch {
						ws.close(1011, "Failed to open channel");
					}
				},
				onMessage: (event) => {
					if (channelId)
						tunnelManager.sendWsFrame(hostId, channelId, String(event.data));
				},
				onClose: () => {
					if (channelId) tunnelManager.closeWsChannel(hostId, channelId);
				},
				onError: () => {
					if (channelId) tunnelManager.closeWsChannel(hostId, channelId);
				},
			};
		}),
	);
}
