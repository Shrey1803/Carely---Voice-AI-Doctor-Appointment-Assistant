"""
Carely — Voice AI Doctor Appointment Assistant — FastAPI Entry Point.

Serves the REST API for the dashboard and the WebSocket endpoint
for the Pipecat voice pipeline.
"""

import os
import sys
import logging
import json
from datetime import datetime, timezone
from pathlib import Path
from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

# Ensure the backend package root is importable
sys.path.insert(0, str(Path(__file__).parent))

load_dotenv()

from database import init_database
from models import HealthResponse
from routes.doctors import router as doctors_router
from routes.appointments import router as appointments_router

logger = logging.getLogger(__name__)


# ── Lifespan ────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup / shutdown lifecycle."""
    logger.info("Starting Carely voice appointment assistant")
    await init_database()
    logger.info("Backend ready")
    yield
    logger.info("Shutting down")


# ── App ─────────────────────────────────────────────────

app = FastAPI(
    title="Carely — Voice AI Doctor Appointment Assistant",
    description="A voice-based doctor appointment booking system powered by Pipecat, ElevenLabs, and Google Gemini.",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS — allow the React dev server
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",   # Vite dev server
        "http://localhost:3000",   # Fallback
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Routers ─────────────────────────────────────────────

app.include_router(doctors_router)
app.include_router(appointments_router)


# ── Health Check ────────────────────────────────────────

@app.get("/api/health", response_model=HealthResponse, tags=["system"])
async def health_check():
    """Health check endpoint."""
    return HealthResponse.now()


# ── WebSocket voice pipeline ────────────────────────────

@app.websocket("/ws/voice")
async def voice_websocket(websocket: WebSocket):
    """Stream raw PCM audio to and from a Pipecat voice session.

    The client sends binary 16 kHz mono PCM16 audio frames and receives the
    assistant's audio in the same format. This endpoint is compatible with
    the project's WebSocket audio format; it does not accept JSON audio.
    """
    from pipecat.transports.websocket.fastapi import (
        FastAPIWebsocketParams,
        FastAPIWebsocketTransport,
    )
    from voice.pipeline import create_pcm_frame_serializer, run_voice_pipeline

    def event(state: str) -> str:
        return json.dumps({
            "type": "call_state", "state": state,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        })

    await websocket.accept()
    transport = FastAPIWebsocketTransport(
        websocket=websocket,
        params=FastAPIWebsocketParams(
            audio_in_enabled=True,
            audio_out_enabled=True,
            add_wav_header=False,
            serializer=create_pcm_frame_serializer(),
        ),
    )
    try:
        await websocket.send_text(event("connected"))
        await run_voice_pipeline(transport)
    except WebSocketDisconnect:
        pass
    except Exception:
        logging.exception("Voice pipeline session failed")
        try:
            await websocket.send_text(json.dumps({
                "type": "error",
                "message": "The voice assistant encountered a service error. Please try again shortly.",
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }))
            await websocket.close(code=1011, reason="Voice session failed")
        except RuntimeError:
            pass
    finally:
        try:
            if websocket.client_state.name == "CONNECTED":
                await websocket.send_text(event("ended"))
                await websocket.close()
        except (RuntimeError, WebSocketDisconnect):
            pass


# ── Run ─────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
    )
