import { createChatRuntimeServiceClient } from "@superset/chat/client";
import type { ChatRuntimeServiceRouter } from "@superset/chat/server/trpc";
import type { TRPCLink } from "@trpc/client";
import type { AnyRouter } from "@trpc/server";
import { observable } from "@trpc/server/observable";
import { sessionIdLink } from "renderer/lib/session-id-link";
import superjson from "superjson";
import { ipcLink } from "trpc-electron/renderer";

function prefixLink<TRouter extends AnyRouter>(
	prefix: string,
): TRPCLink<TRouter> {
	return () =>
		({ op, next }) =>
			observable((observer) =>
				next({ ...op, path: `${prefix}.${op.path}` }).subscribe(observer),
			);
}

let chatClient: ReturnType<typeof createChatRuntimeServiceClient> | null = null;

function getChatClient() {
	if (!chatClient) {
		chatClient = createChatRuntimeServiceClient({
			links: [
				prefixLink<ChatRuntimeServiceRouter>("chatRuntimeService"),
				sessionIdLink(),
				ipcLink({ transformer: superjson }),
			],
		});
	}
	return chatClient;
}

export const releaseChatSessionForPane = (sessionId: string): void => {
	getChatClient()
		.session.releaseSession.mutate({ sessionId })
		.catch((error) => {
			console.warn(`Failed to release chat session ${sessionId}:`, error);
		});
};
