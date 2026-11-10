import { Parser } from "htmlparser2";

export interface Extracted {
  title?: string;
  description?: string;
  canonical?: string;
  robots?: string;
  h1: string[];
  links: string[]; // raw hrefs, resolved later against the page URL
  imagesWithoutAlt: number;
  baseHref?: string;
  nofollow: boolean;
}

/**
 * SAX-style extractor: HTML is fed chunk by chunk as it arrives and
 * nothing builds a DOM, so a 10 MB page costs about as much memory as a
 * 10 KB one. Only the handful of fields we audit are kept.
 */
export function createExtractor() {
  const out: Extracted = { h1: [], links: [], imagesWithoutAlt: 0, nofollow: false };
  let inTitle = false;
  let inH1 = 0;
  let h1Text = "";
  let titleText = "";
  let inBody = false;

  const parser = new Parser(
    {
      onopentag(name, attrs) {
        switch (name) {
          case "title":
            // <title> inside an inline <svg> is not the page title
            if (!inBody && out.title === undefined) inTitle = true;
            break;
          case "body":
            inBody = true;
            break;
          case "meta": {
            const key = (attrs.name ?? "").toLowerCase();
            if (key === "description" && out.description === undefined) out.description = (attrs.content ?? "").trim();
            if (key === "robots") {
              out.robots = (attrs.content ?? "").toLowerCase();
              if (out.robots.includes("nofollow")) out.nofollow = true;
            }
            break;
          }
          case "link":
            if ((attrs.rel ?? "").toLowerCase().split(/\s+/).includes("canonical") && attrs.href) out.canonical = attrs.href.trim();
            break;
          case "base":
            if (attrs.href && !out.baseHref) out.baseHref = attrs.href;
            break;
          case "a":
            if (attrs.href && !(attrs.rel ?? "").toLowerCase().includes("nofollow")) out.links.push(attrs.href);
            break;
          case "img":
            if (attrs.alt === undefined) out.imagesWithoutAlt++;
            break;
          case "h1":
            inH1++;
            h1Text = "";
            break;
        }
      },
      ontext(text) {
        if (inTitle) titleText += text;
        if (inH1) h1Text += text;
      },
      onclosetag(name) {
        if (name === "title" && inTitle) {
          inTitle = false;
          out.title = clean(titleText);
        }
        if (name === "h1" && inH1) {
          inH1--;
          out.h1.push(clean(h1Text));
        }
      },
    },
    { decodeEntities: true, lowerCaseTags: true },
  );

  return {
    write: (chunk: string) => parser.write(chunk),
    end(): Extracted {
      parser.end();
      return out;
    },
  };
}

const clean = (s: string) => s.replace(/\s+/g, " ").trim();

/** Convenience for tests and small pages. */
export function extract(html: string): Extracted {
  const ex = createExtractor();
  ex.write(html);
  return ex.end();
}
