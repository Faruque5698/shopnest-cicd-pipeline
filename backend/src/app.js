import express from 'express';
import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkDbHealth } from './config/db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function readBuildInfo() {
  const candidates = [
    path.resolve(__dirname, '../build-info.json'),
    path.resolve(__dirname, '../dist/build-info.json')
  ];
  for (const filePath of candidates) {
    if (fs.existsSync(filePath)) {
      try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
      } catch {
        return null;
      }
    }
  }
  return null;
}

export function calculateOrderTotals(items) {
  const subtotal = Number(
    items.reduce((sum, item) => sum + Number(item.price) * Number(item.quantity), 0).toFixed(2)
  );
  const tax = Number((subtotal * 0.05).toFixed(2));
  const total = Number((subtotal + tax).toFixed(2));
  return { subtotal, tax, total };
}

export function createApp(pool) {
  const app = express();
  const buildInfo = readBuildInfo();

  app.use(cors());
  app.use(express.json());

  const getVersionMeta = () => {
    const commit = process.env.GIT_COMMIT_SHA || buildInfo?.commitSha || 'local-dev';
    return {
      service: 'shopnest-api',
      version: buildInfo?.version || '1.0.0',
      commit,
      shortCommit: commit.slice(0, 7),
      environment: process.env.APP_ENV || 'development',
      slot: process.env.APP_SLOT || 'local',
      builtAt: buildInfo?.builtAt || null,
      deployedAt: process.env.DEPLOYED_AT || null
    };
  };

  // Health check endpoint used by CD pipeline and monitoring
  app.get('/api/health', async (_req, res) => {
    const meta = getVersionMeta();
    try {
      const dbOk = await checkDbHealth(pool);
      if (!dbOk) {
        return res.status(503).json({
          status: 'unhealthy',
          database: 'disconnected',
          ...meta
        });
      }
      return res.status(200).json({
        status: 'healthy',
        database: 'connected',
        uptimeSeconds: Math.floor(process.uptime()),
        ...meta
      });
    } catch (error) {
      return res.status(503).json({
        status: 'unhealthy',
        database: 'error',
        error: error.message,
        ...meta
      });
    }
  });

  // Deployment traceability endpoint
  app.get('/api/version', (_req, res) => {
    res.status(200).json(getVersionMeta());
  });

  // List all products
  app.get('/api/products', async (_req, res) => {
    try {
      const result = await pool.query(
        'SELECT id, name, description, category, price, stock, image_emoji, created_at FROM products ORDER BY id ASC'
      );
      res.status(200).json({ products: result.rows });
    } catch (error) {
      res.status(500).json({ error: 'Failed to load products', detail: error.message });
    }
  });

  // Create a new product
  app.post('/api/products', async (req, res) => {
    const { name, description = '', category = 'General', price, stock = 10, image_emoji = '📦' } =
      req.body || {};

    if (!name || typeof name !== 'string' || name.trim().length < 2) {
      return res.status(400).json({ error: 'Product name must be at least 2 characters.' });
    }
    const numericPrice = Number(price);
    const numericStock = Number(stock);
    if (Number.isNaN(numericPrice) || numericPrice < 0) {
      return res.status(400).json({ error: 'Product price must be a non-negative number.' });
    }
    if (!Number.isInteger(numericStock) || numericStock < 0) {
      return res.status(400).json({ error: 'Product stock must be a non-negative integer.' });
    }

    try {
      const result = await pool.query(
        `INSERT INTO products (name, description, category, price, stock, image_emoji)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, name, description, category, price, stock, image_emoji, created_at`,
        [name.trim(), description.trim(), category.trim(), numericPrice, numericStock, image_emoji]
      );
      return res.status(201).json({ product: result.rows[0] });
    } catch (error) {
      return res.status(500).json({ error: 'Failed to create product', detail: error.message });
    }
  });

  // List recent orders
  app.get('/api/orders', async (_req, res) => {
    try {
      const result = await pool.query(
        'SELECT id, customer_name, items, subtotal, tax, total, status, created_at FROM orders ORDER BY id DESC LIMIT 20'
      );
      res.status(200).json({ orders: result.rows });
    } catch (error) {
      res.status(500).json({ error: 'Failed to load orders', detail: error.message });
    }
  });

  // Place a new order
  app.post('/api/orders', async (req, res) => {
    const { customerName, items } = req.body || {};
    if (!customerName || typeof customerName !== 'string' || customerName.trim().length < 2) {
      return res.status(400).json({ error: 'Customer name is required.' });
    }
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Order must contain at least one item.' });
    }

    for (const item of items) {
      if (!item.name || Number(item.price) < 0 || Number(item.quantity) <= 0) {
        return res.status(400).json({ error: 'Each order item must have valid name, price, and quantity.' });
      }
    }

    const { subtotal, tax, total } = calculateOrderTotals(items);

    try {
      const result = await pool.query(
        `INSERT INTO orders (customer_name, items, subtotal, tax, total, status)
         VALUES ($1, $2::jsonb, $3, $4, $5, 'confirmed')
         RETURNING id, customer_name, items, subtotal, tax, total, status, created_at`,
        [customerName.trim(), JSON.stringify(items), subtotal, tax, total]
      );
      return res.status(201).json({ order: result.rows[0] });
    } catch (error) {
      return res.status(500).json({ error: 'Failed to place order', detail: error.message });
    }
  });

  return app;
}
