// services/valEngine.js
// Standalone core processing engine for Val to prevent circular imports

async function processValMessage(tenantId, senderId, messageText, channel = "website") {
    const indexModule = require("../index");
    if (typeof indexModule.processValMessage === "function" && indexModule.processValMessage !== processValMessage) {
        return await indexModule.processValMessage(tenantId, senderId, messageText, channel);
    }

    return "Hello! I am Val, representing The Chain Technologies. How can I help you today?";
}
module.exports = { processValMessage };