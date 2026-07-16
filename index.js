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

const {
    retrieveRelevantKnowledge,
} = require("./engine/retrieval");

// Use the environment variable if available, otherwise use the fallback for local testing
const finalApiKey = process.env.GROQ_API_KEY || "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";
const groq = new Groq({ apiKey: finalApiKey });

const app = express();
app.use(cors({ origin: '*' })); 
const PORT = process.env.PORT || 3001;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

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

const buildSystemPrompt = (
    tenantId,
    userMessage = ""
) => {

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

const retrieved = retrieveRelevantKnowledge({
    tenantDir: getTenantDir(tenantId),
    message: userMessage,
    limit: 5
});

const services = retrieved
    .filter(r => r.source === "services.json")
    .map(r => r.item);

const faq = retrieved
    .filter(r => r.source === "faq.json")
    .map(r => r.item);

const knowledge = retrieved
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

If someone says hello:

→ Welcome them.
→ Introduce yourself.
→ Ask how you can help.

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

app.delete("/api/leads/:id", (req, res) => {
    const tenantId = req.headers["x-tenant-id"] || "default";
    const file = path.join(getTenantDir(tenantId), "leads.json");
    const targetId = String(req.params.id);

    console.log(`[DELETE] Request received for ID: ${targetId}`);

    if (!fs.existsSync(file)) {
        console.log("[DELETE] File not found, returning success");
        return res.json({ success: true });
    }

    const lines = fs.readFileSync(file, "utf8").split("\n").filter(Boolean);
    
    // Explicit filter: keep only leads whose ID does NOT match
    const remainingLeads = lines.filter(line => {
        try {
            const lead = JSON.parse(line);
            console.log(`[DELETE] Checking lead ID: ${lead.id} against target: ${targetId}`);
            return String(lead.id) !== targetId;
        } catch (e) {
            return false;
        }
    });

    console.log(`[DELETE] Original count: ${lines.length}, Remaining count: ${remainingLeads.length}`);

    fs.writeFileSync(file, remainingLeads.map(l => JSON.stringify(l)).join("\n") + (remainingLeads.length ? "\n" : ""));
    res.json({ success: true });
});

app.post("/api/leads", (req, res) => {
    const tenantId = req.headers["x-tenant-id"] || "default";
    const leadsPath = path.join(getTenantDir(tenantId), "leads.json");

    // Ensure we are saving a clean object
    const lead = {
        id: Date.now(),
        ...req.body
    };

    // Use JSON.stringify(lead) directly to prevent double-encoding
    fs.appendFileSync(leadsPath, JSON.stringify(lead) + "\n");

    res.json({ success: true, lead });
});

app.put("/api/leads/:id", (req, res) => {
    const tenantId = req.headers["x-tenant-id"] || "default";
    const file = path.join(getTenantDir(tenantId), "leads.json");

    if (!fs.existsSync(file)) return res.status(404).json({ error: "File not found" });

    const lines = fs.readFileSync(file, "utf8").split("\n").filter(Boolean);
    const leads = lines.map(line => JSON.parse(line));

    const index = leads.findIndex(l => String(l.id) === String(req.params.id));
    if (index === -1) return res.status(404).json({ error: "Lead not found" });

    leads[index] = { ...req.body, id: leads[index].id }; // Force existing ID
    fs.writeFileSync(file, leads.map(l => JSON.stringify(l)).join("\n") + "\n");
    
    res.json({ success: true });
});

app.get("/api/bookings", (req, res) => {

    const tenantId = req.headers["x-tenant-id"] || "default";

    const file = path.join(
        getTenantDir(tenantId),
        "bookings.json"
    );

    if (!fs.existsSync(file)) {
        fs.writeFileSync(file, "");
        return res.json([]);
    }

    const bookings = fs
        .readFileSync(file, "utf8")
        .split("\n")
        .filter(Boolean)
        .map(line => JSON.parse(line));

    res.json(bookings.reverse());

});

app.post("/api/bookings", (req, res) => {

    const tenantId = req.headers["x-tenant-id"] || "default";

    const file = path.join(
        getTenantDir(tenantId),
        "bookings.json"
    );

    const booking = {
        id: Date.now(),
        ...req.body
    };

    fs.appendFileSync(
        file,
        JSON.stringify(booking) + "\n"
    );

    res.json({
        success: true,
        booking
    });

});

app.delete("/api/bookings/:id", (req, res) => {

    const tenantId = req.headers["x-tenant-id"] || "default";

    const file = path.join(
        getTenantDir(tenantId),
        "bookings.json"
    );

    if (!fs.existsSync(file)) {
        return res.json({ success: true });
    }

    const bookings = fs
        .readFileSync(file, "utf8")
        .split("\n")
        .filter(Boolean)
        .map(line => JSON.parse(line))
        .filter(b => String(b.id) !== req.params.id);

    fs.writeFileSync(
        file,
        bookings.map(b => JSON.stringify(b)).join("\n") +
            (bookings.length ? "\n" : "")
    );

    res.json({
        success: true
    });

});

app.put("/api/bookings/:id", (req, res) => {

    const tenantId = req.headers["x-tenant-id"] || "default";

    const file = path.join(
        getTenantDir(tenantId),
        "bookings.json"
    );

    if (!fs.existsSync(file)) {
        return res.status(404).json({
            error: "Bookings file not found."
        });
    }

    const bookings = fs
        .readFileSync(file, "utf8")
        .split("\n")
        .filter(Boolean)
        .map(line => JSON.parse(line));

    const index = bookings.findIndex(
        booking => String(booking.id) === req.params.id
    );

    if (index === -1) {
        return res.status(404).json({
            error: "Booking not found."
        });
    }

    bookings[index] = {
        ...bookings[index],
        ...req.body,
        id: bookings[index].id
    };

    fs.writeFileSync(
        file,
        bookings
            .map(booking => JSON.stringify(booking))
            .join("\n") +
            (bookings.length ? "\n" : "")
    );

    res.json({
        success: true,
        booking: bookings[index]
    });

});

// ====================================
// ADMIN CLIENT MANAGEMENT
// ====================================

app.get("/api/admin/clients", (req, res) => {

const clientsRoot = path.dirname(getTenantDir("default"));

    if (!fs.existsSync(clientsRoot)) {
        return res.json([]);
    }

    const folders = fs.readdirSync(clientsRoot, {
        withFileTypes: true
    });

    const clients = folders
        .filter(folder => folder.isDirectory())
        .map(folder => {

            const businessPath = path.join(
                clientsRoot,
                folder.name,
                "business.json"
            );

            if (!fs.existsSync(businessPath))
                return null;

            try {

                return {
                    id: folder.name,
                    ...JSON.parse(
                        fs.readFileSync(
                            businessPath,
                            "utf8"
                        )
                    )
                };

            } catch {

                return null;

            }

        })
        .filter(Boolean);

    res.json(clients);

});

app.post("/api/admin/clients", (req, res) => {

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

const tenantDir = getTenantDir(id);

if (fs.existsSync(tenantDir)) {
    return res.status(409).json({
        error: "Client already exists."
    });
}

fs.mkdirSync(tenantDir, {
    recursive: true
});

    fs.writeFileSync(
        path.join(tenantDir, "business.json"),
        JSON.stringify({
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
        }, null, 2)
    );

    fs.writeFileSync(path.join(tenantDir, "services.json"), JSON.stringify([], null, 2));
    fs.writeFileSync(path.join(tenantDir, "faq.json"), JSON.stringify([], null, 2));
    fs.writeFileSync(path.join(tenantDir, "knowledge.json"), JSON.stringify([], null, 2));
    fs.writeFileSync(path.join(tenantDir, "availability.json"), JSON.stringify({ availableSlots: [] }, null, 2));

    fs.writeFileSync(path.join(tenantDir, "leads.json"), "");
    fs.writeFileSync(path.join(tenantDir, "bookings.json"), "");
    fs.writeFileSync(path.join(tenantDir, "audit.json"), "");
    fs.writeFileSync(path.join(tenantDir, "deals.json"), "");

    fs.writeFileSync(
        getVaultPath(id),
        JSON.stringify({}, null, 2)
    );

    res.json({
        success: true
    });

});

app.delete("/api/admin/clients/:id", (req, res) => {

    const tenantDir = getTenantDir(req.params.id);

    if (!fs.existsSync(tenantDir)) {
        return res.status(404).json({
            error: "Client not found."
        });
    }

    fs.rmSync(tenantDir, {
        recursive: true,
        force: true
    });

    res.json({
        success: true
    });

});

// ====================================
// ADMIN BUSINESS PROFILE
// ====================================

app.get("/api/admin/profile", (req, res) => {

    const tenantId = req.headers["x-tenant-id"] || "default";

    const businessPath = path.join(
        getTenantDir(tenantId),
        "business.json"
    );

    if (!fs.existsSync(businessPath)) {

        return res.json({
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

    }

    res.json(
        JSON.parse(
            fs.readFileSync(
                businessPath,
                "utf8"
            )
        )
    );

});

app.post("/api/admin/profile", (req, res) => {

    const tenantId = req.headers["x-tenant-id"] || "default";

    fs.writeFileSync(
        path.join(
            getTenantDir(tenantId),
            "business.json"
        ),
        JSON.stringify(req.body, null, 2)
    );

    res.json({
        success: true
    });

});

// ====================================
// ADMIN AI BEHAVIOUR
// ====================================

app.get("/api/admin/behaviour", (req, res) => {

    const tenantId = req.headers["x-tenant-id"] || "default";

    const behaviourPath = path.join(
        getTenantDir(tenantId),
        "behaviour.json"
    );

    if (!fs.existsSync(behaviourPath)) {

        return res.json({
            personality: "Professional",
            responseLength: "Short",
            emojiUsage: false,
            salesStyle: "Balanced",
            humor: false,
            greeting: "",
            closing: "",
            customInstructions: ""
        });

    }

    res.json(
        JSON.parse(
            fs.readFileSync(
                behaviourPath,
                "utf8"
            )
        )
    );

});

app.post("/api/admin/behaviour", (req, res) => {

    const tenantId = req.headers["x-tenant-id"] || "default";

    fs.writeFileSync(
        path.join(
            getTenantDir(tenantId),
            "behaviour.json"
        ),
        JSON.stringify(req.body, null, 2)
    );

    res.json({
        success: true
    });

});

// ====================================
// ADMIN FAQ
// ====================================

app.get("/api/admin/faq", (req, res) => {

    const tenantId = req.headers["x-tenant-id"] || "default";

    const file = path.join(
        getTenantDir(tenantId),
        "faq.json"
    );

    if (!fs.existsSync(file)) {
        fs.writeFileSync(file, JSON.stringify([], null, 2));
    }

    res.json(
        JSON.parse(fs.readFileSync(file, "utf8"))
    );

});

app.post("/api/admin/faq", (req, res) => {

    const tenantId = req.headers["x-tenant-id"] || "default";

    fs.writeFileSync(
        path.join(
            getTenantDir(tenantId),
            "faq.json"
        ),
        JSON.stringify(req.body, null, 2)
    );

    res.json({
        success: true
    });

});

// ====================================
// ADMIN SERVICES
// ====================================

app.get("/api/admin/services", (req, res) => {

    const tenantId = req.headers["x-tenant-id"] || "default";

    const file = path.join(getTenantDir(tenantId), "services.json");

    if (!fs.existsSync(file)) {
        fs.writeFileSync(file, JSON.stringify([], null, 2));
    }

    res.json(JSON.parse(fs.readFileSync(file, "utf8")));

});

app.post("/api/admin/services", (req, res) => {

    const tenantId = req.headers["x-tenant-id"] || "default";

    fs.writeFileSync(
        path.join(getTenantDir(tenantId), "services.json"),
        JSON.stringify(req.body, null, 2)
    );

    res.json({ success: true });

});

// ====================================
// ADMIN KNOWLEDGE
// ====================================

app.get("/api/admin/knowledge", (req, res) => {

    const tenantId = req.headers["x-tenant-id"] || "default";

    const file = path.join(getTenantDir(tenantId), "knowledge.json");

    if (!fs.existsSync(file)) {
        fs.writeFileSync(file, JSON.stringify([], null, 2));
    }

    res.json(JSON.parse(fs.readFileSync(file, "utf8")));

});

app.post("/api/admin/knowledge", (req, res) => {

    const tenantId = req.headers["x-tenant-id"] || "default";

    fs.writeFileSync(
        path.join(getTenantDir(tenantId), "knowledge.json"),
        JSON.stringify(req.body, null, 2)
    );

    res.json({ success: true });

});

// ====================================
// ADMIN INTEGRATIONS
// ====================================

app.get("/api/admin/integrations", (req, res) => {

    const tenantId = req.headers["x-tenant-id"] || "default";

    const file = path.join(getTenantDir(tenantId), "integrations.json");

    if (!fs.existsSync(file)) {

        const defaults = {
            enabled: false,
            provider: "google",
            calendarId: ""
        };

        fs.writeFileSync(file, JSON.stringify(defaults, null, 2));

        return res.json(defaults);

    }

    res.json(JSON.parse(fs.readFileSync(file, "utf8")));

});

app.post("/api/admin/integrations", (req, res) => {

    const tenantId = req.headers["x-tenant-id"] || "default";

    fs.writeFileSync(
        path.join(getTenantDir(tenantId), "integrations.json"),
        JSON.stringify(req.body, null, 2)
    );

    res.json({ success: true });

});

// ====================================
// ADMIN WEBSITE IMPORT
// ====================================

app.get("/api/admin/import", (req, res) => {

    const tenantId = req.headers["x-tenant-id"] || "default";

    const file = path.join(getTenantDir(tenantId), "import.json");

    if (!fs.existsSync(file)) {
        return res.json({ exists: false });
    }

    res.json({
        exists: true,
        ...JSON.parse(fs.readFileSync(file, "utf8"))
    });

});

app.post("/api/admin/import", (req, res) => {

    const tenantId = req.headers["x-tenant-id"] || "default";

    const data = {
        website: req.body.website,
        status: "Imported",
        createdAt: new Date().toISOString()
    };

    fs.writeFileSync(
        path.join(getTenantDir(tenantId), "import.json"),
        JSON.stringify(data, null, 2)
    );

    res.json({ success: true });

});

app.delete("/api/admin/import", (req, res) => {

    const tenantId = req.headers["x-tenant-id"] || "default";

    const file = path.join(getTenantDir(tenantId), "import.json");

    if (fs.existsSync(file)) {
        fs.unlinkSync(file);
    }

    res.json({ success: true });

});

// ====================================
// GOOGLE CALENDAR PLACEHOLDER API
// ====================================

app.get("/api/admin/calendar/connect", (req, res) => {

    const tenantId = req.headers["x-tenant-id"] || "default";

    res.json({
        success: false,
        url: `http://localhost:3001/api/admin/calendar/oauth?tenant=${tenantId}`
    });

});

app.get("/api/admin/calendar/list", (req, res) => {

    const tenantId = req.headers["x-tenant-id"] || "default";

    const integrationsPath = path.join(
        getTenantDir(tenantId),
        "integrations.json"
    );

    let connected = false;

    if (fs.existsSync(integrationsPath)) {

        try {

            const settings = JSON.parse(
                fs.readFileSync(integrationsPath, "utf8")
            );

            connected = settings.enabled === true;

        } catch {}

    }

    res.json({
        connected,
        calendars: [],
        message: connected
            ? "Calendar integration is enabled. OAuth is not connected yet."
            : "Calendar integration is disabled."
    });

});

app.get("/api/admin/calendar/oauth", (req, res) => {

    res.send(`
        <html>
            <body style="font-family:Arial;padding:40px;">
                <h2>Google Calendar Integration</h2>
                <p>This page is a placeholder.</p>
                <p>The real Google OAuth flow will be implemented in the next phase.</p>
                <p>You successfully reached the backend.</p>
            </body>
        </html>
    `);

});

// ====================================
// TELEMETRY CLIENT SESSIONS
// ====================================

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

// Always ensure the current business profile is used
if (
    session.history.length === 0 ||
    session.history[0].role !== "system"
) {
    session.history = [
        {
            role: "system",
            content: buildSystemPrompt(
                tenantId,
                message
            )
        }
    ];
} else {
    session.history[0].content = buildSystemPrompt(
        tenantId,
        message
    );
}

if (session.status === 'Manual Override') {
    if (TRAINING_ENABLED === true) {
        const trainingEntry = {
            previousContext: session.history.slice(-3),
            humanCorrection: message,
            timestamp: new Date().toISOString()
        };

        fs.appendFileSync(
            path.join(
                getTenantDir(tenantId),
                "training_data.json"
            ),
            JSON.stringify(trainingEntry) + "\n"
        );
    }

    session.history.push({
        role: 'user',
        content: `[HUMAN]: ${message}`
    });

    fs.writeFileSync(
        vaultPath,
        JSON.stringify(sessionVault, null, 2)
    );

    return res.json({
        response: "",
        currentPrice: session.price,
        status: session.status,
        analysis: session.analysis
    });
}

session.history.push({
    role: 'user',
    content: message
});

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

const bookingSystemMessage = {
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
• Never redirect them to another page.
• Ask ONLY for the next missing field.
• Ask exactly ONE question.
• Do not skip any missing fields.
• Continue until every required field has been collected.

After every required field has been collected:

• Confirm only that the booking request has been received.
• Explain that a member of the business will review the request and contact the visitor to confirm the booking.
• Never claim the appointment has already been booked.
• Never claim that an email, SMS, WhatsApp message or calendar invitation has been sent unless this system has actually sent it.
• Only provide a booking link if one exists in the Business Profile.`
};

const messagesForGroq =
    session.conversationState === "BOOKING"
        ? [...session.history, bookingSystemMessage]
        : session.history;

const response = await groq.chat.completions.create({
    model: "llama-3.1-8b-instant",
    messages: messagesForGroq,
    temperature: 0.5
});

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

const clientsDir = path.dirname(getTenantDir("default"));

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

        console.log("Refreshing client calendars...");

const clientsRoot = path.dirname(getTenantDir("default"));

        if (!fs.existsSync(clientsRoot)) {
            return;
        }

        const tenants = fs
            .readdirSync(clientsRoot, { withFileTypes: true })
            .filter(dir => dir.isDirectory())
            .map(dir => dir.name);

        for (const tenantId of tenants) {
            await updateCalendarSync(tenantId);
        }

    } catch (err) {

        console.error(err);

    }

});

app.listen(PORT, () => {
    console.log(`🚀 ENTERPRISE ENGINE v4.1.3 LIVE`);
});