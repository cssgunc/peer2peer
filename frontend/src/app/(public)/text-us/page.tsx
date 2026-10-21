import type { Metadata } from "next";

export const metadata: Metadata = { title: "Text Us" };

export default function TextUsPage() {
  return <h1 className="text-3xl font-semibold tracking-tight">Text Us</h1>;
}
