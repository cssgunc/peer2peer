import { notFound } from "next/navigation";

import FakeChat from "./FakeChat";

export default function DevChatPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <FakeChat />;
}
