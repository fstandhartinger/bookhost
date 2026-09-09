import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { EmailSource } from "@/components/intake-email-source";
it("renders sender, subject, receipt time and warning as untrusted text", () => {
  const html = renderToStaticMarkup(
    createElement(EmailSource, {
      metadata: {
        from: {
          name: "External <script>sender</script>",
          address: "author@example.org",
        },
        subject: "<img src=x onerror=alert(1)>",
        received_at: "2026-09-09T02:00:00Z",
      },
    }),
  );
  expect(html).toContain(
    "Received by e-mail — verify the sender before publishing",
  );
  expect(html).toContain("External &lt;script&gt;sender&lt;/script&gt;");
  expect(html).toContain("&lt;author@example.org&gt;");
  expect(html).toContain("Subject: &lt;img");
  expect(html).toContain('dateTime="2026-09-09T02:00:00Z"');
  expect(html).not.toMatch(/<script|<img/);
});
