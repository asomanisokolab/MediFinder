"""Provision superadmin accounts from a trusted server shell."""
import argparse
from getpass import getpass

from sqlalchemy import func, select

from .database import SessionLocal
from .models import Admin, AdminRegistrationRequest, SuperAdmin
from .security import hash_password


def create_superadmin(email: str, full_name: str, password: str) -> SuperAdmin:
    email = email.strip().lower()
    full_name = full_name.strip()
    if not full_name:
        raise ValueError("Full name cannot be empty.")
    password_bytes = len(password.encode("utf-8"))
    if not 12 <= password_bytes <= 72:
        raise ValueError(
            "Superadmin password must be between 12 and 72 UTF-8 bytes."
        )

    with SessionLocal() as db:
        exists = db.scalar(
            select(Admin.id).where(func.lower(Admin.email) == email)
        ) or db.scalar(
            select(SuperAdmin.id).where(func.lower(SuperAdmin.email) == email)
        ) or db.scalar(
            select(AdminRegistrationRequest.id).where(
                func.lower(AdminRegistrationRequest.email) == email,
                AdminRegistrationRequest.status == "pending",
            )
        )
        if exists:
            raise ValueError("An account or pending request already uses this email.")

        superadmin = SuperAdmin(
            email=email,
            full_name=full_name,
            password_hash=hash_password(password),
        )
        db.add(superadmin)
        db.commit()
        db.refresh(superadmin)
        return superadmin


def main() -> None:
    parser = argparse.ArgumentParser(description="Provision MediFinder superadmin accounts.")
    commands = parser.add_subparsers(dest="command", required=True)
    create = commands.add_parser("create", help="Create a superadmin interactively")
    create.add_argument("email")
    create.add_argument("full_name")
    args = parser.parse_args()

    password = getpass("New superadmin password (minimum 12 characters): ")
    confirmation = getpass("Confirm password: ")
    if password != confirmation:
        parser.error("Passwords do not match.")

    try:
        admin = create_superadmin(args.email, args.full_name, password)
    except ValueError as exc:
        parser.error(str(exc))
    print(f"Created superadmin account for {admin.email}.")


if __name__ == "__main__":
    main()
