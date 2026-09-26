#!/usr/bin/env node
// Live proof for Live Edit's phase-1 spec: two real, separately-authenticated
// browser sessions collaboratively editing one BookStack page, with the
// resulting save landing as a normal BookStack revision, plus the soft-lock
// banner in BookStack's native editor.
//
// Never run against demo.bookhost.co or a customer workspace. This drives an
// isolated QA tenant (LIVE_EDIT_E2E_TENANT) that Live Edit's beta toggle has
// already been turned on for (rollout_status='ready'), and two BookStack
// users already created on it (see REPORT.md "Live e2e verification" for the
// exact tinker snippet used to set them up and tear them down).
//
// Usage:
//   LIVE_EDIT_PLAYWRIGHT_MODULE=<path to an installed playwright module> \
//   LIVE_EDIT_E2E_TENANT=<qa-slug> \
//   LIVE_EDIT_E2E_PAGE_URL=https://<qa-slug>.bookhost.co/books/.../page/... \
//   LIVE_EDIT_E2E_USER_A_EMAIL=... LIVE_EDIT_E2E_USER_A_PASSWORD=... \
//   LIVE_EDIT_E2E_USER_B_EMAIL=... LIVE_EDIT_E2E_USER_B_PASSWORD=... \
//   node scripts/live-edit-e2e-check.mjs
import { mkdir } from "node:fs/promises";

function env(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Set ${name}`);
  return value;
}

async function login(page, baseUrl, email, password) {
  await page.goto(`${baseUrl}/login`, { waitUntil: "networkidle" });
  const form = page.locator("form").filter({
    has: page.locator('input[name="password"]'),
  });
  await form.locator('input[name="email"]').fill(email);
  await form.locator('input[name="password"]').fill(password);
  await Promise.all([
    page.waitForNavigation({ waitUntil: "domcontentloaded" }),
    form.getByRole("button", { name: /log in/i }).click(),
  ]);
  if (page.url().includes("/login"))
    throw new Error(`Login failed for ${email}`);
}

async function main() {
  const { chromium } = await import(env("LIVE_EDIT_PLAYWRIGHT_MODULE"));
  const tenant = env("LIVE_EDIT_E2E_TENANT");
  const baseUrl = `https://${tenant}.bookhost.co`;
  const pageUrl = env("LIVE_EDIT_E2E_PAGE_URL");
  const shots = new URL("../e2e/shots/", import.meta.url).pathname;
  await mkdir(shots, { recursive: true });

  const browser = await chromium.launch();
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const a = await contextA.newPage();
  const b = await contextB.newPage();

  try {
    console.log("Logging in both sessions...");
    await login(a, baseUrl, env("LIVE_EDIT_E2E_USER_A_EMAIL"), env("LIVE_EDIT_E2E_USER_A_PASSWORD"));
    await login(b, baseUrl, env("LIVE_EDIT_E2E_USER_B_EMAIL"), env("LIVE_EDIT_E2E_USER_B_PASSWORD"));

    console.log("Opening the page in both sessions...");
    await a.goto(pageUrl, { waitUntil: "networkidle" });
    await b.goto(pageUrl, { waitUntil: "networkidle" });

    console.log("Joining Live Edit from session A...");
    await a.click("#live-edit-button");
    await a.waitForSelector("#live-edit-editor-root .ProseMirror", { timeout: 20000 });

    console.log("Joining Live Edit from session B...");
    await b.click("#live-edit-button");
    await b.waitForSelector("#live-edit-editor-root .ProseMirror", { timeout: 20000 });

    // B should see A's presence chip once both are connected.
    await b.waitForSelector(".live-edit-collaborators .live-edit-avatar", { timeout: 15000 });

    const marker = `live-edit-e2e-${Date.now()}`;
    console.log(`Typing "${marker}" into session A's editor...`);
    await a.click("#live-edit-editor-root .ProseMirror");
    await a.keyboard.type(marker);

    console.log("Waiting for it to appear live in session B (no reload)...");
    await b.waitForFunction(
      (text) => document.querySelector("#live-edit-editor-root .ProseMirror")?.textContent?.includes(text),
      marker,
      { timeout: 15000 },
    );
    // And a remote cursor decoration rendered for A inside B's editor.
    await b.waitForSelector(".collaboration-carets__caret", { timeout: 10000 });

    await a.screenshot({ path: `${shots}/session-a-live-edit.png` });
    await b.screenshot({ path: `${shots}/session-b-live-edit.png` });
    console.log(`Screenshots saved under ${shots}`);

    console.log("Closing both sessions to trigger save-on-last-disconnect...");
    await a.click(".live-edit-close");
    await b.click(".live-edit-close");
    await a.waitForTimeout(3000); // debounce + save round trip

    console.log("Verifying the saved page now contains the marker as a normal BookStack revision...");
    await a.goto(pageUrl, { waitUntil: "networkidle" });
    const bodyText = await a.textContent("body");
    if (!bodyText.includes(marker))
      throw new Error("Saved page does not contain the live-typed marker");
    await a.goto(`${pageUrl}/revisions`, { waitUntil: "networkidle" });
    const revisionsText = await a.textContent("body");
    if (!revisionsText.includes("Live edit session"))
      throw new Error('No revision with changelog "Live edit session" found');
    await a.screenshot({ path: `${shots}/revision-history.png` });

    console.log("Checking the soft-lock banner in BookStack's native editor...");
    const c = await browser.newContext();
    const editorPage = await c.newPage();
    await login(editorPage, baseUrl, env("LIVE_EDIT_E2E_USER_A_EMAIL"), env("LIVE_EDIT_E2E_USER_A_PASSWORD"));
    await b.goto(pageUrl, { waitUntil: "networkidle" });
    await b.click("#live-edit-button");
    await b.waitForSelector("#live-edit-editor-root .ProseMirror", { timeout: 20000 });
    await editorPage.goto(`${pageUrl}/edit`, { waitUntil: "networkidle" });
    await editorPage.waitForSelector("#live-edit-softlock-banner", { timeout: 15000 });
    const count = await editorPage.textContent("#live-edit-softlock-banner [data-live-edit-count]");
    if (!count || Number(count) < 1)
      throw new Error("Soft-lock banner did not report an active participant");
    await editorPage.screenshot({ path: `${shots}/softlock-banner.png` });
    await b.click(".live-edit-close");
    await c.close();

    console.log("ALL LIVE EDIT E2E CHECKS PASSED");
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error("LIVE EDIT E2E CHECK FAILED:", error);
  process.exit(1);
});
