import argparse

from app.seed import seed_dev


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="Peer2Peer backend commands")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("seed-dev", help="Run idempotent development seeds")
    args = parser.parse_args(argv)
    if args.command == "seed-dev":
        try:
            seed_dev()
        except RuntimeError as error:
            parser.exit(1, f"{error}\n")


if __name__ == "__main__":
    main()
