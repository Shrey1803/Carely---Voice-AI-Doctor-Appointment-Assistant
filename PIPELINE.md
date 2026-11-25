# Voice pipeline description

The voice call is created per FastAPI WebSocket connection. Pipecat receives the caller's binary audio frames, performs voice activity detection, transcribes speech, gives the conversation to Gemini, and streams generated speech back through the same WebSocket.

```text
Browser microphone
  → WebSocket binary PCM16 (16 kHz, mono)
  → FastAPI WebSocket transport
  → Silero VAD
  → ElevenLabs Speech to Text
  → Gemini LLM and appointment tools
  → ElevenLabs Text to Speech
  → WebSocket binary PCM16
  → Browser speaker
```

## Processing and tools

Silero VAD detects speech and turn boundaries. ElevenLabs transcribes caller audio. The Gemini conversation uses the receptionist prompt in `backend/voice/pipeline.py`: Ava is concise and warm, reads phone numbers back for confirmation, and must obtain confirmation before booking, cancelling, or looking up a patient's appointments. Gemini can call four asynchronous SQLite tools and one call-scoped identity tool:

- `check_doctor_availability` filters open slots by partial doctor name, specialty, and date.
- `book_appointment` verifies and atomically claims an open slot, then creates the appointment.
- `cancel_appointment` first lists appointments for the confirmed phone number. Ava asks the caller to choose one, reads its doctor, date, and time back for explicit confirmation, then deletes only that selected appointment and frees its slot.
- `get_patient_upcoming_appointments` counts the caller's stored bookings and returns their nearest upcoming appointment, if one exists.
- `remember_caller_name` returns the caller's preferred name to the live UI for this call; it is not stored in SQLite.

Tool results are returned to Gemini so Ava can describe the outcome. Database tools and REST endpoints use the same SQLite database. Atomic slot claims prevent concurrent callers from booking a slot twice.

When Ava asks whether the caller needs anything else and the caller directly says no, Gemini invokes `end_call`. The backend signals the client to end after Ava's farewell audio finishes; the client then closes the call and clears that call's transcript.

## WebSocket message format

The browser sends raw signed 16-bit PCM audio, mono at 16 kHz, as binary WebSocket messages. The server returns audio in the same format as binary messages. Text WebSocket messages are JSON events, for example:

```json
{"type":"transcript","role":"user","text":"Do you have a cardiologist tomorrow?","timestamp":"2026-11-25T10:00:00+00:00"}
{"type":"transcript","role":"assistant","text":"I can check that for you.","timestamp":"2026-11-25T10:00:01+00:00"}
{"type":"tool_call","tool":"check_doctor_availability","result":{"status":"success","slots":[]},"timestamp":"2026-11-25T10:00:02+00:00"}
{"type":"call_state","state":"connected","timestamp":"2026-11-25T10:00:00+00:00"}
```

The frontend distinguishes binary audio from text events, including a `call_action` event used to end the call after a spoken goodbye. Provider or pipeline failures are sent as an `error` event when the connection remains available; disconnects clean up the per-call pipeline.
