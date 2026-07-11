// public/apiClient.js
// Centralized API wrapper to handle multi-tenant headers automatically

const TENANT_ID = 'client-abc'; // Change this per client or pull from a global UI config

const apiClient = {
    async post(endpoint, data) {
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-tenant-id': TENANT_ID
            },
            body: JSON.stringify(data)
        });
        return await response.json();
    },

    async get(endpoint) {
        const response = await fetch(endpoint, {
            method: 'GET',
            headers: {
                'x-tenant-id': TENANT_ID
            }
        });
        return await response.json();
    }
};