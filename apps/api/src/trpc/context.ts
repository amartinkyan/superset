import { auth, type Session } from "@superset/auth/server";
import { createTRPCContext } from "@superset/trpc";

async function resolveSession(req: Request): Promise<Session | null> {
	// JWT bearer tokens (used by relay and other services)
	const authHeader = req.headers.get("authorization");
	if (authHeader?.startsWith("Bearer ")) {
		const token = authHeader.slice(7);
		try {
			const { payload } = await auth.api.verifyJWT({ body: { token } });
			if (payload?.sub && Array.isArray(payload.organizationIds)) {
				return {
					user: { id: payload.sub, email: (payload.email as string) ?? "" },
					session: {
						activeOrganizationId:
							(payload.organizationIds as string[])[0] ?? null,
					},
				} as Session;
			}
		} catch {}
	}

	// Cookie / opaque session token fallback
	return auth.api.getSession({ headers: req.headers });
}

export const createContext = async ({
	req,
}: {
	req: Request;
	resHeaders: Headers;
}) => {
	const session = await resolveSession(req);
	return createTRPCContext({
		session,
		auth,
		headers: req.headers,
	});
};
