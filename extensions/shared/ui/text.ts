export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 3))}...`;
}

export function truncateMultilineText(text: string, maxLines: number, maxLength: number): string {
  const clipped = truncateText(text.trim(), maxLength);
  const lines = clipped.split("\n");
  if (lines.length <= maxLines) return clipped;
  return `${lines.slice(0, maxLines).join("\n")}\n...`;
}
