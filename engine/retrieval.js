// CHANGED: this file no longer reads files from disk itself.
// Whoever calls it now passes in the already-loaded services/faq/knowledge
// arrays (loaded from MongoDB by index.js). This file only scores and ranks —
// it never needs to know where the data came from.

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

// CHANGED: takes services/faq/knowledge arrays directly instead of a tenantDir path
function retrieveRelevantKnowledge({
    services = [],
    faq = [],
    knowledge = [],
    message,
    limit = 5
}) {

    const results = [];

    const lower = message.toLowerCase();

    // CHANGED: maps the old filenames to the in-memory arrays passed in
    const sources = {
        "services.json": services,
        "faq.json": faq,
        "knowledge.json": knowledge
    };

    let fileOrder = [
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

        fileOrder = [
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

        fileOrder = [
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

        fileOrder = [
            "knowledge.json",
            "faq.json",
            "services.json"
        ];

    }

    for (const file of fileOrder) {

        const data = sources[file] || [];

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
