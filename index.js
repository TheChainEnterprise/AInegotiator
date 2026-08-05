// The Chain: AI Negotiator Engine v5.0 (MongoDB-backed storage — persists across restarts)
require('dotenv').config();
const { Groq } = require('groq-sdk');
const express = require('express');
const cors = require('cors');
const fs = require("fs");
const cron = require("node-cron");
const path = require("path");
const nodemailer = require('nodemailer');
const moment = require('moment');

// Email sending via Resend (HTTP API, avoids Render's unreliable outbound SMTP)
const { Resend } = require('resend');
const resend = new Resend(process.env.RESEND_API_KEY);
console.log("✅ RESEND CONFIGURED");

const { connectDB } = require("./engine/db");

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
const { getAuthUrl, handleOAuthCallback, isCalendarConnected, createCalendarEvent, getAvailableSlots } = require("./engine/googleCalendar");

// 1. FIXED: Removed hardcoded API key fallback and throw error if missing
const finalApiKey = process.env.GROQ_API_KEY;
if (!finalApiKey) {
    throw new Error("Missing GROQ_API_KEY");
}
const groq = new Groq({ apiKey: finalApiKey });

const app = express();
app.use(cors({ origin: '*' }));
const PORT = process.env.PORT || 3001;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(whatsappRoutes);
app.use(manualMessageRoutes);

const updateCalendarSync = async (tenantId) => {
    const config = JSON.parse(fs.readFileSync(path.join(__dirname, "config.json"), "utf8"));
    const calendarUrl = config.CLIENT_CALENDARS?.[tenantId];
    if (!calendarUrl) return;
    try {
        const response = await fetch(calendarUrl);
        const data = await response.json();
        await setTenantFile(tenantId, "availability.json", { availableSlots: data });
    } catch (err) {
        console.error(`Calendar sync failed for ${tenantId}:`, err);
    }
};

const sendAlert = (tenantId, message) => {
    const config = JSON.parse(fs.readFileSync(path.join(__dirname, "config.json"), "utf8"));
    const webhooks = config.CLIENT_ALERTS || {};
    const businessWebhook = webhooks[tenantId];
    const adminWebhook = process.env.TELEGRAM_ALERT_WEBHOOK;
    const destinations = [businessWebhook, adminWebhook];
    const fullMessage = `🚨 THE CHAIN ALERT (${tenantId})\n\n${message}`;

    for (const url of destinations) {
        if (!url) continue;
        fetch(url + encodeURIComponent(fullMessage), { method: "POST" }).catch(console.error);
    }
};

const INITIAL_VAULT = {};

const buildSystemPrompt = async (tenantId, userMessage = "") => {
    const defaultBusiness = {
        businessName: "Business", industry: "", description: "", website: "",
        email: "", phone: "", whatsapp: "", address: "", bookingUrl: "", openingHours: {}, tone: "Professional"
    };

    const [business, services, faq, knowledge] = await Promise.all([
        getTenantFile(tenantId, "business.json", defaultBusiness),
        getTenantFile(tenantId, "services.json", []),
        getTenantFile(tenantId, "faq.json", []),
        getTenantFile(tenantId, "knowledge.json", [])
    ]);

    const retrieved = retrieveRelevantKnowledge({ services, faq, knowledge, message: userMessage, limit: 5 });

    const retrievedServices = retrieved.filter(r => r.source === "services.json").map(r => r.item);
    const retrievedFaq = retrieved.filter(r => r.source === "faq.json").map(r => r.item);
    const retrievedKnowledge = retrieved.filter(r => r.source === "knowledge.json").map(r => r.item);

    // 2. FIXED: Removed unused 'learnedRules' file-loading block entirely to eliminate dead code.

    return `
You are Val, the professional AI receptionist and representative for ${business.businessName}.

BUSINESS INFORMATION:
Name: ${business.businessName}
Industry: ${business.industry}
Description: ${business.description}
Address: ${business.address}
Phone: ${business.phone}
Email: ${business.email}
Website: ${business.website}

SERVICES:
${retrievedServices.map(service => `Name: ${service.name}\nDescription: ${service.description}\n${service.price ? `Price: $${service.price}` : ""}`).join("\n")}

FAQs:
${retrievedFaq.map(item => `Q: ${item.question}\nA: ${item.answer}`).join("\n")}

KNOWLEDGE BASE:
${retrievedKnowledge.map(item => `Title: ${item.title}\n${item.content}`).join("\n")}

YOUR ROLE & CONVERSATION STYLE:
- Act completely natural, warm, and human, like an experienced receptionist.
- Never sound robotic or like ChatGPT. 
- Keep responses concise (under 70 words, max 3 sentences).
- Guide visitors naturally. If they want to book, have a conversational dialogue to gather their full name, phone, and email organically.
- Once you have gathered their name, phone, and email, tell them you are ready to book their appointment and output the tag [[OPEN_BOOKING_MODAL]] so the system can launch the live schedule picker.

Always finish with telemetry analysis metadata:
[[ PROFILE: <Type> | OBJECTION: <Vector> | CONCESSION: <Step> ]]
`;
};

const logAudit = async (tenantId, sessionId, input, output, analysis) => {
    const auditEntry = { timestamp: new Date().toISOString(), sessionId, input, output, analysis };
    await appendTenantLog(tenantId, "audit.json", auditEntry);
};

// ====================================
// API ROUTES & RESTORED ADMIN ENDPOINTS
// ====================================

app.get('/api/leads', async (req, res) => {
    const tenantId = req.headers['x-tenant-id'] || 'default';
    const leads = await getTenantLog(tenantId, "leads.json");
    res.json(leads);
});

app.delete("/api/leads/:id", async (req, res) => {
    const tenantId = req.headers["x-tenant-id"] || "default";
    await deleteTenantLogEntry(tenantId, "leads.json", req.params.id);
    res.json({ success: true });
});
app.post("/api/leads", async (req, res) => {
    const tenantId = req.headers["x-tenant-id"] || "default";
    const lead = { ...req.body };
    await appendTenantLog(tenantId, "leads.json", lead);
    res.json({ success: true, lead });
});
app.put("/api/leads/:id", async (req, res) => {
    const tenantId = req.headers["x-tenant-id"] || "default";
    const { id, ...updates } = req.body;
    const updated = await updateTenantLogEntry(tenantId, "leads.json", req.params.id, updates);
    if (!updated) return res.status(404).json({ error: "Lead not found" });
    res.json({ success: true });
});

app.get("/api/bookings", async (req, res) => {
    const tenantId = req.headers['x-tenant-id'] || 'default';
    const bookings = await getTenantLog(tenantId, "bookings.json");
    res.json(bookings);
});

app.post("/api/bookings", async (req, res) => {
    const tenantId = req.headers["x-tenant-id"] || "default";
    const booking = { ...req.body };
    await appendTenantLog(tenantId, "bookings.json", booking);
    res.json({ success: true, booking });
});
app.delete("/api/bookings/:id", async (req, res) => {
    const tenantId = req.headers["x-tenant-id"] || "default";
    await deleteTenantLogEntry(tenantId, "bookings.json", req.params.id);
    res.json({ success: true });
});

app.put("/api/bookings/:id", async (req, res) => {
    const tenantId = req.headers["x-tenant-id"] || "default";
    const { id, ...updates } = req.body;
    const updated = await updateTenantLogEntry(tenantId, "bookings.json", req.params.id, updates);
    if (!updated) return res.status(404).json({ error: "Booking not found." });
    res.json({ success: true, booking: updated });
});

app.get("/api/dashboard/stats", async (req, res) => {
    const tenantId = req.headers["x-tenant-id"] || "default";
    try {
        const [leads, bookings, vault] = await Promise.all([
            getTenantLog(tenantId, "leads.json"),
            getTenantLog(tenantId, "bookings.json"),
            getTenantFile(tenantId, "vault.json", {})
        ]);

        const sessions = Object.values(vault);
        const messages = sessions.reduce(
            (sum, s) => sum + (s.history || []).filter(h => h.role !== "system").length,
            0
        );

        res.json({
            leads: leads.length,
            bookings: bookings.length,
            messages,
            activeChats: sessions.length
        });
    } catch (err) {
        console.error("Dashboard Stats Error:", err);
        res.status(500).json({ leads: 0, bookings: 0, messages: 0, activeChats: 0 });
    }
});

app.get('/api/clients', async (req, res) => {
    const tenantId = req.headers['x-tenant-id'] || 'default';
    let sessionVault = await getTenantFile(tenantId, "vault.json", null);
    if (!sessionVault) {
        sessionVault = INITIAL_VAULT;
        await setTenantFile(tenantId, "vault.json", sessionVault);
    }
    res.json(Object.values(sessionVault).map(c => ({ id: c.id, name: c.name, label: c.label, price: c.price, status: c.status, analysis: c.analysis })));
});

// ====================================
// RESTORED ADMIN CLIENT MANAGEMENT & CONFIG APIS
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
    const { id, businessName, industry, website, email, phone } = req.body;
    if (!id || !businessName) {
        return res.status(400).json({ error: "Missing client information." });
    }
    const existing = await getTenantFile(id, "business.json", null);
    if (existing) {
        return res.status(409).json({ error: "Client already exists." });
    }
    await setTenantFile(id, "business.json", {
        businessName, industry, website, email, phone,
        description: "", address: "", whatsapp: phone, bookingUrl: "", tone: "Professional", openingHours: {}
    });
    await setTenantFile(id, "services.json", []);
    await setTenantFile(id, "faq.json", []);
    await setTenantFile(id, "knowledge.json", []);
    await setTenantFile(id, "availability.json", { availableSlots: [] });
    await setTenantFile(id, "vault.json", {});
    res.json({ success: true });
});

app.delete("/api/admin/clients/:id", async (req, res) => {
    const existing = await getTenantFile(req.params.id, "business.json", null);
    if (!existing) {
        return res.status(404).json({ error: "Client not found." });
    }
    await deleteTenantData(req.params.id);
    res.json({ success: true });
});

app.get("/api/admin/profile", async (req, res) => {
    const tenantId = req.headers["x-tenant-id"] || "default";
    const business = await getTenantFile(tenantId, "business.json", {
        businessName: "", industry: "", description: "", website: "", email: "", phone: "", whatsapp: "", address: "", bookingUrl: "", tone: "Professional", openingHours: {}
    });
    res.json(business);
});

app.post("/api/admin/profile", async (req, res) => {
    const tenantId = req.headers["x-tenant-id"] || "default";
    await setTenantFile(tenantId, "business.json", req.body);
    res.json({ success: true });
});

app.get("/api/admin/behaviour", async (req, res) => {
    const tenantId = req.headers["x-tenant-id"] || "default";
    const behaviour = await getTenantFile(tenantId, "behaviour.json", {
        personality: "Professional", responseLength: "Short", emojiUsage: false, salesStyle: "Balanced", humor: false, greeting: "", closing: "", customInstructions: ""
    });
    res.json(behaviour);
});

app.post("/api/admin/behaviour", async (req, res) => {
    const tenantId = req.headers["x-tenant-id"] || "default";
    await setTenantFile(tenantId, "behaviour.json", req.body);
    res.json({ success: true });
});

app.get("/api/admin/faq", async (req, res) => {
    const tenantId = req.headers["x-tenant-id"] || "default";
    const faq = await getTenantFile(tenantId, "faq.json", []);
    res.json(faq);
});

app.post("/api/admin/faq", async (req, res) => {
    const tenantId = req.headers["x-tenant-id"] || "default";
    await setTenantFile(tenantId, "faq.json", req.body);
    res.json({ success: true });
});

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

app.get("/api/admin/import", async (req, res) => {
    const tenantId = req.headers["x-tenant-id"] || "default";
    const importDoc = await getTenantFile(tenantId, "import.json", null);
    if (!importDoc) return res.json({ exists: false });
    res.json({ exists: true, ...importDoc });
});

app.post("/api/admin/import", async (req, res) => {
    const tenantId = req.headers["x-tenant-id"] || "default";
    try {
        const website = req.body.website;
        if (!website) return res.status(400).json({ error: "Website URL is required." });

        const pages = await crawlWebsite(website);
        const imported = await processWebsiteContent(pages);

        if (!imported || typeof imported !== "object" || !imported.business || !Array.isArray(imported.services) || !Array.isArray(imported.faq) || !Array.isArray(imported.knowledge)) {
            throw new Error("Importer returned invalid data.");
        }

        const existingBusiness = await getTenantFile(tenantId, "business.json", {});
        const mergedBusiness = { ...existingBusiness };
        for (const [key, value] of Object.entries(imported.business)) {
            if (value && String(value).trim() !== "") mergedBusiness[key] = value;
        }
        await setTenantFile(tenantId, "business.json", mergedBusiness);

        const existingServices = await getTenantFile(tenantId, "services.json", []);
        const serviceMap = new Map();
        for (const service of existingServices) {
            if (!service?.name) continue;
            serviceMap.set(service.name.trim().toLowerCase(), { ...service });
        }
        for (const service of imported.services) {
            if (!service?.name) continue;
            const key = service.name.trim().toLowerCase();
            const existing = serviceMap.get(key) || {};
            serviceMap.set(key, {
                ...existing,
                name: service.name || existing.name,
                description: service.description?.trim() ? service.description : existing.description,
                price: service.price?.toString().trim() ? service.price : existing.price,
                monthly: service.monthly?.toString().trim() ? service.monthly : existing.monthly
            });
        }
        await setTenantFile(tenantId, "services.json", [...serviceMap.values()]);

        const existingFaq = await getTenantFile(tenantId, "faq.json", []);
        const faqMap = new Map();
        for (const item of existingFaq) {
            if (!item?.question) continue;
            faqMap.set(item.question.trim().toLowerCase(), { ...item });
        }
        for (const item of imported.faq) {
            if (!item?.question) continue;
            const key = item.question.trim().toLowerCase();
            const existing = faqMap.get(key) || {};
            faqMap.set(key, {
                ...existing,
                question: item.question || existing.question,
                answer: item.answer?.trim() ? item.answer : existing.answer
            });
        }
        await setTenantFile(tenantId, "faq.json", [...faqMap.values()]);

        const existingKnowledge = await getTenantFile(tenantId, "knowledge.json", []);
        const knowledgeMap = new Map();
        for (const article of existingKnowledge) {
            if (!article?.title) continue;
            knowledgeMap.set(article.title.trim().toLowerCase(), { ...article });
        }
        for (const article of imported.knowledge) {
            if (!article?.title) continue;
            if (typeof article.content !== "string") article.content = JSON.stringify(article.content ?? "");
            if (typeof article.source !== "string") article.source = "";
            const key = article.title.trim().toLowerCase();
            const existing = knowledgeMap.get(key) || {};
            knowledgeMap.set(key, {
                ...existing,
                title: article.title || existing.title,
                content: typeof article.content === "string" && article.content.trim() ? article.content : existing.content,
                source: typeof article.source === "string" && article.source.trim() ? article.source : existing.source
            });
        }
        await setTenantFile(tenantId, "knowledge.json", [...knowledgeMap.values()]);

        await setTenantFile(tenantId, "import.json", { website, status: "Imported", createdAt: new Date().toISOString() });

        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Website import failed." });
    }
});

app.delete("/api/admin/import", async (req, res) => {
    const tenantId = req.headers["x-tenant-id"] || "default";
    await deleteTenantFile(tenantId, "import.json");
    res.json({ success: true });
});

// Google Calendar Oauth routes
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
        res.send(`<html><body style="font-family:Arial;padding:40px;"><h2>Google Calendar Connected</h2><p>You can close this window and return to your dashboard.</p></body></html>`);
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
// RESTORED UNIFIED INBOX & CONVERSATIONS API
// ====================================

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
                lastUpdated: s.lastUpdated || "",
                startedAt: s.startedAt || ""
            };
        });

    res.json(list);
});

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
        startedAt: session.startedAt || "",
        lastUpdated: session.lastUpdated || "",
        messages: (session.history || []).filter(h => h.role !== "system")
    });
});

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

// ROBUST FINALIZE BOOKING WITH GUARANTEED EMAIL NOTIFICATIONS & LOGGING
async function finalizeBooking(tenantId, session, date, time) {
    const parsedStart = moment(`${date} ${time}`, [
        "YYYY-MM-DD HH:mm",
        "YYYY-MM-DD hh:mm A",
        "MM/DD/YYYY HH:mm",
        "MM/DD/YYYY hh:mm A"
    ], true);

    if (!parsedStart.isValid()) {
        throw new Error(`Invalid date/time received: date="${date}" time="${time}"`);
    }

    const startTime = parsedStart.toISOString();
    const endTime = parsedStart.clone().add(1, "hour").toISOString();
    let calendarEventCreated = false;
    try {
        const calendarResult = await createCalendarEvent(tenantId, {
            summary: `${session.lead?.service || "Appointment"} - ${session.lead?.fullName || "Customer"}`,
            description: `Phone: ${session.lead?.phone || ""}\nEmail: ${session.lead?.email || ""}\nBooked via Val (${session.channel})`,
            startTime,
            endTime
        });
        calendarEventCreated = !!(calendarResult && !calendarResult.skipped && calendarResult.id);
    } catch (err) {
        console.error("Calendar Event Error:", err);
    }

const bookingRecord = {
        timestamp: new Date().toISOString(),
        customer: session.lead?.fullName || "Valued Customer",
        service: session.lead?.service || "Consultation",
        date,
        time,
        staff: "Val (AI)",
        status: "Confirmed",
        phone: session.lead?.phone || "",
        email: session.lead?.email || "",
        notes: "",
        channel: session.channel || "website",
        calendarEventCreated
    };

    await appendTenantLog(tenantId, "bookings.json", bookingRecord);

    // Fire-and-forget: emails + Telegram no longer block the customer's response
    sendBookingNotifications(tenantId, session, bookingRecord).catch(err => {
        console.error("[BOOKING NOTIFICATIONS ERROR]:", err);
    });

    return bookingRecord;
}

async function sendBookingNotifications(tenantId, session, bookingRecord) {
    const clientEmail = session.lead?.email;
    console.log(`[EMAIL DISPATCH] Attempting to send Client Confirmation to: ${clientEmail || "NONE FOUND"}`);

    if (clientEmail) {
        try {
const info = await resend.emails.send({
                from: `The Chain <info@thechain.tech>`,
                to: clientEmail,
                subject: `Booking Confirmed: ${bookingRecord.service}`,
                html: `
                    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 25px; border: 1px solid #eaeaea; border-radius: 10px; background: #ffffff;">
                        <h2 style="color: #111; text-align: center; margin-bottom: 20px;">Appointment Confirmed!</h2>
                        <p style="font-size: 16px; color: #333;">Hi <strong>${bookingRecord.customer}</strong>,</p>
                        <p style="font-size: 15px; color: #555; line-height: 1.5;">Your appointment has been successfully booked and added to our calendar.</p>
                        <table style="width: 100%; background: #f9f9f9; padding: 15px; border-radius: 8px; margin: 20px 0; border-collapse: collapse;">
                            <tr><td style="padding: 8px 0; color: #666;"><strong>Date:</strong></td><td style="padding: 8px 0; text-align: right; color: #111;">${bookingRecord.date}</td></tr>
                            <tr><td style="padding: 8px 0; color: #666;"><strong>Time:</strong></td><td style="padding: 8px 0; text-align: right; color: #111;">${bookingRecord.time}</td></tr>
                        </table>
                        <p style="font-size: 13px; color: #777; text-align: center;">We look forward to seeing you!</p>
                    </div>
                `
            });
if (info.error) {
                console.error("[EMAIL FAILED] Client confirmation:", info.error);
            } else {
                console.log(`[EMAIL SUCCESS] Client confirmation sent successfully! Message ID: ${info.data?.id}`);
            }
        } catch (mailErr) {
            console.error("[CRITICAL CLIENT EMAIL ERROR]:", mailErr.message);
        }
    } else {
        console.warn("[EMAIL WARNING] Skipped sending client email because session.lead.email was empty.");
    }

    try {
        const business = await getTenantFile(tenantId, "business.json", null);
        const alertEmail = business?.email || process.env.SMTP_USER;
        console.log(`[EMAIL DISPATCH] Attempting to send Admin Alert to: ${alertEmail}`);

        if (alertEmail) {
const info = await resend.emails.send({
                from: `The Chain System <info@thechain.tech>`,
                to: alertEmail,
                subject: `New Booking Alert: ${bookingRecord.service} - ${bookingRecord.customer}`,
                html: `
                    <div style="font-family: Arial, sans-serif; padding: 20px;">
                        <h2>New Appointment Booked</h2>
                        <p><strong>Client:</strong> ${bookingRecord.customer}</p>
                        <p><strong>Service:</strong> ${bookingRecord.service}</p>
                        <p><strong>Date:</strong> ${bookingRecord.date}</p>
                        <p><strong>Time:</strong> ${bookingRecord.time}</p>
                        <p><strong>Phone:</strong> ${bookingRecord.phone}</p>
                        <p><strong>Email:</strong> ${bookingRecord.email}</p>
                        <p><strong>Channel:</strong> ${bookingRecord.channel}</p>
                    </div>
                `
            });
if (info.error) {
                console.error("[EMAIL FAILED] Admin alert:", info.error);
            } else {
                console.log(`[EMAIL SUCCESS] Admin alert sent successfully! Message ID: ${info.data?.id}`);
            }
        }
    } catch (alertErr) {
        console.error("[CRITICAL ADMIN ALERT EMAIL ERROR]:", alertErr.message);
    }

    try {
        sendAlert(
            tenantId,
            `New booking: ${bookingRecord.customer} — ${bookingRecord.service}\n${bookingRecord.date} at ${bookingRecord.time}\nPhone: ${bookingRecord.phone}\nEmail: ${bookingRecord.email}`
        );
    } catch (telegramErr) {
        console.error("[TELEGRAM ALERT ERROR]:", telegramErr);
    }
}

// NATURAL DYNAMIC CONVERSATION ENGINE
const processValMessage = async (tenantId, sessionId, messageText, channel = "website") => {
    let sessionVault = await getTenantFile(tenantId, "vault.json", null);
    if (!sessionVault) sessionVault = INITIAL_VAULT;

    if (!sessionVault[sessionId]) {
        sessionVault[sessionId] = {
            id: sessionId, name: "Visitor", label: "Chat", channel: channel,
            startedAt: new Date().toISOString(), price: 0, status: "Active",
            lead: { fullName: "", phone: "", email: "", service: "", preferredDate: "", preferredTime: "" },
            conversationState: "DISCUSSION",
            history: [],
            analysis: { buyerProfile: "Unknown", objectionType: "Unknown", concessionStep: "None" }
        };
    }

    const session = sessionVault[sessionId];
    session.channel = channel;
    session.lastUpdated = new Date().toISOString();

    if (!session.lead) session.lead = { fullName: "", phone: "", email: "", service: "", preferredDate: "", preferredTime: "" };
    if (!session.conversationState) session.conversationState = "DISCUSSION";

    const lowerMessage = messageText.toLowerCase();

    if (session.conversationState === "BOOKING") {
        // Stay in BOOKING state until fields are gathered or completed
    } else if (lowerMessage.includes("book") || lowerMessage.includes("appointment")) {
        session.conversationState = "BOOKING";
    } else if (lowerMessage.includes("price") || lowerMessage.includes("cost") || lowerMessage.includes("how much")) {
        session.conversationState = "PRICING";
    } else {
        session.conversationState = "DISCUSSION";
    }

    // Natural data extraction
    const emailMatch = messageText.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    if (emailMatch) session.lead.email = emailMatch[0];

    const phoneMatch = messageText.match(/\+?[0-9][0-9\s\-]{7,}/);
    if (phoneMatch) session.lead.phone = phoneMatch[0];

    const nameMatch = messageText.match(/(?:my name is|i am|i'm|it's|this is)\s+([A-Za-z]+(?:\s+[A-Za-z]+)*)/i);
    if (nameMatch) {
        session.lead.fullName = nameMatch[1];
        session.name = nameMatch[1];
    } else if (!session.lead.fullName && session.history.length > 0 && messageText.trim().split(/\s+/).length <= 3 && !messageText.includes("@") && !phoneMatch) {
        session.lead.fullName = messageText.trim();
        session.name = messageText.trim();
    }

    // WhatsApp Direct Slot Selection Parser
    if (channel === "whatsapp" && session.waitingForSlotSelection && session.offeredSlots) {
        const trimmed = messageText.trim();
        let chosenSlot = null;
        
        const numMatch = trimmed.match(/^(\d+)$/);
        if (numMatch) {
            const idx = parseInt(numMatch[1], 10) - 1;
            if (session.offeredSlots[idx]) chosenSlot = session.offeredSlots[idx];
        } else {
            chosenSlot = session.offeredSlots.find(s => trimmed.includes(s)) || null;
        }

        if (chosenSlot) {
            session.lead.preferredTime = chosenSlot;
            await finalizeBooking(tenantId, session, session.lead.preferredDate, session.lead.preferredTime);
            session.waitingForSlotSelection = false;
            session.offeredSlots = null;
            session.status = "Booked";
            session.conversationState = "DISCUSSION";
            delete session.isBookingFlow;
            await setTenantFile(tenantId, "vault.json", sessionVault);
            return `✅ Your booking is confirmed for ${session.lead.preferredDate} at ${session.lead.preferredTime}! We have sent a confirmation to your email.`;
        }
    }

    if (session.history.length === 0 || session.history[0].role !== "system") {
        session.history = [{ role: "system", content: await buildSystemPrompt(tenantId, messageText) }];
    } else {
        session.history[0].content = await buildSystemPrompt(tenantId, messageText);
    }
    session.history.push({ role: 'user', content: messageText });

    try {
        const response = await groq.chat.completions.create({ model: "llama-3.1-8b-instant", messages: session.history, temperature: 0.5 });
        let fullReply = response.choices[0].message.content;

        const metaMatch = fullReply.match(/\[\[\s*PROFILE:\s*(.*?)\s*\|\s*OBJECTION:\s*(.*?)\s*\|\s*CONCESSION:\s*(.*?)\s*\]\]/);
        if (metaMatch) {
            session.analysis = { buyerProfile: metaMatch[1], objectionType: metaMatch[2], concessionStep: metaMatch[3] };
        }

        let cleanReply = fullReply.replace(/\[\[.*?\]\]/g, "").trim();

        const hasName = !!session.lead.fullName;
        const hasPhone = !!session.lead.phone;
        const hasEmail = !!session.lead.email;

        if (session.conversationState === "BOOKING") {
            if (!hasName) {
                cleanReply = "I'd love to help you book an appointment! May I please have your full name?";
            } else if (!hasPhone) {
                cleanReply = `Thanks, ${session.lead.fullName}. What is the best phone number to reach you?`;
            } else if (!hasEmail) {
                cleanReply = "Got it. Lastly, what is your email address so we can send you the calendar confirmation?";
            }
        }

        const hasAllInfo = hasName && hasPhone && hasEmail;

        if (hasAllInfo) {
            if (channel === "whatsapp" && !session.lead.preferredDate) {
                session.lead.preferredDate = moment().add(1, 'days').format("YYYY-MM-DD");
                const slots = await getAvailableSlots(tenantId, session.lead.preferredDate);
                session.offeredSlots = slots.length > 0 ? slots : ["10:00", "11:00", "13:00", "14:00", "15:00"];
                session.waitingForSlotSelection = true;
                
                const slotList = session.offeredSlots.map((s, i) => `${i + 1}. ${s}`).join("\n");
                cleanReply = `Thank you so much! Here are the available times for ${session.lead.preferredDate}:\n\n${slotList}\n\nPlease reply with the number or time you prefer.`;
            } else if (channel === "website") {
                cleanReply = `Thank you, ${session.lead.fullName}! I have all your details. Please pick your preferred date and time from the schedule selector below.`;
                cleanReply += `\n\n[[OPEN_BOOKING_MODAL:${tenantId}:${sessionId}]]`;
            }
        }

        session.history.push({ role: "assistant", content: cleanReply });
        session.history = [session.history[0], ...session.history.slice(-12)];

        await logAudit(tenantId, sessionId, messageText, fullReply, session.analysis);
        await setTenantFile(tenantId, "vault.json", sessionVault);

        return cleanReply;
    } catch (error) {
        console.error("Val Chat Error:", error);
        return "I'm recalibrating for a moment. How can I assist you further?";
    }
};

app.post('/api/chat', async (req, res) => {
    const tenantId = req.headers['x-tenant-id'] || req.body.tenantId || 'default';
    const { sessionId, message } = req.body;
    const responseText = await processValMessage(tenantId, sessionId, message, "website");
    res.json({ response: responseText || "" });
});

app.get('/api/calendar/slots/:tenantId', async (req, res) => {
    const { tenantId } = req.params;
    const { date } = req.query;
    try {
        const availableSlots = await getAvailableSlots(tenantId, date);
        res.json(availableSlots.length > 0 ? availableSlots : ["10:00 AM", "11:00 AM", "01:00 PM", "02:00 PM", "03:00 PM", "04:00 PM"]);
    } catch (error) {
        res.json(["10:00 AM", "11:00 AM", "01:00 PM", "02:00 PM", "03:00 PM", "04:00 PM"]);
    }
});

app.post('/book/confirm', async (req, res) => {
    const { tenantId, sessionId, date, time } = req.body;
    const sessionVault = await getTenantFile(tenantId, "vault.json", {});
    const session = sessionVault[sessionId];

    if (!session || !session.lead) {
        return res.status(400).json({ success: false, error: "Session expired." });
    }

    // 3. FIXED: Duplicate booking protection
    if (session.status === "Booked") {
        return res.json({ success: true, message: "Already booked." });
    }

    try {
        await finalizeBooking(tenantId, session, date, time);
        session.status = "Booked";
        session.conversationState = "DISCUSSION";
        delete session.isBookingFlow;
        session.lastUpdated = new Date().toISOString();
        
        const confirmationText = `Your booking is confirmed for ${date} at ${time}. We look forward to seeing you!`;
        session.history.push({ role: "assistant", content: confirmationText });

        await setTenantFile(tenantId, "vault.json", sessionVault);

        res.json({ success: true, message: "Booking Confirmed" });
    } catch (err) {
        console.error("Booking Confirmation API Error:", err);
        res.status(500).json({ success: false, error: "Something went wrong confirming your booking." });
    }
});

connectDB()
    .then(() => {
        app.listen(PORT, () => {
            console.log(`🚀 ENTERPRISE ENGINE LIVE (MongoDB-backed)`);
        });
    })
    .catch((err) => {
        console.error("Failed to connect to MongoDB.", err);
        process.exit(1);
    });

module.exports = { app, processValMessage };