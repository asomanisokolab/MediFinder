"""Review pending administrator access requests from the server CLI."""
import argparse

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .database import SessionLocal
from .models import Admin, AdminRegistrationRequest, AmbulanceProvider, Facility


def approve_request(db: Session, request_id: int) -> Admin:
    request = db.get(AdminRegistrationRequest, request_id)
    if request is None:
        raise ValueError(f"Registration request {request_id} was not found.")
    if request.status != "pending" or request.password_hash is None:
        raise ValueError(f"Registration request {request_id} is not pending.")
    if db.scalar(select(Admin).where(func.lower(Admin.email) == request.email.lower())):
        raise ValueError("An active admin account already uses this email.")
    if request.facility_id is not None and db.get(Facility, request.facility_id) is None:
        raise ValueError("The requested facility no longer exists.")
    if request.provider_id is not None and db.get(AmbulanceProvider, request.provider_id) is None:
        raise ValueError("The requested ambulance provider no longer exists.")

    admin = Admin(
        facility_id=request.facility_id,
        provider_id=request.provider_id,
        email=request.email,
        full_name=request.full_name,
        password_hash=request.password_hash,
    )
    request.status = "approved"
    request.password_hash = None
    db.add(admin)
    db.commit()
    db.refresh(admin)
    return admin


def reject_request(db: Session, request_id: int) -> None:
    request = db.get(AdminRegistrationRequest, request_id)
    if request is None:
        raise ValueError(f"Registration request {request_id} was not found.")
    if request.status != "pending":
        raise ValueError(f"Registration request {request_id} is not pending.")
    request.status = "rejected"
    request.password_hash = None
    db.commit()


def list_pending(db: Session) -> None:
    requests = db.scalars(
        select(AdminRegistrationRequest)
        .where(AdminRegistrationRequest.status == "pending")
        .order_by(AdminRegistrationRequest.created_at, AdminRegistrationRequest.id)
    ).all()
    if not requests:
        print("No pending administrator registration requests.")
        return

    for request in requests:
        if request.facility_id is not None:
            organization = db.get(Facility, request.facility_id)
            scope = "facility"
            organization_name = organization.name if organization else "(facility removed)"
        else:
            organization = db.get(AmbulanceProvider, request.provider_id)
            scope = "provider"
            organization_name = organization.name if organization else "(provider removed)"
        print(
            f"{request.id}\t{request.created_at.isoformat()}\t{scope}\t"
            f"{organization_name}\t{request.full_name}\t{request.email}"
        )


def main() -> None:
    parser = argparse.ArgumentParser(description="Review administrator registration requests.")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("list", help="List pending requests")
    approve = commands.add_parser("approve", help="Approve a request after verifying affiliation")
    approve.add_argument("request_id", type=int)
    reject = commands.add_parser("reject", help="Reject a pending request")
    reject.add_argument("request_id", type=int)
    args = parser.parse_args()

    with SessionLocal() as db:
        if args.command == "list":
            list_pending(db)
        elif args.command == "approve":
            admin = approve_request(db, args.request_id)
            print(f"Approved request {args.request_id}; admin account activated for {admin.email}.")
        else:
            reject_request(db, args.request_id)
            print(f"Rejected request {args.request_id}.")


if __name__ == "__main__":
    main()
