import { chromium } from "playwright-core";
import assert from "node:assert/strict";

export async function checkWebHost({ url, env, reloadPlugin }) {
  const browser = await chromium.launch({ executablePath: process.env.KANBAN_TEST_CHROMIUM, headless: true, env });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const sockets = [];
    let disconnected = false;
    await page.routeWebSocket("**/*", (socket) => {
      if (disconnected) return socket.close();
      socket.connectToServer();
      sockets.push(socket);
    });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.stack ?? error.message));
    await page.goto(url);
    await page.waitForTimeout(3000);
    assert.deepEqual(errors, []);
    await page.getByText("Main test workspace", { exact: true }).click();
    await page.keyboard.press("Control+k");
    await page.getByText("Open Kanban", { exact: true }).click();
    const search = page.getByRole("textbox", { name: "Search tickets by ID or title" });
    await search.waitFor();
    assert.equal(await page.getByRole("heading", { name: "backlog", exact: true }).count(), 1);
    assert.equal(await page.getByRole("heading", { name: "in-progress", exact: true }).count(), 1);
    await page.getByRole("button", { name: "New ticket", exact: true }).focus();
    await page.keyboard.press("Tab");
    assert.equal(await search.evaluate((element) => element === document.activeElement), true);
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Enter");
    const title = page.getByRole("textbox", { name: "Title", exact: true });
    await title.fill("Browser ticket");
    await page.getByRole("textbox", { name: "Description (Markdown)" }).fill("Created through the official web app.");
    await page.getByRole("button", { name: "Create ticket", exact: true }).click();
    await page.getByRole("button", { name: "Save changes", exact: true }).waitFor();
    const card = page.getByRole("button", { name: "Select ticket #4: Browser ticket, medium", exact: true });
    await page.getByRole("button", { name: "Close ticket", exact: true }).click();
    // Closing returns focus to the closed ticket's card.
    await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "Select ticket #4: Browser ticket, medium");
    await search.fill("Browser ticket");
    await page.reload();
    await search.waitFor();
    assert.equal(await search.inputValue(), "Browser ticket");
    await search.fill("");
    await card.waitFor();
    await page.emulateMedia({ colorScheme: "light" });
    const light = await search.evaluate((element) => getComputedStyle(element).color);
    await page.emulateMedia({ colorScheme: "dark" });
    await page.waitForFunction((light) => getComputedStyle(document.querySelector('[aria-label="Search tickets by ID or title"]')).color !== light, light);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "backlog · 3", exact: true }).click();
    await card.waitFor();
    await page.getByRole("button", { name: "todo · 1", exact: true }).click();
    await card.waitFor({ state: "hidden" });
    assert.equal(await page.getByRole("heading", { name: "backlog", exact: true }).count(), 0);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByRole("button", { name: "Implement #4", exact: true }).click();
    const instructions = page.getByRole("textbox", { name: "Implementation instructions" });
    await instructions.waitFor();
    await page.getByText("Five minute stream", { exact: true }).click();
    await page.getByText("Ten second stream", { exact: true }).click();
    const prompt = "Browser reload recovery\nKeep these exact instructions.";
    await instructions.fill(prompt);
    await page.getByRole("button", { name: "Start implementation", exact: true }).click();
    await page.getByRole("button", { name: "Open agent", exact: true }).waitFor();
    await page.getByRole("button", { name: "Close implementation", exact: true }).click();
    await page.getByText("Main test workspace", { exact: true }).first().click();
    await search.waitFor();
    await page.reload();
    await search.waitFor();
    await page.getByRole("button", { name: "Inspect launch #4", exact: true }).click();
    await instructions.waitFor();
    assert.equal(await instructions.inputValue(), prompt);
    assert.equal(await instructions.isEditable(), false);
    await page.getByText("ten-second-stream", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Open agent", exact: true }).waitFor();
    await page.getByRole("button", { name: "Close implementation", exact: true }).click();
    await reloadPlugin();
    await search.waitFor();
    await page.getByRole("button", { name: "Inspect launch #4", exact: true }).click();
    await instructions.waitFor();
    assert.equal(await instructions.inputValue(), prompt);
    await page.getByRole("button", { name: "Close implementation", exact: true }).click();
    // Chromium's offline switch leaves established WebSockets open.
    disconnected = true;
    await Promise.all(sockets.map((socket) => socket.close()));
    // 0.13/0.14 unmount the panel while offline; 0.15 keeps it mounted with the panel's stale-data banner.
    await page.getByText("This plugin panel is unavailable.", { exact: true })
      .or(page.getByText("Board data is stale.", { exact: false })).first().waitFor();
    disconnected = false;
    await search.waitFor();
    await page.getByRole("button", { name: "Refresh board", exact: true }).click();
    await card.waitFor();
    await page.getByRole("button", { name: "Inspect launch #4", exact: true }).click();
    assert.equal(await instructions.inputValue(), prompt);
    assert.deepEqual(errors, []);
    console.log("Official client wide/compact board, themes, keyboard, focus return, reconnect, filters and launch recovery across page/plugin reload passed.");
  } finally { await browser.close(); }
}
