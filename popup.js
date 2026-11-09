// Extension popup controller. Credentials stay in memory/session storage and are never logged.
"use strict";

let cookies = { session: "", csrf: "", username: "" };
let busy = false;
const core = window.LeetCodeCookiePusherCore;

document.addEventListener("DOMContentLoaded", async () => {
  const saved = await chrome.storage.local.get(["gh_repo"]);
  const sessionData = await chrome.storage.session.get(["gh_pat"]);
  document.getElementById("repo").value = saved.gh_repo || "itsyunus/LeetCode_autoSOL";
  document.getElementById("pat").value = sessionData.gh_pat || "";

  document.getElementById("s1").addEventListener("click", doExtract);
  document.getElementById("s2").addEventListener("click", doPush);
  document.getElementById("s3").addEventListener("click", doTrigger);
  document.getElementById("saveBtn").addEventListener("click", saveSettings);
});

async function saveSettings() {
  try {
    const pat = document.getElementById("pat").value.trim();
    const repo = core.validateRepository(document.getElementById("repo").value);
    if (!pat) throw new Error("Enter a GitHub token with Actions and repository Actions-secrets write access.");
    await chrome.storage.local.set({ gh_repo: repo });
    await chrome.storage.session.set({ gh_pat: pat });
    toast("Settings saved for this browser session.");
  } catch (error) {
    toast(error.message, true);
  }
}

function getCookie(name) {
  return new Promise((resolve, reject) => {
    chrome.cookies.get({ url: "https://leetcode.com/", name }, (cookie) => {
      const lastError = chrome.runtime.lastError;
      if (lastError) return reject(new Error(lastError.message));
      resolve(cookie ? cookie.value : "");
    });
  });
}

async function doExtract() {
  if (busy) return;
  busy = true;
  const s1 = document.getElementById("s1");
  setStep(s1, "run", "Checking...");
  setStatus("busy", "Checking your signed-in LeetCode session...");
  try {
    const session = await getCookie("LEETCODE_SESSION");
    const csrf = await getCookie("csrftoken");
    core.requireCookiePair(session, csrf);

    const response = await fetch("https://leetcode.com/graphql", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-csrftoken": csrf },
      credentials: "include",
      body: JSON.stringify({ query: "query { userStatus { username isSignedIn } }" })
    });
    const data = await core.parseJsonResponse(response, "LeetCode session check");
    const userStatus = data && data.data && data.data.userStatus;
    if (!userStatus || userStatus.isSignedIn !== true) {
      throw new Error("LeetCode session is not signed in. Log in again and retry.");
    }

    cookies = { session, csrf, username: userStatus.username || "LeetCode user" };
    document.getElementById("ci-user").textContent = cookies.username;
    document.getElementById("ci-sess").textContent = "Present (hidden)";
    document.getElementById("ci-csrf").textContent = "Present";
    document.getElementById("cinfo").classList.add("show");
    setStep(s1, "ok", "Verified");
    setStatus("ok", "LeetCode session verified for " + cookies.username + ".");
    enableStep("s2", "b2");
    toast("LeetCode session verified.");
  } catch (error) {
    cookies = { session: "", csrf: "", username: "" };
    setStep(s1, "", "Retry");
    setStatus("err", error.message);
    toast("Cookie check failed.", true);
  } finally {
    busy = false;
  }
}

async function doPush() {
  if (busy) return;
  busy = true;
  const s2 = document.getElementById("s2");
  setStep(s2, "run", "Pushing...");
  setStatus("busy", "Encrypting and updating the two GitHub Actions secrets...");
  try {
    core.requireCookiePair(cookies.session, cookies.csrf);
    const settings = await getSettings();
    const repo = core.validateRepository(settings.repo);
    if (!settings.pat) throw new Error("Enter and save your GitHub token first.");

    const keyResponse = await fetch("https://api.github.com/repos/" + repo + "/actions/secrets/public-key", {
      headers: ghHeaders(settings.pat)
    });
    const keyData = await core.parseJsonResponse(keyResponse, "GitHub public-key request");
    if (!keyData.key || !keyData.key_id) throw new Error("GitHub did not return a usable repository public key.");

    const values = [
      ["LEETCODE_SESSION", cookies.session],
      ["LEETCODE_CSRF_TOKEN", cookies.csrf]
    ];
    for (const [name, value] of values) {
      const encrypted = encryptSecret(keyData.key, value);
      const response = await fetch("https://api.github.com/repos/" + repo + "/actions/secrets/" + name, {
        method: "PUT",
        headers: ghHeaders(settings.pat),
        body: JSON.stringify({ encrypted_value: encrypted, key_id: keyData.key_id })
      });
      if (response.status !== 201 && response.status !== 204) {
        let message = "HTTP " + response.status;
        try {
          const body = await core.parseJsonResponse(response, "GitHub secret update");
          if (body.message) message += ": " + body.message;
        } catch (error) {
          message = error.message;
        }
        throw new Error("Could not update " + name + ". " + message);
      }
    }

    setStep(s2, "ok", "Updated");
    setStatus("ok", "Both LeetCode secrets were updated successfully. Values were encrypted before upload.");
    enableStep("s3", "b3");
    toast("Both GitHub secrets updated.");
  } catch (error) {
    setStep(s2, "", "Retry");
    setStatus("err", error.message);
    toast("Secret update failed.", true);
  } finally {
    busy = false;
  }
}

async function doTrigger() {
  if (busy) return;
  busy = true;
  const s3 = document.getElementById("s3");
  setStep(s3, "run", "Starting...");
  setStatus("busy", "Dispatching the solver workflow on main...");
  document.getElementById("run-link-wrap").classList.remove("show");
  try {
    const settings = await getSettings();
    const repo = core.validateRepository(settings.repo);
    if (!settings.pat) throw new Error("Enter and save your GitHub token first.");
    const dryRun = document.getElementById("dry-run").checked;
    const language = document.getElementById("language").value;
    const payload = core.buildWorkflowDispatchInput(dryRun, language);
    const startedAt = Date.now();

    const response = await fetch("https://api.github.com/repos/" + repo + "/actions/workflows/daily_solve.yml/dispatches", {
      method: "POST",
      headers: ghHeaders(settings.pat),
      body: JSON.stringify(payload)
    });
    if (response.status !== 204) {
      let message = "HTTP " + response.status;
      try {
        const body = await core.parseJsonResponse(response, "Workflow dispatch");
        if (body.message) message = body.message;
      } catch (error) {
        message = error.message;
      }
      throw new Error("Workflow dispatch failed: " + message);
    }

    setStep(s3, "ok", "Queued");
    setStatus("ok", dryRun
      ? "Dry run queued. It generates a solution and dashboard without submitting to LeetCode."
      : "Solver queued. It may submit the daily solution to LeetCode.");
    toast("Workflow queued.");

    // Show a durable fallback immediately; GitHub's dispatch endpoint returns 204 without a run ID.
    const link = document.getElementById("run-link");
    link.href = "https://github.com/" + repo + "/actions";
    link.textContent = "Open repository Actions";
    document.getElementById("run-link-wrap").classList.add("show");

    // Poll separately: failure to discover the run must not misreport a successful dispatch as failed.
    try {
      for (let attempt = 0; attempt < 8; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        const runsResponse = await fetch(
          "https://api.github.com/repos/" + repo + "/actions/workflows/daily_solve.yml/runs?event=workflow_dispatch&branch=main&per_page=5",
          { headers: ghHeaders(settings.pat) }
        );
        const runData = await core.parseJsonResponse(runsResponse, "Workflow run lookup");
        const run = core.findWorkflowRun(runData.workflow_runs, startedAt);
        if (run) {
          link.href = run.html_url;
          link.textContent = "Open this GitHub Actions run";
          setStatus("ok", "Workflow queued. Open the run link to watch logs, dashboard, and artifacts.");
          break;
        }
      }
    } catch (lookupError) {
      setStatus("ok", "Workflow was dispatched. Open repository Actions to find the run; run discovery was unavailable.");
    }
  } catch (error) {
    setStep(s3, "", "Retry");
    setStatus("err", error.message);
    toast("Workflow trigger failed.", true);
  } finally {
    busy = false;
  }
}

async function getSettings() {
  const [localData, sessionData] = await Promise.all([
    chrome.storage.local.get(["gh_repo"]),
    chrome.storage.session.get(["gh_pat"])
  ]);
  return { repo: localData.gh_repo || "itsyunus/LeetCode_autoSOL", pat: sessionData.gh_pat || "" };
}

function encryptSecret(publicKey, value) {
  if (!window.sodiumSeal) throw new Error("Encryption module did not load. Reload the extension.");
  const key = base64ToUint8Array(publicKey);
  const message = new TextEncoder().encode(value);
  return uint8ArrayToBase64(window.sodiumSeal(message, key));
}

function base64ToUint8Array(value) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function uint8ArrayToBase64(value) {
  let binary = "";
  for (let offset = 0; offset < value.length; offset += 0x8000) {
    binary += String.fromCharCode(...value.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function ghHeaders(pat) {
  return {
    Authorization: "Bearer " + pat,
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json",
    "X-GitHub-Api-Version": "2022-11-28"
  };
}

function enableStep(stepId, badgeId) {
  document.getElementById(stepId).classList.remove("off");
  document.getElementById(badgeId).textContent = "Click";
}

function setStatus(type, message) {
  const status = document.getElementById("status");
  const dot = document.getElementById("dot");
  status.classList.remove("ok", "err", "busy");
  dot.classList.remove("g", "r", "p");
  if (type === "ok") { status.classList.add("ok"); dot.classList.add("g"); }
  else if (type === "err") { status.classList.add("err"); dot.classList.add("r"); }
  else if (type === "busy") { status.classList.add("busy"); dot.classList.add("p"); }
  document.getElementById("msg").textContent = message;
}

function setStep(element, state, label) {
  element.classList.remove("ok", "run");
  if (state) element.classList.add(state);
  document.getElementById(element.id.replace("s", "b")).textContent = label;
}

function toast(message, isError = false) {
  const element = document.getElementById("toast");
  element.textContent = message;
  element.classList.toggle("err", isError);
  element.classList.add("show");
  setTimeout(() => element.classList.remove("show"), 2800);
}
