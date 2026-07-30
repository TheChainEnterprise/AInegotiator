(() => {
  "use strict";
  const script = document.currentScript;
  const tenant = script?.dataset.tenantId?.trim() || script?.dataset.tenant?.trim();
  
  if (!tenant || !/^[a-z0-9_-]{1,80}$/i.test(tenant)) { 
    console.error("The Chain widget needs a valid tenant ID."); 
    return; 
  }
  
  const host = new URL(script.src).origin;
  const label = script.dataset.label?.trim() || "Chat with us";
  const position = script.dataset.position === "left" ? "left" : "right";
  
  const primaryColor = script.dataset.primaryColor?.trim() || "";
  const textColor = script.dataset.textColor?.trim() || "";
  // CHANGED: two new attributes for the whole-widget background, independent of primary/text above
  const panelBg = script.dataset.panelBg?.trim() || "";
  const panelText = script.dataset.panelText?.trim() || "";

  const frameUrl = new URL("/deploy/", host);
  frameUrl.searchParams.set("tenant", tenant);
  frameUrl.searchParams.set("label", label);
  frameUrl.searchParams.set("position", position);
  
  if (primaryColor) frameUrl.searchParams.set("primary", primaryColor);
  if (textColor) frameUrl.searchParams.set("text", textColor);
  // CHANGED: forward the new panel background/text params to the iframe, same pattern as above
  if (panelBg) frameUrl.searchParams.set("panelBg", panelBg);
  if (panelText) frameUrl.searchParams.set("panelText", panelText);

  const frame = document.createElement("iframe");
  frame.src = frameUrl.toString();
  frame.title = label;
  frame.setAttribute("aria-label", label);
  
  // Completely strips out any outer wrapper glow or shadow
  frame.style.cssText = [
    "position: fixed",
    "bottom: 16px",
    `${position}: 16px`,
    "width: 76px",
    "height: 76px",
    "border: 0",
    "background: transparent",
    "box-shadow: none",
    "filter: none",
    "z-index: 2147483000",
    "overflow: hidden"
  ].join(";");
  
  window.addEventListener("message", (event) => {
    if (event.data?.source !== "the-chain-deploy-widget") return;
    const open = Boolean(event.data.open);
    frame.style.width = open ? "min(390px, calc(100vw - 32px))" : "76px";
    frame.style.height = open ? "min(610px, calc(100vh - 32px))" : "76px";
  });
  
  document.body.appendChild(frame);
})();
