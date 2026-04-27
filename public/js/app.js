import { initAuth, signInWithGoogle, signOut, getCurrentUser } from "./auth.js";
import { listenToDocuments, listenToUserProfile, uploadAndVerifyDocument } from "./vault.js";
import { initiatePayment, listenToAccessLogs } from "./payment.js";

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
  const configs = [
    { docType: "pan", uploadId: "pan-upload", fileId: "pan-file" },
    { docType: "aadhaar", uploadId: "aadhaar-upload", fileId: "aadhaar-file" },
    { docType: "selfie", uploadId: "selfie-upload", fileId: "selfie-file" },
  ];

  configs.forEach(({ docType, uploadId, fileId }) => {
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
  const fieldsShared = [];
  if (docStates.pan?.verified) fieldsShared.push("PAN");
  if (docStates.aadhaar?.verified) fieldsShared.push("Address", "DOB");
  if (docStates.selfie?.verified) fieldsShared.push("Selfie");

  if (fieldsShared.length === 0) {
    showToast("No verified KYC data to share. Upload documents first.", "error");
    return;
  }

  const btn = document.getElementById("bank-pay-btn");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Processing...";
  }

  try {
    const result = await initiatePayment(bankName, purpose, fieldsShared);
    showToast(`KYC approved! ₹${result.amountEarned} earned from ${result.bankName}`, "success");
  } catch (err) {
    if (err.message !== "Payment cancelled") {
      showToast("Payment failed: " + err.message, "error");
    }
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Approve KYC — Pay ₹1";
    }
  }
};

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
