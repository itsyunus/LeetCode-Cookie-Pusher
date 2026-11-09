const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const core = require("../extension-core.js");

test("accepts an owner/repo slug and trims whitespace", () => {
  assert.equal(core.validateRepository(" itsyunus/LeetCode_autoSOL "), "itsyunus/LeetCode_autoSOL");
});
test("rejects malformed repository values", () => {
  for (const value of ["", "owner", "/repo", "owner/repo/extra", "https://github.com/a/b", "../repo"]) {
    assert.throws(() => core.validateRepository(value));
  }
});
test("requires both LeetCode cookies before upload", () => {
  assert.deepEqual(core.requireCookiePair("session", "csrf"), { session: "session", csrf: "csrf" });
  assert.throws(() => core.requireCookiePair("session", ""), /csrftoken/);
  assert.throws(() => core.requireCookiePair("", "csrf"), /LEETCODE_SESSION/);
});
test("dispatch defaults to dry-run when requested and rejects unknown languages", () => {
  assert.deepEqual(core.buildWorkflowDispatchInput(true, "python3"), {
    ref: "main", inputs: { dry_run: "true", language: "python3" }
  });
  assert.equal(core.buildWorkflowDispatchInput(false, "python3").inputs.dry_run, "false");
  assert.throws(() => core.buildWorkflowDispatchInput(true, "unknown"));
});
test("rejects HTML responses instead of attempting JSON parsing", async () => {
  const response = new Response("<html>login</html>", {
    status: 403, headers: { "content-type": "text/html" }
  });
  await assert.rejects(core.parseJsonResponse(response, "GitHub API"), /non-JSON response/);
});
test("surfaces structured GitHub API errors", async () => {
  const response = new Response(JSON.stringify({ message: "Resource not accessible by integration" }), {
    status: 403, headers: { "content-type": "application/json" }
  });
  await assert.rejects(core.parseJsonResponse(response, "GitHub API"), /Resource not accessible/);
});
test("finds a newly dispatched workflow run", () => {
  const run = { event: "workflow_dispatch", created_at: "2026-11-09T10:00:00Z", html_url: "https://github.com/run/1" };
  assert.equal(core.findWorkflowRun([run], Date.parse("2026-11-09T09:59:59Z")), run);
  assert.equal(core.findWorkflowRun([{ ...run, event: "schedule" }], Date.parse("2026-11-09T09:59:59Z")), null);
});

test("popup removes any legacy PAT from persistent local storage", () => {
  const popup = fs.readFileSync(path.join(__dirname, "..", "popup.js"), "utf8");
  assert.ok(popup.includes('chrome.storage.local.remove(["gh_pat"])'));
  assert.ok(!popup.includes('chrome.storage.local.set({ gh_pat'));
});
