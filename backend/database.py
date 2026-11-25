"""
SQLite database layer for Carely, the Voice AI Doctor Appointment Assistant.

Uses aiosqlite for async operations. Auto-seeds from seed_data.json on first run.
"""

import os
import json
import logging
import aiosqlite
from datetime import datetime, timedelta
from pathlib import Path
from contextlib import asynccontextmanager
from typing import AsyncGenerator

# ── Config ──────────────────────────────────────────────

DATABASE_PATH = os.getenv("DATABASE_PATH", "./doctor_appointments.db")
SEED_DATA_PATH = Path(__file__).parent / "data" / "seed_data.json"
logger = logging.getLogger(__name__)


# ── Connection Helper ───────────────────────────────────

@asynccontextmanager
async def get_db() -> AsyncGenerator[aiosqlite.Connection, None]:
    """Async context manager for database connections."""
    db = await aiosqlite.connect(DATABASE_PATH)
    db.row_factory = aiosqlite.Row
    await db.execute("PRAGMA journal_mode=WAL")
    await db.execute("PRAGMA foreign_keys=ON")
    try:
        yield db
    finally:
        await db.close()


# ── Schema ──────────────────────────────────────────────

CREATE_TABLES_SQL = """
CREATE TABLE IF NOT EXISTS doctors (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL,
    specialty   TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS slots (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    doctor_id        INTEGER NOT NULL,
    date             TEXT    NOT NULL,   -- YYYY-MM-DD
    time             TEXT    NOT NULL,   -- HH:MM
    duration_minutes INTEGER NOT NULL DEFAULT 30,
    is_booked        INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (doctor_id) REFERENCES doctors(id)
);

CREATE TABLE IF NOT EXISTS appointments (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    doctor_id     INTEGER NOT NULL,
    slot_id       INTEGER NOT NULL UNIQUE,
    patient_phone TEXT    NOT NULL,
    created_at    TEXT    NOT NULL,
    FOREIGN KEY (doctor_id) REFERENCES doctors(id),
    FOREIGN KEY (slot_id)   REFERENCES slots(id)
);

CREATE INDEX IF NOT EXISTS idx_slots_doctor     ON slots(doctor_id);
CREATE INDEX IF NOT EXISTS idx_slots_date       ON slots(date);
CREATE INDEX IF NOT EXISTS idx_slots_booked     ON slots(is_booked);
CREATE INDEX IF NOT EXISTS idx_appt_phone       ON appointments(patient_phone);
"""


# ── Initialization ──────────────────────────────────────

async def init_database() -> None:
    """Create tables and seed data if the database is empty."""
    async with get_db() as db:
        await db.executescript(CREATE_TABLES_SQL)
        await db.commit()

        # Check if already seeded
        cursor = await db.execute("SELECT COUNT(*) FROM doctors")
        row = await cursor.fetchone()
        if row[0] == 0:
            await _seed_data(db)
            logger.info("Database seeded with mock data")
        else:
            logger.info("Database already has %s doctors; skipping seed", row[0])


async def _seed_data(db: aiosqlite.Connection) -> None:
    """Populate database with mock doctors and generate slots for the next 7 days."""
    with open(SEED_DATA_PATH, "r") as f:
        data = json.load(f)

    # Insert doctors
    for doc in data["doctors"]:
        await db.execute(
            "INSERT INTO doctors (id, name, specialty) VALUES (?, ?, ?)",
            (doc["id"], doc["name"], doc["specialty"]),
        )

    # Generate slots for each doctor for the next 7 days
    today = datetime.now().date()
    slot_templates = data["slot_templates"]

    for doc in data["doctors"]:
        for day_offset in range(1, 8):  # Tomorrow through 7 days out
            slot_date = today + timedelta(days=day_offset)
            date_str = slot_date.strftime("%Y-%m-%d")

            # Each doctor gets a subset of slots per day (vary it a bit)
            # Use doctor id to offset which slots they get for variety
            start_idx = (doc["id"] - 1) % 3
            selected_slots = slot_templates[start_idx : start_idx + 5]

            for slot in selected_slots:
                await db.execute(
                    "INSERT INTO slots (doctor_id, date, time, duration_minutes, is_booked) "
                    "VALUES (?, ?, ?, ?, 0)",
                    (doc["id"], date_str, slot["time"], slot["duration_minutes"]),
                )

    await db.commit()
    total_slots = len(data["doctors"]) * 7 * 5  # approximate
    logger.info("Seeded %s doctors and approximately %s slots", len(data["doctors"]), total_slots)


# ── Reset (for testing) ────────────────────────────────

async def reset_database() -> None:
    """Drop all data and re-seed. Use for testing only."""
    async with get_db() as db:
        await db.executescript("""
            DELETE FROM appointments;
            DELETE FROM slots;
            DELETE FROM doctors;
        """)
        await db.commit()
        await _seed_data(db)
        logger.info("Database reset and re-seeded")
