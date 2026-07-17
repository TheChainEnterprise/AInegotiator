const axios = require("axios");
const cheerio = require("cheerio");
const TurndownService = require("turndown");

const turndown = new TurndownService();

async function downloadPage(url) {

    const response = await axios.get(url, {
        timeout: 15000,
        headers: {
            "User-Agent": "The Chain Technologies Website Importer"
        }
    });

    return response.data;

}

function cleanHtml(html) {

    const $ = cheerio.load(html);

    $("script").remove();
    $("style").remove();
    $("noscript").remove();
    $("svg").remove();
    $("header").remove();
    $("footer").remove();
    $("nav").remove();

    return {
        $,
        text: turndown
            .turndown($("body").html() || "")
            .replace(/\n{3,}/g, "\n\n")
            .trim()
    };

}

async function discoverSitemap(origin) {

    try {

        console.log("Checking sitemap...");

        const response = await axios.get(
            `${origin}/sitemap.xml`,
            {
                timeout: 10000
            }
        );

        const matches = [
            ...response.data.matchAll(/<loc>(.*?)<\/loc>/g)
        ];

        const urls = matches.map(match => match[1]);

        console.log(`Found ${urls.length} sitemap URLs`);

        return urls;

    } catch {

        console.log("No sitemap found.");

        return [];

    }

}

async function crawlWebsite(startUrl) {

    console.log("Starting website crawl:", startUrl);

    if (!/^https?:\/\//i.test(startUrl)) {
        startUrl = `https://${startUrl}`;
    }

    const visited = new Set();

    const pages = [];

    const queue = [startUrl];

    const origin = new URL(startUrl).origin;

    // -------------------------
    // Discover sitemap pages
    // -------------------------

    const sitemapPages = await discoverSitemap(origin);

    for (const page of sitemapPages) {

        if (!queue.includes(page)) {
            queue.push(page);
        }

    }

    while (queue.length > 0 && visited.size < 20) {

        const url = queue.shift();

        if (!url || visited.has(url)) {
            continue;
        }

        visited.add(url);

        try {

            console.log("Crawling:", url);

            const html = await downloadPage(url);

            const { $, text } = cleanHtml(html);

            pages.push({
                url,
                content: text
            });

            console.log("\n==============================");
            console.log(url);
            console.log(text.substring(0, 2500));
            console.log("==============================\n");

            $("a").each((_, el) => {

                const href = $(el).attr("href");

                if (!href) return;

                try {

                    const next = new URL(href, origin).href;

                    const important = [

                        "/about",

                        "/service",
                        "/services",

                        "/treatment",
                        "/treatments",

                        "/price",
                        "/prices",
                        "/pricing",
                        "/price-list",
                        "/fees",
                        "/cost",
                        "/costs",
                        "/package",
                        "/packages",
                        "/offer",
                        "/offers",
                        "/promotion",
                        "/promotions",

                        "/faq",
                        "/questions",

                        "/contact"

                    ];

                    if (

                        next.startsWith(origin) &&
                        !visited.has(next) &&
                        !queue.includes(next) &&
                        (

                            next === origin ||
                            next === origin + "/" ||

                            important.some(path =>
                                next.toLowerCase().includes(path)
                            )

                        )

                    ) {

                        queue.push(next);

                    }

                } catch {}

            });

        }

        catch {

            console.log("Skipped:", url);

        }

    }

    const priority = [

        "/price",
        "/prices",
        "/pricing",
        "/price-list",
        "/fees",
        "/cost",
        "/package",
        "/packages",

        "/faq",

        "/service",
        "/services",

        "/treatment",
        "/treatments",

        "/about",

        "/contact"

    ];

    pages.sort((a, b) => {

        const score = url => {

            const lower = url.toLowerCase();

            const index = priority.findIndex(path =>
                lower.includes(path)
            );

            return index === -1 ? 999 : index;

        };

        return score(a.url) - score(b.url);

    });

    console.log(`Collected ${pages.length} pages.`);

    return pages;

}

module.exports = {
    crawlWebsite
};