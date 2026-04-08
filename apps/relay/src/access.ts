import { db } from "@superset/db/client";
import { v2UsersHosts } from "@superset/db/schema";
import { and, eq } from "drizzle-orm";
import { LRUCache } from "lru-cache";

const cache = new LRUCache<string, boolean>({
	max: 10_000,
	ttl: 5 * 60 * 1000,
});

export async function checkHostAccess(
	userId: string,
	hostId: string,
): Promise<boolean> {
	const key = `${userId}:${hostId}`;
	const cached = cache.get(key);
	if (cached !== undefined) return cached;

	const row = await db.query.v2UsersHosts.findFirst({
		where: and(
			eq(v2UsersHosts.userId, userId),
			eq(v2UsersHosts.hostId, hostId),
		),
		columns: { id: true },
	});

	const allowed = !!row;
	cache.set(key, allowed);
	return allowed;
}
