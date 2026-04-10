import { describe, expect, mock, test } from "bun:test";
import { openProjectsAndEnsureWorkspaces } from "./openProjectsAndEnsureWorkspaces";

// biome-ignore lint/suspicious/noExplicitAny: minimal stub for test — only id/name are relevant
type FakeProject = any;

const fakeProject = (id: string, name = `project-${id}`): FakeProject => ({
	id,
	name,
});

describe("openProjectsAndEnsureWorkspaces", () => {
	test("creates a main-repo workspace for each imported project", async () => {
		const projects = [fakeProject("p1"), fakeProject("p2")];
		const openNew = mock(() => Promise.resolve(projects));
		const openMainRepoWorkspace = mock(() => Promise.resolve(undefined));

		const result = await openProjectsAndEnsureWorkspaces({
			openNew,
			openMainRepoWorkspace,
		});

		expect(result).toEqual(projects);
		expect(openMainRepoWorkspace).toHaveBeenCalledTimes(2);
		expect(openMainRepoWorkspace).toHaveBeenCalledWith({ projectId: "p1" });
		expect(openMainRepoWorkspace).toHaveBeenCalledWith({ projectId: "p2" });
	});

	test("returns empty array when no projects are opened", async () => {
		const openNew = mock(() => Promise.resolve([]));
		const openMainRepoWorkspace = mock(() => Promise.resolve(undefined));

		const result = await openProjectsAndEnsureWorkspaces({
			openNew,
			openMainRepoWorkspace,
		});

		expect(result).toEqual([]);
		expect(openMainRepoWorkspace).not.toHaveBeenCalled();
	});

	test("calls onProjectError and continues when workspace creation fails for one project", async () => {
		const projects = [fakeProject("p1"), fakeProject("p2"), fakeProject("p3")];
		const openNew = mock(() => Promise.resolve(projects));
		const wsError = new Error("workspace creation failed");
		const openMainRepoWorkspace = mock((input: { projectId: string }) => {
			if (input.projectId === "p2") return Promise.reject(wsError);
			return Promise.resolve(undefined);
		});
		const onProjectError = mock(() => {});

		const result = await openProjectsAndEnsureWorkspaces({
			openNew,
			openMainRepoWorkspace,
			onProjectError,
		});

		expect(result).toEqual(projects);
		expect(openMainRepoWorkspace).toHaveBeenCalledTimes(3);
		expect(onProjectError).toHaveBeenCalledTimes(1);
		expect(onProjectError).toHaveBeenCalledWith(projects[1], wsError);
	});

	test("propagates error when openNew itself fails", async () => {
		const openNew = mock(() => Promise.reject(new Error("dialog failed")));
		const openMainRepoWorkspace = mock(() => Promise.resolve(undefined));

		await expect(
			openProjectsAndEnsureWorkspaces({
				openNew,
				openMainRepoWorkspace,
			}),
		).rejects.toThrow("dialog failed");

		expect(openMainRepoWorkspace).not.toHaveBeenCalled();
	});
});
