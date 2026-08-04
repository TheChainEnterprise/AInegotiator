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

// Set up the email transporter with family: 4 to resolve ENETUNREACH on Render
const emailTransporter = nodemailer.createTransport({
    service: 'gmail',
    family: 4,
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

const INITIAL_VAULT = {
  "client-xyz": { id: "client-xyz", name: "Sarah Jenkins", label: "Skincare Inquiry", price: 1000, status: "Active", history: [], analysis: { buyerProfile: "Analyzing...", objectionType: "None", concessionStep: "Baseline Stable" } },
  "client-abc": { id: "client-abc", name: "Marcus Vance", label: "Botox Consultation", price: 1200, status: "Active", history: [], analysis: { buyerProfile: "High Net Worth", objectionType: "None", concessionStep: "Baseline Stable" } },
  "client-123": { id: "client-123", name: "Elena Rostova", label: "Laser Resurfacing", price: 950, status: "Active", history: [], analysis: { buyerProfile: "Decisive Buyer", objectionType: "None", concessionStep: "Baseline Stable" } }
};

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

YOUR ROLE & CONVERSATION STYLE:
- Act completely natural, warm, and human, like an experienced receptionist.
- Never sound robotic or like ChatGPT. 
- Keep responses concise (under 70 words, max 3 sentences).
- Guide visitors naturally. If they want to book, have a conversational dialogue to gather their full name, phone, and email organically.
- Once you have gathered their name, phone, and email, tell them you are ready to book their appointment and output the tag [[TRIGGER_BOOKING_MODAL]] so the system can launch the live schedule picker.
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

app.get("/api/bookings", async (req, res) => {
    const tenantId = req.headers['x-tenant-id'] || 'default';
    const bookings = await getTenantLog(tenantId, "bookings.json");
    res.json(bookings);
});

app.get('/api/clients', async (req, res) => {
    try {
        const tenantIds = await listTenantIds();
        const clients = [];
        
        for (const tId of tenantIds) {
            const biz = await getTenantFile(tId, "business.json", { businessName: tId, industry: "AI Receptionist" });
            clients.push({
                id: tId,
                name: biz.businessName || tId,
                label: biz.industry || "Active Business",
                price: biz.price || 1000,
                status: "Active",
                analysis: { buyerProfile: "Configured Tenant", objectionType: "None", concessionStep: "Stable" }
            });
        }

        if (clients.length === 0) {
            clients.push({
                id: "the_chain_technologies",
                name: "The Chain Technologies",
                label: "AI Solutions",
                price: 1500,
                status: "Active",
                analysis: { buyerProfile: "Primary Tenant", objectionType: "None", concessionStep: "Stable" }
            });
        }

        res.json(clients);
    } catch (err) {
        console.error("Clients API Error:", err);
        res.json([
            { id: "the_chain_technologies", name: "The Chain Technologies", label: "AI Solutions", price: 1500, status: "Active", analysis: { buyerProfile: "Primary Tenant", objectionType: "None", concessionStep: "Stable" } }
        ]);
    }
});

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

// RESTORED UNIFIED INBOX & CONVERSATIONS API
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

// ROBUST FINALIZE BOOKING WITH GUARANTEED EMAIL & VAULT PERSISTENCE
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
        service: session.lead?.service || "Consultation",
        date,
        time,
        fullName: session.lead?.fullName || "Valued Customer",
        phone: session.lead?.phone || "",
        email: session.lead?.email || "",
        channel: session.channel || "website",
        calendarEventCreated
    };

    await appendTenantLog(tenantId, "bookings.json", bookingRecord);

    if (session.lead?.email) {
        try {
            await emailTransporter.sendMail({
                from: `"The Chain" <${process.env.SMTP_USER}>`,
                to: session.lead.email,
                subject: `Booking Confirmed: ${bookingRecord.service}`,
                html: `
                    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 25px; border: 1px solid #eaeaea; border-radius: 10px; background: #ffffff;">
                        <h2 style="color: #111; text-align: center; margin-bottom: 20px;">Appointment Confirmed!</h2>
                        <p style="font-size: 16px; color: #333;">Hi <strong>${bookingRecord.fullName}</strong>,</p>
                        <p style="font-size: 15px; color: #555; line-height: 1.5;">Your appointment has been successfully booked and added to our calendar.</p>
                        <table style="width: 100%; background: #f9f9f9; padding: 15px; border-radius: 8px; margin: 20px 0; border-collapse: collapse;">
                            <tr><td style="padding: 8px 0; color: #666;"><strong>Date:</strong></td><td style="padding: 8px 0; text-align: right; color: #111;">${date}</td></tr>
                            <tr><td style="padding: 8px 0; color: #666;"><strong>Time:</strong></td><td style="padding: 8px 0; text-align: right; color: #111;">${time}</td></tr>
                        </table>
                        <p style="font-size: 13px; color: #777; text-align: center;">We look forward to seeing you!</p>
                    </div>
                `
            });
            console.log("Confirmation email successfully dispatched to:", session.lead.email);
        } catch (mailErr) {
            console.error("CRITICAL EMAIL ERROR:", mailErr);
        }
    }

    return bookingRecord;
}

// NATURAL DYNAMIC CONVERSATION ENGINE (RESTORED NATURAL RECEPTIONIST BEHAVIOR)
const processValMessage = async (tenantId, sessionId, messageText, channel = "website") => {
    let sessionVault = await getTenantFile(tenantId, "vault.json", null);
    if (!sessionVault) sessionVault = INITIAL_VAULT;

    if (!sessionVault[sessionId]) {
        sessionVault[sessionId] = {
            id: sessionId, name: "Visitor", label: "Chat", channel: channel,
            startedAt: new Date().toISOString(), price: 0, status: "Active",
            lead: { fullName: "", phone: "", email: "", service: "", preferredDate: "", preferredTime: "" },
            history: [],
            analysis: { buyerProfile: "Unknown", objectionType: "Unknown", concessionStep: "None" }
        };
    }

    const session = sessionVault[sessionId];
    session.channel = channel;
    session.lastUpdated = new Date().toISOString();

    if (!session.lead) session.lead = { fullName: "", phone: "", email: "", service: "", preferredDate: "", preferredTime: "" };

    const lowerMessage = messageText.toLowerCase();

    // Natural data extraction
    const emailMatch = messageText.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    if (emailMatch) session.lead.email = emailMatch[0];

    const phoneMatch = messageText.match(/\+?[0-9][0-9\s\-]{7,}/);
    if (phoneMatch) session.lead.phone = phoneMatch[0];

    // Contextual name extraction if missing
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

        let cleanReply = fullReply.replace(/\[\[.*?\]\]/g, "").trim();

        // Check what info is still missing to ensure natural conversational flow
        const hasName = !!session.lead.fullName;
        const hasPhone = !!session.lead.phone;
        const hasEmail = !!session.lead.email;

        // If user wants to book or talk about booking, guide them naturally step-by-step
        if (lowerMessage.includes("book") || lowerMessage.includes("appointment") || session.isBookingFlow) {
            session.isBookingFlow = true;

            if (!hasName) {
                cleanReply = "I'd love to help you book an appointment! May I please have your full name?";
            } else if (!hasPhone) {
                cleanReply = `Thanks, ${session.lead.fullName}. What is the best phone number to reach you?`;
            } else if (!hasEmail) {
                cleanReply = "Got it. Lastly, what is your email address so we can send you the calendar confirmation?";
            }
        }

        // Once ALL info is gathered, trigger website modal or WhatsApp slot picker
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
        session.history = [session.history[0], ...session.history.slice(-8)];

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

    try {
        await finalizeBooking(tenantId, session, date, time);
        session.status = "Booked";
        session.lastUpdated = new Date().toISOString();
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