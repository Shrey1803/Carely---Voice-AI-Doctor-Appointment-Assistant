"""Phase 6 integration checks using an isolated temporary SQLite database."""

import asyncio
import io
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path

import httpx

BACKEND_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(BACKEND_DIR))

import database  # noqa: E402
from main import app  # noqa: E402
from voice.tools import (  # noqa: E402
    book_appointment,
    cancel_appointment,
    check_doctor_availability,
    get_patient_upcoming_appointments,
)


class PhaseSixIntegrationTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp_dir = tempfile.TemporaryDirectory(prefix="carely-phase6-")
        self.previous_database_path = database.DATABASE_PATH
        database.DATABASE_PATH = str(Path(self.temp_dir.name) / "appointments.sqlite3")
        with redirect_stdout(io.StringIO()):
            await database.init_database()
        self.client = httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app),
            base_url="http://testserver",
        )

    async def asyncTearDown(self):
        await self.client.aclose()
        database.DATABASE_PATH = self.previous_database_path
        self.temp_dir.cleanup()

    async def _cardiology_doctor_and_slot(self):
        doctors_response = await self.client.get("/api/doctors?specialty=Cardiology")
        self.assertEqual(doctors_response.status_code, 200)
        doctors = doctors_response.json()
        self.assertTrue(doctors, "The test database should contain a cardiologist")
        doctor = doctors[0]
        slots_response = await self.client.get(f"/api/doctors/{doctor['id']}/slots")
        self.assertEqual(slots_response.status_code, 200)
        slots = slots_response.json()
        self.assertTrue(slots, "The test doctor should have at least one available slot")
        return doctor, slots[0]

    async def test_health_and_seeded_catalog_endpoints(self):
        health = await self.client.get("/api/health")
        self.assertEqual(health.status_code, 200)
        self.assertEqual(health.json()["status"], "healthy")

        doctors = await self.client.get("/api/doctors")
        self.assertEqual(doctors.status_code, 200)
        self.assertGreaterEqual(len(doctors.json()), 5)

        missing_doctor = await self.client.get("/api/doctors/99999")
        self.assertEqual(missing_doctor.status_code, 404)

    async def test_voice_tool_availability_booking_cancellation_and_wrong_phone(self):
        available = await check_doctor_availability(specialty="Cardiology")
        self.assertEqual(available["status"], "success")
        self.assertTrue(available["slots"])
        slot = available["slots"][0]

        missing = await check_doctor_availability(doctor_name="No Such Doctor")
        self.assertEqual(missing["status"], "not_found")
        self.assertEqual(missing["slots"], [])

        phone = "+1 (555) 010-2244"
        booked = await book_appointment(slot["slot_id"], phone)
        self.assertEqual(booked["status"], "success")
        self.assertEqual(booked["doctor_name"], slot["doctor_name"])

        wrong_phone = await cancel_appointment("+1 (555) 010-9999")
        self.assertEqual(wrong_phone["status"], "not_found")

        cancelled = await cancel_appointment("15550102244")
        self.assertEqual(cancelled["status"], "success")
        self.assertEqual(len(cancelled["cancelled_appointments"]), 1)
        slot_after_cancel = await check_doctor_availability(
            doctor_name=slot["doctor_name"], date=slot["date"]
        )
        self.assertTrue(any(item["slot_id"] == slot["slot_id"] for item in slot_after_cancel["slots"]))

    async def test_voice_appointment_summary_counts_and_returns_next_visit(self):
        available = await check_doctor_availability(specialty="Cardiology")
        slots = available["slots"][:2]
        self.assertEqual(len(slots), 2)
        phone = "+1 (555) 010-1188"

        for slot in slots:
            result = await book_appointment(slot["slot_id"], phone)
            self.assertEqual(result["status"], "success")

        summary = await get_patient_upcoming_appointments("15550101188")
        self.assertEqual(summary["status"], "success")
        self.assertEqual(summary["booking_count"], 2)
        self.assertEqual(summary["upcoming_count"], 2)
        self.assertEqual(summary["next_upcoming"]["date"], slots[0]["date"])
        self.assertEqual(summary["next_upcoming"]["time"], slots[0]["time"])

        missing = await get_patient_upcoming_appointments("5550100000")
        self.assertEqual(missing["booking_count"], 0)
        self.assertIsNone(missing["next_upcoming"])

    async def test_rest_booking_conflict_cancel_and_slot_reopens(self):
        doctor, slot = await self._cardiology_doctor_and_slot()
        payload = {
            "doctor_id": doctor["id"],
            "slot_id": slot["id"],
            "patient_phone": "+1-555-010-3344",
        }

        booked = await self.client.post("/api/appointments", json=payload)
        self.assertEqual(booked.status_code, 201, booked.text)
        appointment_id = booked.json()["id"]
        duplicate = await self.client.post("/api/appointments", json=payload)
        self.assertEqual(duplicate.status_code, 409)

        appointments = await self.client.get("/api/appointments")
        self.assertTrue(any(row["id"] == appointment_id for row in appointments.json()))
        slots_while_booked = await self.client.get(f"/api/doctors/{doctor['id']}/slots")
        self.assertFalse(any(row["id"] == slot["id"] for row in slots_while_booked.json()))

        cancelled = await self.client.delete(f"/api/appointments/{appointment_id}")
        self.assertEqual(cancelled.status_code, 200)
        appointments_after_cancel = await self.client.get("/api/appointments")
        self.assertFalse(any(row["id"] == appointment_id for row in appointments_after_cancel.json()))
        slots_after_cancel = await self.client.get(f"/api/doctors/{doctor['id']}/slots")
        self.assertTrue(any(row["id"] == slot["id"] for row in slots_after_cancel.json()))

    async def test_concurrent_rest_booking_claims_a_slot_once(self):
        doctor, slot = await self._cardiology_doctor_and_slot()
        payload = {
            "doctor_id": doctor["id"],
            "slot_id": slot["id"],
            "patient_phone": "+1-555-010-4455",
        }

        first, second = await asyncio.gather(
            self.client.post("/api/appointments", json=payload),
            self.client.post("/api/appointments", json=payload),
        )
        self.assertEqual(sorted([first.status_code, second.status_code]), [201, 409])
        appointments = await self.client.get("/api/appointments")
        matching = [row for row in appointments.json() if row["slot_id"] == slot["id"]]
        self.assertEqual(len(matching), 1)

    async def test_concurrent_voice_tool_booking_claims_a_slot_once(self):
        availability = await check_doctor_availability(specialty="Cardiology")
        slot = availability["slots"][0]
        first, second = await asyncio.gather(
            book_appointment(slot["slot_id"], "+1-555-010-5566"),
            book_appointment(slot["slot_id"], "+1-555-010-7788"),
        )
        results = [first, second]
        self.assertEqual(sum(result["status"] == "success" for result in results), 1)
        self.assertTrue(any(result["status"] == "already_booked" for result in results))


if __name__ == "__main__":
    unittest.main(verbosity=2)
