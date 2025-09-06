import React, { useEffect, useMemo, useState } from "react";

// ---- Daggerheart Digital Sheet (Multi-Class) — TypeScript-friendly React ----
// Saves to localStorage; class actions are logged; ready to bolt on a backend later.

// ------- Types -------
export type Traits = {
  agility: number; strength: number; finesse: number;
  instinct: number; presence: number; knowledge: number;
};
export type Weapon = { name: string; trait: string; range: string; damage: string; feature: string };
export type Experience = { id: string; text: string; bonus: number; active: boolean };
export type ClassAction =
  | { id: string; label: string; type: "note" }
  | { id: string; label: string; type: "roll"; die?: number }
  | { id: string; label: string; type: "buff"; key: string; value: number }
  | { id: string; label: string; type: "toggle"; key: string }
  | { id: string; label: string; type: "prompt"; key: string };
export type ClassDef = {
  startEvasion: number;
  base: { hpMax: number; stressMax: number };
  suggested: Traits;
  actions: ClassAction[];
};
export type Sheet = {
  id: string;
  classKey: string;
  meta: { name: string; pronouns: string; heritage: string; subclass: string; level: number };
  traits: Traits;
  evasion: number; armor: number;
  damage: { minor: number; major: number; severe: number };
  hp: { current: number; max: number };
  stress: { current: number; max: number };
  hope: number; experience: number;
  weapons: { primary: Weapon; secondary: Weapon };
  armorBlock: { name: string; thresholds: string; base: string; feature: string };
  inventory: string; notes: string;
  buffs: Record<string, unknown>;
  experiences: Experience[];
  _log: string[];
};

// ------- Utils -------
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
const d = (sides: number) => Math.floor(Math.random() * sides) + 1;
const lsKey = (id: string) => `dh-sheet:${id}`;

function assertNever(x: never): never {
  throw new Error(`Unhandled ClassAction variant: ${JSON.stringify(x)}`);
}

const uuid = () =>
  (typeof crypto !== "undefined" && "randomUUID" in crypto)
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;


// ------- Built-in class library (seed) -------
const CLASS_LIBRARY: Record<string, ClassDef> = {
  Bard: {
    startEvasion: 10,
    base: { hpMax: 6, stressMax: 6 },
    suggested: { agility: 0, strength: -1, finesse: 1, instinct: 0, presence: 2, knowledge: 1 },
    actions: [
      { id: "rally", label: "Rally (give a Rally Die)", type: "note" },
      { id: "make_scene", label: "Make a Scene (distract)", type: "note" },
    ],
  },
  Druid: {
    startEvasion: 9,
    base: { hpMax: 6, stressMax: 6 },
    suggested: { agility: 1, strength: 0, finesse: 1, instinct: 2, presence: -1, knowledge: 0 },
    actions: [
      { id: "beastform", label: "Beastform (mark Stress)", type: "note" },
      { id: "evolution", label: "Evolution (spend Hope)", type: "note" },
    ],
  },
  Guardian: {
    startEvasion: 9,
    base: { hpMax: 6, stressMax: 6 },
    suggested: { agility: 1, strength: 2, finesse: -1, instinct: 0, presence: 1, knowledge: 0 },
    actions: [
      { id: "unstoppable", label: "Unstoppable (toggle)", type: "toggle", key: "unstoppable" },
      { id: "tank", label: "Frontline Tank (spend Hope)", type: "note" },
    ],
  },
  Ranger: {
    startEvasion: 12,
    base: { hpMax: 6, stressMax: 6 },
    suggested: { agility: 2, strength: 0, finesse: 1, instinct: 1, presence: -1, knowledge: 0 },
    actions: [
      { id: "focus", label: "Ranger Focus (set target)", type: "prompt", key: "focusTarget" },
      { id: "hold", label: "Hold Them Off (spend Hope)", type: "note" },
    ],
  },
  Rogue: {
    startEvasion: 12,
    base: { hpMax: 6, stressMax: 6 },
    suggested: { agility: 1, strength: -1, finesse: 2, instinct: 0, presence: 1, knowledge: 0 },
    actions: [
      { id: "dodge", label: "+2 Evasion until hit (spend Hope)", type: "buff", key: "evadeBuff", value: 2 },
      { id: "sneak", label: "Sneak Attack (log bonus)", type: "note" },
    ],
  },
  Seraph: {
    startEvasion: 10,
    base: { hpMax: 6, stressMax: 6 },
    suggested: { agility: 0, strength: 2, finesse: 0, instinct: 1, presence: 1, knowledge: -1 },
    actions: [
      { id: "prayer", label: "Spend Prayer Die (d4)", type: "roll", die: 4 },
      { id: "life_support", label: "Life Support (spend Hope)", type: "note" },
    ],
  },
  Sorcerer: {
    startEvasion: 10,
    base: { hpMax: 6, stressMax: 6 },
    suggested: { agility: 0, strength: -1, finesse: 1, instinct: 2, presence: 1, knowledge: 0 },
    actions: [
      { id: "illusion", label: "Minor Illusion", type: "note" },
      { id: "volatile", label: "Volatile (reroll dmg)", type: "note" },
    ],
  },
  Warrior: {
    startEvasion: 11,
    base: { hpMax: 6, stressMax: 6 },
    suggested: { agility: 2, strength: 1, finesse: 0, instinct: 1, presence: -1, knowledge: 0 },
    actions: [
      { id: "aoo", label: "Attack of Opportunity", type: "note" },
      { id: "no_mercy", label: "No Mercy (+1 to attacks)", type: "toggle", key: "attackBuff" },
    ],
  },
};

// ------- Hooks -------
function useLocalSheet(id: string, initial: Sheet): [Sheet, React.Dispatch<React.SetStateAction<Sheet>>] {
  const [sheet, setSheet] = useState<Sheet>(() => {
    const raw = localStorage.getItem(lsKey(id));
    if (raw) { try { return JSON.parse(raw) as Sheet; } catch { /* ignore */ } }
    return initial;
  });
  useEffect(() => { localStorage.setItem(lsKey(id), JSON.stringify(sheet)); }, [id, sheet]);
  return [sheet, setSheet];
}

// NOTE: defaultSheet now takes a library param so it works with external JSON too.
function defaultSheet(classKey: string = "Bard", lib: Record<string, ClassDef> = CLASS_LIBRARY): Sheet {
  const fallbackClassKey = lib.Bard ? "Bard" : Object.keys(lib)[0];
  const c = lib[classKey] || lib[fallbackClassKey];
  return {
    id: (typeof crypto !== "undefined" && "randomUUID" in crypto) ? crypto.randomUUID() : String(Date.now()),
    classKey,
    meta: { name: "", pronouns: "", heritage: "", subclass: "", level: 1 },
    traits: { agility: 0, strength: 0, finesse: 0, instinct: 0, presence: 0, knowledge: 0 },
    evasion: c.startEvasion,
    buffs: { evadeBuff: 0, attackBuff: 0, unstoppable: false },
    armor: 0,
    damage: { minor: 6, major: 12, severe: 18 },
    hp: { current: c.base.hpMax, max: c.base.hpMax },
    stress: { current: 0, max: c.base.stressMax },
    hope: 0,
    experience: 0,
    weapons: {
      primary: { name: "", trait: "", range: "", damage: "", feature: "" },
      secondary: { name: "", trait: "", range: "", damage: "", feature: "" },
    },
    armorBlock: { name: "", thresholds: "", base: "", feature: "" },
    inventory: "torch, 50ft rope, basic supplies",
    notes: "",
    experiences: [
      { id: uuid(), text: "", bonus: 2, active: false },
      { id: uuid(), text: "", bonus: 2, active: false },
    ],
    _log: [],
  };
}

// ------- Small UI atoms -------
const Label: React.FC<React.PropsWithChildren<{ className?: string }>> = ({ children, className }) => (
  <div className={`text-xs uppercase tracking-wide ${className ?? "text-gray-500"}`}>{children}</div>
);

function TextInput({ label, value, onChange, placeholder = "" }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; }) {
  return (
    <label className="block">
      <Label>{label}</Label>
      <input className="mt-1 w-full rounded-xl border p-2 shadow-sm" value={value} placeholder={placeholder}
             onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}


// Color accents per trait (fixed class strings = Tailwind-safe)
const TRAIT_COLORS: Record<keyof Traits, {
  wrapper: string;   // bg + left border tint around the field row
  label: string;     // label color
  control: string;   // +/- control border color
  diceBtn: string;   // dice button border/hover
  diceIcon: string;  // dice icon color
}> = {
  agility:  {
    wrapper: "border-l-4 border-emerald-300 bg-emerald-50/40 rounded-xl p-2",
    label:   "text-emerald-700",
    control: "border-emerald-300",
    diceBtn: "border-emerald-300 hover:bg-emerald-50",
    diceIcon:"fill-emerald-700",
  },
  strength: {
    wrapper: "border-l-4 border-orange-300 bg-orange-50/40 rounded-xl p-2",
    label:   "text-orange-700",
    control: "border-orange-300",
    diceBtn: "border-orange-300 hover:bg-orange-50",
    diceIcon:"fill-orange-700",
  },
  finesse:  {
    wrapper: "border-l-4 border-violet-300 bg-violet-50/40 rounded-xl p-2",
    label:   "text-violet-700",
    control: "border-violet-300",
    diceBtn: "border-violet-300 hover:bg-violet-50",
    diceIcon:"fill-violet-700",
  },
  instinct: {
    wrapper: "border-l-4 border-teal-300 bg-teal-50/40 rounded-xl p-2",
    label:   "text-teal-700",
    control: "border-teal-300",
    diceBtn: "border-teal-300 hover:bg-teal-50",
    diceIcon:"fill-teal-700",
  },
  presence: {
    wrapper: "border-l-4 border-pink-300 bg-pink-50/40 rounded-xl p-2",
    label:   "text-pink-700",
    control: "border-pink-300",
    diceBtn: "border-pink-300 hover:bg-pink-50",
    diceIcon:"fill-pink-700",
  },
  knowledge:{
    wrapper: "border-l-4 border-indigo-300 bg-indigo-50/40 rounded-xl p-2",
    label:   "text-indigo-700",
    control: "border-indigo-300",
    diceBtn: "border-indigo-300 hover:bg-indigo-50",
    diceIcon:"fill-indigo-700",
  },
};

const CLASS_BG: Record<string, string> = {
  Bard:     "from-rose-100 via-rose-50 to-rose-200",
  Rogue:    "from-slate-100 via-slate-50 to-slate-200",
  Druid:    "from-emerald-100 via-emerald-50 to-emerald-200",
  Guardian: "from-sky-100 via-sky-50 to-sky-200",
  Ranger:   "from-lime-100 via-lime-50 to-lime-200",
  Seraph:   "from-amber-100 via-amber-50 to-amber-200",
  Sorcerer: "from-violet-100 via-violet-50 to-violet-200",
  Warrior:  "from-orange-100 via-orange-50 to-orange-200",
};


function TextArea({ label, value, onChange, rows = 3 }: { label: string; value: string; onChange: (v: string) => void; rows?: number; }) {
  return (
    <label className="block">
      <Label>{label}</Label>
      <textarea rows={rows} className="mt-1 w-full rounded-xl border p-2 shadow-sm" value={value}
                onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

function NumberField({
  label, value, onChange, min = -10, max = 30, step = 1,
  stacked = true, trailing, hint, sub,
  className = "",          // NEW: wrapper accent
  labelClassName = "",     // NEW: label accent
  controlClassName = "",   // NEW: +/- control accent
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number; max?: number; step?: number;
  stacked?: boolean;
  trailing?: React.ReactNode;
  hint?: string;
  sub?: string;
  className?: string;
  labelClassName?: string;
  controlClassName?: string;
}) {
  const Control = (
    <div className={`inline-flex items-center whitespace-nowrap rounded-xl border p-1 shadow-sm bg-white ${controlClassName}`}>
      <button aria-label={`decrease ${label}`} className="px-2"
        onClick={() => onChange(clamp(value - step, min, max))}>−</button>
      <input
        className="no-spin w-12 border-0 text-center outline-none bg-transparent"
        type="number"
        value={value}
        onChange={(e) => onChange(clamp(parseInt(e.target.value || "0", 10), min, max))}
        onWheel={(e) => (e.currentTarget as HTMLInputElement).blur()}
        onKeyDown={(e) => { if (e.key === 'ArrowUp' || e.key === 'ArrowDown') e.preventDefault(); }}
      />
      <button aria-label={`increase ${label}`} className="px-2"
        onClick={() => onChange(clamp(value + step, min, max))}>+</button>
    </div>
  );

  if (stacked) {
    return (
      <label className={`block min-w-0 ${className}`} title={hint}>
        <Label className={labelClassName}>{label}</Label>
        {sub && <div className="text-[10px] leading-tight text-gray-400">{sub}</div>}
        <div className="mt-1 flex items-center gap-2">
          {Control}
          {trailing && <div className="shrink-0">{trailing}</div>}
        </div>
      </label>
    );
  }

  return (
    <div className={`flex items-start gap-2 min-w-0 ${className}`} title={hint}>
      <div className="flex flex-col">
        <Label className={labelClassName}>{label}</Label>
        {sub && <div className="text-[10px] leading-tight text-gray-400">{sub}</div>}
      </div>
      <div className="ml-auto shrink-0">{Control}</div>
      {trailing && <div className="shrink-0">{trailing}</div>}
    </div>
  );
}

const PANEL =
  "rounded-2xl border border-white/40 p-4 shadow-md " +
  "bg-gradient-to-br from-white/70 to-white/40 backdrop-blur-lg";

const Card: React.FC<React.PropsWithChildren<{ title: string; actions?: React.ReactNode }>> = ({ title, actions, children }) => (
  <div className={PANEL}>
    <div className="mb-2 flex items-center justify-between">
      <h3 className="text-sm font-semibold tracking-wide text-slate-700">{title}</h3>
      {actions}
    </div>
    {children}
  </div>
);

function WeaponEditor({ data, onChange, title }: { data: Weapon; onChange: (w: Weapon) => void; title: string; }) {
  const update = (k: keyof Weapon, v: string) => onChange({ ...data, [k]: v });
  return (
    <Card title={title}>
      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
        <TextInput label="Name" value={data.name} onChange={(v) => update("name", v)} />
        <TextInput label="Trait" value={data.trait} onChange={(v) => update("trait", v)} />
        <TextInput label="Range" value={data.range} onChange={(v) => update("range", v)} />
        <TextInput label="Damage Dice & Type" value={data.damage} onChange={(v) => update("damage", v)} />
        <div className="md:col-span-2"><TextArea label="Feature" value={data.feature} onChange={(v) => update("feature", v)} /></div>
      </div>
    </Card>
  );
}

// ------- Class Actions -------
function ClassActions({
  sheet, setSheet, classDef,
}: {
  sheet: Sheet;
  setSheet: React.Dispatch<React.SetStateAction<Sheet>>;
  classDef: ClassDef | undefined;
}) {
  const cls = classDef;
  if (!cls) return null;

  const log = (line: string) => setSheet(s => ({ ...s, _log: [line, ...s._log].slice(0, 20) }));

  function run(action: ClassAction) {
    switch (action.type) {
      case "note":
        log(`${sheet.meta.name || "Character"} uses ${action.label}.`);
        return;

      case "roll": {
        const sides = action.die ?? 6; const r = d(sides);
        log(`${sheet.meta.name || "Character"} rolls d${sides} → ${r} (${action.label}).`);
        return;
      }

      case "buff": {
        const cur = Number(sheet.buffs[action.key] || 0);
        setSheet(s => ({ ...s, buffs: { ...s.buffs, [action.key]: cur + (action.value ?? 0) } }));
        log(`${sheet.meta.name || "Character"} gains ${action.value ?? ""} from ${action.label}.`);
        return;
      }

      case "toggle": {
        const cur = Boolean(sheet.buffs[action.key]);
        setSheet(s => ({ ...s, buffs: { ...s.buffs, [action.key]: !cur } }));
        log(`${action.label}: ${!cur ? "ON" : "OFF"}.`);
        return;
      }

      case "prompt": {
        const val = window.prompt(action.label + " — enter value");
        if (val) {
          setSheet(s => ({ ...s, buffs: { ...s.buffs, [action.key]: val } }));
          log(`${action.label}: ${val}`);
        }
        return;
      }
    }

    return assertNever(action);
  }

  const evasionTotal = sheet.evasion + Number(sheet.buffs.evadeBuff || 0);

  return (
    <Card title={`Class Actions – ${sheet.classKey}`} actions={<div className="text-xs text-gray-500">Evasion: {evasionTotal}</div>}>
      <div className="flex flex-wrap gap-2">
        {cls.actions.map(a => (
          <button key={a.id} className="rounded-xl border px-3 py-2" onClick={() => run(a)}>{a.label}</button>
        ))}
        <button className="rounded-xl border px-3 py-2" onClick={() => setSheet(s => ({ ...s, buffs: { evadeBuff: 0, attackBuff: 0, unstoppable: false } }))}>Clear Buffs</button>
      </div>
      <div className="mt-3">
        <Label>Recent</Label>
        <div className="mt-1 max-h-40 overflow-auto rounded-xl border bg-white/60 backdrop-blur p-2 text-sm text-gray-700">
          {sheet._log.length ? sheet._log.map((l, i) => (<div key={i}>• {l}</div>)) : <div className="text-gray-400">No actions yet.</div>}
        </div>
      </div>
    </Card>
  );
}

// ------- Top Bar -------
function TopBar({
  sheet, setSheet, library,
}: {
  sheet: Sheet;
  setSheet: React.Dispatch<React.SetStateAction<Sheet>>;
  library: Record<string, ClassDef>;
}) {
  const setMeta = (k: keyof Sheet["meta"], v: string | number) => setSheet(s => ({ ...s, meta: { ...s.meta, [k]: v } }));

  const onImport = (ev: React.ChangeEvent<HTMLInputElement>) => {
    const f = ev.target.files?.[0]; if (!f) return; const r = new FileReader();
    r.onload = () => { try { setSheet(JSON.parse(String(r.result)) as Sheet); } catch { alert("Invalid JSON"); } };
    r.readAsText(f);
  };
  const onExport = () => {
    const blob = new Blob([JSON.stringify(sheet, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob); const a = document.createElement("a");
    a.href = url; a.download = `${sheet.meta.name || sheet.classKey}.json`; a.click(); URL.revokeObjectURL(url);
  };

  return (
    <div className={PANEL}>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-6">
        <div>
          <Label>Class</Label>
          <select
            className="mt-1 w-full rounded-xl border p-2 shadow-sm"
            value={sheet.classKey}
            onChange={(e) => setSheet(defaultSheet(e.target.value, library))}
          >
            {Object.keys(library).map(k => (<option key={k} value={k}>{k}</option>))}
          </select>
        </div>
        <TextInput label="Name" value={sheet.meta.name} onChange={(v) => setMeta("name", v)} />
        <TextInput label="Pronouns" value={sheet.meta.pronouns} onChange={(v) => setMeta("pronouns", v)} />
        <TextInput label="Heritage" value={sheet.meta.heritage} onChange={(v) => setMeta("heritage", v)} />
        <TextInput label="Subclass" value={sheet.meta.subclass} onChange={(v) => setMeta("subclass", v)} />
        <NumberField label="Level" value={sheet.meta.level} min={1} max={10} onChange={(v) => setMeta("level", v)} />
        <div className="flex items-center gap-2 md:col-span-6">
          <button className="rounded-xl border px-3 py-2" onClick={onExport}>Export</button>
          <label className="cursor-pointer rounded-xl border px-3 py-2">Import
            <input type="file" accept="application/json" className="hidden" onChange={onImport} />
          </label>
          <button className="rounded-xl border px-3 py-2" onClick={() => { localStorage.clear(); location.reload(); }}>Reset</button>
        </div>
      </div>
    </div>
  );
}

// ------ Icons -----
type IconKind = "heart" | "shield" | "stress";

function SvgIcon({ kind, filled }: { kind: IconKind; filled: boolean }) {
  const base = "h-6 w-6 transition-colors";
  const off  = "fill-transparent stroke-gray-400";
  const on   =
    kind === "heart"  ? "fill-rose-500 stroke-rose-600" :
    kind === "shield" ? "fill-sky-500  stroke-sky-600"  :
                        "fill-amber-500 stroke-amber-600"; // stress

  return (
    <svg viewBox="0 0 24 24" className={`${base} ${filled ? on : off}`} strokeWidth={1.75}>
      {kind === "heart" && (
        <path d="M12 21s-6-3.9-9-7.2C1.6 10.9 2.5 7 6 7c2 0 3.3 1 6 4 2.7-3 4-4 6-4 3.4 0 4.4 3.9 3 6.8C18 17.1 12 21 12 21z" />
      )}
      {kind === "shield" && (
        <path d="M12 2 20 6v6c0 5-3.6 9-8 10-4.4-1-8-5-8-10V6l8-4z" />
      )}
      {kind === "stress" && (
        <path d="M13 2 4 14h6l-1 8 11-14h-6l1-6z" />
      )}
    </svg>
  );
}

function IconTrack({
  label, value, max, onChange, kind,
}: {
  label: string;
  value: number;
  max: number;
  onChange: (v: number) => void;
  kind: IconKind;
}) {
  const cells = Array.from({ length: max }, (_, i) => i < value);
  return (
    <div>
      <div className="flex items-center justify-between">
        <Label>{label}</Label>
        <div className="text-xs">{value}/{max}</div>
      </div>
      <div className="mt-1 flex flex-wrap gap-1">
        {cells.map((filled, i) => (
          <button
            key={i}
            aria-label={`${label} ${i + 1}`}
            className="rounded-md p-1 hover:bg-gray-100"
            onClick={() => onChange(i + 1 === value ? i : i + 1)}
          >
            <SvgIcon kind={kind} filled={filled} />
          </button>
        ))}
      </div>
    </div>
  );
}


// What each trait is used for (shows as a tooltip)
const TRAIT_INFO: Record<keyof Traits, string> = {
  agility:  "Sprint • Leap • Maneuver",
  strength: "Lift • Smash • Grapple",
  finesse:  "Control • Hide • Tinker",
  instinct: "Perceive • Sense • Navigate",
  presence: "Charm • Perform • Deceive",
  knowledge:"Recall • Analyze • Comprehend",
};

// Small dice icon button
function DiceButton({
  title, onClick, className = "", iconClassName = "",
}: {
  title: string;
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
  className?: string;
  iconClassName?: string;
}) {
  return (
    <button
      className={`shrink-0 rounded-lg border p-1.5 shadow-sm ${className}`}
      title={`${title}\nClick: normal • Shift: advantage • Ctrl/⌘: disadvantage`}
      onClick={onClick}
      aria-label={`Roll ${title}`}
    >
      <svg viewBox="0 0 24 24" className={`h-5 w-5 ${iconClassName || "fill-gray-700"}`}>
        <path d="M12 2 20.5 7v10L12 22 3.5 17V7L12 2zM5.7 8.3 12 5l6.3 3.3V15L12 18l-6.3-3V8.3z"/>
      </svg>
    </button>
  );
}

// ----- Expereinces -----
function ExperiencesCard({
  sheet, setSheet,
}: {
  sheet: Sheet;
  setSheet: React.Dispatch<React.SetStateAction<Sheet>>;
}) {
  const exps = sheet.experiences ?? [];
  const activeBonus = exps.filter(e => e.active).reduce((s, e) => s + (e.bonus || 0), 0);

  const update = (id: string, patch: Partial<Experience>) =>
    setSheet(s => ({ ...s, experiences: s.experiences.map(e => e.id === id ? { ...e, ...patch } : e) }));

  const add = () =>
  setSheet(s => ({
    ...s,
    experiences: [...(s.experiences ?? []), { id: uuid(), text: "", bonus: 2, active: false }],
  }));

  const del = (id: string) =>
    setSheet(s => ({ ...s, experiences: s.experiences.filter(e => e.id !== id) }));

  const clearActives = () =>
    setSheet(s => ({ ...s, experiences: s.experiences.map(e => ({ ...e, active: false })) }));

  return (
    <Card
      title="Experiences"
      actions={
        <div className="flex items-center gap-2 text-xs">
          <span className="rounded-full border bg-white px-2 py-0.5">Active bonus: +{activeBonus}</span>
          <button className="rounded-lg border px-2 py-1" onClick={add}>+ Add</button>
          <button className="rounded-lg border px-2 py-1" onClick={clearActives}>Clear active</button>
        </div>
      }
    >
      <div className="space-y-2">
        {exps.length === 0 && <div className="text-sm text-gray-400">No experiences yet.</div>}
        {exps.map((e) => (
          <div key={e.id} className="grid grid-cols-[auto,1fr,auto,auto] items-center gap-2">
            <input
              type="checkbox"
              className="h-4 w-4"
              title="Relevant to this roll"
              checked={e.active}
              onChange={(ev) => update(e.id, { active: ev.target.checked })}
            />
            <input
              className="w-full rounded-xl border p-2 shadow-sm"
              placeholder="Describe the experience…"
              value={e.text}
              onChange={(ev) => update(e.id, { text: ev.target.value })}
            />
            <div className="flex items-center gap-1">
              <span className="text-xs text-gray-500">+ / bonus</span>
              <input
                type="number"
                className="no-spin w-14 rounded-xl border p-1 text-center shadow-sm"
                value={e.bonus}
                onChange={(ev) => update(e.id, { bonus: clamp(parseInt(ev.target.value || "0", 10), 0, 10) })}
              />
            </div>
            <button className="rounded-lg border px-2 py-1" onClick={() => del(e.id)}>Delete</button>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ------- App -------
export default function App() {
  // Load external classes from /public/classes/index.json and merge with built-ins
  const [extLib, setExtLib] = useState<Record<string, ClassDef>>({});
  useEffect(() => {
    fetch('/classes/index.json')
      .then(r => (r.ok ? r.json() : {}))
      .then((j) => setExtLib(j || {}))
      .catch(() => {});
  }, []);
  const LIB = useMemo(() => ({ ...CLASS_LIBRARY, ...extLib }), [extLib]);

  const [sheet, setSheet] = useLocalSheet("default", defaultSheet("Bard", LIB));
  // migrate old saves that predate "experiences"
  useEffect(() => {
    if (!Array.isArray(sheet.experiences)) {
      setSheet(s => ({ ...s, experiences: [] }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // run once

  const t = sheet.traits;

  const C = TRAIT_COLORS;

  // Faces of the action die (change to 20 if you prefer d20)
  const ACTION_DIE = 12;

  function rollTrait(traitLabel: string, mod: number, e: React.MouseEvent) {
  const adv = e.shiftKey;
  const dis = e.ctrlKey || e.metaKey;

  const r1 = d(ACTION_DIE);
  const r2 = (adv || dis) ? d(ACTION_DIE) : null;
  const picked = r2 ? (adv ? Math.max(r1, r2) : Math.min(r1, r2)) : r1;

  const expActive = (sheet.experiences ?? []).filter(x => x.active);
  const expBonus  = expActive.reduce((s, x) => s + (x.bonus || 0), 0);

  const total = picked + mod + expBonus;

  const detail = r2 ? `${r1}/${r2}` : `${r1}`;
  const tag = adv ? " (adv)" : dis ? " (dis)" : "";
  const expText = expActive.length ? ` + EXP +${expBonus} [${expActive.map(x => x.text || "exp").join(", ")}]` : "";
  const line = `Roll ${traitLabel}${tag}: ${detail} + ${mod}${expText} = ${total}`;

  setSheet(s => ({ ...s, _log: [line, ...s._log].slice(0, 20) }));
}

    const CLASS_ACCENT: Record<string, string> = {
  Bard:     "from-rose-50/70  to-rose-100/40",
  Rogue:    "from-slate-50/70 to-slate-100/40",
  Druid:    "from-emerald-50/70 to-emerald-100/40",
  Guardian: "from-sky-50/70    to-sky-100/40",
  Ranger:   "from-lime-50/70   to-lime-100/40",
  Seraph:   "from-amber-50/70  to-amber-100/40",
  Sorcerer: "from-violet-50/70 to-violet-100/40",
  Warrior:  "from-orange-50/70 to-orange-100/40",
  };
  const accent = CLASS_ACCENT[sheet.classKey] ?? "from-white/70 to-white/40";
  const bgClass = CLASS_BG[sheet.classKey] ?? "from-slate-50 via-white to-slate-100";
  const SHEET_FRAME =
    `mx-auto max-w-6xl space-y-4 rounded-3xl p-6 md:p-10
      bg-gradient-to-br ${accent} backdrop-blur-xl
      border border-white/40 ring-1 ring-black/5 shadow-2xl`;

  return (
    <div className={`min-h-screen bg-gradient-to-br ${bgClass} p-6 md:p-10 transition-colors duration-300`}>
      <div className={SHEET_FRAME}>
        <header className="flex items-center justify-between">
          <h1 className="text-2xl font-extrabold bg-gradient-to-r from-slate-800 to-slate-600 bg-clip-text text-transparent">
            Daggerheart – Digital Sheet (Multi-Class)
          </h1>
          <div className="text-xs text-slate-600/80">Unofficial tool for personal use</div>
        </header>

        <TopBar sheet={sheet} setSheet={setSheet} library={LIB} />

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Card title="Traits">
            <div className="space-y-2">
              <NumberField
                label="Agility"
                value={t.agility}
                onChange={(v) => setSheet({ ...sheet, traits: { ...t, agility: v } })}
                stacked={false}
                hint={TRAIT_INFO.agility}
                sub={TRAIT_INFO.agility}
                className={C.agility.wrapper}
                labelClassName={C.agility.label}
                controlClassName={C.agility.control}
                trailing={
                  <DiceButton
                    title="Agility"
                    onClick={(e) => rollTrait("Agility", t.agility, e)}
                    className={C.agility.diceBtn}
                    iconClassName={C.agility.diceIcon}
                  />
                }
              />

              <NumberField
                label="Strength"
                value={t.strength}
                onChange={(v) => setSheet({ ...sheet, traits: { ...t, strength: v } })}
                stacked={false}
                hint={TRAIT_INFO.strength}
                sub={TRAIT_INFO.strength}
                className={C.strength.wrapper}
                labelClassName={C.strength.label}
                controlClassName={C.strength.control}
                trailing={<DiceButton title="Strength" onClick={(e) => rollTrait("Strength", t.strength, e)} className={C.strength.diceBtn} iconClassName={C.strength.diceIcon} />}
              />

              <NumberField
                label="Finesse"
                value={t.finesse}
                onChange={(v) => setSheet({ ...sheet, traits: { ...t, finesse: v } })}
                stacked={false}
                hint={TRAIT_INFO.finesse}
                sub={TRAIT_INFO.finesse}
                className={C.finesse.wrapper}
                labelClassName={C.finesse.label}
                controlClassName={C.finesse.control}
                trailing={<DiceButton title="Finesse" onClick={(e) => rollTrait("Finesse", t.finesse, e)} className={C.finesse.diceBtn} iconClassName={C.finesse.diceIcon} />}
              />

              <NumberField
                label="Instinct"
                value={t.instinct}
                onChange={(v) => setSheet({ ...sheet, traits: { ...t, instinct: v } })}
                stacked={false}
                hint={TRAIT_INFO.instinct}
                sub={TRAIT_INFO.instinct}
                className={C.instinct.wrapper}
                labelClassName={C.instinct.label}
                controlClassName={C.instinct.control}
                trailing={<DiceButton title="Instinct" onClick={(e) => rollTrait("Instinct", t.instinct, e)} className={C.instinct.diceBtn} iconClassName={C.instinct.diceIcon} />}
              />

              <NumberField
                label="Presence"
                value={t.presence}
                onChange={(v) => setSheet({ ...sheet, traits: { ...t, presence: v } })}
                stacked={false}
                hint={TRAIT_INFO.presence}
                sub={TRAIT_INFO.presence}
                className={C.presence.wrapper}
                labelClassName={C.presence.label}
                controlClassName={C.presence.control}
                trailing={<DiceButton title="Presence" onClick={(e) => rollTrait("Presence", t.presence, e)} className={C.presence.diceBtn} iconClassName={C.presence.diceIcon} />}
              />

              <NumberField
                label="Knowledge"
                value={t.knowledge}
                onChange={(v) => setSheet({ ...sheet, traits: { ...t, knowledge: v } })}
                stacked={false}
                hint={TRAIT_INFO.knowledge}
                sub={TRAIT_INFO.knowledge}
                className={C.knowledge.wrapper}
                labelClassName={C.knowledge.label}
                controlClassName={C.knowledge.control}
                trailing={<DiceButton title="Knowledge" onClick={(e) => rollTrait("Knowledge", t.knowledge, e)} className={C.knowledge.diceBtn} iconClassName={C.knowledge.diceIcon} />}
              />

            </div>
          </Card>

          <Card title="Defense">
            <div className="grid grid-cols-2 gap-3">
              <NumberField label="Evasion (base)" value={sheet.evasion} min={0} max={99}
                onChange={(v) => setSheet({ ...sheet, evasion: v })} stacked={false} />
              <IconTrack
                label="Armor"
                kind="shield"
                value={sheet.armor}
                max={10} // adjust if you want a different cap
                onChange={(v) => setSheet({ ...sheet, armor: v })}
              />
            </div>
            <div className="mt-3 grid grid-cols-2 md:grid-cols-3 gap-3">
              <NumberField label="Minor Threshold"  value={sheet.damage.minor}  min={1} max={99}
                onChange={(v) => setSheet({ ...sheet, damage: { ...sheet.damage, minor: v } })} />
              <NumberField label="Major Threshold"  value={sheet.damage.major}  min={1} max={99}
                onChange={(v) => setSheet({ ...sheet, damage: { ...sheet.damage, major: v } })} />
              <NumberField label="Severe Threshold" value={sheet.damage.severe} min={1} max={99}
                onChange={(v) => setSheet({ ...sheet, damage: { ...sheet.damage, severe: v } })} />
            </div>
          </Card>

          <Card title="Vitals">
            <div className="space-y-3">
              <IconTrack
                label="HP"
                kind="heart"
                value={sheet.hp.current}
                max={sheet.hp.max}
                onChange={(v) => setSheet({ ...sheet, hp: { ...sheet.hp, current: v } })}
              />
              <NumberField
                label="HP Max"
                value={sheet.hp.max}
                min={1}
                max={30}
                onChange={(v) =>
                  setSheet({
                    ...sheet,
                    hp: { ...sheet.hp, max: v, current: clamp(sheet.hp.current, 1, v) },
                  })
                }
              />
              <IconTrack
                label="Stress"
                kind="stress"
                value={sheet.stress.current}
                max={sheet.stress.max}
                onChange={(v) => setSheet({ ...sheet, stress: { ...sheet.stress, current: v } })}
              />
              <NumberField
                label="Stress Max"
                value={sheet.stress.max}
                min={1}
                max={30}
                onChange={(v) =>
                  setSheet({
                    ...sheet,
                    stress: { ...sheet.stress, max: v, current: clamp(sheet.stress.current, 0, v) },
                  })
                }
              />
            </div>
          </Card>
        </div>

        <ClassActions sheet={sheet} setSheet={setSheet} classDef={LIB[sheet.classKey]} />

        <ExperiencesCard sheet={sheet} setSheet={setSheet} />

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <WeaponEditor title="Primary Weapon" data={sheet.weapons.primary} onChange={(w) => setSheet({ ...sheet, weapons: { ...sheet.weapons, primary: w } })} />
          <WeaponEditor title="Secondary Weapon" data={sheet.weapons.secondary} onChange={(w) => setSheet({ ...sheet, weapons: { ...sheet.weapons, secondary: w } })} />
        </div>

        <Card title="Armor">
          <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
            <TextInput label="Name" value={sheet.armorBlock.name} onChange={(v) => setSheet({ ...sheet, armorBlock: { ...sheet.armorBlock, name: v } })} />
            <TextInput label="Base Thresholds" value={sheet.armorBlock.thresholds} onChange={(v) => setSheet({ ...sheet, armorBlock: { ...sheet.armorBlock, thresholds: v } })} />
            <TextInput label="Base Score" value={sheet.armorBlock.base} onChange={(v) => setSheet({ ...sheet, armorBlock: { ...sheet.armorBlock, base: v } })} />
            <div className="md:col-span-3"><TextArea label="Feature" value={sheet.armorBlock.feature} onChange={(v) => setSheet({ ...sheet, armorBlock: { ...sheet.armorBlock, feature: v } })} /></div>
          </div>
        </Card>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Card title="Inventory"><TextArea label="Items" value={sheet.inventory} onChange={(v) => setSheet({ ...sheet, inventory: v })} /></Card>
          <Card title="Notes"><TextArea label="" rows={6} value={sheet.notes} onChange={(v) => setSheet({ ...sheet, notes: v })} /></Card>
          <Card title="Status">
            <div className="space-y-2 text-sm">
              <div className="flex flex-wrap gap-2">
                {Object.entries(sheet.buffs as Record<string, unknown>).length ? (
                  Object.entries(sheet.buffs as Record<string, unknown>).map(([k, v]) => (
                    <span key={k} className="rounded-full border px-2 py-0.5 text-xs bg-white shadow-sm">
                      {k}: {String(v)}
                    </span>
                  ))
                ) : (
                  <span className="text-gray-400">No buffs</span>
                )}
              </div>

              <div>Class start Evasion: {LIB[sheet.classKey]?.startEvasion}</div>
            </div>
          </Card>
        </div>

        <footer className="pt-2 text-center text-xs text-gray-500">Unofficial fan tool • © Your Table</footer>
      </div>
    </div>
  );
}
