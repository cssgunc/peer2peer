export function Footer() {
  return (
    <footer className="border-t bg-muted">
      <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <p className="font-semibold">Peer2Peer</p>
          {/* Contact details will move to site settings in a later ticket. */}
          <nav
            aria-label="Contact"
            className="flex flex-col items-start gap-1 sm:flex-row sm:gap-6"
          >
            <a
              href="mailto:peer2peernc@unc.edu"
              className="flex min-h-11 items-center rounded-sm py-2 text-sm break-all underline underline-offset-4"
            >
              peer2peernc@unc.edu
            </a>
            <a
              href="https://www.instagram.com/uncpeer2peer/"
              className="flex min-h-11 items-center rounded-sm py-2 text-sm underline underline-offset-4"
            >
              Instagram (@uncpeer2peer)
            </a>
          </nav>
        </div>
        <div id="crisis-resources">
          {/* CrisisResources will be added here in its own ticket. */}
        </div>
      </div>
    </footer>
  );
}
