/* Shared, side-effect-free helpers for the extension and its Node tests. */
(function (root) {
  "use strict";

  const LANGUAGES = new Set(["python3", "java", "cpp", "javascript", "typescript", "go", "rust"]);

  function validateRepository(value) {
    const repo = String(value || "").trim();
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) {
      throw new Error("Repository must use the exact owner/repo format.");
    }
    const [owner, name] = repo.split("/");
    if (owner === "." || owner === ".." || name === "." || name === "..") {
      throw new Error("Repository name is invalid.");
    }
    return repo;
  }

  function requireCookiePair(session, csrf) {
    if (typeof session !== "string" || !session.trim()) {
      throw new Error("LeetCode LEETCODE_SESSION cookie is missing. Sign in to leetcode.com first.");
    }
    if (typeof csrf !== "string" || !csrf.trim()) {
      throw new Error("LeetCode csrftoken cookie is missing. Refresh LeetCode after signing in.");
    }
    return { session: session.trim(), csrf: csrf.trim() };
  }

  async function parseJsonResponse(response, operation) {
    const contentType = (response.headers && response.headers.get("content-type")) || "";
    const body = await response.text();
    if (!contentType.toLowerCase().includes("json")) {
      throw new Error(operation + " returned HTTP " + response.status +
        " with a non-JSON response. Check permissions, sign-in, or a security challenge.");
    }
    let data;
    try {
      data = body ? JSON.parse(body) : {};
    } catch (error) {
      throw new Error(operation + " returned invalid JSON.");
    }
    if (!response.ok) {
      const message = data && typeof data.message === "string" ? data.message : "Request failed";
      throw new Error(operation + " failed (HTTP " + response.status + "): " + message);
    }
    return data;
  }

  function buildWorkflowDispatchInput(dryRun, language) {
    const lang = String(language || "python3");
    if (!LANGUAGES.has(lang)) throw new Error("Unsupported solution language.");
    return { ref: "main", inputs: { dry_run: dryRun ? "true" : "false", language: lang } };
  }

  function findWorkflowRun(runs, startedAtMs) {
    const list = Array.isArray(runs) ? runs : [];
    const eligible = list.filter((run) =>
      run && run.event === "workflow_dispatch" &&
      (!run.created_at || Date.parse(run.created_at) >= startedAtMs - 5000) &&
      typeof run.html_url === "string"
    );
    return eligible[0] || null;
  }

  const api = { validateRepository, requireCookiePair, parseJsonResponse, buildWorkflowDispatchInput, findWorkflowRun };
  root.LeetCodeCookiePusherCore = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
