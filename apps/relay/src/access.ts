import { db } from "@superset/db/client";
import { v2UsersHosts } from "@superset/db/schema";
import { and, eq } from "drizzle-orm";

const TTL_MS = 5 * 60 * 1000;

const cache = new Map<string, { allowed: boolean; expiresAt: number }>();

export async function checkHostAccess(
	userId: string,
	hostId: string,
): Promise<boolean> {
	const key = `${userId}:${hostId}`;
	const cached = cache.get(key);
	if (cached && cached.expiresAt > Date.now()) {
		return cached.allowed;
	}

	const row = await db.query.v2UsersHosts.findFirst({
		where: and(
			eq(v2UsersHosts.userId, userId),
			eq(v2UsersHosts.hostId, hostId),
		),
		columns: { id: true },
	});

	const allowed = !!row;
	cache.set(key, { allowed, expiresAt: Date.now() + TTL_MS });
	return allowed;
}
