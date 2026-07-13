import sanitizeHtml from "sanitize-html";

const options: sanitizeHtml.IOptions = {
  allowedTags: [
    "p",
    "br",
    "strong",
    "b",
    "em",
    "i",
    "u",
    "s",
    "h2",
    "h3",
    "ul",
    "ol",
    "li",
    "blockquote",
    "a",
    "code",
    "pre",
  ],
  allowedAttributes: {
    a: ["href", "target", "rel"],
  },
  allowedSchemes: ["http", "https", "mailto"],
  allowedSchemesAppliedToAttributes: ["href"],
  transformTags: {
    a: (_tagName, attributes) => ({
      tagName: "a",
      attribs: {
        ...attributes,
        target: "_blank",
        rel: "noopener noreferrer nofollow",
      },
    }),
  },
};

export function sanitizeRichText(value: unknown, max = 20_000): string {
  if (typeof value !== "string") return "";
  const clean = sanitizeHtml(value.trim().slice(0, max * 4), options);
  if (clean.length <= max) return clean;
  return sanitizeHtml(clean.slice(0, max), options);
}

export function richTextToPlainText(value: string): string {
  return sanitizeHtml(value, {
    allowedTags: [],
    allowedAttributes: {},
  })
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
