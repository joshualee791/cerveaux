"use client";

import { useCallback, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneLight } from "react-syntax-highlighter/dist/esm/styles/prism";

const sanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    code: [
      ...((defaultSchema.attributes &&
        Array.isArray(defaultSchema.attributes.code) &&
        defaultSchema.attributes.code) ||
        []),
      "className",
    ],
    pre: [
      ...((defaultSchema.attributes &&
        Array.isArray(defaultSchema.attributes.pre) &&
        defaultSchema.attributes.pre) ||
        []),
      "className",
    ],
  },
};

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const onCopy = useCallback(() => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    });
  }, [text]);

  return (
    <button
      type="button"
      onClick={onCopy}
      className="absolute right-2 top-2 z-10 rounded border border-neutral-300 bg-white px-2 py-1 text-xs font-medium text-neutral-700 shadow-sm hover:bg-neutral-50"
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

type CodeProps = {
  className?: string;
  children?: ReactNode;
};

function MarkdownCode({ className, children }: CodeProps) {
  const match = /language-(\w+)/.exec(className ?? "");
  const codeStr = String(children).replace(/\n$/, "");

  if (!match) {
    return (
      <code className="rounded bg-neutral-100 px-1 py-0.5 font-mono text-[0.9em] text-neutral-900">
        {children}
      </code>
    );
  }

  const language = match[1];

  return (
    <div className="relative my-2 overflow-x-auto rounded-md border border-neutral-200 bg-neutral-50">
      <CopyButton text={codeStr} />
      <SyntaxHighlighter
        language={language}
        style={oneLight}
        PreTag="div"
        customStyle={{
          margin: 0,
          padding: "1rem",
          paddingRight: "4.5rem",
          background: "transparent",
          fontSize: "0.8125rem",
        }}
      >
        {codeStr}
      </SyntaxHighlighter>
    </div>
  );
}

type Props = {
  content: string;
  className?: string;
};

/**
 * Markdown + GFM for user and assistant messages; streaming partial text re-renders incrementally.
 */
export function MessageContent({ content, className }: Props) {
  return (
    <div
      className={
        className ??
        "prose prose-sm max-w-none text-neutral-900 prose-p:my-2 prose-pre:my-0 prose-pre:bg-transparent prose-pre:p-0 prose-code:before:content-none prose-code:after:content-none"
      }
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeSanitize, sanitizeSchema]]}
        components={{
          pre: ({ children }) => <>{children}</>,
          code: MarkdownCode,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
