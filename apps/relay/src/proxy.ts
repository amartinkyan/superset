import type { NodeWebSocket } from "@hono/node-ws";
import type { Context, Hono, MiddlewareHandler } from "hono";
import { checkHostAccess } from "./access";
import { verifyJWT } from "./auth";
import type { TunnelManager } from "./tunnel";

// ── Auth Middleware ─────────────────────────────────────────────────

function extractToken(c: Context): string | null {
	const header = c.req.header("Authorization");
	if (header?.startsWith("Bearer ")) {
		return header.slice(7);
	}
	return c.req.query("token") ?? null;
}

function createAuthMiddleware(
	authUrl: string,
	tunnelManager: TunnelManager,
): MiddlewareHandler {
	return async (c, next) => {
		const token = extractToken(c);
		if (!token) {
			return c.json({ error: "Unauthorized" }, 401);
		}

		const auth = await verifyJWT(token, authUrl);
		if (!auth) {
			return c.json({ error: "Unauthorized" }, 401);
		}

		const hostId = c.req.param("hostId");
		if (!hostId) {
			return c.json({ error: "Missing hostId" }, 400);
		}

		const hasAccess = await checkHostAccess(auth.sub, hostId);
		if (!hasAccess) {
			return c.json({ error: "Forbidden" }, 403);
		}

		if (!tunnelManager.hasTunnel(hostId)) {
			return c.json({ error: "Host not connected" }, 503);
		}

		c.set("auth", auth);
		c.set("hostId", hostId);
		return next();
	};
}

// ── Route Registration ─────────────────────────────────────────────

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
	const authMiddleware = createAuthMiddleware(authUrl, tunnelManager);

	// HTTP proxy — tRPC and any other HTTP endpoints
	app.all("/v2-hosts/:hostId/trpc/*", authMiddleware, async (c) => {
		const hostId = c.req.param("hostId");
		const fullPath = c.req.path.replace(`/v2-hosts/${hostId}`, "");
		const body = await c.req.text().catch(() => undefined);

		const headers: Record<string, string> = {};
		for (const [key, value] of c.req.raw.headers.entries()) {
			if (
				key.toLowerCase() !== "host" &&
				key.toLowerCase() !== "authorization"
			) {
				headers[key] = value;
			}
		}

		try {
			const response = await tunnelManager.sendHttpRequest(hostId, {
				method: c.req.method,
				path: fullPath,
				headers,
				body: body || undefined,
			});

			return new Response(response.body ?? null, {
				status: response.status,
				headers: response.headers,
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : "Proxy error";
			return c.json({ error: message }, 502);
		}
	});

	// WS proxy — event bus
	app.get(
		"/v2-hosts/:hostId/events",
		authMiddleware,
		upgradeWebSocket((c) => {
			const hostId = c.req.param("hostId")!;
			let channelId: string | null = null;

			return {
				onOpen: (_event, ws) => {
					try {
						channelId = tunnelManager.openWsChannel(
							hostId,
							"/events",
							undefined,
							ws,
						);
					} catch {
						ws.close(1011, "Failed to open channel");
					}
				},
				onMessage: (event, _ws) => {
					if (channelId) {
						tunnelManager.sendWsFrame(hostId, channelId, String(event.data));
					}
				},
				onClose: () => {
					if (channelId) {
						tunnelManager.closeWsChannel(hostId, channelId);
					}
				},
				onError: () => {
					if (channelId) {
						tunnelManager.closeWsChannel(hostId, channelId);
					}
				},
			};
		}),
	);

	// WS proxy — terminals
	app.get(
		"/v2-hosts/:hostId/terminal/:terminalId",
		authMiddleware,
		upgradeWebSocket((c) => {
			const hostId = c.req.param("hostId")!;
			const terminalId = c.req.param("terminalId")!;
			const query = c.req.url.split("?")[1];
			let channelId: string | null = null;

			return {
				onOpen: (_event, ws) => {
					try {
						channelId = tunnelManager.openWsChannel(
							hostId,
							`/terminal/${terminalId}`,
							query,
							ws,
						);
					} catch {
						ws.close(1011, "Failed to open channel");
					}
				},
				onMessage: (event, _ws) => {
					if (channelId) {
						tunnelManager.sendWsFrame(hostId, channelId, String(event.data));
					}
				},
				onClose: () => {
					if (channelId) {
						tunnelManager.closeWsChannel(hostId, channelId);
					}
				},
				onError: () => {
					if (channelId) {
						tunnelManager.closeWsChannel(hostId, channelId);
					}
				},
			};
		}),
	);
}
