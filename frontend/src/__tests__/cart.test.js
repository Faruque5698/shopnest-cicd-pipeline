import { describe, it, expect } from 'vitest';
import {
  addItemToCart,
  removeItemFromCart,
  calculateCartTotals,
  formatCurrency
} from '../utils/cart.js';

describe('Cart Utility Functions', () => {
  const keyboard = { id: 1, name: 'Keyboard', price: 80, image_emoji: '⌨️' };
  const mug = { id: 2, name: 'Coffee Mug', price: 20, image_emoji: '☕' };

  it('adds a new product and increments quantity on repeat add', () => {
    const first = addItemToCart([], keyboard);
    expect(first).toHaveLength(1);
    expect(first[0].quantity).toBe(1);

    const second = addItemToCart(first, keyboard);
    expect(second).toHaveLength(1);
    expect(second[0].quantity).toBe(2);
  });

  it('decrements quantity and removes product when quantity reaches zero', () => {
    const cart = [
      { ...keyboard, quantity: 2 },
      { ...mug, quantity: 1 }
    ];
    const afterOne = removeItemFromCart(cart, keyboard.id);
    expect(afterOne.find((i) => i.id === keyboard.id).quantity).toBe(1);

    const afterRemoveMug = removeItemFromCart(afterOne, mug.id);
    expect(afterRemoveMug).toHaveLength(1);
  });

  it('calculates itemCount, subtotal, 5% tax, and grand total', () => {
    const cart = [
      { ...keyboard, quantity: 1 },
      { ...mug, quantity: 1 }
    ];
    expect(calculateCartTotals(cart)).toEqual({
      itemCount: 2,
      subtotal: 100,
      tax: 5,
      total: 105
    });
  });

  it('formats currency with two decimal places', () => {
    expect(formatCurrency(42)).toBe('$42.00');
    expect(formatCurrency(19.9)).toBe('$19.90');
  });
});
