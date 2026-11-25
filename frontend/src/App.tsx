import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Activity, ArrowRight, Bell, CalendarDays, Check, ChevronRight, Clock3,
  Grid2X2, HeartPulse, HelpCircle, Menu, Plus, Search, Settings,
  Stethoscope, Users, X,
} from 'lucide-react';
import { useApi } from './hooks/useApi';
import { useVoiceCall, type VoiceCallState } from './hooks/useVoiceCall';
import type { Appointment, DoctorWithSlots, Slot, WSMessage } from './types';
import { CallControls } from './components/CallControls';
import { PhoneCallUI } from './components/PhoneCallUI';
import { TranscriptPanel } from './components/TranscriptPanel';
import { playEndCallTone, startRingTone } from './utils/sounds';
import './index.css';

type View = 'Overview' | 'Appointments' | 'Doctors' | 'Patients' | 'Analytics' | 'Help center' | 'Settings';

const navigation: { label: View; icon: typeof Grid2X2 }[] = [
  { label: 'Overview', icon: Grid2X2 },
  { label: 'Appointments', icon: CalendarDays },
  { label: 'Doctors', icon: Stethoscope },
  { label: 'Patients', icon: Users },
  { label: 'Analytics', icon: Activity },
];
const avatarColors = [
  'bg-[#eee9ff] text-[#7254b5]', 'bg-[#e0efed] text-[#3d7772]',
  'bg-[#fbe8dc] text-[#9d6949]', 'bg-[#e6ecfb] text-[#5d72a5]',
  'bg-[#e3f2e8] text-[#4c8062]',
];

function initials(name: string) {
  return name.replace(/^Dr\.\s*/i, '').split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase();
}

function formatDate(date: string, options: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric' }) {
  const parsed = new Date(`${date}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? date : parsed.toLocaleDateString('en-US', options);
}

function formatTime(time: string) {
  const parsed = new Date(`2000-01-01T${time}`);
  return Number.isNaN(parsed.getTime()) ? time : parsed.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function formatBookedAt(value: string) {
  const normalized = /(?:Z|[+-]\d{2}:\d{2})$/i.test(value) ? value : `${value}Z`;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function maskPhone(phone: string) {
  const digits = phone.replace(/\D/g, '');
  return digits.length > 4 ? `••• ••• ${digits.slice(-4)}` : phone;
}

function getGreeting() {
  const hour = new Date().getHours();
  return hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
}

/** Main clinic dashboard and navigation shell. */
function App() {
  const { doctors, slots, appointments, loading, error, selectedDoctorId, setSelectedDoctorId, refresh } = useApi();
  const voiceCall = useVoiceCall();
  const [view, setView] = useState<View>('Overview');
  const [query, setQuery] = useState('');
  const [period, setPeriod] = useState<'This week' | 'Last week'>('This week');
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [phoneOpen, setPhoneOpen] = useState(false);
  const startVoiceCall = voiceCall.startCall;
  const endVoiceCall = voiceCall.endCall;
  const appointmentMutation = useMemo(() => [...voiceCall.messages].reverse().find((message) =>
    message.type === 'tool_call' && (message.tool === 'book_appointment' || message.tool === 'cancel_appointment') && message.result.status === 'success',
  ), [voiceCall.messages]);
  const highlightedAppointmentIds = appointmentMutation?.type === 'tool_call' && appointmentMutation.tool === 'book_appointment' && typeof appointmentMutation.result.appointment_id === 'number'
    ? [appointmentMutation.result.appointment_id]
    : [];
  const highlightedSlotIds = appointmentMutation?.type === 'tool_call' && appointmentMutation.tool === 'cancel_appointment' && Array.isArray(appointmentMutation.result.cancelled_appointments)
    ? appointmentMutation.result.cancelled_appointments.map((item) => (item as Record<string, unknown>).slot_id).filter((id): id is number => typeof id === 'number')
    : [];
  const previousCallState = useRef(voiceCall.state);
  const ringStopRef = useRef<(() => void) | null>(null);
  const lastProcessedMutationRef = useRef<string | null>(null);

  const handleStartCall = useCallback((preserveMessages = false) => {
    setPhoneOpen(true);
    ringStopRef.current?.();
    ringStopRef.current = startRingTone();
    void startVoiceCall({ preserveMessages });
  }, [startVoiceCall]);

  const handleEndCall = useCallback(() => {
    ringStopRef.current?.();
    ringStopRef.current = null;
    endVoiceCall();
  }, [endVoiceCall]);

  useEffect(() => {
    if (voiceCall.state === 'connected') {
      ringStopRef.current?.();
      ringStopRef.current = null;
    }
    if (voiceCall.state === 'ended') {
      ringStopRef.current?.();
      ringStopRef.current = null;
      if (previousCallState.current === 'connected') playEndCallTone();
      if (previousCallState.current !== 'ended') void refresh();
    }
    previousCallState.current = voiceCall.state;
  }, [voiceCall.state, refresh]);

  useEffect(() => {
    if (!appointmentMutation || appointmentMutation.type !== 'tool_call') return;
    const mutationKey = `${appointmentMutation.tool}:${appointmentMutation.timestamp}`;
    if (lastProcessedMutationRef.current === mutationKey) return;
    lastProcessedMutationRef.current = mutationKey;
    void refresh();
  }, [appointmentMutation, refresh]);

  useEffect(() => {
    if (!phoneOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previousOverflow; };
  }, [phoneOpen]);

  const filteredAppointments = useMemo(() => appointments.filter((appointment) => {
    const haystack = `${appointment.patient_phone} ${appointment.doctor_name} ${appointment.specialty}`.toLowerCase();
    return haystack.includes(query.trim().toLowerCase());
  }), [appointments, query]);

  const upcomingAppointments = appointments.filter((appointment) => appointment.date >= new Date().toISOString().slice(0, 10));
  const patientsCount = new Set(appointments.map((appointment) => appointment.patient_phone)).size;
  const doctorsAvailable = doctors.filter((doctor) => doctor.available_slots > 0).length;
  const nextAppointments = [...appointments].sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`)).slice(0, 6);
  const nextSlots = [...slots].sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`)).slice(0, 6);

  function navigate(nextView: View) {
    setView(nextView);
    setMobileNavOpen(false);
    if (nextView !== 'Doctors') setSelectedDoctorId(null);
  }

  const pageTitle = view === 'Overview' ? `${getGreeting()}, team` : view;

  return (
    <div className="min-h-screen overflow-x-hidden bg-[#f7f8fb] font-sans text-[#252737] selection:bg-violet-200">
      <div className={`transition-[filter] duration-300 ${phoneOpen ? 'pointer-events-none select-none blur-[3px]' : ''}`}>
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[244px] flex-col border-r border-[#eaebf1] bg-white px-5 py-7 lg:flex">
        <button onClick={() => navigate('Overview')} className="mb-12 flex min-h-14 items-center gap-2.5 px-3 text-[40px] font-bold tracking-[-1.8px] text-[#252737]" aria-label="Carely home">
          <span className="flex h-10 w-10 items-center justify-center rounded-[12px] bg-[#7960d5] text-white"><Plus className="h-7 w-7" strokeWidth={2} /></span>
          <span className="font-extrabold text-black" style={{ fontSize: '40px', lineHeight: 1 }}>carely</span><span className="-ml-2 font-extrabold text-[#7960d5]" style={{ fontSize: '40px', lineHeight: 1 }}>.</span>
        </button>
        <p className="mb-3 px-3 text-xs font-medium tracking-widest text-slate-500">WORKSPACE</p>
        <nav className="space-y-2" aria-label="Main navigation">
          {navigation.map(({ label, icon: Icon }) => (
            <button key={label} onClick={() => navigate(label)} className={`flex min-h-12 w-full items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 ${view === label ? 'bg-[#eee9fc] text-[#7654c4]' : 'text-slate-600 hover:bg-slate-50'}`}>
              <Icon className="h-5 w-5 shrink-0" />{label}
              {label === 'Appointments' && <span className="ml-auto rounded bg-[#f1edf9] px-1.5 py-0.5 text-xs text-[#7654c4]">{appointments.length}</span>}
            </button>
          ))}
        </nav>
        <div className="mt-auto">
          <div className="mb-6 rounded-xl bg-[#f7f5fc] p-4">
            <span className="mb-3 flex h-9 w-9 items-center justify-center rounded-full bg-white text-[#7960d5]"><HelpCircle className="h-5 w-5" /></span>
            <p className="text-sm font-semibold">A little help?</p>
            <p className="mt-1 text-xs leading-5 text-slate-600">Your appointment dashboard, at a glance.</p>
            <button onClick={() => navigate('Help center')} className="mt-3 min-h-11 w-full rounded-lg border border-[#e5dff4] bg-white px-3 text-sm font-medium text-[#6b50b4] hover:bg-violet-50">Visit help center <ArrowRight className="ml-1 inline h-4 w-4" /></button>
          </div>
          <button onClick={() => navigate('Settings')} className="flex min-h-11 w-full items-center gap-3 px-3 text-sm text-slate-600 hover:text-violet-700"><Settings className="h-5 w-5" />Settings</button>
          <div className="mt-5 flex items-center gap-3 border-t border-slate-100 pt-5">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#eee7dc] text-sm font-semibold text-[#80664d]">MC</span>
            <div><p className="text-sm font-semibold">Clinic team</p><p className="text-xs text-slate-500">Appointment workspace</p></div>
          </div>
        </div>
      </aside>

      <div className="lg:ml-[244px]">
        <header className="flex min-h-[76px] items-center justify-between gap-3 border-b border-[#eaebf1] bg-white px-4 md:px-8">
          <div className="flex items-center gap-2 text-sm">
            <button className="rounded-lg p-2 text-slate-600 hover:bg-slate-50 lg:hidden" onClick={() => setMobileNavOpen(!mobileNavOpen)} aria-label={mobileNavOpen ? 'Close menu' : 'Open menu'}>{mobileNavOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}</button>
            <button onClick={() => navigate('Overview')} className="flex items-center gap-1.5 font-bold tracking-tight lg:hidden" aria-label="Carely home"><span className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-[#7960d5] text-white"><Plus className="h-5 w-5" /></span><span className="text-[22px] font-bold text-[#151522]">carely<span className="text-[#7960d5]">.</span></span></button>
            <span className="hidden text-slate-500 md:inline">Workspace</span><ChevronRight className="hidden h-3 w-3 text-slate-400 md:block" /><span className="font-medium">{view}</span>
          </div>
          <div className="flex items-center gap-2 md:gap-5">
            <span className="hidden text-sm text-slate-600 md:block">{new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
            <span className={`hidden items-center gap-1.5 text-xs sm:flex ${error ? 'text-rose-600' : 'text-[#397b58]'}`}><span className={`h-2 w-2 rounded-full ${error ? 'bg-rose-500' : 'bg-emerald-500'}`} />{error ? 'API offline' : 'Live data'}</span>
            <div className="relative">
              <button aria-label="Appointment notifications" aria-expanded={notificationsOpen} className="relative flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 hover:bg-slate-50" onClick={() => setNotificationsOpen(!notificationsOpen)}><Bell className="h-5 w-5" />{upcomingAppointments.length > 0 && <span className="absolute right-2.5 top-2 h-1.5 w-1.5 rounded-full bg-[#856bdc]" />}</button>
              {notificationsOpen && <div className="absolute right-0 top-12 z-40 w-72 rounded-xl border border-slate-200 bg-white p-5 shadow-lg"><p className="font-semibold">Appointment activity</p><p className="mt-2 text-sm leading-6 text-slate-600">{upcomingAppointments.length ? `${upcomingAppointments.length} upcoming appointment${upcomingAppointments.length === 1 ? '' : 's'} in your schedule.` : 'No upcoming appointments are currently scheduled.'}</p></div>}
            </div>
            <span className="hidden h-10 w-10 items-center justify-center rounded-full bg-[#eee7dc] text-sm font-semibold text-[#80664d] sm:flex" aria-label="Clinic team profile">MC</span>
            <CallControls compact state={voiceCall.state} isMuted={voiceCall.isMuted} durationSeconds={voiceCall.durationSeconds} onStart={handleStartCall} onOpenCall={() => setPhoneOpen(true)} onToggleMute={voiceCall.toggleMute} onEnd={handleEndCall} />
          </div>
        </header>
        {mobileNavOpen && <nav className="grid grid-cols-2 gap-2 border-b border-slate-200 bg-white p-3 sm:grid-cols-3 lg:hidden">{navigation.map(({ label, icon: Icon }) => <button key={label} onClick={() => navigate(label)} className={`flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm ${view === label ? 'bg-violet-100 text-violet-800' : 'text-slate-600 hover:bg-slate-50'}`}><Icon className="h-4 w-4" />{label}</button>)}</nav>}
        {voiceCall.error && voiceCall.state === 'idle' && <div role="alert" className="mx-4 mt-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 md:mx-8">Voice call error: {voiceCall.error}</div>}
        {error && <div role="alert" className="mx-4 mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 md:mx-8">Can’t reach the backend. Check that the backend is running, then <button onClick={() => void refresh()} className="font-semibold underline">retry</button>.</div>}

        <main className="mx-auto max-w-[1600px] space-y-7 p-4 md:p-8">
          <section className="flex flex-wrap items-end justify-between gap-4">
            <div><div className="mb-1.5 flex items-center gap-2 text-sm text-slate-500"><span className="h-1.5 w-1.5 rounded-full bg-[#65a78c]" /> A little clarity. Better care.</div><h1 className="text-[28px] font-semibold tracking-[-1px] md:text-[30px]">{pageTitle}<span className="text-[#8d79bf]">.</span></h1><p className="mt-1.5 text-sm text-slate-500">Here’s what’s happening at your clinic.</p></div>
            <div className="flex min-h-11 items-center gap-2 rounded-lg border border-[#e2e3eb] bg-white px-3 py-2 text-sm text-slate-600"><CalendarDays className="h-4 w-4" />{new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</div>
          </section>

          {!phoneOpen && (voiceCall.state !== 'idle' || voiceCall.messages.length > 0) && <CallPanel state={voiceCall.state} error={voiceCall.error} messages={voiceCall.messages} isMuted={voiceCall.isMuted} durationSeconds={voiceCall.durationSeconds} onToggleMute={voiceCall.toggleMute} onEnd={handleEndCall} onNewCall={handleStartCall} />}

          {(view === 'Overview' || view === 'Analytics') && <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard label="Appointments" value={appointments.length} note="Currently booked" icon={CalendarDays} tone="purple" />
            <MetricCard label="Patients" value={patientsCount} note="Unique phone numbers" icon={Users} tone="green" />
            <MetricCard label="Available doctors" value={doctorsAvailable} note={`Out of ${doctors.length} doctors`} icon={Stethoscope} tone="blue" />
            <MetricCard label="Open slots" value={slots.length} note="Available to book" icon={Check} tone="gold" />
          </section>}

          {(view === 'Overview' || view === 'Analytics') && <section className="grid gap-5 xl:grid-cols-5">
            <div className="rounded-xl border border-[#e6e7ee] bg-white p-5 md:col-span-3 md:p-6"><div className="mb-5 flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-base font-semibold">Appointment activity</h2><p className="mt-1 text-sm text-slate-500">A little perspective on your week</p></div><select aria-label="Select appointment activity week" value={period} onChange={(event) => setPeriod(event.target.value as 'This week' | 'Last week')} className="min-h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-600 outline-none focus-visible:ring-2 focus-visible:ring-violet-500"><option>This week</option><option>Last week</option></select></div><div className="mb-3 flex items-center justify-between text-xs text-slate-500"><span className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-[#9b83dc]" />Appointments</span><span>{period === 'This week' ? 'This week' : 'Last week'} · clinic bookings</span></div><AppointmentChart appointments={appointments} period={period} /></div>
            <DailyDoseCard onMeetTeam={() => navigate('Doctors')} />
          </section>}

          {(view === 'Overview' || view === 'Doctors') && <section>
            <div className="mb-4 flex items-center justify-between"><div className="flex items-center gap-2"><h2 className="text-base font-semibold">Your care team</h2><span className="rounded-md bg-[#ece9f4] px-2 py-0.5 text-xs text-[#6e5b9a]">{doctors.length} doctors</span></div>{view === 'Overview' && <button onClick={() => navigate('Doctors')} className="flex min-h-11 items-center gap-2 text-sm font-medium text-[#7a5bb8]">View doctors<ArrowRight className="h-4 w-4" /></button>}</div>
            {loading && doctors.length === 0 ? <CardSkeleton /> : doctors.length === 0 ? <EmptyState title="No doctors found" detail="Doctors will appear here when they are added to the clinic database." /> : <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{doctors.map((doctor, index) => <DoctorCard key={doctor.id} doctor={doctor} index={index} visits={appointments.filter((appointment) => appointment.doctor_id === doctor.id).length} selected={selectedDoctorId === doctor.id} onClick={() => { setSelectedDoctorId(selectedDoctorId === doctor.id ? null : doctor.id); setView('Doctors'); }} />)}</div>}
          </section>}

          {(view === 'Overview' || view === 'Doctors') && <AvailableSlotsTable slots={slots} loading={loading} selectedDoctor={doctors.find((doctor) => doctor.id === selectedDoctorId)} highlightedSlotIds={highlightedSlotIds} onClearFilter={() => setSelectedDoctorId(null)} />}

          {(view === 'Overview' || view === 'Appointments' || view === 'Patients') && <section className="min-w-0 overflow-hidden rounded-xl border border-[#e6e7ee] bg-white">
            <div className="flex flex-wrap items-center justify-between gap-3 px-5 pb-4 pt-5"><div className="flex items-center gap-2"><h2 className="text-base font-semibold">{view === 'Patients' ? 'Patient directory' : 'Appointments'}</h2><span className="rounded-md bg-[#f1eef8] px-2 py-0.5 text-xs text-[#765f9e]">{view === 'Patients' ? patientsCount : appointments.length}</span></div><span className="flex items-center gap-1.5 text-xs text-slate-500"><span className="h-1.5 w-1.5 rounded-full bg-[#6fa287]" />Synced from clinic database</span></div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 pb-5"><div className="flex items-center gap-2 rounded-lg border border-slate-200 px-3"><Search className="h-4 w-4 text-slate-500" /><input aria-label="Search appointments" placeholder={view === 'Patients' ? 'Search phone number…' : 'Search doctor, specialty, phone…'} value={query} onChange={(event) => setQuery(event.target.value)} className="min-h-11 w-64 max-w-[65vw] bg-transparent text-sm outline-none focus-visible:ring-2 focus-visible:ring-violet-500" /></div><span className="text-xs text-slate-500">{filteredAppointments.length} shown</span></div>
            <AppointmentTable appointments={filteredAppointments} loading={loading} highlightedAppointmentIds={highlightedAppointmentIds} />
            <div className="flex items-center justify-between border-t border-slate-100 px-5 py-4 text-xs text-slate-500"><span>Showing {filteredAppointments.length} of {appointments.length} appointments</span><span>Times shown in your local timezone</span></div>
          </section>}

          {(view === 'Overview' || view === 'Appointments') && <section className="grid gap-6 xl:grid-cols-2">
            <div className="overflow-hidden rounded-xl border border-[#e6e7ee] bg-white"><div className="flex items-center justify-between px-5 pb-4 pt-5"><div><h2 className="text-base font-semibold">Upcoming appointments</h2><p className="mt-1 text-xs text-slate-500">Your next scheduled visits</p></div><button onClick={() => navigate('Appointments')} className="flex min-h-11 items-center gap-1 text-sm font-medium text-[#7654c4]">All appointments<ArrowRight className="h-4 w-4" /></button></div>{nextAppointments.length ? <div className="divide-y divide-slate-100">{nextAppointments.map((appointment, index) => <AppointmentMini key={appointment.id} appointment={appointment} index={index} highlighted={highlightedAppointmentIds.includes(appointment.id)} />)}</div> : <EmptyState title="No appointments yet" detail="Booked appointments will show up here." />}</div>
            <div className="overflow-hidden rounded-xl border border-[#e6e7ee] bg-white"><div className="flex items-center justify-between px-5 pb-4 pt-5"><div><h2 className="text-base font-semibold">Available times</h2><p className="mt-1 text-xs text-slate-500">Open slots from your doctors</p></div><span className="rounded-md bg-[#f1eef8] px-2 py-1 text-xs text-[#765f9e]">{slots.length} open</span></div>{nextSlots.length ? <div className="divide-y divide-slate-100">{nextSlots.map((slot, index) => <SlotMini key={slot.id} slot={slot} index={index} onSelectDoctor={() => { setSelectedDoctorId(slot.doctor_id); setView('Doctors'); }} />)}</div> : <EmptyState title="No open slots" detail="There are no available appointment times right now." />}</div>
          </section>}

          {view === 'Help center' && <section className="rounded-xl border border-slate-200 bg-white p-8"><HelpCircle className="mb-4 h-8 w-8 text-violet-600" /><h2 className="text-xl font-semibold">Welcome to Carely</h2><p className="mt-3 max-w-xl text-sm leading-7 text-slate-600">Use the dashboard to review doctors, open appointment slots, and bookings. To book or cancel an appointment by voice, choose <strong>Try call</strong> and speak with Ava.</p><button onClick={() => void refresh()} className="mt-5 min-h-11 rounded-lg bg-violet-100 px-4 text-sm font-medium text-violet-900">Refresh clinic data</button></section>}
          {view === 'Settings' && <section className="rounded-xl border border-slate-200 bg-white p-8"><Settings className="mb-4 h-8 w-8 text-violet-600" /><h2 className="text-xl font-semibold">Workspace settings</h2><p className="mt-3 max-w-xl text-sm leading-7 text-slate-600">This dashboard displays clinic data from the connected backend. Patient phone numbers are masked in appointment rows to limit exposure on screen.</p><button onClick={() => void refresh()} className="mt-5 min-h-11 rounded-lg bg-violet-100 px-4 text-sm font-medium text-violet-900">Refresh clinic data</button></section>}

          <footer className="flex flex-wrap justify-between gap-2 pb-1 text-xs text-slate-500"><span>Thoughtfully designed for better care.</span><span>Carely workspace · Live clinic data</span></footer>
        </main>
      </div>
      </div>
      <AnimatePresence>{phoneOpen && <motion.div key="phone-call" className="fixed inset-0 z-50" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.2 } }}><PhoneCallUI state={voiceCall.state} messages={voiceCall.messages} error={voiceCall.error} durationSeconds={voiceCall.durationSeconds} isMuted={voiceCall.isMuted} audioAnalyser={voiceCall.audioAnalyser} microphoneAnalyser={voiceCall.microphoneAnalyser} isAssistantSpeaking={voiceCall.isAssistantSpeaking} onToggleMute={voiceCall.toggleMute} onEnd={handleEndCall} onCallAgain={handleStartCall} onReconnect={() => handleStartCall(true)} onDismiss={() => { setPhoneOpen(false); voiceCall.resetCall(); }} onMinimize={() => setPhoneOpen(false)} /></motion.div>}</AnimatePresence>
    </div>
  );
}

/** Shows one clinic summary metric with its visual category. */
function MetricCard({ label, value, note, icon: Icon, tone }: { label: string; value: number; note: string; icon: typeof CalendarDays; tone: 'purple' | 'green' | 'blue' | 'gold' }) {
  const toneClass = { purple: 'bg-[#eeeafa] text-[#8162ce]', green: 'bg-[#e8f3ee] text-[#4a8b73]', blue: 'bg-[#e9effb] text-[#6285b4]', gold: 'bg-[#fbf0df] text-[#ae8550]' }[tone];
  return <article className="rounded-xl border border-[#e6e7ee] bg-white p-5"><div className="flex items-center justify-between"><span className="text-sm text-slate-600">{label}</span><span className={`flex h-10 w-10 items-center justify-center rounded-xl ${toneClass}`}><Icon className="h-5 w-5" /></span></div><p className="mb-3 mt-2 text-[30px] font-semibold tracking-tight">{value.toLocaleString()}</p><div className="flex items-center gap-1.5 text-xs text-slate-500"><span className="h-1.5 w-1.5 rounded-full bg-[#75a88c]" />{note}</div></article>;
}

/** Embeds the voice call status, controls, and transcript in the dashboard. */
function CallPanel({ state, error, messages, isMuted, durationSeconds, onToggleMute, onEnd, onNewCall }: {
  state: VoiceCallState;
  error: string | null;
  messages: WSMessage[];
  isMuted: boolean;
  durationSeconds: number;
  onToggleMute: () => void;
  onEnd: () => void;
  onNewCall: () => void;
}) {
  const timer = `${String(Math.floor(durationSeconds / 60)).padStart(2, '0')}:${String(durationSeconds % 60).padStart(2, '0')}`;

  return <section aria-label="Voice call with Ava" className="overflow-hidden rounded-xl border border-[#e2dcef] bg-white shadow-sm">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-[#fbfaff] px-5 py-4">
      <div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#eee9fc] text-[#7654c4]"><HeartPulse className="h-5 w-5" /></span><div><h2 className="text-sm font-semibold">Ava · Voice receptionist</h2><div className="mt-1 flex items-center gap-2 text-xs text-slate-500"><span className={`h-1.5 w-1.5 rounded-full ${state === 'connected' ? 'bg-emerald-500' : state === 'connecting' ? 'animate-pulse bg-amber-500' : 'bg-slate-400'}`} />{state === 'connecting' ? 'Connecting to the clinic…' : state === 'connected' ? `Connected · ${timer}` : 'Call ended'}</div></div></div>
      <CallControls state={state} isMuted={isMuted} durationSeconds={durationSeconds} onStart={onNewCall} onToggleMute={onToggleMute} onEnd={onEnd} />
    </div>
    {error && <p role="alert" className="border-b border-rose-100 bg-rose-50 px-5 py-3 text-sm text-rose-700">{error}</p>}
    <TranscriptPanel messages={messages} state={state} />
  </section>;
}

/** Shows a selectable doctor summary and availability status. */
function DoctorCard({ doctor, index, visits, selected, onClick }: { doctor: DoctorWithSlots; index: number; visits: number; selected: boolean; onClick: () => void }) {
  return <button onClick={onClick} aria-pressed={selected} className={`rounded-xl border bg-white p-4 text-left transition hover:-translate-y-0.5 hover:shadow-md ${selected ? 'border-[#9279da] ring-2 ring-violet-100' : 'border-[#e6e7ee] hover:border-violet-200'}`}><div className="mb-4 flex items-center gap-3"><span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${avatarColors[index % avatarColors.length]}`}>{initials(doctor.name)}</span><span className="min-w-0"><span className="block truncate text-sm font-semibold">{doctor.name}</span><span className="mt-1 block text-xs text-slate-500">{doctor.specialty}</span></span></div><div className="flex items-center justify-between border-t border-slate-100 pt-3"><span className={`flex items-center gap-1.5 text-xs ${doctor.available_slots ? 'text-[#387657]' : 'text-[#976b24]'}`}><span className={`h-1.5 w-1.5 rounded-full ${doctor.available_slots ? 'bg-[#63a37e]' : 'bg-[#c59c53]'}`} />{doctor.available_slots ? 'Available' : 'Fully booked'}</span><span className="text-xs font-medium text-slate-600">{visits} {visits === 1 ? 'visit' : 'visits'} <ArrowRight className="ml-1 inline h-3 w-3" /></span></div></button>;
}

/** Renders appointment rows with their current status. */
function AppointmentTable({ appointments, loading, highlightedAppointmentIds }: { appointments: Appointment[]; loading: boolean; highlightedAppointmentIds: number[] }) {
  if (loading && appointments.length === 0) return <div className="space-y-3 p-5"><div className="h-10 animate-pulse rounded-lg bg-slate-100" /><div className="h-10 animate-pulse rounded-lg bg-slate-100" /><div className="h-10 animate-pulse rounded-lg bg-slate-100" /></div>;
  if (!appointments.length) return <EmptyState title="No appointments found" detail="Try another search, or book an appointment with Ava." />;
  return <div className="overflow-x-auto"><table className="w-full min-w-[850px] text-left text-sm"><thead className="bg-[#fafafd] text-xs text-slate-500"><tr>{['Patient phone', 'Doctor', 'Specialty', 'Date', 'Time', 'Booked on'].map((heading) => <th key={heading} className="px-5 py-3 font-medium">{heading}</th>)}</tr></thead><tbody><AnimatePresence initial={false}>{appointments.map((appointment, index) => {
    const highlighted = highlightedAppointmentIds.includes(appointment.id);
    return <motion.tr key={appointment.id} initial={{ opacity: 0 }} animate={{ opacity: 1, backgroundColor: highlighted ? ['#dcfce7', '#bbf7d0', '#dcfce7', 'rgba(255,255,255,0)'] : 'rgba(255,255,255,0)' }} exit={{ opacity: 0, y: -4 }} transition={{ opacity: { duration: 0.25 }, backgroundColor: { duration: 3.2, ease: 'easeInOut' } }} className="border-t border-[#f0f0f5] hover:bg-[#fcfbfe]"><td className="px-5 py-3"><div className="flex items-center gap-3"><span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ${avatarColors[index % avatarColors.length]}`}><Users className="h-4 w-4" /></span><span className="font-medium">{maskPhone(appointment.patient_phone)}</span></div></td><td className="px-5 py-3 font-medium">{appointment.doctor_name}</td><td className="px-5 py-3 text-slate-600">{appointment.specialty}</td><td className="whitespace-nowrap px-5 py-3 text-slate-600">{formatDate(appointment.date)}</td><td className="whitespace-nowrap px-5 py-3 text-slate-600">{formatTime(appointment.time)}</td><td className="whitespace-nowrap px-5 py-3 text-slate-500">{formatBookedAt(appointment.created_at)}</td></motion.tr>;
  })}</AnimatePresence></tbody></table></div>;
}

/** Lists available slots and supports filtering by the selected doctor. */
function AvailableSlotsTable({ slots, loading, selectedDoctor, highlightedSlotIds, onClearFilter }: { slots: Slot[]; loading: boolean; selectedDoctor?: DoctorWithSlots; highlightedSlotIds: number[]; onClearFilter: () => void }) {
  const sortedSlots = useMemo(() => [...slots].sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`)), [slots]);
  return <section className="min-w-0 overflow-hidden rounded-xl border border-[#e6e7ee] bg-white">
    <div className="flex flex-wrap items-center justify-between gap-3 px-5 pb-4 pt-5">
      <div className="flex flex-wrap items-center gap-2"><h2 className="text-base font-semibold">Available slots</h2><span className="rounded-md bg-[#f1eef8] px-2 py-0.5 text-xs text-[#765f9e]">{selectedDoctor ? `${sortedSlots.length} for ${selectedDoctor.name}` : `${sortedSlots.length} total`}</span></div>
      {selectedDoctor ? <button onClick={onClearFilter} className="min-h-10 rounded-lg px-3 text-sm font-medium text-[#7654c4] hover:bg-violet-50">Show all doctors</button> : <span className="text-xs text-slate-500">Click a doctor card to filter</span>}
    </div>
    {loading && sortedSlots.length === 0 ? <div className="space-y-3 p-5" aria-label="Loading appointment slots"><div className="h-10 animate-pulse rounded-lg bg-slate-100" /><div className="h-10 animate-pulse rounded-lg bg-slate-100" /><div className="h-10 animate-pulse rounded-lg bg-slate-100" /></div> : sortedSlots.length === 0 ? <EmptyState title={selectedDoctor ? `No open slots for ${selectedDoctor.name}` : 'No available slots'} detail="There are no unbooked appointment times to show right now." /> : <div className="overflow-x-auto"><table className="w-full min-w-[680px] text-left text-sm"><thead className="bg-[#fafafd] text-xs text-slate-500"><tr>{['Doctor', 'Specialty', 'Date', 'Time', 'Duration', 'Status'].map((heading) => <th key={heading} className="px-5 py-3 font-medium">{heading}</th>)}</tr></thead><tbody>{sortedSlots.map((slot) => {
      const highlighted = highlightedSlotIds.includes(slot.id);
      return <motion.tr key={slot.id} initial={{ opacity: 0 }} animate={{ opacity: 1, backgroundColor: highlighted ? ['#dcfce7', '#bbf7d0', '#dcfce7', 'rgba(255,255,255,0)'] : 'rgba(255,255,255,0)' }} transition={{ opacity: { duration: 0.25 }, backgroundColor: { duration: 3.2, ease: 'easeInOut' } }} className="border-t border-[#f0f0f5] transition-colors hover:bg-[#fcfbfe]"><td className="px-5 py-3 font-medium">{slot.doctor_name}</td><td className="px-5 py-3 text-slate-600">{slot.specialty}</td><td className="whitespace-nowrap px-5 py-3 text-slate-600">{formatDate(slot.date)}</td><td className="whitespace-nowrap px-5 py-3 text-slate-600">{formatTime(slot.time)}</td><td className="whitespace-nowrap px-5 py-3 text-slate-600">{slot.duration_minutes} min</td><td className="px-5 py-3"><span className="inline-flex items-center gap-1.5 rounded-full bg-[#eaf6ef] px-2.5 py-1 text-xs font-medium text-[#30734c]"><span className="h-1.5 w-1.5 rounded-full bg-[#65a981]" />Available</span></td></motion.tr>;
    })}</tbody></table></div>}
    <div className="flex items-center justify-between border-t border-slate-100 px-5 py-4 text-xs text-slate-500"><span>Showing {sortedSlots.length} available slots</span><span>Sorted by date and time</span></div>
  </section>;
}

/** Displays a compact appointment item for the dashboard overview. */
function AppointmentMini({ appointment, index, highlighted }: { appointment: Appointment; index: number; highlighted: boolean }) {
  return <motion.div initial={false} animate={{ backgroundColor: highlighted ? ['#dcfce7', '#bbf7d0', '#dcfce7', 'rgba(255,255,255,0)'] : 'rgba(255,255,255,0)' }} transition={{ backgroundColor: { duration: 3.2, ease: 'easeInOut' } }} className="flex items-center justify-between gap-3 px-5 py-3"><div className="flex min-w-0 items-center gap-3"><span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${avatarColors[index % avatarColors.length]}`}><Users className="h-4 w-4" /></span><div className="min-w-0"><p className="truncate text-sm font-medium">{appointment.doctor_name}</p><p className="mt-0.5 truncate text-xs text-slate-500">{maskPhone(appointment.patient_phone)} · {appointment.specialty}</p></div></div><div className="shrink-0 text-right"><p className="text-sm font-medium">{formatTime(appointment.time)}</p><p className="mt-0.5 text-xs text-slate-500">{formatDate(appointment.date)}</p></div></motion.div>;
}

/** Displays a compact available slot with its doctor and local time. */
function SlotMini({ slot, index, onSelectDoctor }: { slot: Slot; index: number; onSelectDoctor: () => void }) {
  return <button onClick={onSelectDoctor} className="flex w-full items-center justify-between gap-3 px-5 py-3 text-left transition hover:bg-[#fcfbfe]"><div className="flex min-w-0 items-center gap-3"><span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${avatarColors[index % avatarColors.length]}`}><Stethoscope className="h-4 w-4" /></span><div className="min-w-0"><p className="truncate text-sm font-medium">{slot.doctor_name}</p><p className="mt-0.5 truncate text-xs text-slate-500">{slot.specialty}</p></div></div><div className="shrink-0 text-right"><p className="text-sm font-medium">{formatTime(slot.time)}</p><p className="mt-0.5 text-xs text-slate-500">{formatDate(slot.date)}</p></div></button>;
}

/** Summarizes appointment counts by day for the selected week. */
function AppointmentChart({ appointments, period }: { appointments: Appointment[]; period: 'This week' | 'Last week' }) {
  const buckets = useMemo(() => {
    const monday = new Date();
    monday.setHours(0, 0, 0, 0);
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7) - (period === 'Last week' ? 7 : 0));
    return Array.from({ length: 7 }, (_, index) => {
      const day = new Date(monday);
      day.setDate(monday.getDate() + index);
      const key = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
      return { key, label: day.toLocaleDateString('en-US', { weekday: 'short' }), count: appointments.filter((appointment) => appointment.date === key).length };
    });
  }, [appointments, period]);
  const maxCount = Math.max(1, ...buckets.map(({ count }) => count));
  const currentWeekday = period === 'This week' ? (new Date().getDay() + 6) % 7 : -1;
  return <div className="flex h-44 items-end gap-2 border-b border-l border-slate-100 px-2 pb-2 pt-4 sm:gap-4">{buckets.map(({ key, label, count }, index) => <div key={key} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-2"><span className="text-[10px] text-slate-500">{count || ''}</span><div title={`${label}: ${count} appointment${count === 1 ? '' : 's'}`} className={`w-full max-w-10 rounded-t-md transition-all ${index === currentWeekday ? 'bg-[#8162ce]' : 'bg-[#e5ddf5]'}`} style={{ height: `${Math.max(3, (count / maxCount) * 74)}%` }} /><span className="text-[10px] text-slate-500 sm:text-xs">{label}</span></div>)}</div>;
}

/** Provides the dashboard's clinic team feature card. */
function DailyDoseCard({ onMeetTeam }: { onMeetTeam: () => void }) {
  return <article className="relative min-h-[250px] overflow-hidden rounded-xl bg-[#e7f1ed] p-6 md:col-span-2"><div className="relative z-10 max-w-[260px]"><span className="inline-flex items-center gap-2 rounded-full bg-white/80 px-3 py-1 text-[10px] font-medium tracking-wide text-[#587d6d]"><span className="h-1.5 w-1.5 rounded-full bg-[#72a38d]" />YOUR DAILY DOSE</span><h2 className="mt-5 text-[22px] font-semibold leading-8 tracking-[-.4px] text-[#31584a]">Great care starts with a great team.</h2><p className="mt-3 text-sm leading-6 text-[#557366]">A connected team makes all the difference. Let’s make today count.</p><button onClick={onMeetTeam} className="mt-5 inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-[#31584a] hover:text-[#7654c4]">Meet your team <ArrowRight className="h-4 w-4" /></button></div><div aria-hidden="true" className="pointer-events-none absolute -bottom-20 -right-16 flex h-56 w-56 items-center justify-center rounded-full border-[18px] border-[#d5e5dc]"><div className="flex h-36 w-36 items-center justify-center rounded-full bg-[#d1e2d8]"><HeartPulse className="h-12 w-12 text-[#739b86]" strokeWidth={1.5} /></div></div></article>;
}

/** Shows loading placeholders while dashboard data is fetched. */
function CardSkeleton() {
  return <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{[0, 1, 2, 3].map((item) => <div key={item} className="h-36 animate-pulse rounded-xl border border-slate-200 bg-white p-4"><div className="mb-4 h-10 w-10 rounded-full bg-slate-100" /><div className="mb-2 h-4 w-2/3 rounded bg-slate-100" /><div className="h-3 w-1/3 rounded bg-slate-100" /></div>)}</div>;
}

/** Provides a consistent message when a list has no content. */
function EmptyState({ title, detail }: { title: string; detail: string }) {
  return <div className="flex flex-col items-center justify-center px-6 py-10 text-center"><span className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-[#f3f0fa] text-[#8066c3]"><Clock3 className="h-5 w-5" /></span><p className="text-sm font-semibold text-slate-700">{title}</p><p className="mt-1 max-w-sm text-xs leading-5 text-slate-500">{detail}</p></div>;
}

export default App;
