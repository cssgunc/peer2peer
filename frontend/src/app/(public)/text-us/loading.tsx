export default function Loading() {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <h1 className="text-3xl font-semibold tracking-tight">Text Us</h1>
      <p role="status" className="text-muted-foreground">
        Loading the chat…
      </p>
    </div>
  );
}
