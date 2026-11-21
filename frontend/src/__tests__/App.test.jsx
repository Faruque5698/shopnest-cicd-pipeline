import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import App from '../App.jsx';

describe('ShopNest Frontend App', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn((url) => {
      if (url.includes('/api/products')) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              products: [
                {
                  id: 1,
                  name: 'Mechanical Keyboard Pro',
                  description: 'Tactile RGB keyboard',
                  category: 'Electronics',
                  price: '89.99',
                  stock: 12,
                  image_emoji: '⌨️'
                }
              ]
            })
        });
      }
      if (url.includes('/api/health')) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              status: 'healthy',
              database: 'connected',
              environment: 'staging',
              slot: 'blue',
              shortCommit: 'a1b2c3d'
            })
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders storefront, live health badges, and products from API', async () => {
    render(<App />);

    expect(screen.getByText('ShopNest')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('Mechanical Keyboard Pro')).toBeInTheDocument();
    });

    expect(screen.getByText(/API & DB Healthy/i)).toBeInTheDocument();
    expect(screen.getByText(/Commit: #a1b2c3d/i)).toBeInTheDocument();
  });

  it('allows adding a product to the shopping cart', async () => {
    render(<App />);

    const addButton = await screen.findByRole('button', { name: /Add to Cart/i });
    fireEvent.click(addButton);

    expect(screen.getByText('Subtotal')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Place Order/i })).toBeInTheDocument();
  });
});
