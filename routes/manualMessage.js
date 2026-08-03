// routes/manualMessage.js
const express = require("express");
const router = express.Router();

router.post("/api/send-manual-message", async (req, res) => {
    const { toNumber, messageText } = req.body;
    const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
    const ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;

    if (!toNumber || !messageText) {
        return res.status(400).json({ success: false, error: "Missing toNumber or messageText" });
    }

    const url = `https://graph.facebook.com/v21.0/${PHONE_NUMBER_ID}/messages`;

    try {
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
                text: { body: messageText }
            })
        });

        const data = await response.json();
        if (!response.ok) {
            return res.status(400).json({ success: false, error: data });
        }

        return res.json({ success: true, data });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;