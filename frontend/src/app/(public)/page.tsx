import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Home",
};

export default function Home() {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-12 text-center">
      <h1 className="text-3xl font-semibold">Peer2Peer</h1>
      <p className="max-w-md text-lg">
        A Heel who gets it, whenever you need one.
      </p>
    </div>
  );
}
