/** Activity types, their fields, and the numbers derived from them. All plain arithmetic, no AI. */

export type FieldState = 'required' | 'optional' | 'hidden';
export type DeriveKind = 'none' | 'run' | 'speed' | 'swim' | 'per_set' | 'accuracy' | 'connect_rate';

export type ActivityField = {
  key: string;
  label: string;
  unit: string;
  kind: 'number' | 'text';
  state?: FieldState;
};

export type ActivityType = {
  id: string;
  key: string;
  label: string;
  derive_kind: DeriveKind;
  activity_fields: (ActivityField & { state: FieldState; sort: number })[];
};

export type Vals = Record<string, string | number | null | undefined>;

const num = (v: unknown) => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** Minutes as m:ss. */
const clock = (minutes: number) => {
  const total = Math.round(minutes * 60);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

/** The derived number for a check-in, such as pace or accuracy, or null when the inputs are missing. */
export function derive(kind: DeriveKind | string | null | undefined, vals: Vals): string | null {
  switch (kind) {
    case 'run': {
      const d = num(vals.dist), t = num(vals.time);
      return d && t ? `${clock(t / d)} /km pace` : null;
    }
    case 'speed': {
      const d = num(vals.dist), t = num(vals.time);
      return d && t ? `${((d / t) * 60).toFixed(1)} km/h` : null;
    }
    case 'swim': {
      const d = num(vals.dist), t = num(vals.time);
      return d && t ? `${clock((t / d) * 100)} /100m` : null;
    }
    case 'per_set': {
      const r = num(vals.reps), s = num(vals.sets);
      return r && s ? `${Math.round(r / s)} per set` : null;
    }
    case 'accuracy': {
      const q = num(vals.q), c = num(vals.correct);
      return q && c !== null ? `${Math.round((Math.min(c, q) / q) * 100)}% correct` : null;
    }
    case 'connect_rate': {
      const calls = num(vals.calls), conn = num(vals.conn);
      return calls && conn !== null ? `${Math.round((Math.min(conn, calls) / calls) * 100)}% connected` : null;
    }
    default:
      return null;
  }
}

/** "5 km · 28 min" from the values that were filled in, in field order. */
export function summarize(fields: ActivityField[], vals: Vals): string {
  return fields
    .filter((f) => vals[f.key] !== undefined && vals[f.key] !== null && vals[f.key] !== '')
    .map((f) => (f.kind === 'text' ? String(vals[f.key]) : `${vals[f.key]}${f.unit ? (f.unit.startsWith('/') ? '' : ' ') + f.unit : ''}`))
    .join(' · ');
}

/** Turns form strings into what create_checkin expects: numbers for number fields, trimmed text otherwise. */
export function cleanVals(fields: ActivityField[], form: Record<string, string>): Vals {
  const out: Vals = {};
  for (const f of fields) {
    const raw = (form[f.key] ?? '').trim();
    if (!raw) continue;
    if (f.kind === 'text') out[f.key] = raw;
    else {
      const n = parseFloat(raw.replace(',', '.'));
      if (Number.isFinite(n)) out[f.key] = n;
    }
  }
  return out;
}

/** Required fields that are still empty or not a positive number. */
export function missingRequired(fields: (ActivityField & { state: FieldState })[], vals: Vals): string[] {
  return fields
    .filter((f) => f.state === 'required')
    .filter((f) => (f.kind === 'text' ? !String(vals[f.key] ?? '').trim() : !num(vals[f.key])))
    .map((f) => f.label);
}
