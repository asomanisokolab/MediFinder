"""Provision superadmin accounts from a trusted server shell.

Passwords are generated, never typed: the CLI prints a random strong
password once, for the operator to store in a password manager.
"""
import argparse

from sqlalchemy import func, select

from .database import SessionLocal, ensure_schema
from .models import Admin, SuperAdmin
from .security import generate_password, hash_password


def _check_password(password: str) -> None:
    password_bytes = len(password.encode("utf-8"))
    if not 12 <= password_bytes <= 72:
        raise ValueError(
            "Superadmin password must be between 12 and 72 UTF-8 bytes."
        )


def create_superadmin(email: str, full_name: str, password: str) -> SuperAdmin:
    email = email.strip().lower()
    full_name = full_name.strip()
    if not full_name:
        raise ValueError("Full name cannot be empty.")
    _check_password(password)

    with SessionLocal() as db:
        exists = db.scalar(
            select(Admin.id).where(func.lower(Admin.email) == email)
        ) or db.scalar(
            select(SuperAdmin.id).where(func.lower(SuperAdmin.email) == email)
        )
        if exists:
            raise ValueError("An account already uses this email.")

        superadmin = SuperAdmin(
            email=email,
            full_name=full_name,
            password_hash=hash_password(password),
        )
        db.add(superadmin)
        db.commit()
        db.refresh(superadmin)
        return superadmin


def reset_superadmin_password(email: str, password: str) -> SuperAdmin:
    _check_password(password)
    with SessionLocal() as db:
        superadmin = db.scalar(
            select(SuperAdmin).where(func.lower(SuperAdmin.email) == email.strip().lower())
        )
        if superadmin is None:
            raise ValueError("No superadmin uses this email.")
        superadmin.password_hash = hash_password(password)
        db.commit()
        db.refresh(superadmin)
        return superadmin


def _print_password(password: str) -> None:
    print("Password (shown once -- store it in a password manager now):")
    print(f"  {password}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Provision FindCare superadmin accounts.")
    commands = parser.add_subparsers(dest="command", required=True)
    create = commands.add_parser("create", help="Create a superadmin with a generated password")
    create.add_argument("email")
    create.add_argument("full_name")
    reset = commands.add_parser(
        "reset-password", help="Replace a superadmin's password with a generated one"
    )
    reset.add_argument("email")
    args = parser.parse_args()

    ensure_schema()
    password = generate_password()
    try:
        if args.command == "create":
            admin = create_superadmin(args.email, args.full_name, password)
            print(f"Created superadmin account for {admin.email}.")
        else:
            admin = reset_superadmin_password(args.email, password)
            print(f"Reset the password for {admin.email}.")
    except ValueError as exc:
        parser.error(str(exc))
    _print_password(password)


if __name__ == "__main__":
    main()
