const fs = require("fs");
const path = require("path");

function sanitizeTenantId(tenantId = "default") {
    return String(tenantId)
        .trim()
        .replace(/[<>:"/\\|?*]+/g, "")
        .replace(/\s+/g, "_");
}

function getTenantDir(tenantId = "default") {
    const safeTenantId = sanitizeTenantId(tenantId);

    // Project structure:
    // Ai-negotiator/
    // ├── engine/
    // ├── data/
    // └── index.js
    const clientsDir = path.join(
        __dirname,
        "..",
        "data",
        "clients",
        safeTenantId
    );

    // Ensure the tenant directory exists
    if (!fs.existsSync(clientsDir)) {
        try {
            fs.mkdirSync(clientsDir, { recursive: true });
        } catch (err) {
            console.error(
                `Failed to create tenant directory for ${safeTenantId}:`,
                err
            );
        }
    }

    return clientsDir;
}

function getVaultPath(tenantId = "default") {
    return path.join(
        getTenantDir(tenantId),
        "vault.json"
    );
}

module.exports = {
    getTenantDir,
    getVaultPath,
};