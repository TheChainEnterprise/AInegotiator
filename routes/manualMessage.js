// routes/manualMessage.js
const express = require("express");
const router = express.Router();

// 1. Serve the UI on /inbox
router.get("/inbox", (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>WhatsApp Direct Messenger</title>
            <style>
                body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background: #111b21; color: #e9edef; padding: 20px; margin: 0; }
                .card { background: #202c33; padding: 30px; border-radius: 8px; max-width: 500px; margin: 40px auto; box-shadow: 0 4px 12px rgba(0,0,0,0.4); }
                h2 { margin-top: 0; color: #00a884; }
                label { display: block; margin: 15px 0 5px; font-size: 14px; color: #8696a0; }
                input, textarea { width: 100%; padding: 12px; box-sizing: border-box; background: #2a3942; border: 1px solid #3b4a54; color: #e9edef; border-radius: 6px; font-size: 15px; }
                input:focus, textarea:focus { outline: none; border-color: #00a884; }
                button { margin-top: 20px; width: 100%; padding: 14px; background: #00a884; border: none; color: #111b21; font-weight: bold; border-radius: 6px; cursor: pointer; font-size: 16px; }
                button:hover { background: #029071; }
                #status { margin-top: 15px; font-weight: bold; text-align: center; font-size: 14px; }
            </style>
        </head>
        <body>
            <div class="card">
                <h2>WhatsApp Direct Messenger</h2>
                <label>Client Phone Number (With Country Code, e.g., 66886675802):</label>
                <input type="text" id="phone" placeholder="e.g., 66886675802">

                <label>Message:</label>
                <textarea id="message" rows="5" placeholder="Type your message here..."></textarea>

                <button onclick="sendMessage()">Send Message</button>
                <div id="status"></div>
            </div>

            <script>
                async function sendMessage() {
                    const toNumber = document.getElementById("phone").value.trim();
                    const messageText = document.getElementById("message").value.trim();
                    const statusDiv = document.getElementById("status");

                    if (!toNumber || !messageText) {
                        statusDiv.style.color = "#ea4335";
                        statusDiv.innerText = "Please enter both phone number and message.";
                        return;
                    }

                    statusDiv.style.color = "#fbbc05";
                    statusDiv.innerText = "Sending message...";

                    try {
                        const res = await fetch("/api/send-manual-message", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ toNumber, messageText })
                        });

                        const data = await res.json();
                        if (data.success) {
                            statusDiv.style.color = "#00a884";
                            statusDiv.innerText = "✅ Message delivered successfully!";
                            document.getElementById("message").value = "";
                        } else {
                            statusDiv.style.color = "#ea4335";
                            statusDiv.innerText = "❌ Error: " + (data.error?.error?.message || JSON.stringify(data.error));
                        }
                    } catch (err) {
                        statusDiv.style.color = "#ea4335";
                        statusDiv.innerText = "❌ Failed to reach server.";
                    }
                }
            </script>
        </body>
        </html>
    `);
});

// 2. Handle POST API requests
router.post("/api/send-manual-message", async (req, res) => {
    const { toNumber, messageText } = req.body;
    const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
    const ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;

    if (!toNumber || !messageText) {
        return res.status(400).json({ success: false, error: "Missing required fields" });
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