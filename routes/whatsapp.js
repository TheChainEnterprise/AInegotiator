// routes/whatsapp.js
//
// Handles Meta's WhatsApp Cloud API webhook:
//   - GET  /webhook/whatsapp  -> verification handshake
//   - POST /webhook/whatsapp  -> incoming WhatsApp events
//
// One webhook URL serves every client's WhatsApp number. The correct
// tenant is resolved dynamically from MongoDB based on which phone
// number the message came in on.

const express = require("express");
const router = express.Router();
const { processValMessage } = require("../services/valEngine");
const { findTenantIdByPhoneNumberId, sendWhatsAppMessageForTenant } = require("../engine/whatsappRegistry");

const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;

// ========================================================
// 1. META WEBHOOK VERIFICATION
// ========================================================

router.get("/webhook/whatsapp", (req, res) => {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

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

    try {
        const entry = req.body.entry?.[0];
        const change = entry?.changes?.[0];
        const value = change?.value;
        const message = value?.messages?.[0];
        const incomingPhoneNumberId = value?.metadata?.phone_number_id;

        if (!message) {
            console.log("ℹ️ No incoming user message (likely a status update). Ignoring.");
            return;
        }

        const fromNumber = message.from;
        const textBody = message.text?.body;

        if (!textBody) {
            console.log("Skipping non-text message.");
            return;
        }

        console.log(`📥 WhatsApp message from ${fromNumber} on number ${incomingPhoneNumberId}: "${textBody}"`);

        let tenantId = await findTenantIdByPhoneNumberId(incomingPhoneNumberId);

        if (!tenantId) {
            tenantId = process.env.DEFAULT_TENANT_ID || "default";
            console.log(`⚠️ No tenant has this WhatsApp number configured yet. Falling back to tenant "${tenantId}".`);
        }

        const replyText = await processValMessage(tenantId, fromNumber, textBody, "whatsapp");

        if (!replyText) {
            console.log("🖐️ Manual override is active for this conversation — Val is staying silent.");
            return;
        }

        await sendWhatsAppMessageForTenant(tenantId, fromNumber, replyText);

        console.log("✅ Reply sent successfully.");

    } catch (err) {
        console.error("❌ WhatsApp webhook error:", err);
    }
});

module.exports = router;