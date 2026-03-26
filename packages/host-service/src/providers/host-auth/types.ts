export interface HostAuthProvider {
	/** Validate an inbound HTTP request. Return true if authorized. */
	validate(request: Request): Promise<boolean> | boolean;
	/** Validate a raw token string (e.g. from a WebSocket ?token= query param). */
	validateToken(token: string): Promise<boolean> | boolean;
}
