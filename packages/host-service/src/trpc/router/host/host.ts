import os from "node:os";
import { getDeviceName, getHashedDeviceId } from "@superset/shared/device-info";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../../index";

const HOST_SERVICE_VERSION = "0.1.0";
const ORGANIZATION_CACHE_TTL_MS = 60 * 60 * 1000;

let cachedOrganization: {
	data: { id: string; name: string; slug: string };
	cachedAt: number;
} | null = null;

async function getOrganization(input: {
	api?: {
		organization: {
			getActiveFromJwt: {
				query: () => Promise<{ id: string; name: string; slug: string } | null>;
			};
		};
	};
	organizationId: string;
}): Promise<{ id: string; name: string; slug: string }> {
	if (!input.api) {
		return {
			id: input.organizationId,
			name: "Local Development",
			slug: "local-development",
		};
	}

	if (
		cachedOrganization &&
		Date.now() - cachedOrganization.cachedAt < ORGANIZATION_CACHE_TTL_MS
	) {
		return cachedOrganization.data;
	}

	const organization = await input.api.organization.getActiveFromJwt.query();
	if (!organization) {
		throw new TRPCError({
			code: "PRECONDITION_FAILED",
			message: "No active organization",
		});
	}

	cachedOrganization = { data: organization, cachedAt: Date.now() };
	return organization;
}

export const hostRouter = router({
	info: protectedProcedure.query(async ({ ctx }) => {
		const organization = await getOrganization({
			api: ctx.api,
			organizationId: ctx.organizationId,
		});

		return {
			hostId: getHashedDeviceId(),
			hostName: getDeviceName(),
			version: HOST_SERVICE_VERSION,
			organization,
			platform: os.platform(),
			uptime: process.uptime(),
		};
	}),
});
