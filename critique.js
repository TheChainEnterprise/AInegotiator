// critique.js - Autonomous Revenue Optimizer (Versioned + Multi-Tenant)
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Groq } = require('groq-sdk');

// FIX: Initializing with the same reliable pattern as index.js
const finalApiKey = process.env.GROQ_API_KEY || "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";
const groq = new Groq({ apiKey: finalApiKey });

async function runCritique(tenantId = 'default-clinic') {
    // 1. Define paths based on tenant
    const tenantDir = path.join(__dirname, 'data', tenantId);
    const dealsFile = path.join(tenantDir, 'deals.json');
    const playbooksDir = path.join(__dirname, 'playbooks');
    
    if (!fs.existsSync(dealsFile)) {
        console.log(`❌ No deal data for ${tenantId} to learn from.`);
        return;
    }

    if (!fs.existsSync(playbooksDir)) fs.mkdirSync(playbooksDir);

    // 2. Determine the next version number
    const manifestPath = path.join(playbooksDir, 'manifest.json');
    let nextVersion = 1;
    if (fs.existsSync(manifestPath)) {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        const currentVersion = parseInt(manifest.activeVersion.replace('v', ''));
        nextVersion = currentVersion + 1;
    }
    const versionTag = `v${nextVersion}`;

    console.log(`🚀 Generating new strategy for ${tenantId}: ${versionTag}...`);

    const dealsData = fs.readFileSync(dealsFile, 'utf8');

    const prompt = `
    You are an AI Revenue Optimizer for the clinic: ${tenantId}. Your goal is to maximize the final deal price.
    ANALYSIS:
    Here are the logs of closed deals: ${dealsData}
    TASK:
    1. Identify patterns in 'High-Revenue' vs 'Low-Revenue' deals.
    2. Generate 3 'Self-Improvement Rules'.
    3. Output ONLY JSON: { "dynamicRules": ["Rule 1", "Rule 2", "Rule 3"] }
    `;

    const completion = await groq.chat.completions.create({
        messages: [{ role: "user", content: prompt }],
        model: "llama-3.1-70b-versatile",
        response_format: { type: "json_object" }
    });

    const patch = JSON.parse(completion.choices[0].message.content);

    // 3. Save the new versioned file
    fs.writeFileSync(path.join(playbooksDir, `patch_${versionTag}.json`), JSON.stringify(patch, null, 2));

    // 4. Update the manifest to point to this new version
    fs.writeFileSync(manifestPath, JSON.stringify({ activeVersion: versionTag }, null, 2));

    console.log(`✅ Revenue optimization patch ${versionTag} applied and activated for ${tenantId}!`);
}

// To run this for a specific clinic, use: node critique.js clinic-01
const targetTenant = process.argv[2] || 'default-clinic';
runCritique(targetTenant);