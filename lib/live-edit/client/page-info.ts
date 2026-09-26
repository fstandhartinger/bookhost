/** Locate page metadata across BookStack's legacy and component-based markup. */
export function getBookStackPageInfo(
  document: Document,
  pathname: string,
): Element | null {
  const legacy = document.querySelector("[page-id]");
  if (legacy) return legacy;

  const metadataAttribute = pathname.endsWith("/edit")
    ? "option:page-editor:page-id"
    : "option:page-display:page-id";
  return (
    [...document.querySelectorAll("[component]")].find((element) =>
      element.hasAttribute(metadataAttribute),
    ) ?? null
  );
}

export function getBookStackPageId(
  pageInfo: Element,
  pathname: string,
): string | null {
  return (
    pageInfo.getAttribute("page-id") ??
    pageInfo.getAttribute(
      pathname.endsWith("/edit")
        ? "option:page-editor:page-id"
        : "option:page-display:page-id",
    )
  );
}

export function getBookStackEditorType(pageInfo: Element): string | null {
  return (
    pageInfo.getAttribute("editor-type") ??
    pageInfo.getAttribute("option:page-editor:editor-type")
  );
}
