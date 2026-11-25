"""
Pydantic models for Carely, the Voice AI Doctor Appointment Assistant.
"""

from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime, timezone


# ── Doctor ──────────────────────────────────────────────

class Doctor(BaseModel):
    """Represents a doctor in the system."""
    id: int
    name: str
    specialty: str


class DoctorWithSlots(Doctor):
    """Doctor with count of available slots."""
    available_slots: int = 0


# ── Slot ────────────────────────────────────────────────

class Slot(BaseModel):
    """Represents a time slot for a doctor."""
    id: int
    doctor_id: int
    date: str            # YYYY-MM-DD
    time: str            # HH:MM
    duration_minutes: int = 30
    is_booked: bool = False


class SlotWithDoctor(Slot):
    """Slot enriched with doctor details."""
    doctor_name: str
    specialty: str


# ── Appointment ─────────────────────────────────────────

class Appointment(BaseModel):
    """Represents a booked appointment."""
    id: int
    doctor_id: int
    slot_id: int
    patient_phone: str
    created_at: str


class AppointmentDetail(Appointment):
    """Appointment enriched with doctor and slot details."""
    doctor_name: str
    specialty: str
    date: str
    time: str


# ── Request Bodies ──────────────────────────────────────

class BookingRequest(BaseModel):
    """Request body for booking an appointment."""
    doctor_id: int
    slot_id: int
    patient_phone: str = Field(
        ...,
        min_length=7,
        max_length=20,
        description="Patient phone number (digits, dashes, spaces allowed)"
    )


class CancellationRequest(BaseModel):
    """Request body for cancelling by phone number."""
    patient_phone: str = Field(
        ...,
        min_length=7,
        max_length=20,
        description="Phone number used when booking"
    )


# ── Responses ───────────────────────────────────────────

class HealthResponse(BaseModel):
    """Health check response."""
    status: str = "healthy"
    timestamp: str

    @classmethod
    def now(cls) -> "HealthResponse":
        return cls(timestamp=datetime.now(timezone.utc).isoformat())


class ErrorResponse(BaseModel):
    """Standard error response."""
    detail: str
