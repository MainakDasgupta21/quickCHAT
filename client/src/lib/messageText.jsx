import React, { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";

const MARKDOWN_HIGHLIGHT_CLASS = "bg-brand-200/35 text-white px-0.5 rounded-[4px]";
const SAFE_LINK_PROTOCOLS = new Set(["http:", "https:", "mailto:", "tel:"]);

const sanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...(defaultSchema.attributes || {}),
    a: [...(defaultSchema.attributes?.a || []), ["target"], ["rel"]],
  },
};

const escapeRegex = (value = "") => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const toSafeHref = (hrefValue = "") => {
  const href = String(hrefValue || "").trim();
  if (!href) return "";
  if (href.startsWith("/") || href.startsWith("#")) return href;
  try {
    const parsedUrl = new URL(href);
    if (!SAFE_LINK_PROTOCOLS.has(parsedUrl.protocol)) return "";
    return href;
  } catch {
    return "";
  }
};

const highlightPlainText = (textValue, queryValue) => {
  const sourceText = String(textValue || "");
  const cleanedQuery = String(queryValue || "").trim();
  if (!cleanedQuery) return sourceText;

  const splitMatcher = new RegExp(`(${escapeRegex(cleanedQuery)})`, "gi");
  const exactMatcher = new RegExp(`^${escapeRegex(cleanedQuery)}$`, "i");

  return sourceText.split(splitMatcher).map((chunk, chunkIndex) =>
    exactMatcher.test(chunk) ? (
      <mark key={`${chunk}-${chunkIndex}`} className={MARKDOWN_HIGHLIGHT_CLASS}>
        {chunk}
      </mark>
    ) : (
      <React.Fragment key={`${chunk}-${chunkIndex}`}>{chunk}</React.Fragment>
    )
  );
};

const highlightMarkdownChildren = (childrenValue, queryValue, shouldSkip = false) => {
  if (!childrenValue || !queryValue || shouldSkip) return childrenValue;

  return React.Children.map(childrenValue, (child) => {
    if (typeof child === "string" || typeof child === "number") {
      return highlightPlainText(String(child), queryValue);
    }

    if (!React.isValidElement(child)) {
      return child;
    }

    const childType = typeof child.type === "string" ? child.type.toLowerCase() : "";
    const skipWithinChild = shouldSkip || childType === "code" || childType === "pre";
    if (skipWithinChild) return child;

    const highlightedChildren = highlightMarkdownChildren(
      child.props?.children,
      queryValue,
      skipWithinChild
    );
    return React.cloneElement(child, undefined, highlightedChildren);
  });
};

const MessageText = ({ text = "", highlightQuery = "", className = "", isOwn = false }) => {
  const normalizedText = String(text || "");
  const normalizedHighlightQuery = String(highlightQuery || "").trim();

  const components = useMemo(
    () => ({
      p: ({ children }) => (
        <p className="whitespace-pre-wrap break-words">
          {highlightMarkdownChildren(children, normalizedHighlightQuery)}
        </p>
      ),
      li: ({ children }) => (
        <li>{highlightMarkdownChildren(children, normalizedHighlightQuery)}</li>
      ),
      a: ({ href, children }) => {
        const safeHref = toSafeHref(href);
        const sharedClass = isOwn
          ? "underline decoration-white/70 underline-offset-2 hover:text-white"
          : "underline decoration-brand-200/60 underline-offset-2 hover:text-brand-100";

        if (!safeHref) {
          return <span>{highlightMarkdownChildren(children, normalizedHighlightQuery)}</span>;
        }

        return (
          <a
            href={safeHref}
            target="_blank"
            rel="noopener noreferrer"
            className={sharedClass}
            onClick={(event) => event.stopPropagation()}
          >
            {highlightMarkdownChildren(children, normalizedHighlightQuery)}
          </a>
        );
      },
      pre: ({ children }) => <pre className="message-md-pre">{children}</pre>,
      code: ({ inline, children, className: codeClassName = "" }) => {
        if (inline) {
          return (
            <code className="message-md-code-inline">
              {Array.isArray(children) ? children.join("") : children}
            </code>
          );
        }
        return (
          <code className={`message-md-code-block ${codeClassName}`.trim()}>
            {Array.isArray(children) ? children.join("") : children}
          </code>
        );
      },
      blockquote: ({ children }) => (
        <blockquote className="message-md-blockquote">
          {highlightMarkdownChildren(children, normalizedHighlightQuery)}
        </blockquote>
      ),
    }),
    [isOwn, normalizedHighlightQuery]
  );

  if (!normalizedText.trim()) return null;

  return (
    <div className={`message-md ${className}`.trim()}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeSanitize, sanitizeSchema]]}
        components={components}
      >
        {normalizedText}
      </ReactMarkdown>
    </div>
  );
};

export default React.memo(MessageText);
