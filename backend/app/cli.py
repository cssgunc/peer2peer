import argparse
from getpass import getpass

from pydantic import TypeAdapter, ValidationError
from sqlalchemy.exc import IntegrityError

from app.models import Account, AccountRole
from app.schemas.auth import NormalizedEmail
from app.security.passwords import hash_password, password_problems
from app.seed import seed_dev


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="Peer2Peer backend commands")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("seed-dev", help="Run idempotent development seeds")
    create = commands.add_parser("create-account", help="Create a staff account")
    create.add_argument("--email", required=True)
    create.add_argument("--name", required=True)
    create.add_argument("--role", required=True, choices=[role.value for role in AccountRole])
    args = parser.parse_args(argv)
    if args.command == "seed-dev":
        try:
            seed_dev()
        except RuntimeError as error:
            parser.exit(1, f"{error}\n")
    elif args.command == "create-account":
        try:
            email = TypeAdapter(NormalizedEmail).validate_python(args.email)
        except ValidationError:
            parser.exit(1, "Enter a valid email address.\n")
        name = args.name.strip()
        if not 1 <= len(name) <= 100:
            parser.exit(1, "Name must contain between 1 and 100 characters.\n")
        try:
            password = getpass("Password: ")
        except EOFError, KeyboardInterrupt:
            parser.exit(1, "\nAccount creation cancelled.\n")
        problems = password_problems(password, email)
        if problems:
            parser.exit(1, "\n".join(problems) + "\n")

        from app.database import SessionLocal

        try:
            with SessionLocal.begin() as db:
                db.add(
                    Account(
                        email=email,
                        display_name=name,
                        role=AccountRole(args.role),
                        password_hash=hash_password(password),
                        must_change_password=False,
                    )
                )
        except IntegrityError:
            parser.exit(1, "An account with that email already exists.\n")
        print("Account created.")


if __name__ == "__main__":
    main()
