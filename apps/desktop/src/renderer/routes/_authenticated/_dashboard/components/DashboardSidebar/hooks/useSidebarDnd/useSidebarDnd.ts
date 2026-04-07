import {
	closestCenter,
	type DragEndEvent,
	type DragStartEvent,
	KeyboardSensor,
	MeasuringStrategy,
	MouseSensor,
	TouchSensor,
	type UniqueIdentifier,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
import { arrayMove, sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDashboardSidebarState } from "renderer/routes/_authenticated/hooks/useDashboardSidebarState";
import type {
	DashboardSidebarProjectChild,
	DashboardSidebarSection,
	DashboardSidebarWorkspace,
} from "../../types";

// ── ID helpers ───────────────────────────────────────────────────────

const WS = "ws::";
const SEC = "sec::";

export const wsId = (id: string) => `${WS}${id}`;
export const secId = (id: string) => `${SEC}${id}`;
export const isSec = (id: UniqueIdentifier) => String(id).startsWith(SEC);

export const parseId = (id: UniqueIdentifier) => {
	const s = String(id);
	if (s.startsWith(WS))
		return { type: "workspace" as const, realId: s.slice(WS.length) };
	if (s.startsWith(SEC))
		return { type: "section" as const, realId: s.slice(SEC.length) };
	return null;
};

// ── Measuring config ─────────────────────────────────────────────────

export const measuring = {
	droppable: { strategy: MeasuringStrategy.Always as const },
};

// ── Build flat list from project children ────────────────────────────

function buildFlatItems(
	children: DashboardSidebarProjectChild[],
): UniqueIdentifier[] {
	const items: UniqueIdentifier[] = [];
	for (const child of children) {
		if (child.type === "workspace") {
			items.push(wsId(child.workspace.id));
		} else {
			items.push(secId(child.section.id));
			// Only include workspaces if section is expanded
			if (!child.section.isCollapsed) {
				for (const ws of child.section.workspaces) {
					items.push(wsId(ws.id));
				}
			}
		}
	}
	return items;
}

// ── Parse flat list to determine section membership ──────────────────

interface ParsedFlatItems {
	topLevel: Array<{ type: "workspace" | "section"; id: string }>;
	sections: Record<string, string[]>;
}

function parseFlatItems(items: UniqueIdentifier[]): ParsedFlatItems {
	const result: ParsedFlatItems = { topLevel: [], sections: {} };
	let currentSection: string | null = null;

	for (const id of items) {
		const parsed = parseId(id);
		if (!parsed) continue;
		if (parsed.type === "section") {
			currentSection = parsed.realId;
			result.topLevel.push({ type: "section", id: parsed.realId });
			result.sections[parsed.realId] = [];
		} else if (parsed.type === "workspace") {
			if (currentSection) {
				result.sections[currentSection].push(parsed.realId);
			} else {
				result.topLevel.push({ type: "workspace", id: parsed.realId });
			}
		}
	}
	return result;
}

// ── Hook ─────────────────────────────────────────────────────────────

interface UseSidebarDndOptions {
	projectId: string;
	projectChildren: DashboardSidebarProjectChild[];
}

export function useSidebarDnd({
	projectId,
	projectChildren,
}: UseSidebarDndOptions) {
	const { reorderProjectChildren, moveWorkspaceToSectionAtIndex } =
		useDashboardSidebarState();

	const sensors = useSensors(
		useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
		useSensor(TouchSensor, {
			activationConstraint: { delay: 200, tolerance: 5 },
		}),
		useSensor(KeyboardSensor, {
			coordinateGetter: sortableKeyboardCoordinates,
		}),
	);

	const [flatItems, setFlatItems] = useState<UniqueIdentifier[]>(() =>
		buildFlatItems(projectChildren),
	);
	const [activeId, setActiveId] = useState<UniqueIdentifier | null>(null);
	const clonedRef = useRef<UniqueIdentifier[] | null>(null);

	// Sync from external data only when items are added/removed
	const prevFingerprintRef = useRef("");
	useEffect(() => {
		const fingerprint = projectChildren
			.map((c) =>
				c.type === "workspace"
					? c.workspace.id
					: `s:${c.section.id}:${c.section.isCollapsed}`,
			)
			.sort()
			.join(",");
		if (fingerprint !== prevFingerprintRef.current) {
			prevFingerprintRef.current = fingerprint;
			setFlatItems(buildFlatItems(projectChildren));
		}
	}, [projectChildren]);

	// ── Lookups ──────────────────────────────────────────────────────

	const workspacesById = useMemo(() => {
		const map = new Map<string, DashboardSidebarWorkspace>();
		for (const child of projectChildren) {
			if (child.type === "workspace") {
				map.set(child.workspace.id, child.workspace);
			} else {
				for (const ws of child.section.workspaces) {
					map.set(ws.id, ws);
				}
			}
		}
		return map;
	}, [projectChildren]);

	const sectionsById = useMemo(() => {
		const map = new Map<string, DashboardSidebarSection>();
		for (const child of projectChildren) {
			if (child.type === "section") {
				map.set(child.section.id, child.section);
			}
		}
		return map;
	}, [projectChildren]);

	// Which section does each workspace belong to? (for visual grouping)
	const groupInfo = useMemo(() => {
		const map = new Map<string, { sectionId: string; color: string | null }>();
		let currentSection: { id: string; color: string | null } | null = null;

		for (const id of flatItems) {
			const parsed = parseId(id);
			if (!parsed) continue;
			if (parsed.type === "section") {
				const sec = sectionsById.get(parsed.realId);
				currentSection = sec ? { id: sec.id, color: sec.color } : null;
			} else if (parsed.type === "workspace" && currentSection) {
				map.set(parsed.realId, {
					sectionId: currentSection.id,
					color: currentSection.color,
				});
			}
		}
		return map;
	}, [flatItems, sectionsById]);

	const activeItem = useMemo(() => {
		if (!activeId) return null;
		const parsed = parseId(activeId);
		if (!parsed) return null;
		if (parsed.type === "workspace") {
			const ws = workspacesById.get(parsed.realId);
			return ws ? { type: "workspace" as const, workspace: ws } : null;
		}
		const sec = sectionsById.get(parsed.realId);
		return sec ? { type: "section" as const, section: sec } : null;
	}, [activeId, workspacesById, sectionsById]);

	// ── Persistence ──────────────────────────────────────────────────

	const commitToDb = useCallback(
		(items: UniqueIdentifier[]) => {
			const parsed = parseFlatItems(items);

			// Top-level order (ungrouped workspaces + sections interleaved)
			reorderProjectChildren(projectId, parsed.topLevel);

			// Each section's workspace order
			for (const [sectionId, wsIds] of Object.entries(parsed.sections)) {
				for (let i = 0; i < wsIds.length; i++) {
					moveWorkspaceToSectionAtIndex(wsIds[i], projectId, sectionId, i);
				}
			}
		},
		[projectId, reorderProjectChildren, moveWorkspaceToSectionAtIndex],
	);

	// ── Handlers ─────────────────────────────────────────────────────

	const onDragStart = useCallback(
		({ active }: DragStartEvent) => {
			setActiveId(active.id);
			clonedRef.current = [...flatItems];
		},
		[flatItems],
	);

	const onDragEnd = useCallback(
		({ active, over }: DragEndEvent) => {
			setActiveId(null);

			if (!over || active.id === over.id) return;

			const oldIndex = flatItems.indexOf(active.id);
			const overIndex = flatItems.indexOf(over.id);
			if (oldIndex === -1 || overIndex === -1) return;

			let newItems: UniqueIdentifier[];

			if (isSec(active.id)) {
				// Section drag: move the header AND all its workspaces as a group
				const groupStart = oldIndex;
				let groupEnd = groupStart + 1;
				while (groupEnd < flatItems.length && !isSec(flatItems[groupEnd])) {
					groupEnd++;
				}
				const group = flatItems.slice(groupStart, groupEnd);
				const without = [
					...flatItems.slice(0, groupStart),
					...flatItems.slice(groupEnd),
				];

				// Find insertion point in the array without the group
				const newOverIndex = without.indexOf(over.id);
				const insertAt = newOverIndex >= 0 ? newOverIndex : without.length;

				newItems = [
					...without.slice(0, insertAt),
					...group,
					...without.slice(insertAt),
				];
			} else {
				// Workspace drag: simple arrayMove
				newItems = arrayMove(flatItems, oldIndex, overIndex);
			}

			setFlatItems(newItems);
			commitToDb(newItems);
		},
		[flatItems, commitToDb],
	);

	const onDragCancel = useCallback(() => {
		if (clonedRef.current) {
			setFlatItems(clonedRef.current);
		}
		setActiveId(null);
		clonedRef.current = null;
	}, []);

	return {
		sensors,
		measuring,
		collisionDetection: closestCenter,
		flatItems,
		activeId,
		activeItem,
		groupInfo,
		workspacesById,
		sectionsById,
		handlers: { onDragStart, onDragEnd, onDragCancel },
	};
}
