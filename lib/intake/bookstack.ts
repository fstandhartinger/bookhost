import { IntakeError } from "./access";
import { TENANT_DOMAIN } from "../config";
export type Destination = { id: number; name: string; book_id?: number };
export class BookStack {
  readonly base: string;
  constructor(
    slug: string,
    private id: string,
    private secret: string,
  ) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))
      throw new Error("Invalid workspace.");
    this.base = `https://${slug}.${TENANT_DOMAIN}`;
  }
  async request<T>(path: string, body?: unknown): Promise<T> {
    const response = await fetch(`${this.base}/api/${path}`, {
      method: body ? "POST" : "GET",
      headers: {
        Authorization: `Token ${this.id}:${this.secret}`,
        "Content-Type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(20000),
    }).catch(() => {
      throw new IntakeError("Tenant not reachable. Try again shortly.", 503);
    });
    if (!response.ok)
      throw new IntakeError(
        [401, 403].includes(response.status)
          ? path === "books" && body
            ? "BookStack cannot create books. Contact your workspace administrator to enable Create all books for BookHost Intake."
            : "BookStack token rejected. Contact support to restore intake access."
          : response.status === 404
            ? "Book or chapter not found. Choose another destination."
            : response.status === 429
              ? "BookStack rate limit reached. Try again shortly."
              : "Tenant not reachable. Try again shortly.",
        response.status === 429 ? 429 : 502,
      );
    return response.json();
  }
  async uploadTarget(fields: Record<string, string>, filename: string) {
    if (fields.book_id === "new") {
      if (fields.chapter_id)
        throw new IntakeError("A new book cannot use an existing chapter.");
      const name = (
        fields.new_book_name?.trim() || filename.replace(/\.[^.]+$/, "").trim()
      ).slice(0, 255);
      if (!name) throw new IntakeError("Enter a name for the new book.");
      const book = await this.request<Destination>("books", { name });
      return { book, chapter: null };
    }
    const book = Number(fields.book_id);
    const chapter = fields.chapter_id ? Number(fields.chapter_id) : null;
    if (
      !Number.isSafeInteger(book) ||
      book < 1 ||
      (chapter !== null && (!Number.isSafeInteger(chapter) || chapter < 1))
    )
      throw new IntakeError("Choose a destination book and optional chapter.");
    return this.validateTarget(book, chapter);
  }
  async list(kind: "books" | "chapters") {
    const all: Destination[] = [];
    for (let offset = 0; ; offset += 500) {
      const result = await this.request<{ data: Destination[]; total: number }>(
        `${kind}?count=500&offset=${offset}`,
      );
      all.push(...result.data);
      if (all.length >= result.total || !result.data.length) return all;
      if (offset >= 9500)
        throw new Error("Too many destinations. Contact support.");
    }
  }
  async validateTarget(bookId: number, chapterId: number | null) {
    const book = await this.request<Destination>(`books/${bookId}`);
    let chapter: Destination | null = null;
    if (chapterId) {
      chapter = await this.request<Destination>(`chapters/${chapterId}`);
      if (chapter.book_id !== bookId)
        throw new IntakeError(
          "The chapter does not belong to the selected book.",
        );
    }
    return { book, chapter };
  }
  async findPublished(itemId: string) {
    const result = await this.request<{ data: { id: number; type: string }[] }>(
      `search?query=${encodeURIComponent(`[wissen-intake=${itemId}] {type:page}`)}`,
    );
    return result.data.find((page) => page.type === "page") || null;
  }
  async publish(
    title: string,
    html: string,
    tags: string[],
    bookId: number,
    chapterId: number | null,
    itemId: string,
  ) {
    const existing = await this.findPublished(itemId);
    if (existing) return existing;
    return this.request<{ id: number }>("pages", {
      name: title,
      html,
      tags: [
        ...tags.map((name) => ({ name, value: "" })),
        { name: "wissen-intake", value: itemId },
      ],
      ...(chapterId ? { chapter_id: chapterId } : { book_id: bookId }),
    });
  }
}
