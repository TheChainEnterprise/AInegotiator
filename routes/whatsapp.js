// routes/whatsapp.js
//
// Handles Meta's WhatsApp Cloud API webhook:
//   - GET  /webhook/whatsapp  -> verification handshake (Meta calls this once, when you click "Verify and save")
//   - POST /webhook/whatsapp  -> incoming messages from real users
//
// Mount this in your main server file (see instructions below the file).

const express = require("express");
const router = express.Router();

const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;
const ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;
const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;

// ---- 1. Verification handshake (Meta calls this automatically) ----
router.get("/webhook/whatsapp", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("WhatsApp webhook verified successfully.");
    return res.status(200).send(challenge);
  }

  console.log("WhatsApp webhook verification failed.");
  return res.sendStatus(403);
});

// ---- 2. Incoming messages ----
router.post("/webhook/whatsapp", async (req, res) => {
  // Always respond 200 immediately so Meta doesn't retry/timeout.
  res.sendStatus(200);

  try {
    const entry = req.body.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    const message = value?.messages?.[0];

    if (!message) {
      // This is likely a status update (delivered/read), not a new message. Ignore it.
      return;
    }

    const fromNumber = message.from; // sender's WhatsApp number
    const textBody = message.text?.body;

    console.log(`Incoming WhatsApp message from ${fromNumber}: ${textBody}`);

    if (!textBody) return; // skip non-text messages for now (images, audio, etc.)

    // TODO: plug this into your existing Val conversation logic.
    // For now, this sends back a simple placeholder reply.
    const replyText = `Val here — I got your message: "${textBody}"`;

    await sendWhatsAppMessage(fromNumber, replyText);
  } catch (err) {
    console.error("Error handling WhatsApp webhook:", err);
  }
});

// ---- 3. Helper to send a message back out via the Cloud API ----
async function sendWhatsAppMessage(toNumber, text) {
  const url = `https://graph.facebook.com/v21.0/${PHONE_NUMBER_ID}/messages`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: toNumber,
      type: "text",
      text: { body: text },
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    console.error("Failed to send WhatsApp message:", data);
  }
  return data;
}

module.exports = router;
