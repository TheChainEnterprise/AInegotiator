// services/valEngine.js
// Standalone core processing engine for Val to prevent circular imports

async function processValMessage(tenantId, senderId, messageText) {
    // Ensure your main index module or database helper handles the actual AI logic here,
    // or call your existing processing logic directly.
    console.log(`[ValEngine] Processing message for tenant: ${tenantId}, from: ${senderId}`);
    
    // Fallback or hook into your core handler logic
    const indexModule = require("../index");
    if (typeof indexModule.processValMessage === "function" && indexModule.processValMessage !== processValMessage) {
        return await indexModule.processValMessage(tenantId, senderId, messageText);
    }

    // Default response if core function is missing
    return "Hello! I am Val, representing The Chain Technologies. How can I help you today?";
}

module.exports = { processValMessage };