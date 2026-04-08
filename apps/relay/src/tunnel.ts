import type { NodeWebSocket } from "@hono/node-ws";
import { db } from "@superset/db/client";
import { v2Hosts } from "@superset/db/schema";
import { eq } from "drizzle-orm";
import type { Hono } from "hono";
import { checkHostAccess } from "./access";
import { verifyJWT } from "./auth";
import type { TunnelHttpResponse, TunnelRequest } from "./types";

type WsSocket = {
	send: (data: string) => void;
	readyState: number;
	close: (code?: number, reason?: string) => void;
};

const PING_INTERVAL_MS = 30_000;
const PING_TIMEOUT_MISSED = 3;

interface PendingRequest {
	resolve: (response: TunnelHttpResponse) => void;
	reject: (error: Error) => void;
	timer: ReturnType<typeof setTimeout>;
}

interface WsChannel {
	clientWs: WsSocket;
}

interface TunnelState {
	hostId: string;
	ws: WsSocket;
	pendingRequests: Map<string, PendingRequest>;
	activeChannels: Map<string, WsChannel>;
	pingTimer: ReturnType<typeof setInterval> | null;
	missedPings: number;
	handshakeComplete: boolean;
}

export class TunnelManager {
	private readonly tunnels = new Map<string, TunnelState>();
	private readonly requestTimeoutMs: number;

	constructor(requestTimeoutMs = 30_000) {
		this.requestTimeoutMs = requestTimeoutMs;
	}

	register(hostId: string, ws: WsSocket): void {
		const existing = this.tunnels.get(hostId);
		if (existing) {
			this.cleanupTunnel(existing);
			existing.ws.close(1000, "Replaced by new tunnel");
		}

		const tunnel: TunnelState = {
			hostId,
			ws,
			pendingRequests: new Map(),
			activeChannels: new Map(),
			pingTimer: null,
			missedPings: 0,
			handshakeComplete: false,
		};

		this.tunnels.set(hostId, tunnel);

		// Send hello and wait for hello response
		this.sendRaw(ws, {
			type: "hello:ok",
			protocolVersion: 1,
		});
		tunnel.handshakeComplete = true;

		// Start keepalive pings
		tunnel.pingTimer = setInterval(() => {
			tunnel.missedPings++;
			if (tunnel.missedPings >= PING_TIMEOUT_MISSED) {
				console.log(
					`[relay] tunnel ${hostId} missed ${PING_TIMEOUT_MISSED} pings, dropping`,
				);
				ws.close(1001, "Ping timeout");
				return;
			}
			this.sendRaw(ws, { type: "ping" });
		}, PING_INTERVAL_MS);

		// Update host status in DB
		void db
			.update(v2Hosts)
			.set({ lastSeenAt: new Date() })
			.where(eq(v2Hosts.id, hostId))
			.catch((err) =>
				console.error("[relay] failed to update host status:", err),
			);

		console.log(`[relay] tunnel registered for host ${hostId}`);
	}

	unregister(hostId: string): void {
		const tunnel = this.tunnels.get(hostId);
		if (!tunnel) return;

		this.cleanupTunnel(tunnel);
		this.tunnels.delete(hostId);

		console.log(`[relay] tunnel unregistered for host ${hostId}`);
	}

	hasTunnel(hostId: string): boolean {
		const tunnel = this.tunnels.get(hostId);
		return !!tunnel?.handshakeComplete;
	}

	async sendHttpRequest(
		hostId: string,
		req: {
			method: string;
			path: string;
			headers: Record<string, string>;
			body?: string;
		},
	): Promise<TunnelHttpResponse> {
		const tunnel = this.tunnels.get(hostId);
		if (!tunnel?.handshakeComplete) {
			throw new Error("Host not connected");
		}

		const id = crypto.randomUUID();
		const message: TunnelRequest = {
			type: "http",
			id,
			method: req.method,
			path: req.path,
			headers: req.headers,
			body: req.body,
		};

		return new Promise<TunnelHttpResponse>((resolve, reject) => {
			const timer = setTimeout(() => {
				tunnel.pendingRequests.delete(id);
				reject(new Error("Request timed out"));
			}, this.requestTimeoutMs);

			tunnel.pendingRequests.set(id, { resolve, reject, timer });
			this.sendToTunnel(tunnel, message);
		});
	}

	openWsChannel(
		hostId: string,
		path: string,
		query: string | undefined,
		clientWs: WsSocket,
	): string {
		const tunnel = this.tunnels.get(hostId);
		if (!tunnel?.handshakeComplete) {
			throw new Error("Host not connected");
		}

		const id = crypto.randomUUID();
		tunnel.activeChannels.set(id, { clientWs });

		this.sendToTunnel(tunnel, {
			type: "ws:open",
			id,
			path,
			query,
		});

		return id;
	}

	sendWsFrame(hostId: string, channelId: string, data: string): void {
		const tunnel = this.tunnels.get(hostId);
		if (!tunnel) return;

		this.sendToTunnel(tunnel, {
			type: "ws:frame",
			id: channelId,
			data,
		});
	}

	closeWsChannel(hostId: string, channelId: string, code?: number): void {
		const tunnel = this.tunnels.get(hostId);
		if (!tunnel) return;

		tunnel.activeChannels.delete(channelId);
		this.sendToTunnel(tunnel, {
			type: "ws:close",
			id: channelId,
			code,
		});
	}

	handleTunnelMessage(hostId: string, data: unknown): void {
		const tunnel = this.tunnels.get(hostId);
		if (!tunnel) return;

		let message: { type: string; [key: string]: unknown };
		try {
			message = JSON.parse(String(data));
		} catch {
			return;
		}

		// Handle keepalive
		if (message.type === "pong") {
			tunnel.missedPings = 0;
			return;
		}

		if (message.type === "http:response") {
			const response = message as unknown as TunnelHttpResponse;
			const pending = tunnel.pendingRequests.get(response.id);
			if (pending) {
				clearTimeout(pending.timer);
				tunnel.pendingRequests.delete(response.id);
				pending.resolve(response);
			}
		} else if (message.type === "ws:frame") {
			const id = message.id as string;
			const channel = tunnel.activeChannels.get(id);
			if (channel && channel.clientWs.readyState === 1) {
				channel.clientWs.send(message.data as string);
			}
		} else if (message.type === "ws:close") {
			const id = message.id as string;
			const channel = tunnel.activeChannels.get(id);
			if (channel) {
				tunnel.activeChannels.delete(id);
				channel.clientWs.close((message.code as number) ?? 1000);
			}
		}
	}

	private sendRaw(ws: WsSocket, message: Record<string, unknown>): void {
		if (ws.readyState === 1) {
			ws.send(JSON.stringify(message));
		}
	}

	private sendToTunnel(tunnel: TunnelState, message: TunnelRequest): void {
		if (tunnel.ws.readyState === 1) {
			tunnel.ws.send(JSON.stringify(message));
		}
	}

	private cleanupTunnel(tunnel: TunnelState): void {
		if (tunnel.pingTimer) {
			clearInterval(tunnel.pingTimer);
			tunnel.pingTimer = null;
		}

		for (const [id, pending] of tunnel.pendingRequests) {
			clearTimeout(pending.timer);
			pending.reject(new Error("Tunnel disconnected"));
			tunnel.pendingRequests.delete(id);
		}

		for (const [id, channel] of tunnel.activeChannels) {
			channel.clientWs.close(1001, "Tunnel disconnected");
			tunnel.activeChannels.delete(id);
		}
	}
}

// ── Tunnel Route Registration ──────────────────────────────────────

export interface RegisterTunnelRouteOptions {
	app: Hono;
	upgradeWebSocket: NodeWebSocket["upgradeWebSocket"];
	tunnelManager: TunnelManager;
	authUrl: string;
}

export function registerTunnelRoute({
	app,
	upgradeWebSocket,
	tunnelManager,
	authUrl,
}: RegisterTunnelRouteOptions) {
	app.get(
		"/tunnel",
		upgradeWebSocket((c) => {
			const hostId = c.req.query("hostId");
			const token =
				c.req.header("Authorization")?.replace("Bearer ", "") ??
				c.req.query("token");

			// Auth is verified async before the WS handlers fire
			let authorized = false;

			return {
				onOpen: async (_event, ws) => {
					if (!hostId || !token) {
						ws.close(1008, "Missing hostId or token");
						return;
					}

					const auth = await verifyJWT(token, authUrl);
					if (!auth) {
						ws.close(1008, "Invalid token");
						return;
					}

					const hasAccess = await checkHostAccess(auth.sub, hostId);
					if (!hasAccess) {
						ws.close(1008, "Forbidden");
						return;
					}

					authorized = true;
					tunnelManager.register(hostId, ws);
				},
				onMessage: (event, _ws) => {
					if (authorized && hostId) {
						tunnelManager.handleTunnelMessage(hostId, event.data);
					}
				},
				onClose: () => {
					if (authorized && hostId) {
						tunnelManager.unregister(hostId);
					}
				},
				onError: () => {
					if (authorized && hostId) {
						tunnelManager.unregister(hostId);
					}
				},
			};
		}),
	);
}
