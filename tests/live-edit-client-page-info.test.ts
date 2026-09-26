import { Window } from "happy-dom";
import { describe, expect, it } from "vitest";
import {
  getBookStackEditorType,
  getBookStackPageId,
  getBookStackPageInfo,
} from "@/lib/live-edit/client/page-info";

describe("BookStack client page metadata", () => {
  it("reads 26.05 page-view component metadata where no editor type is exposed", () => {
    const window = new Window();
    window.document.body.innerHTML =
      '<main component="page-display" option:page-display:page-id="42"></main>';
    const pageInfo = getBookStackPageInfo(
      window.document as unknown as Document,
      "/books/handbook/page/onboarding",
    );

    expect(pageInfo).not.toBeNull();
    expect(getBookStackPageId(pageInfo!, "/books/handbook/page/onboarding")).toBe("42");
    expect(getBookStackEditorType(pageInfo!)).toBeNull();
    window.happyDOM.abort();
  });

  it("reads the editor type from a modern BookStack edit component", () => {
    const window = new Window();
    window.document.body.innerHTML =
      '<form component="page-editor" option:page-editor:page-id="42" option:page-editor:editor-type="wysiwyg"></form>';
    const pathname = "/books/handbook/page/onboarding/edit";
    const pageInfo = getBookStackPageInfo(
      window.document as unknown as Document,
      pathname,
    );

    expect(pageInfo).not.toBeNull();
    expect(getBookStackPageId(pageInfo!, pathname)).toBe("42");
    expect(getBookStackEditorType(pageInfo!)).toBe("wysiwyg");
    window.happyDOM.abort();
  });

  it("retains compatibility with legacy BookStack page-id and editor-type attributes", () => {
    const window = new Window();
    window.document.body.innerHTML =
      '<div page-id="42" editor-type="wysiwyg"></div>';
    const pageInfo = getBookStackPageInfo(
      window.document as unknown as Document,
      "/books/handbook/page/onboarding",
    );

    expect(pageInfo).not.toBeNull();
    expect(getBookStackPageId(pageInfo!, "/books/handbook/page/onboarding")).toBe("42");
    expect(getBookStackEditorType(pageInfo!)).toBe("wysiwyg");
    window.happyDOM.abort();
  });
});
