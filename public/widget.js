(function() {
    // Your specific live Render URL
    const serverUrl = "https://ai-receptionist-negotiator.onrender.com"; 
    const tenantId = document.currentScript.getAttribute('data-tenant-id');

    const script = document.createElement('script');
    script.src = `${serverUrl}/widget-engine.js`;
    script.dataset.tenantId = tenantId;
    script.dataset.serverUrl = serverUrl;
    document.body.appendChild(script);
})();