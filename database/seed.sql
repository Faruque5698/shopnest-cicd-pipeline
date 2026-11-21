-- ShopNest Initial Seed Data (Idempotent: only inserts when products table is empty)

INSERT INTO products (name, description, category, price, stock, image_emoji)
SELECT * FROM (
    VALUES
        ('Mechanical Keyboard Pro', 'Tactile hot-swappable RGB keyboard built for developers.', 'Electronics', 89.99, 24, '⌨️'),
        ('Noise-Cancelling Headphones', 'Over-ear wireless studio headphones with 40h battery life.', 'Audio', 149.50, 15, '🎧'),
        ('Ergonomic Desk Lamp', 'Adjustable warm-to-cool LED task lamp with USB-C port.', 'Workspace', 42.00, 38, '💡'),
        ('Insulated Travel Tumbler', 'Double-wall stainless steel coffee mug that stays hot for 8h.', 'Lifestyle', 24.99, 50, '☕'),
        ('USB-C Multiport Hub', '7-in-1 aluminum adapter with 4K HDMI and 100W power delivery.', 'Accessories', 39.00, 31, '🔌'),
        ('Laptop Backpack 22L', 'Water-resistant commuter backpack with padded 16-inch sleeve.', 'Accessories', 64.00, 19, '🎒')
) AS seed(name, description, category, price, stock, image_emoji)
WHERE NOT EXISTS (SELECT 1 FROM products LIMIT 1);
