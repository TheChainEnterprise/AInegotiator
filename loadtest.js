// loadtest.js
const fetch = require('node-fetch'); // Ensure you run 'npm install node-fetch'

const CLIENTS = 50;
const URL = 'http://localhost:3000/api/chat';

async function simulateClient(id) {
    try {
        const res = await fetch(URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-tenant-id': `test-tenant-${id}` },
            body: JSON.stringify({ sessionId: 'client-xyz', message: 'What is the price?' })
        });
        console.log(`Client ${id}: ${res.status}`);
    } catch (e) {
        console.error(`Client ${id} crashed`);
    }
}

console.log(`🚀 Starting load test for ${CLIENTS} clients...`);
for (let i = 0; i < CLIENTS; i++) {
    simulateClient(i);
}