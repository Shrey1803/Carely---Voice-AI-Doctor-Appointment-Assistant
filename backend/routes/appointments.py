"""
REST API routes for appointments.
"""

from fastapi import APIRouter, HTTPException, Query
import aiosqlite
from typing import Optional
from datetime import datetime, timezone

from database import get_db
from models import AppointmentDetail, BookingRequest

router = APIRouter(prefix="/api", tags=["appointments"])


@router.get("/appointments", response_model=list[AppointmentDetail])
async def list_appointments(
    phone: Optional[str] = Query(None, description="Filter by patient phone number"),
):
    """List all appointments, optionally filtered by phone number."""
    async with get_db() as db:
        query = """
            SELECT a.id, a.doctor_id, a.slot_id, a.patient_phone, a.created_at,
                   d.name AS doctor_name, d.specialty,
                   s.date, s.time
            FROM appointments a
            JOIN doctors d ON a.doctor_id = d.id
            JOIN slots s   ON a.slot_id   = s.id
        """
        params: list = []

        if phone:
            # Strip non-digit characters for matching
            clean_phone = "".join(c for c in phone if c.isdigit())
            query += " WHERE REPLACE(REPLACE(REPLACE(a.patient_phone, '-', ''), ' ', ''), '(', '') LIKE ?"
            params.append(f"%{clean_phone}%")

        query += " ORDER BY s.date, s.time"

        cursor = await db.execute(query, params)
        rows = await cursor.fetchall()
        return [dict(row) for row in rows]


@router.post("/appointments", response_model=AppointmentDetail, status_code=201)
async def book_appointment(booking: BookingRequest):
    """Book an appointment for a slot."""
    async with get_db() as db:
        # Take the SQLite write lock before checking availability. This makes
        # two callers competing for one slot serialize instead of racing.
        await db.execute("BEGIN IMMEDIATE")
        try:
            cursor = await db.execute(
                """
                SELECT s.id, s.doctor_id, s.is_booked, s.date, s.time,
                       d.name AS doctor_name, d.specialty
                FROM slots s JOIN doctors d ON d.id = s.doctor_id
                WHERE s.id = ?
                """,
                (booking.slot_id,),
            )
            slot = await cursor.fetchone()
            if not slot:
                raise HTTPException(status_code=404, detail="Slot not found")

            if slot["doctor_id"] != booking.doctor_id:
                raise HTTPException(status_code=400, detail="Slot does not belong to the specified doctor")

            if slot["is_booked"]:
                raise HTTPException(status_code=409, detail="This slot is already booked. Please choose another slot.")

            cursor = await db.execute(
                "UPDATE slots SET is_booked = 1 WHERE id = ? AND is_booked = 0",
                (booking.slot_id,),
            )
            if cursor.rowcount != 1:
                raise HTTPException(status_code=409, detail="This slot is already booked. Please choose another slot.")

            now = datetime.now(timezone.utc).isoformat()
            cursor = await db.execute(
                """
                INSERT INTO appointments (doctor_id, slot_id, patient_phone, created_at)
                VALUES (?, ?, ?, ?)
                """,
                (booking.doctor_id, booking.slot_id, booking.patient_phone, now),
            )
            appointment_id = cursor.lastrowid
            await db.commit()
        except HTTPException:
            await db.rollback()
            raise
        except aiosqlite.IntegrityError as exc:
            await db.rollback()
            raise HTTPException(status_code=409, detail="This slot is already booked. Please choose another slot.") from exc
        except Exception:
            await db.rollback()
            raise

        return {
            "id": appointment_id,
            "doctor_id": booking.doctor_id,
            "slot_id": booking.slot_id,
            "patient_phone": booking.patient_phone,
            "created_at": now,
            "doctor_name": slot["doctor_name"],
            "specialty": slot["specialty"],
            "date": slot["date"],
            "time": slot["time"],
        }


@router.delete("/appointments/{appointment_id}")
async def cancel_appointment(appointment_id: int):
    """Cancel an appointment and free the slot."""
    async with get_db() as db:
        # Find appointment
        cursor = await db.execute(
            """
            SELECT a.id, a.slot_id, d.name AS doctor_name, s.date, s.time
            FROM appointments a
            JOIN doctors d ON a.doctor_id = d.id
            JOIN slots s   ON a.slot_id   = s.id
            WHERE a.id = ?
            """,
            (appointment_id,),
        )
        appt = await cursor.fetchone()
        if not appt:
            raise HTTPException(status_code=404, detail="Appointment not found")

        # Free the slot and delete the appointment
        await db.execute("UPDATE slots SET is_booked = 0 WHERE id = ?", (appt["slot_id"],))
        await db.execute("DELETE FROM appointments WHERE id = ?", (appointment_id,))
        await db.commit()

        return {
            "message": "Appointment cancelled successfully",
            "cancelled": {
                "appointment_id": appt["id"],
                "doctor": appt["doctor_name"],
                "date": appt["date"],
                "time": appt["time"],
            },
        }
