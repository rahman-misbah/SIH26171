console.log("Browser Agent content script loaded.");

const elements = Array.from(document.querySelectorAll("*"));

const sample = elements.slice(0, 10).map((element, index) => ({
    id: index,
    tag: element.tagName.toLowerCase(),
    text: element.textContent?.trim() || null
}));

console.log(
    JSON.stringify(
        {
            title: document.title,
            url: window.location.href,
            elementCount: elements.length,
            sample
        },
        null,
        2
    )
);