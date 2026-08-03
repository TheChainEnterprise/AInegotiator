// routes/whatsapp.js
const express = require("express");
const router = express.Router();
const { processValMessage } = require("../services/valEngine");

const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;
const ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;
const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;

router.get("/webhook/whatsapp", (req, res) => {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode === "subscribe" && token === VERIFY_TOKEN) {
        return res.status(200).send(challenge);
    }
    return res.sendStatus(403);
});

router.post("/webhook/whatsapp", async (req, res) => {
    res.sendStatus(200);

    console.log("📥 WHATSAPP WEBHOOK RECEIVED");

    try {
        const entry = req.body.entry?.[0];
        const change = entry?.changes?.[0];
        const value = change?.value;
        const message = value?.messages?.[0];

        if (!message || !message.text?.body) {
            return;
        }

        const fromNumber = message.from;
        const textBody = message.text?.body;
        const tenantId = process.env.DEFAULT_TENANT_ID || "default";

        console.log(`Processing message from ${fromNumber}: "${textBody}"`);

        const replyText = await processValMessage(tenantId, fromNumber, textBody);

        await sendWhatsAppMessage(fromNumber, replyText);
        console.log("✅ Reply sent successfully.");

    } catch (err) {
        console.error("❌ WhatsApp webhook error:", err);
    }
});

async function sendWhatsAppMessage(toNumber, text) {
    const url = `https://graph.facebook.com/v21.0/${PHONE_NUMBER_ID}/messages`;

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
            text: { body: text }
        })
    });

    return await response.json();
}

module.exports = router;