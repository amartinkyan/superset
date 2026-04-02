import { describe, expect, it, mock } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

// ---------------------------------------------------------------------------
// Mock every external dependency so the component can render in isolation.
// ---------------------------------------------------------------------------

// UI primitives – render children transparently
const Passthrough = ({ children }: { children?: React.ReactNode }) => (
	<>{children}</>
);

mock.module("@superset/ui/dropdown-menu", () => ({
	DropdownMenu: Passthrough,
	DropdownMenuContent: Passthrough,
	DropdownMenuRadioGroup: Passthrough,
	DropdownMenuRadioItem: Passthrough,
	DropdownMenuTrigger: Passthrough,
}));

mock.module("@superset/ui/popover", () => ({
	Popover: ({
		children,
		open,
	}: {
		children?: React.ReactNode;
		open?: boolean;
	}) => <div data-popover-open={open}>{children}</div>,
	PopoverContent: Passthrough,
	PopoverTrigger: Passthrough,
}));

mock.module("@superset/ui/tooltip", () => ({
	Tooltip: Passthrough,
	TooltipContent: Passthrough,
	TooltipTrigger: Passthrough,
}));

mock.module("@tanstack/react-db", () => ({
	useLiveQuery: () => ({ data: [] }),
}));

mock.module("@tanstack/react-router", () => ({
	useNavigate: () => () => {},
}));

mock.module("react-icons/hi2", () => ({
	HiOutlineArrowPath: () => null,
	HiOutlineBarsArrowDown: () => null,
	HiOutlineCpuChip: () => null,
}));

const snapshotData = {
	totalCpu: 42,
	totalMemory: 1024 * 1024 * 512,
	host: { totalMemory: 1024 * 1024 * 1024 * 16 },
	app: { main: { cpu: 10, memory: 100 }, renderer: { cpu: 5, memory: 50 } },
	workspaces: [],
};

mock.module("renderer/lib/electron-trpc", () => ({
	electronTrpc: {
		settings: {
			getShowResourceMonitor: { useQuery: () => ({ data: true }) },
		},
		resourceMetrics: {
			getSnapshot: {
				useQuery: () => ({
					data: snapshotData,
					refetch: () => {},
					isFetching: false,
				}),
			},
		},
	},
}));

mock.module(
	"renderer/routes/_authenticated/providers/CollectionsProvider",
	() => ({
		useCollections: () => ({
			v2SidebarProjects: [],
			v2WorkspaceLocalState: [],
		}),
	}),
);

mock.module("renderer/stores/tabs/store", () => ({
	useTabsStore: (sel: (s: Record<string, unknown>) => unknown) =>
		sel({ panes: {}, setActiveTab: () => {}, setFocusedPane: () => {} }),
}));

mock.module("./components/AppResourceSection", () => ({
	AppResourceSection: () => null,
}));

mock.module("./components/MetricBadge", () => ({
	MetricBadge: () => null,
}));

mock.module("./components/WorkspaceResourceSection", () => ({
	WorkspaceResourceSection: () => null,
}));

// ---------------------------------------------------------------------------
// Force the component into the "open" state so the backdrop renders.
// We override useState to return open=true for the first call (the popover
// open state), while keeping defaults for subsequent calls.
// ---------------------------------------------------------------------------

let stateCallIndex = 0;
const originalUseState = (await import("react")).useState;

mock.module("react", () => {
	const React = require("react");
	return {
		...React,
		useState: (init: unknown) => {
			const idx = stateCallIndex++;
			// First useState call in ResourceConsumption is `open`
			if (idx === 0) return [true, () => {}];
			return originalUseState(init);
		},
	};
});

// Reset call index before each import to keep things deterministic
stateCallIndex = 0;

const { ResourceConsumption } = await import("./ResourceConsumption");

describe("ResourceConsumption", () => {
	it("renders a dismiss backdrop with no-drag class when the popover is open", () => {
		stateCallIndex = 0;
		const html = renderToStaticMarkup(<ResourceConsumption />);

		// The backdrop should be present with the correct attributes
		expect(html).toContain('data-testid="resource-consumption-backdrop"');
		expect(html).toContain("no-drag");
		expect(html).toContain("fixed inset-0");
	});

	it("backdrop has z-40 to sit below popover content (z-50) but above drag regions", () => {
		stateCallIndex = 0;
		const html = renderToStaticMarkup(<ResourceConsumption />);
		expect(html).toContain("z-40");
	});
});
