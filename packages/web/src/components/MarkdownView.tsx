import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

interface MarkdownViewProps {
  source: string | null | undefined;
  className?: string;
}

/** Raw HTML in the source is dropped (`skipHtml`), so plan files cannot inject markup or scripts. */
export function MarkdownView({ source, className }: MarkdownViewProps) {
  return (
    <div className={`min-w-0 break-words text-xs text-slate-300 ${className ?? ""}`}>
      <Markdown remarkPlugins={[remarkGfm]} skipHtml components={components}>
        {source ?? ""}
      </Markdown>
    </div>
  );
}

const components: Components = {
  h1: ({ children }) => (
    <h1 className="mb-2 mt-4 border-b border-slate-800 pb-1 text-base font-semibold text-slate-100 first:mt-0">
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2 className="mb-2 mt-4 text-sm font-semibold text-slate-100 first:mt-0">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="mb-1.5 mt-3 text-xs font-semibold text-slate-200 first:mt-0">{children}</h3>
  ),
  h4: ({ children }) => <h4 className="mb-1 mt-3 text-xs font-medium text-slate-300 first:mt-0">{children}</h4>,
  h5: ({ children }) => <h5 className="mb-1 mt-3 text-xs font-medium text-slate-300 first:mt-0">{children}</h5>,
  h6: ({ children }) => <h6 className="mb-1 mt-3 text-xs font-medium text-slate-400 first:mt-0">{children}</h6>,
  p: ({ children }) => <p className="my-2 leading-relaxed first:mt-0 last:mb-0">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold text-slate-100">{children}</strong>,
  em: ({ children }) => <em className="italic text-slate-200">{children}</em>,
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-indigo-400 underline underline-offset-2 transition hover:text-indigo-300"
    >
      {children}
    </a>
  ),
  ul: ({ className, children }) => (
    <ul className={`my-2 list-disc space-y-1 pl-5 marker:text-slate-500 [&.contains-task-list]:list-none [&.contains-task-list]:pl-0 ${className ?? ""}`}>
      {children}
    </ul>
  ),
  ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-5 marker:text-slate-500">{children}</ol>,
  li: ({ className, children }) => <li className={`pl-0.5 ${className ?? ""}`}>{children}</li>,
  input: ({ type, checked }) =>
    type === "checkbox" ? (
      <input
        type="checkbox"
        checked={checked}
        disabled
        readOnly
        className="mr-1.5 translate-y-px accent-indigo-500"
      />
    ) : null,
  blockquote: ({ children }) => (
    <blockquote className="my-2 border-l-2 border-indigo-500/50 pl-3 italic text-slate-400">{children}</blockquote>
  ),
  hr: () => <hr className="my-3 border-slate-800" />,
  table: ({ children }) => (
    <div className="my-2 overflow-x-auto rounded-lg border border-slate-800">
      <table className="w-full border-collapse text-left text-[11px]">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-surface-850">{children}</thead>,
  th: ({ children }) => <th className="border-b border-slate-800 px-2 py-1.5 font-semibold text-slate-200">{children}</th>,
  td: ({ children }) => <td className="border-t border-slate-800/60 px-2 py-1.5 align-top text-slate-300">{children}</td>,
  pre: ({ children }) => (
    <pre className="my-2 overflow-x-auto rounded-lg border border-slate-800 bg-surface-950 p-3 font-mono text-[11px] leading-relaxed text-slate-300 [&>code]:bg-transparent [&>code]:p-0 [&>code]:text-slate-300">
      {children}
    </pre>
  ),
  code: ({ className, children }) => (
    <code className={`rounded bg-slate-800 px-1 py-0.5 font-mono text-[11px] text-indigo-200 ${className ?? ""}`}>
      {children}
    </code>
  ),
  img: ({ alt }) => <span className="italic text-slate-500">[obraz: {alt || "bez opisu"}]</span>,
};
