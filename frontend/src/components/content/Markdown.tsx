import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";

export default function Markdown({ children }: { children: string }) {
  return (
    <div className="prose">
      <ReactMarkdown
        skipHtml
        disallowedElements={["img"]}
        remarkPlugins={[remarkGfm]}
        // The default filter excludes tel:; retain it for all other URLs.
        urlTransform={(url) =>
          /^tel:/i.test(url) ? url : defaultUrlTransform(url)
        }
        components={{
          h1: ({ children }) => <h2>{children}</h2>,
          a: ({ href, children }) => {
            const external = /^(https?:)?\/\//i.test(href ?? "");
            return (
              <a
                href={href || undefined}
                target={external ? "_blank" : undefined}
                rel={external ? "noopener noreferrer" : undefined}
              >
                {children}
              </a>
            );
          },
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
