const fs = require("fs");
const path = require("path");
const { google } = require("googleapis");
const { getTenantDir } = require("../engine/tenants");

function getCalendarClient(tenantId) {

    const tokenFile = path.join(
        getTenantDir(tenantId),
        "google.json"
    );

    if (!fs.existsSync(tokenFile)) {
        throw new Error("Google Calendar not connected.");
    }

    const tokens = JSON.parse(
        fs.readFileSync(tokenFile, "utf8")
    );

    const oauth2Client = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        process.env.GOOGLE_REDIRECT_URI
    );

    oauth2Client.setCredentials(tokens);

    return google.calendar({
        version: "v3",
        auth: oauth2Client,
    });

}

async function getCalendars(tenantId) {

    const calendar = getCalendarClient(tenantId);

    const res = await calendar.calendarList.list();

    return res.data.items || [];

}

module.exports = {
    getCalendarClient,
    getCalendars,
};