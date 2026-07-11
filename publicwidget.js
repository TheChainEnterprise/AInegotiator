// public/publicwidget.js
// Updated to use the centralized apiClient for multi-tenant support

async function sendMessage(sessionId, message) {
    // Using the centralized wrapper
    const data = await apiClient.post('/api/chat', { sessionId, message });
    
    console.log("Response from server:", data);
    updateUI(data); 
}

async function loadClients() {
    // Using the centralized wrapper
    const clients = await apiClient.get('/api/clients');
    console.log("Client List:", clients);
    renderClientList(clients);
}

async function toggleOverride(sessionId, mode) {
    const data = await apiClient.post('/api/override', { sessionId, mode });
    console.log("Override status:", data.status);
}

// Ensure you include both files in your HTML:
// <script src="apiClient.js"></script>
// <script src="publicwidget.js"></script>