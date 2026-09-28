import React, { useState, useEffect, useMemo } from 'react';
import { Product } from '../../../types/pos';
import { AuthSession } from '../../../types/auth';
import { PosLoader } from '../components/PosLoader';
import { PosToast } from '../components/PosToast';
import {
  ClipboardList, Plus, Search, Edit3, Trash2,
  X, Check, AlertCircle, Sparkles, Filter, Store, Package
} from 'lucide-react';

interface Props {
  session: AuthSession;
  onMenuUpdated?: () => void;
}

export const MenuManagementPage: React.FC<Props> = ({ session, onMenuUpdated }) => {
  const [products, setProducts] = useState<Product[]>([]);
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
    stock: '100',
    variant: '',
  });
  const [formError, setFormError] = useState('');
  const [notice, setNotice] = useState<{ message: string; tone: 'success' | 'error' } | null>(null);

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

  useEffect(() => {
    loadProducts();
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
    setEditingProduct(null);
    setFormData({
      name: '',
      category: categories[1] || 'Chai & Hot Drinks',
      price: '',
      stock: '100',
      variant: '',
    });
    setFormError('');
    setIsModalOpen(true);
  };

  const handleOpenEditModal = (product: Product) => {
    setEditingProduct(product);
    setFormData({
      name: product.name,
      category: product.category,
      price: String(product.price),
      stock: String(product.stock),
      variant: product.variant || '',
    });
    setFormError('');
    setIsModalOpen(true);
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
    const stockNum = parseInt(formData.stock, 10);

    try {
      if (editingProduct) {
        // Update product
        if (window.api) {
          await window.api.updateProduct(editingProduct.id, {
            name: formData.name.trim(),
            category: formData.category,
            price: priceNum,
            stock: isNaN(stockNum) ? 100 : stockNum,
            variant: formData.variant.trim() || null,
          }, session.sessionToken);
        } else {
          throw new Error('Menu management is available only in the desktop app.');
        }
      } else {
        // Add product
        if (window.api) {
          await window.api.addProduct({
            name: formData.name.trim(),
            category: formData.category,
            price: priceNum,
            stock: isNaN(stockNum) ? 100 : stockNum,
            variant: formData.variant.trim() || null,
          }, session.sessionToken);
        } else { throw new Error('Menu management is available only in the desktop app.');
        }
      }

      setIsModalOpen(false);
      await loadProducts();
      if (onMenuUpdated) onMenuUpdated();
    } catch (err: any) {
      setFormError('Failed to save product: ' + err.message);
    }
  };

  const handleDelete = async (id: number, name: string) => {
    if (!window.confirm(`Are you sure you want to remove "${name}" from the menu?`)) {
      return;
    }
    try {
      if (window.api) {
        await window.api.deleteProduct(id, session.sessionToken);
      } else {
        setProducts(prev => prev.filter(p => p.id !== id));
      }
      await loadProducts();
      if (onMenuUpdated) onMenuUpdated();
    } catch (err: any) {
      setNotice({ tone: 'error', message: 'This menu item could not be removed. Refresh the menu and try again.' });
    }
  };

  return (
    <div className="relative flex-1 overflow-y-auto bg-cream-100 p-5 space-y-4 select-none">
      {notice && <PosToast message={notice.message} tone={notice.tone} onDismiss={() => setNotice(null)} />}
      {loading && <PosLoader overlay message="Syncing local menu records..."/>}
      {/* ── Page Header ─────────────────────────────────────────────────── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-4 rounded-2xl border border-cream-200 shadow-warm-sm">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-coffee-700 text-cream-50 flex items-center justify-center shadow-warm">
            <ClipboardList className="w-7 h-7" />
          </div>
          <div>
            <h1 className="text-2xl font-black text-coffee-800 tracking-tight">Menu & Pricing Management</h1>
            <p className="text-sm text-coffee-400 mt-0.5">Add, edit, and organize cafe items in PKR with instant SQLite sync</p>
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
                className={`px-4 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-all flex items-center gap-2 ${
                  isSelected
                    ? 'bg-coffee-700 text-white shadow-warm'
                    : 'bg-cream-50 hover:bg-cream-100 text-coffee-600 border border-cream-200'
                }`}
              >
                <span>{cat}</span>
                <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono ${
                  isSelected ? 'bg-black/20 text-white' : 'bg-cream-200 text-coffee-500'
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
                <th className="py-2.5 px-4">Stock Level</th>
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
                    <td className="py-2 px-4 font-medium text-coffee-600">
                      <span className={`inline-flex items-center gap-1.5 text-xs font-bold ${
                        product.stock <= 20 ? 'text-amber-700' : 'text-emerald-700'
                      }`}>
                        <span className={`w-2 h-2 rounded-full ${
                          product.stock <= 20 ? 'bg-amber-500' : 'bg-emerald-500'
                        }`} />
                        {product.stock} available
                      </span>
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

              <div className="grid grid-cols-2 gap-4">
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

                <div>
                  <label className="block text-xs font-bold text-coffee-600 uppercase tracking-wider mb-1.5">
                    Stock Inventory
                  </label>
                  <input
                    type="number"
                    step="1"
                    min="0"
                    placeholder="e.g. 100"
                    value={formData.stock}
                    onChange={(e) => setFormData({ ...formData, stock: e.target.value })}
                    className="cafe-input"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-cream-200">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-5 py-2.5 bg-white border border-cream-300 hover:bg-cream-100 text-coffee-700 font-semibold rounded-xl text-sm transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
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
    </div>
  );
};
