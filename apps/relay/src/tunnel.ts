import { timingSafeEqual } from "node:crypto";
import type { NodeWebSocket } from "@hono/node-ws";
import type { Hono } from "hono";
import type {
	TunnelHttpResponse,
	TunnelRequest,
	TunnelResponse,
} from "./types";

type WsSocket = {
	send: (data: string) => void;
	readyState: number;
	close: (code?: number, reason?: string) => void;
};

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

		this.tunnels.set(hostId, {
			hostId,
			ws,
			pendingRequests: new Map(),
			activeChannels: new Map(),
		});

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
		return this.tunnels.has(hostId);
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
		if (!tunnel) {
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
		if (!tunnel) {
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

		let message: TunnelResponse;
		try {
			message = JSON.parse(String(data)) as TunnelResponse;
		} catch {
			return;
		}

		if (message.type === "http:response") {
			const pending = tunnel.pendingRequests.get(message.id);
			if (pending) {
				clearTimeout(pending.timer);
				tunnel.pendingRequests.delete(message.id);
				pending.resolve(message);
			}
		} else if (message.type === "ws:frame") {
			const channel = tunnel.activeChannels.get(message.id);
			if (channel && channel.clientWs.readyState === 1) {
				channel.clientWs.send(message.data);
			}
		} else if (message.type === "ws:close") {
			const channel = tunnel.activeChannels.get(message.id);
			if (channel) {
				tunnel.activeChannels.delete(message.id);
				channel.clientWs.close(message.code ?? 1000);
			}
		}
	}

	private sendToTunnel(tunnel: TunnelState, message: TunnelRequest): void {
		if (tunnel.ws.readyState === 1) {
			tunnel.ws.send(JSON.stringify(message));
		}
	}

	private cleanupTunnel(tunnel: TunnelState): void {
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

function validateTunnelSecret(provided: string, expected: string): boolean {
	const a = Buffer.from(provided);
	const b = Buffer.from(expected);
	if (a.length !== b.length) return false;
	return timingSafeEqual(a, b);
}

export interface RegisterTunnelRouteOptions {
	app: Hono;
	upgradeWebSocket: NodeWebSocket["upgradeWebSocket"];
	tunnelManager: TunnelManager;
	tunnelSecret: string;
}

export function registerTunnelRoute({
	app,
	upgradeWebSocket,
	tunnelManager,
	tunnelSecret,
}: RegisterTunnelRouteOptions) {
	app.get(
		"/tunnel",
		upgradeWebSocket((c) => {
			const hostId = c.req.query("hostId");
			const auth =
				c.req.header("Authorization")?.replace("Bearer ", "") ??
				c.req.query("token");

			if (!hostId || !auth || !validateTunnelSecret(auth, tunnelSecret)) {
				return {
					onOpen: (_event, ws) => {
						ws.close(1008, "Unauthorized");
					},
				};
			}

			return {
				onOpen: (_event, ws) => {
					tunnelManager.register(hostId, ws);
				},
				onMessage: (event, _ws) => {
					tunnelManager.handleTunnelMessage(hostId, event.data);
				},
				onClose: () => {
					tunnelManager.unregister(hostId);
				},
				onError: () => {
					tunnelManager.unregister(hostId);
				},
			};
		}),
	);
}
