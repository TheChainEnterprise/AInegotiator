(function() {
    // Locate the script tag that loaded this engine to extract settings
    const scriptTag = document.querySelector('script[src*="widget-engine.js"]');
    const serverUrl = scriptTag ? scriptTag.dataset.serverUrl : "https://ai-receptionist-negotiator.onrender.com";
    const tenantId = scriptTag ? scriptTag.dataset.tenantId : "clinic-01";
    
    // Generate a unique session ID for this visitor if one doesn't exist
    const sessionId = 'session-' + Math.random().toString(36).substr(2, 9);

    // Create the chat bubble and window
    const div = document.createElement('div');
    div.innerHTML = `
        <div id="ai-chat-bubble" style="position:fixed; bottom:20px; right:20px; cursor:pointer; background:#000; color:#fff; padding:15px; border-radius:50px; z-index:9999;">Chat</div>
        <div id="ai-chat-window" style="display:none; position:fixed; bottom:80px; right:20px; width:300px; height:400px; background:#fff; border:1px solid #ccc; padding:10px; z-index:9999; box-shadow:0 0 10px rgba(0,0,0,0.2);">
            <input id="ai-chat-input" type="text" style="width:100%" placeholder="Type a message...">
            <button id="ai-chat-send" style="margin-top:5px;">Send</button>
            <div id="ai-chat-output" style="margin-top:10px; font-size:14px; height:300px; overflow-y:auto;"></div>
        </div>
    `;
    document.body.appendChild(div);

    // Chat UI Toggle
    document.getElementById('ai-chat-bubble').onclick = () => {
        const window = document.getElementById('ai-chat-window');
        window.style.display = window.style.display === 'none' ? 'block' : 'none';
    };

    // Chat Logic
    document.getElementById('ai-chat-send').onclick = async () => {
        const input = document.getElementById('ai-chat-input');
        const output = document.getElementById('ai-chat-output');
        const msg = input.value;
        if (!msg) return;
        
        output.innerHTML += `<div><b>You:</b> ${msg}</div>`;
        input.value = "";
        output.innerText = "Thinking...";
        
        try {
            const res = await fetch(`${serverUrl}/api/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-tenant-id': tenantId },
                body: JSON.stringify({ sessionId: sessionId, message: msg })
            });
            const data = await res.json();
            output.innerHTML = `<div><b>AI:</b> ${data.response}</div>`;
        } catch (err) {
            output.innerText = "Error connecting to server.";
            console.error(err);
        }
    };
})();