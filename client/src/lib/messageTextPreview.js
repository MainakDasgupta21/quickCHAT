export const stripMarkdownForPreview = (textValue, maxLength = 0) => {
  const sourceText = String(textValue || "");
  if (!sourceText.trim()) return "";

  const plainText = sourceText
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, "$1")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s{0,3}[-*+]\s+/gm, "")
    .replace(/^\s{0,3}\d+\.\s+/gm, "")
    .replace(/^>\s?/gm, "")
    .replace(/[*_~]+/g, "")
    .replace(/\r?\n+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();

  if (!maxLength || plainText.length <= maxLength) return plainText;
  return `${plainText.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
};
