import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Box, Edit3, Plus, RefreshCw, ShoppingCart, Trash2, X } from 'lucide-react';
import { AdminOverrideGrant, AuthSession } from '../../../types/auth';
import { InventoryMovement, RawIngredient, RawIngredientUnitType, RawInventoryPurchaseInput } from '../../../types/pos';
import { AdminPinModal } from '../components/AdminPinModal';
import { PosLoader } from '../components/PosLoader';
import { PosToast } from '../components/PosToast';
import { formatBaseQuantityInput, formatBaseUnits, getBaseUnit, getLargeUnit, InventoryEntryUnit, parseBaseUnitQuantity } from '../utils/inventoryUnits';

interface Props {
    session: AuthSession;
}

type IngredientForm = Pick<RawIngredient, 'name' | 'unit_type'> & {
    entry_unit: InventoryEntryUnit;
    current_stock_base: string;
    low_stock_threshold_base: string;
};

interface PurchaseForm {
    ingredient_id: string;
    quantity: string;
    entry_unit: InventoryEntryUnit;
    amount: string;
    supplier: string;
}

const emptyForm: IngredientForm = {
    name: '',
    unit_type: 'weight',
    entry_unit: 'g',
    current_stock_base: '0',
    low_stock_threshold_base: '0',
};

export const RawInventoryPage: React.FC<Props> = ({ session }) => {
    const [ingredients, setIngredients] = useState<RawIngredient[]>([]);
    const [movements, setMovements] = useState<InventoryMovement[]>([]);
    const [loading, setLoading] = useState(true);
    const [modalOpen, setModalOpen] = useState(false);
    const [editingId, setEditingId] = useState<number | null>(null);
    const [form, setForm] = useState<IngredientForm>(emptyForm);
    const [purchaseOpen, setPurchaseOpen] = useState(false);
    const [purchaseForm, setPurchaseForm] = useState<PurchaseForm>({ ingredient_id: '', quantity: '', entry_unit: 'g', amount: '', supplier: '' });
    const [purchaseError, setPurchaseError] = useState('');
    const [currency, setCurrency] = useState('Rs.');
    const [formError, setFormError] = useState('');
    const [notice, setNotice] = useState<{ message: string; tone: 'success' | 'error' } | null>(null);
    const [pinOpen, setPinOpen] = useState(false);
    const [saving, setSaving] = useState(false);
    const pendingAction = useRef<((grant: AdminOverrideGrant) => void) | null>(null);

    const loadData = async () => {
        setLoading(true);
        try {
            if (!window.api) throw new Error('Inventory is available only in the desktop application.');
            const [ingredientResult, movementResult, settingsResult] = await Promise.all([
                window.api.getRawIngredients(session.sessionToken),
                window.api.getInventoryMovements(100, session.sessionToken),
                window.api.getSettings(session.sessionToken),
            ]);
            if (!ingredientResult.success || !ingredientResult.data) throw new Error(ingredientResult.error || 'Could not load raw materials.');
            if (!movementResult.success || !movementResult.data) throw new Error(movementResult.error || 'Could not load inventory history.');
            setIngredients(ingredientResult.data);
            setMovements(movementResult.data);
            if (settingsResult.success && settingsResult.data?.currency) setCurrency(settingsResult.data.currency);
        } catch (error) {
            setNotice({ message: error instanceof Error ? error.message : 'Could not load inventory.', tone: 'error' });
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { void loadData(); }, []);

    const requestAdminPin = (action: (grant: AdminOverrideGrant) => void) => {
        pendingAction.current = action;
        setPinOpen(true);
    };

    const openAdd = () => {
        setEditingId(null);
        setForm(emptyForm);
        setFormError('');
        setModalOpen(true);
    };

    const openEdit = (ingredient: RawIngredient) => {
        setEditingId(ingredient.id);
        setForm({
            name: ingredient.name,
            unit_type: ingredient.unit_type,
            entry_unit: getBaseUnit(ingredient.unit_type),
            current_stock_base: String(ingredient.current_stock_base),
            low_stock_threshold_base: String(ingredient.low_stock_threshold_base),
        });
        setFormError('');
        setModalOpen(true);
    };

    const handleSave = (event: React.FormEvent) => {
        event.preventDefault();
        const currentStock = parseBaseUnitQuantity(form.current_stock_base, form.entry_unit);
        const threshold = parseBaseUnitQuantity(form.low_stock_threshold_base, form.entry_unit);
        if (!form.name.trim() || form.name.trim().length > 120) { setFormError('Enter an ingredient name of up to 120 characters.'); return; }
        if (currentStock === null || threshold === null || currentStock < 0 || threshold < 0) { setFormError(`Enter valid ${form.entry_unit} quantities with no more than three decimal places.`); return; }

        requestAdminPin(grant => {
            void (async () => {
                setSaving(true);
                setFormError('');
                try {
                    if (!window.api) throw new Error('Inventory is available only in the desktop application.');
                    const payload = { name: form.name.trim(), unit_type: form.unit_type, current_stock_base: currentStock, low_stock_threshold_base: threshold };
                    const result = editingId === null
                        ? await window.api.addRawIngredient(payload, grant.authorizationToken, session.sessionToken)
                        : await window.api.updateRawIngredient(editingId, payload, grant.authorizationToken, session.sessionToken);
                    if (!result.success) throw new Error(result.error || 'Could not save raw material.');
                    setModalOpen(false);
                    setNotice({ message: editingId === null ? 'Raw material added.' : 'Raw material updated.', tone: 'success' });
                    await loadData();
                } catch (error) {
                    setFormError(error instanceof Error ? error.message : 'Could not save raw material.');
                } finally {
                    setSaving(false);
                }
            })();
        });
    };

    const handleDelete = (ingredient: RawIngredient) => {
        if (!window.confirm(`Delete ${ingredient.name}? Ingredients used in a recipe or an unvoided order cannot be deleted.`)) return;
        requestAdminPin(grant => {
            void (async () => {
                try {
                    if (!window.api) throw new Error('Inventory is available only in the desktop application.');
                    const result = await window.api.deleteRawIngredient(ingredient.id, grant.authorizationToken, session.sessionToken);
                    if (!result.success) throw new Error(result.error || 'Could not delete raw material.');
                    setNotice({ message: `${ingredient.name} deleted. Historical movement records are retained.`, tone: 'success' });
                    await loadData();
                } catch (error) {
                    setNotice({ message: error instanceof Error ? error.message : 'Could not delete raw material.', tone: 'error' });
                }
            })();
        });
    };

    const openPurchase = () => {
        const ingredient = ingredients[0];
        if (!ingredient) return;
        setPurchaseForm({ ingredient_id: String(ingredient.id), quantity: '', entry_unit: getBaseUnit(ingredient.unit_type), amount: '', supplier: '' });
        setPurchaseError('');
        setPurchaseOpen(true);
    };

    const handlePurchase = (event: React.FormEvent) => {
        event.preventDefault();
        const ingredient = ingredients.find(item => item.id === Number(purchaseForm.ingredient_id));
        const quantity = parseBaseUnitQuantity(purchaseForm.quantity, purchaseForm.entry_unit);
        const amountMatch = /^(\d+)(?:\.(\d{1,2}))?$/.exec(purchaseForm.amount.trim());
        const amountMinorBig = amountMatch ? BigInt(amountMatch[1]) * 100n + BigInt((amountMatch[2] || '').padEnd(2, '0')) : 0n;
        if (!ingredient) { setPurchaseError('Select an existing raw ingredient.'); return; }
        if (quantity === null || quantity < 1) { setPurchaseError(`Enter a positive quantity in ${purchaseForm.entry_unit}; fractional entries allow up to three decimals only for kg/L.`); return; }
        if (amountMinorBig < 1n || amountMinorBig > BigInt(Number.MAX_SAFE_INTEGER)) { setPurchaseError('Enter a purchase amount greater than zero with at most two decimal places.'); return; }
        if (purchaseForm.supplier.trim().length > 120) { setPurchaseError('Supplier name must be 120 characters or fewer.'); return; }

        const purchase: RawInventoryPurchaseInput = {
            ingredient_id: ingredient.id,
            quantity_base_units: quantity,
            amount_minor: Number(amountMinorBig),
            supplier: purchaseForm.supplier.trim(),
        };
        requestAdminPin(grant => {
            void (async () => {
                setPurchaseError('');
                try {
                    if (!window.api) throw new Error('Inventory purchases require the desktop application.');
                    const result = await window.api.recordRawPurchase(purchase, grant.authorizationToken, session.sessionToken);
                    if (!result.success) throw new Error(result.error || 'Could not record inventory purchase.');
                    setPurchaseOpen(false);
                    setNotice({ tone: 'success', message: `Added ${formatBaseUnits(quantity, ingredient.unit_type)} of ${ingredient.name}. Purchase and stock are recorded.` });
                    await loadData();
                } catch (error) {
                    setPurchaseError(error instanceof Error ? error.message : 'Could not record inventory purchase.');
                }
            })();
        });
    };

    const lowStockIngredients = ingredients.filter(ingredient => ingredient.current_stock_base <= ingredient.low_stock_threshold_base);

    return (
        <section className="relative flex-1 overflow-y-auto bg-cream-100 p-5 space-y-4 select-none">
            {notice && <PosToast message={notice.message} tone={notice.tone} onDismiss={() => setNotice(null)} />}
            {loading && <PosLoader overlay message="Loading raw material inventory..." />}

            <header className="flex flex-col gap-4 rounded-2xl border border-cream-200 bg-white p-5 shadow-warm-sm sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-4">
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-100 text-emerald-800"><Box className="h-6 w-6" /></div>
                    <div>
                        <h1 className="text-xl font-black text-coffee-800">Inventory / Raw Materials</h1>
                        <p className="mt-1 text-xs font-medium text-coffee-500">Stock is tracked in integer grams, milliliters, or each.</p>
                    </div>
                </div>
                <div className="flex gap-2">
                    <button type="button" onClick={() => void loadData()} title="Refresh inventory" aria-label="Refresh inventory" className="flex h-10 w-10 items-center justify-center rounded-xl border border-cream-300 text-coffee-700 hover:bg-cream-100"><RefreshCw className="h-4 w-4" /></button>
                    <button type="button" disabled={!ingredients.length} onClick={openPurchase} className="flex items-center gap-2 rounded-xl border border-emerald-700 px-4 py-2.5 text-sm font-bold text-emerald-800 hover:bg-emerald-50 disabled:opacity-40"><ShoppingCart className="h-4 w-4" />Record Purchase</button>
                    <button type="button" onClick={openAdd} className="flex items-center gap-2 rounded-xl bg-coffee-700 px-4 py-2.5 text-sm font-bold text-white hover:bg-coffee-800"><Plus className="h-4 w-4" />Add Raw Material</button>
                </div>
            </header>

            {lowStockIngredients.length > 0 && (
                <div role="status" className="flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-950">
                    <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
                    <div>
                        <p className="text-sm font-black">{lowStockIngredients.length} raw material{lowStockIngredients.length === 1 ? '' : 's'} at or below the low-stock threshold</p>
                        <p className="mt-1 text-xs font-medium">{lowStockIngredients.map(item => item.name).join(', ')}</p>
                    </div>
                </div>
            )}

            <div className="overflow-hidden rounded-2xl border border-cream-200 bg-white shadow-warm-sm">
                <div className="flex items-center justify-between border-b border-cream-200 px-5 py-4">
                    <h2 className="text-sm font-black text-coffee-800">Raw materials</h2>
                    <span className="text-xs font-bold text-coffee-400">{ingredients.length} total</span>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full min-w-[680px] text-left">
                        <thead className="bg-cream-50 text-[10px] font-black uppercase text-coffee-500">
                            <tr><th className="px-5 py-3">Ingredient</th><th className="px-5 py-3">Unit family</th><th className="px-5 py-3">Current stock</th><th className="px-5 py-3">Alert threshold</th><th className="px-5 py-3">Status</th><th className="px-5 py-3 text-right">Actions</th></tr>
                        </thead>
                        <tbody className="divide-y divide-cream-100">
                            {ingredients.length === 0 ? <tr><td colSpan={6} className="px-5 py-10 text-center text-sm font-semibold text-coffee-400">No raw materials have been added.</td></tr> : ingredients.map(ingredient => {
                                const low = ingredient.current_stock_base <= ingredient.low_stock_threshold_base;
                                return <tr key={ingredient.id} className={low ? 'bg-amber-50/70' : 'hover:bg-cream-50/60'}>
                                    <td className="px-5 py-3.5 text-sm font-extrabold text-coffee-800">{ingredient.name}</td>
                                    <td className="px-5 py-3.5 text-xs font-semibold text-coffee-500">{ingredient.unit_type === 'weight' ? 'Weight (kg / g)' : ingredient.unit_type === 'volume' ? 'Volume (L / mL)' : 'Count (each)'}</td>
                                    <td className="px-5 py-3.5 text-sm font-bold text-coffee-800">{formatBaseUnits(ingredient.current_stock_base, ingredient.unit_type)}</td>
                                    <td className="px-5 py-3.5 text-sm font-semibold text-coffee-600">{formatBaseUnits(ingredient.low_stock_threshold_base, ingredient.unit_type)}</td>
                                    <td className="px-5 py-3.5"><span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase ${low ? 'bg-amber-200 text-amber-950' : 'bg-emerald-100 text-emerald-800'}`}>{low ? 'Low stock' : 'In stock'}</span></td>
                                    <td className="px-5 py-3.5"><div className="flex justify-end gap-2">
                                        <button type="button" onClick={() => openEdit(ingredient)} title={`Edit ${ingredient.name}`} aria-label={`Edit ${ingredient.name}`} className="flex h-9 w-9 items-center justify-center rounded-lg bg-cream-100 text-coffee-700 hover:bg-cream-200"><Edit3 className="h-4 w-4" /></button>
                                        <button type="button" onClick={() => handleDelete(ingredient)} title={`Delete ${ingredient.name}`} aria-label={`Delete ${ingredient.name}`} className="flex h-9 w-9 items-center justify-center rounded-lg bg-red-50 text-red-700 hover:bg-red-100"><Trash2 className="h-4 w-4" /></button>
                                    </div></td>
                                </tr>;
                            })}
                        </tbody>
                    </table>
                </div>
            </div>

            <div className="overflow-hidden rounded-2xl border border-cream-200 bg-white shadow-warm-sm">
                <div className="border-b border-cream-200 px-5 py-4"><h2 className="text-sm font-black text-coffee-800">Recent inventory movements</h2></div>
                <div className="overflow-x-auto">
                    <table className="w-full min-w-[680px] text-left">
                        <thead className="bg-cream-50 text-[10px] font-black uppercase text-coffee-500"><tr><th className="px-5 py-3">Time</th><th className="px-5 py-3">Ingredient</th><th className="px-5 py-3">Movement</th><th className="px-5 py-3">Change</th><th className="px-5 py-3">By</th><th className="px-5 py-3">Details</th></tr></thead>
                        <tbody className="divide-y divide-cream-100">
                            {movements.length === 0 ? <tr><td colSpan={6} className="px-5 py-8 text-center text-sm font-semibold text-coffee-400">No inventory movements yet.</td></tr> : movements.map(movement => <tr key={movement.id}>
                                <td className="whitespace-nowrap px-5 py-3 text-xs text-coffee-500">{new Date(movement.created_at).toLocaleString()}</td>
                                <td className="px-5 py-3 text-xs font-bold text-coffee-800">{movement.ingredient_name}</td>
                                <td className="px-5 py-3 text-xs font-semibold capitalize text-coffee-600">{movement.movement_type.replace('_', ' ')}</td>
                                <td className={`whitespace-nowrap px-5 py-3 text-xs font-black ${movement.quantity_delta_base < 0 ? 'text-red-700' : 'text-emerald-700'}`}>{formatBaseUnits(movement.quantity_delta_base, movement.unit_type)}</td>
                                <td className="px-5 py-3 text-xs text-coffee-600">{movement.actor}</td>
                                <td className="max-w-[260px] truncate px-5 py-3 text-xs text-coffee-500" title={movement.details}>{movement.spend_minor > 0 ? `${currency} ${(movement.spend_minor / 100).toFixed(2)}${movement.supplier ? ` · ${movement.supplier}` : ''} · ` : ''}{movement.details}</td>
                            </tr>)}
                        </tbody>
                    </table>
                </div>
            </div>

            {modalOpen && <div className="modal-backdrop z-50 bg-coffee-900/40 p-4 backdrop-blur-sm">
                <div className="mx-auto flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-cream-300 bg-cream-50 shadow-warm-lg">
                    <div className="flex items-center justify-between border-b border-cream-200 bg-white px-6 py-4">
                        <h2 className="text-lg font-black text-coffee-800">{editingId === null ? 'Add raw material' : 'Edit raw material'}</h2>
                        <button type="button" onClick={() => setModalOpen(false)} title="Close" aria-label="Close" className="flex h-9 w-9 items-center justify-center rounded-lg text-coffee-500 hover:bg-cream-100"><X className="h-4 w-4" /></button>
                    </div>
                    <form onSubmit={handleSave} className="space-y-4 overflow-y-auto p-6">
                        {formError && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs font-semibold text-red-700">{formError}</div>}
                        <label className="block text-xs font-bold text-coffee-600">Ingredient name
                            <input required maxLength={120} autoFocus value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} className="cafe-input mt-1.5" placeholder="e.g. Milk" />
                        </label>
                        <label className="block text-xs font-bold text-coffee-600">Unit type
                            <select disabled={editingId !== null} value={form.unit_type} onChange={event => {
                                const nextType = event.target.value as RawIngredientUnitType;
                                const currentBase = parseBaseUnitQuantity(form.current_stock_base, form.entry_unit);
                                const thresholdBase = parseBaseUnitQuantity(form.low_stock_threshold_base, form.entry_unit);
                                if (currentBase === null || thresholdBase === null) { setFormError('Correct the current quantities before changing the unit type.'); return; }
                                const nextUnit = getBaseUnit(nextType);
                                setForm({ ...form, unit_type: nextType, entry_unit: nextUnit, current_stock_base: formatBaseQuantityInput(currentBase, nextUnit), low_stock_threshold_base: formatBaseQuantityInput(thresholdBase, nextUnit) });
                            }} className="cafe-input mt-1.5">
                                <option value="weight">Weight (kg / g)</option>
                                <option value="volume">Volume (L / mL)</option>
                                <option value="count">Count (each)</option>
                            </select>
                        </label>
                        <label className="block text-xs font-bold text-coffee-600">Entry unit
                            <select value={form.entry_unit} onChange={event => {
                                const nextUnit = event.target.value as InventoryEntryUnit;
                                const currentBase = parseBaseUnitQuantity(form.current_stock_base, form.entry_unit);
                                const thresholdBase = parseBaseUnitQuantity(form.low_stock_threshold_base, form.entry_unit);
                                if (currentBase === null || thresholdBase === null) { setFormError('Correct the current quantities before changing the entry unit.'); return; }
                                setForm({ ...form, entry_unit: nextUnit, current_stock_base: formatBaseQuantityInput(currentBase, nextUnit), low_stock_threshold_base: formatBaseQuantityInput(thresholdBase, nextUnit) });
                            }} className="cafe-input mt-1.5">
                                <option value={getBaseUnit(form.unit_type)}>{getBaseUnit(form.unit_type)}</option>
                                {getLargeUnit(form.unit_type) && <option value={getLargeUnit(form.unit_type)!}>{getLargeUnit(form.unit_type)}</option>}
                            </select>
                        </label>
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                            <label className="block text-xs font-bold text-coffee-600">Current stock ({form.entry_unit})
                                <input required type="number" min="0" step={form.entry_unit === 'kg' || form.entry_unit === 'L' ? '0.001' : '1'} value={form.current_stock_base} onChange={event => setForm({ ...form, current_stock_base: event.target.value })} className="cafe-input mt-1.5" />
                            </label>
                            <label className="block text-xs font-bold text-coffee-600">Low-stock alert ({form.entry_unit})
                                <input required type="number" min="0" step={form.entry_unit === 'kg' || form.entry_unit === 'L' ? '0.001' : '1'} value={form.low_stock_threshold_base} onChange={event => setForm({ ...form, low_stock_threshold_base: event.target.value })} className="cafe-input mt-1.5" />
                            </label>
                        </div>
                        <p className="rounded-lg bg-cream-100 p-3 text-xs font-medium text-coffee-500">Quantities are stored as whole {form.unit_type === 'weight' ? 'grams' : form.unit_type === 'volume' ? 'milliliters' : 'items'}.</p>
                        <div className="flex justify-end gap-2 border-t border-cream-200 pt-4">
                            <button type="button" onClick={() => setModalOpen(false)} className="rounded-lg border border-cream-300 bg-white px-4 py-2.5 text-sm font-bold text-coffee-700 hover:bg-cream-100">Cancel</button>
                            <button type="submit" disabled={saving} className="rounded-lg bg-coffee-700 px-4 py-2.5 text-sm font-bold text-white hover:bg-coffee-800 disabled:opacity-50">{saving ? 'Saving...' : editingId === null ? 'Add material' : 'Save changes'}</button>
                        </div>
                    </form>
                </div>
            </div>}

            {purchaseOpen && <div className="modal-backdrop z-50 bg-coffee-900/40 p-4 backdrop-blur-sm">
                <div className="mx-auto flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-cream-300 bg-cream-50 shadow-warm-lg">
                    <div className="flex items-center justify-between border-b border-cream-200 bg-white px-6 py-4">
                        <h2 className="text-lg font-black text-coffee-800">Record inventory purchase</h2>
                        <button type="button" onClick={() => setPurchaseOpen(false)} title="Close" aria-label="Close" className="flex h-9 w-9 items-center justify-center rounded-lg text-coffee-500 hover:bg-cream-100"><X className="h-4 w-4" /></button>
                    </div>
                    <form onSubmit={handlePurchase} className="space-y-4 overflow-y-auto p-6">
                        {purchaseError && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs font-semibold text-red-700">{purchaseError}</div>}
                        <label className="block text-xs font-bold text-coffee-600">Raw ingredient
                            <select required value={purchaseForm.ingredient_id} onChange={event => {
                                const next = ingredients.find(item => item.id === Number(event.target.value));
                                if (next) setPurchaseForm({ ...purchaseForm, ingredient_id: event.target.value, entry_unit: getBaseUnit(next.unit_type), quantity: '' });
                            }} className="cafe-input mt-1.5">
                                <option value="">Select ingredient</option>
                                {ingredients.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                            </select>
                        </label>
                        {(() => {
                            const selected = ingredients.find(item => item.id === Number(purchaseForm.ingredient_id));
                            if (!selected) return null;
                            const largeUnit = getLargeUnit(selected.unit_type);
                            const fractionalEntry = purchaseForm.entry_unit === 'kg' || purchaseForm.entry_unit === 'L';
                            return <>
                                <label className="block text-xs font-bold text-coffee-600">Purchase unit
                                    <select value={purchaseForm.entry_unit} onChange={event => setPurchaseForm({ ...purchaseForm, entry_unit: event.target.value as InventoryEntryUnit, quantity: '' })} className="cafe-input mt-1.5">
                                        <option value={getBaseUnit(selected.unit_type)}>{getBaseUnit(selected.unit_type)}</option>
                                        {largeUnit && <option value={largeUnit}>{largeUnit}</option>}
                                    </select>
                                </label>
                                <label className="block text-xs font-bold text-coffee-600">Quantity ({purchaseForm.entry_unit})
                                    <input required type="number" min={fractionalEntry ? '0.001' : '1'} step={fractionalEntry ? '0.001' : '1'} value={purchaseForm.quantity} onChange={event => setPurchaseForm({ ...purchaseForm, quantity: event.target.value })} className="cafe-input mt-1.5" />
                                </label>
                            </>;
                        })()}
                        <label className="block text-xs font-bold text-coffee-600">Total paid ({currency})
                            <input required type="number" min="0.01" step="0.01" value={purchaseForm.amount} onChange={event => setPurchaseForm({ ...purchaseForm, amount: event.target.value })} className="cafe-input mt-1.5" placeholder="0.00" />
                        </label>
                        <label className="block text-xs font-bold text-coffee-600">Supplier (optional)
                            <input maxLength={120} value={purchaseForm.supplier} onChange={event => setPurchaseForm({ ...purchaseForm, supplier: event.target.value })} className="cafe-input mt-1.5" placeholder="Supplier name" />
                        </label>
                        <p className="rounded-lg bg-cream-100 p-3 text-xs font-medium text-coffee-500">Stock and spend are saved together. Currency is stored in integer minor units for exact totals.</p>
                        <div className="flex justify-end gap-2 border-t border-cream-200 pt-4">
                            <button type="button" onClick={() => setPurchaseOpen(false)} className="rounded-lg border border-cream-300 bg-white px-4 py-2.5 text-sm font-bold text-coffee-700 hover:bg-cream-100">Cancel</button>
                            <button type="submit" className="rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-bold text-white hover:bg-emerald-800">Record purchase</button>
                        </div>
                    </form>
                </div>
            </div>}

            <AdminPinModal
                isOpen={pinOpen}
                sessionToken={session.sessionToken}
                scope="inventory:write"
                title="Authorize Inventory Change"
                description="Enter an Admin PIN to change raw-material stock or settings. Each change is recorded in the audit log."
                actionLabel="Authorize Change"
                onSuccess={grant => {
                    const action = pendingAction.current;
                    pendingAction.current = null;
                    action?.(grant);
                }}
                onClose={() => setPinOpen(false)}
            />
        </section>
    );
};