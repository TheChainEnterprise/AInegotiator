// The Chain: AI Negotiator Engine v4.1.3 (Multi-Tenant Architecture + Strategy Versioning + Isolated Logging + Automated Dual Alerting)
require('dotenv').config(); 
const { Groq } = require('groq-sdk');
const express = require('express');
const cors = require('cors'); 
const fs = require("fs");
const cron = require("node-cron");
const path = require("path");
const {
    getTenantDir,
    getVaultPath,
} = require("./engine/tenants");

// Use the environment variable if available, otherwise use the fallback for local testing
const finalApiKey = process.env.GROQ_API_KEY || "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";
const groq = new Groq({ apiKey: finalApiKey });

const app = express();
app.use(cors({ origin: '*' })); 
const PORT = process.env.PORT || 3001;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

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
You are Val, the AI Receptionist for ${profile.businessName}.

BUSINESS INFORMATION

Business:
${profile.businessName}

Industry:
${profile.industry}

Description:
${profile.description}

Location:
${profile.location}

Phone:
${profile.phone}

Website:
${profile.website}

Services:
• ${(profile.services || []).join("\n• ")}

Booking:
${profile.bookingUrl}

Opening Hours:
Monday-Friday: ${(profile.openingHours || {})["Mon-Fri"] || "Not specified"}
Saturday: ${(profile.openingHours || {})["Sat"] || "Not specified"}
Sunday: ${(profile.openingHours || {})["Sun"] || "Not specified"}
========================

YOUR JOB

You are Val, the professional receptionist for THIS business.

Your primary goal is to help the visitor, answer accurately, build trust and naturally guide them toward becoming a customer.

RULES

• Never invent services.
• Never invent prices.
• Never invent opening hours.
• Never invent promotions.
• Never invent treatments.

Only use the business information above.

CONVERSATION STYLE

• Sound human.
• Never sound like ChatGPT.
• Never say "As an AI".
• Never say "Based on the information provided."
• Never list everything unless the visitor asks.

RESPONSE LENGTH

Maximum 3 sentences.

Maximum 70 words.

Never write long paragraphs.

Never give long lists unless the visitor specifically asks.

After answering, ask exactly ONE follow-up question.

If your answer exceeds 70 words, rewrite it shorter before responding.

SALES BEHAVIOR

If someone simply says "Hello":

→ Welcome them warmly.
→ Introduce yourself.
→ Ask what brings them in today.

If someone explains a problem:

→ Show empathy.
→ Recommend the most relevant service.
→ Explain why it helps.

If someone asks about a service:

→ Explain it simply.
→ Mention benefits.
→ Ask if they'd like to book.

If someone asks about booking:

→ Use the booking URL above.
→ Mention opening hours.
→ Offer further assistance.

BOOKING RULES

When a customer wants to book, always collect information in this exact order.

Step 1
Ask what treatment they want.

Step 2
Ask which day they prefer.

Step 3
Ask what time they would like.

Step 4
Ask for their full name.

Step 5
Ask for their phone number or WhatsApp.

Step 6
Repeat the booking summary back to the customer.

Step 7
Only after all information has been collected, provide the booking link or explain the next booking step.

Never skip a step.

Never ask more than ONE question in a single message.

If any information is still missing, ask only for the next missing item.

Ask exactly ONE question at a time.

If someone asks something unrelated to this business:

Politely explain that you only assist with this business.

Never repeat the same wording twice during one conversation.

Always finish with:

[[ PROFILE: <Type> | OBJECTION: <Vector> | CONCESSION: <Step> ]]
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

app.get('/api/leads', (req, res) => {
    const tenantId = req.headers['x-tenant-id'] || 'default';

    const leadsPath = path.join(getTenantDir(tenantId), "leads.json");

    if (!fs.existsSync(leadsPath)) {
        return res.json([]);
    }

    const lines = fs
        .readFileSync(leadsPath, "utf8")
        .split("\n")
        .filter(line => line.trim() !== "");

    const leads = lines
        .map(line => {
            try {
                return JSON.parse(line);
            } catch {
                return null;
            }
        })
        .filter(Boolean);

    res.json(leads.reverse());
});

app.get('/api/clients', (req, res) => {
    const tenantId = req.headers['x-tenant-id'] || 'default';

    const vaultPath = getVaultPath(tenantId);

    let sessionVault = fs.existsSync(vaultPath)
        ? JSON.parse(fs.readFileSync(vaultPath, "utf8"))
        : INITIAL_VAULT;

    if (!fs.existsSync(vaultPath)) {
        fs.writeFileSync(
            vaultPath,
            JSON.stringify(sessionVault, null, 2)
        );
    }

    res.json(
        Object.values(sessionVault).map(c => ({
            id: c.id,
            name: c.name,
            label: c.label,
            price: c.price,
            status: c.status,
            analysis: c.analysis
        }))
    );
});

app.post('/api/webhook/whatsapp', async (req, res) => {    console.log(`📥 [TELEMETRY NODE]: Incoming packet: ${JSON.stringify(req.body)}`);
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
console.log("TENANT:", req.headers['x-tenant-id']);
  await simulateThinking();
  const tenantId = req.headers['x-tenant-id'] || 'default';
  

  const vaultPath = getVaultPath(tenantId);
  if (!fs.existsSync(vaultPath)) fs.writeFileSync(vaultPath, JSON.stringify(INITIAL_VAULT, null, 2));
  
const sessionVault = JSON.parse(fs.readFileSync(vaultPath, "utf8"));

const { sessionId, message } = req.body;
const lowerMessage = message.toLowerCase();

// Automatically create a visitor session
if (!sessionVault[sessionId]) {

sessionVault[sessionId] = {
    id: sessionId,
    name: "Website Visitor",
    label: "Website Chat",
    price: 0,
    status: "Active",

    lead: {
        fullName: "",
        phone: "",
        email: "",
        service: "",
        preferredDate: "",
        preferredTime: ""
    },

    conversationState: "DISCUSSION",

    history: [],

    analysis: {
        buyerProfile: "Unknown",
        objectionType: "Unknown",
        concessionStep: "None"
    }
};
    fs.writeFileSync(
        vaultPath,
        JSON.stringify(sessionVault, null, 2)
    );

    console.log("🆕 Created visitor session:", sessionId);
}

const session = sessionVault[sessionId];
const lastUser = message.toLowerCase();

if (lastUser.includes("book")) {
    session.conversationState = "BOOKING";
}
else if (
    lastUser.includes("price") ||
    lastUser.includes("cost") ||
    lastUser.includes("how much")
) {
    session.conversationState = "PRICING";
}
else if (
    lastUser.includes("acne") ||
    lastUser.includes("wrinkles") ||
    lastUser.includes("skin") ||
    lastUser.includes("problem")
) {
    session.conversationState = "CONSULTATION";
}
else {
    session.conversationState = "DISCUSSION";
}
// ================================
// Automatic Lead Extraction v4.2.1
// ================================

if (!session.lead) {
    session.lead = {
        fullName: "",
        phone: "",
        email: "",
        service: "",
        preferredDate: "",
        preferredTime: ""
    };
}

// Email
const emailMatch = message.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
if (emailMatch) {
    session.lead.email = emailMatch[0];
}

// Phone
const phoneMatch = message.match(/\+?[0-9][0-9\s\-]{7,}/);
if (phoneMatch) {
    session.lead.phone = phoneMatch[0];
}

// Full Name
const nameMatch = message.match(
    /(?:my name is|i am|i'm)\s+([A-Za-z]+(?:\s+[A-Za-z]+)+)/i
);

if (nameMatch) {
    session.lead.fullName = nameMatch[1];
}

// Services
const services = [
    "botox",
    "dermal fillers",
    "laser hair removal",
    "chemical peel",
    "hydrafacial",
    "microneedling"
];

for (const service of services) {
    if (lowerMessage.includes(service)) {
        session.lead.service = service;
        break;
    }
}

// Weekdays
const weekdays = [
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
    "sunday"
];

for (const day of weekdays) {
    if (lowerMessage.includes(day)) {
        session.lead.preferredDate = day;
        break;
    }
}
// Time
const timeMatch = message.match(
    /\b([01]?\d|2[0-3])(?::([0-5]\d))?\s?(am|pm)?\b/i
);

if (timeMatch) {
    session.lead.preferredTime = timeMatch[0];
}
  
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
// ================================
// Booking Progress Tracker
// ================================

session.nextQuestion = null;

if (session.conversationState === "BOOKING") {

    if (!session.lead.service)
        session.nextQuestion = "service";

    else if (!session.lead.preferredDate)
        session.nextQuestion = "preferredDate";

    else if (!session.lead.preferredTime)
        session.nextQuestion = "preferredTime";

    else if (!session.lead.fullName)
        session.nextQuestion = "fullName";

    else if (!session.lead.phone)
        session.nextQuestion = "phone";

    else
        session.nextQuestion = "complete";
}

session.history.push({
    role: "system",
    content:
`Current conversation state: ${session.conversationState}

Booking progress

Service: ${session.lead.service || "missing"}
Date: ${session.lead.preferredDate || "missing"}
Time: ${session.lead.preferredTime || "missing"}
Name: ${session.lead.fullName || "missing"}
Phone: ${session.lead.phone || "missing"}

Next required field:
${session.nextQuestion || "none"}

Never confirm a booking while any field above is marked "missing".

Ask only for the next required field.

Do not skip steps.

Do not provide the booking link until every field has been collected.`
});
    const response = await groq.chat.completions.create({ model: "llama-3.1-8b-instant", messages: session.history, temperature: 0.5 });
    let fullReply = response.choices[0].message.content; 
console.log("========== AI REPLY ==========");
console.log(fullReply);
console.log("==============================");
    
const metaMatch = fullReply.match(
    /\[\[\s*PROFILE:\s*(.*?)\s*\|\s*OBJECTION:\s*(.*?)\s*\|\s*CONCESSION:\s*(.*?)\s*\]\]/
);

if (metaMatch) {
    session.analysis = {
        buyerProfile: metaMatch[1],
        objectionType: metaMatch[2],
        concessionStep: metaMatch[3]
    };
}


let cleanReply = fullReply
    .replace(/\[\[.*?\]\]/g, "")
    .replace(/\[DEAL_AGREED\]|\[BOOKING_CONFIRMED\]/g, "")
    .trim();

const bookingComplete =
    session.lead.service &&
    session.lead.preferredDate &&
    session.lead.preferredTime &&
    session.lead.fullName &&
    session.lead.phone;

if (!bookingComplete) {
    cleanReply = cleanReply
        .replace(/booking\s+is\s+confirmed/gi, "booking is almost complete")
        .replace(/confirmed/gi, "almost complete");
}

if (bookingComplete && !session.lead.saved) {

    session.lead.saved = true;

    fs.appendFileSync(
        path.join(getTenantDir(tenantId), "leads.json"),
        JSON.stringify({
            timestamp: new Date().toISOString(),
            ...session.lead
        }) + "\n"
    );
}

// Hard response limiter
const sentences = cleanReply.match(/[^.!?]+[.!?]+/g);

if (sentences && sentences.length > 3) {
    cleanReply = sentences.slice(0, 3).join(" ").trim();
}

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


// Refresh clinic calendar every 10 minutes
cron.schedule("*/10 * * * *", async () => {
    try {
        console.log("Refreshing clinic calendars...");
        await updateCalendarSync("default");
    } catch (err) {
        console.error(err);
    }
});


app.listen(PORT, () => {
    console.log(`🚀 ENTERPRISE ENGINE v4.1.3 LIVE`);
});