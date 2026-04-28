import { initAuth, signInWithGoogle, signOut, getCurrentUser } from "./auth.js";
import { listenToDocuments, listenToUserProfile, uploadAndVerifyDocument } from "./vault.js";
import { initiatePayment, listenToAccessLogs } from "./payment.js";
import { runAgentPipeline, confirmPipeline, onAgentLogUpdate, getAgentLog } from "./agents.js";

let currentScreen = "dashboard";
let currentVaultSection = "documents";
let unsubDocs = null;
let unsubProfile = null;
let unsubLogs = null;
let docStates = { pan: null, aadhaar: null, selfie: null };
let verificationInProgress = false;

document.addEventListener("DOMContentLoaded", () => {
  initAuth(handleLogin, handleLogout);
  setupLoginButton();
});

function setupLoginButton() {
  const btn = document.getElementById("google-signin-btn");
  if (btn) {
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      btn.textContent = "Signing in...";
      try {
        await signInWithGoogle();
      } catch (err) {
        showToast("Sign-in failed: " + err.message, "error");
      } finally {
        btn.disabled = false;
        btn.textContent = "Sign in with Google";
      }
    });
  }
}

function handleLogin(user) {
  document.getElementById("login-screen").classList.add("hidden");
  document.getElementById("app-screen").classList.remove("hidden");

  const avatar = document.getElementById("user-avatar");
  const name = document.getElementById("user-name");
  if (user.photoURL) avatar.src = user.photoURL;
  if (user.displayName) name.textContent = user.displayName.split(" ")[0];

  document.getElementById("signout-btn").addEventListener("click", async () => {
    await signOut();
  });

  setupNavigation();
  setupVaultNavigation();
  setupFileUploads();
  startListeners();
  showScreen("dashboard");
}

function handleLogout() {
  stopCamera();
  document.getElementById("login-screen").classList.remove("hidden");
  document.getElementById("app-screen").classList.add("hidden");
  if (unsubDocs) unsubDocs();
  if (unsubProfile) unsubProfile();
  if (unsubLogs) unsubLogs();
  docStates = { pan: null, aadhaar: null, selfie: null };
}

function startListeners() {
  unsubProfile = listenToUserProfile((profile) => {
    if (!profile) return;
    updateProgressBar(profile.kycCompletion || 0);
    document.getElementById("total-earnings").textContent =
      `₹${(profile.totalEarnings || 0).toFixed(2)}`;
  });

  unsubDocs = listenToDocuments((docType, data) => {
    docStates[docType] = data;
    updateDocCard(docType, data);
    updateDashboardCards();
    updateBankView();
  });

  unsubLogs = listenToAccessLogs((logs) => {
    renderAccessLogs(logs);
  });

  onAgentLogUpdate((entries) => {
    renderAgentLog(entries);
  });
}

/* ---- Navigation ---- */

function setupNavigation() {
  document.querySelectorAll(".nav-link[data-screen]").forEach((link) => {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      showScreen(link.dataset.screen);
    });
  });
}

function showScreen(screenId) {
  if (currentScreen === "vault" && screenId !== "vault") {
    stopCamera();
  }

  document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
  const el = document.getElementById(screenId);
  if (el) el.classList.add("active");

  document.querySelectorAll(".nav-link[data-screen]").forEach((link) => {
    link.classList.toggle("active", link.dataset.screen === screenId);
  });
  currentScreen = screenId;
}

function setupVaultNavigation() {
  document.querySelectorAll(".vault-nav-item[data-section]").forEach((item) => {
    item.addEventListener("click", (e) => {
      e.preventDefault();
      showVaultSection(item.dataset.section);
    });
  });
}

function showVaultSection(sectionId) {
  document.querySelectorAll(".vault-section").forEach((s) => s.classList.remove("active"));
  const el = document.getElementById(`${sectionId}-section`);
  if (el) el.classList.add("active");

  document.querySelectorAll(".vault-nav-item").forEach((item) => {
    item.classList.toggle("active", item.dataset.section === sectionId);
  });
  currentVaultSection = sectionId;
}

/* ---- Progress & Dashboard ---- */

function updateProgressBar(pct) {
  const fill = document.getElementById("progress-fill");
  const text = document.getElementById("progress-text");
  if (fill) fill.style.width = `${pct}%`;
  if (text) text.textContent = `KYC Strength: ${pct}%`;
}

function updateDashboardCards() {
  const types = [
    { key: "pan", label: "PAN Card" },
    { key: "aadhaar", label: "Aadhaar Card" },
    { key: "selfie", label: "Selfie Verification" },
  ];

  types.forEach(({ key }) => {
    const badge = document.getElementById(`dash-badge-${key}`);
    const detail = document.getElementById(`dash-detail-${key}`);
    if (!badge || !detail) return;

    const data = docStates[key];
    if (data && data.verified) {
      badge.className = "badge badge-verified";
      badge.textContent = "VERIFIED";
      const fields = data.fields || {};
      if (key === "pan" && fields.number) {
        detail.textContent = `PAN: ${fields.number}`;
      } else if (key === "aadhaar" && fields.number) {
        detail.textContent = `Aadhaar: ${fields.number}`;
      } else if (key === "selfie") {
        detail.textContent = "Liveness check passed";
      } else {
        detail.textContent = "Verified";
      }
    } else {
      badge.className = "badge badge-pending";
      badge.textContent = "PENDING";
      detail.textContent = "Upload required";
    }
  });
}

/* ---- Document Upload ---- */

function updateDocCard(docType, data) {
  const uploadArea = document.getElementById(`${docType}-upload`);
  const statusArea = document.getElementById(`${docType}-status`);

  if (!uploadArea || !statusArea) return;

  if (data && data.verified) {
    uploadArea.classList.add("hidden");
    statusArea.classList.remove("hidden");
    statusArea.innerHTML = renderExtractedFields(docType, data.fields || {});
  } else {
    uploadArea.classList.remove("hidden");
    statusArea.classList.add("hidden");
    statusArea.innerHTML = "";
  }
}

function renderExtractedFields(docType, fields) {
  let html = `<div class="doc-status"><div class="mb-2"><span class="badge badge-verified">VERIFIED</span></div>`;

  if (docType === "pan") {
    if (fields.number) html += fieldRow("PAN Number", fields.number);
    if (fields.name) html += fieldRow("Name", fields.name);
    if (fields.dob) html += fieldRow("Date of Birth", fields.dob);
  } else if (docType === "aadhaar") {
    if (fields.number) html += fieldRow("Aadhaar Number", fields.number);
    if (fields.name) html += fieldRow("Name", fields.name);
    if (fields.dob) html += fieldRow("Date of Birth", fields.dob);
    if (fields.gender) html += fieldRow("Gender", fields.gender);
    if (fields.address) html += fieldRow("Address", fields.address);
  } else if (docType === "selfie") {
    html += fieldRow("Liveness Check", "Passed");
  }

  html += `</div>`;
  return html;
}

function fieldRow(label, value) {
  return `<div class="extracted-field"><span class="field-label">${label}</span><span class="field-value">${value}</span></div>`;
}

function setupFileUploads() {
  const docConfigs = [
    { docType: "pan", uploadId: "pan-upload", fileId: "pan-file" },
    { docType: "aadhaar", uploadId: "aadhaar-upload", fileId: "aadhaar-file" },
  ];

  docConfigs.forEach(({ docType, uploadId, fileId }) => {
    const area = document.getElementById(uploadId);
    const input = document.getElementById(fileId);
    if (!area || !input) return;

    area.addEventListener("click", () => input.click());

    input.addEventListener("change", (e) => {
      if (e.target.files[0]) handleUpload(docType, e.target.files[0]);
    });

    area.addEventListener("dragover", (e) => {
      e.preventDefault();
      area.classList.add("dragover");
    });
    area.addEventListener("dragleave", () => area.classList.remove("dragover"));
    area.addEventListener("drop", (e) => {
      e.preventDefault();
      area.classList.remove("dragover");
      if (e.dataTransfer.files[0]) handleUpload(docType, e.dataTransfer.files[0]);
    });
  });

  setupSelfieCamera();
}

let selfieStream = null;

function setupSelfieCamera() {
  const placeholder = document.getElementById("selfie-placeholder");
  const video = document.getElementById("selfie-video");
  const canvas = document.getElementById("selfie-canvas");
  const controls = document.getElementById("selfie-controls");
  const captureBtn = document.getElementById("selfie-capture-btn");
  const retakeBtn = document.getElementById("selfie-retake-btn");

  if (!placeholder || !video) return;

  placeholder.addEventListener("click", startCamera);

  async function startCamera() {
    try {
      selfieStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
      video.srcObject = selfieStream;
      video.classList.remove("hidden");
      placeholder.classList.add("hidden");
      controls.classList.remove("hidden");
      captureBtn.classList.remove("hidden");
      retakeBtn.classList.add("hidden");
    } catch (err) {
      showToast("Camera access denied. Please allow camera permission.", "error");
    }
  }

  captureBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    stopCamera();

    const img = document.createElement("img");
    img.src = canvas.toDataURL("image/jpeg", 0.85);
    img.className = "selfie-preview";
    video.classList.add("hidden");
    video.insertAdjacentElement("afterend", img);

    captureBtn.classList.add("hidden");
    retakeBtn.classList.remove("hidden");

    canvas.toBlob((blob) => {
      const file = new File([blob], "selfie.jpg", { type: "image/jpeg" });
      handleUpload("selfie", file);
    }, "image/jpeg", 0.85);
  });

  retakeBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const preview = document.querySelector(".selfie-preview");
    if (preview) preview.remove();
    startCamera();
  });
}

function stopCamera() {
  if (selfieStream) {
    selfieStream.getTracks().forEach((t) => t.stop());
    selfieStream = null;
  }
}

async function handleUpload(docType, file) {
  if (verificationInProgress) {
    showToast("Please wait for the current verification to finish.", "info");
    return;
  }

  verificationInProgress = true;
  showVaultSection("verification");
  resetChecklist();

  try {
    await uploadAndVerifyDocument(file, docType, (step, state, message) => {
      updateChecklistStep(step, state, message);
    });
    showToast(`${docType.toUpperCase()} verified successfully!`, "success");
    showVaultSection("documents");
  } catch (err) {
    showToast(err.message, "error");
  } finally {
    verificationInProgress = false;
  }
}

function resetChecklist() {
  document.querySelectorAll("#verification-checklist .checklist-item").forEach((item) => {
    item.className = "checklist-item";
    const text = item.querySelector(".checklist-text");
    if (text) text.textContent = item.dataset.defaultText || text.textContent;
  });
}

function updateChecklistStep(step, state, message) {
  const item = document.querySelector(`.checklist-item[data-step="${step}"]`);
  if (!item) return;

  item.className = `checklist-item ${state}`;
  const text = item.querySelector(".checklist-text");
  if (text) text.textContent = message;

  const icon = item.querySelector(".checklist-icon");
  if (!icon) return;

  if (state === "active") {
    icon.innerHTML = '<span class="spinner"></span>';
  } else if (state === "completed") {
    icon.textContent = "✓";
  } else if (state === "error") {
    icon.textContent = "✗";
  }
}

/* ---- Bank View ---- */

function updateBankView() {
  const fields = [];
  if (docStates.pan?.verified) fields.push({ label: "PAN Verified", value: docStates.pan.fields?.number || "Yes", icon: "✅" });
  if (docStates.aadhaar?.verified) fields.push({ label: "Address Verified", value: docStates.aadhaar.fields?.address?.split(",")[0] || "Yes", icon: "✅" });
  if (docStates.aadhaar?.verified) fields.push({ label: "DOB Verified", value: docStates.aadhaar.fields?.dob || "Yes", icon: "✅" });
  if (docStates.selfie?.verified) fields.push({ label: "Liveness Verified", value: "Passed", icon: "✅" });

  const container = document.getElementById("bank-kyc-fields");
  if (!container) return;

  if (fields.length === 0) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">📋</div><p>No verified KYC data yet. Upload documents first.</p></div>`;
    return;
  }

  container.innerHTML = fields
    .map(
      (f) => `
    <div class="stat-card">
      <div class="text-2xl mb-2">${f.icon}</div>
      <div class="font-semibold">${f.label}</div>
      <div class="text-sm text-gray-500">${f.value}</div>
    </div>`
    )
    .join("");

  const payBtn = document.getElementById("bank-pay-btn");
  if (payBtn) payBtn.disabled = fields.length === 0;
}

window.handleBankPayment = async function (bankName, purpose) {
  if (!docStates.pan?.verified && !docStates.aadhaar?.verified && !docStates.selfie?.verified) {
    showToast("No verified KYC data to share. Upload documents first.", "error");
    return;
  }

  const btn = document.getElementById("bank-pay-btn");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Running agent pipeline...";
  }

  setAgentDots(["dot-vault", "dot-bank"], true);

  try {
    const user = getCurrentUser();
    const pipelineResult = await runAgentPipeline(
      user.uid,
      docStates,
      bankName,
      purpose
    );

    if (!pipelineResult.success) {
      showToast("Agent pipeline failed: " + pipelineResult.error, "error");
      return;
    }

    setAgentDots(["dot-mcp"], true);
    setAgentDots(["dot-ap2"], true);

    const paymentResult = await initiatePayment(bankName, purpose, pipelineResult.fieldsShared);

    await confirmPipeline(
      pipelineResult.vaultAgent,
      pipelineResult.bankAgent,
      paymentResult.paymentId,
      bankName,
      pipelineResult.fieldsShared
    );

    showToast(`KYC approved via A2A! ₹${paymentResult.amountEarned} earned from ${bankName}`, "success");
  } catch (err) {
    if (err.message !== "Payment cancelled") {
      showToast("Pipeline error: " + err.message, "error");
    }
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Approve KYC — Pay ₹1";
    }
    setTimeout(() => setAgentDots(["dot-vault", "dot-bank", "dot-mcp", "dot-ap2"], false), 3000);
  }
};

window.copyDemoValue = async function (value) {
  try {
    await navigator.clipboard.writeText(value);
    showToast(`Copied: ${value}`, "success");
  } catch (err) {
    showToast("Could not copy automatically. Please copy manually.", "error");
  }
};

function setAgentDots(ids, active) {
  ids.forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.classList.toggle("active", active);
  });
}

/* ---- Agent Log Renderer ---- */

function renderAgentLog(entries) {
  const container = document.getElementById("agent-log");
  if (!container) return;

  if (entries.length === 0) {
    container.innerHTML = `<div class="agent-log-empty">No agent activity yet. Go to <strong>Bank View</strong> and click a bank to trigger the agent pipeline.</div>`;
    return;
  }

  container.innerHTML = entries.map((e) => {
    const badge = e.protocol || "SYSTEM";
    const badgeClass = `log-badge-${badge.toLowerCase()}`;
    let content = "";
    let detail = "";

    if (e.type === "adk") {
      const phaseLabel = { perceive: "PERCEIVE", think: "THINK", act: "ACT", respond: "RESPOND" }[e.phase] || e.phase;
      content = `<strong>[${e.agent}]</strong> <em>${phaseLabel}</em>: ${e.description}`;
      if (e.details) detail = JSON.stringify(e.details);
    } else if (e.type === "a2a") {
      content = `<strong>${e.from} → ${e.to}</strong>: ${e.messageType}`;
      if (e.payload) detail = JSON.stringify(e.payload);
    } else if (e.type === "mcp") {
      if (e.action === "tool_call") {
        content = `<strong>Tool Call:</strong> ${e.tool}(${JSON.stringify(e.input)})`;
      } else if (e.action === "tool_result") {
        content = `<strong>Tool Result:</strong> ${e.tool} → ${e.output?.success ? "success" : "failed"}`;
        if (e.output?.results) detail = JSON.stringify(e.output.results);
        if (e.output?.proofHash) detail = `Proof: ${e.output.proofHash.slice(0, 24)}...`;
      } else {
        content = `${e.action}: ${e.tool}`;
      }
    } else if (e.type === "ap2") {
      content = e.description;
      if (e.paymentId) detail = `Payment ID: ${e.paymentId}`;
      if (e.proofHash) detail = `Proof: ${e.proofHash}`;
    } else {
      content = e.description || JSON.stringify(e);
      if (e.proofHash) detail = `Proof: ${e.proofHash}`;
    }

    return `<div class="agent-log-entry">
      <span class="log-badge ${badgeClass}">${badge}</span>
      <div>
        <div class="log-content">${content}</div>
        ${detail ? `<div class="log-detail">${detail}</div>` : ""}
      </div>
    </div>`;
  }).join("");

  container.scrollTop = container.scrollHeight;
}

/* ---- Access Logs ---- */

function renderAccessLogs(logs) {
  const container = document.getElementById("access-logs-list");
  const earningsEl = document.getElementById("earnings-amount");
  if (!container) return;

  if (logs.length === 0) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">📂</div><p>No access logs yet. Banks will appear here after they request your KYC.</p></div>`;
    if (earningsEl) earningsEl.textContent = "₹0.00";
    return;
  }

  const totalEarnings = logs.reduce((sum, l) => sum + (l.amountEarned || 0), 0);
  if (earningsEl) earningsEl.textContent = `₹${totalEarnings.toFixed(2)}`;

  container.innerHTML = logs
    .map((log) => {
      const time = log.timestamp?.toDate
        ? formatTimeAgo(log.timestamp.toDate())
        : "Just now";
      return `
      <div class="log-entry">
        <div class="log-left">
          <div class="log-bank">${log.bankName || "Unknown Bank"}</div>
          <div class="log-purpose">${log.purpose || "KYC Verification"}</div>
          <div class="log-fields">Shared: ${(log.fieldsShared || []).join(", ")}</div>
        </div>
        <div class="log-right">
          <div class="log-amount">+₹${(log.amountEarned || 0).toFixed(2)}</div>
          <div class="log-time">${time}</div>
        </div>
      </div>`;
    })
    .join("");
}

function formatTimeAgo(date) {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "Just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/* ---- Toast ---- */

function showToast(message, type = "info") {
  const existing = document.querySelector(".toast");
  if (existing) existing.remove();

  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);

  requestAnimationFrame(() => toast.classList.add("show"));
  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}
