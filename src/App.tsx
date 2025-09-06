import React, { useEffect, useMemo, useState } from "react";

// ---- Daggerheart Digital Sheet (Multi-Class) — TypeScript-friendly React ----
// Paste this into src/App.tsx in a Vite React + Tailwind project.
// Saves to localStorage; class actions are logged; ready to bolt on a backend later.

// ------- Types -------
export type Traits = {
  agility: number; strength: number; finesse: number;
  instinct: number; presence: number; knowledge: number;
};
export type Weapon = { name: string; trait: string; range: string; damage: string; feature: string };
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
  _log: string[];
};

// ------- Utils -------
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
const d = (sides: number) => Math.floor(Math.random() * sides) + 1;
const lsKey = (id: string) => `dh-sheet:${id}`;

function assertNever(x: never): never {
  throw new Error(`Unhandled ClassAction variant: ${JSON.stringify(x)}`);
}

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
function defaultSheet(classKey: string = "Rogue", lib: Record<string, ClassDef> = CLASS_LIBRARY): Sheet {
  const fallbackClassKey = lib.Rogue ? "Rogue" : Object.keys(lib)[0];
  const c = lib[classKey] || lib[fallbackClassKey];
  return {
    id: crypto?.randomUUID?.() || String(Date.now()),
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
    _log: [],
  };
}

// ------- Small UI atoms -------
const Label: React.FC<React.PropsWithChildren> = ({ children }) => (
  <div className="text-xs uppercase tracking-wide text-gray-500">{children}</div>
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
  label, value, onChange, min = -10, max = 30, step = 1, stacked = true,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number; max?: number; step?: number;
  stacked?: boolean;
}) {
  const Control = (
    <div className="inline-flex items-center whitespace-nowrap rounded-xl border p-1 shadow-sm bg-white">
      <button
        aria-label={`decrease ${label}`}
        className="px-2"
        onClick={() => onChange(clamp(value - step, min, max))}
      >−</button>
      <input
        className="w-12 border-0 text-center outline-none bg-transparent"
        type="number"
        value={value}
        onChange={(e) => onChange(clamp(parseInt(e.target.value || "0", 10), min, max))}
      />
      <button
        aria-label={`increase ${label}`}
        className="px-2"
        onClick={() => onChange(clamp(value + step, min, max))}
      >+</button>
    </div>
  );

  if (stacked) {
    return (
      <label className="block min-w-0">
        <Label>{label}</Label>
        <div className="mt-1">{Control}</div>
      </label>
    );
  }

  // inline layout for short labels
  return (
    <div className="flex items-center gap-2 min-w-0">
      <Label>{label}</Label>
      <div className="ml-auto shrink-0">{Control}</div>
    </div>
  );
}



function Track({ label, value, max, onChange }: { label: string; value: number; max: number; onChange: (v: number) => void; }) {
  const boxes = Array.from({ length: max }, (_, i) => i < value);
  return (
    <div>
      <div className="flex items-center justify-between"><Label>{label}</Label><div className="text-xs">{value}/{max}</div></div>
      <div className="mt-1 flex flex-wrap gap-1">
        {boxes.map((filled, i) => (
          <button key={i} onClick={() => onChange(i + 1 === value ? i : i + 1)}
                  className={`h-6 w-6 rounded-md border ${filled ? "bg-gray-800 text-white" : "bg-white"}`}>{filled ? "■" : ""}</button>
        ))}
      </div>
    </div>
  );
}

const Card: React.FC<React.PropsWithChildren<{ title: string; actions?: React.ReactNode }>> = ({ title, actions, children }) => (
  <div className="rounded-2xl border bg-white p-4 shadow">
    <div className="mb-2 flex items-center justify-between">
      <h3 className="text-sm font-semibold tracking-wide text-gray-700">{title}</h3>
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
        <div className="mt-1 max-h-40 overflow-auto rounded-xl border bg-gray-50 p-2 text-sm text-gray-700">
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
    <div className="rounded-2xl border bg-white p-4 shadow">
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

  const [sheet, setSheet] = useLocalSheet("default", defaultSheet("Rogue", LIB));
  const t = sheet.traits;

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-100 to-gray-200 p-4 md:p-8">
      <div className="mx-auto max-w-6xl space-y-4">
        <header className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Daggerheart – Digital Sheet (Multi-Class)</h1>
          <div className="text-xs text-gray-500">Unofficial tool for personal use</div>
        </header>

        <TopBar sheet={sheet} setSheet={setSheet} library={LIB} />

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Card title="Traits">
            <div className="space-y-2">
              <NumberField label="Agility"  value={t.agility}  onChange={(v) => setSheet({ ...sheet, traits: { ...t, agility: v } })}  stacked={false} />
              <NumberField label="Strength" value={t.strength} onChange={(v) => setSheet({ ...sheet, traits: { ...t, strength: v } })} stacked={false} />
              <NumberField label="Finesse"  value={t.finesse}  onChange={(v) => setSheet({ ...sheet, traits: { ...t, finesse: v } })}  stacked={false} />
              <NumberField label="Instinct" value={t.instinct} onChange={(v) => setSheet({ ...sheet, traits: { ...t, instinct: v } })} stacked={false} />
              <NumberField label="Presence" value={t.presence} onChange={(v) => setSheet({ ...sheet, traits: { ...t, presence: v } })} stacked={false} />
              <NumberField label="Knowledge" value={t.knowledge} onChange={(v) => setSheet({ ...sheet, traits: { ...t, knowledge: v } })} stacked={false} />
            </div>
          </Card>

          <Card title="Defense">
            <div className="grid grid-cols-2 gap-3">
              <NumberField label="Evasion (base)" value={sheet.evasion} min={0} max={99}
                onChange={(v) => setSheet({ ...sheet, evasion: v })} stacked={false} />
              <NumberField label="Armor" value={sheet.armor} min={0} max={10}
                onChange={(v) => setSheet({ ...sheet, armor: v })} stacked={false} />
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
              <Track label="HP" value={sheet.hp.current} max={sheet.hp.max} onChange={(v) => setSheet({ ...sheet, hp: { ...sheet.hp, current: v } })} />
              <NumberField label="HP Max" value={sheet.hp.max} min={1} max={30} onChange={(v) => setSheet({ ...sheet, hp: { ...sheet.hp, max: v, current: clamp(sheet.hp.current, 1, v) } })} />
              <Track label="Stress" value={sheet.stress.current} max={sheet.stress.max} onChange={(v) => setSheet({ ...sheet, stress: { ...sheet.stress, current: v } })} />
              <NumberField label="Stress Max" value={sheet.stress.max} min={1} max={30} onChange={(v) => setSheet({ ...sheet, stress: { ...sheet.stress, max: v, current: clamp(sheet.stress.current, 0, v) } })} />
              <NumberField label="Hope" value={sheet.hope} min={0} max={9} onChange={(v) => setSheet({ ...sheet, hope: v })} />
            </div>
          </Card>
        </div>

        <ClassActions sheet={sheet} setSheet={setSheet} classDef={LIB[sheet.classKey]} />

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

        <footer className="pt-2 text-center text-xs text-gray-500">Unofficial fan tool • © Your Table • Ready for Cloudflare Pages</footer>
      </div>
    </div>
  );
}
