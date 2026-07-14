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

async function crawlWebsite(startUrl) {

    console.log("Starting website crawl:", startUrl);

    const visited = new Set();

    const pages = [];

    const queue = [startUrl];

    const origin = new URL(startUrl).origin;

    while (queue.length > 0 && visited.size < 10) {

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

            $("a").each((_, el) => {

                const href = $(el).attr("href");

                if (!href) return;

                try {

                    const next = new URL(href, origin).href;

                    if (
                        next.startsWith(origin) &&
                        !visited.has(next) &&
                        !queue.includes(next)
                    ) {
                        queue.push(next);
                    }

                } catch {}

            });

        } catch (err) {

            console.log("Skipped:", url);

        }

    }

    return pages
        .map(page =>

`================================================
PAGE
${page.url}
================================================

${page.content}

`
        )
        .join("\n");

}

module.exports = {
    crawlWebsite
};