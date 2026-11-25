"""
Automated tests for the REST API endpoints.
Verifies doctors, slots, and the complete appointment booking & cancellation flow.
"""

import sys
import asyncio
from pathlib import Path

# Add backend to path
sys.path.insert(0, str(Path(__file__).parent))

import httpx
from database import init_database

BASE_URL = "http://127.0.0.1:8000"


async def run_tests():
    print("🔬 Starting REST API Tests...")

    async with httpx.AsyncClient(base_url=BASE_URL, timeout=10.0) as client:
        # 1. Health check
        res = await client.get("/api/health")
        assert res.status_code == 200, f"Health check failed: {res.text}"
        print("  ✅ Health check passed")

        # 2. List doctors
        res = await client.get("/api/doctors")
        assert res.status_code == 200, f"List doctors failed: {res.text}"
        doctors = res.json()
        assert len(doctors) >= 5, f"Expected at least 5 doctors, got {len(doctors)}"
        print(f"  ✅ List doctors passed ({len(doctors)} doctors found)")

        # 3. Filter doctors by specialty
        res = await client.get("/api/doctors?specialty=Cardiology")
        assert res.status_code == 200
        cardio = res.json()
        assert len(cardio) >= 1
        assert "Cardiology" in cardio[0]["specialty"]
        print(f"  ✅ Specialty filter passed ({cardio[0]['name']})")

        # 4. Get specific doctor
        doc_id = doctors[0]["id"]
        res = await client.get(f"/api/doctors/{doc_id}")
        assert res.status_code == 200
        assert res.json()["id"] == doc_id
        print("  ✅ Get single doctor passed")

        # 5. Get available slots for doctor
        res = await client.get(f"/api/doctors/{doc_id}/slots")
        assert res.status_code == 200
        slots = res.json()
        assert len(slots) > 0, "No available slots found"
        target_slot = slots[0]
        print(f"  ✅ Get slots passed ({len(slots)} available slots, target slot ID: {target_slot['id']})")

        # 6. Book appointment
        test_phone = "+1-555-0199"
        booking_payload = {
            "doctor_id": doc_id,
            "slot_id": target_slot["id"],
            "patient_phone": test_phone,
        }
        res = await client.post("/api/appointments", json=booking_payload)
        assert res.status_code == 201, f"Booking failed: {res.text}"
        booking = res.json()
        assert booking["slot_id"] == target_slot["id"]
        assert booking["patient_phone"] == test_phone
        appt_id = booking["id"]
        print(f"  ✅ Booking appointment passed (Appointment ID: {appt_id})")

        # 7. Test Double-booking conflict (409)
        res = await client.post("/api/appointments", json=booking_payload)
        assert res.status_code == 409, f"Expected 409 conflict, got {res.status_code}"
        print("  ✅ Double-booking conflict handled correctly (409)")

        # 8. List appointments filtered by phone
        res = await client.get(f"/api/appointments?phone=5550199")
        assert res.status_code == 200
        appts = res.json()
        assert len(appts) >= 1
        assert any(a["id"] == appt_id for a in appts)
        print("  ✅ List appointments by phone passed")

        # 9. Cancel appointment
        res = await client.delete(f"/api/appointments/{appt_id}")
        assert res.status_code == 200, f"Cancellation failed: {res.text}"
        print("  ✅ Cancel appointment passed")

        # 10. Verify slot is freed
        res = await client.get(f"/api/doctors/{doc_id}/slots")
        refreshed_slots = res.json()
        assert any(s["id"] == target_slot["id"] for s in refreshed_slots), "Slot was not freed after cancellation!"
        print("  ✅ Verified slot was successfully freed")

    print("\n🎉 ALL REST API TESTS PASSED SUCCESSFULLY!")


if __name__ == "__main__":
    asyncio.run(run_tests())
