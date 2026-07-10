import prisma from '../config/database.js';

export const getCart = async (req, res, next) => {
  try {
    const cart = await prisma.cart.findUnique({
      where: { userId: req.user.id },
      include: {
        items: {
          include: {
            product: {
              include: {
                images: { orderBy: { order: 'asc' } },
                stock: true,
              },
            },
          },
        },
      },
    });
    
    if (!cart) {
      return res.json({ items: [], subtotal: 0, discount: 0, total: 0 });
    }
    
    res.json(cart);
  } catch (error) {
    next(error);
  }
};

export const addToCart = async (req, res, next) => {
  try {
    const { productId, quantity } = req.body;
    
    // Get product
    const product = await prisma.product.findUnique({
      where: { id: productId },
      include: { stock: true },
    });
    
    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }
    
    if (!product.isActive) {
      return res.status(400).json({ error: 'Product is not available' });
    }
    
    if (product.stock.quantity < quantity) {
      return res.status(400).json({ error: 'Insufficient stock' });
    }
    
    // Get or create cart
    let cart = await prisma.cart.findUnique({
      where: { userId: req.user.id },
    });
    
    if (!cart) {
      cart = await prisma.cart.create({
        data: { userId: req.user.id },
      });
    }
    
    // Check if item already exists in cart
    const existingItem = await prisma.cartItem.findUnique({
      where: {
        cartId_productId: {
          cartId: cart.id,
          productId,
        },
      },
    });
    
    if (existingItem) {
      // Update quantity
      const updatedItem = await prisma.cartItem.update({
        where: { id: existingItem.id },
        data: {
          quantity: existingItem.quantity + quantity,
          price: product.price,
        },
      });
      
      await recalculateCart(cart.id);
    } else {
      // Add new item
      await prisma.cartItem.create({
        data: {
          cartId: cart.id,
          productId,
          quantity,
          price: product.price,
        },
      });
      
      await recalculateCart(cart.id);
    }
    
    const updatedCart = await prisma.cart.findUnique({
      where: { id: cart.id },
      include: {
        items: {
          include: {
            product: {
              include: {
                images: { orderBy: { order: 'asc' } },
                stock: true,
              },
            },
          },
        },
      },
    });
    
    res.json(updatedCart);
  } catch (error) {
    next(error);
  }
};

export const updateCartItem = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { quantity } = req.body;
    
    const cartItem = await prisma.cartItem.findUnique({
      where: { id },
      include: { cart: true, product: { include: { stock: true } } },
    });
    
   if (!cartItem) {
      return res.status(404).json({ error: 'Cart item not found' });
    }
    
    if (cartItem.cart.userId !== req.user.id) {
      return res.status(403).json({ error: 'Not authorized' });
    }
    
    if (quantity > cartItem.product.stock.quantity) {
      return res.status(400).json({ error: 'Insufficient stock' });
    }
    
    if (quantity === 0) {
      await prisma.cartItem.delete({ where: { id } });
    } else {
      await prisma.cartItem.update({
        where: { id },
        data: { quantity },
      });
    }
    
    await recalculateCart(cartItem.cartId);
    
    const cart = await prisma.cart.findUnique({
      where: { id: cartItem.cartId },
      include: {
        items: {
          include: {
            product: {
              include: {
                images: { orderBy: { order: 'asc' } },
                stock: true,
              },
            },
          },
        },
      },
    });
    
    res.json(cart);
  } catch (error) {
    next(error);
  }
};

export const removeCartItem = async (req, res, next) => {
  try {
    const { id } = req.params;
    
    const cartItem = await prisma.cartItem.findUnique({
      where: { id },
      include: { cart: true },
    });
    
    if (!cartItem) {
      return res.status(404).json({ error: 'Cart item not found' });
    }
    
    if (cartItem.cart.userId !== req.user.id) {
      return res.status(403).json({ error: 'Not authorized' });
    }
    
    await prisma.cartItem.delete({ where: { id } });
    await recalculateCart(cartItem.cartId);
    
    const cart = await prisma.cart.findUnique({
      where: { id: cartItem.cartId },
      include: {
        items: {
          include: {
            product: {
              include: {
                images: { orderBy: { order: 'asc' } },
                stock: true,
              },
            },
          },
        },
      },
    });
    
    res.json(cart);
  } catch (error) {
    next(error);
  }
};

export const clearCart = async (req, res, next) => {
  try {
    const cart = await prisma.cart.findUnique({
      where: { userId: req.user.id },
    });
    
    if (!cart) {
      return res.json({ items: [], subtotal: 0, discount: 0, total: 0 });
    }
    
    await prisma.cartItem.deleteMany({
      where: { cartId: cart.id },
    });
    
    await recalculateCart(cart.id);
    
    const updatedCart = await prisma.cart.findUnique({
      where: { id: cart.id },
      include: {
        items: {
          include: {
            product: {
              include: {
                images: { orderBy: { order: 'asc' } },
                stock: true,
              },
            },
          },
        },
      },
    });
    
    res.json(updatedCart);
  } catch (error) {
    next(error);
  }
};

export const applyCoupon = async (req, res, next) => {
  try {
    const { couponCode } = req.body;
    
    if (couponCode !== 'IKOKITU') {
      return res.status(400).json({ error: 'Invalid coupon code' });
    }
    
    const cart = await prisma.cart.findUnique({
      where: { userId: req.user.id },
      include: { items: true },
    });
    
    if (!cart) {
      return res.status(404).json({ error: 'Cart not found' });
    }
    
    // Apply 10% discount
    const discount = cart.subtotal * 0.1;
    
    await prisma.cart.update({
      where: { id: cart.id },
      data: {
        couponCode,
        discount,
        total: cart.subtotal - discount,
      },
    });
    
    const updatedCart = await prisma.cart.findUnique({
      where: { id: cart.id },
      include: {
        items: {
          include: {
            product: {
              include: {
                images: { orderBy: { order: 'asc' } },
                stock: true,
              },
            },
          },
        },
      },
    });
    
    res.json(updatedCart);
  } catch (error) {
    next(error);
  }
};

export const removeCoupon = async (req, res, next) => {
  try {
    const cart = await prisma.cart.findUnique({
      where: { userId: req.user.id },
    });
    
    if (!cart) {
      return res.status(404).json({ error: 'Cart not found' });
    }
    
    await prisma.cart.update({
      where: { id: cart.id },
      data: {
        couponCode: null,
        discount: 0,
        total: cart.subtotal,
      },
    });
    
    const updatedCart = await prisma.cart.findUnique({
      where: { id: cart.id },
      include: {
        items: {
          include: {
            product: {
              include: {
                images: { orderBy: { order: 'asc' } },
                stock: true,
              },
            },
          },
        },
      },
    });
    
    res.json(updatedCart);
  } catch (error) {
    next(error);
  }
};

async function recalculateCart(cartId) {
  const cart = await prisma.cart.findUnique({
    where: { id: cartId },
    include: { items: true },
  });
  
  const subtotal = cart.items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const total = subtotal - cart.discount;
  
  await prisma.cart.update({
    where: { id: cartId },
    data: { subtotal, total },
  });
}
