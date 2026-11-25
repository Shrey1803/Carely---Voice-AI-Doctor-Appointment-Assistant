"""
Function-calling tools for Carely, the Voice AI Doctor Appointment Assistant.
These tools are called by Google Gemini inside the Pipecat pipeline.
"""

from typing import Optional, Dict, Any, List
from datetime import datetime, timezone
try:
    from database import get_db
except ImportError:  # Also support imports from the repository root.
    from backend.database import get_db


async def check_doctor_availability(
    doctor_name: Optional[str] = None,
    specialty: Optional[str] = None,
    date: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Check available appointment slots for doctors.
    
    Args:
        doctor_name: Optional doctor name or partial name (e.g. "Sarah", "Patel")
        specialty: Optional medical specialty (e.g. "Cardiology", "Dermatology")
        date: Optional date in YYYY-MM-DD format
    """
    async with get_db() as db:
        query = """
            SELECT s.id AS slot_id, s.date, s.time, s.duration_minutes,
                   d.id AS doctor_id, d.name AS doctor_name, d.specialty
            FROM slots s
            JOIN doctors d ON s.doctor_id = d.id
            WHERE s.is_booked = 0
        """
        params: List[Any] = []

        if doctor_name:
            query += " AND LOWER(d.name) LIKE LOWER(?)"
            params.append(f"%{doctor_name.strip()}%")

        if specialty:
            query += " AND LOWER(d.specialty) LIKE LOWER(?)"
            params.append(f"%{specialty.strip()}%")

        if date:
            query += " AND s.date = ?"
            params.append(date.strip())

        query += " ORDER BY s.date, s.time"

        cursor = await db.execute(query, params)
        rows = await cursor.fetchall()

        if not rows:
            return {
                "status": "not_found",
                "message": "No available slots found matching the criteria. Would you like to check a different date or doctor?",
                "slots": [],
            }

        slots = []
        for r in rows:
            slots.append({
                "slot_id": r["slot_id"],
                "doctor_name": r["doctor_name"],
                "specialty": r["specialty"],
                "date": r["date"],
                "time": r["time"],
            })

        return {
            "status": "success",
            "message": f"Found {len(slots)} available slots.",
            "slots": slots,
        }


async def get_patient_upcoming_appointments(patient_phone: str) -> Dict[str, Any]:
    """Count a patient's bookings and return their next upcoming visit.

    Phone numbers are compared by digits only so common formatting differences
    do not prevent callers from finding their appointments.
    """
    clean_phone = "".join(character for character in str(patient_phone or "") if character.isdigit())
    if not clean_phone:
        return {
            "status": "error",
            "message": "Please provide a valid phone number to look up appointments.",
        }

    now = datetime.now()
    today = now.date().isoformat()
    current_time = now.strftime("%H:%M")

    try:
        async with get_db() as db:
            cursor = await db.execute(
                """
                SELECT a.id AS appointment_id, a.patient_phone,
                       d.name AS doctor_name, d.specialty, s.date, s.time
                FROM appointments a
                JOIN doctors d ON a.doctor_id = d.id
                JOIN slots s ON a.slot_id = s.id
                ORDER BY s.date, s.time
                """
            )
            rows = await cursor.fetchall()
    except Exception:
        return {
            "status": "error",
            "message": "I couldn't look up your appointments right now. Please try again shortly.",
        }

    patient_appointments = [
        row for row in rows
        if "".join(character for character in str(row["patient_phone"] or "") if character.isdigit()) == clean_phone
    ]
    upcoming = [
        row for row in patient_appointments
        if row["date"] > today or (row["date"] == today and row["time"] >= current_time)
    ]
    next_appointment = None
    if upcoming:
        row = upcoming[0]
        next_appointment = {
            "appointment_id": row["appointment_id"],
            "doctor_name": row["doctor_name"],
            "specialty": row["specialty"],
            "date": row["date"],
            "time": row["time"],
        }

    booking_count = len(patient_appointments)
    upcoming_count = len(upcoming)
    if booking_count == 0:
        message = "I couldn't find any appointments for that phone number."
    elif upcoming_count == 0:
        message = (
            f"You have {booking_count} appointment booking{'s' if booking_count != 1 else ''} "
            "in total, but no upcoming appointments."
        )
    else:
        message = (
            f"You have {booking_count} appointment booking{'s' if booking_count != 1 else ''} "
            "in total. "
            f"Your next one is with {next_appointment['doctor_name']} on "
            f"{next_appointment['date']} at {next_appointment['time']}."
        )

    return {
        "status": "success",
        "booking_count": booking_count,
        "upcoming_count": upcoming_count,
        "next_upcoming": next_appointment,
        "message": message,
    }


async def book_appointment(slot_id: int, patient_phone: str) -> Dict[str, Any]:
    """
    Book an appointment for a specific slot using the caller's phone number.
    Note: Always confirm the phone number with the caller before calling this tool.

    Args:
        slot_id: The ID of the time slot to book
        patient_phone: The caller's spoken phone number
    """
    async with get_db() as db:
        # Check slot exists and is available
        cursor = await db.execute(
            """
            SELECT s.id, s.doctor_id, s.date, s.time, s.is_booked,
                   d.name AS doctor_name, d.specialty
            FROM slots s
            JOIN doctors d ON s.doctor_id = d.id
            WHERE s.id = ?
            """,
            (slot_id,),
        )
        slot = await cursor.fetchone()

        if not slot:
            return {
                "status": "error",
                "message": f"Slot with ID {slot_id} was not found.",
            }

        if slot["is_booked"]:
            return {
                "status": "already_booked",
                "message": f"Sorry, this slot on {slot['date']} at {slot['time']} with {slot['doctor_name']} is already booked.",
            }

        # Clean phone format
        clean_phone = patient_phone.strip()

        # Claim the slot atomically so concurrent callers cannot both book it.
        now = datetime.now(timezone.utc).isoformat()
        try:
            cursor = await db.execute(
                "UPDATE slots SET is_booked = 1 WHERE id = ? AND is_booked = 0",
                (slot_id,),
            )
            if cursor.rowcount != 1:
                await db.rollback()
                return {"status": "already_booked", "message": "This slot was just booked. Please choose another time."}
            cursor = await db.execute(
                """
                INSERT INTO appointments (doctor_id, slot_id, patient_phone, created_at)
                VALUES (?, ?, ?, ?)
                """,
                (slot["doctor_id"], slot_id, clean_phone, now),
            )
            appointment_id = cursor.lastrowid
            await db.commit()
        except Exception as exc:
            await db.rollback()
            return {"status": "error", "message": f"Unable to book this appointment: {exc}"}

        return {
            "status": "success",
            "appointment_id": appointment_id,
            "doctor_name": slot["doctor_name"],
            "specialty": slot["specialty"],
            "date": slot["date"],
            "time": slot["time"],
            "patient_phone": clean_phone,
            "message": f"Appointment successfully confirmed with {slot['doctor_name']} on {slot['date']} at {slot['time']} for phone number {clean_phone}.",
        }


async def cancel_appointment(
    patient_phone: str, appointment_id: Optional[int] = None
) -> Dict[str, Any]:
    """List a caller's appointments, or cancel only the selected appointment.

    Call once without ``appointment_id`` to find matching appointments. The
    caller must choose and confirm one before calling again with its ID.
    """
    clean_phone = "".join(c for c in str(patient_phone or "") if c.isdigit())
    if not clean_phone:
        return {"status": "not_found", "message": "No appointment found for this phone number"}

    async with get_db() as db:
        if appointment_id is not None:
            # Lock the write transaction and verify both ID and phone before
            # deleting anything; a phone number alone must never cancel visits.
            await db.execute("BEGIN IMMEDIATE")
        cursor = await db.execute(
            """
            SELECT a.id, a.slot_id, a.patient_phone,
                   d.name AS doctor_name, d.specialty, s.date, s.time
            FROM appointments a
            JOIN doctors d ON a.doctor_id = d.id
            JOIN slots s ON a.slot_id = s.id
            ORDER BY s.date, s.time
            """
        )
        rows = await cursor.fetchall()
        appointments = [
            appt for appt in rows
            if "".join(c for c in str(appt["patient_phone"] or "") if c.isdigit()) == clean_phone
        ]

        if not appointments:
            if appointment_id is not None:
                await db.rollback()
            return {"status": "not_found", "message": "No appointment found for this phone number"}

        if appointment_id is None:
            candidates = [
                {
                    "appointment_id": appt["id"],
                    "doctor_name": appt["doctor_name"],
                    "specialty": appt["specialty"],
                    "date": appt["date"],
                    "time": appt["time"],
                }
                for appt in appointments
            ]
            return {
                "status": "selection_required",
                "appointments": candidates,
                "message": "Ask which specific appointment they want to cancel, read its doctor, date, and time back, and get explicit confirmation before cancelling only that appointment.",
            }

        selected = next((appt for appt in appointments if appt["id"] == appointment_id), None)
        if selected is None:
            await db.rollback()
            return {
                "status": "not_found",
                "message": "That appointment was not found for this phone number. No appointments were cancelled.",
            }

        try:
            await db.execute("UPDATE slots SET is_booked = 0 WHERE id = ?", (selected["slot_id"],))
            await db.execute("DELETE FROM appointments WHERE id = ?", (selected["id"],))
            await db.commit()
        except Exception:
            await db.rollback()
            return {"status": "error", "message": "I couldn't cancel that appointment right now. No other appointments were changed."}

        cancelled = {
            "appointment_id": selected["id"],
            "slot_id": selected["slot_id"],
            "doctor_name": selected["doctor_name"],
            "specialty": selected["specialty"],
            "date": selected["date"],
            "time": selected["time"],
        }
        return {
            "status": "success",
            "cancelled_appointment": cancelled,
            "patient_phone": patient_phone,
            "message": f"Cancelled the appointment with {selected['doctor_name']} on {selected['date']} at {selected['time']}.",
        }
