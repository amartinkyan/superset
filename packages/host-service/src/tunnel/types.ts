// These types mirror apps/relay/src/types.ts — the tunnel protocol.
// Eventually these should live in a shared package.

export interface TunnelHttpRequest {
	type: "http";
	id: string;
	method: string;
	path: string;
	headers: Record<string, string>;
	body?: string;
}

export interface TunnelWsOpen {
	type: "ws:open";
	id: string;
	path: string;
	query?: string;
}

export interface TunnelWsFrame {
	type: "ws:frame";
	id: string;
	data: string;
}

export interface TunnelWsClose {
	type: "ws:close";
	id: string;
	code?: number;
}

export interface TunnelHttpResponse {
	type: "http:response";
	id: string;
	status: number;
	headers: Record<string, string>;
	body?: string;
}

export type TunnelRequest =
	| TunnelHttpRequest
	| TunnelWsOpen
	| TunnelWsFrame
	| TunnelWsClose;

export type TunnelResponse = TunnelHttpResponse | TunnelWsFrame | TunnelWsClose;
