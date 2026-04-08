import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
	server: {
		RELAY_PORT: z.coerce.number().int().positive().default(8080),
		NEXT_PUBLIC_API_URL: z.url(),
		DATABASE_URL: z.string().min(1),
	},
	runtimeEnv: process.env,
	emptyStringAsUndefined: true,
	skipValidation: !!process.env.SKIP_ENV_VALIDATION,
});
