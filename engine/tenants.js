const { getDb } = require("./db");

function sanitizeTenantId(tenantId = "default") {
    return String(tenantId)
        .trim()
        .replace(/[<>:"/\\|?*]+/g, "")
        .replace(/\s+/g, "_");
}

// ============================================================
// Single JSON documents (one per tenant per "file")
// e.g. business.json, services.json, faq.json, knowledge.json,
// availability.json, integrations.json, import.json, vault.json
// ============================================================

// Replaces: fs.readFileSync(path to fileName)
async function getTenantFile(tenantId, fileName, defaultValue = {}) {
    const db = getDb();
    const safeTenantId = sanitizeTenantId(tenantId);
    const doc = await db
        .collection("tenant_files")
        .findOne({ tenantId: safeTenantId, fileName });
    return doc ? doc.data : defaultValue;
}

// Replaces: fs.writeFileSync(path to fileName, JSON.stringify(data))
async function setTenantFile(tenantId, fileName, data) {
    const db = getDb();
    const safeTenantId = sanitizeTenantId(tenantId);
    await db.collection("tenant_files").updateOne(
        { tenantId: safeTenantId, fileName },
        { $set: { tenantId: safeTenantId, fileName, data, updatedAt: new Date() } },
        { upsert: true }
    );
}

// NEW: deletes a single file-type document (used by the website-import "reset" button)
async function deleteTenantFile(tenantId, fileName) {
    const db = getDb();
    const safeTenantId = sanitizeTenantId(tenantId);
    await db.collection("tenant_files").deleteOne({ tenantId: safeTenantId, fileName });
}

// NEW: wipes EVERYTHING for one tenant (used when an admin deletes a client entirely)
async function deleteTenantData(tenantId) {
    const db = getDb();
    const safeTenantId = sanitizeTenantId(tenantId);
    await db.collection("tenant_files").deleteMany({ tenantId: safeTenantId });
    await db.collection("tenant_logs").deleteMany({ tenantId: safeTenantId });
}

// ============================================================
// Append-only logs (leads.json, bookings.json, audit.json,
// deals.json, training_data.json)
// ============================================================

// Replaces: fs.appendFileSync(path, JSON.stringify(entry) + "\n")
async function appendTenantLog(tenantId, fileName, entry) {
    const db = getDb();
    const safeTenantId = sanitizeTenantId(tenantId);
    await db.collection("tenant_logs").insertOne({
        tenantId: safeTenantId,
        fileName,
        entry,
        createdAt: new Date()
    });
}

// Replaces: reading the whole line-delimited file and reversing it (newest first)
async function getTenantLog(tenantId, fileName) {
    const db = getDb();
    const safeTenantId = sanitizeTenantId(tenantId);
    const docs = await db
        .collection("tenant_logs")
        .find({ tenantId: safeTenantId, fileName })
        .sort({ createdAt: -1 })
        .toArray();
    return docs.map((doc) => doc.entry);
}

// Replaces: rewriting the whole file with one entry updated, matched by entry.id
async function updateTenantLogEntry(tenantId, fileName, id, updates) {
    const db = getDb();
    const safeTenantId = sanitizeTenantId(tenantId);
    const setFields = {};
    for (const [key, value] of Object.entries(updates)) {
        setFields[`entry.${key}`] = value;
    }
    const result = await db.collection("tenant_logs").findOneAndUpdate(
        { tenantId: safeTenantId, fileName, "entry.id": id },
        { $set: setFields },
        { returnDocument: "after" }
    );
    return result?.value?.entry || null;
}

// Replaces: rewriting the whole file with one entry removed, matched by entry.id
async function deleteTenantLogEntry(tenantId, fileName, id) {
    const db = getDb();
    const safeTenantId = sanitizeTenantId(tenantId);
    await db.collection("tenant_logs").deleteOne({
        tenantId: safeTenantId,
        fileName,
        "entry.id": id
    });
}

// ============================================================
// Admin: list every tenant that exists
// ============================================================

// Replaces: fs.readdirSync(clientsRoot) to find every client folder
async function listTenantIds() {
    const db = getDb();
    return db
        .collection("tenant_files")
        .distinct("tenantId", { fileName: "business.json" });
}

module.exports = {
    sanitizeTenantId,
    getTenantFile,
    setTenantFile,
    deleteTenantFile,
    deleteTenantData,
    appendTenantLog,
    getTenantLog,
    updateTenantLogEntry,
    deleteTenantLogEntry,
    listTenantIds
};
