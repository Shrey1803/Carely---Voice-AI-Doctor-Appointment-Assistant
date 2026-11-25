# Carely — Voice AI Doctor Appointment Assistant

Carely is a clinic dashboard with a voice receptionist named Ava. Callers can ask about doctors and available slots, book appointments, check their upcoming bookings, and cancel a specific appointment. The backend uses FastAPI and SQLite; browser voice calls use a Pipecat WebSocket pipeline.

## Features

- Dashboard for doctors, available slots, appointments, and clinic activity.
- Two-way browser audio call with live user and assistant transcripts.
- Gemini function calling for availability, booking, cancellation, and appointment summaries.
- Voice lookup of a caller's booking count and nearest upcoming appointment.
- Atomic slot booking to prevent two callers from claiming the same slot.
- REST API and voice tools share the SQLite database.

## Technology

| Area | Technology |
| --- | --- |
| Voice orchestration and VAD | Pipecat, Silero VAD |
| Speech recognition and speech | ElevenLabs STT and TTS |
| Language model | Google Gemini, function calling |
| Backend and storage | Python, FastAPI, SQLite, aiosqlite |
| Frontend | React 19, TypeScript, Vite, Tailwind CSS 4 |
| Browser audio transport | FastAPI WebSocket, PCM16 audio at 16 kHz mono |

## Project structure

```text
.
├── backend/
│   ├── main.py                    # FastAPI app and /ws/voice endpoint
│   ├── database.py                # SQLite connection, schema, and seed data
│   ├── models.py                  # API response/request models
│   ├── routes/
│   │   ├── doctors.py             # Doctor and availability endpoints
│   │   └── appointments.py        # Appointment endpoints
│   ├── voice/
│   │   ├── pipeline.py            # Pipecat pipeline and WebSocket event processors
│   │   └── tools.py                # SQLite-backed LLM tools
│   ├── data/                      # Seed data
│   ├── requirements.txt
│   └── .env.example
├── frontend/
│   ├── src/
│   │   ├── components/            # Call UI and dashboard components
│   │   ├── hooks/                  # REST API and voice-call hooks
│   │   ├── utils/                  # Browser audio helpers
│   │   ├── App.tsx
│   │   └── index.css
│   ├── package.json
│   └── vite.config.ts              # Proxies /api and /ws to port 8001
├── .env.example
├── .gitignore
├── PIPELINE.md
└── README.md
```

## Requirements

- Python 3.10 or newer
- Node.js 20.19+ or 22.12+ (required by the Vite version in this project)
- npm
- An ElevenLabs API key with Speech to Text and Text to Speech permissions
- A Google AI Studio API key with Gemini access

The dashboard and REST API can run without provider credentials. Provider keys are needed to make voice calls.

## Setup

Open two terminals from the repository root.

### 1. Configure and start the backend

**Windows PowerShell:**

```powershell
cd backend
py -m venv venv
.\venv\Scripts\python.exe -m pip install -r requirements.txt
Copy-Item .env.example .env
```

Open `backend/.env` in a text editor and fill in `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`, and `GOOGLE_API_KEY`. Keep this file private; do not commit it or put provider keys in frontend files.

Then start the server:

```powershell
.\venv\Scripts\python.exe -m uvicorn main:app --reload --host 127.0.0.1 --port 8001
```

If PowerShell cannot activate or execute virtual-environment scripts, the commands above call the virtual environment's Python directly and do not require activation. If your device's application control policy blocks Python extensions, use an approved Python environment or have the policy administrator allow the dependency; changing the Uvicorn port does not resolve that policy.

**macOS/Linux:**

```bash
cd backend
python3 -m venv venv
./venv/bin/python -m pip install -r requirements.txt
cp .env.example .env
# Edit backend/.env with your provider keys, then:
./venv/bin/python -m uvicorn main:app --reload --host 127.0.0.1 --port 8001
```

The backend initializes and seeds the SQLite database on startup. By default, `DATABASE_PATH=./doctor_appointments.db` is relative to the backend working directory.

### 2. Install and start the frontend

In the second terminal, from the repository root:

```bash
cd frontend
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). Vite proxies `/api` and `/ws` to `http://127.0.0.1:8001`, so keep the backend on port 8001 unless you also update `frontend/vite.config.ts`.

## Use the voice receptionist

1. Start both servers and open the dashboard in a modern browser.
2. Select **New call** or **Try Call**, then allow microphone access.
3. Ask Ava to check a specialty, doctor, or date. She can offer a few matching slots.
4. To book or cancel, provide a phone number. Ava reads it back for confirmation. For cancellation, she lists matching appointments, asks which one you mean, then confirms that specific visit before cancelling it.
5. End the call with the call controls. Appointment and slot changes appear in the dashboard.

## Environment variables

The root `.env.example` documents the same settings as `backend/.env.example`. The backend loads `backend/.env`.

| Variable | Required | Description |
| --- | --- | --- |
| `ELEVENLABS_API_KEY` | For voice | ElevenLabs key with STT and TTS access. |
| `ELEVENLABS_VOICE_ID` | For voice | Voice to use for Ava's speech; choose an available voice in your ElevenLabs account. |
| `GOOGLE_API_KEY` | For voice | Google AI Studio key used by Gemini. |
| `GOOGLE_MODEL` | No | Gemini model override; defaults to `gemini-3.5-flash-lite`. Ensure the selected model is available to your key. |
| `DATABASE_PATH` | No | SQLite file path; defaults to `./doctor_appointments.db` from `backend/`. |

## API and voice events

- `GET /api/health` — backend health check.
- `GET /api/doctors` and doctor slot routes — list doctors and availability.
- `/api/appointments` routes — list, create, and cancel appointments.
- `WS /ws/voice` — bidirectional audio call. WebSocket binary messages carry raw PCM16, 16 kHz, mono audio. Text messages carry JSON call state, transcripts, tool results, end-call actions, or service errors.

See [PIPELINE.md](PIPELINE.md) for the pipeline order, event format, and tool behavior.

## Development

Run the frontend production build from `frontend/`:

```bash
npm run build
```

Run the backend's isolated Phase 6 integration suite from `backend/`:

```bash
python -m unittest -v test_phase6_integration
```

These tests use a temporary database and do not modify the development SQLite database. The live voice path additionally depends on network access and valid provider credentials.

## Security and privacy

This project is a development/demo application. Keep API keys in `backend/.env`; `.env` and SQLite database files are ignored by Git. The voice tools identify appointments by caller-supplied phone number and this demo does not provide authentication, identity verification, or production-grade health-data safeguards. Do not use it with real patient information without adding the appropriate controls and compliance review.
