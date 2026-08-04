// engine/googleCalendar.js
//
// Handles Google Calendar OAuth per tenant, creates calendar events,
// and calculates real available booking slots from actual busy/free data.

const { google } = require("googleapis");
const { getTenantFile, setTenantFile } = require("./tenants");

const REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI;

function createOAuthClient() {
    return new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        REDIRECT_URI
    );
}

function getAuthUrl(tenantId) {
    const oauth2Client = createOAuthClient();
    return oauth2Client.generateAuthUrl({
        access_type: "offline",
        prompt: "consent",
        scope: [
            "https://www.googleapis.com/auth/calendar.events",
            "https://www.googleapis.com/auth/calendar.readonly"
        ],
        state: tenantId
    });
}

async function handleOAuthCallback(code, tenantId) {
    const oauth2Client = createOAuthClient();
    const { tokens } = await oauth2Client.getToken(code);

    const integrations = await getTenantFile(tenantId, "integrations.json", {});

    integrations.google = {
        connected: true,
        refreshToken: tokens.refresh_token || integrations.google?.refreshToken,
        calendarId: integrations.google?.calendarId || "primary"
    };

    await setTenantFile(tenantId, "integrations.json", integrations);
}

async function getAuthorizedClient(tenantId) {
    const integrations = await getTenantFile(tenantId, "integrations.json", null);
    const refreshToken = integrations?.google?.refreshToken;

    if (!refreshToken) return null;

    const oauth2Client = createOAuthClient();
    oauth2Client.setCredentials({ refresh_token: refreshToken });
    return oauth2Client;
}

async function isCalendarConnected(tenantId) {
    const integrations = await getTenantFile(tenantId, "integrations.json", null);
    return !!integrations?.google?.refreshToken;
}

async function createCalendarEvent(tenantId, { summary, description, startTime, endTime }) {
    const auth = await getAuthorizedClient(tenantId);

    if (!auth) {
        return { skipped: true, reason: "No calendar connected for this tenant." };
    }

    const integrations = await getTenantFile(tenantId, "integrations.json", {});
    const calendarId = integrations?.google?.calendarId || "primary";

    const calendar = google.calendar({ version: "v3", auth });

    const event = {
        summary,
        description,
        start: { dateTime: startTime },
        end: { dateTime: endTime }
    };

    const res = await calendar.events.insert({
        calendarId,
        requestBody: event
    });

    return res.data;
}

// Returns real available slot start times ("HH:MM", 24hr) for a given tenant
// and date (YYYY-MM-DD), based on their actual Google Calendar busy periods.
// Business hours default to 9am-5pm, 30-minute slots, if not specified.
async function getAvailableSlots(tenantId, dateStr, options = {}) {
    const auth = await getAuthorizedClient(tenantId);
    if (!auth) return [];

    const integrations = await getTenantFile(tenantId, "integrations.json", {});
    const calendarId = integrations?.google?.calendarId || "primary";

    const openHour = options.openHour ?? 9;
    const closeHour = options.closeHour ?? 17;
    const slotMinutes = options.slotMinutes ?? 30;

    const dayStart = new Date(`${dateStr}T00:00:00`);
    const dayEnd = new Date(`${dateStr}T23:59:59`);

    const calendar = google.calendar({ version: "v3", auth });

    const freebusy = await calendar.freebusy.query({
        requestBody: {
            timeMin: dayStart.toISOString(),
            timeMax: dayEnd.toISOString(),
            items: [{ id: calendarId }]
        }
    });

    const busyPeriods = (freebusy.data.calendars[calendarId]?.busy || []).map((b) => ({
        start: new Date(b.start).getTime(),
        end: new Date(b.end).getTime()
    }));

    const slots = [];
    const cursor = new Date(dayStart);
    cursor.setHours(openHour, 0, 0, 0);

    const closeTime = new Date(dayStart);
    closeTime.setHours(closeHour, 0, 0, 0);

    while (cursor < closeTime) {
        const slotStart = cursor.getTime();
        const slotEnd = slotStart + slotMinutes * 60 * 1000;

        const overlapsBusy = busyPeriods.some((b) => slotStart < b.end && slotEnd > b.start);
        const isPast = slotStart < Date.now();

        if (!overlapsBusy && !isPast) {
            const hh = String(cursor.getHours()).padStart(2, "0");
            const mm = String(cursor.getMinutes()).padStart(2, "0");
            slots.push(`${hh}:${mm}`);
        }

        cursor.setMinutes(cursor.getMinutes() + slotMinutes);
    }

    return slots;
}

module.exports = {
    getAuthUrl,
    handleOAuthCallback,
    isCalendarConnected,
    createCalendarEvent,
    getAvailableSlots
};
