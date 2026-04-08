import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
	server: {
		PORT: z.coerce.number().int().positive().default(8080),
		AUTH_URL: z.string().url(),
		DATABASE_URL: z.string().min(1),
		REQUEST_TIMEOUT_MS: z.coerce.number().default(30_000),
	},
	runtimeEnv: process.env,
	emptyStringAsUndefined: true,
	skipValidation: !!process.env.SKIP_ENV_VALIDATION,
});
