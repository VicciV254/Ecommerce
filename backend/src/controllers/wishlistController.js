import prisma from '../config/database.js';

export const getWishlist = async (req, res, next) => {
  try {
    const wishlist = await prisma.wishlist.findMany({
      where: { userId: req.user.id },
      include: {
        product: {
          include: {
            images: { orderBy: { order: 'asc' } },
            stock: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    
    res.json(wishlist);
  } catch (error) {
    next(error);
  }
};

export const addToWishlist = async (req, res, next) => {
  try {
    const { productId } = req.body;
    
    // Check if product exists
    const product = await prisma.product.findUnique({
      where: { id: productId },
    });
    
    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }
    
    // Check if already in wishlist
    const existing = await prisma.wishlist.findUnique({
      where: {
        userId_productId: {
          userId: req.user.id,
          productId,
        },
      },
    });
    
    if (existing) {
      return res.status(400).json({ error: 'Product already in wishlist' });
    }
    
    const wishlist = await prisma.wishlist.create({
      data: {
        userId: req.user.id,
        productId,
      },
      include: {
        product: {
          include: {
            images: { orderBy: { order: 'asc' } },
            stock: true,
          },
        },
      },
    });
    
    res.status(201).json(wishlist);
  } catch (error) {
    next(error);
  }
};

export const removeFromWishlist = async (req, res, next) => {
  try {
    const { id } = req.params;
    
    const wishlist = await prisma.wishlist.findUnique({
      where: { id },
    });
    
    if (!wishlist) {
      return res.status(404).json({ error: 'Wishlist item not found' });
    }
    
    if (wishlist.userId !== req.user.id) {
      return res.status(403).json({ error: 'Not authorized' });
    }
    
    await prisma.wishlist.delete({
      where: { id },
    });
    
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
};
