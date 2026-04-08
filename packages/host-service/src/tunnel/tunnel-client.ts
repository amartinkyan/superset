import type {
	TunnelHttpRequest,
	TunnelResponse,
	TunnelWsClose,
	TunnelWsFrame,
	TunnelWsOpen,
} from "./types";

const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

export interface TunnelClientOptions {
	relayUrl: string;
	hostId: string;
	getAuthToken: () => string | null;
	localPort: number;
}

export class TunnelClient {
	private readonly relayUrl: string;
	private readonly hostId: string;
	private readonly getAuthToken: () => string | null;
	private readonly localPort: number;
	private socket: WebSocket | null = null;
	private localChannels = new Map<string, WebSocket>();
	private reconnectAttempts = 0;
	private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	private closed = false;

	constructor(options: TunnelClientOptions) {
		this.relayUrl = options.relayUrl;
		this.hostId = options.hostId;
		this.getAuthToken = options.getAuthToken;
		this.localPort = options.localPort;
	}

	connect(): void {
		if (this.closed) return;

		const token = this.getAuthToken();
		if (!token) {
			console.warn("[host-service:tunnel] no auth token available, retrying");
			this.scheduleReconnect();
			return;
		}

		const url = new URL("/tunnel", this.relayUrl);
		url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
		url.searchParams.set("hostId", this.hostId);
		url.searchParams.set("token", token);

		const socket = new WebSocket(url.toString());
		this.socket = socket;

		socket.onopen = () => {
			this.reconnectAttempts = 0;
			console.log(
				`[host-service:tunnel] connected to relay for host ${this.hostId}`,
			);
		};

		socket.onmessage = (event) => {
			void this.handleMessage(event.data);
		};

		socket.onclose = () => {
			this.socket = null;
			this.cleanupChannels();
			if (!this.closed) {
				this.scheduleReconnect();
			}
		};

		socket.onerror = () => {
			// onclose fires after onerror
		};
	}

	close(): void {
		this.closed = true;
		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer);
			this.reconnectTimer = null;
		}
		this.cleanupChannels();
		if (
			this.socket?.readyState === WebSocket.CONNECTING ||
			this.socket?.readyState === WebSocket.OPEN
		) {
			this.socket.close(1000, "Shutting down");
		}
		this.socket = null;
	}

	private send(message: TunnelResponse): void {
		if (this.socket?.readyState === WebSocket.OPEN) {
			this.socket.send(JSON.stringify(message));
		}
	}

	private async handleMessage(data: unknown): Promise<void> {
		let message: Record<string, unknown>;
		try {
			message = JSON.parse(String(data));
		} catch {
			return;
		}

		// Handle keepalive
		if (message.type === "ping") {
			this.send({ type: "pong" } as unknown as TunnelResponse);
			return;
		}

		// Handle hello:ok (handshake complete)
		if (message.type === "hello:ok") {
			return;
		}

		const typed = message as unknown as
			| TunnelHttpRequest
			| TunnelWsOpen
			| TunnelWsFrame
			| TunnelWsClose;

		if (typed.type === "http") {
			await this.handleHttpRequest(typed);
		} else if (typed.type === "ws:open") {
			this.handleWsOpen(typed);
		} else if (typed.type === "ws:frame") {
			this.handleWsFrame(typed);
		} else if (typed.type === "ws:close") {
			this.handleWsClose(typed);
		}
	}

	private async handleHttpRequest(req: TunnelHttpRequest): Promise<void> {
		try {
			const url = `http://127.0.0.1:${this.localPort}${req.path}`;
			const response = await fetch(url, {
				method: req.method,
				headers: req.headers,
				body: req.body ?? undefined,
			});

			const body = await response.text();
			const headers: Record<string, string> = {};
			for (const [key, value] of response.headers.entries()) {
				headers[key] = value;
			}

			this.send({
				type: "http:response",
				id: req.id,
				status: response.status,
				headers,
				body,
			});
		} catch {
			this.send({
				type: "http:response",
				id: req.id,
				status: 502,
				headers: {},
				body: "Failed to reach local host-service",
			});
		}
	}

	private handleWsOpen(req: TunnelWsOpen): void {
		const wsUrl = new URL(req.path, `ws://127.0.0.1:${this.localPort}`);
		if (req.query) {
			for (const param of req.query.split("&")) {
				const [key, value] = param.split("=");
				if (key) wsUrl.searchParams.set(key, decodeURIComponent(value ?? ""));
			}
		}

		const localWs = new WebSocket(wsUrl.toString());

		localWs.onmessage = (event) => {
			this.send({
				type: "ws:frame",
				id: req.id,
				data: String(event.data),
			});
		};

		localWs.onclose = (event) => {
			this.localChannels.delete(req.id);
			this.send({
				type: "ws:close",
				id: req.id,
				code: event.code,
			});
		};

		localWs.onerror = () => {
			this.localChannels.delete(req.id);
			this.send({
				type: "ws:close",
				id: req.id,
				code: 1011,
			});
		};

		this.localChannels.set(req.id, localWs);
	}

	private handleWsFrame(msg: TunnelWsFrame): void {
		const localWs = this.localChannels.get(msg.id);
		if (localWs?.readyState === WebSocket.OPEN) {
			localWs.send(msg.data);
		}
	}

	private handleWsClose(msg: TunnelWsClose): void {
		const localWs = this.localChannels.get(msg.id);
		if (localWs) {
			this.localChannels.delete(msg.id);
			localWs.close(msg.code ?? 1000);
		}
	}

	private cleanupChannels(): void {
		for (const [id, ws] of this.localChannels) {
			ws.close(1001, "Tunnel disconnected");
			this.localChannels.delete(id);
		}
	}

	private scheduleReconnect(): void {
		if (this.closed || this.reconnectTimer) return;

		const delay = Math.min(
			RECONNECT_BASE_MS * 2 ** this.reconnectAttempts,
			RECONNECT_MAX_MS,
		);
		this.reconnectAttempts++;

		console.log(
			`[host-service:tunnel] reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`,
		);

		this.reconnectTimer = setTimeout(() => {
			this.reconnectTimer = null;
			this.connect();
		}, delay);
	}
}
