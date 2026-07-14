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


    const clientsDir = path.join(
        __dirname,
        "..",
        "data",
        "clients",
        safeTenantId
    );


    const legacyDir = path.join(
        __dirname,
        "..",
        "data",
        safeTenantId
    );


    // Prefer new multi-tenant structure
    if (fs.existsSync(clientsDir)) {
        return clientsDir;
    }


    // Backwards compatibility
    if (fs.existsSync(legacyDir)) {
        return legacyDir;
    }


    // New clients always go here
    fs.mkdirSync(clientsDir, {
        recursive: true,
    });


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