import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp, calculateOrderTotals } from '../app.js';

describe('ShopNest Backend API', () => {
  let mockPool;
  let app;

  beforeEach(() => {
    mockPool = {
      query: vi.fn()
    };
    process.env.GIT_COMMIT_SHA = 'abcdef1234567890';
    process.env.APP_ENV = 'test';
    process.env.APP_SLOT = 'blue';
    app = createApp(mockPool);
  });

  describe('GET /api/health', () => {
    it('returns 200 and connected status when database responds', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [{ ok: 1 }] });

      const res = await request(app).get('/api/health');

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('healthy');
      expect(res.body.database).toBe('connected');
      expect(res.body.shortCommit).toBe('abcdef1');
      expect(res.body.slot).toBe('blue');
    });

    it('returns 503 when database connection fails', async () => {
      mockPool.query.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      const res = await request(app).get('/api/health');

      expect(res.status).toBe(503);
      expect(res.body.status).toBe('unhealthy');
      expect(res.body.database).toBe('error');
    });
  });

  describe('GET /api/version', () => {
    it('exposes deployment commit metadata for traceability', async () => {
      const res = await request(app).get('/api/version');

      expect(res.status).toBe(200);
      expect(res.body.service).toBe('shopnest-api');
      expect(res.body.commit).toBe('abcdef1234567890');
      expect(res.body.shortCommit).toBe('abcdef1');
      expect(res.body.environment).toBe('test');
    });
  });

  describe('Products API', () => {
    it('lists products from the database', async () => {
      const sampleProducts = [
        { id: 1, name: 'Keyboard', price: '89.99', category: 'Electronics', stock: 10 }
      ];
      mockPool.query.mockResolvedValueOnce({ rows: sampleProducts });

      const res = await request(app).get('/api/products');

      expect(res.status).toBe(200);
      expect(res.body.products).toEqual(sampleProducts);
    });

    it('creates a product when payload is valid', async () => {
      const created = {
        id: 2,
        name: 'Wireless Mouse',
        description: 'Silent clicks',
        category: 'Electronics',
        price: '29.99',
        stock: 15,
        image_emoji: '🖱️'
      };
      mockPool.query.mockResolvedValueOnce({ rows: [created] });

      const res = await request(app).post('/api/products').send({
        name: 'Wireless Mouse',
        description: 'Silent clicks',
        category: 'Electronics',
        price: 29.99,
        stock: 15,
        image_emoji: '🖱️'
      });

      expect(res.status).toBe(201);
      expect(res.body.product.name).toBe('Wireless Mouse');
    });

    it('rejects a product with negative price', async () => {
      const res = await request(app).post('/api/products').send({
        name: 'Broken Item',
        price: -10,
        stock: 5
      });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/non-negative/i);
      expect(mockPool.query).not.toHaveBeenCalled();
    });
  });

  describe('Orders API & Total Calculations', () => {
    it('calculates subtotal, 5% tax, and total accurately', () => {
      const totals = calculateOrderTotals([
        { name: 'Lamp', price: 40, quantity: 2 },
        { name: 'Mug', price: 20, quantity: 1 }
      ]);

      expect(totals).toEqual({ subtotal: 100, tax: 5, total: 105 });
    });

    it('places a valid order and returns 201', async () => {
      const savedOrder = {
        id: 1,
        customer_name: 'Arafat',
        items: [{ name: 'Lamp', price: 40, quantity: 1 }],
        subtotal: '40.00',
        tax: '2.00',
        total: '42.00',
        status: 'confirmed'
      };
      mockPool.query.mockResolvedValueOnce({ rows: [savedOrder] });

      const res = await request(app).post('/api/orders').send({
        customerName: 'Arafat',
        items: [{ name: 'Lamp', price: 40, quantity: 1 }]
      });

      expect(res.status).toBe(201);
      expect(res.body.order.status).toBe('confirmed');
    });

    it('rejects an empty cart order', async () => {
      const res = await request(app).post('/api/orders').send({
        customerName: 'Arafat',
        items: []
      });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/at least one item/i);
    });
  });
});
