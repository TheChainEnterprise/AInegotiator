// engine/googleCalendar.js
//
// Handles Google Calendar OAuth per tenant, and creates calendar events
// when a booking completes through Val.
const moment = require('moment');
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

// Build the URL to send a client to so they can connect their Google Calendar.
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

// Called when Google redirects back after the client approves access.
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

// Create a calendar event once a booking is complete.
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

const getAvailableSlots = async (tenantId, dateStr) => {
    try {
        const auth = await getAuthorizedClient(tenantId); 
        if (!auth) return ["10:00 AM", "01:00 PM", "03:00 PM"]; // Fallback if not connected

        const calendar = google.calendar({ version: 'v3', auth });

        const timeMin = moment(dateStr).hour(9).minute(0).second(0).toISOString();
        const timeMax = moment(dateStr).hour(17).minute(0).second(0).toISOString();

        const check = await calendar.freebusy.query({
            requestBody: {
                timeMin,
                timeMax,
                timeZone: 'UTC',
                items: [{ id: 'primary' }]
            }
        });

        const busyTimes = check.data.calendars.primary.busy || [];

        const allSlots = ["10:00 AM", "11:00 AM", "01:00 PM", "02:00 PM", "03:00 PM", "04:00 PM"];
        const freeSlots = [];

        for (const slotStr of allSlots) {
            const slotStart = moment(`${dateStr} ${slotStr}`, "YYYY-MM-DD hh:mm A");
            const slotEnd = moment(slotStart).add(1, 'hour');

            const isBusy = busyTimes.some(busy => {
                const bStart = moment(busy.start);
                const bEnd = moment(busy.end);
                return slotStart.isBefore(bEnd) && slotEnd.isAfter(bStart);
            });

            if (!isBusy && slotStart.isAfter(moment())) {
                freeSlots.push(slotStr);
            }
        }

        return freeSlots;
    } catch (error) {
        console.error("FreeBusy Error:", error);
        return ["10:00 AM", "01:00 PM", "03:00 PM"]; 
    }
};

module.exports = {
    getAuthUrl,
    handleOAuthCallback,
    isCalendarConnected,
    createCalendarEvent,
    getAvailableSlots
};