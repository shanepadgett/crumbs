function toCodePoint(n: number): string {
  if (!Number.isFinite(n)) return "";
  if (n < 0 || n > 0x10ffff) return "";
  return String.fromCodePoint(n);
}

function decodeHtml(html: string): string {
  return html
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_m, n: string) => toCodePoint(Number.parseInt(n, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, n: string) => toCodePoint(Number.parseInt(n, 16)));
}

function stripNoise(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, "")
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, "")
    .replace(/<object[\s\S]*?<\/object>/gi, "")
    .replace(/<embed[\s\S]*?<\/embed>/gi, "")
    .replace(/<head[\s\S]*?<\/head>/gi, "");
}

export function htmlToText(html: string): string {
  const out = stripNoise(html)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/(div|section|article|header|footer|main|aside|tr)>/gi, "\n")
    .replace(/<\/(h[1-6]|ul|ol|table)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\r/g, "")
    .replace(/\t/g, " ");

  return decodeHtml(out)
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line, idx, list) => line.length > 0 || (idx > 0 && list[idx - 1] !== ""))
    .join("\n")
    .trim();
}

export function htmlToMarkdown(html: string): string {
  const body = stripNoise(html)
    .replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, "\n# $1\n")
    .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, "\n## $1\n")
    .replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, "\n### $1\n")
    .replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, "\n#### $1\n")
    .replace(/<h5[^>]*>([\s\S]*?)<\/h5>/gi, "\n##### $1\n")
    .replace(/<h6[^>]*>([\s\S]*?)<\/h6>/gi, "\n###### $1\n")
    .replace(/<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, "[$2]($1)")
    .replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, "**$1**")
    .replace(/<b[^>]*>([\s\S]*?)<\/b>/gi, "**$1**")
    .replace(/<em[^>]*>([\s\S]*?)<\/em>/gi, "*$1*")
    .replace(/<i[^>]*>([\s\S]*?)<\/i>/gi, "*$1*")
    .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, "`$1`")
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, "\n- $1")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|section|article|header|footer|main|aside|ul|ol|table|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ");

  return decodeHtml(body)
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line, idx, list) => line.length > 0 || (idx > 0 && list[idx - 1] !== ""))
    .join("\n")
    .trim();
}
