import { createApiClient } from "./api-client";

export async function checkHostAccess(
	token: string,
	hostId: string,
): Promise<boolean> {
	try {
		const client = createApiClient(token);
		const result = await client.device.checkHostAccess.query({ hostId });
		return result.allowed;
	} catch {
		return false;
	}
}
