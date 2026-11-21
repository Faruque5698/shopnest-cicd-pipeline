export function addItemToCart(cart, product) {
  const existing = cart.find((item) => item.id === product.id);
  if (existing) {
    return cart.map((item) =>
      item.id === product.id ? { ...item, quantity: item.quantity + 1 } : item
    );
  }
  return [
    ...cart,
    {
      id: product.id,
      name: product.name,
      price: Number(product.price),
      image_emoji: product.image_emoji || '📦',
      quantity: 1
    }
  ];
}

export function removeItemFromCart(cart, productId) {
  return cart
    .map((item) =>
      item.id === productId ? { ...item, quantity: item.quantity - 1 } : item
    )
    .filter((item) => item.quantity > 0);
}

export function calculateCartTotals(cart) {
  const itemCount = cart.reduce((sum, item) => sum + item.quantity, 0);
  const subtotal = Number(
    cart.reduce((sum, item) => sum + Number(item.price) * item.quantity, 0).toFixed(2)
  );
  const tax = Number((subtotal * 0.05).toFixed(2));
  const total = Number((subtotal + tax).toFixed(2));
  return { itemCount, subtotal, tax, total };
}

export function formatCurrency(amount) {
  return `$${Number(amount).toFixed(2)}`;
}
