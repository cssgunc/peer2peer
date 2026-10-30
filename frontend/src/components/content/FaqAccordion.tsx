import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import type { components } from "@/lib/api-types";

import Markdown from "./Markdown";

export type Faq = components["schemas"]["FaqDTO"];

export default function FaqAccordion({ faqs }: { faqs: Faq[] }) {
  if (faqs.length === 0) return null;

  const groups = new Map<string, Faq[]>();
  for (const faq of faqs) {
    const group = groups.get(faq.category);
    if (group) group.push(faq);
    else groups.set(faq.category, [faq]);
  }

  return (
    <div className="max-w-3xl space-y-8">
      {Array.from(groups, ([category, items], index) => (
        <section
          key={category}
          aria-labelledby={`faq-category-${index}`}
          className="space-y-3"
        >
          <h2
            id={`faq-category-${index}`}
            className="text-2xl font-semibold tracking-tight"
          >
            {category}
          </h2>
          <Accordion type="single" collapsible>
            {items.map((faq) => (
              <AccordionItem key={faq.id} value={faq.id}>
                <AccordionTrigger className="min-h-11 gap-3 py-3 text-base">
                  <span className="min-w-0 break-words">{faq.question}</span>
                </AccordionTrigger>
                <AccordionContent className="pb-5 [&_.prose]:max-w-none [&_.prose]:break-words">
                  <Markdown>{faq.answer_md}</Markdown>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </section>
      ))}
    </div>
  );
}
