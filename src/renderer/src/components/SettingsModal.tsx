import React, { useState, useEffect } from 'react';
import { PosSettings, LanStatus } from '../../../types/pos';
import { X, Save, Printer, Network, Store, TestTube } from 'lucide-react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  settings: PosSettings;
  lanStatus?: LanStatus | null;
  onSave: (newSettings: PosSettings) => Promise<void>;
  onTestLan: (ip: string, port: string) => Promise<boolean>;
}

// ─── Sub-section heading ─────────────────────────────────────────────────────
const SectionTitle: React.FC<{ icon: React.ReactNode; label: string }> = ({ icon, label }) => (
  <div className="flex items-center gap-2 mb-4 pb-2 border-b border-cream-200">
    <span className="text-coffee-500">{icon}</span>
    <h3 className="text-xs font-extrabold uppercase tracking-widest text-coffee-600">{label}</h3>
  </div>
);

// ─── Labelled input wrapper ───────────────────────────────────────────────────
const Field: React.FC<{ label: string; children: React.ReactNode; col2?: boolean }> = ({
  label, children, col2 = false,
}) => (
  <div className={col2 ? 'col-span-2' : ''}>
    <label className="block text-xs font-semibold text-coffee-500 mb-1.5">{label}</label>
    {children}
  </div>
);

export const SettingsModal: React.FC<Props> = ({
  isOpen,
  onClose,
  settings,
  lanStatus,
  onSave,
  onTestLan,
}) => {
  const [form, setForm] = useState<PosSettings>({ ...settings });
  const [saving, setSaving] = useState(false);
  const [testMsg, setTestMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => { setForm({ ...settings }); }, [settings]);

  if (!isOpen) return null;

  const set = (key: keyof PosSettings, value: string) =>
    setForm(prev => ({ ...prev, [key]: value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    await onSave(form);
    setSaving(false);
    onClose();
  };

  const handleTestLan = async () => {
    setTestMsg({ ok: false, text: 'Testing connection…' });
    const ok = await onTestLan(form.lan_primary_ip, form.lan_primary_port);
    setTestMsg(ok
      ? { ok: true, text: '✓ Connected to Primary PC successfully!' }
      : { ok: false, text: '✗ Could not reach Primary PC — check IP, port and firewall.' });
  };

  return (
    <div className="modal-backdrop z-50 bg-coffee-900/40 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-cream-50 border border-cream-300 rounded-3xl shadow-warm-lg w-full max-w-2xl
                      overflow-hidden flex flex-col max-h-[92vh]">

        {/* ── Header ─────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-7 py-5 bg-white border-b border-cream-200">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-coffee-100 flex items-center justify-center">
              <Store className="w-5 h-5 text-coffee-600" />
            </div>
            <div>
              <h2 className="text-xl font-extrabold text-coffee-800 tracking-tight">Settings</h2>
              <p className="text-xs text-coffee-400">Cafe profile, printer & LAN configuration</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-coffee-400 hover:text-coffee-700 hover:bg-cream-200 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* ── Body ───────────────────────────────────────────────── */}
        <form onSubmit={handleSubmit} className="p-7 overflow-y-auto space-y-8">

          {/* CAFE PROFILE ───────────────────────────────────────── */}
          <section>
            <SectionTitle icon={<Store className="w-4 h-4" />} label="Cafe Information" />
            <div className="grid grid-cols-2 gap-4">
              <Field label="Cafe Name">
                <input className="cafe-input" value={form.cafe_name}
                  onChange={e => set('cafe_name', e.target.value)} />
              </Field>
              <Field label="Phone Number">
                <input className="cafe-input" value={form.phone}
                  onChange={e => set('phone', e.target.value)} />
              </Field>
              <Field label="Branch Address" col2>
                <input className="cafe-input" value={form.cafe_address}
                  onChange={e => set('cafe_address', e.target.value)} />
              </Field>
              <Field label="Currency Symbol">
                <input className="cafe-input w-28" value={form.currency}
                  onChange={e => set('currency', e.target.value)} />
              </Field>
              <Field label="GST / Sales Tax (%)">
                <input type="number" min="0" step="0.5" className="cafe-input w-28"
                  value={form.tax_rate} onChange={e => set('tax_rate', e.target.value)} />
              </Field>
            </div>
          </section>

          {/* THERMAL PRINTER ────────────────────────────────────── */}
          <section>
            <SectionTitle icon={<Printer className="w-4 h-4" />} label="Thermal Printer (ESC/POS)" />
            <div className="grid grid-cols-2 gap-4">
              <Field label="Printer Interface" col2>
                <select
                  className="cafe-input"
                  value={form.printer_interface}
                  onChange={e => set('printer_interface', e.target.value)}
                >
                  <option value="none">Manual printing (preview and export)</option>
                  <option value="network">LAN Thermal Printer (Direct IP Raw Socket)</option>
                </select>
              </Field>

              <Field label="Auto-Print on Checkout" col2>
                <label className="flex items-center gap-3 cursor-pointer">
                  <div
                    onClick={() =>
                      set('print_receipt_on_checkout',
                        form.print_receipt_on_checkout === 'true' ? 'false' : 'true')}
                    className={`relative w-11 h-6 rounded-full transition-colors cursor-pointer ${
                      form.print_receipt_on_checkout === 'true' ? 'bg-coffee-600' : 'bg-cream-300'
                    }`}
                  >
                    <div className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                      form.print_receipt_on_checkout === 'true' ? 'translate-x-5' : ''
                    }`} />
                  </div>
                  <span className="text-sm text-coffee-700 font-medium">
                    {form.print_receipt_on_checkout === 'true'
                      ? 'Enabled — receipt prints immediately on "Print & Checkout"'
                      : 'Disabled — no automatic printing'}
                  </span>
                </label>
              </Field>

              {form.printer_interface === 'network' && (
                <>
                  <Field label="Printer IP Address">
                    <input className="cafe-input" placeholder="192.168.1.200"
                      value={form.printer_ip || ''} onChange={e => set('printer_ip', e.target.value)} />
                  </Field>
                  <Field label="Printer Raw Socket Port">
                    <input className="cafe-input" placeholder="9100"
                      value={form.printer_port || '9100'} onChange={e => set('printer_port', e.target.value)} />
                  </Field>
                </>
              )}
            </div>
          </section>

          {/* LAN SYNC ───────────────────────────────────────────── */}
          <section>
            <SectionTitle icon={<Network className="w-4 h-4" />} label="Two-PC LAN Synchronization" />
            <div className="grid grid-cols-2 gap-4">
              <Field label="This PC's Role" col2>
                <select
                  className="cafe-input"
                  value={form.lan_mode}
                  onChange={e => set('lan_mode', e.target.value as 'primary' | 'secondary')}
                >
                  <option value="primary">Primary PC — Master SQLite Database Server</option>
                  <option value="secondary">Secondary PC — Counter / Client (reads from Primary)</option>
                </select>
              </Field>

              <Field label="This Machine's IP" col2>
                <div className="cafe-input bg-cream-200 text-coffee-600 font-mono cursor-default select-all">
                  {lanStatus?.localIp || '—'}
                </div>
              </Field>

              {form.lan_mode === 'secondary' && (
                <>
                  <Field label="Primary PC IP Address">
                    <input className="cafe-input" placeholder="192.168.1.100"
                      value={form.lan_primary_ip} onChange={e => set('lan_primary_ip', e.target.value)} />
                  </Field>
                  <Field label="Primary PC Port">
                    <input className="cafe-input" placeholder="49200"
                      value={form.lan_primary_port} onChange={e => set('lan_primary_port', e.target.value)} />
                  </Field>

                  {/* Test connection row */}
                  <div className="col-span-2 flex items-center justify-between rounded-xl
                                  bg-cream-100 border border-cream-300 px-4 py-3 gap-4">
                    <span className={`text-xs font-medium ${testMsg?.ok ? 'text-emerald-700' : 'text-coffee-500'}`}>
                      {testMsg?.text ?? 'Click "Test" to verify connection to the Primary PC.'}
                    </span>
                    <button
                      type="button"
                      onClick={handleTestLan}
                      className="flex items-center gap-1.5 px-4 py-2 bg-coffee-600 hover:bg-coffee-700
                                 text-white rounded-xl text-xs font-bold transition-colors press-btn shrink-0"
                    >
                      <TestTube className="w-3.5 h-3.5" />
                      Test LAN
                    </button>
                  </div>
                </>
              )}
            </div>
          </section>
        </form>

        {/* ── Footer ─────────────────────────────────────────────── */}
        <div className="flex justify-end gap-3 px-7 py-4 bg-cream-100/60 border-t border-cream-200">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2.5 bg-white border border-cream-300 hover:bg-cream-100
                       text-coffee-700 font-semibold rounded-xl text-sm transition-colors press-btn"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving}
            className="flex items-center gap-2 px-6 py-2.5 bg-coffee-700 hover:bg-coffee-800
                       disabled:opacity-50 text-white font-bold rounded-xl text-sm
                       transition-colors press-btn shadow-warm"
          >
            <Save className="w-4 h-4" />
            {saving ? 'Saving…' : 'Save Settings'}
          </button>
        </div>
      </div>
    </div>
  );
};
