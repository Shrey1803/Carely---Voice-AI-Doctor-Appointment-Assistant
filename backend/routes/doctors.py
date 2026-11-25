"""
REST API routes for doctors and slots.
"""

from fastapi import APIRouter, HTTPException, Query
from typing import Optional

from database import get_db
from models import Doctor, DoctorWithSlots, SlotWithDoctor

router = APIRouter(prefix="/api", tags=["doctors"])


@router.get("/doctors", response_model=list[DoctorWithSlots])
async def list_doctors(specialty: Optional[str] = Query(None, description="Filter by specialty")):
    """List all doctors, optionally filtered by specialty."""
    async with get_db() as db:
        if specialty:
            cursor = await db.execute(
                """
                SELECT d.id, d.name, d.specialty,
                       COUNT(CASE WHEN s.is_booked = 0 THEN 1 END) AS available_slots
                FROM doctors d
                LEFT JOIN slots s ON d.id = s.doctor_id
                WHERE LOWER(d.specialty) LIKE LOWER(?)
                GROUP BY d.id
                ORDER BY d.name
                """,
                (f"%{specialty}%",),
            )
        else:
            cursor = await db.execute(
                """
                SELECT d.id, d.name, d.specialty,
                       COUNT(CASE WHEN s.is_booked = 0 THEN 1 END) AS available_slots
                FROM doctors d
                LEFT JOIN slots s ON d.id = s.doctor_id
                GROUP BY d.id
                ORDER BY d.name
                """
            )
        rows = await cursor.fetchall()
        return [dict(row) for row in rows]


@router.get("/doctors/{doctor_id}", response_model=Doctor)
async def get_doctor(doctor_id: int):
    """Get a single doctor by ID."""
    async with get_db() as db:
        cursor = await db.execute(
            "SELECT id, name, specialty FROM doctors WHERE id = ?", (doctor_id,)
        )
        row = await cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail=f"Doctor with id {doctor_id} not found")
        return dict(row)


@router.get("/doctors/{doctor_id}/slots", response_model=list[SlotWithDoctor])
async def get_doctor_slots(
    doctor_id: int,
    date: Optional[str] = Query(None, description="Filter by date (YYYY-MM-DD)"),
):
    """Get available (unbooked) slots for a specific doctor."""
    async with get_db() as db:
        # Verify doctor exists
        cursor = await db.execute("SELECT id FROM doctors WHERE id = ?", (doctor_id,))
        if not await cursor.fetchone():
            raise HTTPException(status_code=404, detail=f"Doctor with id {doctor_id} not found")

        query = """
            SELECT s.id, s.doctor_id, s.date, s.time, s.duration_minutes, s.is_booked,
                   d.name AS doctor_name, d.specialty
            FROM slots s
            JOIN doctors d ON s.doctor_id = d.id
            WHERE s.doctor_id = ? AND s.is_booked = 0
        """
        params: list = [doctor_id]

        if date:
            query += " AND s.date = ?"
            params.append(date)

        query += " ORDER BY s.date, s.time"

        cursor = await db.execute(query, params)
        rows = await cursor.fetchall()
        return [dict(row) for row in rows]
