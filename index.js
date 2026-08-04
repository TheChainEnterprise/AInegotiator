// The Chain: AI Negotiator Engine v5.0 (MongoDB-backed storage — persists across restarts)
require('dotenv').config();
const { Groq } = require('groq-sdk');
const express = require('express');
const cors = require('cors');
const fs = require("fs");
const cron = require("node-cron");
const path = require("path");

// CHANGED: connectDB starts the shared database connection at server startup
const { connectDB } = require("./engine/db");

// CHANGED: these are now async, MongoDB-backed functions instead of filesystem paths
const {
    getTenantFile,
    setTenantFile,
    deleteTenantFile,
    deleteTenantData,
    appendTenantLog,
    getTenantLog,
    updateTenantLogEntry,
    deleteTenantLogEntry,
    listTenantIds,
} = require("./engine/tenants");

const {
    retrieveRelevantKnowledge,
} = require("./engine/retrieval");

const {
    crawlWebsite,
} = require("./engine/crawler");

const {
    processWebsiteContent,
} = require("./engine/importProcessor");

const whatsappRoutes = require("./routes/whatsapp");
const { sendWhatsAppMessageForTenant } = require("./engine/whatsappRegistry");
const manualMessageRoutes = require("./routes/manualMessage");
const requireInboxAuth = manualMessageRoutes.requireInboxAuth;
const { getAuthUrl, handleOAuthCallback, isCalendarConnected, createCalendarEvent } = require("./engine/googleCalendar");

// Use the environment variable if available, otherwise use the fallback for local testing
const finalApiKey = process.env.GROQ_API_KEY || "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";
const groq = new Groq({ apiKey: finalApiKey });

const app = express();
app.use(cors({ origin: '*' }));
const PORT = process.env.PORT || 3001;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(whatsappRoutes);
app.use(manualMessageRoutes);

// THOUGHT BUFFER: Helper to simulate natural delay
const simulateThinking = () => Promise.resolve();

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

        // CHANGED: was fs.writeFileSync to availability.json
        await setTenantFile(tenantId, "availability.json", { availableSlots: data });

    } catch (err) {

        console.error(
            `Calendar sync failed for ${tenantId}:`,
            err
        );

    }

};

// CHANGED: now async, reads from MongoDB instead of the filesystem
const getAvailability = async (tenantId) => {

    const doc = await getTenantFile(tenantId, "availability.json", { availableSlots: [] });
    return doc.availableSlots || [];

};

// ====================================
// ALERT SYSTEM
// ====================================
// Unchanged — config.json is a static file that ships with the code, not
// per-tenant runtime data, so it's fine to keep reading it from disk.

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

    const adminWebhook = process.env.TELEGRAM_ALERT_WEBHOOK;

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

// Global Configs — static, unchanged
const config = JSON.parse(fs.readFileSync(path.join(__dirname, "config.json"), "utf8"));
const { CONTRACT_RULES, TRAINING_ENABLED } = config;

// ====================================
// DYNAMIC PROMPT BUILDER
// ====================================
// CHANGED: this whole function is now async, since it reads tenant data from MongoDB

const buildSystemPrompt = async (
    tenantId,
    userMessage = ""
) => {

    const defaultBusiness = {
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

    // CHANGED: load business + services + faq + knowledge from MongoDB in parallel
    const [business, services, faq, knowledge] = await Promise.all([
        getTenantFile(tenantId, "business.json", defaultBusiness),
        getTenantFile(tenantId, "services.json", []),
        getTenantFile(tenantId, "faq.json", []),
        getTenantFile(tenantId, "knowledge.json", [])
    ]);

    // ====================================
    // Load Business Knowledge
    // ====================================
    // CHANGED: retrieval.js no longer touches disk itself — we pass the
    // already-loaded arrays straight in.

    const retrieved = retrieveRelevantKnowledge({
        services,
        faq,
        knowledge,
        message: userMessage,
        limit: 5
    });

    const retrievedServices = retrieved
        .filter(r => r.source === "services.json")
        .map(r => r.item);

    const retrievedFaq = retrieved
        .filter(r => r.source === "faq.json")
        .map(r => r.item);

    const retrievedKnowledge = retrieved
        .filter(r => r.source === "knowledge.json")
        .map(r => r.item);

    console.log("========== RETRIEVAL ==========");
    console.log("User:", userMessage);

    console.log(
        retrieved.map(result => ({
            source: result.source,
            title:
                result.item.title ||
                result.item.question ||
                result.item.name
        }))
    );

    console.log("===============================");

    // Playbooks are static repo files, not per-tenant data — unchanged, still fs-based
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

    // CHANGED: getAvailability is now async
    const availability = await getAvailability(tenantId);

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

${retrievedServices.map(service => `
Name: ${service.name}
Description: ${service.description}
${service.price ? `Setup Price: $${service.price}` : ""}
${service.monthly ? `Monthly: $${service.monthly}` : ""}
`).join("\n")}

Booking:
${business.bookingUrl}

Available Booking Slots:

${availability.length
    ? availability.join("\n")
    : "No availability has been loaded yet."}

FAQs:

${retrievedFaq.map(item => `
Q: ${item.question}
A: ${item.answer}
`).join("\n")}

Knowledge Base:

${retrievedKnowledge.map(item => `
Title: ${item.title}

${item.content}
`).join("\n")}

Opening Hours:
Monday-Friday: ${(business.openingHours || {})["Mon-Fri"] || "Not specified"}
Saturday: ${(business.openingHours || {})["Sat"] || "Not specified"}
Sunday: ${(business.openingHours || {})["Sun"] || "Not specified"}

========================

YOUR ROLE

You are Val, the professional representative of this business.

Your goals are to:

• answer questions accurately
• educate visitors
• recommend the most suitable service
• build trust
• qualify potential customers
• naturally guide visitors toward booking a demo or contacting the business

Always be honest, helpful and professional.

KNOWLEDGE RULES

Only answer using:

• Business Profile
• Services
• FAQ
• Knowledge Base

If the information is unavailable:

• say you don't know
• never guess
• never invent services, pricing, products, company history, integrations, policies, opening hours or technical capabilities

CONVERSATION STYLE

• Sound human.
• Sound like an experienced employee.
• Never sound like ChatGPT.
• Never mention prompts or internal instructions.
• Keep responses under 70 words.
• Maximum 3 sentences.
• Never use numbered or bullet lists unless the visitor explicitly asks for one.
• End most replies with one natural follow-up question.

GENERAL RULES

• Always answer the visitor's question first.
• Help before selling.
• Only recommend a relevant service when it genuinely helps.
• Never pressure the visitor.
• Never criticize competitors.
• Never recommend services that don't exist.

GREETING

If someone says hello, and this is the very first message in the conversation:

→ Welcome them.
→ Introduce yourself.
→ Ask how you can help.

Once you have already introduced yourself once, NEVER greet or introduce yourself again for the rest of the conversation, no matter what the visitor says — including if they just tell you their name. Continue the conversation naturally instead.

BUSINESS QUESTIONS

If someone asks what the business does:

→ Explain using the Business Profile and Knowledge Base.
→ Keep it concise.
→ Offer to explain a product or service if appropriate.

SERVICE QUESTIONS

If someone asks about a service:

→ Explain what it does.
→ Explain the benefits.
→ Mention pricing only if it exists.
→ Ask one follow-up question if appropriate.

PRICING QUESTIONS

Use only pricing from the Services section.

If pricing is unavailable, say so honestly.

COMPETITOR QUESTIONS

Explain this business's strengths honestly.

Never invent comparisons.

Never make false claims.

BOOKING QUESTIONS

If someone wants to book:

→ Begin the booking flow.
→ Collect one missing field at a time.
→ Never redirect them back to the website.
→ Only confirm once every required field has been collected.

BOOKING ORDER

1. Service
2. Date
3. Time
4. Full Name
5. Phone / WhatsApp
6. Email (if missing)
7. Repeat booking summary
8. Confirm booking request and explain the next step.

Never ask for information already collected.

Always ask exactly one question.

Always finish with:

[[ PROFILE: <Type> | OBJECTION: <Vector> | CONCESSION: <Step> ]]
`;
};

// CHANGED: now async — appends to MongoDB instead of a local file
const logDealSuccess = async (tenantId, session) => {
    const successEntry = { timestamp: new Date().toISOString(), client: session.name, finalPrice: session.price, analysis: session.analysis };
    await appendTenantLog(tenantId, "deals.json", successEntry);
};

// CHANGED: now async — appends to MongoDB instead of a local file
const logAudit = async (tenantId, sessionId, input, output, analysis) => {
    const auditEntry = { timestamp: new Date().toISOString(), sessionId, input, output, analysis };
    await appendTenantLog(tenantId, "audit.json", auditEntry);
};

// API ENDPOINTS

// CHANGED: every route below is now async and uses the MongoDB-backed helpers
// instead of fs.readFileSync / fs.writeFileSync / fs.appendFileSync.

app.get('/api/leads', async (req, res) => {
    const tenantId = req.headers['x-tenant-id'] || 'default';
    const leads = await getTenantLog(tenantId, "leads.json");
    res.json(leads);
});

app.delete("/api/leads/:id", async (req, res) => {
    const tenantId = req.headers["x-tenant-id"] || "default";
    const targetId = Number(req.params.id);
    await deleteTenantLogEntry(tenantId, "leads.json", targetId);
    res.json({ success: true });
});

app.post("/api/leads", async (req, res) => {
    const tenantId = req.headers["x-tenant-id"] || "default";
    const lead = {
        id: Date.now(),
        ...req.body
    };
    await appendTenantLog(tenantId, "leads.json", lead);
    res.json({ success: true, lead });
});

app.put("/api/leads/:id", async (req, res) => {
    const tenantId = req.headers["x-tenant-id"] || "default";
    const targetId = Number(req.params.id);

    // Force the existing id to be kept, same as the original behavior
    const { id, ...updates } = req.body;

    const updated = await updateTenantLogEntry(tenantId, "leads.json", targetId, updates);

    if (!updated) return res.status(404).json({ error: "Lead not found" });

    res.json({ success: true });
});

app.get("/api/bookings", async (req, res) => {
    const tenantId = req.headers["x-tenant-id"] || "default";
    const bookings = await getTenantLog(tenantId, "bookings.json");
    res.json(bookings);
});

app.post("/api/bookings", async (req, res) => {
    const tenantId = req.headers["x-tenant-id"] || "default";
    const booking = {
        id: Date.now(),
        ...req.body
    };
    await appendTenantLog(tenantId, "bookings.json", booking);
    res.json({ success: true, booking });
});

app.delete("/api/bookings/:id", async (req, res) => {
    const tenantId = req.headers["x-tenant-id"] || "default";
    const targetId = Number(req.params.id);
    await deleteTenantLogEntry(tenantId, "bookings.json", targetId);
    res.json({ success: true });
});

app.put("/api/bookings/:id", async (req, res) => {
    const tenantId = req.headers["x-tenant-id"] || "default";
    const targetId = Number(req.params.id);

    const { id, ...updates } = req.body;

    const updated = await updateTenantLogEntry(tenantId, "bookings.json", targetId, updates);

    if (!updated) return res.status(404).json({ error: "Booking not found." });

    res.json({ success: true, booking: updated });
});

// ====================================
// ADMIN CLIENT MANAGEMENT
// ====================================

app.get("/api/admin/clients", async (req, res) => {

    const tenantIds = await listTenantIds();

    const clients = await Promise.all(
        tenantIds.map(async (tenantId) => {
            const business = await getTenantFile(tenantId, "business.json", null);
            if (!business) return null;
            return { id: tenantId, ...business };
        })
    );

    res.json(clients.filter(Boolean));

});

app.post("/api/admin/clients", async (req, res) => {

    const {
        id,
        businessName,
        industry,
        website,
        email,
        phone
    } = req.body;

    if (!id || !businessName) {
        return res.status(400).json({
            error: "Missing client information."
        });
    }

    const existing = await getTenantFile(id, "business.json", null);

    if (existing) {
        return res.status(409).json({
            error: "Client already exists."
        });
    }

    await setTenantFile(id, "business.json", {
        businessName,
        industry,
        website,
        email,
        phone,
        description: "",
        address: "",
        whatsapp: phone,
        bookingUrl: "",
        tone: "Professional",
        openingHours: {}
    });

    await setTenantFile(id, "services.json", []);
    await setTenantFile(id, "faq.json", []);
    await setTenantFile(id, "knowledge.json", []);
    await setTenantFile(id, "availability.json", { availableSlots: [] });
    await setTenantFile(id, "vault.json", {});

    // Note: leads/bookings/audit/deals need no setup — getTenantLog
    // simply returns an empty array until the first entry is appended.

    res.json({
        success: true
    });

});

app.delete("/api/admin/clients/:id", async (req, res) => {

    const existing = await getTenantFile(req.params.id, "business.json", null);

    if (!existing) {
        return res.status(404).json({
            error: "Client not found."
        });
    }

    await deleteTenantData(req.params.id);

    res.json({
        success: true
    });

});

// ====================================
// ADMIN BUSINESS PROFILE
// ====================================

app.get("/api/admin/profile", async (req, res) => {

    const tenantId = req.headers["x-tenant-id"] || "default";

    const business = await getTenantFile(tenantId, "business.json", {
        businessName: "",
        industry: "",
        description: "",
        website: "",
        email: "",
        phone: "",
        whatsapp: "",
        address: "",
        bookingUrl: "",
        tone: "Professional",
        openingHours: {}
    });

    res.json(business);

});

app.post("/api/admin/profile", async (req, res) => {

    const tenantId = req.headers["x-tenant-id"] || "default";

    await setTenantFile(tenantId, "business.json", req.body);

    res.json({
        success: true
    });

});

// ====================================
// ADMIN AI BEHAVIOUR
// ====================================

app.get("/api/admin/behaviour", async (req, res) => {

    const tenantId = req.headers["x-tenant-id"] || "default";

    const behaviour = await getTenantFile(tenantId, "behaviour.json", {
        personality: "Professional",
        responseLength: "Short",
        emojiUsage: false,
        salesStyle: "Balanced",
        humor: false,
        greeting: "",
        closing: "",
        customInstructions: ""
    });

    res.json(behaviour);

});

app.post("/api/admin/behaviour", async (req, res) => {

    const tenantId = req.headers["x-tenant-id"] || "default";

    await setTenantFile(tenantId, "behaviour.json", req.body);

    res.json({
        success: true
    });

});

// ====================================
// ADMIN FAQ
// ====================================

app.get("/api/admin/faq", async (req, res) => {

    const tenantId = req.headers["x-tenant-id"] || "default";

    const faq = await getTenantFile(tenantId, "faq.json", []);

    res.json(faq);

});

app.post("/api/admin/faq", async (req, res) => {

    const tenantId = req.headers["x-tenant-id"] || "default";

    await setTenantFile(tenantId, "faq.json", req.body);

    res.json({
        success: true
    });

});

// ====================================
// ADMIN SERVICES
// ====================================

app.get("/api/admin/services", async (req, res) => {

    const tenantId = req.headers["x-tenant-id"] || "default";

    const services = await getTenantFile(tenantId, "services.json", []);

    res.json(services);

});

app.post("/api/admin/services", async (req, res) => {

    const tenantId = req.headers["x-tenant-id"] || "default";

    await setTenantFile(tenantId, "services.json", req.body);

    res.json({ success: true });

});

// ====================================
// ADMIN KNOWLEDGE
// ====================================

app.get("/api/admin/knowledge", async (req, res) => {

    const tenantId = req.headers["x-tenant-id"] || "default";

    const knowledge = await getTenantFile(tenantId, "knowledge.json", []);

    res.json(knowledge);

});

app.post("/api/admin/knowledge", async (req, res) => {

    const tenantId = req.headers["x-tenant-id"] || "default";

    await setTenantFile(tenantId, "knowledge.json", req.body);

    res.json({ success: true });

});

// ====================================
// ADMIN INTEGRATIONS
// ====================================

app.get("/api/admin/integrations", async (req, res) => {

    const tenantId = req.headers["x-tenant-id"] || "default";

    const integrations = await getTenantFile(tenantId, "integrations.json", {
        enabled: false,
        provider: "google",
        calendarId: ""
    });

    res.json(integrations);

});

app.post("/api/admin/integrations", async (req, res) => {

    const tenantId = req.headers["x-tenant-id"] || "default";

    await setTenantFile(tenantId, "integrations.json", req.body);

    res.json({ success: true });

});

// ====================================
// ADMIN WEBSITE IMPORT
// ====================================

app.get("/api/admin/import", async (req, res) => {

    const tenantId = req.headers["x-tenant-id"] || "default";

    const importDoc = await getTenantFile(tenantId, "import.json", null);

    if (!importDoc) {
        return res.json({ exists: false });
    }

    res.json({
        exists: true,
        ...importDoc
    });

});

app.post("/api/admin/import", async (req, res) => {

    const tenantId = req.headers["x-tenant-id"] || "default";

    try {

        const website = req.body.website;

        if (!website) {
            return res.status(400).json({
                error: "Website URL is required."
            });
        }

        console.log(`Starting import for ${tenantId}: ${website}`);

        const pages = await crawlWebsite(website);

        const imported = await processWebsiteContent(pages);

        // Validate import before touching any client data

        if (
            !imported ||
            typeof imported !== "object" ||
            !imported.business ||
            !Array.isArray(imported.services) ||
            !Array.isArray(imported.faq) ||
            !Array.isArray(imported.knowledge)
        ) {
            throw new Error("Importer returned invalid data.");
        }

        // ---------- BUSINESS ----------

        const existingBusiness = await getTenantFile(tenantId, "business.json", {});

        const mergedBusiness = {
            ...existingBusiness
        };

        for (const [key, value] of Object.entries(imported.business)) {

            if (
                value &&
                String(value).trim() !== ""
            ) {
                mergedBusiness[key] = value;
            }

        }

        await setTenantFile(tenantId, "business.json", mergedBusiness);

        // ---------- SERVICES ----------

        const existingServices = await getTenantFile(tenantId, "services.json", []);

        const serviceMap = new Map();

        for (const service of existingServices) {

            if (!service?.name) continue;

            serviceMap.set(
                service.name.trim().toLowerCase(),
                { ...service }
            );

        }

        for (const service of imported.services) {

            if (!service?.name) continue;

            const key = service.name.trim().toLowerCase();

            const existing = serviceMap.get(key) || {};

            serviceMap.set(key, {

                ...existing,

                name: service.name || existing.name,

                description:
                    service.description?.trim()
                        ? service.description
                        : existing.description,

                price:
                    service.price?.toString().trim()
                        ? service.price
                        : existing.price,

                monthly:
                    service.monthly?.toString().trim()
                        ? service.monthly
                        : existing.monthly

            });

        }

        const mergedServices = [...serviceMap.values()];

        await setTenantFile(tenantId, "services.json", mergedServices);

        // ---------- FAQ ----------

        const existingFaq = await getTenantFile(tenantId, "faq.json", []);

        const faqMap = new Map();

        for (const item of existingFaq) {

            if (!item?.question) continue;

            faqMap.set(
                item.question.trim().toLowerCase(),
                { ...item }
            );

        }

        for (const item of imported.faq) {

            if (!item?.question) continue;

            const key = item.question.trim().toLowerCase();

            const existing = faqMap.get(key) || {};

            faqMap.set(key, {

                ...existing,

                question:
                    item.question || existing.question,

                answer:
                    item.answer?.trim()
                        ? item.answer
                        : existing.answer

            });

        }

        const mergedFaq = [...faqMap.values()];

        await setTenantFile(tenantId, "faq.json", mergedFaq);

        // ---------- KNOWLEDGE ----------

        const existingKnowledge = await getTenantFile(tenantId, "knowledge.json", []);

        const knowledgeMap = new Map();

        for (const article of existingKnowledge) {

            if (!article?.title) continue;

            knowledgeMap.set(
                article.title.trim().toLowerCase(),
                { ...article }
            );

        }

        for (const article of imported.knowledge) {

            if (!article?.title) continue;

            if (typeof article.content !== "string") {
                article.content = JSON.stringify(article.content ?? "");
            }

            if (typeof article.source !== "string") {
                article.source = "";
            }

            const key = article.title.trim().toLowerCase();

            const existing = knowledgeMap.get(key) || {};

            knowledgeMap.set(key, {

                ...existing,

                title:
                    article.title || existing.title,

                content:
                    typeof article.content === "string" &&
                    article.content.trim()
                        ? article.content
                        : existing.content,

                source:
                    typeof article.source === "string" &&
                    article.source.trim()
                        ? article.source
                        : existing.source

            });

        }

        const mergedKnowledge = [...knowledgeMap.values()];

        await setTenantFile(tenantId, "knowledge.json", mergedKnowledge);

        await setTenantFile(tenantId, "import.json", {
            website,
            status: "Imported",
            createdAt: new Date().toISOString()
        });

        res.json({
            success: true
        });

    } catch (err) {

        console.error(err);

        res.status(500).json({
            error: "Website import failed."
        });

    }

});

app.delete("/api/admin/import", async (req, res) => {

    const tenantId = req.headers["x-tenant-id"] || "default";

    await deleteTenantFile(tenantId, "import.json");

    res.json({ success: true });

});

// ====================================
// GOOGLE CALENDAR — real OAuth integration
// ====================================

app.get("/api/admin/calendar/connect", (req, res) => {
    const tenantId = req.headers["x-tenant-id"] || req.query.tenant || "default";
    const url = getAuthUrl(tenantId);
    res.json({ url });
});

app.get("/api/admin/calendar/oauth/callback", async (req, res) => {
    const { code, state } = req.query;
    const tenantId = state || "default";

    try {
        await handleOAuthCallback(code, tenantId);
        res.send(`
            <html>
                <body style="font-family:Arial;padding:40px;">
                    <h2>Google Calendar Connected</h2>
                    <p>You can close this window and return to your dashboard.</p>
                </body>
            </html>
        `);
    } catch (err) {
        console.error("Google Calendar OAuth error:", err);
        res.status(500).send("Failed to connect Google Calendar: " + err.message);
    }
});

app.get("/api/admin/calendar/list", async (req, res) => {
    const tenantId = req.headers["x-tenant-id"] || "default";
    const connected = await isCalendarConnected(tenantId);
    res.json({ connected });
});

// ====================================
// TELEMETRY CLIENT SESSIONS
// ====================================

app.get('/api/clients', async (req, res) => {
    const tenantId = req.headers['x-tenant-id'] || 'default';

    let sessionVault = await getTenantFile(tenantId, "vault.json", null);

    if (!sessionVault) {
        sessionVault = INITIAL_VAULT;
        await setTenantFile(tenantId, "vault.json", sessionVault);
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

app.post('/api/webhook/whatsapp', async (req, res) => {
    console.log(`📥 [TELEMETRY NODE]: Incoming packet: ${JSON.stringify(req.body)}`);
    res.sendStatus(200);
});

app.post('/api/webhook', async (req, res) => {
    console.log(`🌐 [CRM WEBHOOK]: Incoming payload from CRM: ${JSON.stringify(req.body)}`);
    res.status(200).json({ status: "success", message: "Payload received by The Chain" });
});

app.post('/api/override', async (req, res) => {
    const tenantId = req.headers['x-tenant-id'] || 'default';
    const sessionVault = await getTenantFile(tenantId, "vault.json", {});
    const { sessionId, mode } = req.body;
    if (sessionVault[sessionId]) {
        sessionVault[sessionId].status = mode === 'HUMAN' ? 'Manual Override' : 'Active';
        await setTenantFile(tenantId, "vault.json", sessionVault);
        res.json({ success: true, status: sessionVault[sessionId].status });
    } else {
        res.status(400).json({ error: "Session missing." });
    }
});

// Converts a captured weekday name + loose time string (e.g. "monday", "3pm")
// into real start/end ISO timestamps for the next occurrence of that weekday.
function parseBookingDateTime(dayName, timeStr) {
    const weekdays = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
    const targetDay = weekdays.indexOf((dayName || "").toLowerCase());
    if (targetDay === -1) return null;

    const now = new Date();
    let daysUntil = (targetDay - now.getDay() + 7) % 7;
    if (daysUntil === 0) daysUntil = 7;

    const targetDate = new Date(now);
    targetDate.setDate(now.getDate() + daysUntil);

    const match = (timeStr || "").match(/([01]?\d|2[0-3])(?::([0-5]\d))?\s?(am|pm)?/i);
    let hour = 10;
    let minute = 0;

    if (match) {
        hour = parseInt(match[1], 10);
        minute = match[2] ? parseInt(match[2], 10) : 0;
        const meridiem = match[3]?.toLowerCase();
        if (meridiem === "pm" && hour < 12) hour += 12;
        if (meridiem === "am" && hour === 12) hour = 0;
    }

    targetDate.setHours(hour, minute, 0, 0);

    const startTime = targetDate.toISOString();
    const endTime = new Date(targetDate.getTime() + 60 * 60 * 1000).toISOString();

    return { startTime, endTime };
}

// Executes a completed booking: saves it, tries to create the calendar event,
// and returns exactly what happened. The AI's own reply is NEVER trusted to
// know whether the booking actually succeeded — only this function decides that.
async function executeBooking(tenantId, lead, channel) {
    const bookingRecord = {
        timestamp: new Date().toISOString(),
        service: lead.service,
        date: lead.preferredDate,
        time: lead.preferredTime,
        fullName: lead.fullName,
        phone: lead.phone,
        email: lead.email,
        channel,
        calendarEventCreated: false
    };

    const parsedTime = parseBookingDateTime(lead.preferredDate, lead.preferredTime);

    if (parsedTime) {
        try {
            const calendarResult = await createCalendarEvent(tenantId, {
                summary: `${lead.service || "Appointment"} - ${lead.fullName}`,
                description: `Phone: ${lead.phone}\nEmail: ${lead.email}\nBooked via Val (${channel})`,
                startTime: parsedTime.startTime,
                endTime: parsedTime.endTime
            });

            if (calendarResult && !calendarResult.skipped && calendarResult.id) {
                bookingRecord.calendarEventCreated = true;
                bookingRecord.calendarEventId = calendarResult.id;
            }
        } catch (err) {
            console.error("Failed to create calendar event:", err);
        }
    }

    await appendTenantLog(tenantId, "bookings.json", bookingRecord);

    return bookingRecord;
}

// Reusable core engine function used by both website chat and WhatsApp
const processValMessage = async (tenantId, sessionId, messageText, channel = "website") => {

    let sessionVault = await getTenantFile(tenantId, "vault.json", null);
    if (!sessionVault) sessionVault = INITIAL_VAULT;

    const lowerMessage = messageText.toLowerCase();

    // Automatically create a visitor session if it doesn't exist
    if (!sessionVault[sessionId]) {
        sessionVault[sessionId] = {
            id: sessionId,
            name: "Visitor",
            label: "Chat",
            channel: channel,
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
    }

const session = sessionVault[sessionId];
    session.channel = channel;
    session.lastUpdated = new Date().toISOString();

    // Records the user's message + Val's reply into history, then returns the reply.
    // Used for every early-return path so the dashboard always shows the full conversation.
    const recordAndReturn = async (replyText) => {
        session.history.push({ role: "user", content: messageText });
        session.history.push({ role: "assistant", content: replyText });
        await setTenantFile(tenantId, "vault.json", sessionVault);
        return replyText;
    };

    // ====================================
    // HUMAN HANDOFF
    // ====================================

    const HUMAN_REQUEST_PATTERNS = [
        "real person",
        "human",
        "representative",
        "someone",
        "owner",
        "call me",
        "talk to a person",
        "talk to someone",
        "speak to someone",
        "speak to a person",
        "speak to a human",
        "agent"
    ];

    const wantsHuman = HUMAN_REQUEST_PATTERNS.some(pattern =>
        lowerMessage.includes(pattern)
    );

    if (wantsHuman) {

        session.status = "Waiting For Human";
        session.intent = "human_handoff";

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

        if (!session.lead.fullName) {
            return await recordAndReturn("Absolutely. I'll arrange for a member of our team to contact you. First, may I have your full name?");
        }

        if (!session.lead.phone) {
            return await recordAndReturn("Thank you. What's the best phone number or WhatsApp number to reach you?");
        }

        return await recordAndReturn("Perfect. I'll notify our team immediately and someone will contact you on WhatsApp as soon as possible.");
    }

    // If a human has taken over this conversation, Val stays silent.
    if (session.status === "Manual Override") {
        return null;
    }

    if (lowerMessage.includes("book")) {
        session.conversationState = "BOOKING";
    } else if (
        lowerMessage.includes("price") ||
        lowerMessage.includes("cost") ||
        lowerMessage.includes("how much")
    ) {
        session.conversationState = "PRICING";
    } else {
        session.conversationState = "DISCUSSION";
    }

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

const emailMatch = messageText.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
if (emailMatch) session.lead.email = emailMatch[0];

const phoneMatch = messageText.match(/\+?[0-9][0-9\s\-]{7,}/);
if (phoneMatch) session.lead.phone = phoneMatch[0];

const nameMatch = messageText.match(/(?:my name is|i am|i'm)\s+([A-Za-z]+(?:\s+[A-Za-z]+)+)/i);

if (nameMatch) {
    session.lead.fullName = nameMatch[1];
} else if (
    session.intent === "human_handoff" &&
    !session.lead.fullName &&
    messageText.trim().split(/\s+/).length >= 2
) {
    session.lead.fullName = messageText.trim();
}

const availableServices = await getTenantFile(tenantId, "services.json", []);
for (const service of availableServices) {
    const serviceName = service.name.toLowerCase();
    if (lowerMessage.includes(serviceName)) {
        session.lead.service = service.name;
        break;
    }
}

const weekdays = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
for (const day of weekdays) {
    if (lowerMessage.includes(day)) {
        session.lead.preferredDate = day;
        break;
    }
}

const timeMatch = messageText.match(/\b([01]?\d|2[0-3])(?::([0-5]\d))?\s?(am|pm)?\b/i);
if (timeMatch) session.lead.preferredTime = timeMatch[0];

// ====================================
// CONTINUE HUMAN HANDOFF
// ====================================

if (
    session.intent === "human_handoff" &&
    !session.handoffNotified
) {

if (!session.lead.fullName) {
        return await recordAndReturn("May I have your full name?");
    }

    if (!session.lead.phone) {
        return await recordAndReturn("Thank you. What's the best WhatsApp or phone number to reach you?");
    }

    console.log("🚨 Sending human handoff alert...");

    sendAlert(
        tenantId,
`🚨 HUMAN REQUEST

Name: ${session.lead.fullName}

Phone: ${session.lead.phone}

Channel: ${channel}

Session: ${session.id}`
    );

    console.log("✅ Human handoff alert function called.");

    session.handoffNotified = true;
    session.status = "Waiting For Human";

    session.pendingReply =
        "Perfect. Thank you. I've notified our team and someone will contact you on WhatsApp as soon as possible.";

    await setTenantFile(tenantId, "vault.json", sessionVault);
}

// Only stop replying if a real human has taken over.
if (session.status === "Manual Override") {
    return null;
}

if (session.history.length === 0 || session.history[0].role !== "system") {
    session.history = [{
        role: "system",
        content: await buildSystemPrompt(tenantId, messageText)
    }];
} else {
    session.history[0].content = await buildSystemPrompt(tenantId, messageText);
}
    session.history.push({ role: 'user', content: messageText });

    try {
        session.nextQuestion = null;
        if (session.conversationState === "BOOKING") {
            if (!session.lead.service) session.nextQuestion = "service";
            else if (!session.lead.preferredDate) session.nextQuestion = "preferredDate";
            else if (!session.lead.preferredTime) session.nextQuestion = "preferredTime";
            else if (!session.lead.fullName) session.nextQuestion = "fullName";
            else if (!session.lead.phone) session.nextQuestion = "phone";
            else if (!session.lead.email) session.nextQuestion = "email";
            else session.nextQuestion = "complete";
        }

const bookingSystemMessage = {
            role: "system",
            content: `Current conversation state: BOOKING\nService: ${session.lead.service || "missing"}\nDate: ${session.lead.preferredDate || "missing"}\nTime: ${session.lead.preferredTime || "missing"}\nFull Name: ${session.lead.fullName || "missing"}\nPhone: ${session.lead.phone || "missing"}\nEmail: ${session.lead.email || "missing"}\nNext required field: ${session.nextQuestion || "none"}\n\nDo NOT greet the visitor or introduce yourself. You already did that earlier in this conversation. Just ask for the next missing field listed above.`
        };

        const messagesForGroq = session.conversationState === "BOOKING" ? [...session.history, bookingSystemMessage] : session.history;

        const response = await groq.chat.completions.create({
            model: "llama-3.1-8b-instant",
            messages: messagesForGroq,
            temperature: 0.5
        });

        let fullReply = response.choices[0].message.content;
        const metaMatch = fullReply.match(/\[\[\s*PROFILE:\s*(.*?)\s*\|\s*OBJECTION:\s*(.*?)\s*\|\s*CONCESSION:\s*(.*?)\s*\]\]/);
        if (metaMatch) {
            session.analysis = { buyerProfile: metaMatch[1], objectionType: metaMatch[2], concessionStep: metaMatch[3] };
        }

let cleanReply = fullReply
    .replace(/\[\[.*?\]\]/g, "")
    .replace(/\[DEAL_AGREED\]|\[BOOKING_CONFIRMED\]/g, "")
    .trim();

// Override the AI reply if we're completing a human handoff.
if (session.pendingReply) {
    cleanReply = session.pendingReply;
    session.pendingReply = null;
}

const bookingComplete =
    session.lead.service &&
    session.lead.preferredDate &&
    session.lead.preferredTime &&
    session.lead.fullName &&
    session.lead.phone &&
    session.lead.email;

if (bookingComplete && !session.lead.saved) {
    session.lead.saved = true;

    await appendTenantLog(tenantId, "leads.json", {
        timestamp: new Date().toISOString(),
        ...session.lead
    });

    const bookingResult = await executeBooking(tenantId, session.lead, channel);

    if (bookingResult.calendarEventCreated) {
        cleanReply = `Your booking is confirmed for ${session.lead.preferredDate} at ${session.lead.preferredTime}. Anything else I can help with?`;
    } else {
        cleanReply = `I've saved your booking request for ${session.lead.preferredDate} at ${session.lead.preferredTime}. Our team will confirm it with you shortly. Is there anything else I can help with?`;
    }
}
        const sentences = cleanReply.match(/[^.!?]+[.!?]+/g);
        if (sentences && sentences.length > 3) cleanReply = sentences.slice(0, 3).join(" ").trim();

        session.history.push({ role: "assistant", content: cleanReply });
        session.history = [session.history[0], ...session.history.slice(-6)];

        await logAudit(tenantId, sessionId, messageText, fullReply, session.analysis);
        await setTenantFile(tenantId, "vault.json", sessionVault);

        return cleanReply;
    } catch (error) {
        sendAlert(tenantId, `CRITICAL FAILURE: ${error.message}`);
        return "I'm recalibrating...";
    }
};

// Website Endpoint uses the shared core function
app.post('/api/chat', async (req, res) => {
    const tenantId = req.headers['x-tenant-id'] || 'default';
    const { sessionId, message } = req.body;
    const responseText = await processValMessage(tenantId, sessionId, message, "website");
    res.json({ response: responseText || "" });
});

// ====================================
// ADMIN CONVERSATIONS — unified inbox API for the dashboard
// ====================================

// List conversations for a tenant, filtered by channel ("whatsapp" or "website")
app.get("/api/admin/conversations", async (req, res) => {
    const tenantId = req.headers["x-tenant-id"] || "default";
    const channel = req.query.channel || "website";

    const sessionVault = await getTenantFile(tenantId, "vault.json", {});

const list = Object.values(sessionVault)
        .filter(s => (s.channel || "website") === channel)
        .map(s => {
            const lastMsg = (s.history || []).filter(h => h.role !== "system").slice(-1)[0];
            return {
                sessionId: s.id,
                name: s.lead?.fullName || s.name || s.id,
                phone: s.lead?.phone || (channel === "whatsapp" ? s.id : ""),
                status: s.status,
                lastMessage: lastMsg?.content || "",
                lastRole: lastMsg?.role || "",
                lastUpdated: s.lastUpdated || ""
            };
        });

    res.json(list);
});

// Get full message history for one conversation
app.get("/api/admin/conversations/:sessionId", async (req, res) => {
    const tenantId = req.headers["x-tenant-id"] || "default";
    const sessionVault = await getTenantFile(tenantId, "vault.json", {});
    const session = sessionVault[req.params.sessionId];

    if (!session) return res.status(404).json({ error: "Conversation not found." });

    res.json({
        sessionId: session.id,
        channel: session.channel || "website",
        status: session.status,
        lead: session.lead,
        messages: (session.history || []).filter(h => h.role !== "system")
    });
});

// Send a manual reply into a conversation (pauses Val automatically)
app.post("/api/admin/conversations/:sessionId/reply", async (req, res) => {
    const tenantId = req.headers["x-tenant-id"] || "default";
    const { message } = req.body;

    if (!message) return res.status(400).json({ error: "Message is required." });

    const sessionVault = await getTenantFile(tenantId, "vault.json", {});
    const session = sessionVault[req.params.sessionId];

    if (!session) return res.status(404).json({ error: "Conversation not found." });

session.status = "Manual Override";
    session.history.push({ role: "assistant", content: message });
    session.lastUpdated = new Date().toISOString();
    await setTenantFile(tenantId, "vault.json", sessionVault);

    if ((session.channel || "website") === "whatsapp") {
        await sendWhatsAppMessageForTenant(tenantId, session.id, message);
    }

    res.json({ success: true });
});

// Delete a conversation entirely
app.delete("/api/admin/conversations/:sessionId", async (req, res) => {
    const tenantId = req.headers["x-tenant-id"] || "default";
    const sessionVault = await getTenantFile(tenantId, "vault.json", {});

    if (!sessionVault[req.params.sessionId]) {
        return res.status(404).json({ error: "Conversation not found." });
    }

    delete sessionVault[req.params.sessionId];
    await setTenantFile(tenantId, "vault.json", sessionVault);

    res.json({ success: true });
});

// ====================================
// AUTOMATED FEEDBACK LOOP
// Runs every night at 23:59
// ====================================

cron.schedule("59 23 * * *", async () => {

    console.log("Generating nightly report...");

    const tenantIds = await listTenantIds();

    let totalDeals = 0;

    for (const tenantId of tenantIds) {
        const deals = await getTenantLog(tenantId, "deals.json");
        totalDeals += deals.length;
    }

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

        console.log("Refreshing client calendars...");

        const tenantIds = await listTenantIds();

        for (const tenantId of tenantIds) {
            await updateCalendarSync(tenantId);
        }

    } catch (err) {

        console.error(err);

    }

});

// CHANGED: connect to MongoDB first, THEN start listening for requests.
// If the database connection fails, the server won't start at all — better
// to fail loudly than to silently run with no working storage.
connectDB()
    .then(() => {
        app.listen(PORT, () => {
            console.log(`🚀 ENTERPRISE ENGINE LIVE (MongoDB-backed)`);
        });
    })
    .catch((err) => {
        console.error("Failed to connect to MongoDB. Server not started.", err);
        process.exit(1);
    });

module.exports = { app, processValMessage };