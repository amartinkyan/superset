export interface GitHubEmail {
	email: string;
	primary: boolean;
	verified: boolean;
	visibility: "public" | "private" | null;
}

/**
 * Select the correct email from a GitHub user's email list.
 *
 * GitHub's /user endpoint returns the user's "public" email, which may differ
 * from their primary email. When a list of emails is available from
 * /user/emails, we should always prefer the primary verified email over
 * whatever the /user endpoint returned.
 *
 * Priority:
 *   1. Primary + verified email
 *   2. Primary email (even if unverified)
 *   3. First verified email
 *   4. profileEmail (from /user endpoint) as last resort
 */
export function selectGitHubPrimaryEmail(
	emails: GitHubEmail[] | null | undefined,
	profileEmail: string | null | undefined,
): { email: string; emailVerified: boolean } | null {
	if (emails && emails.length > 0) {
		const primaryVerified = emails.find((e) => e.primary && e.verified);
		if (primaryVerified) {
			return { email: primaryVerified.email, emailVerified: true };
		}

		const primary = emails.find((e) => e.primary);
		if (primary) {
			return { email: primary.email, emailVerified: primary.verified };
		}

		const firstVerified = emails.find((e) => e.verified);
		if (firstVerified) {
			return { email: firstVerified.email, emailVerified: true };
		}

		// Fall back to first email in list
		const first = emails[0];
		if (first) {
			return { email: first.email, emailVerified: first.verified };
		}
	}

	if (profileEmail) {
		return { email: profileEmail, emailVerified: false };
	}

	return null;
}
