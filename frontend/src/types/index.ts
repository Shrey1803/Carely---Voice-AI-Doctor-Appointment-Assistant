// ── Doctor ─────────────────────────────────────────────

export interface Doctor {
  id: number;
  name: string;
  specialty: string;
}

export interface DoctorWithSlots extends Doctor {
  available_slots: number;
}

// ── Slot ───────────────────────────────────────────────

export interface Slot {
  id: number;
  doctor_id: number;
  date: string;        // YYYY-MM-DD
  time: string;        // HH:MM
  duration_minutes: number;
  is_booked: boolean;
  doctor_name: string;
  specialty: string;
}

// ── Appointment ────────────────────────────────────────

export interface Appointment {
  id: number;
  doctor_id: number;
  slot_id: number;
  patient_phone: string;
  created_at: string;
  doctor_name: string;
  specialty: string;
  date: string;
  time: string;
}

// ── Call State ──────────────────────────────────────────

export type CallState = 'idle' | 'connecting' | 'connected' | 'ended';

// ── Transcript ─────────────────────────────────────────

export interface TranscriptMessage {
  role: 'user' | 'assistant' | 'system';
  text: string;
  timestamp: Date;
}

// ── WebSocket Messages ─────────────────────────────────

export interface WSTranscriptMessage {
  type: 'transcript';
  role: 'user' | 'assistant';
  text: string;
  timestamp: string;
}

export interface WSToolCallMessage {
  type: 'tool_call';
  tool: 'check_doctor_availability' | 'book_appointment' | 'cancel_appointment' | 'get_patient_upcoming_appointments';
  result: Record<string, unknown>;
  timestamp: string;
}

export interface WSCallStateMessage {
  type: 'call_state';
  state: 'connected' | 'ended';
  timestamp: string;
}

export interface WSCallerIdentityMessage {
  type: 'caller_identity';
  name: string;
  timestamp: string;
}

export interface WSCallActionMessage {
  type: 'call_action';
  action: 'end_after_response';
  timestamp: string;
}

export type WSMessage = WSTranscriptMessage | WSToolCallMessage | WSCallStateMessage | WSCallerIdentityMessage | WSCallActionMessage;

// ── API Response ───────────────────────────────────────

export interface HealthResponse {
  status: string;
  timestamp: string;
}
