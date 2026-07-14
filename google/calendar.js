const { google } = require("googleapis");

const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
);

function getAuthUrl(state) {

    return oauth2Client.generateAuthUrl({

        access_type: "offline",

        prompt: "consent",

        scope: [
            "https://www.googleapis.com/auth/calendar"
        ],

        state,

    });

}

async function exchangeCodeForTokens(code) {

    const { tokens } = await oauth2Client.getToken(code);

    return tokens;

}

module.exports = {
    getAuthUrl,
    exchangeCodeForTokens,
};