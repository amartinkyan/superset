/**
 * Host-service auth registry.
 *
 * Module-level secret store keyed by hostUrl. HostServiceProvider writes
 * secrets here; all host-service clients (tRPC + WebSocket) read lazily
 * via callback headers — mirroring the api-trpc-client.ts getAuthToken()
 * pattern. This is the single auth configuration point for host-service
 * connections in the renderer.
 */

const secrets = new Map<string, string>();

export function setHostServiceSecret(hostUrl: string, secret: string): void {
	secrets.set(hostUrl, secret);
}

export function removeHostServiceSecret(hostUrl: string): void {
	secrets.delete(hostUrl);
}

export function getHostServiceHeaders(
	hostUrl: string,
): Record<string, string> {
	const secret = secrets.get(hostUrl);
	return secret ? { Authorization: `Bearer ${secret}` } : {};
}

export function getHostServiceWsToken(hostUrl: string): string | null {
	return secrets.get(hostUrl) ?? null;
}
