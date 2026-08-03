// routes/whatsapp.js
//
// Handles Meta's WhatsApp Cloud API webhook:
//   - GET  /webhook/whatsapp  -> verification handshake
//   - POST /webhook/whatsapp  -> incoming WhatsApp events

const express = require("express");
const router = express.Router();

// Import Val's core engine function from index.js
const { processValMessage } = require("../index");

const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;
const ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;
const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;

// ========================================================
// 1. META WEBHOOK VERIFICATION
// ========================================================

router.get("/webhook/whatsapp", (req, res) => {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    console.log("========================================");
    console.log("📲 WhatsApp Verification Request");
    console.log("Mode:", mode);
    console.log("Token:", token);
    console.log("========================================");

    if (mode === "subscribe" && token === VERIFY_TOKEN) {
        console.log("✅ WhatsApp webhook verified successfully.");
        return res.status(200).send(challenge);
    }

    console.log("❌ WhatsApp webhook verification failed.");
    return res.sendStatus(403);
});

// ========================================================
// 2. INCOMING WEBHOOK EVENTS
// ========================================================

router.post("/webhook/whatsapp", async (req, res) => {
    // Always acknowledge Meta immediately so it doesn't timeout.
    res.sendStatus(200);

    console.log("");
    console.log("==================================================");
    console.log("📥 WHATSAPP WEBHOOK RECEIVED");
    console.log("Time:", new Date().toISOString());
    console.log("==================================================");
    console.log(JSON.stringify(req.body, null, 2));
    console.log("==================================================");

    try {
        const entry = req.body.entry?.[0];
        const change = entry?.changes?.[0];
        const value = change?.value;
        const message = value?.messages?.[0];

        if (!message) {
            console.log("ℹ️ No incoming user message.");
            if (value?.statuses) {
                console.log("Status update:");
                console.log(JSON.stringify(value.statuses, null, 2));
            }
            return;
        }

        const fromNumber = message.from;
        const messageType = message.type;
        const textBody = message.text?.body;

        console.log("");
        console.log("========== MESSAGE ==========");
        console.log("From :", fromNumber);
        console.log("Type :", messageType);
        console.log("Text :", textBody);
        console.log("=============================");

        if (!textBody) {
            console.log("Skipping non-text message.");
            return;
        }

        const tenantId = process.env.DEFAULT_TENANT_ID || "default";

        console.log("Processing message through Val's engine for WhatsApp...");

        // Call Val's core engine function directly
        const replyText = await processValMessage(tenantId, fromNumber, textBody);

        console.log("Val's response generated. Replying to WhatsApp...");
        console.log(replyText);

        await sendWhatsAppMessage(fromNumber, replyText);

        console.log("✅ Reply sent successfully.");

    } catch (err) {
        console.error("");
        console.error("========================================");
        console.error("❌ WhatsApp webhook error");
        console.error(err);
        console.error("========================================");
    }
});

// ========================================================
// 3. SEND MESSAGE
// ========================================================

async function sendWhatsAppMessage(toNumber, text) {
    const url = `https://graph.facebook.com/v21.0/${PHONE_NUMBER_ID}/messages`;

    console.log("");
    console.log("Sending WhatsApp message...");
    console.log("To:", toNumber);

    const response = await fetch(url, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${ACCESS_TOKEN}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            messaging_product: "whatsapp",
            to: toNumber,
            type: "text",
            text: {
                body: text
            }
        })
    });

    const data = await response.json();

    if (!response.ok) {
        console.error("");
        console.error("❌ Failed sending WhatsApp message");
        console.error(JSON.stringify(data, null, 2));
    } else {
        console.log("✅ Meta accepted outgoing message.");
        console.log(JSON.stringify(data, null, 2));
    }

    return data;
}

module.exports = router;
