import MarkdownIt from "markdown-it";

// Raw HTML is escaped, and MarkdownIt's default unsafe-URL validation stays on.
// This module runs during SSG only. Never pass unprocessed Markdown to set:html.
const markdown = new MarkdownIt({
  html: false,
  linkify: false,
  typographer: false,
});

export function renderMarkdown(source: string): string {
  return markdown.render(source);
}
