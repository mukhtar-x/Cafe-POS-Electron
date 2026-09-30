import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Product, ProductRecipeInput, RecipeIngredientOption } from '../../../types/pos';
import { AdminOverrideGrant, AdminOverrideScope, AuthSession } from '../../../types/auth';
import { PosLoader } from '../components/PosLoader';
import { PosToast } from '../components/PosToast';
import { AdminPinModal } from '../components/AdminPinModal';
import {
    ClipboardList, Plus, Search, Edit3, Trash2,
    X, Check, AlertCircle
} from 'lucide-react';

interface Props {
    session: AuthSession;
    onMenuUpdated?: () => void;
}

interface RecipeDraft {
    ingredientId: string;
    quantityBaseUnits: string;
}

export const MenuManagementPage: React.FC<Props> = ({ session, onMenuUpdated }) => {
    const [products, setProducts] = useState<Product[]>([]);
    const [recipeIngredients, setRecipeIngredients] = useState<RecipeIngredientOption[]>([]);
    const [recipeIngredientsLoading, setRecipeIngredientsLoading] = useState(false);
    const [recipeDrafts, setRecipeDrafts] = useState<RecipeDraft[]>([]);
    const [recipesLoading, setRecipesLoading] = useState(false);
    const [loading, setLoading] = useState(false);
    const [search, setSearch] = useState('');
    const [selectedCategory, setSelectedCategory] = useState('All');

    // Modal State for Add / Edit
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingProduct, setEditingProduct] = useState<Product | null>(null);
    const [formData, setFormData] = useState({
        name: '',
        category: 'Chai & Hot Drinks',
        price: '',
        cost_price: '',
        variant: '',
    });
    const [formError, setFormError] = useState('');
    const [notice, setNotice] = useState<{ message: string; tone: 'success' | 'error' } | null>(null);

    // Admin PIN guard state
    const [adminPinOpen, setAdminPinOpen] = useState(false);
    const [adminPinScope, setAdminPinScope] = useState<AdminOverrideScope>('menu:add');
    const [adminGrant, setAdminGrant] = useState<AdminOverrideGrant | null>(null);
    const pendingAction = useRef<((grant: AdminOverrideGrant) => void) | null>(null);

    const requireAdminPin = (scope: AdminOverrideScope, action: (grant: AdminOverrideGrant) => void) => {
        setAdminPinScope(scope);
        pendingAction.current = action;
        setAdminPinOpen(true);
    };

    const loadProducts = async () => {
        setLoading(true);
        try {
            if (window.api) {
                const res = await window.api.getProducts(session.sessionToken);
                if (res.success && res.data) {
                    setProducts(res.data);
                }
            } else { setProducts([]); }
        } catch (err) {
            console.error('Failed to load products:', err);
        } finally {
            setLoading(false);
        }
    };

    const loadRecipeIngredients = async () => {
        if (!window.api) return;
        setRecipeIngredientsLoading(true);
        try {
            const result = await window.api.getRecipeIngredientOptions(session.sessionToken);
            if (result.success && result.data) setRecipeIngredients(result.data);
        } catch (error) {
            console.error('Failed to load recipe ingredients:', error);
        } finally {
            setRecipeIngredientsLoading(false);
        }
    };

    useEffect(() => {
        loadProducts();
        void loadRecipeIngredients();
    }, []);

    const categories = useMemo(() => {
        return ['All', ...new Set(products.map(p => p.category))];
    }, [products]);

    const filteredProducts = useMemo(() => {
        return products.filter(p => {
            const matchCat = selectedCategory === 'All' || p.category === selectedCategory;
            const matchSearch = p.name.toLowerCase().includes(search.toLowerCase()) ||
                p.category.toLowerCase().includes(search.toLowerCase());
            return matchCat && matchSearch;
        });
    }, [products, selectedCategory, search]);

    const handleOpenAddModal = () => {
        requireAdminPin('menu:add', (grant) => {
            setAdminGrant(grant);
            setEditingProduct(null);
            setFormData({
                name: '',
                category: categories[1] || 'Chai & Hot Drinks',
                price: '',
                cost_price: '',
                variant: '',
            });
            setRecipeDrafts([]);
            setRecipesLoading(false);
            setFormError('');
            setIsModalOpen(true);
            void loadRecipeIngredients();
        });
    };

    const handleOpenEditModal = (product: Product) => {
        requireAdminPin('menu:update', (grant) => {
            setAdminGrant(grant);
            setEditingProduct(product);
            setFormData({
                name: product.name,
                category: product.category,
                price: String(product.price),
                cost_price: product.cost_price == null ? '' : String(product.cost_price),
                variant: product.variant || '',
            });
            setRecipeDrafts([]);
            setRecipesLoading(true);
            setFormError('');
            setIsModalOpen(true);
            void loadRecipeIngredients();
            if (window.api) {
                void window.api.getProductRecipes(product.id, session.sessionToken)
                    .then(result => {
                        if (!result.success || !result.data) throw new Error(result.error || 'Could not load this product recipe.');
                        setRecipeDrafts(result.data.map(recipe => ({ ingredientId: String(recipe.ingredient_id), quantityBaseUnits: String(recipe.quantity_base_units) })));
                    })
                    .catch(error => setFormError(error instanceof Error ? error.message : 'Could not load this product recipe.'))
                    .finally(() => setRecipesLoading(false));
            } else {
                setRecipesLoading(false);
            }
        });
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!formData.name.trim()) {
            setFormError('Item name is required.');
            return;
        }
        const priceNum = parseFloat(formData.price);
        if (isNaN(priceNum) || priceNum <= 0) {
            setFormError('Please enter a valid price in PKR (greater than 0).');
            return;
        }
        const costPrice = formData.cost_price.trim() === '' ? null : Number(formData.cost_price);
        if (costPrice !== null && (!Number.isFinite(costPrice) || costPrice < 0)) {
            setFormError('Cost price must be zero or greater, or left blank when unknown.');
            return;
        }
        if (!adminGrant) { setFormError('Admin authorization expired. Reopen this action and verify the PIN again.'); return; }
        if (recipesLoading) { setFormError('Wait for the current recipe to finish loading.'); return; }
        const recipes: ProductRecipeInput[] = [];
        const seenIngredientIds = new Set<number>();
        for (const draft of recipeDrafts) {
            const ingredientId = Number(draft.ingredientId);
            const quantityBaseUnits = Number(draft.quantityBaseUnits);
            const ingredient = recipeIngredients.find(option => option.id === ingredientId);
            if (!ingredient || !Number.isSafeInteger(quantityBaseUnits) || quantityBaseUnits < 1) {
                setFormError('Each recipe row needs an ingredient and a whole-number quantity greater than zero.');
                return;
            }
            if (seenIngredientIds.has(ingredientId)) {
                setFormError('Each raw ingredient can only appear once in a recipe. Combine its quantities into one row.');
                return;
            }
            seenIngredientIds.add(ingredientId);
            recipes.push({ ingredient_id: ingredientId, unit_type: ingredient.unit_type, quantity_base_units: quantityBaseUnits });
        }
        if (recipes.length === 0) { setFormError('Add at least one raw ingredient to the recipe before saving.'); return; }

        try {
            if (editingProduct) {
                // Update product
                if (window.api) {
                    const result = await window.api.updateProduct(editingProduct.id, {
                        name: formData.name.trim(),
                        category: formData.category,
                        price: priceNum,
                        cost_price: costPrice,
                        variant: formData.variant.trim() || null,
                    }, recipes, adminGrant.authorizationToken, session.sessionToken);
                    if (!result.success) throw new Error(result.error || 'Could not update menu item.');
                } else {
                    throw new Error('Menu management is available only in the desktop app.');
                }
            } else {
                // Add product
                if (window.api) {
                    const result = await window.api.addProduct({
                        name: formData.name.trim(),
                        category: formData.category,
                        price: priceNum,
                        cost_price: costPrice,
                        variant: formData.variant.trim() || null,
                    }, recipes, adminGrant.authorizationToken, session.sessionToken);
                    if (!result.success) throw new Error(result.error || 'Could not add menu item.');
                } else {
                    throw new Error('Menu management is available only in the desktop app.');
                }
            }

            setIsModalOpen(false);
            setAdminGrant(null);
            await loadProducts();
            if (onMenuUpdated) onMenuUpdated();
        } catch (err: any) {
            setAdminGrant(null);
            setFormError('Failed to save product: ' + err.message);
        }
    };

    const handleDelete = (id: number, name: string) => {
        requireAdminPin('menu:delete', async (grant) => {
            try {
                if (window.api) {
                    const result = await window.api.deleteProduct(id, grant.authorizationToken, session.sessionToken);
                    if (!result.success) throw new Error(result.error || 'Could not remove menu item.');
                } else {
                    setProducts(prev => prev.filter(p => p.id !== id));
                }
                setNotice({ tone: 'success', message: `"${name}" has been removed from the menu.` });
                await loadProducts();
                if (onMenuUpdated) onMenuUpdated();
            } catch (err: any) {
                setNotice({ tone: 'error', message: 'This menu item could not be removed. Refresh the menu and try again.' });
            }
        });
    };

    return (
        <div className="relative flex-1 overflow-y-auto bg-cream-100 p-5 space-y-4 select-none">
            {notice && <PosToast message={notice.message} tone={notice.tone} onDismiss={() => setNotice(null)} />}
            {loading && <PosLoader overlay message="Syncing local menu records..." />}
            {/* ── Page Header ─────────────────────────────────────────────────── */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-4 rounded-2xl border border-cream-200 shadow-warm-sm">
                <div className="flex items-center gap-4">
                    <div className="w-14 h-14 rounded-2xl bg-coffee-700 text-cream-50 flex items-center justify-center shadow-warm">
                        <ClipboardList className="w-7 h-7" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-black text-coffee-800 tracking-tight">Menu & Recipes</h1>
                        <p className="text-sm text-coffee-400 mt-0.5">Manage sellable products and the raw ingredients consumed by each recipe.</p>
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    <div className="bg-cream-50 border border-cream-200 px-5 py-3 rounded-2xl">
                        <p className="text-[11px] font-bold uppercase tracking-wider text-coffee-400">Total Items</p>
                        <p className="text-xl font-black text-coffee-800 leading-none mt-0.5">{products.length} Products</p>
                    </div>

                    <button
                        onClick={handleOpenAddModal}
                        className="flex items-center gap-2 px-5 py-3 rounded-xl bg-coffee-700 hover:bg-coffee-800 active:scale-98 text-white font-extrabold text-sm tracking-wide transition-all shadow-warm-md"
                    >
                        <Plus className="w-5 h-5" />
                        <span>Add New Item</span>
                    </button>
                </div>
            </div>

            {/* ── Search & Filter Bar ─────────────────────────────────────────── */}
            <div className="bg-white p-4 rounded-2xl border border-cream-200 shadow-warm-sm space-y-3">
                <div className="flex flex-col sm:flex-row gap-4 justify-between items-center">
                    {/* Search bar */}
                    <div className="relative w-full sm:w-96">
                        <Search className="w-4 h-4 text-coffee-300 absolute left-4 top-1/2 -translate-y-1/2" />
                        <input
                            type="text"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Search items or categories..."
                            className="w-full pl-11 pr-4 py-3 bg-cream-50 border border-cream-300 rounded-xl text-sm text-coffee-800 placeholder-coffee-300 focus:outline-none focus:border-coffee-600 focus:ring-2 focus:ring-coffee-600/10 transition-all"
                        />
                        {search && (
                            <button
                                onClick={() => setSearch('')}
                                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs font-semibold text-coffee-400 hover:text-coffee-700"
                            >
                                Clear
                            </button>
                        )}
                    </div>

                    {/* Categories counter */}
                    <div className="text-xs text-coffee-400 font-semibold">
                        Showing <strong className="text-coffee-800">{filteredProducts.length}</strong> of {products.length} items
                    </div>
                </div>

                {/* Category Pills */}
                <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pt-1">
                    {categories.map((cat) => {
                        const isSelected = selectedCategory === cat;
                        const count = cat === 'All' ? products.length : products.filter(p => p.category === cat).length;
                        return (
                            <button
                                key={cat}
                                onClick={() => setSelectedCategory(cat)}
                                className={`px-4 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-all flex items-center gap-2 ${isSelected
                                    ? 'bg-coffee-700 text-white shadow-warm'
                                    : 'bg-cream-50 hover:bg-cream-100 text-coffee-600 border border-cream-200'
                                    }`}
                            >
                                <span>{cat}</span>
                                <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono ${isSelected ? 'bg-black/20 text-white' : 'bg-cream-200 text-coffee-500'
                                    }`}>
                                    {count}
                                </span>
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* ── Products Table / Cards Grid ─────────────────────────────────── */}
            <div className="bg-white rounded-3xl border border-cream-200 shadow-warm-sm overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="bg-cream-50 border-b border-cream-200 text-coffee-500 text-xs font-extrabold uppercase tracking-wider">
                                <th className="py-2.5 px-4">Item Name</th>
                                <th className="py-2.5 px-4">Category</th>
                                <th className="py-2.5 px-4">Price (PKR)</th>
                                <th className="py-2.5 px-4">Unit Cost</th>
                                <th className="py-2.5 px-4">Recipe Capacity</th>
                                <th className="py-4 px-6 text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-cream-100 text-sm">
                            {filteredProducts.length === 0 ? (
                                <tr>
                                    <td colSpan={5} className="py-12 text-center text-coffee-400">
                                        No menu items found matching "{search}".
                                    </td>
                                </tr>
                            ) : (
                                filteredProducts.map((product) => (
                                    <tr key={product.id} className="hover:bg-cream-50/60 transition-colors">
                                        <td className="py-2 px-4 font-bold text-coffee-800">
                                            {product.name}
                                        </td>
                                        <td className="py-2 px-4">
                                            <span className="inline-flex px-3 py-1 bg-coffee-100 border border-coffee-200 text-coffee-800 rounded-full text-[11px] font-bold">
                                                {product.category}
                                            </span>
                                        </td>
                                        <td className="py-2 px-4 font-black text-coffee-800 text-base">
                                            Rs. {product.price.toFixed(0)}
                                        </td>
                                        <td className="py-2 px-4 font-semibold text-coffee-600">
                                            {product.cost_price == null ? 'Not set' : `Rs. ${product.cost_price.toFixed(0)}`}
                                        </td>
                                        <td className="py-2 px-4 font-medium text-coffee-600">
                                            {product.sellable_stock == null ? <span className="text-xs font-semibold text-red-600">Recipe required</span> : <span className={`inline-flex items-center gap-1.5 text-xs font-bold ${product.sellable_stock <= 5 ? 'text-amber-700' : 'text-emerald-700'}`}>
                                                <span className={`h-2 w-2 rounded-full ${product.sellable_stock <= 5 ? 'bg-amber-500' : 'bg-emerald-500'}`} />
                                                {product.sellable_stock} available
                                            </span>}
                                        </td>
                                        <td className="py-2 px-4 text-right">
                                            <div className="flex items-center justify-end gap-2">
                                                <button
                                                    onClick={() => handleOpenEditModal(product)}
                                                    className="min-w-11 min-h-11 px-3 rounded-xl bg-cream-100 hover:bg-cream-200 text-coffee-700 transition-colors"
                                                    title="Edit item"
                                                >
                                                    <Edit3 className="w-4 h-4" />
                                                </button>
                                                <button
                                                    onClick={() => handleDelete(product.id, product.name)}
                                                    className="min-w-11 min-h-11 px-3 rounded-xl bg-red-50 hover:bg-red-100 text-red-600 transition-colors"
                                                    title="Delete item"
                                                >
                                                    <Trash2 className="w-4 h-4" />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* ── Add / Edit Modal ────────────────────────────────────────────── */}
            {isModalOpen && (
                <div className="modal-backdrop z-50 bg-coffee-900/40 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="bg-cream-50 border border-cream-300 rounded-3xl shadow-warm-lg w-full max-w-lg overflow-hidden flex flex-col">
                        <div className="flex items-center justify-between px-7 py-5 bg-white border-b border-cream-200">
                            <h2 className="text-xl font-extrabold text-coffee-800 tracking-tight">
                                {editingProduct ? 'Edit Menu Item' : 'Add New Menu Item'}
                            </h2>
                            <button
                                onClick={() => setIsModalOpen(false)}
                                className="p-2 rounded-xl text-coffee-400 hover:text-coffee-700 hover:bg-cream-200 transition-colors"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        <form onSubmit={handleSubmit} className="p-7 space-y-5">
                            {formError && (
                                <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs font-semibold text-red-700 flex items-center gap-2">
                                    <AlertCircle className="w-4 h-4 shrink-0 text-red-500" />
                                    <span>{formError}</span>
                                </div>
                            )}

                            <div>
                                <label className="block text-xs font-bold text-coffee-600 uppercase tracking-wider mb-1.5">
                                    Item Name
                                </label>
                                <input
                                    type="text"
                                    required
                                    placeholder="e.g. Special Peshawari Kehwa"
                                    value={formData.name}
                                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                    className="cafe-input"
                                />
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-coffee-600 uppercase tracking-wider mb-1.5">
                                    Category
                                </label>
                                <input
                                    type="text"
                                    required
                                    placeholder="e.g. Chai & Hot Drinks, Fast Food & Snacks..."
                                    value={formData.category}
                                    onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                                    className="cafe-input"
                                />
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-coffee-600 uppercase tracking-wider mb-1.5">Variant / Serving (optional)</label>
                                <input type="text" maxLength={40} placeholder="e.g. 250 ml, 1 Litre, 1 Pound" value={formData.variant} onChange={e => setFormData({ ...formData, variant: e.target.value })} className="cafe-input" />
                            </div>

                            <section className="space-y-3 rounded-xl border border-cream-300 bg-white p-4">
                                <div className="flex items-center justify-between gap-3">
                                    <div>
                                        <h3 className="text-xs font-black uppercase text-coffee-700">Recipe / Bill of Materials</h3>
                                        <p className="mt-1 text-[11px] font-medium text-coffee-400">Required raw-material usage per one sellable unit.</p>
                                    </div>
                                    <button type="button" disabled={recipeIngredientsLoading || recipeIngredients.length === 0} onClick={() => setRecipeDrafts([...recipeDrafts, { ingredientId: '', quantityBaseUnits: '' }])} className="flex shrink-0 items-center gap-1 rounded-lg border border-cream-300 px-3 py-2 text-xs font-bold text-coffee-700 hover:bg-cream-100 disabled:opacity-40"><Plus className="h-3.5 w-3.5" />Add line</button>
                                </div>
                                {recipesLoading && <p className="text-xs font-semibold text-coffee-500">Loading recipe...</p>}
                                {!recipeIngredientsLoading && recipeIngredients.length === 0 && <p className="rounded-lg bg-cream-100 p-3 text-xs font-medium text-coffee-500">Add raw materials in the Inventory tab before saving this sellable item.</p>}
                                {!recipesLoading && recipeDrafts.map((draft, index) => {
                                    const selectedIngredient = recipeIngredients.find(ingredient => ingredient.id === Number(draft.ingredientId));
                                    const recipeUnit = selectedIngredient?.unit_type === 'weight' ? 'g' : selectedIngredient?.unit_type === 'volume' ? 'mL' : selectedIngredient?.unit_type === 'count' ? 'each' : 'base units';
                                    return <div key={`${index}-${draft.ingredientId}`} className="grid grid-cols-[minmax(0,1fr)_minmax(7rem,0.65fr)_2.5rem] items-end gap-2">
                                        <label className="min-w-0 text-[10px] font-bold uppercase text-coffee-500">Ingredient
                                            <select value={draft.ingredientId} onChange={event => setRecipeDrafts(recipeDrafts.map((line, lineIndex) => lineIndex === index ? { ...line, ingredientId: event.target.value } : line))} className="cafe-input mt-1 text-xs normal-case" required>
                                                <option value="">Select ingredient</option>
                                                {recipeIngredients.map(ingredient => <option key={ingredient.id} value={ingredient.id}>{ingredient.name} ({ingredient.unit_type === 'weight' ? 'g' : ingredient.unit_type === 'volume' ? 'mL' : 'each'})</option>)}
                                            </select>
                                        </label>
                                        <label className="min-w-0 text-[10px] font-bold uppercase text-coffee-500">Usage / unit ({recipeUnit})
                                            <input type="number" min="1" step="1" required value={draft.quantityBaseUnits} onChange={event => setRecipeDrafts(recipeDrafts.map((line, lineIndex) => lineIndex === index ? { ...line, quantityBaseUnits: event.target.value } : line))} className="cafe-input mt-1 text-xs normal-case" placeholder="e.g. 18" />
                                        </label>
                                        <button type="button" title="Remove recipe line" aria-label="Remove recipe line" onClick={() => setRecipeDrafts(recipeDrafts.filter((_, lineIndex) => lineIndex !== index))} className="mb-0.5 flex h-10 w-10 items-center justify-center rounded-lg bg-red-50 text-red-700 hover:bg-red-100"><Trash2 className="h-4 w-4" /></button>
                                    </div>;
                                })}
                            </section>

                            <div>
                                <div>
                                    <label className="block text-xs font-bold text-coffee-600 uppercase tracking-wider mb-1.5">
                                        Price (PKR / Rs.)
                                    </label>
                                    <input
                                        type="number"
                                        step="1"
                                        min="1"
                                        required
                                        placeholder="e.g. 150"
                                        value={formData.price}
                                        onChange={(e) => setFormData({ ...formData, price: e.target.value })}
                                        className="cafe-input"
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-coffee-600 uppercase tracking-wider mb-1.5">Unit Cost (PKR, optional)</label>
                                <input type="number" step="0.01" min="0" value={formData.cost_price} onChange={e => setFormData({ ...formData, cost_price: e.target.value })} className="cafe-input" placeholder="Leave blank if unknown" />
                            </div>

                            <div className="flex justify-end gap-3 pt-4 border-t border-cream-200">
                                {!adminGrant && <button type="button" onClick={() => requireAdminPin(editingProduct ? 'menu:update' : 'menu:add', grant => setAdminGrant(grant))} className="mr-auto rounded-xl border border-amber-300 bg-amber-50 px-4 py-2.5 text-xs font-bold text-amber-900 hover:bg-amber-100">Re-verify Admin PIN</button>}
                                <button
                                    type="button"
                                    onClick={() => { setIsModalOpen(false); setAdminGrant(null); }}
                                    className="px-5 py-2.5 bg-white border border-cream-300 hover:bg-cream-100 text-coffee-700 font-semibold rounded-xl text-sm transition-colors"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={recipesLoading}
                                    className="px-6 py-2.5 bg-coffee-700 hover:bg-coffee-800 text-white font-extrabold rounded-xl text-sm transition-colors shadow-warm flex items-center gap-2"
                                >
                                    <Check className="w-4 h-4" />
                                    <span>{editingProduct ? 'Save Changes' : 'Create Item'}</span>
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
            <AdminPinModal
                isOpen={adminPinOpen}
                sessionToken={session.sessionToken}
                scope={adminPinScope}
                title="Menu Change Authorization"
                description="Verify an Admin or Manager PIN before adding, editing, or removing menu and inventory items."
                actionLabel="Authorize Menu Change"
                onSuccess={(grant) => {
                    const action = pendingAction.current;
                    pendingAction.current = null;
                    action?.(grant);
                }}
                onClose={() => setAdminPinOpen(false)}
            />
        </div>
    );
};
