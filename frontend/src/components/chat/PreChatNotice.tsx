import Markdown from "@/components/content/Markdown";
import { Button } from "@/components/ui/button";

export default function PreChatNotice({
  notice,
  onStart,
}: {
  notice: string;
  onStart: () => void;
}) {
  return (
    <div className="flex flex-1 flex-col gap-6 overflow-y-auto p-4">
      <Markdown>{notice}</Markdown>
      <Button size="lg" className="self-start" onClick={onStart}>
        Start a conversation
      </Button>
    </div>
  );
}
