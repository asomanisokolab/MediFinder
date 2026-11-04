"""Public contact form: how an organization asks to be listed.

There is no self-registration. A request grants nothing; a superadmin
verifies it, then creates the listing and emails the login details.
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import ContactRequest
from ..schemas import ContactRequestIn

router = APIRouter(tags=["contact"])


@router.post("/contact", status_code=status.HTTP_202_ACCEPTED)
def submit_contact_request(payload: ContactRequestIn, db: Session = Depends(get_db)):
    email = payload.email.strip().lower()
    if db.scalar(
        select(ContactRequest.id).where(
            func.lower(ContactRequest.email) == email,
            ContactRequest.status == "pending",
        )
    ):
        raise HTTPException(
            status_code=409,
            detail="We already have a request from this email and will be in touch.",
        )

    db.add(
        ContactRequest(
            facility_name=payload.facility_name.strip(),
            organization_type=payload.organization_type,
            email=email,
            phone=payload.phone.strip(),
            contact_name=payload.contact_name.strip(),
            message=payload.message.strip(),
        )
    )
    db.commit()
    return {
        "status": "pending",
        "message": (
            "Thank you. Our team will verify your details and email your login "
            "once your listing is approved."
        ),
    }
