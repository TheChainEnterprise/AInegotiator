// engine/whatsappRegistry.js
//
// Lets multiple clients each have their own WhatsApp number, all pointing
// at the SAME webhook URL. When a message comes in, we look at which
// phone_number_id it came from and match it to the correct tenant's
// stored credentials in MongoDB (integrations.json).
//
// This means: onboarding a new client's WhatsApp = saving their
// phoneNumberId/businessAccountId/accessToken into their integrations.json.
// No code changes, no redeploys, no new environment variables.

const { getTenantFile, listTenantIds } = require("./tenants");

// Find which tenant owns a given WhatsApp phone_number_id.
// Returns null if no tenant has that number configured yet.
async function findTenantIdByPhoneNumberId(phoneNumberId) {
    const tenantIds = await listTenantIds();

    for (const tenantId of tenantIds) {
        const integrations = await getTenantFile(tenantId, "integrations.json", null);
        if (integrations?.whatsapp?.phoneNumberId === phoneNumberId) {
            return tenantId;
        }
    }

    return null;
}

// Get the WhatsApp credentials to use for a given tenant.
// Falls back to the global environment variables if the tenant
// hasn't been set up individually yet (useful for "The Chain" itself
// while you're still testing).
async function getWhatsAppCredentials(tenantId) {
    const integrations = await getTenantFile(tenantId, "integrations.json", null);
    const wa = integrations?.whatsapp || {};

    return {
        phoneNumberId: wa.phoneNumberId || process.env.WHATSAPP_PHONE_NUMBER_ID,
        accessToken: wa.accessToken || process.env.WHATSAPP_ACCESS_TOKEN
    };
}

// Send a WhatsApp message using the correct tenant's own credentials.
async function sendWhatsAppMessageForTenant(tenantId, toNumber, text) {
    const { phoneNumberId, accessToken } = await getWhatsAppCredentials(tenantId);

    if (!phoneNumberId || !accessToken) {
        console.error(`No WhatsApp credentials available for tenant "${tenantId}".`);
        return { error: "Missing WhatsApp credentials for this tenant." };
    }

    const url = `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`;

    const response = await fetch(url, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            messaging_product: "whatsapp",
            to: toNumber,
            type: "text",
            text: { body: text }
        })
    });

    const data = await response.json();

    if (!response.ok) {
        console.error("Failed to send WhatsApp message:", JSON.stringify(data));
    }

    return data;
}

module.exports = {
    findTenantIdByPhoneNumberId,
    getWhatsAppCredentials,
    sendWhatsAppMessageForTenant
};