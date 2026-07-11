// The Chain: AI Negotiator Engine v4.1.3 (Multi-Tenant Architecture + Strategy Versioning + Isolated Logging + Automated Dual Alerting)
require('dotenv').config(); 
const { Groq } = require('groq-sdk');
const express = require('express');
const cors = require('cors'); 
const fs = require("fs");
const path = require("path");
const cron = require('node-cron');

// Use the environment variable if available, otherwise use the fallback for local testing
const finalApiKey = process.env.GROQ_API_KEY || "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";
const groq = new Groq({ apiKey: finalApiKey });

const app = express();
app.use(cors({ origin: '*' })); 
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// DATA MANAGEMENT HELPERS
const getTenantDir = (tenantId = 'default') => {
    const dir = path.join(__dirname, 'data', tenantId);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
};

const getVaultPath = (tenantId = 'default') => path.join(getTenantDir(tenantId), "vault.json");

// THOUGHT BUFFER: Helper to simulate natural delay
const simulateThinking = () => {
    const delay = Math.floor(Math.random() * (2000 - 1000 + 1)) + 1000;
    return new Promise(resolve => setTimeout(resolve, delay));
};

// CALENDAR SYNC ENGINE: Self-hosted automated update
const updateCalendarSync = async (tenantId) => {
    const config = JSON.parse(fs.readFileSync(path.join(__dirname, "config.json"), "utf8"));
    const clinicUrl = config.CLINIC_CALENDARS?.[tenantId];
    if (!clinicUrl) return;

    try {
        const response = await fetch(clinicUrl);
        const data = await response.json();
        const filePath = path.join(getTenantDir(tenantId), "availability.json");
        fs.writeFileSync(filePath, JSON.stringify({ availableSlots: data }, null, 2));
    } catch (err) { console.error(`Sync failed for ${tenantId}:`, err); }
};

const getAvailability = (tenantId) => {
    const filePath = path.join(getTenantDir(tenantId), "availability.json");
    if (fs.existsSync(filePath)) {
        return JSON.parse(fs.readFileSync(filePath, "utf8")).availableSlots || [];
    }
    return ["Contact for availability"];
};

// ALERTING: Send ping to the specific clinic's webhook AND your admin channel
const sendAlert = (tenantId, message) => {
    const config = JSON.parse(fs.readFileSync(path.join(__dirname, "config.json"), "utf8"));
    const webhooks = config.CLINIC_ALERTS || {};
    const clinicWebhook = webhooks[tenantId];
    const adminWebhook = "https://api.telegram.org/bot8622041497:AAGZMF-09cHyxvbtIwI_5htvnUu07M7gamg/sendMessage?chat_id=1303255356&text=";
    
    const destinations = [clinicWebhook, adminWebhook];
    const fullMessage = `🚨 THE CHAIN ALERT for ${tenantId}: ${message}`;

    destinations.forEach(url => {
        if (!url) return;
        const fullUrl = url + encodeURIComponent(fullMessage);
        fetch(fullUrl, { method: 'POST' }).catch(err => console.error(`Failed to alert:`, err));
    });
};

// PHASE 4: Telemetry Node Configuration
const INITIAL_VAULT = {
  "client-xyz": { id: "client-xyz", name: "Sarah Jenkins", label: "Skincare Inquiry", price: 1000, status: "Active", history: [], analysis: { buyerProfile: "Analyzing...", objectionType: "None", concessionStep: "Baseline Stable" } },
  "client-abc": { id: "client-abc", name: "Marcus Vance", label: "Botox Consultation", price: 1200, status: "Active", history: [], analysis: { buyerProfile: "High Net Worth", objectionType: "None", concessionStep: "Baseline Stable" } },
  "client-123": { id: "client-123", name: "Elena Rostova", label: "Laser Resurfacing", price: 950, status: "Active", history: [], analysis: { buyerProfile: "Decisive Buyer", objectionType: "None", concessionStep: "Baseline Stable" } }
};

// Global Configs
const config = JSON.parse(fs.readFileSync(path.join(__dirname, "config.json"), "utf8"));
const { CONTRACT_RULES, TRAINING_ENABLED } = config;

// DYNAMIC PROMPT BUILDER
const buildSystemPrompt = (tenantId) => {
    const profilePath = path.join(getTenantDir(tenantId), "profile.json");
    const profile = fs.existsSync(profilePath) ? JSON.parse(fs.readFileSync(profilePath, "utf8")) : { businessName: "Our Clinic" };
    
    const manifestPath = path.join(__dirname, "playbooks", "manifest.json");
    let activeVersion = "v1"; 
    if (fs.existsSync(manifestPath)) {
        activeVersion = JSON.parse(fs.readFileSync(manifestPath, "utf8")).activeVersion;
    }

    const patchPath = path.join(__dirname, "playbooks", `patch_${activeVersion}.json`);
    let learnedRules = fs.existsSync(patchPath) ? JSON.parse(fs.readFileSync(patchPath, "utf8")).dynamicRules || [] : [];
    
    const availability = getAvailability(tenantId);

    return `
    You are the lead consultant for ${profile.businessName}. Strategy Version: ${activeVersion}.
    LEARNED STRATEGIES: ${learnedRules.join(" | ")}
    CONTEXT: ${JSON.stringify(profile)}
    
    CRITICAL OPERATIONAL PROTOCOL:
    1. EMPATHY FIRST: You are a medical consultant, not an automated booking bot. Always start by listening to the client's skincare problems or goals.
    2. PROBLEM-SOLUTION FRAMEWORK: If the client shares a concern, validate it first ("I understand why that's frustrating..."), then offer a professional perspective, and ONLY THEN suggest a treatment solution.
    3. NO CALENDAR SPAMMING: Do NOT suggest appointment times unless the client explicitly asks "When can I come in?" or "What is your availability?". Stop offering times in your opening or mid-conversation turns.
    4. PRICING & LISTS: Never mention price unless explicitly asked. When providing lists (services, prices), use new lines (\\n) and bullet points for clean readability.
    5. LINGUISTIC: Max 2 sentences, 1 engaging follow-up question.
    6. NO REPETITION: Never repeat a previous response. If asked a similar question, rephrase.
    7. INTERNAL TAGS: Always end with: [[ PROFILE: <Type> | OBJECTION: <Vector> | CONCESSION: <Step> ]]
    8. PRIVACY NOTICE: Log all interactions for internal quality and training purposes.
    `;
};

// Logger: Records successful closures per tenant
const logDealSuccess = (tenantId, session) => {
    const successEntry = { timestamp: new Date().toISOString(), client: session.name, finalPrice: session.price, analysis: session.analysis };
    fs.appendFileSync(path.join(getTenantDir(tenantId), "deals.json"), JSON.stringify(successEntry) + "\n");
};

// Audit Logger
const logAudit = (tenantId, sessionId, input, output, analysis) => {
    const auditEntry = { timestamp: new Date().toISOString(), sessionId, input, output, analysis };
    fs.appendFileSync(path.join(getTenantDir(tenantId), "audit.json"), JSON.stringify(auditEntry) + "\n");
};

// API ENDPOINTS
app.get('/api/clients', (req, res) => {
    const tenantId = req.headers['x-tenant-id'] || 'default';
    const vaultPath = getVaultPath(tenantId);
    let sessionVault = fs.existsSync(vaultPath) ? JSON.parse(fs.readFileSync(vaultPath, "utf8")) : INITIAL_VAULT;
    if (!fs.existsSync(vaultPath)) fs.writeFileSync(vaultPath, JSON.stringify(sessionVault, null, 2));
    res.json(Object.values(sessionVault).map(c => ({ id: c.id, name: c.name, label: c.label, price: c.price, status: c.status, analysis: c.analysis })));
});

app.post('/api/webhook/whatsapp', async (req, res) => {
    console.log(`📥 [TELEMETRY NODE]: Incoming packet: ${JSON.stringify(req.body)}`);
    res.sendStatus(200);
});

app.post('/api/webhook', async (req, res) => {
    console.log(`🌐 [CRM WEBHOOK]: Incoming payload from CRM: ${JSON.stringify(req.body)}`);
    res.status(200).json({ status: "success", message: "Payload received by The Chain" });
});

app.post('/api/override', (req, res) => {
    const tenantId = req.headers['x-tenant-id'] || 'default';
    const vaultPath = getVaultPath(tenantId);
    const sessionVault = JSON.parse(fs.readFileSync(vaultPath, "utf8"));
    const { sessionId, mode } = req.body;
    if (sessionVault[sessionId]) {
        sessionVault[sessionId].status = mode === 'HUMAN' ? 'Manual Override' : 'Active';
        fs.writeFileSync(vaultPath, JSON.stringify(sessionVault, null, 2));
        res.json({ success: true, status: sessionVault[sessionId].status });
    } else { res.status(400).json({ error: "Session missing." }); }
});

app.post('/api/chat', async (req, res) => {
  await simulateThinking();
  const tenantId = req.headers['x-tenant-id'] || 'default';
  
  await updateCalendarSync(tenantId);

  const vaultPath = getVaultPath(tenantId);
  if (!fs.existsSync(vaultPath)) fs.writeFileSync(vaultPath, JSON.stringify(INITIAL_VAULT, null, 2));
  
  const sessionVault = JSON.parse(fs.readFileSync(vaultPath, "utf8"));
  const { sessionId, message } = req.body;
  if (!sessionVault[sessionId]) return res.status(400).json({ error: "Session missing." });

  const session = sessionVault[sessionId];
  
  if(session.history.length === 0 || session.history[0].role !== 'system') {
      session.history = [{ role: 'system', content: buildSystemPrompt(tenantId) }];
  } else {
      session.history[0].content = buildSystemPrompt(tenantId);
  }

  if (session.status === 'Manual Override') {
      if (TRAINING_ENABLED === true) {
          const trainingEntry = { previousContext: session.history.slice(-3), humanCorrection: message, timestamp: new Date().toISOString() };
          fs.appendFileSync(path.join(getTenantDir(tenantId), "training_data.json"), JSON.stringify(trainingEntry) + "\n");
      }
      session.history.push({ role: 'user', content: `[HUMAN]: ${message}` });
      fs.writeFileSync(vaultPath, JSON.stringify(sessionVault, null, 2));
      return res.json({ response: "", currentPrice: session.price, status: session.status, analysis: session.analysis });
  }

  session.history.push({ role: 'user', content: message });
  try {
    const response = await groq.chat.completions.create({ model: "llama-3.1-8b-instant", messages: session.history, temperature: 0.5 });
    let fullReply = response.choices[0].message.content;
    
    const metaMatch = fullReply.match(/\[\[\s*PROFILE:\s*(.*?)\s*\|\s*OBJECTION:\s*(.*?)\s*\|\s*CONCESSION:\s*(.*?)\s*\]\]/);
    if (metaMatch) session.analysis = { buyerProfile: metaMatch[1], objectionType: metaMatch[2], concessionStep: metaMatch[3] };
    
    let cleanReply = fullReply.replace(/\[\[.*?\]\]/g, '').replace(/\[DEAL_AGREED\]|\[BOOKING_CONFIRMED\]/g, '').trim();

    if (session.price < CONTRACT_RULES.absoluteFloor) sendAlert(tenantId, `Price below floor!`);
    
    if (fullReply.includes("[DEAL_AGREED]")) {
        const num = fullReply.match(/\d+/);
        if (num) session.price = Math.max(parseInt(num[0]), CONTRACT_RULES.absoluteFloor);
    }

    if (fullReply.includes("[BOOKING_CONFIRMED]")) {
        session.status = "Committed";
        logDealSuccess(tenantId, session);
    }

    session.history.push({ role: 'assistant', content: fullReply });
    if (session.history.length > 20) session.history = [session.history[0], ...session.history.slice(-10)];
    
    logAudit(tenantId, sessionId, message, fullReply, session.analysis);
    fs.writeFileSync(vaultPath, JSON.stringify(sessionVault, null, 2));
    res.json({ response: cleanReply, currentPrice: session.price, status: session.status, analysis: session.analysis });
  } catch (error) {
    sendAlert(tenantId, `CRITICAL FAILURE: ${error.message}`);
    res.status(500).json({ response: "I'm recalibrating..." });
  }
});

// AUTOMATED FEEDBACK LOOP: Runs at 11:59 PM every night
cron.schedule('59 23 * * *', () => {
    console.log("Generating nightly report...");
    const dataPath = path.join(__dirname, 'data');
    if (!fs.existsSync(dataPath)) return;
    
    const tenantDirs = fs.readdirSync(dataPath);
    let totalDeals = 0;
    
    tenantDirs.forEach(tenant => {
        const dealPath = path.join(dataPath, tenant, 'deals.json');
        if (fs.existsSync(dealPath)) {
            const deals = fs.readFileSync(dealPath, 'utf8').split('\n').filter(Boolean);
            totalDeals += deals.length;
        }
    });

    const message = `📈 NIGHTLY REPORT: ${totalDeals} total deals closed across all clinics.`;
    sendAlert('admin', message);
});

app.listen(PORT, () => console.log(`🚀 ENTERPRISE ENGINE v4.1.3 LIVE`));