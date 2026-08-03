async function sendTelegramNotification(message) {

    const webhook = process.env.TELEGRAM_ALERT_WEBHOOK;

    if (!webhook) {
        console.log("Telegram webhook not configured.");
        return;
    }

    try {
        await fetch(
            webhook + encodeURIComponent(message),
            {
                method: "POST"
            }
        );
    } catch (err) {
        console.error("Telegram notification failed:", err);
    }
}

module.exports = {
    sendTelegramNotification
};