"""Busy status for a facility: red (busy), yellow (less busy), green (not busy).

Three sources, best first:

1. The facility's own staff, from the admin dashboard. Trusted for 3 hours.
2. People at the facility, from "How busy is it?" on the public profile:
   reports from the last 90 minutes, the newest counting most.
3. A prediction. It starts from the usual daily pattern for that kind of
   place (outpatient queues peak on weekday mornings, labs before noon,
   pharmacies after work) and learns from the reports this facility has
   had at the same hour, on the same kind of day, over the past eight
   weeks. The more reports a facility gets, the more its estimate follows
   its own rhythm instead of the general pattern. Where staff keep bed
   counts current, occupancy moves it too.

Every status says which source it came from, so a prediction is never shown
as if someone had checked. Ghana keeps UTC all year, so server time is local
time.
"""
from collections import defaultdict
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import BusyReport, Facility, utcnow
from .presenters import is_stale

LEVELS = ("not_busy", "less_busy", "busy")
LABELS = {
    "not_busy": "Not busy",
    "less_busy": "Less busy",
    "busy": "Busy",
    "unknown": "May be closed",
}
# What each reported level counts as, on a 0..1 scale.
_SCORE = (0.0, 0.5, 1.0)
_BUSY_FROM, _LESS_FROM = 0.66, 0.36

STAFF_FRESH = timedelta(hours=3)
VISITOR_WINDOW = timedelta(minutes=90)
_VISITOR_HALF_LIFE_MIN = 30
HISTORY = timedelta(weeks=8)
# How many past reports the general pattern is worth when blending it with
# what this facility's own reports say.
_PATTERN_WEIGHT = 4.0

# Places with a queue worth reporting. A hearse or caregiver has none.
TRACKED_CATEGORIES = ("hospital", "clinic", "laboratory", "pharmacy")

# Usual busyness by hour of day, 0..1.
_OUTPATIENT = [0.2, 0.2, 0.2, 0.2, 0.2, 0.25, 0.42, 0.68, 0.8, 0.82, 0.78, 0.7,
               0.62, 0.55, 0.5, 0.44, 0.4, 0.36, 0.33, 0.3, 0.28, 0.26, 0.24, 0.22]
_LABORATORY = [0.1, 0.1, 0.1, 0.1, 0.1, 0.15, 0.4, 0.75, 0.85, 0.8, 0.7, 0.6,
               0.5, 0.42, 0.38, 0.33, 0.3, 0.25, 0.2, 0.15, 0.1, 0.1, 0.1, 0.1]
_PHARMACY = [0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.2, 0.3, 0.45, 0.5, 0.45, 0.4,
             0.45, 0.45, 0.38, 0.38, 0.45, 0.55, 0.55, 0.45, 0.35, 0.25, 0.15, 0.1]
# Monday is the busiest clinic day; weekends are quieter.
_WEEKDAY_SHIFT = {0: 0.08, 5: -0.15, 6: -0.25}
# Teaching and regional hospitals are rarely quiet; CHPS compounds rarely full.
_LEVEL_SHIFT = {
    "Teaching hospital": 0.1,
    "Tertiary hospital": 0.1,
    "Regional hospital": 0.06,
    "Specialised hospital / clinic": -0.05,
    "CHPS compound / Maternity home": -0.12,
}
# Most NHIS patients queue at government facilities; private ones see fewer.
_PRIVATE_SHIFT = -0.18


def _level_of(score: float) -> str:
    if score >= _BUSY_FROM:
        return "busy"
    if score >= _LESS_FROM:
        return "less_busy"
    return "not_busy"


def _clamp(value: float) -> float:
    return max(0.0, min(1.0, value))


def usual_pattern(facility: Facility, when: datetime) -> float:
    """The general pattern for this kind of place at this hour and weekday."""
    if facility.category == "laboratory":
        curve, day_factor = _LABORATORY, 1.0
    elif facility.category == "pharmacy":
        curve, day_factor = _PHARMACY, 0.5
    else:
        curve, day_factor = _OUTPATIENT, 1.0
    score = (
        curve[when.hour]
        + _WEEKDAY_SHIFT.get(when.weekday(), 0.0) * day_factor
        + _LEVEL_SHIFT.get(facility.classification, 0.0)
    )
    if facility.type == "private" and facility.category != "pharmacy":
        score += _PRIVATE_SHIFT
    if facility.category == "hospital" and facility.is_24_hour:
        # Emergency wards are never empty, even at night.
        score = max(score, 0.3 + _LEVEL_SHIFT.get(facility.classification, 0.0))
    return _clamp(score)


def probably_closed(facility: Facility, when: datetime) -> bool:
    if facility.is_24_hour:
        return False
    closing = 19 if facility.category == "laboratory" else 21
    return when.hour < 6 or when.hour >= closing


def _day_kind(when: datetime) -> int:
    """0 for Monday to Friday, 5 for Saturday, 6 for Sunday."""
    return when.weekday() if when.weekday() >= 5 else 0


def _same_time_of_week(then: datetime, now: datetime) -> bool:
    hours_apart = abs(then.hour - now.hour)
    return min(hours_apart, 24 - hours_apart) <= 1 and _day_kind(then) == _day_kind(now)


def _status(level: str, source: str, detail: str, updated_at=None, reports: int = 0) -> dict:
    return {
        "level": level,
        "label": LABELS[level],
        "source": source,
        "detail": detail,
        "updated_at": updated_at,
        "reports": reports,
    }


def _plural(count: int, word: str) -> str:
    return f"{count} {word}" if count == 1 else f"{count} {word}s"


def status_for(facility: Facility, reports: list[BusyReport], now: datetime) -> dict:
    staff = [r for r in reports if r.source == "facility" and now - r.created_at <= STAFF_FRESH]
    if staff:
        latest = max(staff, key=lambda r: r.created_at)
        return _status(LEVELS[latest.level], "facility", "Reported by the facility",
                       latest.created_at, 1)

    recent = [r for r in reports if r.source == "visitor" and now - r.created_at <= VISITOR_WINDOW]
    if recent:
        weights = [
            0.5 ** ((now - r.created_at).total_seconds() / 60 / _VISITOR_HALF_LIFE_MIN)
            for r in recent
        ]
        score = sum(w * _SCORE[r.level] for w, r in zip(weights, recent)) / sum(weights)
        return _status(
            _level_of(score), "visitors",
            f"{_plural(len(recent), 'report')} from people there in the last 90 minutes",
            max(r.created_at for r in recent), len(recent),
        )

    if probably_closed(facility, now):
        return _status("unknown", "hours", "Outside usual opening hours. Call before you go.")

    # Prediction: the general pattern, pulled towards what this facility's
    # own past reports said at the same time of the week. Staff count double.
    learned = [
        (2.0 if r.source == "facility" else 1.0, _SCORE[r.level])
        for r in reports
        if _same_time_of_week(r.created_at, now)
    ]
    weight = sum(w for w, _ in learned)
    score = (
        usual_pattern(facility, now) * _PATTERN_WEIGHT + sum(w * v for w, v in learned)
    ) / (_PATTERN_WEIGHT + weight)

    beds = facility.beds
    if beds is not None and beds.total_beds and not is_stale(beds.updated_at):
        occupancy = 1 - beds.available_beds / beds.total_beds
        score = 0.65 * score + 0.35 * occupancy

    detail = "Predicted from the usual pattern at this time of day"
    if learned:
        detail += f" and {_plural(len(learned), 'past report')} for this facility"
    return _status(_level_of(score), "predicted", detail, reports=len(learned))


def statuses(db: Session, facilities, now: datetime | None = None) -> dict[int, dict]:
    """Busy status for many facilities with one query. Facilities without a
    queue (hearse, caregiver) are left out."""
    now = now or utcnow()
    tracked = [f for f in facilities if f.category in TRACKED_CATEGORIES]
    if not tracked:
        return {}
    by_facility: dict[int, list[BusyReport]] = defaultdict(list)
    rows = db.scalars(
        select(BusyReport).where(
            BusyReport.facility_id.in_([f.id for f in tracked]),
            BusyReport.created_at >= now - HISTORY,
        )
    ).all()
    for report in rows:
        by_facility[report.facility_id].append(report)
    return {f.id: status_for(f, by_facility[f.id], now) for f in tracked}


def status(db: Session, facility: Facility) -> dict | None:
    return statuses(db, [facility]).get(facility.id)
