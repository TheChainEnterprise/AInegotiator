const { Groq } = require("groq-sdk");

const groq = new Groq({
    apiKey: process.env.GROQ_API_KEY
});

/**
 * Determines what kind of page we're looking at.
 */
function determinePageType(url) {

    const u = url.toLowerCase();

    if (u.includes("faq") || u.includes("questions"))
        return "faq";

    if (
        u.includes("service") ||
        u.includes("services") ||
        u.includes("pricing") ||
        u.includes("price") ||
        u.includes("treatment") ||
        u.includes("treatments")
    )
        return "services";

    if (
        u.includes("about") ||
        u.includes("our-story")
    )
        return "about";

    if (
        u.includes("contact")
    )
        return "contact";

    if (
        u.endsWith("/") ||
        u.includes("home")
    )
        return "home";

    return "general";

}

/**
 * Builds a page-specific prompt.
 */
function buildPrompt(pageType) {

    let instructions = `
- Never invent information.
- Leave missing fields blank.
`;

if (pageType === "services") {

    instructions += `
This is a SERVICES or TREATMENT page.

Extract EVERY individual service or treatment.

For each service extract:

- name
- description
- price
- monthly

PRICE RULES

If a number appears to be the treatment price, extract it even if there is:

- no € symbol
- no $ symbol
- no currency text
- only a plain number

Examples:

50
100
850
1200
1499
2990

are all valid prices.

Do NOT invent prices.

If multiple prices exist for one treatment, use the primary advertised price.

If no price exists, leave it blank.

Ignore navigation, breadcrumbs, reviews, menus, buttons and unrelated marketing sections.

Create ONE service object per treatment.
`;

}
    if (pageType === "faq") {

        instructions += `
This is a FAQ page.

Extract every FAQ exactly as written.

Every question must have its matching answer.

Ignore all marketing text.
`;

    }

    if (pageType === "about") {

        instructions += `
This is an ABOUT page.

Extract:

- Business description
- Company history
- Team
- Mission
- Vision
- Certifications
- Awards

Everything else becomes Knowledge.
`;

    }

    if (pageType === "contact") {

        instructions += `
This is a CONTACT page.

Extract:

- phone
- email
- address
- website
- opening hours

Ignore everything else.
`;

    }

if (
    pageType === "home" ||
    pageType === "general"
) {

    instructions += `
Extract useful BUSINESS knowledge only.

Include:

- business facts
- technologies
- treatment explanations
- processes
- guarantees
- certifications
- patient information
- company philosophy
- important policies

DO NOT include:

- navigation menus
- breadcrumbs
- sitemap entries
- URLs
- timestamps
- image filenames
- category names
- "Last updated"
- page metadata
- repeated headings
- cookie notices
- footer text
- contact links
- accommodation lists
- doctor directories unless they contain meaningful information

Every knowledge entry should teach the AI something useful when answering customer questions.

Each knowledge article should have:

- a short descriptive title
- concise content (2-8 sentences)

Do not copy large sections of the page verbatim.
`;

}

    return `
You are an expert business analyst.

Return ONLY valid JSON.

{
  "business":{
    "businessName":"",
    "industry":"",
    "description":"",
    "website":"",
    "email":"",
    "phone":"",
    "address":""
  },

  "services":[
    {
      "name":"",
      "description":"",
      "price":"",
      "monthly":""
    }
  ],

  "faq":[
    {
      "question":"",
      "answer":""
    }
  ],

  "knowledge":[
    {
      "title":"",
      "content":""
    }
  ]
}

${instructions}
`;

}

/**
 * Extract structured data from one page.
 */
async function extractFromPage(page) {

    const pageType = determinePageType(page.url);

    try {

        const completion = await groq.chat.completions.create({

            model: "llama-3.1-8b-instant",

            temperature: 0.1,

            response_format: {
                type: "json_object"
            },

            messages: [

                {
                    role: "system",
                    content: buildPrompt(pageType)
                },

                {
                    role: "user",
                    content:
`URL:
${page.url}

CONTENT:

${page.content.substring(0, 12000)}`
                }

            ]

        });

        return JSON.parse(
            completion.choices[0].message.content
        );

    }

    catch (err) {

        console.error(
            `Failed processing ${page.url}`,
            err.message
        );

        return {
            business: {},
            services: [],
            faq: [],
            knowledge: []
        };

    }

}

/**
 * Merge all extracted pages.
 */
async function processWebsiteContent(pages) {

    console.log(`Processing ${pages.length} pages...`);

    const finalData = {

        business: {},

        services: [],

        faq: [],

        knowledge: []

    };

    for (const page of pages) {

        await new Promise(resolve =>
            setTimeout(resolve, 1500)
        );

        console.log("Extracting:", page.url);

        const data = await extractFromPage(page);

        for (const [key, value] of Object.entries(data.business || {})) {

            if (
                value &&
                String(value).trim() !== ""
            ) {
                finalData.business[key] = value;
            }

        }

        if (Array.isArray(data.services)) {
            finalData.services.push(...data.services);
        }

        if (Array.isArray(data.faq)) {
            finalData.faq.push(...data.faq);
        }

        if (Array.isArray(data.knowledge)) {
            finalData.knowledge.push(...data.knowledge);
        }

    }

const dedupe = (arr, key) =>
    Array.from(
        new Map(
            arr
                .filter(item => {
                    const value = item[key];

                    return (
                        value &&
                        String(value).trim() !== ""
                    );
                })
                .map(item => [
                    item[key].toLowerCase(),
                    item
                ])
        ).values()
    );

const cleanKnowledge = (items) =>
    items.filter(item => {

        if (!item?.title || !item?.content)
            return false;

        const title = item.title.trim().toLowerCase();
        const content = item.content.trim().toLowerCase();

        // Ignore tiny entries
        if (content.length < 80)
            return false;

        // Ignore sitemap / metadata
        if (
            title.includes("sitemap") ||
            title.includes("category") ||
            title.includes("tag") ||
            title.includes("author") ||
            title.includes("page") ||
            title.includes("home") ||
            title.includes("menu")
        )
            return false;

        // Ignore pages that are mostly URLs
        if ((content.match(/https?:\/\//g) || []).length > 2)
            return false;

        // Ignore image filenames
        if (
            content.includes(".jpg") ||
            content.includes(".png") ||
            content.includes(".webp") ||
            content.includes("wp-content")
        )
            return false;

        return true;
    });

return {

    business: finalData.business,

    services: dedupe(
        finalData.services,
        "name"
    ),

    faq: dedupe(
        finalData.faq,
        "question"
    ),

    knowledge: cleanKnowledge(
        dedupe(
            finalData.knowledge,
            "title"
        )
    )

};

}

module.exports = {
    processWebsiteContent
};