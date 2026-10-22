import type { Metadata } from "next";

export const metadata: Metadata = { title: "About" };

export default function AboutPage() {
  return <h1 className="text-3xl font-semibold tracking-tight">About</h1>;
}
