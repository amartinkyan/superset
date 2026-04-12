import { usePromptInputController } from "@superset/ui/ai-elements/prompt-input";
import { mergeAttributes, Node } from "@tiptap/core";
import { Placeholder } from "@tiptap/extension-placeholder";
import {
	type Editor,
	EditorContent,
	type NodeViewProps,
	NodeViewWrapper,
	ReactNodeViewRenderer,
	useEditor,
} from "@tiptap/react";
import { StarterKit } from "@tiptap/starter-kit";
import { useEffect, useRef } from "react";
import { FileIcon } from "renderer/screens/main/components/WorkspaceView/RightSidebar/FilesView/utils";

function getFileName(path: string): string {
	const lastSlash = path.lastIndexOf("/");
	return lastSlash === -1 ? path : path.slice(lastSlash + 1);
}

let onMentionClick: ((path: string) => void) | null = null;

export function setMentionClickHandler(
	handler: ((path: string) => void) | null,
): void {
	onMentionClick = handler;
}

function FileMentionChipView({ node }: NodeViewProps) {
	const path = node.attrs.id as string;
	const name = getFileName(path);
	return (
		<NodeViewWrapper as="span" className="inline">
			<button
				type="button"
				contentEditable={false}
				onClick={(e) => {
					e.preventDefault();
					e.stopPropagation();
					onMentionClick?.(path);
				}}
				className="inline-flex h-5 items-center gap-1 rounded-sm border border-input bg-background px-1.5 py-0 align-middle text-xs font-medium leading-none cursor-pointer select-none transition-colors hover:bg-accent hover:text-accent-foreground"
			>
				<FileIcon fileName={name} className="size-3 shrink-0" />
				<span>{path}</span>
			</button>
		</NodeViewWrapper>
	);
}

const FileMention = Node.create({
	name: "fileMention",
	group: "inline",
	inline: true,
	selectable: true,
	atom: true,
	draggable: false,

	addAttributes() {
		return {
			id: { default: null },
		};
	},

	parseHTML() {
		return [{ tag: "span[data-file-mention]" }];
	},

	renderHTML({ HTMLAttributes }) {
		return [
			"span",
			mergeAttributes(HTMLAttributes, { "data-file-mention": "" }),
		];
	},

	addNodeView() {
		return ReactNodeViewRenderer(FileMentionChipView);
	},
});

function editorToText(editor: Editor): string {
	const parts: string[] = [];
	let isFirstParagraph = true;

	editor.state.doc.forEach((node) => {
		if (node.type.name === "paragraph") {
			if (!isFirstParagraph) {
				parts.push("\n");
			}
			isFirstParagraph = false;
			node.forEach((child) => {
				if (child.type.name === "fileMention") {
					parts.push(`@${child.attrs.id}`);
				} else if (child.isText && child.text) {
					parts.push(child.text);
				}
			});
		}
	});

	return parts.join("").trim();
}

const MENTION_PATTERN = /(?:^|(?<=\s))@([^\s@]+\.[^\s@]+)/g;

function textToContent(
	text: string,
): { type: string; content?: unknown[]; attrs?: Record<string, unknown> }[] {
	if (!text) return [];

	const lines = text.split("\n");
	return lines.map((line) => {
		const content: {
			type: string;
			text?: string;
			attrs?: Record<string, unknown>;
		}[] = [];
		let lastIndex = 0;

		for (const match of line.matchAll(MENTION_PATTERN)) {
			const matchStart = match.index;
			const fullMatch = match[0];
			const path = match[1];
			const prefixStart = fullMatch.startsWith("@")
				? matchStart
				: matchStart + 1;

			if (prefixStart > lastIndex) {
				content.push({
					type: "text",
					text: line.slice(lastIndex, prefixStart),
				});
			}

			content.push({ type: "fileMention", attrs: { id: path } });
			lastIndex = matchStart + fullMatch.length;
		}

		if (lastIndex < line.length) {
			content.push({ type: "text", text: line.slice(lastIndex) });
		}

		if (content.length === 0) {
			return { type: "paragraph" };
		}
		return { type: "paragraph", content };
	});
}

function textHasMentionPatterns(text: string): boolean {
	return MENTION_PATTERN.test(text);
}

function editorHasMentions(editor: Editor): boolean {
	let found = false;
	editor.state.doc.descendants((node) => {
		if (node.type.name === "fileMention") {
			found = true;
			return false;
		}
		return !found;
	});
	return found;
}

export interface TipTapComposerHandle {
	insertMention: (path: string, triggerPosition?: number) => void;
	getText: () => string;
	clear: () => void;
	focus: () => void;
}

interface TipTapComposerProps {
	placeholder?: string;
	className?: string;
	onSubmit?: () => void;
	composerRef?: React.RefObject<TipTapComposerHandle | null>;
}

export function TipTapComposer({
	placeholder = "Ask to make changes, @mention files, run /commands",
	className,
	onSubmit,
	composerRef,
}: TipTapComposerProps) {
	const controller = usePromptInputController();
	const suppressSyncRef = useRef(false);
	const initialText = controller.textInput.value;
	const initialContent = textHasMentionPatterns(initialText)
		? ({
				type: "doc",
				content: textToContent(initialText),
			} as Record<string, unknown>)
		: initialText || "";
	const hadMentionsRef = useRef(textHasMentionPatterns(initialText));

	const editor = useEditor({
		extensions: [
			StarterKit.configure({
				blockquote: false,
				bulletList: false,
				codeBlock: false,
				heading: false,
				horizontalRule: false,
				listItem: false,
				orderedList: false,
				bold: false,
				italic: false,
				strike: false,
				code: false,
			}),
			FileMention,
			Placeholder.configure({ placeholder }),
		],
		content: initialContent,
		editorProps: {
			attributes: {
				class: [
					"outline-none text-left text-sm w-full",
					"min-h-10 max-h-48 overflow-y-auto",
					"[&_p]:m-0 [&_.is-editor-empty:first-child::before]:text-muted-foreground/50",
					"[&_.is-editor-empty:first-child::before]:content-[attr(data-placeholder)]",
					"[&_.is-editor-empty:first-child::before]:float-left",
					"[&_.is-editor-empty:first-child::before]:h-0",
					"[&_.is-editor-empty:first-child::before]:pointer-events-none",
					className ?? "",
				].join(" "),
			},
			handleKeyDown(_view, event) {
				if (event.key === "Enter" && !event.shiftKey) {
					event.preventDefault();
					onSubmit?.();
					return true;
				}
				if (
					(event.key === "ArrowLeft" || event.key === "ArrowRight") &&
					(event.metaKey || event.ctrlKey)
				) {
					event.stopPropagation();
				}
				return false;
			},
		},
		onUpdate({ editor: e }) {
			suppressSyncRef.current = true;
			if (editorHasMentions(e)) {
				hadMentionsRef.current = true;
			}
			controller.textInput.setInput(editorToText(e));
			suppressSyncRef.current = false;
		},
	});

	// Sync external changes back to editor only when there are no mention nodes.
	// When mentions exist (or have ever existed in this session), the editor is
	// the source of truth — external sync would destroy the structured mention
	// nodes by parsing @path as plain text.
	useEffect(() => {
		if (!editor || suppressSyncRef.current) return;
		if (editorHasMentions(editor) || hadMentionsRef.current) return;

		const currentText = editorToText(editor);
		const externalText = controller.textInput.value;

		if (currentText !== externalText) {
			if (externalText === "") {
				editor.commands.clearContent();
			} else {
				editor.commands.setContent(externalText);
			}
		}
	}, [controller.textInput.value, editor]);

	// Reset the mentions flag when content is fully cleared (after send)
	useEffect(() => {
		if (!editor) return;
		if (
			controller.textInput.value === "" &&
			editorToText(editor) === "" &&
			hadMentionsRef.current
		) {
			hadMentionsRef.current = false;
		}
	}, [controller.textInput.value, editor]);

	// Expose imperative handle
	useEffect(() => {
		if (!editor || !composerRef) return;
		(
			composerRef as React.MutableRefObject<TipTapComposerHandle | null>
		).current = {
			insertMention(path: string, triggerPosition?: number) {
				// Find and delete the @ trigger character in the ProseMirror doc.
				// triggerPosition is the character offset in the plain text.
				if (triggerPosition !== undefined && triggerPosition >= 0) {
					let charCount = 0;
					let deleteFrom = -1;
					editor.state.doc.descendants((node, pos) => {
						if (deleteFrom >= 0) return false;
						if (node.isText && node.text) {
							for (let i = 0; i < node.text.length; i++) {
								if (charCount === triggerPosition) {
									deleteFrom = pos + i;
									return false;
								}
								charCount++;
							}
						}
						return true;
					});
					if (deleteFrom >= 0) {
						const { tr } = editor.state;
						tr.delete(deleteFrom, deleteFrom + 1);
						editor.view.dispatch(tr);
					}
				}

				editor
					.chain()
					.focus()
					.insertContent([
						{ type: "fileMention", attrs: { id: path } },
						{ type: "text", text: " " },
					])
					.run();
			},
			getText() {
				return editorToText(editor);
			},
			clear() {
				editor.commands.clearContent();
			},
			focus() {
				editor.commands.focus();
			},
		};
	}, [editor, composerRef]);

	// Register focus with prompt input controller
	useEffect(() => {
		if (!editor) return;
		const fakeTextarea = {
			current: {
				focus: () => editor.commands.focus(),
				value: "",
				setSelectionRange: () => {},
			},
		} as unknown as React.RefObject<HTMLTextAreaElement | null>;
		controller.__registerTextarea(fakeTextarea);
	}, [editor, controller]);

	if (!editor) return null;

	return (
		<EditorContent
			editor={editor}
			data-slot="input-group-control"
			className="flex-1 w-full text-left rounded-none border-0 bg-transparent shadow-none py-3 [&_.tiptap]:outline-none"
		/>
	);
}
