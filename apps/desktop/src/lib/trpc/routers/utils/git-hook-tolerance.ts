interface GitCommandException extends Error {
	stdout?: string;
	stderr?: string;
}

function getErrorText(error: unknown): string {
	if (error instanceof Error) {
		const parts = [error.message];
		const gitError = error as GitCommandException;
		if (typeof gitError.stderr === "string" && gitError.stderr.trim()) {
			parts.push(gitError.stderr);
		}
		if (typeof gitError.stdout === "string" && gitError.stdout.trim()) {
			parts.push(gitError.stdout);
		}
		return parts.join("\n");
	}

	return String(error);
}

export function isPreCommitHookFailure(error: unknown): boolean {
	const text = getErrorText(error).toLowerCase();
	return (
		text.includes("pre-commit") ||
		(text.includes("hook") &&
			!text.includes("post-checkout") &&
			(text.includes("husky") ||
				text.includes("lint-staged") ||
				text.includes("hook returned") ||
				text.includes("hook failed")))
	);
}

/**
 * Extracts the full hook output (message + stderr + stdout) from a git error,
 * suitable for displaying to the user. Returns null if the error is not a
 * hook failure or has no meaningful extra output.
 */
export function extractGitHookOutput(error: unknown): string | null {
	const text = getErrorText(error);
	if (text.length === 0) return null;
	return text;
}

export function isPostCheckoutHookFailure(error: unknown): boolean {
	const text = getErrorText(error).toLowerCase();
	if (!text.includes("post-checkout")) {
		return false;
	}

	return (
		text.includes("hook") ||
		text.includes("husky") ||
		text.includes("command not found")
	);
}

export async function runWithPostCheckoutHookTolerance({
	run,
	didSucceed,
	context,
}: {
	run: () => Promise<void>;
	didSucceed: () => Promise<boolean>;
	context: string;
}): Promise<void> {
	try {
		await run();
	} catch (error) {
		if (!isPostCheckoutHookFailure(error)) {
			throw error;
		}

		let succeeded = false;
		try {
			succeeded = await didSucceed();
		} catch {
			succeeded = false;
		}

		if (!succeeded) {
			throw error;
		}

		const message = getErrorText(error);
		console.warn(
			`[git] ${context} but post-checkout hook failed (non-fatal): ${message}`,
		);
	}
}
