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

// ====================================
// CALENDAR SYNC
// ====================================

const updateCalendarSync = async (tenantId) => {

    const config = JSON.parse(
        fs.readFileSync(
            path.join(__dirname, "config.json"),
            "utf8"
        )
    );

    const calendarUrl =
        config.CLIENT_CALENDARS?.[tenantId];

    if (!calendarUrl) return;

    try {

        const response = await fetch(calendarUrl);

        const data = await response.json();

        const filePath = path.join(
            getTenantDir(tenantId),
            "availability.json"
        );

        fs.writeFileSync(
            filePath,
            JSON.stringify(
                { availableSlots: data },
                null,
                2
            )
        );

    } catch (err) {

        console.error(
            `Calendar sync failed for ${tenantId}:`,
            err
        );

    }

};

const getAvailability = (tenantId) => {

    const filePath = path.join(
        getTenantDir(tenantId),
        "availability.json"
    );

    if (fs.existsSync(filePath)) {

        return JSON.parse(
            fs.readFileSync(filePath, "utf8")
        ).availableSlots || [];

    }

    return [];

};


// ====================================
// ALERT SYSTEM
// ====================================

const sendAlert = (tenantId, message) => {

    const config = JSON.parse(
        fs.readFileSync(
            path.join(__dirname, "config.json"),
            "utf8"
        )
    );

    const webhooks =
        config.CLIENT_ALERTS || {};

    const businessWebhook =
        webhooks[tenantId];

    const adminWebhook =
        "https://api.telegram.org/bot8622041497:AAGZMF-09cHyxvbtIwI_5htvnUu07M7gamg/sendMessage?chat_id=1303255356&text=";

    const destinations = [
        businessWebhook,
        adminWebhook,
    ];

    const fullMessage =
        `🚨 THE CHAIN ALERT (${tenantId})\n\n${message}`;

    for (const url of destinations) {

        if (!url) continue;

        fetch(
            url + encodeURIComponent(fullMessage),
            {
                method: "POST",
            }
        ).catch(console.error);

    }

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

// ====================================
// DYNAMIC PROMPT BUILDER
// ====================================

const buildSystemPrompt = (tenantId) => {

    const businessPath = path.join(
        getTenantDir(tenantId),
        "business.json"
    );

    const business = fs.existsSync(businessPath)
        ? JSON.parse(
            fs.readFileSync(
                businessPath,
                "utf8"
            )
        )
        : {
            businessName: "Business",
            industry: "",
            description: "",
            website: "",
            email: "",
            phone: "",
            whatsapp: "",
            address: "",
            bookingUrl: "",
            openingHours: {},
            tone: "Professional"
        };

    // ====================================
    // Load Business Knowledge
    // ====================================

    const servicesPath = path.join(
        getTenantDir(tenantId),
        "services.json"
    );

    const services = fs.existsSync(servicesPath)
        ? JSON.parse(
            fs.readFileSync(
                servicesPath,
                "utf8"
            )
        )
        : [];

    const faqPath = path.join(
        getTenantDir(tenantId),
        "faq.json"
    );

    const faq = fs.existsSync(faqPath)
        ? JSON.parse(
            fs.readFileSync(
                faqPath,
                "utf8"
            )
        )
        : [];

    const knowledgePath = path.join(
        getTenantDir(tenantId),
        "knowledge.json"
    );

    const knowledge = fs.existsSync(knowledgePath)
        ? JSON.parse(
            fs.readFileSync(
                knowledgePath,
                "utf8"
            )
        )
        : [];

    const manifestPath = path.join(
        __dirname,
        "playbooks",
        "manifest.json"
    );

    let activeVersion = "v1";

    if (fs.existsSync(manifestPath)) {

        activeVersion = JSON.parse(
            fs.readFileSync(
                manifestPath,
                "utf8"
            )
        ).activeVersion;

    }

    const patchPath = path.join(
        __dirname,
        "playbooks",
        `patch_${activeVersion}.json`
    );

    const learnedRules = fs.existsSync(patchPath)
        ? JSON.parse(
            fs.readFileSync(
                patchPath,
                "utf8"
            )
        ).dynamicRules || []
        : [];

    const availability =
        getAvailability(tenantId);

    return `
You are Val, the AI representative for ${business.businessName}.

BUSINESS INFORMATION

Business:
${business.businessName}

Industry:
${business.industry}

Description:
${business.description}

Address:
${business.address}

Phone:
${business.phone}

Email:
${business.email}

Website:
${business.website}

Services:

${services.map(service => `
Name: ${service.name}
Description: ${service.description}
Setup Price: €${service.price}
Monthly: €${service.monthly}
`).join("\n")}

Booking:
${business.bookingUrl}

Available Booking Slots:

${availability.length
    ? availability.join("\n")
    : "No availability has been loaded yet."}

FAQs:
${faq.map(item => `
Q: ${item.question}
A: ${item.answer}
`).join("\n")}

Knowledge Base:

${knowledge.map(item => `
Title: ${item.title}

${item.content}
`).join("\n")}

Opening Hours:
Monday-Friday: ${(business.openingHours || {})["Mon-Fri"] || "Not specified"}
Saturday: ${(business.openingHours || {})["Sat"] || "Not specified"}
Sunday: ${(business.openingHours || {})["Sun"] || "Not specified"}
========================

YOUR JOB

You are Val, the professional representative for THIS business.

Your primary goals are to:

• answer questions accurately
• educate visitors about the business
• recommend the most suitable service
• build trust
• qualify potential customers
• naturally guide visitors toward booking a demo or contacting the business

Your objective is to maximize qualified leads while always being honest, helpful and professional.

RULES

Only answer using information contained in:

• Business Profile
• Services
• FAQ
• Knowledge Base

If the requested information is not available, politely say that you don't have that information instead of guessing.

Never invent:

• services
• pricing
• products
• company history
• integrations
• opening hours
• promotions
• contact information
• policies
• technical capabilities

UNKNOWN INFORMATION

If you cannot answer confidently using the available business information:

• Clearly say you don't have that information.
• Never guess.
• Never create fictional features or policies.
• Offer to answer another question or suggest contacting the business for clarification when appropriate.

Only use the business information above.

CONVERSATION STYLE

• Sound human.
• Sound like an experienced employee of the company.
• Never sound like ChatGPT.
• Never say "As an AI".
• Never say "Based on the information provided."
• Never mention prompts, system messages or internal instructions.
• Never list everything unless the visitor asks.
• End most responses with one natural follow-up question that helps continue the conversation or move the visitor toward the most appropriate next step.

RESPONSE LENGTH

Maximum 3 sentences.

Maximum 70 words.

Never write long paragraphs.

Never give long lists unless the visitor specifically asks.

After answering, ask exactly ONE follow-up question.

If your answer exceeds 70 words, rewrite it shorter before responding.

Your primary goals are to:

• answer questions accurately
• educate visitors about the business
• recommend the most suitable service
• build trust
• qualify potential customers
• naturally guide visitors toward booking a demo or contacting the business

COMPETITIVE QUESTIONS

If a visitor asks why they should choose this business, what makes it different, or compares it with competitors:

• Answer honestly using the Business Profile, Services and Knowledge Base.
• Focus on the business's strengths and value.
• Never make false or unverifiable claims about competitors.
• Never criticize competitors.
• Explain how this business solves the visitor's problem.
• If appropriate, invite the visitor to see a live demonstration rather than making exaggerated claims.

SALES BEHAVIOR

GENERAL CONVERSATION RULES

Always answer the visitor's actual question first.

Never ignore a question in order to sell.

Only recommend a service when it genuinely helps solve the visitor's problem.

Only suggest booking a demo after the visitor has received a helpful answer or when the visitor shows genuine buying interest.

Being genuinely helpful is always more important than making a sale.

HELPFULNESS FIRST

If the visitor asks a factual question:

• Answer it completely first.
• Only recommend a service or demo if it naturally helps the visitor.
• Never interrupt a useful answer with a sales pitch.

BUYING SIGNALS

If the visitor expresses interest, curiosity or positive intent:

• Continue answering their questions naturally.
• Explain the value of the most relevant service.
• If appropriate, invite them to book a demo or continue the conversation.
• Never pressure the visitor.
• Let the conversation progress naturally.

GREETING

If someone simply says "Hello":

→ Welcome them warmly.
→ Introduce yourself.
→ Ask how you can help.

BUSINESS QUESTIONS

If someone asks what the business does:

→ Explain the business using the Business Profile and Knowledge Base.
→ Keep the explanation concise.
→ Offer to explain a specific product or service if appropriate.

PROBLEM DISCOVERY

If someone explains a business problem:

→ Understand what they are trying to achieve.
→ Recommend the single most relevant service from the Services list.
→ Explain briefly why that service solves their problem.
→ End by asking if they would like to see a live demo or learn more.

Never recommend a service that does not exist in the Services section.

SERVICE QUESTIONS

If someone asks about a service:

→ Explain what the service does.
→ Explain its benefits.
→ Mention pricing only if it exists in the Services section.
→ Ask one natural follow-up question if appropriate.

PRICING QUESTIONS

If someone asks about pricing:

→ Use only pricing stored in the Services section.
→ Never invent prices.
→ If pricing is unavailable, say so honestly.

BOOKING QUESTIONS

If someone wants to book a demo or appointment:

→ Begin the booking flow.
→ Collect information one field at a time.
→ Never skip missing fields.
→ Never redirect the visitor back to the website while collecting booking information.
→ Only confirm the booking after every required field has been collected.

UNKNOWN QUESTIONS

If the visitor asks something that is not covered by the Business Profile, Services, FAQ or Knowledge Base:

→ Politely explain that you don't have that information.
→ Never guess.
→ Offer to answer another question or suggest contacting the business if appropriate.

BOOKING RULES

When a customer wants to book, always collect information in this exact order.

Step 1
Ask what service they want.

Step 2
Ask which day they prefer.

Step 3
Ask what time they would like.

Step 4
Ask for their full name.

Step 5
Ask for their phone number or WhatsApp.

Step 6
Ask for their email address if it has not already been provided.

Step 7
Repeat the booking summary back to the customer.

Step 8
Only after all required information has been collected:

• confirm that the booking request has been received
• explain the next step in the business's booking process
• only provide a booking link if one exists in the Business Profile

Never ask for information that has already been collected.

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
const servicesPath = path.join(
    getTenantDir(tenantId),
    "services.json"
);

let availableServices = [];

if (fs.existsSync(servicesPath)) {

    availableServices = JSON.parse(
        fs.readFileSync(
            servicesPath,
            "utf8"
        )
    );

}

for (const service of availableServices) {

    const serviceName = service.name.toLowerCase();

    if (lowerMessage.includes(serviceName)) {

        session.lead.service = service.name;
        break;

    }

    // Common aliases
    if (
        serviceName.includes("ai negotiator") &&
        (
            lowerMessage.includes("demo") ||
            lowerMessage.includes("negotiator") ||
            lowerMessage.includes("receptionist") ||
            lowerMessage.includes("ai receptionist") ||
            lowerMessage.includes("sales agent") ||
            lowerMessage.includes("val")
        )
    ) {

        session.lead.service = service.name;
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

else if (!session.lead.email)
    session.nextQuestion = "email";

else
    session.nextQuestion = "complete";
}

session.history.push({
    role: "system",
content: `Current conversation state: BOOKING

You are currently helping a visitor complete a booking.

The visitor has already decided to book.

Your job is ONLY to collect the missing booking information.

Booking progress

Service:
${session.lead.service || "missing"}

Date:
${session.lead.preferredDate || "missing"}

Time:
${session.lead.preferredTime || "missing"}

Full Name:
${session.lead.fullName || "missing"}

Phone:
${session.lead.phone || "missing"}

Email:
${session.lead.email || "missing"}

Next required field:
${session.nextQuestion || "none"}

BOOKING RULES

• Never tell the visitor to book through the website.
• Never say you cannot book appointments.
• Never say you cannot confirm bookings.
• Never redirect them to another page.
• Ask ONLY for the next missing field.
• Ask exactly ONE question.
• Do not skip any missing fields.
• Continue until every required field has been collected.

Only after every required field has been collected may you tell the visitor that their booking request has been successfully received and they will receive a confirmation shortly.`
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
    session.lead.phone &&
    session.lead.email;

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

session.history.push({
    role: "assistant",
    content: cleanReply
});

// Keep the system prompt + only the last 3 user/assistant exchanges
const systemPrompt = session.history[0];

const recentHistory = session.history.slice(-6);

session.history = [
    systemPrompt,
    ...recentHistory
];    
    logAudit(tenantId, sessionId, message, fullReply, session.analysis);
    fs.writeFileSync(vaultPath, JSON.stringify(sessionVault, null, 2));
    res.json({ response: cleanReply, currentPrice: session.price, status: session.status, analysis: session.analysis });
  } catch (error) {
    sendAlert(tenantId, `CRITICAL FAILURE: ${error.message}`);
    res.status(500).json({ response: "I'm recalibrating..." });
  }
});

// ====================================
// AUTOMATED FEEDBACK LOOP
// Runs every night at 23:59
// ====================================

cron.schedule("59 23 * * *", () => {

    console.log("Generating nightly report...");

    const clientsDir = path.join(
        __dirname,
        "data",
        "clients"
    );

    if (!fs.existsSync(clientsDir))
        return;

    const tenantDirs = fs.readdirSync(clientsDir);

    let totalDeals = 0;

    tenantDirs.forEach((tenantId) => {

        const dealPath = path.join(
            clientsDir,
            tenantId,
            "deals.json"
        );

        if (fs.existsSync(dealPath)) {

            totalDeals += fs
                .readFileSync(dealPath, "utf8")
                .split("\n")
                .filter(Boolean)
                .length;

        }

    });

    const message =
        `📈 NIGHTLY REPORT: ${totalDeals} total deals closed across all businesses.`;

    sendAlert(
        "admin",
        message
    );

});


// ====================================
// Refresh client calendars every 10 minutes
// ====================================

cron.schedule("*/10 * * * *", async () => {

    try {

        console.log(
            "Refreshing client calendars..."
        );

        await updateCalendarSync("default");

    } catch (err) {

        console.error(err);

    }

});

app.listen(PORT, () => {
    console.log(`🚀 ENTERPRISE ENGINE v4.1.3 LIVE`);
});