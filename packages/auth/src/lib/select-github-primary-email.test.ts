import { describe, expect, test } from "bun:test";
import {
	type GitHubEmail,
	selectGitHubPrimaryEmail,
} from "./select-github-primary-email";

describe("selectGitHubPrimaryEmail", () => {
	test("prefers primary verified email over profile email", () => {
		const emails: GitHubEmail[] = [
			{
				email: "public@example.com",
				primary: false,
				verified: true,
				visibility: "public",
			},
			{
				email: "primary@example.com",
				primary: true,
				verified: true,
				visibility: "private",
			},
		];

		// This is the core bug: profile.email from /user is the public email,
		// but the user's actual primary email is different
		const result = selectGitHubPrimaryEmail(emails, "public@example.com");
		expect(result).toEqual({
			email: "primary@example.com",
			emailVerified: true,
		});
	});

	test("uses primary email even if unverified", () => {
		const emails: GitHubEmail[] = [
			{
				email: "verified@example.com",
				primary: false,
				verified: true,
				visibility: null,
			},
			{
				email: "primary@example.com",
				primary: true,
				verified: false,
				visibility: null,
			},
		];

		const result = selectGitHubPrimaryEmail(emails, "verified@example.com");
		expect(result).toEqual({
			email: "primary@example.com",
			emailVerified: false,
		});
	});

	test("falls back to first verified email when no primary exists", () => {
		const emails: GitHubEmail[] = [
			{
				email: "unverified@example.com",
				primary: false,
				verified: false,
				visibility: null,
			},
			{
				email: "verified@example.com",
				primary: false,
				verified: true,
				visibility: null,
			},
		];

		const result = selectGitHubPrimaryEmail(emails, null);
		expect(result).toEqual({
			email: "verified@example.com",
			emailVerified: true,
		});
	});

	test("falls back to first email when none are primary or verified", () => {
		const emails: GitHubEmail[] = [
			{
				email: "first@example.com",
				primary: false,
				verified: false,
				visibility: null,
			},
			{
				email: "second@example.com",
				primary: false,
				verified: false,
				visibility: null,
			},
		];

		const result = selectGitHubPrimaryEmail(emails, null);
		expect(result).toEqual({
			email: "first@example.com",
			emailVerified: false,
		});
	});

	test("falls back to profile email when emails list is empty", () => {
		const result = selectGitHubPrimaryEmail([], "profile@example.com");
		expect(result).toEqual({
			email: "profile@example.com",
			emailVerified: false,
		});
	});

	test("falls back to profile email when emails list is null", () => {
		const result = selectGitHubPrimaryEmail(null, "profile@example.com");
		expect(result).toEqual({
			email: "profile@example.com",
			emailVerified: false,
		});
	});

	test("returns null when no emails available at all", () => {
		const result = selectGitHubPrimaryEmail(null, null);
		expect(result).toBeNull();
	});

	test("returns null for undefined inputs", () => {
		const result = selectGitHubPrimaryEmail(undefined, undefined);
		expect(result).toBeNull();
	});

	/**
	 * Reproduction scenario from issue #2955:
	 * User has multiple GitHub emails. Their public email on the GitHub profile
	 * is different from their primary email. The old logic used the profile
	 * email (public) without checking /user/emails for the primary.
	 */
	test("reproduces issue #2955: wrong email picked from github", () => {
		// Simulate: user's GitHub profile has noreply@ as public email
		// but their actual primary email is their work email
		const profileEmail = "user-12345@users.noreply.github.com";
		const emails: GitHubEmail[] = [
			{
				email: "user-12345@users.noreply.github.com",
				primary: false,
				verified: true,
				visibility: null,
			},
			{
				email: "user@actual-email.com",
				primary: true,
				verified: true,
				visibility: "private",
			},
		];

		// Old better-auth logic: if profile.email is truthy, skip the emails list
		// This is the bug — it would use the noreply email
		const oldBehavior = profileEmail; // would keep "user-12345@users.noreply.github.com"

		// New logic: always prefer primary from emails list
		const result = selectGitHubPrimaryEmail(emails, profileEmail);

		// The old behavior incorrectly kept the noreply email
		expect(oldBehavior).toBe("user-12345@users.noreply.github.com");

		// The fix correctly selects the primary email
		expect(result).toEqual({
			email: "user@actual-email.com",
			emailVerified: true,
		});
	});
});
