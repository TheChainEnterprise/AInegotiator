const fs = require("fs");
const path = require("path");

const getTenantDir = (tenantId = "default") => {
    const dir = path.join(__dirname, "..", "data", tenantId);

    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }

    return dir;
};

const getVaultPath = (tenantId = "default") =>
    path.join(getTenantDir(tenantId), "vault.json");

module.exports = {
    getTenantDir,
    getVaultPath,
};