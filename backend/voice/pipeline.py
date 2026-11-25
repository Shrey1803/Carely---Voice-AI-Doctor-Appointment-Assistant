"""Pipecat voice pipeline for the appointment assistant."""

import json
import os
from pathlib import Path
from typing import Any
from datetime import datetime, timezone

from dotenv import load_dotenv

try:  # Works both as ``voice.pipeline`` and when backend is on sys.path.
    from .tools import (
        book_appointment,
        cancel_appointment,
        check_doctor_availability,
        get_patient_upcoming_appointments,
    )
except ImportError:
    from voice.tools import (
        book_appointment,
        cancel_appointment,
        check_doctor_availability,
        get_patient_upcoming_appointments,
    )

load_dotenv(Path(__file__).resolve().parents[1] / ".env")

SYSTEM_PROMPT = """You are Ava, a warm, professional receptionist for a medical clinic.
Help callers check doctor availability, book appointments, and cancel appointments.
If callers ask about their bookings, report their total booking count and describe
their nearest upcoming appointment, if they have one.
Keep spoken replies concise (usually 1-2 sentences), natural, and conversational.
At the start of a new call, warmly ask what name the caller would like you to use.
When the caller tells you their name, call remember_caller_name so it can be shown
on the call screen. Use the name for this call only; do not persist it in the clinic record.
For booking: collect the caller's phone number, repeat it back digit by digit and
ask them to confirm it. Also read back the doctor, date, and time and obtain clear
agreement before calling the booking tool. For cancellation: collect the phone
number, repeat it back digit by digit, and ask the caller to confirm before using
the cancellation tool. First call the tool with only the confirmed phone number
to list appointments. Describe matches by doctor, date, and time; ask which one
they mean; read that specific appointment back and obtain an explicit yes before
calling the tool again with its appointment_id. Never cancel all appointments
just because they share a phone number. Never book or cancel before these
confirmations, and never claim success unless the tool confirms it. For appointment lookup, collect the
caller's phone number, repeat it back digit by digit, and ask them to confirm
before checking their appointments. Use availability results and offer no
more than 3-4 options at once. Say dates and times naturally (for example,
'Tuesday at 2:30 PM'). After booking, confirm the doctor, date, and time. After
cancelling, briefly confirm what was cancelled. If asked for something outside
appointments, politely explain that you can only help with appointments. After
helping with a request, ask whether the caller needs anything else. Only if the
caller answers no directly to that question, say 'Alright, thank you for calling.
Take care.' and call the end_call tool. Do not end the call for a 'no' that answers
another question or is part of a different request."""


def _timestamp() -> str:
    """Return the current UTC timestamp for client events."""
    return datetime.now(timezone.utc).isoformat()


def _required_env(name: str) -> str:
    """Read a required environment setting or raise a clear startup error."""
    value = os.getenv(name)
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


def create_pcm_frame_serializer():
    """Create a serializer for binary 16 kHz, mono, signed PCM WebSocket audio."""
    from pipecat.frames.frames import (
        InputAudioRawFrame, OutputAudioRawFrame, OutputTransportMessageFrame,
        OutputTransportMessageUrgentFrame,
    )
    from pipecat.serializers.base_serializer import FrameSerializer

    class PCMFrameSerializer(FrameSerializer):
        async def deserialize(self, data: str | bytes):
            if not isinstance(data, bytes) or not data:
                return None
            return InputAudioRawFrame(
                audio=data, sample_rate=16000, num_channels=1
            )

        async def serialize(self, frame):
            if isinstance(frame, OutputAudioRawFrame):
                return frame.audio
            if isinstance(frame, (OutputTransportMessageFrame, OutputTransportMessageUrgentFrame)):
                payload = frame.message
                return payload if isinstance(payload, str) else json.dumps(payload)
            return None

    return PCMFrameSerializer()


def create_voice_pipeline(transport: Any, aiohttp_session: Any):
    """Build and return ``(pipeline, runner_target, uses_legacy_task_api)``."""
    from pipecat.pipeline.pipeline import Pipeline
    try:
        from pipecat.pipeline.task import PipelineParams, PipelineTask
        from pipecat.pipeline.runner import PipelineRunner  # noqa: F401

        legacy_task_api = True
    except ImportError:
        # Pipecat 1.3+ uses PipelineWorker/WorkerRunner instead.
        from pipecat.pipeline.worker import PipelineParams, PipelineWorker

        legacy_task_api = False
    from pipecat.processors.aggregators.llm_response_universal import (
        LLMContextAggregatorPair,
    )
    from pipecat.processors.aggregators.llm_context import LLMContext
    from pipecat.processors.audio.vad_processor import VADProcessor
    from pipecat.processors.frame_processor import FrameDirection, FrameProcessor
    from pipecat.frames.frames import (
        ErrorFrame, LLMFullResponseEndFrame, OutputTransportMessageFrame,
        TextFrame, TranscriptionFrame,
    )
    from pipecat.services.elevenlabs.stt import ElevenLabsSTTService
    from pipecat.services.elevenlabs.tts import ElevenLabsTTSService
    from pipecat.services.google.llm import GoogleLLMService
    from pipecat.audio.vad.silero import SileroVADAnalyzer
    from pipecat.services.llm_service import FunctionCallParams

    async def check_doctor_availability_tool(
        params: FunctionCallParams,
        doctor_name: str | None = None,
        specialty: str | None = None,
        date: str | None = None,
    ) -> None:
        """Find available appointment slots.

        Args:
            doctor_name: Optional full or partial doctor name.
            specialty: Optional medical specialty.
            date: Optional appointment date in YYYY-MM-DD format.
        """
        result = await check_doctor_availability(doctor_name, specialty, date)
        await params.llm.push_frame(OutputTransportMessageFrame(message={
            "type": "tool_call", "tool": "check_doctor_availability",
            "result": result, "timestamp": _timestamp(),
        }))
        await params.result_callback(result)

    async def book_appointment_tool(
        params: FunctionCallParams, slot_id: int, patient_phone: str
    ) -> None:
        """Book an available appointment slot.

        Args:
            slot_id: ID of the slot selected from availability results.
            patient_phone: Caller phone number, already read back and confirmed.
        """
        result = await book_appointment(slot_id, patient_phone)
        await params.llm.push_frame(OutputTransportMessageFrame(message={
            "type": "tool_call", "tool": "book_appointment",
            "result": result, "timestamp": _timestamp(),
        }))
        await params.result_callback(result)

    async def cancel_appointment_tool(
        params: FunctionCallParams,
        patient_phone: str,
        appointment_id: int | None = None,
    ) -> None:
        """List matching visits or cancel one explicitly selected appointment.

        Args:
            patient_phone: Caller phone number, already read back and confirmed.
            appointment_id: Specific appointment selected and confirmed by the
                caller. Omit it to list matching appointments first.
        """
        result = await cancel_appointment(patient_phone, appointment_id)
        await params.llm.push_frame(OutputTransportMessageFrame(message={
            "type": "tool_call", "tool": "cancel_appointment",
            "result": result, "timestamp": _timestamp(),
        }))
        await params.result_callback(result)

    async def get_patient_upcoming_appointments_tool(
        params: FunctionCallParams, patient_phone: str
    ) -> None:
        """Summarize booking count and return the nearest upcoming appointment.

        Args:
            patient_phone: Caller phone number already read back and confirmed.
        """
        result = await get_patient_upcoming_appointments(patient_phone)
        await params.llm.push_frame(OutputTransportMessageFrame(message={
            "type": "tool_call", "tool": "get_patient_upcoming_appointments",
            "result": result, "timestamp": _timestamp(),
        }))
        await params.result_callback(result)

    async def remember_caller_name_tool(
        params: FunctionCallParams, caller_name: str
    ) -> None:
        """Share the caller's preferred name with the UI for this call only.

        Args:
            caller_name: The name the caller asked Ava to use.
        """
        name = " ".join(caller_name.strip().split())[:80]
        if not name:
            result = {"status": "error", "message": "No caller name was provided."}
        else:
            result = {"status": "success", "caller_name": name}
            await params.llm.push_frame(OutputTransportMessageFrame(message={
                "type": "caller_identity", "name": name,
                "timestamp": _timestamp(),
            }))
        await params.result_callback(result)

    async def end_call_tool(params: FunctionCallParams) -> None:
        """Request call termination after Ava's goodbye audio finishes."""
        await params.llm.push_frame(OutputTransportMessageFrame(message={
            "type": "call_action", "action": "end_after_response",
            "timestamp": _timestamp(),
        }))
        await params.result_callback({"status": "success", "message": "The call will end after the goodbye."})

    # Pipecat derives the exposed function name and schema from these callables.
    check_doctor_availability_tool.__name__ = "check_doctor_availability"
    book_appointment_tool.__name__ = "book_appointment"
    cancel_appointment_tool.__name__ = "cancel_appointment"
    get_patient_upcoming_appointments_tool.__name__ = "get_patient_upcoming_appointments"
    remember_caller_name_tool.__name__ = "remember_caller_name"
    end_call_tool.__name__ = "end_call"

    class TranscriptEvents(FrameProcessor):
        def __init__(self, role: str, frame_type: type, **kwargs):
            super().__init__(**kwargs)
            self.role = role
            self.frame_type = frame_type
            self._assistant_text: list[str] = []

        async def process_frame(self, frame, direction: FrameDirection):
            """Forward frames and publish completed transcript messages."""
            await super().process_frame(frame, direction)
            if direction == FrameDirection.DOWNSTREAM:
                text = ""
                if self.role == "assistant" and isinstance(frame, TextFrame):
                    self._assistant_text.append(frame.text)
                elif self.role == "assistant" and isinstance(frame, LLMFullResponseEndFrame):
                    text = "".join(self._assistant_text).strip()
                    self._assistant_text.clear()
                elif self.role == "user" and isinstance(frame, self.frame_type):
                    text = getattr(frame, "text", "").strip()
                if text:
                    await self.push_frame(OutputTransportMessageFrame(message={
                        "type": "transcript", "role": self.role,
                        "text": text, "timestamp": _timestamp(),
                    }), direction)
            await self.push_frame(frame, direction)

    class ServiceErrorEvents(FrameProcessor):
        async def process_frame(self, frame, direction: FrameDirection):
            """Forward service errors as user-friendly WebSocket events."""
            await super().process_frame(frame, direction)
            if direction == FrameDirection.DOWNSTREAM and isinstance(frame, ErrorFrame):
                await self.push_frame(OutputTransportMessageFrame(message={
                    "type": "error",
                    "message": "A voice service is temporarily unavailable. Please try again shortly.",
                    "timestamp": _timestamp(),
                }), direction)
            await self.push_frame(frame, direction)

    # Register callable async functions on the LLM context. Pipecat supplies
    # FunctionCallParams to tool handlers when it invokes them.
    context = LLMContext(tools=[
        check_doctor_availability_tool,
        book_appointment_tool,
        cancel_appointment_tool,
        get_patient_upcoming_appointments_tool,
        remember_caller_name_tool,
        end_call_tool,
    ])

    stt = ElevenLabsSTTService(
        api_key=_required_env("ELEVENLABS_API_KEY"),
        aiohttp_session=aiohttp_session,
    )
    tts_settings = ElevenLabsTTSService.Settings(
        voice=os.getenv("ELEVENLABS_VOICE_ID") or None
    )
    tts = ElevenLabsTTSService(
        api_key=_required_env("ELEVENLABS_API_KEY"), settings=tts_settings
    )
    llm = GoogleLLMService(
        api_key=_required_env("GOOGLE_API_KEY"),
        settings=GoogleLLMService.Settings(
            model=os.getenv("GOOGLE_MODEL", "gemini-3.5-flash-lite"),
            system_instruction=SYSTEM_PROMPT,
        ),
    )

    user_aggregator, assistant_aggregator = LLMContextAggregatorPair(context)
    vad = VADProcessor(vad_analyzer=SileroVADAnalyzer())
    pipeline = Pipeline([
        transport.input(),
        vad,
        stt,
        ServiceErrorEvents(),
        TranscriptEvents("user", TranscriptionFrame),
        user_aggregator,
        llm,
        ServiceErrorEvents(),
        TranscriptEvents("assistant", TextFrame),
        tts,
        ServiceErrorEvents(),
        transport.output(),
        assistant_aggregator,
    ])
    params = PipelineParams(
        audio_in_sample_rate=16000,
        audio_out_sample_rate=16000,
        enable_metrics=True,
        enable_usage_metrics=True,
    )
    if legacy_task_api:
        runner_target = PipelineTask(pipeline, params=params)
    else:
        runner_target = PipelineWorker(pipeline, params=params)
    return pipeline, runner_target, legacy_task_api


async def run_voice_pipeline(transport: Any) -> None:
    """Run a voice session on a configured Pipecat transport."""
    import aiohttp

    async with aiohttp.ClientSession() as session:
        _, runner_target, legacy_task_api = create_voice_pipeline(transport, session)
        if legacy_task_api:
            from pipecat.pipeline.runner import PipelineRunner

            await PipelineRunner().run(runner_target)
        else:
            from pipecat.workers.runner import WorkerRunner

            runner = WorkerRunner(handle_sigint=False)
            await runner.add_workers(runner_target)
            await runner.run()
