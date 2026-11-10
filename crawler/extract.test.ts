import { describe, expect, it } from "vitest";
import { createExtractor, extract } from "./extract";

const html = `<!doctype html><html><head>
<title>  Handmade  mugs &amp; bowls </title>
<meta name="description" content="Clay mugs made in Tbilisi">
<meta name="robots" content="index, follow">
<link rel="canonical" href="https://example.com/mugs">
</head><body>
<svg><title>icon</title></svg>
<h1>Mugs</h1>
<a href="/mugs/1">one</a><a href="https://other.com" rel="nofollow">x</a><a href="/mugs/2">two</a>
<img src="a.jpg" alt="Mug"><img src="b.jpg"><img src="c.jpg" alt="">
</body></html>`;

describe("extract", () => {
  it("pulls the audited fields", () => {
    const ex = extract(html);
    expect(ex.title).toBe("Handmade mugs & bowls");
    expect(ex.description).toBe("Clay mugs made in Tbilisi");
    expect(ex.canonical).toBe("https://example.com/mugs");
    expect(ex.h1).toEqual(["Mugs"]);
    expect(ex.links).toEqual(["/mugs/1", "/mugs/2"]); // nofollow skipped
    expect(ex.imagesWithoutAlt).toBe(1); // alt="" is valid for decorative images
  });

  it("gives the same result when HTML arrives in tiny chunks", () => {
    const ex = createExtractor();
    for (let i = 0; i < html.length; i += 7) ex.write(html.slice(i, i + 7));
    expect(ex.end()).toEqual(extract(html));
  });

  it("detects meta nofollow", () => {
    expect(extract('<meta name="robots" content="noindex,nofollow">').nofollow).toBe(true);
  });
});
