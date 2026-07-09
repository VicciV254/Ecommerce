import prisma from '../config/database.js';
import imageHostService from '../services/imageHostService.js';
import { generateSlug, paginate } from '../utils/helpers.js';
import { productSchema, updateProductSchema } from '../utils/validators.js';

export const getAllProducts = async (req, res, next) => {
  try {
    const { page, limit, category, designer, search, featured, active } = req.query;
    const { skip, take } = paginate(page, limit);
    
    const where = {};
    
    if (category) where.categoryId = category;
    if (designer) where.designerId = designer;
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
        { tags: { has: search } },
      ];
    }
    if (featured === 'true') where.isFeatured = true;
    if (active === 'true') where.isActive = true;
    
    const [products, total] = await Promise.all([
      prisma.product.findMany({
        where,
        skip,
        take,
        include: {
          category: true,
          designer: true,
          stock: true,
          images: {
            orderBy: { order: 'asc' },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.product.count({ where }),
    ]);
    
    res.json({
      products,
      pagination: {
        page: parseInt(page) || 1,
        limit: take,
        total,
        pages: Math.ceil(total / take),
      },
    });
  } catch (error) {
    next(error);
  }
};

export const getProductById = async (req, res, next) => {
  try {
    const { id } = req.params;
    
    const product = await prisma.product.findUnique({
      where: { id },
      include: {
        category: true,
        designer: true,
        stock: true,
        images: {
          orderBy: { order: 'asc' },
        },
        discount: true,
        reviews: {
          include: { user: { select: { firstName: true, lastName: true } } },
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
      },
    });
    
    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }
    
    res.json(product);
  } catch (error) {
    next(error);
  }
};

export const createProduct = async (req, res, next) => {
  try {
    const validatedData = productSchema.parse(req.body);
    const files = req.files || [];
    
    // Upload images using session-based service
    let uploadedImages = [];
    if (files.length > 0) {
      uploadedImages = await imageHostService.uploadMultipleImages(files);
    }
    
    // Create product
    const product = await prisma.product.create({
      data: {
        name: validatedData.name,
        slug: generateSlug(validatedData.name),
        price: validatedData.price,
        description: validatedData.description,
        categoryId: validatedData.categoryId,
        designerId: validatedData.designerId,
        tags: validatedData.tags || [],
        isActive: validatedData.isActive ?? true,
        isFeatured: validatedData.isFeatured ?? false,
        images: {
          create: uploadedImages.map((img, index) => ({
            url: img.url,
            alt: validatedData.name,
            isMain: index === 0,
            order: index,
          })),
        },
        stock: {
          create: { quantity: 100 },
        },
      },
      include: {
        category: true,
        designer: true,
        stock: true,
        images: true,
      },
    });
    
    res.status(201).json(product);
  } catch (error) {
    next(error);
  }
};

export const updateProduct = async (req, res, next) => {
  try {
    const { id } = req.params;
    const validatedData = updateProductSchema.parse(req.body);
    const newFiles = req.files || [];
    
    const existingProduct = await prisma.product.findUnique({
      where: { id },
      include: { images: true },
    });
    
    if (!existingProduct) {
      return res.status(404).json({ error: 'Product not found' });
    }
    
    // Upload new images using session-based service
    let newUploads = [];
    if (newFiles.length > 0) {
      newUploads = await imageHostService.uploadMultipleImages(newFiles);
    }
    
    // Combine existing and new images
    const allImages = [
      ...existingProduct.images.map(img => ({ url: img.url, alt: img.alt, isMain: img.isMain, order: img.order })),
      ...newUploads.map((img, index) => ({
        url: img.url,
        alt: validatedData.name || existingProduct.name,
        isMain: existingProduct.images.length === 0 && index === 0,
        order: existingProduct.images.length + index,
      })),
    ];
    
    // Update product
    const product = await prisma.product.update({
      where: { id },
      data: {
        name: validatedData.name,
        slug: validatedData.name ? generateSlug(validatedData.name) : existingProduct.slug,
        price: validatedData.price,
        description: validatedData.description,
        categoryId: validatedData.categoryId,
        designerId: validatedData.designerId,
        tags: validatedData.tags,
        isActive: validatedData.isActive,
        isFeatured: validatedData.isFeatured,
        images: {
          deleteMany: {},
          create: allImages.map((img, index) => ({
            url: img.url,
            alt: img.alt,
            isMain: img.isMain,
            order: index,
          })),
        },
      },
      include: {
        category: true,
        designer: true,
        stock: true,
        images: true,
      },
    });
    
    res.json(product);
  } catch (error) {
    next(error);
  }
};

export const deleteProduct = async (req, res, next) => {
  try {
    const { id } = req.params;
    
    const product = await prisma.product.findUnique({
      where: { id },
      include: { images: true },
    });
    
    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }
    
    // Delete images from image host using session-based service
    if (product.images && product.images.length > 0) {
      const publicIds = product.images
        .map(img => {
          // Extract public ID from URL if not stored separately
          // Assuming URL format: https://host.com/api/img/{publicId}
          const parts = img.url.split('/');
          return parts[parts.length - 1];
        })
        .filter(Boolean);
      
      if (publicIds.length > 0) {
        await imageHostService.deleteMultipleImages(publicIds);
      }
    }
    
    await prisma.product.delete({
      where: { id },
    });
    
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
};

export const searchProducts = async (req, res, next) => {
  try {
    const { q } = req.query;
    const { page, limit } = req.query;
    const { skip, take } = paginate(page, limit);
    
    const where = {
      OR: [
        { name: { contains: q, mode: 'insensitive' } },
        { description: { contains: q, mode: 'insensitive' } },
        { tags: { has: q } },
      ],
      isActive: true,
    };
    
    const [products, total] = await Promise.all([
      prisma.product.findMany({
        where,
        skip,
        take,
        include: {
          category: true,
          stock: true,
          images: { orderBy: { order: 'asc' } },
        },
      }),
      prisma.product.count({ where }),
    ]);
    
    res.json({
      products,
      pagination: {
        page: parseInt(page) || 1,
        limit: take,
        total,
        pages: Math.ceil(total / take),
      },
    });
  } catch (error) {
    next(error);
  }
};

export const getFeaturedProducts = async (req, res, next) => {
  try {
    const products = await prisma.product.findMany({
      where: {
        isFeatured: true,
        isActive: true,
      },
      take: 12,
      include: {
        category: true,
        stock: true,
        images: { orderBy: { order: 'asc' } },
      },
    });
    
    res.json(products);
  } catch (error) {
    next(error);
  }
};

export const getRecentProducts = async (req, res, next) => {
  try {
    const products = await prisma.product.findMany({
      where: { isActive: true },
      take: 12,
      orderBy: { createdAt: 'desc' },
      include: {
        category: true,
        stock: true,
        images: { orderBy: { order: 'asc' } },
      },
    });
    
    res.json(products);
  } catch (error) {
    next(error);
  }
};

export const getAllTags = async (req, res, next) => {
  try {
    const products = await prisma.product.findMany({
      select: { tags: true },
      where: { isActive: true },
    });
    
    const allTags = products.flatMap(p => p.tags);
    const uniqueTags = [...new Set(allTags)];
    
    res.json(uniqueTags);
  } catch (error) {
    next(error);
  }
};
