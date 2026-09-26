// Node/schema-affecting Tiptap extensions used to seed and flatten the Y.Doc
// server-side. Must match the client's editor extension list exactly (minus
// the client-only Collaboration/CollaborationCaret decorations, which don't
// add nodes or marks) — see lib/live-edit/client/editor.ts. Kept in one place
// so the fidelity round trip (tests/live-edit-tiptap-bridge.test.ts) actually
// proves what the running app does, not a drifted copy.
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import { Table } from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableHeader from "@tiptap/extension-table-header";
import TableCell from "@tiptap/extension-table-cell";
import Image from "@tiptap/extension-image";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import { common, createLowlight } from "lowlight";

const lowlight = createLowlight(common);

export const LIVE_EDIT_EXTENSIONS = [
  StarterKit.configure({ undoRedo: false, underline: false, codeBlock: false }),
  Underline,
  Table.configure({ resizable: false }),
  TableRow,
  TableHeader,
  TableCell,
  Image,
  CodeBlockLowlight.configure({ lowlight }),
];
