const fs = require("fs");
const path = require("path");

const SYNONYMS = {
    price: [
        "price",
        "pricing",
        "cost",
        "costs",
        "fee",
        "fees",
        "monthly",
        "setup",
        "install",
        "installation"
    ],

    booking: [
        "book",
        "booking",
        "appointment",
        "appointments",
        "schedule",
        "demo"
    ]
};

function expandWords(words) {

    const expanded = new Set(words);

    for (const word of words) {

        for (const group of Object.values(SYNONYMS)) {

            if (group.includes(word)) {

                group.forEach(w => expanded.add(w));

            }

        }

    }

    return [...expanded];

}

function score(text, query) {

    const content = text.toLowerCase();

    const words = expandWords(

        query
            .toLowerCase()
            .split(/\s+/)
            .filter(Boolean)

    );

    let score = 0;

    for (const word of words) {

        if (content.includes(word)) {

            score++;

        }

    }

    // Boost title / question / name matches

    try {

        const item = JSON.parse(text);

        const title = (
            item.title ||
            item.question ||
            item.name ||
            ""
        ).toLowerCase();

        for (const word of words) {

            if (title.includes(word)) {

                score += 5;

            }

        }

    } catch {}

    return score;

}

function retrieveRelevantKnowledge({
    tenantDir,
    message,
    limit = 5
}) {

    const results = [];

    const lower = message.toLowerCase();

    let files = [
        "services.json",
        "faq.json",
        "knowledge.json"
    ];

    // Pricing intent

    if (

        lower.includes("price") ||
        lower.includes("pricing") ||
        lower.includes("cost") ||
        lower.includes("fee") ||
        lower.includes("monthly") ||
        lower.includes("setup") ||
        lower.includes("how much")

    ) {

        files = [
            "services.json",
            "faq.json",
            "knowledge.json"
        ];

    }

    // Booking intent

    else if (

        lower.includes("book") ||
        lower.includes("booking") ||
        lower.includes("appointment") ||
        lower.includes("demo")

    ) {

        files = [
            "faq.json",
            "services.json",
            "knowledge.json"
        ];

    }

    // General information intent

    else if (

        lower.includes("what is") ||
        lower.includes("who are") ||
        lower.includes("mission") ||
        lower.includes("vision") ||
        lower.includes("technology") ||
        lower.includes("technologies")

    ) {

        files = [
            "knowledge.json",
            "faq.json",
            "services.json"
        ];

    }

    for (const file of files) {

        const filePath = path.join(
            tenantDir,
            file
        );

        if (!fs.existsSync(filePath))
            continue;

        let data = [];

        try {

            data = JSON.parse(
                fs.readFileSync(
                    filePath,
                    "utf8"
                )
            );

        } catch {

            continue;

        }

        for (const item of data) {

            const text = JSON.stringify(item);

            let relevance = score(
                text,
                message
            );

            // ============================
            // Intent-based source weighting
            // ============================

            if (

                lower.includes("price") ||
                lower.includes("pricing") ||
                lower.includes("cost") ||
                lower.includes("fee") ||
                lower.includes("monthly") ||
                lower.includes("setup") ||
                lower.includes("how much")

            ) {

                if (file === "services.json") {

                    relevance += 100;

                }

            }

            else if (

                lower.includes("book") ||
                lower.includes("booking") ||
                lower.includes("appointment") ||
                lower.includes("demo")

            ) {

                if (file === "knowledge.json") {

                    relevance += 100;

                }

            }

            else if (

                lower.includes("what is") ||
                lower.includes("who are") ||
                lower.includes("technology") ||
                lower.includes("technologies") ||
                lower.includes("mission") ||
                lower.includes("vision")

            ) {

                if (file === "knowledge.json") {

                    relevance += 50;

                }

                if (file === "faq.json") {

                    relevance += 25;

                }

            }

            if (relevance > 0) {

                results.push({
                    relevance,
                    source: file,
                    item
                });

            }

        }

    }

    results.sort((a, b) => b.relevance - a.relevance);

    return results.slice(0, limit);

}

module.exports = {
    retrieveRelevantKnowledge
};