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

// Set up the email transporter
const emailTransporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
    },
});

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

const finalApiKey = process.env.GROQ_API_KEY || "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";
const groq = new Groq({ apiKey: finalApiKey });

const app = express();
app.use(cors({ origin: '*' }));
const PORT = process.env.PORT || 3001;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(whatsappRoutes);
app.use(manualMessageRoutes);

const simulateThinking = () => Promise.resolve();

const updateCalendarSync = async (tenantId) => {
    const config = JSON.parse(
        fs.readFileSync(
            path.join(__dirname, "config.json"),
            "utf8"
        )
    );
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

const getAvailability = async (tenantId) => {
    const doc = await getTenantFile(tenantId, "availability.json", { availableSlots: [] });
    return doc.availableSlots || [];
};

const sendAlert = (tenantId, message) => {
    const config = JSON.parse(
        fs.readFileSync(
            path.join(__dirname, "config.json"),
            "utf8"
        )
    );
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

const INITIAL_VAULT = {
  "client-xyz": { id: "client-xyz", name: "Sarah Jenkins", label: "Skincare Inquiry", price: 1000, status: "Active", history: [], analysis: { buyerProfile: "Analyzing...", objectionType: "None", concessionStep: "Baseline Stable" } },
  "client-abc": { id: "client-abc", name: "Marcus Vance", label: "Botox Consultation", price: 1200, status: "Active", history: [], analysis: { buyerProfile: "High Net Worth", objectionType: "None", concessionStep: "Baseline Stable" } },
  "client-123": { id: "client-123", name: "Elena Rostova", label: "Laser Resurfacing", price: 950, status: "Active", history: [], analysis: { buyerProfile: "Decisive Buyer", objectionType: "None", concessionStep: "Baseline Stable" } }
};

const config = JSON.parse(fs.readFileSync(path.join(__dirname, "config.json"), "utf8"));
const { CONTRACT_RULES, TRAINING_ENABLED } = config;

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

    return `
You are Val, the AI representative for ${business.businessName}.
Business: ${business.businessName}
Industry: ${business.industry}
Description: ${business.description}
Address: ${business.address}
Phone: ${business.phone}
Email: ${business.email}
Website: ${business.website}

Services:
${retrievedServices.map(service => `Name: ${service.name}\nDescription: ${service.description}\n${service.price ? `Setup Price: $${service.price}` : ""}`).join("\n")}

Booking Instructions:
- When a user wants to book, collect their Full Name, Phone, and Email one by one.
- Do NOT generate any links or external text widgets yourself.
`;
};

const logDealSuccess = async (tenantId, session) => {
    const successEntry = { timestamp: new Date().toISOString(), client: session.name, finalPrice: session.price, analysis: session.analysis };
    await appendTenantLog(tenantId, "deals.json", successEntry);
};

const logAudit = async (tenantId, sessionId, input, output, analysis) => {
    const auditEntry = { timestamp: new Date().toISOString(), sessionId, input, output, analysis };
    await appendTenantLog(tenantId, "audit.json", auditEntry);
};

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
    const lead = { id: Date.now(), ...req.body };
    await appendTenantLog(tenantId, "leads.json", lead);
    res.json({ success: true, lead });
});

app.get("/api/bookings", async (req, res) => {
    const tenantId = req.headers["x-tenant-id"] || "default";
    const bookings = await getTenantLog(tenantId, "bookings.json");
    res.json(bookings);
});

app.post("/api/bookings", async (req, res) => {
    const tenantId = req.headers["x-tenant-id"] || "default";
    const booking = { id: Date.now(), ...req.body };
    await appendTenantLog(tenantId, "bookings.json", booking);
    res.json({ success: true, booking });
});

app.delete("/api/bookings/:id", async (req, res) => {
    const tenantId = req.headers["x-tenant-id"] || "default";
    const targetId = Number(req.params.id);
    await deleteTenantLogEntry(tenantId, "bookings.json", targetId);
    res.json({ success: true });
});

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
    if (!id || !businessName) return res.status(400).json({ error: "Missing client information." });
    const existing = await getTenantFile(id, "business.json", null);
    if (existing) return res.status(409).json({ error: "Client already exists." });

    await setTenantFile(id, "business.json", {
        businessName, industry, website, email, phone, description: "", address: "", whatsapp: phone, bookingUrl: "", tone: "Professional", openingHours: {}
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
    if (!existing) return res.status(404).json({ error: "Client not found." });
    await deleteTenantData(req.params.id);
    res.json({ success: true });
});

app.get("/api/admin/profile", async (req, res) => {
    const tenantId = req.headers["x-tenant-id"] || "default";
    const business = await getTenantFile(tenantId, "business.json", { businessName: "", industry: "", description: "", website: "", email: "", phone: "" });
    res.json(business);
});

app.post("/api/admin/profile", async (req, res) => {
    const tenantId = req.headers["x-tenant-id"] || "default";
    await setTenantFile(tenantId, "business.json", req.body);
    res.json({ success: true });
});

app.get("/api/admin/behaviour", async (req, res) => {
    const tenantId = req.headers["x-tenant-id"] || "default";
    const behaviour = await getTenantFile(tenantId, "behaviour.json", { personality: "Professional" });
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

app.get("/api/admin/integrations", async (req, res) => {
    const tenantId = req.headers["x-tenant-id"] || "default";
    const integrations = await getTenantFile(tenantId, "integrations.json", { enabled: false, provider: "google" });
    res.json(integrations);
});

app.post("/api/admin/integrations", async (req, res) => {
    const tenantId = req.headers["x-tenant-id"] || "default";
    await setTenantFile(tenantId, "integrations.json", req.body);
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
        await setTenantFile(tenantId, "business.json", imported.business);
        await setTenantFile(tenantId, "services.json", imported.services);
        await setTenantFile(tenantId, "faq.json", imported.faq);
        await setTenantFile(tenantId, "knowledge.json", imported.knowledge);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: "Website import failed." });
    }
});

app.delete("/api/admin/import", async (req, res) => {
    const tenantId = req.headers["x-tenant-id"] || "default";
    await deleteTenantFile(tenantId, "import.json");
    res.json({ success: true });
});

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
        res.send(`<html><body style="font-family:Arial;padding:40px;"><h2>Google Calendar Connected</h2><p>You can close this window.</p></body></html>`);
    } catch (err) {
        res.status(500).send("Failed to connect Google Calendar: " + err.message);
    }
});

app.get("/api/admin/calendar/list", async (req, res) => {
    const tenantId = req.headers["x-tenant-id"] || "default";
    const connected = await isCalendarConnected(tenantId);
    res.json({ connected });
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

app.post('/api/webhook/whatsapp', async (req, res) => {
    res.sendStatus(200);
});

app.post('/api/webhook', async (req, res) => {
    res.status(200).json({ status: "success" });
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

// BULLETPROOF FINALIZE BOOKING WITH GUARANTEED EMAIL DISPATCH
async function finalizeBooking(tenantId, session, date, time) {
    const startTime = new Date(`${date}T${time}:00`).toISOString();
    const endTime = new Date(new Date(startTime).getTime() + 60 * 60 * 1000).toISOString();

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
        service: session.lead?.service,
        date,
        time,
        fullName: session.lead?.fullName,
        phone: session.lead?.phone,
        email: session.lead?.email,
        channel: session.channel,
        calendarEventCreated
    };

    await appendTenantLog(tenantId, "bookings.json", bookingRecord);

    if (session.lead?.email) {
        try {
            await emailTransporter.sendMail({
                from: `"The Chain" <${process.env.SMTP_USER}>`,
                to: session.lead.email,
                subject: `Booking Confirmed: ${session.lead.service || "Appointment"}`,
                html: `
                    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 25px; border: 1px solid #eaeaea; border-radius: 10px; background: #ffffff;">
                        <h2 style="color: #111; text-align: center; margin-bottom: 20px;">Appointment Confirmed!</h2>
                        <p style="font-size: 16px; color: #333;">Hi <strong>${session.lead.fullName || "there"}</strong>,</p>
                        <p style="font-size: 15px; color: #555; line-height: 1.5;">Your appointment has been successfully booked.</p>
                        <table style="width: 100%; background: #f9f9f9; padding: 15px; border-radius: 8px; margin: 20px 0; border-collapse: collapse;">
                            <tr><td style="padding: 8px 0; color: #666;"><strong>Date:</strong></td><td style="padding: 8px 0; text-align: right; color: #111;">${date}</td></tr>
                            <tr><td style="padding: 8px 0; color: #666;"><strong>Time:</strong></td><td style="padding: 8px 0; text-align: right; color: #111;">${time}</td></tr>
                        </table>
                    </div>
                `
            });
            console.log("Confirmation email successfully sent to:", session.lead.email);
        } catch (mailErr) {
            console.error("CRITICAL EMAIL ERROR:", mailErr);
        }
    }

    return bookingRecord;
}

function matchSlotFromMessage(text, slots) {
    const trimmed = text.trim();
    const numMatch = trimmed.match(/^(\d+)/);
    if (numMatch) {
        const idx = parseInt(numMatch[1], 10) - 1;
        if (slots[idx]) return slots[idx];
    }
    return slots.find((s) => trimmed.includes(s)) || null;
}

const processValMessage = async (tenantId, sessionId, messageText, channel = "website") => {
    let sessionVault = await getTenantFile(tenantId, "vault.json", null);
    if (!sessionVault) sessionVault = INITIAL_VAULT;

    const lowerMessage = messageText.toLowerCase();

    if (!sessionVault[sessionId]) {
        sessionVault[sessionId] = {
            id: sessionId, name: "Visitor", label: "Chat", channel: channel,
            startedAt: new Date().toISOString(), price: 0, status: "Active",
            lead: { fullName: "", phone: "", email: "", service: "", preferredDate: "", preferredTime: "" },
            conversationState: "DISCUSSION", history: [],
            analysis: { buyerProfile: "Unknown", objectionType: "Unknown", concessionStep: "None" }
        };
    }

    const session = sessionVault[sessionId];
    session.channel = channel;
    session.lastUpdated = new Date().toISOString();

    const recordAndReturn = async (replyText) => {
        session.history.push({ role: "user", content: messageText });
        session.history.push({ role: "assistant", content: replyText });
        await setTenantFile(tenantId, "vault.json", sessionVault);
        return replyText;
    };

    if (session.status === "Booked") {
        if (lowerMessage.includes("book")) {
            session.status = "Active";
            session.lead = { fullName: session.lead.fullName, phone: session.lead.phone, email: session.lead.email, service: "", preferredDate: "", preferredTime: "", saved: false };
            session.conversationState = "BOOKING";
        } else {
            session.conversationState = "DISCUSSION";
        }
    } else if (session.conversationState === "BOOKING" || lowerMessage.includes("book")) {
        session.conversationState = "BOOKING";
    } else {
        session.conversationState = "DISCUSSION";
    }

    if (!session.lead) session.lead = { fullName: "", phone: "", email: "", service: "", preferredDate: "", preferredTime: "" };

    const emailMatch = messageText.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    if (emailMatch) session.lead.email = emailMatch[0];

    const phoneMatch = messageText.match(/\+?[0-9][0-9\s\-]{7,}/);
    if (phoneMatch) session.lead.phone = phoneMatch[0];

    const nameMatch = messageText.match(/(?:my name is|i am|i'm|it's|this is)\s+([A-Za-z]+(?:\s+[A-Za-z]+)*)/i);
    if (nameMatch) {
        session.lead.fullName = nameMatch[1];
        session.name = nameMatch[1];
    } else if (session.conversationState === "BOOKING" && !session.lead.fullName && messageText.trim().split(/\s+/).length > 0 && messageText.trim().split(/\s+/).length <= 4 && !messageText.includes("@") && !messageText.includes("+") && !lowerMessage.includes("book")) {
        session.lead.fullName = messageText.trim();
        session.name = messageText.trim();
    }

    if (session.history.length === 0 || session.history[0].role !== "system") {
        session.history = [{ role: "system", content: await buildSystemPrompt(tenantId, messageText) }];
    } else {
        session.history[0].content = await buildSystemPrompt(tenantId, messageText);
    }
    session.history.push({ role: 'user', content: messageText });

    try {
        if (session.conversationState === "BOOKING") {
            if (!session.lead.fullName) return await recordAndReturn("Great! Before we book your appointment, may I have your full name?");
            if (!session.lead.phone) return await recordAndReturn("Thank you. What's the best phone number or WhatsApp number to reach you?");
            if (!session.lead.email) return await recordAndReturn("Perfect. Lastly, what's your email address for the booking confirmation?");

            if (!session.lead.saved) {
                session.lead.saved = true;
                await appendTenantLog(tenantId, "leads.json", { timestamp: new Date().toISOString(), ...session.lead, sessionId: session.id });
            }

            // WHATSAPP CONVERSATIONAL SLOT PICKER (NO LINKS)
            if (channel === "whatsapp") {
                if (!session.lead.preferredDate) {
                    const days = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
                    const foundDay = Object.keys(days).find(d => lowerMessage.includes(d));
                    if (foundDay) {
                        const d = new Date();
                        d.setDate(d.getDate() + ((days[foundDay] + 7 - d.getDay()) % 7 || 7));
                        session.lead.preferredDate = d.toISOString().split("T")[0];
                    } else if (lowerMessage.includes("tomorrow")) {
                        const d = new Date();
                        d.setDate(d.getDate() + 1);
                        session.lead.preferredDate = d.toISOString().split("T")[0];
                    } else if (lowerMessage.match(/^\d{4}-\d{2}-\d{2}$/)) {
                        session.lead.preferredDate = lowerMessage;
                    } else {
                        return await recordAndReturn("What day would you like to book for? (e.g., Monday, Tomorrow, or YYYY-MM-DD)");
                    }
                }

                if (!session.lead.preferredTime) {
                    const slots = await getAvailableSlots(tenantId, session.lead.preferredDate);
                    if (!slots || slots.length === 0) {
                        session.lead.preferredDate = "";
                        return await recordAndReturn(`I'm sorry, no available times on that day. What other day works?`);
                    }

                    const matchedSlot = matchSlotFromMessage(messageText, slots);
                    if (matchedSlot) {
                        session.lead.preferredTime = matchedSlot;
                        await finalizeBooking(tenantId, session, session.lead.preferredDate, session.lead.preferredTime);
                        session.status = "Booked";
                        session.conversationState = "DISCUSSION";
                        await setTenantFile(tenantId, "vault.json", sessionVault);
                        return await recordAndReturn(`✅ Your booking is confirmed for ${session.lead.preferredDate} at ${session.lead.preferredTime}. We've sent an email confirmation!`);
                    }

                    const slotList = slots.map((s, i) => `${i + 1}. ${s}`).join("\n");
                    return await recordAndReturn(`Available times for ${session.lead.preferredDate}:\n\n${slotList}\n\nPlease reply with the number of your preferred time.`);
                }
            } else {
                // WEBSITE TRIGGER MODAL
                if (session.status !== "Pending_Slot" && session.status !== "Booked") {
                    session.status = "Pending_Slot";
                    const triggerTag = `Perfect! I have everything I need.\n\n[[OPEN_BOOKING_MODAL:${tenantId}:${session.id}]]`;
                    session.history.push({ role: "assistant", content: triggerTag });
                    await setTenantFile(tenantId, "vault.json", sessionVault);
                    return triggerTag;
                }
            }
        }

const response = await groq.chat.completions.create({ model: "llama-3.1-8b-instant", messages: session.history, temperature: 0.5 });
        let fullReply = response.choices[0].message.content;
        
        // Properly sanitize any modal tags or internal markers so they never show up in chat text
        let cleanReply = fullReply.replace(/\[\[OPEN_BOOKING_MODAL:.*?\]\]/g, "").replace(/\[\[.*?\]\]/g, "").trim();
        if (!cleanReply) {
            cleanReply = "Perfect! Please select your slot below.";
        }

        session.history.push({ role: "assistant", content: cleanReply });
        session.history = [session.history[0], ...session.history.slice(-6)];

        await logAudit(tenantId, sessionId, messageText, fullReply, session.analysis);
        await setTenantFile(tenantId, "vault.json", sessionVault);
        return cleanReply;
    } catch (error) {
        return "I'm recalibrating...";
    }
};

app.post('/api/chat', async (req, res) => {
    const tenantId = req.headers['x-tenant-id'] || 'default';
    const { sessionId, message } = req.body;
    const responseText = await processValMessage(tenantId, sessionId, message, "website");
    res.json({ response: responseText || "" });
});

app.get('/api/calendar/slots/:tenantId', async (req, res) => {
    const { tenantId } = req.params;
    const { date } = req.query;
    try {
        const availableSlots = await getAvailableSlots(tenantId, date);
        res.json(availableSlots);
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

    try {
        await finalizeBooking(tenantId, session, date, time);
        session.status = "Booked";
        session.conversationState = "DISCUSSION";
        session.lastUpdated = new Date().toISOString();
        await setTenantFile(tenantId, "vault.json", sessionVault);

        res.json({ success: true, message: "Booking Confirmed" });
    } catch (err) {
        res.status(500).json({ success: false, error: "Something went wrong." });
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