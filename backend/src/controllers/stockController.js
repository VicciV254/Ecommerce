import prisma from '../config/database.js';
import { stockSchema } from '../utils/validators.js';

export const getAllStock = async (req, res, next) => {
  try {
    const stock = await prisma.stock.findMany({
      include: {
        product: {
          include: {
            category: true,
            images: true,
          },
        },
      },
    });
    
    res.json(stock);
  } catch (error) {
    next(error);
  }
};

export const getLowStock = async (req, res, next) => {
  try {
    const stock = await prisma.stock.findMany({
      where: {
        status: 'LOW_STOCK',
      },
      include: {
        product: {
          include: {
            category: true,
            images: true,
          },
        },
      },
    });
    
    res.json(stock);
  } catch (error) {
    next(error);
  }
};

export const getProductStock = async (req, res, next) => {
  try {
    const { productId } = req.params;
    
    const stock = await prisma.stock.findUnique({
      where: { productId },
      include: {
        product: true,
        restockHistory: {
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
        stockLogs: {
          orderBy: { createdAt: 'desc' },
          take: 20,
        },
      },
    });
    
    if (!stock) {
      return res.status(404).json({ error: 'Stock not found' });
    }
    
    res.json(stock);
  } catch (error) {
    next(error);
  }
};

export const updateStock = async (req, res, next) => {
  try {
    const { productId } = req.params;
    const validatedData = stockSchema.parse(req.body);
    
    const stock = await prisma.stock.findUnique({
      where: { productId },
    });
    
    if (!stock) {
      return res.status(404).json({ error: 'Stock not found' });
    }
    
    const previousStock = stock.quantity;
    
    // Update stock
    const updatedStock = await prisma.stock.update({
      where: { productId },
      data: {
        quantity: validatedData.quantity,
        maxStock: validatedData.maxStock,
        minThreshold: validatedData.minThreshold,
        status: validatedData.quantity === 0 ? 'OUT_OF_STOCK' : 
                validatedData.quantity <= (validatedData.minThreshold || 10) ? 'LOW_STOCK' : 'IN_STOCK',
        lastRestocked: new Date(),
      },
    });
    
    // Log stock change
    await prisma.stockLog.create({
      data: {
        stockId: stock.id,
        previousStock,
        newStock: validatedData.quantity,
        action: 'set',
        adminId: req.admin?.id,
      },
    });
    
    res.json(updatedStock);
  } catch (error) {
    next(error);
  }
};

export const bulkUpdateStock = async (req, res, next) => {
  try {
    const { updates } = req.body; // Array of { productId, quantity }
    
    const results = await Promise.all(
      updates.map(async ({ productId, quantity }) => {
        const stock = await prisma.stock.findUnique({
          where: { productId },
        });
        
        if (!stock) {
          return { productId, error: 'Stock not found' };
        }
        
        const previousStock = stock.quantity;
        
        const updatedStock = await prisma.stock.update({
          where: { productId },
          data: {
            quantity,
            status: quantity === 0 ? 'OUT_OF_STOCK' : 
                    quantity <= stock.minThreshold ? 'LOW_STOCK' : 'IN_STOCK',
            lastRestocked: new Date(),
          },
        });
        
        await prisma.stockLog.create({
          data: {
            stockId: stock.id,
            previousStock,
            newStock: quantity,
            action: 'bulk-update',
            adminId: req.admin?.id,
          },
        });
        
        return { productId, success: true, quantity };
      })
    );
    
    res.json(results);
  } catch (error) {
    next(error);
  }
};

export const getStockHistory = async (req, res, next) => {
  try {
    const { productId } = req.params;
    
    const stock = await prisma.stock.findUnique({
      where: { productId },
      include: {
        stockLogs: {
          orderBy: { createdAt: 'desc' },
          take: 50,
        },
        restockHistory: {
          orderBy: { createdAt: 'desc' },
          take: 20,
        },
      },
    });
    
    if (!stock) {
      return res.status(404).json({ error: 'Stock not found' });
    }
    
    res.json(stock);
  } catch (error) {
    next(error);
  }
};

export const restockProduct = async (req, res, next) => {
  try {
    const { productId } = req.params;
    const { quantity, reason } = req.body;
    
    const stock = await prisma.stock.findUnique({
      where: { productId },
    });
    
    if (!stock) {
      return res.status(404).json({ error: 'Stock not found' });
    }
    
    const previousStock = stock.quantity;
    
    const updatedStock = await prisma.stock.update({
      where: { productId },
      data: {
        quantity: previousStock + quantity,
        status: (previousStock + quantity) === 0 ? 'OUT_OF_STOCK' : 
                (previousStock + quantity) <= stock.minThreshold ? 'LOW_STOCK' : 'IN_STOCK',
        lastRestocked: new Date(),
      },
    });
    
    // Create restock history
    await prisma.restockHistory.create({
      data: {
        stockId: stock.id,
        quantity,
        reason: reason || 'Manual restock',
        adminId: req.admin?.id,
      },
    });
    
    // Log stock change
    await prisma.stockLog.create({
      data: {
        stockId: stock.id,
        previousStock,
        newStock: previousStock + quantity,
        action: 'add',
        adminId: req.admin?.id,
      },
    });
    
    res.json(updatedStock);
  } catch (error) {
    next(error);
  }
};
