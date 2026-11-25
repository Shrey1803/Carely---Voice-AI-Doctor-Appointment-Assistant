import { useState, useEffect, useCallback, useRef } from 'react';
import type { DoctorWithSlots, Slot, Appointment } from '../types';

const API_BASE = '/api';

interface UseApiReturn {
  doctors: DoctorWithSlots[];
  slots: Slot[];
  appointments: Appointment[];
  loading: boolean;
  error: string | null;
  selectedDoctorId: number | null;
  setSelectedDoctorId: (id: number | null) => void;
  refresh: () => Promise<void>;
}

export function useApi(): UseApiReturn {
  const [doctors, setDoctors] = useState<DoctorWithSlots[]>([]);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedDoctorId, setSelectedDoctorId] = useState<number | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [doctorsRes, appointmentsRes] = await Promise.all([
        fetch(`${API_BASE}/doctors`),
        fetch(`${API_BASE}/appointments`),
      ]);

      if (!doctorsRes.ok || !appointmentsRes.ok) {
        throw new Error('Failed to fetch data from API');
      }

      const doctorsData: DoctorWithSlots[] = await doctorsRes.json();
      const appointmentsData: Appointment[] = await appointmentsRes.json();

      setDoctors(doctorsData);
      setAppointments(appointmentsData);
      setError(null);

      // Fetch slots for selected doctor, or all doctors
      if (selectedDoctorId) {
        const slotsRes = await fetch(`${API_BASE}/doctors/${selectedDoctorId}/slots`);
        if (slotsRes.ok) {
          setSlots(await slotsRes.json());
        }
      } else {
        // Fetch slots for all doctors
        const allSlots: Slot[] = [];
        for (const doc of doctorsData) {
          const slotsRes = await fetch(`${API_BASE}/doctors/${doc.id}/slots`);
          if (slotsRes.ok) {
            const docSlots: Slot[] = await slotsRes.json();
            allSlots.push(...docSlots);
          }
        }
        setSlots(allSlots);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [selectedDoctorId]);

  const refresh = useCallback(async () => {
    setLoading(true);
    await fetchData();
  }, [fetchData]);

  // Initial fetch + auto-refresh every 5 seconds
  useEffect(() => {
    fetchData();

    intervalRef.current = setInterval(fetchData, 5000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchData]);

  return {
    doctors,
    slots,
    appointments,
    loading,
    error,
    selectedDoctorId,
    setSelectedDoctorId,
    refresh,
  };
}
