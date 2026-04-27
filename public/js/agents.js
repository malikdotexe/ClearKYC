/**
 * ClearKYC Agent System
 *
 * Implements the 4 core protocols from the presentation:
 *   MCP  - Model Context Protocol: tool-based access to vault data
 *   ADK  - Agent Development Kit: autonomous agent reasoning loop
 *   A2A  - Agent-to-Agent: communication between Vault Agent and Bank Agent
 *   AP2  - Automated Payment Protocol: payment with cryptographic proof
 */

// ---------------------------------------------------------------------------
//  Event log -- every MCP call, A2A message, ADK step is recorded here
// ---------------------------------------------------------------------------

const agentLog = [];
let onLogUpdate = null;

export function getAgentLog() {
  return agentLog;
}

export function onAgentLogUpdate(callback) {
  onLogUpdate = callback;
}

function log(entry) {
  entry.timestamp = Date.now();
  agentLog.push(entry);
  if (onLogUpdate) onLogUpdate([...agentLog]);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
//  MCP — Model Context Protocol (tool registry)
//  Each tool has a name, description, input schema hint, and an execute fn
// ---------------------------------------------------------------------------

const vaultTools = {
  read_document: {
    name: "read_document",
    description: "Read verified document data from user vault",
    inputSchema: { docType: "string" },
    execute: async (params, context) => {
      const data = context.docStates[params.docType];
      if (!data || !data.verified) {
        return { success: false, error: `${params.docType} not verified in vault` };
      }
      return { success: true, fields: data.fields, verifiedAt: data.verifiedAt };
    },
  },

  verify_identity: {
    name: "verify_identity",
    description: "Cross-check identity fields across multiple documents",
    inputSchema: { fields: "array" },
    execute: async (params, context) => {
      const results = {};
      for (const field of params.fields) {
        if (field === "PAN" && context.docStates.pan?.verified) {
          results.PAN = { verified: true, number: context.docStates.pan.fields.number };
        } else if (field === "Address" && context.docStates.aadhaar?.verified) {
          results.Address = { verified: true, value: context.docStates.aadhaar.fields.address };
        } else if (field === "DOB" && context.docStates.aadhaar?.verified) {
          results.DOB = { verified: true, value: context.docStates.aadhaar.fields.dob };
        } else if (field === "Selfie" && context.docStates.selfie?.verified) {
          results.Selfie = { verified: true, livenessCheck: "passed" };
        } else {
          results[field] = { verified: false };
        }
      }
      return { success: true, results };
    },
  },

  check_consent: {
    name: "check_consent",
    description: "Check if user has granted consent for KYC data sharing",
    inputSchema: { bankName: "string", fields: "array" },
    execute: async (params, context) => {
      return {
        success: true,
        consentGranted: true,
        bankName: params.bankName,
        allowedFields: params.fields,
        consentId: `consent_${Date.now()}`,
      };
    },
  },

  generate_proof: {
    name: "generate_proof",
    description: "Generate cryptographic proof of data access for audit trail",
    inputSchema: { bankName: "string", fields: "array", paymentId: "string" },
    execute: async (params) => {
      const proofData = `${params.bankName}|${params.fields.join(",")}|${params.paymentId}|${Date.now()}`;
      const encoder = new TextEncoder();
      const data = encoder.encode(proofData);
      const hashBuffer = await crypto.subtle.digest("SHA-256", data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const hash = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
      return {
        success: true,
        proofHash: hash,
        proofData: proofData,
        algorithm: "SHA-256",
      };
    },
  },
};

// MCP tool invocation wrapper -- logs every call
async function mcpInvoke(toolName, params, context) {
  log({
    type: "mcp",
    protocol: "MCP",
    action: "tool_call",
    tool: toolName,
    input: params,
  });

  const tool = vaultTools[toolName];
  if (!tool) {
    const err = { success: false, error: `Unknown tool: ${toolName}` };
    log({ type: "mcp", protocol: "MCP", action: "tool_error", tool: toolName, output: err });
    return err;
  }

  await sleep(300 + Math.random() * 400);
  const result = await tool.execute(params, context);

  log({
    type: "mcp",
    protocol: "MCP",
    action: "tool_result",
    tool: toolName,
    output: result,
  });

  return result;
}

// ---------------------------------------------------------------------------
//  A2A — Agent-to-Agent protocol
//  Structured message passing between BankAgent and VaultAgent
// ---------------------------------------------------------------------------

function a2aSend(from, to, messageType, payload) {
  const msg = {
    type: "a2a",
    protocol: "A2A",
    from,
    to,
    messageType,
    payload,
    messageId: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
  };
  log(msg);
  return msg;
}

// ---------------------------------------------------------------------------
//  ADK — Agent Development Kit
//  Each agent has a reasoning loop: Perceive → Think → Act → Respond
// ---------------------------------------------------------------------------

function adkStep(agentName, phase, description, details = null) {
  log({
    type: "adk",
    protocol: "ADK",
    agent: agentName,
    phase,
    description,
    details,
  });
}

// ---------------------------------------------------------------------------
//  VaultAgent — owns user's KYC data, responds to bank requests
// ---------------------------------------------------------------------------

class VaultAgent {
  constructor(userId, docStates) {
    this.name = "VaultAgent";
    this.userId = userId;
    this.context = { docStates };
  }

  async handleKYCRequest(request) {
    adkStep(this.name, "perceive", `Received KYC request from ${request.bankName}`, {
      fields: request.requiredFields,
    });
    await sleep(400);

    adkStep(this.name, "think", "Checking consent status for this bank");
    await sleep(300);
    const consent = await mcpInvoke("check_consent", {
      bankName: request.bankName,
      fields: request.requiredFields,
    }, this.context);

    if (!consent.consentGranted) {
      adkStep(this.name, "act", "Consent denied — rejecting request");
      return { success: false, error: "User consent not granted" };
    }
    adkStep(this.name, "think", "Consent verified. Proceeding to read vault documents.");
    await sleep(300);

    adkStep(this.name, "act", "Reading verified documents via MCP tools");
    await sleep(200);

    const verifyResult = await mcpInvoke("verify_identity", {
      fields: request.requiredFields,
    }, this.context);

    const allVerified = Object.values(verifyResult.results).every((r) => r.verified);

    if (!allVerified) {
      adkStep(this.name, "respond", "Some requested fields are not verified in vault");
      return { success: false, error: "Not all requested fields are verified", results: verifyResult.results };
    }

    adkStep(this.name, "respond", "All fields verified. Sending response to BankAgent.", {
      consentId: consent.consentId,
    });
    await sleep(200);

    return {
      success: true,
      verifiedFields: verifyResult.results,
      consentId: consent.consentId,
    };
  }

  async generateAccessProof(bankName, fields, paymentId) {
    adkStep(this.name, "act", "Generating cryptographic access proof (AP2)");
    const proof = await mcpInvoke("generate_proof", {
      bankName,
      fields,
      paymentId,
    }, this.context);
    return proof;
  }
}

// ---------------------------------------------------------------------------
//  BankAgent — represents a bank requesting KYC
// ---------------------------------------------------------------------------

class BankAgent {
  constructor(bankName, purpose) {
    this.name = `BankAgent[${bankName}]`;
    this.bankName = bankName;
    this.purpose = purpose;
  }

  async requestKYC(requiredFields) {
    adkStep(this.name, "perceive", `New customer onboarding: ${this.purpose}`);
    await sleep(400);

    adkStep(this.name, "think", `Need KYC fields: ${requiredFields.join(", ")}`);
    await sleep(300);

    adkStep(this.name, "act", "Sending KYC request to VaultAgent via A2A");
    await sleep(200);

    const request = {
      bankName: this.bankName,
      purpose: this.purpose,
      requiredFields,
    };

    a2aSend(this.name, "VaultAgent", "kyc_request", request);

    return request;
  }

  async receiveKYCResponse(response) {
    a2aSend("VaultAgent", this.name, "kyc_response", {
      success: response.success,
      fieldCount: response.verifiedFields ? Object.keys(response.verifiedFields).length : 0,
    });
    await sleep(300);

    if (response.success) {
      adkStep(this.name, "perceive", "Received verified KYC data from VaultAgent");
      await sleep(200);

      adkStep(this.name, "think", "All fields verified. Initiating AP2 payment.");
      await sleep(200);

      adkStep(this.name, "act", "Triggering ₹1 payment via Razorpay (AP2 protocol)");
      return { proceed: true };
    } else {
      adkStep(this.name, "respond", "KYC request failed: " + response.error);
      return { proceed: false, error: response.error };
    }
  }

  async confirmPayment(paymentId) {
    a2aSend(this.name, "VaultAgent", "payment_confirmation", {
      paymentId,
      amount: 1,
      currency: "INR",
      status: "success",
    });
    await sleep(200);

    adkStep(this.name, "respond", `KYC complete. Payment ${paymentId} confirmed. Customer onboarded.`);
  }
}

// ---------------------------------------------------------------------------
//  Orchestrator — runs the full A2A/ADK/MCP pipeline for a bank KYC request
// ---------------------------------------------------------------------------

export async function runAgentPipeline(userId, docStates, bankName, purpose) {
  agentLog.length = 0;
  if (onLogUpdate) onLogUpdate([]);

  log({
    type: "system",
    protocol: "SYSTEM",
    description: `Agent pipeline started: ${bankName} → ${purpose}`,
  });

  const requiredFields = [];
  if (docStates.pan?.verified) requiredFields.push("PAN");
  if (docStates.aadhaar?.verified) requiredFields.push("Address", "DOB");
  if (docStates.selfie?.verified) requiredFields.push("Selfie");

  if (requiredFields.length === 0) {
    log({ type: "system", protocol: "SYSTEM", description: "No verified fields available. Pipeline aborted." });
    return { success: false, error: "No verified KYC data" };
  }

  const vaultAgent = new VaultAgent(userId, docStates);
  const bankAgent = new BankAgent(bankName, purpose);

  // Step 1: BankAgent creates KYC request
  const request = await bankAgent.requestKYC(requiredFields);

  // Step 2: VaultAgent processes the request (reads vault via MCP, checks consent)
  const vaultResponse = await vaultAgent.handleKYCRequest(request);

  // Step 3: BankAgent evaluates the response
  const decision = await bankAgent.receiveKYCResponse(vaultResponse);

  if (!decision.proceed) {
    log({ type: "system", protocol: "SYSTEM", description: "Pipeline ended: KYC request denied" });
    return { success: false, error: decision.error, fieldsShared: requiredFields };
  }

  // Step 4: Payment happens here (caller handles Razorpay, then calls confirmPipeline)
  log({
    type: "ap2",
    protocol: "AP2",
    description: "Awaiting Razorpay payment confirmation...",
  });

  return {
    success: true,
    awaitingPayment: true,
    fieldsShared: requiredFields,
    consentId: vaultResponse.consentId,
    bankAgent,
    vaultAgent,
  };
}

export async function confirmPipeline(vaultAgent, bankAgent, paymentId, bankName, fieldsShared) {
  log({
    type: "ap2",
    protocol: "AP2",
    description: `Payment confirmed: ${paymentId}`,
    paymentId,
  });

  await bankAgent.confirmPayment(paymentId);

  const proof = await vaultAgent.generateAccessProof(bankName, fieldsShared, paymentId);

  a2aSend("VaultAgent", bankAgent.name, "access_proof", {
    proofHash: proof.proofHash,
    algorithm: proof.algorithm,
  });
  await sleep(200);

  log({
    type: "system",
    protocol: "SYSTEM",
    description: "Pipeline complete. KYC verified, payment settled, proof generated.",
    proofHash: proof.proofHash,
  });

  return { proofHash: proof.proofHash };
}
