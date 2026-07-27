(() => {
  "use strict";
  const script = document.currentScript;
  const tenant = script?.dataset.tenant?.trim();
  if (!tenant || !/^[a-z0-9_-]{1,80}$/i.test(tenant)) { console.error("The Chain widget needs a valid data-tenant value."); return; }
  
  const host = new URL(script.src).origin;
  const label = script.dataset.label?.trim() || "Chat with us";
  const position = script.dataset.position === "left" ? "left" : "right";
  
  // New: Grab custom color attributes if the client provides them
  const primaryColor = script.dataset.primaryColor?.trim() || "";
  const textColor = script.dataset.textColor?.trim() || "";

  const frameUrl = new URL("/deploy/", host);
  frameUrl.searchParams.set("tenant", tenant);
  frameUrl.searchParams.set("label", label);
  frameUrl.searchParams.set("position", position);
  
  if (primaryColor) frameUrl.searchParams.set("primary", primaryColor);
  if (textColor) frameUrl.searchParams.set("text", textColor);

  const frame = document.createElement("iframe");
  frame.src = frameUrl.toString();
  frame.title = label;
  frame.setAttribute("aria-label", label);
  frame.style.cssText = ["position:fixed", "bottom:16px", `${position}:16px`, "width:76px", "height:76px", "border:0", "background:transparent", "box-shadow:none", "z-index:2147483000", "overflow:hidden"].join(";");
  
  window.addEventListener("message", (event) => {
    if (event.data?.source !== "the-chain-deploy-widget") return;
    const open = Boolean(event.data.open);
    frame.style.width = open ? "min(390px, calc(100vw - 32px))" : "76px";
    frame.style.height = open ? "min(610px, calc(100vh - 32px))" : "76px";
  });
  
  document.body.appendChild(frame);
})();
```[cite: 3]

---

### Step 2: Make `deploy/index.html` read those custom colors
Inside your **`deploy/index.html`**, add a small script snippet that checks the URL parameters for custom colors and applies them dynamically to the chat elements:

```javascript
// Add this right after you read your URL parameters inside index.html:
const urlParams = new URLSearchParams(location.search);
const customPrimary = urlParams.get("primary");
const customText = urlParams.get("text");

if (customPrimary) {
  document.documentElement.style.setProperty("--chat-primary", customPrimary);
}
if (customText) {
  document.documentElement.style.setProperty("--chat-text", customText);
}