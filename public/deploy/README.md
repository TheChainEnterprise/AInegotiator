# Deployable widget

This folder is independent from the AI engine. It does not change the API, prompt, tenant data, environment variables, or existing widget files.

After the backend is deployed, give a customer this one line (substitute their tenant id):

```html
<script async src="https://YOUR-RENDER-SERVICE.onrender.com/deploy/widget.js" data-tenant="client_tenant_id"></script>
```

Optional settings:

```html
<script async src="https://YOUR-RENDER-SERVICE.onrender.com/deploy/widget.js" data-tenant="client_tenant_id" data-label="Talk to our team" data-position="left"></script>
```

The customer website only loads the script. The chat interface and the request to `/api/chat` run inside a same-origin iframe hosted by this service.
