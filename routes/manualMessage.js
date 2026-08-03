// routes/manualMessage.js
const express = require("express");
const router = express.Router();

// ------------------------------------------------------------------
// Simple password protection (HTTP Basic Auth), shared across all
// admin-only pages and endpoints. Exported so index.js can reuse it
// on /api/admin/conversations and /api/override.
// ------------------------------------------------------------------
function requireInboxAuth(req, res, next) {
    if (!process.env.INBOX_PASSWORD) {
        return res.status(500).send("INBOX_PASSWORD is not set in Render environment variables.");
    }

    const auth = req.headers.authorization;
    const expected = "Basic " + Buffer.from(`admin:${process.env.INBOX_PASSWORD}`).toString("base64");

    if (auth === expected) {
        return next();
    }

    res.set("WWW-Authenticate", 'Basic realm="Val Inbox"');
    return res.status(401).send("Authentication required.");
}

// ------------------------------------------------------------------
// 1. Serve the control page at /inbox
// ------------------------------------------------------------------
router.get("/inbox", requireInboxAuth, (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Val - Conversation Control</title>
            <style>
                body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background: #111b21; color: #e9edef; padding: 20px; margin: 0; }
                .card { background: #202c33; padding: 30px; border-radius: 8px; max-width: 500px; margin: 40px auto; box-shadow: 0 4px 12px rgba(0,0,0,0.4); }
                h2 { margin-top: 0; color: #00a884; }
                p.hint { color: #8696a0; font-size: 13px; margin-top: -10px; }
                label { display: block; margin: 15px 0 5px; font-size: 14px; color: #8696a0; }
                input, textarea { width: 100%; padding: 12px; box-sizing: border-box; background: #2a3942; border: 1px solid #3b4a54; color: #e9edef; border-radius: 6px; font-size: 15px; }
                input:focus, textarea:focus { outline: none; border-color: #00a884; }
                .row { display: flex; gap: 10px; margin-top: 20px; }
                button { flex: 1; padding: 14px; border: none; border-radius: 6px; cursor: pointer; font-size: 15px; font-weight: bold; }
                .send-btn { background: #00a884; color: #111b21; }
                .send-btn:hover { background: #029071; }
                .pause-btn { background: #f0932b; color: #111b21; }
                .pause-btn:hover { background: #d1791a; }
                .resume-btn { background: #3b4a54; color: #e9edef; }
                .resume-btn:hover { background: #4a5a66; }
                #status { margin-top: 15px; font-weight: bold; text-align: center; font-size: 14px; }
            </style>
        </head>
        <body>
            <div class="card">
                <h2>Val - Conversation Control</h2>

                <label>Tenant ID (which client/business):</label>
                <input type="text" id="tenant" placeholder="e.g. default">

                <label>Conversation ID:</label>
                <p class="hint">For WhatsApp, this is the client's phone number (e.g. 66886675802). For website chat, it's the session ID.</p>
                <input type="text" id="sessionId" placeholder="e.g. 66886675802">

                <label>Message:</label>
                <textarea id="message" rows="5" placeholder="Type your message here..."></textarea>

                <div class="row">
                    <button class="send-btn" onclick="sendReply()">Send Reply (pauses Val)</button>
                </div>
                <div class="row">
                    <button class="pause-btn" onclick="setOverride('HUMAN')">Pause Val (no message)</button>
                    <button class="resume-btn" onclick="setOverride('AI')">Resume Val</button>
                </div>

                <div id="status"></div>
            </div>

            <script>
                function getInputs() {
                    return {
                        tenant: document.getElementById("tenant").value.trim(),
                        sessionId: document.getElementById("sessionId").value.trim(),
                        message: document.getElementById("message").value.trim()
                    };
                }

                function showStatus(text, color) {
                    const statusDiv = document.getElementById("status");
                    statusDiv.style.color = color;
                    statusDiv.innerText = text;
                }

                async function sendReply() {
                    const { tenant, sessionId, message } = getInputs();

                    if (!tenant || !sessionId || !message) {
                        showStatus("Fill in Tenant ID, Conversation ID, and Message.", "#ea4335");
                        return;
                    }

                    showStatus("Sending...", "#fbbc05");

                    try {
                        const res = await fetch("/api/admin/conversations/" + encodeURIComponent(sessionId) + "/reply", {
                            method: "POST",
                            headers: { "Content-Type": "application/json", "x-tenant-id": tenant },
                            body: JSON.stringify({ message })
                        });

                        const data = await res.json();
                        if (data.success) {
                            showStatus("Message sent. Val is now paused for this conversation.", "#00a884");
                            document.getElementById("message").value = "";
                        } else {
                            showStatus("Error: " + (data.error || JSON.stringify(data)), "#ea4335");
                        }
                    } catch (err) {
                        showStatus("Failed to reach server.", "#ea4335");
                    }
                }

                async function setOverride(mode) {
                    const { tenant, sessionId } = getInputs();

                    if (!tenant || !sessionId) {
                        showStatus("Fill in Tenant ID and Conversation ID.", "#ea4335");
                        return;
                    }

                    showStatus(mode === "HUMAN" ? "Pausing Val..." : "Resuming Val...", "#fbbc05");

                    try {
                        const res = await fetch("/api/override", {
                            method: "POST",
                            headers: { "Content-Type": "application/json", "x-tenant-id": tenant },
                            body: JSON.stringify({ sessionId, mode })
                        });

                        const data = await res.json();
                        if (data.success) {
                            showStatus("Status is now: " + data.status, "#00a884");
                        } else {
                            showStatus("Error: " + (data.error || JSON.stringify(data)), "#ea4335");
                        }
                    } catch (err) {
                        showStatus("Failed to reach server.", "#ea4335");
                    }
                }
            </script>
        </body>
        </html>
    `);
});

module.exports = router;
module.exports.requireInboxAuth = requireInboxAuth;