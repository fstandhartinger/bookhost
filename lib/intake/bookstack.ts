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
    this.base = `https://${slug}.wissen.app.mintapis.com`;
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
    });
    if (!response.ok)
      throw new Error(
        response.status === 429
          ? "BookStack rate limit reached. Please wait before trying again."
          : `BookStack request failed (${response.status}).`,
      );
    return response.json();
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
    await this.request(`books/${bookId}`);
    if (chapterId) {
      const chapter = await this.request<Destination>(`chapters/${chapterId}`);
      if (chapter.book_id !== bookId)
        throw new Error("The chapter does not belong to the selected book.");
    }
  }
  publish(
    title: string,
    html: string,
    tags: string[],
    bookId: number,
    chapterId: number | null,
  ) {
    return this.request<{ id: number }>("pages", {
      name: title,
      html,
      tags: tags.map((name) => ({ name, value: "" })),
      ...(chapterId ? { chapter_id: chapterId } : { book_id: bookId }),
    });
  }
}
