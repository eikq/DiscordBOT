import { useCallback, useEffect, useState } from 'react';

type ServiceRow = {
  id: string;
  displayNameTh: string;
  displayNameEn: string;
  descriptionTh: string;
  descriptionEn: string;
  state: string;
  ownedByJarvis: boolean;
  canStop: boolean;
  canStart: boolean;
  ramBytes?: number;
  noteTh?: string;
  noteEn?: string;
};

export default function CommunityServicesPanel() {
  const [services, setServices] = useState<ServiceRow[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmStop, setConfirmStop] = useState<string | null>(null);

  const refresh = useCallback(() => {
    void fetch('/api/jarvis/services')
      .then(reply => reply.json() as Promise<{ services?: ServiceRow[] }>)
      .then(payload => setServices(payload.services || []))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, 4000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const act = async (id: string, action: 'start' | 'stop' | 'restart') => {
    setBusy(`${id}:${action}`);
    setError(null);
    try {
      const reply = await fetch(`/api/jarvis/services/${id}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      const payload = await reply.json() as { error?: string };
      if (!reply.ok) throw new Error(payload.error || reply.statusText);
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
      setConfirmStop(null);
    }
  };

  if (!services.length) return null;
  return (
    <aside className="jp-services" aria-label="Services">
      <span>SERVICES</span>
      {error ? <p className="jp-services__err">{error}</p> : null}
      <ul>
        {services.map(service => (
          <li key={service.id}>
            <strong>{service.displayNameTh}</strong>
            <em data-state={service.state}>{service.state.replaceAll('_', ' ')}</em>
            <small>{service.descriptionTh}</small>
            {typeof service.ramBytes === 'number' ? (
              <small>RAM {(service.ramBytes / (1024 ** 3)).toFixed(1)} GB</small>
            ) : null}
            <small>VRAM อ่านค่าไม่ได้</small>
            <div>
              {service.canStart ? (
                <button type="button" disabled={Boolean(busy)} onClick={() => { void act(service.id, 'start'); }}>Start</button>
              ) : null}
              {service.canStop ? (
                confirmStop === service.id ? (
                  <>
                    <button type="button" onClick={() => setConfirmStop(null)}>ยกเลิก</button>
                    <button type="button" disabled={Boolean(busy)} onClick={() => { void act(service.id, 'stop'); }}>หยุด Service</button>
                  </>
                ) : (
                  <button type="button" disabled={Boolean(busy)} onClick={() => setConfirmStop(service.id)}>Stop</button>
                )
              ) : null}
              {service.ownedByJarvis && service.canStop ? (
                <button type="button" disabled={Boolean(busy)} onClick={() => { void act(service.id, 'restart'); }}>Restart</button>
              ) : null}
            </div>
            {service.noteTh ? <p>{service.noteTh}</p> : null}
          </li>
        ))}
      </ul>
    </aside>
  );
}
