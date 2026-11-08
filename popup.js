// ── State ────────────────────────────────────────────────────
let cookies = { session: null, csrf: null, username: null };

// ── Init: Load saved settings & attach event listeners ──────
document.addEventListener("DOMContentLoaded", () => {
  chrome.storage.local.get(["gh_pat", "gh_repo"], (data) => {
    if (data.gh_pat) document.getElementById("pat").value = data.gh_pat;
    if (data.gh_repo) document.getElementById("repo").value = data.gh_repo;
  });

  document.getElementById("s1").addEventListener("click", doExtract);
  document.getElementById("s2").addEventListener("click", doPush);
  document.getElementById("s3").addEventListener("click", doTrigger);
  document.getElementById("saveBtn").addEventListener("click", saveSettings);
});

// ── Save Settings ───────────────────────────────────────────
function saveSettings() {
  const pat = document.getElementById("pat").value.trim();
  const repo = document.getElementById("repo").value.trim();

  if (!pat) return toast("Enter a GitHub PAT", true);
  if (!repo || !repo.includes("/")) return toast("Enter repo as owner/repo", true);

  chrome.storage.local.set({ gh_pat: pat, gh_repo: repo }, () => {
    toast("Settings saved!");
  });
}

// ── Cookie Extraction Helper ────────────────────────────────
function getCookie(name) {
  return new Promise((resolve) => {
    chrome.cookies.getAll({ domain: "leetcode.com", name: name }, (all) => {
      if (all && all.length > 0) {
        resolve(all[0].value);
        return;
      }
      chrome.cookies.get({ url: "https://leetcode.com", name: name }, (c) => {
        resolve(c ? c.value : null);
      });
    });
  });
}

// ── Step 1: Extract Cookies ─────────────────────────────────
async function doExtract() {
  const s1 = document.getElementById("s1");
  if (s1.classList.contains("off")) return;

  setStep(s1, "run", "Extracting...");
  setStatus("busy", "Reading LeetCode cookies from browser...");

  try {
    const sessionCookie = await getCookie("LEETCODE_SESSION");
    const csrfCookie = await getCookie("csrftoken");

    if (!sessionCookie) {
      setStep(s1, "", "Click to retry");
      setStatus("err", "No LEETCODE_SESSION cookie found — please log in on leetcode.com first!");
      toast("Not logged in to LeetCode", true);
      return;
    }

    cookies.session = sessionCookie;
    cookies.csrf = csrfCookie || "";

    setStatus("busy", "Validating LeetCode session...");

    // Validate using LeetCode GraphQL
    const resp = await fetch("https://leetcode.com/graphql", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-csrftoken": cookies.csrf,
      },
      body: JSON.stringify({
        query: "query { userStatus { username isSignedIn } }",
      }),
      credentials: "include",
    });

    const data = await resp.json();
    const userStatus = data?.data?.userStatus;

    if (!userStatus?.isSignedIn) {
      setStep(s1, "", "Click to retry");
      setStatus("err", "Session expired or invalid on LeetCode. Please log in again.");
      toast("Session expired", true);
      return;
    }

    cookies.username = userStatus.username || "LeetCoder";

    // Show cookie info in popup
    document.getElementById("ci-user").textContent = cookies.username;
    document.getElementById("ci-sess").textContent = cookies.session.slice(0, 24) + "...";
    document.getElementById("ci-csrf").textContent = cookies.csrf ? "✅ Present" : "—";
    document.getElementById("cinfo").classList.add("show");

    setStep(s1, "ok", "✅ Done");
    setStatus("ok", `Logged in as ${cookies.username}`);
    toast("Cookies extracted & validated!");

    // Enable step 2
    const s2 = document.getElementById("s2");
    s2.classList.remove("off");
    document.getElementById("b2").textContent = "Click";

  } catch (err) {
    console.error("Extract error:", err);
    setStep(s1, "", "Click to retry");
    setStatus("err", `Error: ${err.message}`);
    toast("Extraction failed", true);
  }
}

// ── Step 2: Push to GitHub ──────────────────────────────────
async function doPush() {
  const s2 = document.getElementById("s2");
  if (s2.classList.contains("off")) return;

  const settings = await getSettings();
  if (!settings.pat) {
    toast("Set your GitHub PAT first!", true);
    return;
  }

  setStep(s2, "run", "Pushing...");
  setStatus("busy", "Updating GitHub Secrets via API...");

  try {
    // 1. Get repo public key for secret encryption
    const keyResp = await fetch(
      `https://api.github.com/repos/${settings.repo}/actions/secrets/public-key`,
      { headers: ghHeaders(settings.pat) }
    );

    if (!keyResp.ok) {
      const err = await keyResp.json().catch(() => ({}));
      throw new Error(err.message || `GitHub API returned ${keyResp.status}`);
    }

    const keyData = await keyResp.json();

    // 2. Encrypt and upload secrets
    const secretsToUpload = {
      LEETCODE_SESSION: cookies.session,
      LEETCODE_CSRF_TOKEN: cookies.csrf,
    };

    let allOk = true;
    for (const [name, val] of Object.entries(secretsToUpload)) {
      const encrypted = encryptSecret(keyData.key, val);
      const putResp = await fetch(
        `https://api.github.com/repos/${settings.repo}/actions/secrets/${name}`,
        {
          method: "PUT",
          headers: ghHeaders(settings.pat),
          body: JSON.stringify({
            encrypted_value: encrypted,
            key_id: keyData.key_id,
          }),
        }
      );
      if (!putResp.ok) {
        allOk = false;
        const err = await putResp.text();
        console.error(`Failed to update ${name}:`, err);
      }
    }

    if (allOk) {
      setStep(s2, "ok", "✅ Pushed");
      setStatus("ok", "Secrets pushed to GitHub!");
      toast("Secrets updated on GitHub!");

      // Enable step 3
      const s3 = document.getElementById("s3");
      s3.classList.remove("off");
      document.getElementById("b3").textContent = "Click";
    } else {
      setStep(s2, "", "Retry");
      setStatus("err", "Failed to update one or more secrets.");
      toast("Push failed", true);
    }

  } catch (err) {
    console.error("Push error:", err);
    setStep(s2, "", "Retry");
    setStatus("err", `Push failed: ${err.message}`);
    toast("Push failed", true);
  }
}

// ── Step 3: Trigger Workflow ────────────────────────────────
async function doTrigger() {
  const s3 = document.getElementById("s3");
  if (s3.classList.contains("off")) return;

  const settings = await getSettings();
  setStep(s3, "run", "Triggering...");
  setStatus("busy", "Triggering daily solver workflow...");

  try {
    const resp = await fetch(
      `https://api.github.com/repos/${settings.repo}/actions/workflows/daily_solve.yml/dispatches`,
      {
        method: "POST",
        headers: ghHeaders(settings.pat),
        body: JSON.stringify({ ref: "main" }),
      }
    );

    if (resp.ok || resp.status === 204) {
      setStep(s3, "ok", "✅ Triggered");
      setStatus("ok", "Solver running! Check GitHub Actions.");
      toast("Workflow started!");
    } else {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.message || `Status ${resp.status}`);
    }

  } catch (err) {
    console.error("Trigger error:", err);
    setStep(s3, "", "Retry");
    setStatus("err", `Trigger failed: ${err.message}`);
    toast("Trigger failed", true);
  }
}

// ── Libsodium Sealed Box Helper ─────────────────────────────
function encryptSecret(base64PublicKey, secretValue) {
  if (!window.sodiumSeal) {
    throw new Error("Sodium encryption module not loaded");
  }
  const publicKey = base64ToUint8Array(base64PublicKey);
  const messageBytes = new TextEncoder().encode(secretValue);
  const encryptedBytes = window.sodiumSeal(messageBytes, publicKey);
  return uint8ArrayToBase64(encryptedBytes);
}

function base64ToUint8Array(b64) {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

function uint8ArrayToBase64(arr) {
  let bin = "";
  for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
  return btoa(bin);
}

// ── Config & Headers ────────────────────────────────────────
function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get(["gh_pat", "gh_repo"], (data) => {
      resolve({
        pat: data.gh_pat || "",
        repo: data.gh_repo || "itsyunus/LeetCode_autoSOL",
      });
    });
  });
}

function ghHeaders(pat) {
  return {
    Authorization: `Bearer ${pat}`,
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

// ── UI Helpers ──────────────────────────────────────────────
function setStatus(type, msg) {
  const s = document.getElementById("status");
  const d = document.getElementById("dot");
  const m = document.getElementById("msg");
  s.classList.remove("ok", "err", "busy");
  d.classList.remove("g", "r", "p");
  if (type === "ok") { s.classList.add("ok"); d.classList.add("g"); }
  else if (type === "err") { s.classList.add("err"); d.classList.add("r"); }
  else if (type === "busy") { s.classList.add("busy"); d.classList.add("p"); }
  m.textContent = msg;
}

function setStep(el, state, badge) {
  el.classList.remove("ok", "run");
  if (state) el.classList.add(state);
  const id = el.id.replace("s", "b");
  document.getElementById(id).textContent = badge;
}

function toast(msg, err = false) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.toggle("err", err);
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 2500);
}
