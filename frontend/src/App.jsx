import { useEffect, useState } from 'react';
import {
  addItemToCart,
  removeItemFromCart,
  calculateCartTotals,
  formatCurrency
} from './utils/cart.js';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

export default function App() {
  const [products, setProducts] = useState([]);
  const [health, setHealth] = useState(null);
  const [cart, setCart] = useState([]);
  const [customerName, setCustomerName] = useState('');
  const [orderMessage, setOrderMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let active = true;

    async function loadStoreData() {
      try {
        const [prodRes, healthRes] = await Promise.all([
          fetch(`${API_BASE}/api/products`),
          fetch(`${API_BASE}/api/health`)
        ]);

        if (!prodRes.ok) {
          throw new Error('Could not load products from API');
        }
        const prodData = await prodRes.json();
        const healthData = healthRes.ok ? await healthRes.json() : null;

        if (active) {
          setProducts(prodData.products || []);
          setHealth(healthData);
          setErrorMessage('');
        }
      } catch (err) {
        if (active) {
          setErrorMessage(err.message || 'Failed to connect to ShopNest API');
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    loadStoreData();
    return () => {
      active = false;
    };
  }, []);

  const totals = calculateCartTotals(cart);

  function handleAddToCart(product) {
    setOrderMessage('');
    setCart((prev) => addItemToCart(prev, product));
  }

  function handleRemoveFromCart(productId) {
    setCart((prev) => removeItemFromCart(prev, productId));
  }

  async function handleCheckout(event) {
    event.preventDefault();
    if (!customerName.trim() || cart.length === 0) return;

    setSubmitting(true);
    setOrderMessage('');
    setErrorMessage('');

    try {
      const res = await fetch(`${API_BASE}/api/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerName: customerName.trim(),
          items: cart
        })
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Checkout failed');
      }
      setCart([]);
      setCustomerName('');
      setOrderMessage(
        `Order #${data.order.id} confirmed for ${data.order.customer_name} (${formatCurrency(data.order.total)})!`
      );
    } catch (err) {
      setErrorMessage(err.message || 'Unable to place order');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="app-shell">
      <header className="navbar">
        <div className="brand">
          <span className="brand-icon" aria-hidden="true">🛍️</span>
          <div>
            <h1>ShopNest</h1>
            <p className="tagline">Zero-Downtime Three-Tier E-Commerce Platform</p>
          </div>
        </div>

        <div className="status-badges">
          <span className={`badge ${health?.status === 'healthy' ? 'badge-healthy' : 'badge-warn'}`}>
            ● {health?.status === 'healthy' ? 'API & DB Healthy' : 'Checking Health'}
          </span>
          {health?.environment && (
            <span className="badge badge-env">Env: {health.environment}</span>
          )}
          {health?.slot && (
            <span className={`badge badge-slot-${health.slot}`}>Slot: {health.slot}</span>
          )}
          {health?.shortCommit && (
            <span className="badge badge-commit">Commit: #{health.shortCommit}</span>
          )}
        </div>
      </header>

      <main className="main-grid">
        <section className="catalog-section" aria-label="Product Catalog">
          <div className="section-header">
            <h2>Featured Products</h2>
            <span className="count-pill">{products.length} items</span>
          </div>

          {errorMessage && <div className="alert alert-error" role="alert">{errorMessage}</div>}
          {orderMessage && <div className="alert alert-success" role="status">{orderMessage}</div>}

          {loading ? (
            <p className="muted">Loading ShopNest catalog...</p>
          ) : (
            <div className="product-grid">
              {products.map((product) => (
                <article className="product-card" key={product.id}>
                  <div className="product-emoji" aria-hidden="true">
                    {product.image_emoji || '📦'}
                  </div>
                  <span className="product-category">{product.category}</span>
                  <h3>{product.name}</h3>
                  <p className="product-desc">{product.description}</p>
                  <div className="product-footer">
                    <div>
                      <strong className="price">{formatCurrency(product.price)}</strong>
                      <span className="stock">{product.stock} in stock</span>
                    </div>
                    <button
                      type="button"
                      className="btn-primary"
                      onClick={() => handleAddToCart(product)}
                    >
                      Add to Cart
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>

        <aside className="cart-panel" aria-label="Shopping Cart">
          <div className="section-header">
            <h2>Your Cart</h2>
            <span className="count-pill">{totals.itemCount} items</span>
          </div>

          {cart.length === 0 ? (
            <p className="muted">Your cart is empty. Add products from the catalog to test live PostgreSQL orders.</p>
          ) : (
            <>
              <ul className="cart-list">
                {cart.map((item) => (
                  <li className="cart-item" key={item.id}>
                    <div>
                      <strong>{item.image_emoji} {item.name}</strong>
                      <p className="muted">
                        {formatCurrency(item.price)} × {item.quantity}
                      </p>
                    </div>
                    <button
                      type="button"
                      className="btn-ghost"
                      onClick={() => handleRemoveFromCart(item.id)}
                      aria-label={`Remove one ${item.name}`}
                    >
                      −
                    </button>
                  </li>
                ))}
              </ul>

              <div className="totals-box">
                <div className="totals-row">
                  <span>Subtotal</span>
                  <span>{formatCurrency(totals.subtotal)}</span>
                </div>
                <div className="totals-row">
                  <span>Tax (5%)</span>
                  <span>{formatCurrency(totals.tax)}</span>
                </div>
                <div className="totals-row totals-grand">
                  <span>Total</span>
                  <span>{formatCurrency(totals.total)}</span>
                </div>
              </div>

              <form className="checkout-form" onSubmit={handleCheckout}>
                <label htmlFor="customer-name">Customer Name</label>
                <input
                  id="customer-name"
                  type="text"
                  placeholder="Enter your name"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  required
                />
                <button type="submit" className="btn-checkout" disabled={submitting}>
                  {submitting ? 'Placing Order...' : `Place Order (${formatCurrency(totals.total)})`}
                </button>
              </form>
            </>
          )}
        </aside>
      </main>

      <footer className="footer">
        <span>ShopNest Automated CI/CD Pipeline · Presentation + API + Private PostgreSQL</span>
        {health?.deployedAt && <span>Deployed: {health.deployedAt}</span>}
      </footer>
    </div>
  );
}
